import * as vscode from 'vscode';

export class PasteDetector {
    private static instance: PasteDetector;
    private disposables: vscode.Disposable[] = [];

    // Event to notify when a paste is detected
    private _onPasteDetected = new vscode.EventEmitter<{ text: string, normalized: string, document: vscode.TextDocument, range: vscode.Range }>();
    public readonly onPasteDetected = this._onPasteDetected.event;

    private constructor() { }

    public static getInstance(): PasteDetector {
        if (!PasteDetector.instance) {
            PasteDetector.instance = new PasteDetector();
        }
        return PasteDetector.instance;
    }

    public startListening(context: vscode.ExtensionContext) {
        const changeDisposable = vscode.workspace.onDidChangeTextDocument(e => this.handleDocumentChange(e));
        context.subscriptions.push(changeDisposable);
        this.disposables.push(changeDisposable);
        console.log('[PasteDetector] Started listening for paste events.');
    }

    private handleDocumentChange(event: vscode.TextDocumentChangeEvent) {
        if (event.contentChanges.length === 0) return;

        // Analyze changes
        for (const change of event.contentChanges) {
            const text = change.text;

            // Heuristic for "Paste":
            // 1. Length > 50 chars OR
            // 2. Contains newline characters (multi-line)
            const isMultiLine = text.includes('\n') || text.includes('\r');
            const isLargeBlock = text.length > 50;

            if (isMultiLine || isLargeBlock) {
                // Ignore deletions (empty text)
                if (text.length > 0) {
                    const normalized = this.normalizeCode(text);

                    // Debug logging (optional)
                    // console.log(`[PasteDetector] Detected paste. Len: ${text.length}, Norm: ${normalized.length}`);

                    this._onPasteDetected.fire({
                        text: text,
                        normalized: normalized,
                        document: event.document,
                        range: change.range
                    });
                }
            }
        }
    }

    public normalizeCode(code: string): string {
        // 1. Remove comments
        // Simple regex for JS/TS style comments
        // Captures: /* multi-line */ OR // single-line
        let cleaned = code.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1');

        // 2. Collapse whitespace
        // Replace all whitespace sequences (newlines, tabs, spaces) with a single space
        cleaned = cleaned.replace(/\s+/g, ' ').trim();

        // 3. Normalize Variable Names (Basic Structural)
        // Without a full parser, we can't safely rename variables.
        // However, stripping comments and aggressive whitespace collapsing
        // creates a "structural" representation that is often enough for fuzzy matching.

        return cleaned;
    }

    public dispose() {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}
