import * as vscode from 'vscode';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { VectorStore } from './vectorStore';
import { EmbeddingService } from './embeddings';
import { OllamaService } from './llm';
import { EditTracker } from './tracker';
import { PatternAnalyzer } from './analyzer';
import { Logger } from './logger';
import { ExclusionManager } from './exclusions';

export interface CodeMemory {
    content: string;
    filePath: string;
    languageId: string;
    workspaceName: string;
    timestamp?: string;
    prompt?: string;
    failureLog?: string;
    source?: 'human' | 'ai' | 'ai_candidate';
    confidence?: number;
    conversationId?: string;
    pastedResponse?: string; // The raw AI response (if applicable)
    finalEditedCode?: string; // The eventual code after user edits
    matchContext?: string; // Explanation of why this result matched (e.g., "Matched via prompt")
    patternDescription?: string; // Abstracted problem summary (one sentence)

    // Failure Metadata
    failureCount?: number;
    lastFailure?: string;
    isUnstable?: boolean;
}

/**
 * Represents a semantic cluster of code chunks (a "Pattern").
 */
export interface PatternCluster {
    id: string; // Unique cluster ID (UUID)
    label: string; // AI-generated label (e.g. "JWT auth middleware")
    centroid: number[]; // The average vector of all memories in this cluster
    memberIds: string[]; // List of CodeMemory IDs belonging to this cluster
    usageCount: number; // How many times this pattern has been used/found
    lastUsed: string; // ISO Timestamp of most recent usage
}

export class PatternEngine {
    private static instance: PatternEngine;
    private analyzer: PatternAnalyzer;
    private storeDb: VectorStore;
    private embeddings: EmbeddingService;
    private llm: OllamaService;
    private logger: Logger;
    private exclusions: ExclusionManager;

    // In-memory pattern index
    private patterns: PatternCluster[] = [];

    // Cache for query results
    private queryCache: Map<string, { results: any[], timestamp: number }> = new Map();
    private readonly CACHE_TTL = 1000 * 60 * 5; // 5 minutes
    private readonly QUERY_THRESHOLD = 0.4; // Similarity threshold

    private constructor() {
        this.analyzer = new PatternAnalyzer();
        this.storeDb = new VectorStore();
        this.embeddings = EmbeddingService.getInstance();
        this.llm = OllamaService.getInstance();
        this.logger = Logger.getInstance();
        this.exclusions = ExclusionManager.getInstance();
    }

    public static getInstance(): PatternEngine {
        if (!PatternEngine.instance) {
            PatternEngine.instance = new PatternEngine();
        }
        return PatternEngine.instance;
    }

    async init() {
        await this.storeDb.init();
        await this.loadPatterns();
    }

    async loadPatterns() {
        try {
            const storedClusters = await this.storeDb.getAllClusters();
            this.patterns = storedClusters.map(c => ({
                id: c.id,
                label: c.label,
                centroid: c.vector, // Mapped back from vector field
                memberIds: c.memberIds,
                usageCount: c.usageCount,
                lastUsed: c.lastUsed
            }));
            this.logger.log(`Loaded ${this.patterns.length} pattern clusters.`);
        } catch (e) {
            this.logger.log(`Failed to load patterns: ${e} `);
        }
    }

    public reloadConfig() {
        this.llm.reloadConfig();
    }

    /**
     * Stores a code memory.
     * Delegates to Analyzer to split into chunks, filters noise, then embeds and stores each.
     */
    public async store(memory: CodeMemory): Promise<any[]> {
        // Exclusion Check
        if (this.exclusions.isExcluded(memory.filePath)) {
            // this.logger.log(`Ignored excluded file: ${ memory.filePath } `); 
            // Commented out to avoid spamming log for excluded files
            return [];
        }

        // Invalidate Query Cache on new storage to ensure fresh results
        if (this.queryCache.size > 0) {
            this.queryCache.clear();
        }

        this.logger.log(`Storing code from: ${path.basename(memory.filePath)}`);

        // Check for Churn (Silent Failure) before processing new chunks
        // Note: checkForChurn method is not present in the provided context, assuming it exists elsewhere.
        // If it doesn't exist, this line will cause a compilation error.
        // For the purpose of this edit, it's added as requested.
        await this.checkForChurn(memory.filePath, memory.content);

        // 1. Chunking
        const chunks = this.analyzer.findPatterns(memory.content, memory.filePath);

        if (chunks.length === 0) {
            return [];
        }

        // 2. Embedding & Storage (Parallel)
        const promises = chunks.map(async (chunk, index) => {
            // Heuristic 1: Min Size Threshold
            if (chunk.content.length < 50) {
                return undefined;
            }

            try {
                // Contextual Embedding
                const textToEmbed = `${chunk.language}: ${chunk.content} `;
                const vector = await this.embeddings.getEmbedding(textToEmbed);

                // Heuristic 2: Similarity Filter (Deduplication)
                const similar = await this.storeDb.search(vector, 1);
                if (similar.length > 0 && (similar[0] as any)._distance < 0.2) {
                    // Logic: If extremely close < 0.05, it's a duplicate (skip).
                    // If between 0.05 and 0.2, it's a "Pattern" (return for alert).
                    const match = similar[0] as any;
                    if (match._distance < 0.05) {
                        this.logger.log(`Skipped duplicate(${index}): ...${chunk.content.substring(0, 20)} `);
                        return undefined;
                    }
                    return match; // Return similar pattern for alert
                }

                // Only summarize if it's a decent size chunk to save time? 
                // For now, summarize all stored chunks.
                const summary = await this.llm.summarize(chunk.content);

                // Generate Abstract Pattern Description (Normalized)
                // We do this in parallel to save time, or sequentially? 
                // Let's do it here.
                const patternDescription = await this.llm.abstractPattern(chunk.content);

                // Context Linking: Check if this chunk belongs to a tracked AI conversation
                let conversationId = memory.conversationId;
                let source = memory.source || 'human';

                if (!conversationId) {
                    const foundId = EditTracker.getInstance().getConversationId(chunk.filePath, chunk.startLine, chunk.endLine);
                    if (foundId) {
                        conversationId = foundId;
                        source = 'ai'; // It's tracked, so it's AI
                        this.logger.log(`Linked chunk to conversation: ${foundId} `);
                    }
                }

                const metadata = {
                    content: chunk.content,
                    summary: summary,
                    filePath: chunk.filePath,
                    language: chunk.language,
                    projectPath: chunk.projectPath,
                    workspaceName: memory.workspaceName,
                    timestamp: new Date().toISOString(),
                    prompt: memory.prompt || '',
                    failureLog: memory.failureLog || '',
                    source: source,
                    confidence: memory.confidence || 1.0,
                    conversationId: conversationId || '',
                    pastedResponse: memory.pastedResponse || '',
                    finalEditedCode: memory.finalEditedCode || '',
                    matchContext: '',
                    patternDescription: patternDescription,
                    vectorType: 'code' // Main code vector
                };

                // Index One: Code Vector (Raw)
                const codeVector = await this.embeddings.getEmbedding(chunk.content);
                const id = await this.storeDb.savePattern(codeVector, metadata);

                // --- RISK DETECTION: Check for Reuse of Unstable Patterns ---
                let riskAlert: { type: string, message: string, id: string } | undefined;
                try {
                    // Search for similar patterns that are marked as unstable
                    // Filter: isUnstable = true
                    // Using searchWithFilter
                    const riskyMatches = await this.storeDb.searchWithFilter(codeVector, "isUnstable = true", 1);
                    if (riskyMatches.length > 0) {
                        const match = riskyMatches[0];
                        // Threshold: 0.85 similarity approx < 0.25 distance depending on metric
                        // LanceDB default cosine distance? If so, < 0.15 is very close.
                        // Let's assume matches returned are sorted by distance.
                        if ((match as any)._distance < 0.2) { // 0.2 distance ~ 0.8 similarity
                            riskAlert = {
                                type: 'unstable',
                                message: `Caution: Similar to a pattern marked unstable (Failed ${match.failureCount} times).`,
                                id: match.id
                            };
                            this.logger.log(`RISK DETECTED: Reuse of unstable pattern ${match.id}`);
                        }
                    }
                } catch (e) {
                    this.logger.log(`Error checking risk: ${e}`);
                }

                // Index Two: Pattern Abstraction Vector (Normalized)
                let matchedCluster: PatternCluster | null = null;
                if (patternDescription) {
                    try {
                        const patternVector = await this.embeddings.getEmbedding(patternDescription);
                        await this.storeDb.savePattern(patternVector, {
                            ...metadata,
                            vectorType: 'pattern_abstraction',
                            relatedId: id,
                            content: patternDescription // Store usage of this abstraction
                        });
                        this.logger.log(`Indexed normalized pattern vector for ${id}`);

                        // --- CLUSTERING LOGIC ---
                        matchedCluster = await this.assignToPattern(id, patternVector, patternDescription);

                    } catch (e) {
                        this.logger.log(`Failed to index pattern abstraction: ${e}`);
                    }
                }

                // Index AI Response Separately (if present and distinct)
                if (memory.pastedResponse) {
                    try {
                        const responseVector = await this.embeddings.getEmbedding(memory.pastedResponse);
                        await this.storeDb.savePattern(responseVector, {
                            ...metadata,
                            vectorType: 'ai_response',
                            relatedId: id, // Link to main code record
                            content: memory.pastedResponse // Store raw response text
                        });
                        this.logger.log(`Indexed separate AI Response vector for ${id}`);
                    } catch (err) {
                        this.logger.log(`Failed to index AI response: ${err} `);
                    }
                }
                this.logger.log(`Saved chunk(${index}).ID: ${id}.Summary: ${summary ? 'Yes' : 'No'} `);

                // Return structure with ID and potential alerts
                return {
                    id: id,
                    ...metadata,
                    similar: similar,
                    matchedCluster: matchedCluster,
                    riskAlert: riskAlert
                };

            } catch (e) {
                this.logger.log(`Error saving chunk: ${e} `);
                return undefined;
            }
        });

        const results = await Promise.all(promises);
        return results.filter(r => r !== undefined);
    }

    async forgetContext(id: string) {
        if (!this.storeDb) {
            this.storeDb = new VectorStore();
            await this.storeDb.init();
        }

        // 1. Update the MAIN record to remove context fields
        const updates: Partial<CodeMemory> = {
            prompt: '',
            pastedResponse: '',
            conversationId: '',
            source: 'human', // Treat as human code now
            matchContext: ''
        };

        await this.updateMemory(id, updates);

        // 2. Delete related vectors (Prompt, AI Response) so they don't show up in search
        if (this.storeDb) {
            await this.storeDb.deleteRelatedVectors(id);
            this.logger.log(`Deleted related AI context vectors for ${id}`);
        }

        return true;
    }

    async updateMemory(id: string, updates: Partial<CodeMemory>) {
        if (!this.storeDb) {
            this.storeDb = new VectorStore();
            await this.storeDb.init();
        }

        // Fetch current to merge
        const current = await this.storeDb.getPatternById(id);
        if (!current) return;

        const merged = { ...current, ...updates };

        // If content changed, we'd need to re-embed. 
        // For now assuming metadata updates mostly.

        // Special Handling: If prompt is being UPDATED (e.g. inference finished),
        // we might want to save a separate prompt vector now.
        if (updates.prompt && updates.prompt !== current.prompt && updates.prompt !== '') {
            try {
                const promptVector = await this.embeddings.getEmbedding(updates.prompt);
                await this.storeDb.savePattern(promptVector, {
                    ...merged,
                    vectorType: 'prompt',
                    relatedId: id,
                    content: updates.prompt // Store raw prompt text
                });
                this.logger.log(`Indexed separate Prompt vector for ${id}`);
            } catch (e) {
                this.logger.log(`Failed to index inferred prompt: ${e} `);
            }
        }

        if (updates.finalEditedCode) {
            // We might want to re-embed the code vector if the code changed significantly?
            // For now, just updating the text field.
        }

        // Save (Overwrite)
        await this.storeDb.updatePattern(id, merged);
    }

    /**
     * Queries for similar code memories.
     * Generates embedding for query and performs similarity search.
     */
    public async query(queryText: string): Promise<any[]> {
        // 1. Check Cache
        const cached = this.queryCache.get(queryText);
        if (cached && (Date.now() - cached.timestamp < this.CACHE_TTL)) {
            this.logger.log(`Query cache hit: "${queryText}"`);
            return cached.results;
        }

        this.logger.log(`Searching for: "${queryText}"`);

        try {
            // 2. Generate Embedding
            const vector = await this.embeddings.getEmbedding(queryText);

            // 3. Search Database
            // Get slightly more results than needed, then filter
            const rawResults = await this.storeDb.search(vector, 10);

            // Filter by threshold
            const filteredResults = rawResults.filter((r: any) => r._distance <= this.QUERY_THRESHOLD);

            this.logger.log(`Found ${filteredResults.length} matches(from ${rawResults.length} raw).`);

            // 4. Map to clean format (with Parent Resolution)
            const mappedResults: any[] = [];
            const seenIds = new Set<string>();

            for (const r of filteredResults) {
                const rAny = r as any;
                let finalRecord = rAny;
                let matchType = 'code';

                // If this is a related vector (prompt/ai_response), fetch parent
                if (rAny.relatedId) {
                    const parent = await this.storeDb.getPatternById(rAny.relatedId);
                    if (parent) {
                        finalRecord = parent;
                        matchType = rAny.vectorType || 'related';
                        // Annotate that we matched on a related field
                        finalRecord.matchContext = `Matched via ${matchType}: "${(rAny.content as string).substring(0, 30)}..."`;
                    }
                }

                if (!seenIds.has(finalRecord.id)) {
                    seenIds.add(finalRecord.id);
                    mappedResults.push({
                        id: finalRecord.id,
                        content: finalRecord.content,
                        filePath: finalRecord.filePath,
                        summary: finalRecord.summary || '',
                        score: r._distance, // Keep original score
                        timestamp: finalRecord.timestamp,
                        prompt: finalRecord.prompt,
                        failureLog: finalRecord.failureLog,
                        matchContext: finalRecord.matchContext, // Pass down annotation
                        pastedResponse: finalRecord.pastedResponse,
                        finalEditedCode: finalRecord.finalEditedCode,
                        conversationId: finalRecord.conversationId
                    });
                }
            }

            // 5. Update Cache
            this.queryCache.set(queryText, {
                results: mappedResults,
                timestamp: Date.now()
            });

            return mappedResults;

        } catch (e) {
            this.logger.log(`Query failed: ${e} `);
            return [];
        }
    }

    public async deleteMemory(id: string): Promise<void> {
        try {
            await this.storeDb.deletePattern(id);
            this.logger.log(`Deleted memory ID: ${id} `);
            this.queryCache.clear();
        } catch (e) {
            this.logger.log(`Failed to delete memory: ${e}`);
        }
    }

    public async inferIntent(code: string): Promise<string> {
        return this.llm.inferIntent(code);
    }

    // --- Clustering ---

    private cosineSimilarity(a: number[], b: number[]): number {
        let dot = 0;
        let magA = 0;
        let magB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            magA += a[i] * a[i];
            magB += b[i] * b[i];
        }
        return dot / (Math.sqrt(magA) * Math.sqrt(magB));
    }

    async assignToPattern(memoryId: string, vector: number[], label: string): Promise<PatternCluster | null> {
        let bestSim = -1;
        let bestCluster: PatternCluster | null = null;
        const THRESHOLD = 0.85;

        // 1. Find best matching cluster
        for (const cluster of this.patterns) {
            const sim = this.cosineSimilarity(vector, cluster.centroid);
            if (sim > bestSim) {
                bestSim = sim;
                bestCluster = cluster;
            }
        }

        // 2. Assign or Create
        if (bestCluster && bestSim >= THRESHOLD) {
            // MATCH: Update existing cluster
            this.logger.log(`Assigning ${memoryId} to pattern "${bestCluster.label}" (Sim: ${bestSim.toFixed(2)})`);

            // Update Centroid (Moving Average)
            const N = bestCluster.usageCount; // Weight of old centroid
            const M = 1; // Weight of new vector
            // New Centroid = (Old * N + New * M) / (N + M)
            const newCentroid = bestCluster.centroid.map((val, i) => (val * N + vector[i]) * 1.0 / (N + M));

            bestCluster.centroid = newCentroid;
            bestCluster.memberIds.push(memoryId);
            bestCluster.usageCount++;
            bestCluster.lastUsed = new Date().toISOString();

            // Persist
            await this.storeDb.saveCluster(bestCluster);
            return bestCluster;

        } else {
            // NO MATCH: Create new cluster
            this.logger.log(`Creating new pattern cluster: "${label}"`);
            const newCluster: PatternCluster = {
                id: uuidv4(),
                label: label,
                centroid: vector,
                memberIds: [memoryId],
                usageCount: 1,
                lastUsed: new Date().toISOString()
            };

            this.patterns.push(newCluster);
            await this.storeDb.saveCluster(newCluster);
            return null; // Not a reuse
        }
    }

    async recordPatternAccess(memoryId: string) {
        // Find cluster containing this memory
        const cluster = this.patterns.find(p => p.memberIds.includes(memoryId));
        if (cluster) {
            cluster.usageCount++;
            cluster.lastUsed = new Date().toISOString();
            await this.storeDb.saveCluster(cluster);
            this.logger.log(`Updated usage for pattern "${cluster.label}" (Count: ${cluster.usageCount})`);
        }
    }

    async getClusterMemories(clusterId: string): Promise<any[]> {
        const cluster = this.patterns.find(p => p.id === clusterId);
        if (!cluster) return [];

        this.logger.log(`Fetching ${cluster.memberIds.length} memories for cluster "${cluster.label}"`);

        try {
            return await this.storeDb.getMemoriesByIds(cluster.memberIds);
        } catch (e) {
            this.logger.log(`Error fetching cluster memories: ${e}`);
            return [];
        }
    }

    async recordFailure(failure: { type: 'runtime' | 'test' | 'process', message: string, filePath: string }) {
        const event = {
            id: uuidv4(),
            failure_type: failure.type as 'runtime' | 'test' | 'deletion',
            error_message: failure.message,
            timestamp: new Date().toISOString(),
            file_path: failure.filePath,
            related_memory_id: ''
        };

        // Semantic Linking
        try {
            // 1. Embed the error message
            if (this.embeddings && this.storeDb) {
                // Truncate message if too long for embedding model (usually 8k tokens, but just in case)
                const errorText = failure.message.substring(0, 1000);
                const errorVector = await this.embeddings.getEmbedding(errorText);

                // 2. Search for code in this file that matches the error
                // We filter by filePath to ensure we blame code in the actual file where error occurred.
                const filter = `filePath = '${failure.filePath.replace(/\\/g, '\\\\')}'`;
                const matches = await this.storeDb.searchWithFilter(errorVector, filter, 1);

                if (matches.length > 0) {
                    const bestMatch = matches[0];
                    // Heuristic threshold: Is this error relevant to this code?
                    // LanceDB returns distance (lower is better, 0 is exact).
                    // But here we are matching "Error Message" vs "Code Content".
                    // They might not be structurally similar, but semantically related?
                    // If purely local embedding (nomic-embed-text), it might work.
                    // Let's assume matches[0] is our best bet for now.
                    // (Optional: check distance < 0.6?)
                    event.related_memory_id = bestMatch.id;

                    // Option: Update the memory to include this failure log?
                    // await this.updateMemory(bestMatch.id, { failureLog: failure.message });
                }
            }
        } catch (e) {
            this.logger.log(`Semantic linking failed: ${e}`);
        }

        let embedding: number[] | undefined;
        if (this.embeddings) {
            try {
                const errorText = failure.message.substring(0, 1000);
                embedding = await this.embeddings.getEmbedding(errorText);
            } catch (e) { }
        }

        try {
            await this.storeDb.logFailureEvent(event as any, embedding);
        } catch (e) {
            this.logger.log(`DB Log Failure failed: ${e}`);
        }

        // Update Memory Stats if Linked
        if (event.related_memory_id) {
            try {
                const memory = await this.storeDb.getPatternById(event.related_memory_id);
                if (memory) {
                    const newCount = (memory.failureCount || 0) + 1;
                    const updates = {
                        failureCount: newCount,
                        lastFailure: event.timestamp,
                        isUnstable: newCount >= 3 // Threshold for instability
                    };
                    await this.storeDb.updatePattern(event.related_memory_id, updates);
                    this.logger.log(`Updated memory ${event.related_memory_id} failure count to ${newCount}`);
                }
            } catch (e) {
                this.logger.log(`Failed to update memory stats: ${e}`);
            }
        }

        this.logger.log(`Recorded failure: ${failure.type} in ${path.basename(failure.filePath)} (Linked: ${event.related_memory_id ? 'Yes' : 'No'})`);
    }

    async findSimilarFailures(errorMessage: string): Promise<any[]> {
        try {
            const vector = await this.embeddings.getEmbedding(errorMessage);
            if (this.storeDb) {
                return await this.storeDb.searchFailures(vector, 5);
            }
            return [];
        } catch (e) {
            return [];
        }
    }

    async checkForChurn(filePath: string, currentContent: string) {
        // Look for memories created in the last 10 minutes for this file
        try {
            if (!this.storeDb) return;
            const recent = await this.storeDb.getRecentMemories(filePath, 10);

            for (const memory of recent) {
                // simple presence check
                const normalizedMem = memory.content.replace(/\s+/g, ' ').trim();
                const normalizedCurr = currentContent.replace(/\s+/g, ' ').trim();

                if (!normalizedCurr.includes(normalizedMem)) {
                    // Code is gone!
                    await this.recordFailure({
                        type: 'process',
                        message: `Silent Churn: Recent code memory (ID: ${memory.id}) deleted/modified silently.`,
                        filePath: filePath
                    });

                    this.logger.log(`Churn detected: Memory ${memory.id} deleted.`);
                }
            }
        } catch (e) {
            this.logger.log(`Error checking churn: ${e}`);
        }
    }

    async getPatternDetails(id: string): Promise<any | null> {
        if (!this.storeDb) return null;
        try {
            return await this.storeDb.getPatternById(id);
        } catch (e) {
            return null;
        }
    }

    async trustPattern(id: string) {
        if (!this.storeDb) return;
        try {
            await this.storeDb.updatePattern(id, { isTrusted: true });
            this.logger.log(`User trusted pattern ${id}`);
        } catch (e) {
            this.logger.log(`Error trusting pattern: ${e}`);
        }
    }
}
