
import * as vscode from 'vscode';
import { LabsController } from './LabsController';
import { OllamaService } from '../llm';

export class ShadowIntuition implements vscode.InlineCompletionItemProvider {
    private static instance: ShadowIntuition;
    private lastBroadcastContent: string | null = null; // Caching for deduplication

    // Dynamic Physics (Defaults)
    private readonly DEBOUNCE_TIME = 1200;

    private constructor() { }

    public static getInstance(): ShadowIntuition {
        if (!ShadowIntuition.instance) {
            ShadowIntuition.instance = new ShadowIntuition();
        }
        return ShadowIntuition.instance;
    }

    // Register the provider
    public startListening(context: vscode.ExtensionContext) {
        const provider = vscode.languages.registerInlineCompletionItemProvider(
            { pattern: '**' }, // All files
            this
        );
        context.subscriptions.push(provider);
    }

    // Native API Method
    public async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | null> {

        // 1. Feature Flag Check
        if (!LabsController.getInstance().isPredictiveIntuitionEnabled()) {
            return null;
        }

        // 2. Debounce (Implicitly handled by VS Code's request cadence, but we want a hard delay)
        // VS Code calls this frequently. We need to pause.
        // Actually, inline providers are usually "pull" based. 
        // To strictly enforce "Wait for silence", we might need a small delay loop here
        // checking token.isCancellationRequested.

        // Wait 1.2s (or configured time) to verify user stopped typing (Dynamic Physics)
        const delay = LabsController.getInstance().getIntuitionDelay();
        await new Promise(resolve => setTimeout(resolve, delay));
        if (token.isCancellationRequested) return null;


        // 3. FIM Context Gathering (Change 2)
        const offset = document.offsetAt(position);
        const text = document.getText();

        // Prefix: Last 2000 chars
        const start = Math.max(0, offset - 2000);
        const prefix = text.substring(start, offset);

        // Suffix: Next 1000 chars (to prevent duplicating closing brackets etc)
        const end = Math.min(text.length, offset + 1000);
        const suffix = text.substring(offset, end);

        // 4. Prompt Director (Change 4)
        // Check for empty line or comment
        const lineText = document.lineAt(position.line).text.trim();
        const isComment = lineText.startsWith('//');
        const isEmpty = lineText === '';

        let isDirecting = false;
        if (isEmpty || isComment) {
            // Chance to trigger "Director Mode"
            // We'll let the prompt decide.
            isDirecting = true;
        }

        // 5. Construct Prompt
        // We use a pseudo-FIM prompt for the generic model
        let prompt = `You are a code completion engine.
        Goal: Complete the code at the cursor (between PREFIX and SUFFIX).
        Rules:
        1. Output ONLY the code to insert.
        2. Do NOT repeat the suffix.
        3. Do NOT output markdown.
        ${isDirecting ? '4. If the context implies a new task (e.g. empty line or comment), you may suggest a natural language prompt starting with "✨ Ask AI: ".' : ''}
        
        PREFIX:
        ${prefix}

        SUFFIX:
        ${suffix}
        `;

        try {
            // Call LLM
            const response = await fetch('http://localhost:11434/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'qwen2.5:0.5b',
                    prompt: prompt,
                    stream: false,
                    options: {
                        num_predict: 50,
                        temperature: 0.1,
                        stop: ["SUFFIX:", "<|endoftext|>"]
                    }
                })
            });

            if (token.isCancellationRequested) return null;

            if (response.ok) {
                const data = await response.json() as { response: string };
                let prediction = data.response.trim();

                // Cleanup
                prediction = prediction.replace(/```typescript/g, '').replace(/```/g, '').trim();

                if (prediction) {
                    // Telepathy Broadcast
                    this.broadcastPrediction(document, prediction);

                    // Return native item
                    return [new vscode.InlineCompletionItem(prediction, new vscode.Range(position, position))];
                }
            }
        } catch (e) {
            console.error("Intuition failed:", e);
        }

        this.clearBroadcast();
        return null;
    }

    private async broadcastPrediction(document: vscode.TextDocument, prediction: string) {
        if (!vscode.workspace.workspaceFolders) return;

        try {
            const root = vscode.workspace.workspaceFolders[0].uri;
            const engramDir = vscode.Uri.joinPath(root, '.engram');
            const intuitionFile = vscode.Uri.joinPath(engramDir, 'intuition.md');

            const content = `# Engram Psychic Link
> **Timestamp:** ${new Date().toISOString()}
> **File:** ${vscode.workspace.asRelativePath(document.uri)}
> **State:** 🔮 PREDICTING
> **Stop Me:** Ask your AI agent to set \`"engram.experimental.predictiveIntuition": false\` in .vscode/settings.json

## Prediction
\`\`\`typescript
${prediction}
\`\`\`
`;
            if (this.lastBroadcastContent === content) return;
            this.lastBroadcastContent = content;

            await vscode.workspace.fs.createDirectory(engramDir);
            await vscode.workspace.fs.writeFile(intuitionFile, new TextEncoder().encode(content));
        } catch (e) {
            console.error("[ShadowIntuition] Broadcast failed:", e);
        }
    }

    private async clearBroadcast() {
        if (!vscode.workspace.workspaceFolders) return;
        if (this.lastBroadcastContent === 'IDLE') return;

        try {
            const root = vscode.workspace.workspaceFolders[0].uri;
            const intuitionFile = vscode.Uri.joinPath(root, '.engram', 'intuition.md');
            const content = `# Engram Psychic Link
> **Timestamp:** ${new Date().toISOString()}
> **State:** 💤 IDLE
> **Stop Me:** Ask your AI agent to set \`"engram.experimental.predictiveIntuition": false\` in .vscode/settings.json
`;
            this.lastBroadcastContent = 'IDLE';
            await vscode.workspace.fs.writeFile(intuitionFile, new TextEncoder().encode(content));
        } catch (e) { }
    }
}
