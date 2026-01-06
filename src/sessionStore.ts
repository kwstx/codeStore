import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { VibeSession, PromptVersion, ToolName } from './types';
import { EmbeddingService } from './embeddings';
import { VectorStore } from './vectorStore';

export class SessionStore {
    private static instance: SessionStore;
    private sessions: Map<string, VibeSession> = new Map();
    private storagePath: string | null = null;
    public activeSessionId: string | null = null;
    private vectorStore: VectorStore;

    private constructor() {
        this.vectorStore = new VectorStore();
    }

    public static getInstance(): SessionStore {
        if (!SessionStore.instance) {
            SessionStore.instance = new SessionStore();
        }
        return SessionStore.instance;
    }

    public init(storagePath: string): void {
        this.storagePath = storagePath;
        if (!fs.existsSync(storagePath)) {
            fs.mkdirSync(storagePath, { recursive: true });
        }
    }

    private getFilePath(sessionId: string): string {
        if (!this.storagePath) {
            throw new Error('SessionStore not initialized with storage path');
        }
        // Deterministic naming: simple ID based
        return path.join(this.storagePath, `${sessionId}.json`);
    }

    private async saveSession(session: VibeSession): Promise<void> {
        if (!this.storagePath) return; // In-memory only if not initialized

        try {
            const filePath = this.getFilePath(session.id);
            await fs.promises.writeFile(filePath, JSON.stringify(session, null, 2), 'utf8');
        } catch (error) {
            console.error(`Failed to save session ${session.id}:`, error);
        }
    }

    public async createSession(workspaceId: string, tool: ToolName): Promise<VibeSession> {
        const id = uuidv4();
        const session: VibeSession = {
            id,
            workspaceId,
            tool,
            timestamp: Date.now(),
            status: 'unknown',
            prompts: []
        };
        this.sessions.set(id, session);
        this.activeSessionId = id;
        await this.saveSession(session);
        return session;
    }

    public getSession(id: string): VibeSession | undefined {
        return this.sessions.get(id);
        // TODO: Load from disk if not in memory? 
        // For now, we assume active sessions are in memory.
    }

    // Returns a warning message if similar to a failed prompt
    public async addPrompt(sessionId: string, content: string): Promise<string | null> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        const hash = crypto.createHash('sha256').update(content).digest('hex');

        // Step 4: Version the Prompt (De-duplication in current session)
        if (session.prompts.length > 0) {
            const lastPrompt = session.prompts[session.prompts.length - 1];
            if (lastPrompt.hash === hash) {
                return null;
            }
        }

        // Step 10 checks
        let warning: string | null = null;
        try {
            const embedding = await EmbeddingService.getInstance().getEmbedding(content);
            const similar = await this.vectorStore.searchVibePrompts(embedding, 3);

            // Check for failed prompts in results
            const failedMatch = similar.find((p: any) => p.status === 'failed' && p.sessionId !== session.id);

            if (failedMatch) {
                warning = `Warning: This prompt is similar to a previous failed attempt (Session ${failedMatch.sessionId.substring(0, 8)}).`;
            }

            // Save this new prompt to VectorStore for future checks
            // We save it asynchronously so we don't block too much, but for tracking we might want to await.
            await this.vectorStore.saveVibePrompt(embedding, {
                id: uuidv4(),
                content,
                sessionId: session.id,
                status: session.status
            });

        } catch (e) {
            console.error("Error in similarity check:", e);
        }

        const newVersion: PromptVersion = {
            id: uuidv4(),
            content,
            hash,
            timestamp: Date.now()
        };

        session.prompts.push(newVersion);
        await this.saveSession(session);

        return warning;
    }

    public getPromptDiff(sessionId: string, versionId: string): any[] | null {
        const session = this.sessions.get(sessionId);
        if (!session) return null;

        const currentDict = session.prompts.find((p: any) => p.id === versionId);
        if (!currentDict) return null;

        const index = session.prompts.indexOf(currentDict);
        if (index <= 0) return null; // No previous version

        const previousDict = session.prompts[index - 1];

        // Compute Diff
        const Diff = require('diff');
        const changes = Diff.diffChars(previousDict.content, currentDict.content);
        return changes;
    }

    public async updateSessionStatus(sessionId: string, status: 'success' | 'failed' | 'unknown'): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.status = status;
            await this.saveSession(session);
        }
    }

    public getLastPromptInfo(): { sessionId: string, timestamp: number } | undefined {
        if (!this.activeSessionId) return undefined;
        const session = this.sessions.get(this.activeSessionId);
        if (!session || session.prompts.length === 0) return undefined;

        const lastPrompt = session.prompts[session.prompts.length - 1];
        return {
            sessionId: session.id,
            timestamp: lastPrompt.timestamp
        };
    }
}
