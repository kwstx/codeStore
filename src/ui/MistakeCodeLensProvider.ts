import * as vscode from 'vscode';
import { MistakeDetector } from '../mistakeDetector';

export class MistakeCodeLensProvider implements vscode.CodeLensProvider {
    private detector: MistakeDetector;
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    constructor() {
        this.detector = MistakeDetector.getInstance();

        // Refresh lenses when mistakes are repeated or updated
        this.detector.onMistakeRepeated(() => {
            this._onDidChangeCodeLenses.fire();
        });

        // Also refresh on diagnostics change? 
        // CodeLens provider usually called on document change, but we might want to trigger if detection updates active counts.
        vscode.languages.onDidChangeDiagnostics(() => {
            this._onDidChangeCodeLenses.fire();
        });
    }

    public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
        const lenses: vscode.CodeLens[] = [];

        // Get diagnostics for this document
        const diagnostics = vscode.languages.getDiagnostics(document.uri);
        const errors = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error);

        for (const error of errors) {
            const { hash } = this.detector.fingerprintError(error);
            const fingerprint = this.detector.getFingerprint(hash);

            if (fingerprint && fingerprint.count > 1 && !fingerprint.ignored) {
                // Determine Title
                let title = `⚠️ Recurring Mistake (Seen ${fingerprint.count} times)`;
                let tooltip = "This error has occurred frequently.";

                if (fingerprint.fixes && fingerprint.fixes.length > 0) {
                    title = `⚡ Fix Available (Seen ${fingerprint.count} times)`;
                    tooltip = "Click to view how you fixed this before.";
                }

                const cmd: vscode.Command = {
                    title: title,
                    tooltip: tooltip,
                    command: 'engram.viewMistakeFix',
                    arguments: [fingerprint.id]
                };

                lenses.push(new vscode.CodeLens(error.range, cmd));
            }
        }

        return lenses;
    }
}
