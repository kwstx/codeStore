import * as vscode from 'vscode';
import { MistakeDetector } from './mistakeDetector';
import { MistakeFingerprint } from './types';
import * as path from 'path';
import { minimatch } from 'minimatch';

export class ShadowScanner {
    private static instance: ShadowScanner;
    private diagnosticCollection: vscode.DiagnosticCollection;
    private timeout: NodeJS.Timeout | undefined = undefined;

    private constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('engram-shadow');
    }

    public static getInstance(): ShadowScanner {
        if (!ShadowScanner.instance) {
            ShadowScanner.instance = new ShadowScanner();
        }
        return ShadowScanner.instance;
    }

    public startListening(context: vscode.ExtensionContext) {
        context.subscriptions.push(this.diagnosticCollection);

        vscode.workspace.onDidChangeTextDocument(e => {
            this.triggerScan(e.document);
        }, null, context.subscriptions);

        vscode.workspace.onDidOpenTextDocument(doc => {
            this.triggerScan(doc);
        }, null, context.subscriptions);

        if (vscode.window.activeTextEditor) {
            this.triggerScan(vscode.window.activeTextEditor.document);
        }
    }

    private triggerScan(document: vscode.TextDocument) {
        if (this.timeout) {
            clearTimeout(this.timeout);
        }
        this.timeout = setTimeout(() => {
            this.scanDocument(document);
        }, 500); // Debounce 500ms
    }

    private scanDocument(document: vscode.TextDocument) {
        if (document.uri.scheme !== 'file') return;

        const detector = MistakeDetector.getInstance();
        const fingerprints = detector.getAllFingerprints();
        const diagnostics: vscode.Diagnostic[] = [];
        const text = document.getText();

        for (const fp of fingerprints) {
            if (!fp.enforcementLevel || fp.enforcementLevel === 'silent') continue;
            if (fp.ignored) continue;
            // Exclusion check
            if (fp.ignoredScopes && this.isIgnoredScope(document.fileName, fp.ignoredScopes)) continue;

            let regex: RegExp | null = null;
            try {
                // If it looks like a regex /.../
                if (fp.pattern.startsWith('/') && fp.pattern.lastIndexOf('/') > 0) {
                    const lastSlash = fp.pattern.lastIndexOf('/');
                    const flags = fp.pattern.substring(lastSlash + 1);
                    const source = fp.pattern.substring(1, lastSlash);
                    regex = new RegExp(source, flags.includes('g') ? flags : flags + 'g');
                } else if (fp.detectionMethod === 'regex') {
                    // Treat as string literal or simple regex
                    regex = new RegExp(this.escapeRegExp(fp.pattern), 'g');
                }
            } catch (e) {
                // Invalid regex, skip
                continue;
            }

            if (regex) {
                let match;
                while ((match = regex.exec(text)) !== null) {
                    const startPos = document.positionAt(match.index);
                    const endPos = document.positionAt(match.index + match[0].length);
                    const range = new vscode.Range(startPos, endPos);

                    const severity = fp.enforcementLevel === 'error'
                        ? vscode.DiagnosticSeverity.Error
                        : vscode.DiagnosticSeverity.Information;

                    const message = `[Engram Shadow] Bad Pattern: ${fp.pattern}`;
                    const diagnostic = new vscode.Diagnostic(range, message, severity);

                    // Attach metadata for Code Actions
                    diagnostic.source = 'Engram Shadow Guard';
                    // Store ID in code field for easy retrieval
                    diagnostic.code = { value: fp.id, target: vscode.Uri.parse(`engram://rule/${fp.id}`) };

                    diagnostics.push(diagnostic);
                }
            }
        }

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    private isIgnoredScope(fileName: string, scopes?: string[]): boolean {
        if (!scopes || scopes.length === 0) return false;
        const name = path.basename(fileName);
        for (const scope of scopes) {
            if (minimatch(name, scope)) return true;
        }
        return false;
    }

    private escapeRegExp(string: string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    public updateDiagnostics() {
        if (vscode.window.activeTextEditor) {
            this.triggerScan(vscode.window.activeTextEditor.document);
        }
    }
}
