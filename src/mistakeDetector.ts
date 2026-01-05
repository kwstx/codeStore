import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { MistakeFingerprint, MistakeFix } from './types';

export class MistakeDetector {
    private static instance: MistakeDetector;
    private disposables: vscode.Disposable[] = [];
    private fingerprints: Map<string, MistakeFingerprint> = new Map();
    private storagePath: string | null = null;
    private initialized: boolean = false;

    // Fix Capture State
    private activeErrors: Map<string, Set<string>> = new Map(); // fileUri -> Set of error hashes
    private lastEdits: Map<string, { timestamp: number, diff: string }> = new Map();

    private _onMistakeRepeated = new vscode.EventEmitter<MistakeFingerprint>();
    public readonly onMistakeRepeated = this._onMistakeRepeated.event;

    private constructor() { }

    public static getInstance(): MistakeDetector {
        if (!MistakeDetector.instance) {
            MistakeDetector.instance = new MistakeDetector();
        }
        return MistakeDetector.instance;
    }

    public getFingerprint(id: string): MistakeFingerprint | undefined {
        return this.fingerprints.get(id);
    }

    public init(storagePath: string) {
        if (this.initialized) return;
        this.storagePath = storagePath;
        if (!fs.existsSync(storagePath)) {
            fs.mkdirSync(storagePath, { recursive: true });
        }
        this.loadFingerprints();
        this.initialized = true;
    }

    private getFilePath(): string {
        if (!this.storagePath) throw new Error("Storage path not initialized");
        return path.join(this.storagePath, 'fingerprints.json');
    }

    private async loadFingerprints() {
        try {
            const filePath = this.getFilePath();
            if (fs.existsSync(filePath)) {
                const data = await fs.promises.readFile(filePath, 'utf8');
                const list = JSON.parse(data) as MistakeFingerprint[];
                list.forEach(f => this.fingerprints.set(f.id, f));
                console.log(`[MistakeDetector] Loaded ${list.length} fingerprints.`);
            }
        } catch (e) {
            console.error("[MistakeDetector] Failed to load fingerprints:", e);
        }
    }

    private async saveFingerprints() {
        if (!this.storagePath) return;
        try {
            const list = Array.from(this.fingerprints.values());
            await fs.promises.writeFile(this.getFilePath(), JSON.stringify(list, null, 2), 'utf8');
        } catch (e) {
            console.error("[MistakeDetector] Failed to save fingerprints:", e);
        }
    }

    public startListening(context: vscode.ExtensionContext) {
        // Listen for diagnostic changes
        const diagnosticDisposable = vscode.languages.onDidChangeDiagnostics(e => this.handleDiagnosticsChange(e));

        // Listen for document changes (to capture fixes)
        const documentChangeDisposable = vscode.workspace.onDidChangeTextDocument(e => this.handleDocumentChange(e));

        context.subscriptions.push(diagnosticDisposable, documentChangeDisposable);
        this.disposables.push(diagnosticDisposable, documentChangeDisposable);
        console.log('[MistakeDetector] Started listening to diagnostics and document changes.');
    }

    private handleDocumentChange(event: vscode.TextDocumentChangeEvent) {
        if (event.contentChanges.length === 0) return;

        // Capture the last edit for this document
        // We'll store: "At line X: Replaced Y chars with 'text'"
        const change = event.contentChanges[0];
        const diffDesc = `At line ${change.range.start.line + 1}: Replaced "${change.rangeLength} chars" with "${change.text.trim()}"`;

        this.lastEdits.set(event.document.uri.toString(), {
            timestamp: Date.now(),
            diff: diffDesc
        });
    }

    private async handleDiagnosticsChange(event: vscode.DiagnosticChangeEvent) {
        for (const uri of event.uris) {
            const uriStr = uri.toString();
            const diagnostics = vscode.languages.getDiagnostics(uri);
            const errors = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error);

            const currentHashes = new Set<string>();

            // 1. Process Logic: New Occurrences
            for (const error of errors) {
                const { hash, normalized, code } = this.fingerprintError(error);
                currentHashes.add(hash);

                // Create or Update Fingerprint
                if (this.fingerprints.has(hash)) {
                    const existing = this.fingerprints.get(hash)!;

                    // Throttle count update (1s debounce)
                    if (Date.now() - existing.lastSeen > 1000) {
                        existing.count++;
                        existing.lastSeen = Date.now();

                        // Step 5: Detect Repeated Mistakes
                        // Fire event if it's a repetition (count > 1)
                        if (existing.count > 1) {
                            this._onMistakeRepeated.fire(existing);
                        }
                    }
                } else {
                    const newFingerprint: MistakeFingerprint = {
                        id: hash,
                        language: 'unknown', // TODO: detect language
                        detectionMethod: 'diagnostic',
                        pattern: normalized,
                        count: 1,
                        lastSeen: Date.now(),
                        fixes: []
                    };
                    this.fingerprints.set(hash, newFingerprint);
                }
            }

            // 2. Fix Logic: Detect Resolved Errors
            // Compare previous Active Errors with Current Errors
            const previousHashes = this.activeErrors.get(uriStr) || new Set();
            for (const oldHash of previousHashes) {
                if (!currentHashes.has(oldHash)) {
                    // Error was present, now gone -> RESOLVED
                    await this.captureFix(oldHash, uriStr);
                }
            }

            // Update active errors state
            this.activeErrors.set(uriStr, currentHashes);

            await this.saveFingerprints();
        }
    }

    private async captureFix(fingerprintId: string, uriStr: string) {
        const fingerprint = this.fingerprints.get(fingerprintId);
        if (!fingerprint) return;

        const lastEdit = this.lastEdits.get(uriStr);
        if (!lastEdit) return;

        // Ensure the edit happened recently (e.g., within 5 seconds)
        if (Date.now() - lastEdit.timestamp > 5000) return;

        // Avoid duplicate fixes (simple check)
        if (!fingerprint.fixes) fingerprint.fixes = [];
        const isDuplicate = fingerprint.fixes.some(f => f.diff === lastEdit.diff);

        if (!isDuplicate) {
            const fix: MistakeFix = {
                id: uuidv4(),
                description: `Fixed via edit in ${path.basename(vscode.Uri.parse(uriStr).fsPath)}`,
                diff: lastEdit.diff,
                timestamp: lastEdit.timestamp
            };
            fingerprint.fixes.push(fix);
            console.log(`[MistakeDetector] Captured fix for ${fingerprintId}: ${fix.diff}`);
        }
    }

    public async ignoreMistake(id: string) {
        const fingerprint = this.fingerprints.get(id);
        if (fingerprint) {
            fingerprint.ignored = true;
            await this.saveFingerprints();
            // Force refresh of CodeLenses via event?
            // Actually, we should fire an event or just let the provider poll/handle it.
            // The provider listens to onMistakeRepeated, but maybe it should listen to 'onChanged' generally?
            // For now, let's fire onMistakeRepeated to trigger refresh, or just let it be.
            // Better: Trigger a generic refresh if possible, or just wait for next diagnostic event.
            // We can hack it by firing the existing event or adding a new one. 
            // Let's rely on the CodeLensProvider listening to a "change" event if we had one.
            // Since we don't, we might need to assume the command execution triggers a provider refresh 
            // via 'vscode.languages.registerCodeLensProvider' mechanism or explicit refresh command.
            // But let's just save for now.
        }
    }

    public fingerprintError(diagnostic: vscode.Diagnostic): { hash: string, normalized: string, code: string } {
        let message = diagnostic.message;
        const normalizedMessage = message.replace(/'[^']*'/g, "'...'").replace(/"[^"]*"/g, '"..."');
        const source = diagnostic.source || '';
        const code = String(diagnostic.code || '');
        const fullSignature = `${source}:${code}:${normalizedMessage}`;
        const hash = crypto.createHash('sha256').update(fullSignature).digest('hex');

        return {
            hash,
            normalized: fullSignature,
            code: String(diagnostic.code || '')
        };
    }

    public dispose() {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}
