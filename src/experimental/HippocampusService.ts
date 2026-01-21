
import * as vscode from 'vscode';
import { LabsController } from './LabsController';
import { OllamaService } from '../llm';

export class HippocampusService {
    private static instance: HippocampusService;
    private episodeTimer: NodeJS.Timeout | null = null;
    private currentSessionFiles: Set<string> = new Set();
    private readonly EPISODE_TIMEOUT = 5 * 60 * 1000; // 5 Minutes

    private constructor() { }

    public static getInstance(): HippocampusService {
        if (!HippocampusService.instance) {
            HippocampusService.instance = new HippocampusService();
        }
        return HippocampusService.instance;
    }

    public initialize(context: vscode.ExtensionContext) {
        if (!LabsController.getInstance().isHippocampusEnabled()) {
            return;
        }

        console.log('[Hippocampus] Episodic Memory Active 🧠');

        // Listen for activity
        context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument(this.onActivity, this),
            vscode.workspace.onDidOpenTextDocument(this.onActivity, this)
            // We focus on saves mainly, but opening is a sign of life.
            // Actually, let's stick to SAVE for now as a strong signal of "Work".
        );
    }

    private onActivity(document: vscode.TextDocument) {
        if (!LabsController.getInstance().isHippocampusEnabled()) return;

        // Track unique file
        this.currentSessionFiles.add(vscode.workspace.asRelativePath(document.uri));

        // Reset Timer
        if (this.episodeTimer) {
            clearTimeout(this.episodeTimer);
        }

        // Start countdown to "Sleep Mode" (Consolidation)
        this.episodeTimer = setTimeout(() => {
            this.consolidateMemory();
        }, this.EPISODE_TIMEOUT);
    }

    private async consolidateMemory() {
        if (this.currentSessionFiles.size === 0) return;

        const files = Array.from(this.currentSessionFiles).join(', ');
        console.log(`[Hippocampus] Consolidating episode. Modified: ${files}`);

        try {
            // Ask LLM to summarize based on file names (Lightweight for now)
            // Future V2: Read the diffs.
            const prompt = `I just finished a coding session where I modified these files: ${files}. 
            Generate a single sentence log entry summarizing what kind of work this likely was (e.g. "Refactored UI components" or "Fixed backend API"). 
            Do not mention specific filenames unless critical. Keep it under 20 words.
            Log Entry:`;

            // We borrow the LLM service (assuming it exposes a method or we add one)
            // Ideally we use a public method or the 'summarize' one.
            // Let's use 'abstractPattern' as a proxy or just raw call if we can access it?
            // Since OllamaService.callLlm is private, we'll try to use 'intent' or just mimic it.
            // Actually, looking at llm.ts, 'inferIntent' is public and takes code.
            // A better way is to add a generic 'ask' method or use what we have.
            // Let's rely on 'inferIntent' but repurpose the prompt inside it? No, that's hacky.
            // I'll add a helper to OllamaService if needed, but for now I'll hack it nicely:
            // "inferIntent" takes code and returns a prompt.
            // I will implement a raw fetch here to keep it isolated/experimental.

            const summary = await this.generateSummary(files);

            await this.writeJournal(summary, files);

        } catch (e) {
            console.error('[Hippocampus] Failed to consolidate:', e);
        }

        // Reset
        this.currentSessionFiles.clear();
        this.episodeTimer = null;
    }

    private async generateSummary(fileList: string): Promise<string> {
        try {
            const prompt = `System: You are a developer's logbook.
User: I modified: ${fileList}. Summarize this session in 1 short sentence (max 15 words).
Log:`;

            // Raw fetch to Ollama (hardcoded for beta isolation)
            const response = await fetch('http://localhost:11434/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'qwen2.5-coder:1.5b', // Fast model
                    prompt: prompt,
                    stream: false
                })
            });

            if (response.ok) {
                const data = await response.json() as { response: string };
                return data.response.trim().replace(/^"/, '').replace(/"$/, '');
            }
        } catch (e) {
            return `Worked on ${fileList}`; // Fallback
        }
        return `Modified ${fileList}`;
    }

    private async writeJournal(summary: string, files: string) {
        if (!vscode.workspace.workspaceFolders) return;

        const root = vscode.workspace.workspaceFolders[0].uri;
        const journalUri = vscode.Uri.joinPath(root, '.engram', 'memory_journal.md');

        const entry = `\n- **${new Date().toLocaleString()}**: ${summary} \n  <span style="opacity:0.5; font-size:0.8em">Files: ${files}</span>\n`;

        try {
            // Read existing or create
            let content = '# Engram Episodic Memory\n\n';
            try {
                const existing = await vscode.workspace.fs.readFile(journalUri);
                content = new TextDecoder().decode(existing);
            } catch (e) {
                // Must be new
                await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root, '.engram'));
            }

            // Append
            const newContent = content + entry;
            await vscode.workspace.fs.writeFile(journalUri, new TextEncoder().encode(newContent));

            // Notify specific user (me)
            // vscode.window.setStatusBarMessage(`[Hippocampus] Episode logged: ${summary}`, 5000);

        } catch (e) {
            console.error('[Hippocampus] Disk Write Error:', e);
        }
    }
}
