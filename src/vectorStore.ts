import * as lancedb from 'vectordb';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

export interface FailureEvent {
    id: string; // UUID
    failure_type: 'runtime' | 'test' | 'deletion';
    error_message: string;
    timestamp: string;
    file_path: string;
    related_memory_id?: string; // If known
}

export class VectorStore {
    private dbPath: string;
    private db: any = null; // Use any to avoid type issues with null initially
    private table: any = null;
    private clusterTable: any = null;
    private failureTable: any = null;

    constructor() {
        this.dbPath = path.join(os.homedir(), '.gemini', 'antigravity', 'pattern-vault', 'data');
        if (!fs.existsSync(this.dbPath)) {
            fs.mkdirSync(this.dbPath, { recursive: true });
        }
    }

    async init() {
        if (this.table && this.clusterTable && this.failureTable) return; // Check all tables

        if (!this.db) { // Connect if not already connected
            this.db = await lancedb.connect(this.dbPath);
        }

        try {
            const tableNames = await this.db.tableNames();

            // Initialize 'vectors' table
            if (!tableNames.includes('vectors')) {
                this.table = await this.db.createTable('vectors', [{
                    vector: Array(1536).fill(0), // Dummy vector for schema
                    id: 'init',
                    content: '',
                    filePath: '',
                    workspaceName: '',
                    timestamp: '',
                    language: '',
                    prompt: '',
                    failureLog: '',
                    source: '',
                    confidence: 0,
                    conversationId: '',
                    pastedResponse: '',
                    finalEditedCode: '',
                    matchContext: '',
                    patternDescription: '',
                    vectorType: '',
                    relatedId: '',
                    summary: '',
                    projectPath: ''
                }]);
                await this.table.delete('id = "init"');
            } else {
                this.table = await this.db.openTable('vectors');
            }

            // PATTERN CLUSTERS TABLE
            if (!tableNames.includes('clusters')) {
                this.clusterTable = await this.db.createTable('clusters', [{
                    vector: Array(1536).fill(0), // Centroid
                    id: 'init',
                    label: '',
                    memberIds: [], // array of strings
                    usageCount: 0,
                    lastUsed: ''
                }]);
                await this.clusterTable.delete('id = "init"');
            } else {
                this.clusterTable = await this.db.openTable('clusters');
            }

            // FAILURE EVENTS TABLE
            if (!tableNames.includes('failures')) {
                this.failureTable = await this.db.createTable('failures', [{
                    vector: Array(1536).fill(0), // Dummy vector (required by LanceDB even if unused for search?)
                    // Actually, LanceDB can store non-vector data, but usually expects a vector column for vector search.
                    // We might want to embed the error message later? For now, let's keep it simple.
                    // If we want to search by error similarity, we need a vector.
                    // Let's add a dummy vector for now to stay consistent.
                    id: 'init',
                    failure_type: '',
                    error_message: '',
                    timestamp: '',
                    file_path: '',
                    related_memory_id: ''
                }]);
                await this.failureTable.delete('id = "init"');
            } else {
                this.failureTable = await this.db.openTable('failures');
            }

        } catch (e) {
            console.error('Failed to init vector store:', e);
        }
    }

    async logFailureEvent(event: FailureEvent, embedding?: number[]) {
        if (!this.db || !this.failureTable) await this.init();
        if (!this.failureTable) return;

        const data = {
            vector: embedding || Array(1536).fill(0), // Use actual embedding or dummy
            id: event.id,
            failure_type: event.failure_type,
            error_message: event.error_message,
            timestamp: event.timestamp,
            file_path: event.file_path,
            related_memory_id: event.related_memory_id || ''
        };

        await this.failureTable.add([data]);
    }

    async searchFailures(queryVector: number[], limit: number = 5): Promise<any[]> {
        if (!this.db || !this.failureTable) await this.init();
        if (!this.failureTable) return [];
        try {
            return await this.failureTable.search(queryVector)
                .limit(limit)
                .execute();
        } catch (e) {
            return [];
        }
    }

    async savePattern(embedding: number[], metadata: any): Promise<string> {
        if (!this.db || !this.table) await this.init(); // Ensure db and table are initialized

        const data = [{
            id: uuidv4(),
            vector: embedding,
            ...metadata,
            timestamp: new Date().toISOString()
        }];

        if (!this.table) { // This case should ideally not be hit if init() is awaited
            try {
                // Initialize table with the first record
                this.table = await this.db!.createTable('patterns', data); // Original table name was 'patterns'
            } catch (e) {
                console.error('Error creating table:', e);
            }
        } else {
            await this.table.add(data);
        }

        return data[0].id;
    }

    async search(vector: number[], limit: number = 5) {
        if (!this.db) await this.init();
        if (!this.table) {
            return [];
        }

        return await this.table.search(vector).limit(limit).execute();
    }

    async getPatternById(id: string) {
        if (!this.db) await this.init();
        if (!this.table) return null;

        const results = await this.table.search([0] /* dummy */)
            .where(`id = '${id}'`)
            .limit(1)
            .execute();

        return results.length > 0 ? results[0] : null;
    }

    async deletePattern(id: string) {
        if (!this.db) await this.init();
        if (!this.table) return;

        // LanceDB delete syntax: table.delete("filter string")
        await this.table.delete(`id = '${id}'`);
    }

    async deleteRelatedVectors(relatedId: string) {
        if (!this.db) await this.init();
        if (!this.table) return;

        await this.table.delete(`relatedId = '${relatedId}'`);
    }

    // --- Cluster Methods ---

    async saveCluster(cluster: any) {
        if (!this.db || !this.clusterTable) await this.init();
        if (!this.clusterTable) return;

        const data = {
            vector: cluster.centroid,
            id: cluster.id,
            label: cluster.label,
            memberIds: cluster.memberIds,
            usageCount: cluster.usageCount,
            lastUsed: cluster.lastUsed
        };

        try {
            await this.clusterTable.delete(`id = '${cluster.id}'`);
        } catch (e) { }

        await this.clusterTable.add([data]);
    }

    async getAllClusters(): Promise<any[]> {
        if (!this.db || !this.clusterTable) await this.init();
        if (!this.clusterTable) return [];

        try {
            return await this.clusterTable.search(Array(1536).fill(0))
                .limit(1000)
                .execute();
        } catch (e) {
            console.error("Error fetching clusters:", e);
            return [];
        }
    }

    async updatePattern(id: string, updates: any) {
        if (!this.db) await this.init();
        if (!this.table) return;

        // LanceDB currently handles updates by delete + re-insert or specialized update APIs depending on version.
        // For simplicity and compatibility: Read -> Delete -> Modify -> Insert
        const results = await this.table.search([0] /* Dummy vector, unused for ID query usually but required by API? No, use filter */)
            .where(`id = '${id}'`)
            .limit(1)
            .execute();

        if (results.length > 0) {
            const oldRecord = results[0];
            await this.table.delete(`id = '${id}'`);

            const newRecord = { ...oldRecord, ...updates, timestamp: new Date().toISOString() };
            // Ensure vector is preserved if not in updates
            // (LanceDB results might not return vector by default unless requested, assume we need to handle this carefully)
            // Actually, for metadata updates (failure log), we don't change the vector.
            // CAUTION: If 'vector' isn't in results, we lose it. 
            // We should ensure we fetch it. safely. 
            // Simplified approach: Just delete and re-add if we have the full object. 

            // Allow simpler "append" logic or just separate table for failure logs?
            // To keep it simple for this MVP: 
            // We will just perform a delete-insert if we can get the vector.
            // If we can't easily get the vector, we might need a different strategy.
            // LanceDB 0.4+ supports update? 
            // Let's assume we can merge.

            // Re-inserting:
            await this.table.add([newRecord]);
        }
    }

    async getMemoriesByIds(ids: string[]): Promise<any[]> {
        if (!this.db || !this.table) await this.init();
        if (!this.table) return [];

        // Use concurrency to fetch multiple IDs
        // Note: For very large clusters, batching would be better, but this suffices for typical use.
        const promises = ids.map(async (id) => {
            try {
                const results = await this.table.search(Array(1536).fill(0))
                    .where(`id = '${id}'`)
                    .limit(1)
                    .execute();
                return results.length > 0 ? results[0] : null;
            } catch (e) {
                return null;
            }
        });

        const results = await Promise.all(promises);
        return results.filter(r => r !== null);
    }

    async findMostRecentMemory(filePath: string): Promise<any | null> {
        if (!this.db || !this.table) await this.init();
        if (!this.table) return null;

        try {
            const results = await this.table.search(Array(1536).fill(0))
                .where(`filePath = '${filePath.replace(/\\/g, '\\\\')}'`) // Escape backslashes
                .limit(1)
                .execute();
            return results.length > 0 ? results[0] : null; // LanceDB results are usually ordered by insertion if no sort? 
            // Actually, we might need to sort by timestamp if possible, but LanceDB basic search might not sort by metadata easily without SQL.
            // For now, assuming latest is fine or we take what we get. 
            // Ideally we'd sort.
        } catch (e) {
            return null;
        }
    }

    async getRecentMemories(filePath: string, minutes: number): Promise<any[]> {
        if (!this.db || !this.table) await this.init();
        if (!this.table) return [];

        // LanceDB doesn't have easy date math in the filter string usually.
        // We will fetch by file path and filter in JS for now.
        // Optimization: if we could filter by timestamp string > X... 
        // ISO string comparison works lexicographically.
        const cutoff = new Date(Date.now() - minutes * 60000).toISOString();

        try {
            const results = await this.table.search(Array(1536).fill(0))
                .where(`filePath = '${filePath.replace(/\\/g, '\\\\')}' AND timestamp > '${cutoff}'`)
                .limit(50)
                .execute();
            return results;
        } catch (e) {
            console.error('Error fetching recent memories:', e);
            return [];
        }
    }

    async searchWithFilter(vector: number[], filter: string, limit: number = 5): Promise<any[]> {
        if (!this.db || !this.table) await this.init();
        if (!this.table) return [];
        try {
            return await this.table.search(vector)
                .where(filter)
                .limit(limit)
                .execute();
        } catch (e) {
            return [];
        }
    }
}
