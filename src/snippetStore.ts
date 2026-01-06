import * as fs from 'fs';
import * as path from 'path';
import { CodeSnippet } from './types';

export class SnippetStore {
    private static instance: SnippetStore;
    private snippets: Map<string, CodeSnippet> = new Map();
    private storagePath: string | null = null;
    private initialized: boolean = false;

    private constructor() { }

    public static getInstance(): SnippetStore {
        if (!SnippetStore.instance) {
            SnippetStore.instance = new SnippetStore();
        }
        return SnippetStore.instance;
    }

    public init(storagePath: string) {
        if (this.initialized) return;
        this.storagePath = storagePath;
        if (!fs.existsSync(storagePath)) {
            fs.mkdirSync(storagePath, { recursive: true });
        }
        this.loadSnippets();
        this.initialized = true;
    }

    private getFilePath(): string {
        if (!this.storagePath) throw new Error("Storage path not initialized");
        return path.join(this.storagePath, 'snippets.json');
    }

    private async loadSnippets() {
        try {
            const filePath = this.getFilePath();
            if (fs.existsSync(filePath)) {
                const data = await fs.promises.readFile(filePath, 'utf8');
                const list = JSON.parse(data) as CodeSnippet[];
                list.forEach(s => this.snippets.set(s.id, s));
                console.log(`[SnippetStore] Loaded ${list.length} snippets.`);
            }
        } catch (e) {
            console.error("[SnippetStore] Failed to load snippets:", e);
        }
    }

    private async saveSnippets() {
        if (!this.storagePath) return;
        try {
            const list = Array.from(this.snippets.values());
            await fs.promises.writeFile(this.getFilePath(), JSON.stringify(list, null, 2), 'utf8');
        } catch (e) {
            console.error("[SnippetStore] Failed to save snippets:", e);
        }
    }

    public async saveSnippet(snippet: CodeSnippet): Promise<void> {
        // If exists, update usage?
        if (this.snippets.has(snippet.id)) {
            const existing = this.snippets.get(snippet.id)!;
            existing.useCount++;
            existing.timestamp = Date.now(); // Update last seen
        } else {
            this.snippets.set(snippet.id, snippet);
        }
        await this.saveSnippets();
    }

    public getSnippet(id: string): CodeSnippet | undefined {
        return this.snippets.get(id);
    }

    public findSnippet(normalizedContent: string): CodeSnippet | undefined {
        // Since ID is the SHA256 of normalized content, we can just hash and lookup.
        // This is O(1) "Similarity" search based on our normalization rules.
        const crypto = require('crypto');
        const hash = crypto.createHash('sha256').update(normalizedContent).digest('hex');
        return this.snippets.get(hash);
    }

    public getAllSnippets(): CodeSnippet[] {
        return Array.from(this.snippets.values());
    }
}
