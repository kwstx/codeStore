import * as vscode from 'vscode';
import { LabsController } from './experimental/LabsController';


export class OllamaService {
    private static instance: OllamaService;
    private endpoint: string;
    private model: string;

    private constructor() {
        // Defaults
        this.endpoint = 'http://localhost:11434';
        this.model = 'qwen2.5-coder:1.5b';

        this.reloadConfig();
    }

    public static getInstance(): OllamaService {
        if (!OllamaService.instance) {
            OllamaService.instance = new OllamaService();
        }
        return OllamaService.instance;
    }

    public reloadConfig() {
        const config = vscode.workspace.getConfiguration('patternVault');
        this.endpoint = config.get<string>('llmEndpoint') || 'http://localhost:11434';
        this.model = config.get<string>('llmModel') || 'qwen2.5-coder:1.5b';
    }

    private async callLlm(prompt: string, timeout: number = 2000): Promise<string> {
        try {



            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            const response = await fetch(`${this.endpoint}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    prompt: prompt,
                    stream: false
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                return "";
            }

            const data = await response.json() as { response: string };
            let result = data.response.trim();



            return result;

        } catch (error) {
            // fail silently as per requirements
            return "";
        }
    }

    public async summarize(code: string): Promise<string> {
        return this.callLlm(`Summarize this code in one or two sentences. Focus on what it does and the problem it solves. Do not explain the syntax.\nCode:\n${code.substring(0, 1000)}\nSummary:`);
    }

    public async abstractPattern(code: string): Promise<string> {
        return this.callLlm(`Summarize the core problem this code solves in one sentence. Do not mention variable names or specific implementation details. Response must be a single sentence:\n${code.substring(0, 1000)}`);
    }

    public async inferIntent(code: string): Promise<string> {
        try {
            const prompt = `Analyze this code and infer the likely prompt or question that generated it. 
            Return ONLY the inferred prompt.
            
            Code:
            ${code.substring(0, 1500)}
            
            Likely User Prompt:`;

            const controller = new AbortController();
            // Longer timeout for "thoughtful" inference, but still background
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(`${this.endpoint}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    prompt: prompt,
                    stream: false
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                return "";
            }

            const data = await response.json() as { response: string };
            return data.response.trim().replace(/^["']|["']$/g, ''); // Clean quotes

        } catch (error) {
            return ""; // Best effort: return empty if failed
        }
    }
}
