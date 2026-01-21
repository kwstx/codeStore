
import * as vscode from 'vscode';
import * as path from 'path';
import { LabsController } from './LabsController';

export class ArchitectService {
    private static instance: ArchitectService;

    private constructor() { }

    public static getInstance(): ArchitectService {
        if (!ArchitectService.instance) {
            ArchitectService.instance = new ArchitectService();
        }
        return ArchitectService.instance;
    }

    public async generatePlan() {
        if (!LabsController.getInstance().isArchitectEnabled()) {
            vscode.window.showWarningMessage("The Architect is sleeping. (Feature Disabled)");
            return;
        }

        // 1. Get User Goal
        const goal = await vscode.window.showInputBox({
            prompt: "What do you want to build?",
            placeHolder: "e.g. Add 2FA to the login flow"
        });

        if (!goal) return;

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "The Architect is thinking...",
            cancellable: false
        }, async (progress) => {
            progress.report({ message: "Scanning Dependency Graph..." });

            // 2. Build Dependency Graph
            const graph = await this.buildDependencyGraph();
            const graphStr = this.formatGraph(graph);

            progress.report({ message: "Drafting Blueprint..." });

            // 3. Ask LLM
            const plan = await this.askArchitect(goal, graphStr);

            // 4. Present Plan
            await this.showPlan(plan);
        });
    }

    private async buildDependencyGraph(): Promise<Map<string, string[]>> {
        const graph = new Map<string, string[]>();
        const files = await vscode.workspace.findFiles('src/**/*.{ts,js,tsx,jsx}', '**/node_modules/**');

        for (const file of files) {
            const content = (await vscode.workspace.fs.readFile(file)).toString();
            const imports = this.parseImports(content);
            const relativePath = vscode.workspace.asRelativePath(file);

            // basic cleanup
            graph.set(relativePath, imports);
        }
        return graph;
    }

    private parseImports(content: string): string[] {
        const imports: string[] = [];
        const regex = /import\s+.*?\s+from\s+['"](.+?)['"]/g;
        let match;
        while ((match = regex.exec(content)) !== null) {
            imports.push(match[1]);
        }
        return imports;
    }

    private formatGraph(graph: Map<string, string[]>): string {
        let output = "Dependency Graph:\n";
        graph.forEach((deps, file) => {
            if (deps.length > 0) {
                output += `${file} depends on: ${deps.join(', ')}\n`;
            }
        });
        return output;
    }

    private async askArchitect(goal: string, graph: string): Promise<string> {
        const prompt = `Goal: ${goal}
        
        Context: You are a System Architect.
        I need an Implementation Plan to achieve this goal without breaking the existing architecture.
        
        ${graph.substring(0, 2000)} ... (truncated if too large)
        
        Output Format:
        # Implementation Plan
        - [ ] Step 1 (File)
        - [ ] Step 2 (File)
        ...
        ## Risk Analysis
        ...
        `;

        try {
            const response = await fetch('http://localhost:11434/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'qwen2.5-coder:1.5b',
                    prompt: prompt,
                    stream: false
                })
            });

            if (response.ok) {
                const data = await response.json() as { response: string };
                return data.response;
            }
        } catch (e) {
            return "# Plan Generation Failed\nCould not connect to Architect (Ollama).";
        }
        return "";
    }

    private async showPlan(plan: string) {
        const doc = await vscode.workspace.openTextDocument({
            content: plan,
            language: 'markdown'
        });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
    }
}
