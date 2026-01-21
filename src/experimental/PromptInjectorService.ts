
import * as vscode from 'vscode';
import { MistakeDetector } from '../mistakeDetector';

export class PromptInjectorService {
    private static instance: PromptInjectorService;
    private disposable: vscode.Disposable | undefined;
    private isGenerating: boolean = false; // LOCK: Prevent Machine Gun

    private constructor() { }

    public static getInstance(): PromptInjectorService {
        if (!PromptInjectorService.instance) {
            PromptInjectorService.instance = new PromptInjectorService();
        }
        return PromptInjectorService.instance;
    }

    public initialize(context: vscode.ExtensionContext) {
        this.disposable = vscode.workspace.onDidChangeTextDocument(async (e) => {
            if (this.isGenerating) return; // Ignore input while generating

            if (e.contentChanges.length === 0) return;

            const change = e.contentChanges[0];
            const text = change.text;

            // Trigger: User types '?' and the character before it was '?'
            if (text === '?') {
                const editor = vscode.window.activeTextEditor;
                if (!editor || editor.document !== e.document) return;

                const position = change.range.start;
                // Avoid out of bounds
                if (position.character < 1) return;

                const rangeBefore = new vscode.Range(position.translate(0, -1), position);
                const charBefore = editor.document.getText(rangeBefore);

                if (charBefore === '?') {
                    // Double Question Mark Detected!
                    await this.triggerInjection(editor, position);
                }
            }
        });

        context.subscriptions.push(this.disposable);
    }

    private async triggerInjection(editor: vscode.TextEditor, position: vscode.Position) {
        if (this.isGenerating) return; // Double check lock
        this.isGenerating = true;

        // 1. Show Feedback
        vscode.window.setStatusBarMessage("$(hubot) Generating Context-Aware Prompt...", 3000);

        try {
            // 2. Gather Context
            const mistakeDetector = MistakeDetector.getInstance();
            const mistakes = mistakeDetector.getAllFingerprints().filter(fp => !fp.ignored);

            // Get last 50 lines of code
            const startLine = Math.max(0, position.line - 50);
            const codeContext = editor.document.getText(new vscode.Range(startLine, 0, position.line, position.character));

            // Format Mistakes for LLM
            const mistakeContext = mistakes.map(m => `- Avoid Pattern: ${m.pattern} (Seen ${m.count} times)`).join('\n');

            // 3. Construct Prompt for the LLM
            const llmPrompt = `
            You are an expert developer assistant. The user is stuck and needs a prompt to give to another AI (like ChatGPT/Cursor).
            
            GOAL: Write a precise, high-context prompt that the user can paste into an AI tool to solve their current problem.
            
            CONTEXT (Code):
            \`\`\`
            ${codeContext}
            \`\`\`

            CONTEXT (Known User Pitfalls - DO NOT REPEAT THESE):
            ${mistakeContext}

            INSTRUCTIONS:
            1. Write a single-paragraph prompt.
            2. Briefly describe the code context.
            3. Explicitly mention any relevant constraints or patterns to avoid based on the user's history.
            4. Ask for a solution.
            5. DO NOT include "Here is a prompt" or quotes. Just output the prompt text itself.
            `;

            // 4. Call LLM (Ollama) with Timeout (Fix "Zombie")
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s Timeout

            try {
                const response = await fetch('http://localhost:11434/api/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: 'qwen2.5:0.5b',
                        prompt: llmPrompt,
                        stream: false,
                        options: {
                            num_predict: 200,
                            temperature: 0.7
                        }
                    }),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (response.ok) {
                    const data = await response.json() as { response: string };
                    const generatedPrompt = data.response.trim();

                    // 5. Inject to Clipboard
                    await vscode.env.clipboard.writeText(generatedPrompt);

                    // 6. Notify
                    vscode.window.showInformationMessage("📋 Optimized Prompt Copied! Paste it into your AI agent.");

                    // Optional: Remove the '??' trigger
                    const rangeToDelete = new vscode.Range(position.translate(0, -1), position.translate(0, 1));
                    await editor.edit(editBuilder => {
                        editBuilder.delete(rangeToDelete);
                    });

                } else {
                    vscode.window.setStatusBarMessage("$(error) Failed to generate prompt.", 3000);
                }
            } catch (fetchError: any) {
                clearTimeout(timeoutId);
                if (fetchError.name === 'AbortError') {
                    vscode.window.setStatusBarMessage("$(clock) Prompt Generation Timed Out.", 3000);
                } else {
                    throw fetchError;
                }
            }
        } catch (e) {
            console.error("Prompt Injector Failed:", e);
            vscode.window.setStatusBarMessage("$(error) Prompt Injector Error", 3000);
        } finally {
            this.isGenerating = false; // RELEASE LOCK
        }
    }

    public dispose() {
        if (this.disposable) {
            this.disposable.dispose();
        }
    }
}
