import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { LabsController } from './LabsController';
import { EmbeddingService } from '../embeddings';

interface Snapshot {
    id: string; // Unique ID (timestamp + random)
    vector: number[];
    path: string; // Relative path
    content: string;
    timestamp: number;
    lines: number;
    branch?: string;
    commit?: string;
}

// Helper for Cosine Similarity
function cosineSimilarity(vecA: number[], vecB: number[]): number {
    const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
    const magA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
    const magB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
    return dotProduct / (magA * magB);
}

import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

export class PhotographerService {
    private static instance: PhotographerService;
    private dbPath: string | null = null;
    private db: any = null; // VectorDB Connection
    private debounceTimer: NodeJS.Timeout | null = null;
    private readonly MAX_FILE_SIZE = 300 * 1024; // 300KB Limit

    private constructor() { }

    public static getInstance(): PhotographerService {
        if (!PhotographerService.instance) {
            PhotographerService.instance = new PhotographerService();
        }
        return PhotographerService.instance;
    }

    public async initialize(context: vscode.ExtensionContext) {
        if (!LabsController.getInstance().isPhotographicMemoryEnabled()) {
            return;
        }

        // Setup DB Path (Private Vault)
        const storagePath = context.globalStorageUri.fsPath;
        if (!fs.existsSync(storagePath)) fs.mkdirSync(storagePath, { recursive: true });
        this.dbPath = path.join(storagePath, 'photographic_memory');

        // Initialize DB (Lazy load)
        try {
            // Check if mock is injected for testing
            if ((this as any)._mockDb) {
                this.db = (this as any)._mockDb;
            } else {
                const vectordb = require('vectordb');
                this.db = await vectordb.connect(this.dbPath);
            }
            console.log('[Photographer] DB connected at:', this.dbPath);
        } catch (e) {
            console.error('[Photographer] Failed to load vectordb:', e);
        }

        // Listen for saves
        vscode.workspace.onDidSaveTextDocument(this.snapshot, this, context.subscriptions);
    }

    // For functionality testing
    public async reset() {
        this.db = null;
        this.dbPath = null;
    }

    private async snapshot(document: vscode.TextDocument) {
        if (!LabsController.getInstance().isPhotographicMemoryEnabled()) return;
        if (document.languageId === 'log') return; // Ignore logs

        // 1. Debounce (Clear previous timer)
        if (this.debounceTimer) clearTimeout(this.debounceTimer);

        // 2. Set new timer (2s delay)
        this.debounceTimer = setTimeout(async () => {
            await this.processSnapshot(document);
        }, 2000);
    }

    private async processSnapshot(document: vscode.TextDocument) {
        try {
            const content = document.getText();
            if (content.length < 10) return; // Ignore empty files

            // 3. Size Limit Check
            if (content.length > this.MAX_FILE_SIZE) {
                console.log(`[Photographer] Skipped large file: ${document.fileName} (${content.length} bytes)`);
                return;
            }

            const relativePath = vscode.workspace.asRelativePath(document.uri);
            const embedding = await EmbeddingService.getInstance().getEmbedding(content);
            const timestamp = Date.now();

            // 4. Semantic Filtering (Smart Save)
            const table = await this.getTable();
            // TODO: Optimally we would query DB for *last* snapshot of this file. 
            // However, verify limitation: LanceDB search returns similarity, not strict filtering on non-indexed columns easily without SQL-like filter.
            // For now, we search by path (exact match) + sort by timestamp? 
            // LanceDB JS simple filtering:
            // This part is tricky without SQL. We might skip "read-before-write" optimization for the very first step 
            // OR we do a quick vector search of the *content* itself. If result is > 0.999 similarity, we skip.

            // Let's do the "Content Similarity" check using the vector we just generated.
            const similar = await table.search(embedding)
                .where(`path = '${relativePath}'`) // Filter by file path
                .limit(1)
                .execute();

            if (similar.length > 0) {
                const bestMatch = similar[0] as Snapshot;
                // Calculate manual cosine similarity to be sure (since metric might vary)
                const similarity = cosineSimilarity(embedding, bestMatch.vector);

                // Threshold: 0.99 means 99% identical meaning.
                if (similarity > 0.99) {
                    console.log(`[Photographer] Skipped duplicate semantic snapshot (Sim: ${similarity.toFixed(4)})`);
                    return;
                }
            }

            // 5. Git Awareness (With Timeout & Mutex protection)
            let branch = undefined;
            let commit = undefined;
            if (vscode.workspace.workspaceFolders) {
                try {
                    const cwd = vscode.workspace.workspaceFolders[0].uri.fsPath;
                    // Timeout helper to prevent "Git Black Hole"
                    const runGit = (cmd: string) => {
                        return Promise.race([
                            execAsync(cmd, { cwd }),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 500))
                        ]) as Promise<{ stdout: string }>;
                    };

                    const { stdout: branchName } = await runGit('git rev-parse --abbrev-ref HEAD');
                    const { stdout: commitHash } = await runGit('git rev-parse HEAD');
                    branch = branchName.trim();
                    commit = commitHash.trim();
                } catch (e) {
                    // Git failed or timed out - ignore and save without metadata
                }
            }

            const snapshot: Snapshot = {
                id: `${timestamp}-${Math.random().toString(36).substring(7)}`,
                vector: embedding,
                path: relativePath,
                content: content,
                timestamp: timestamp,
                lines: document.lineCount,
                branch,
                commit
            };

            await table.add([snapshot]);
            console.log(`[Photographer] Snapshot taken: ${relativePath} (${timestamp})`);

        } catch (e) {
            console.error('[Photographer] Failed to take snapshot:', e);
        }
    }

    private async getTable() {
        // Create table if not exists
        try {
            return await this.db.openTable('snapshots');
        } catch (e) {
            // Table doesn't exist, create it
            // Helper to get dummy data for schema inference
            const dummy: Snapshot = {
                id: 'init',
                vector: new Array(384).fill(0), // Assuming 384 dim model
                path: 'init',
                content: 'init',
                timestamp: 0,
                lines: 0,
                branch: 'init',
                commit: 'init'
            };
            return await this.db.createTable('snapshots', [dummy]);
        }
    }

    public async searchTimeStream(query: string): Promise<Snapshot[]> {
        if (!this.db) return [];

        try {
            const embedding = await EmbeddingService.getInstance().getEmbedding(query);
            const table = await this.getTable();

            // Search vector space
            const results = await table.search(embedding)
                .limit(5)
                .execute();

            return results as Snapshot[];
        } catch (e) {
            console.error('[Photographer] Search failed:', e);
            return [];
        }
    }
}
