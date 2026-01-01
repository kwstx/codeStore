import * as vscode from 'vscode';

export class ExclusionManager {
    private static instance: ExclusionManager;
    private context: vscode.ExtensionContext | null = null;
    private readonly STORAGE_KEY = 'patternVault.excludedPaths';

    private constructor() { }

    public static getInstance(): ExclusionManager {
        if (!ExclusionManager.instance) {
            ExclusionManager.instance = new ExclusionManager();
        }
        return ExclusionManager.instance;
    }

    public setContext(context: vscode.ExtensionContext) {
        this.context = context;
    }

    public getExcludedPaths(): string[] {
        if (!this.context) return [];
        return this.context.globalState.get<string[]>(this.STORAGE_KEY) || [];
    }

    public async excludePath(filePath: string): Promise<void> {
        if (!this.context) return;
        const current = this.getExcludedPaths();
        if (!current.includes(filePath)) {
            current.push(filePath);
            await this.context.globalState.update(this.STORAGE_KEY, current);
        }
    }

    public async unexcludePath(filePath: string): Promise<void> {
        if (!this.context) return;
        const current = this.getExcludedPaths();
        const updated = current.filter(p => p !== filePath);
        await this.context.globalState.update(this.STORAGE_KEY, updated);
    }

    private readonly DEFAULT_IGNORES = [
        'node_modules',
        '.git',
        '.venv',
        'dist',
        'build',
        'out',
        'target',
        '.DS_Store',
        'coverage',
        '.vscode',
        '.idea',
        'package-lock.json',
        'yarn.lock',
        'pnpm-lock.yaml'
    ];

    public isExcluded(filePath: string): boolean {
        // 1. Check Default Ignores
        // Simple string matching for directories in path
        const parts = filePath.split(/[/\\]/);
        if (this.DEFAULT_IGNORES.some(ignored => parts.includes(ignored))) {
            return true;
        }

        // 2. Check User Exclusions
        const excluded = this.getExcludedPaths();
        // Exact match or folder match (simple)
        return excluded.some(p => filePath === p || filePath.startsWith(p + '/')); // Simple folder check
    }
}
