import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { MistakeFingerprint, MistakeFix, MemoryCard } from './types';

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

    public getAllFingerprints(): MistakeFingerprint[] {
        return Array.from(this.fingerprints.values());
    }

    public updateFingerprint(fingerprint: MistakeFingerprint) {
        if (this.fingerprints.has(fingerprint.id)) {
            this.fingerprints.set(fingerprint.id, fingerprint);
            this.saveFingerprints();
        }
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

        // Phase 9: Hardening - Eviction Policy
        // If > 5000 fingerprints, evict oldest 1000 to prevent unbounded growth.
        const MAX_FINGERPRINTS = 5000;
        if (this.fingerprints.size > MAX_FINGERPRINTS) {
            console.log(`[MistakeDetector] Pruning fingerprints (Size: ${this.fingerprints.size} > ${MAX_FINGERPRINTS})...`);
            const sorted = Array.from(this.fingerprints.values()).sort((a, b) => a.lastSeen - b.lastSeen);
            const toRemove = sorted.slice(0, this.fingerprints.size - MAX_FINGERPRINTS + 100); // Remove excess + buffer
            toRemove.forEach(f => this.fingerprints.delete(f.id));
            console.log(`[MistakeDetector] Evicted ${toRemove.length} old fingerprints.`);
        }

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

                        // Step 5: Detect Repeated Mistakes w/ Sensitivity
                        const config = vscode.workspace.getConfiguration('engram');
                        const sensitivity = config.get<string>('sensitivity', 'breeze');
                        const threshold = sensitivity === 'strict' ? 1 : 2; // Strict: >1 (2+), Breeze: >2 (3+)

                        if (existing.count > threshold) {
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
            // Reconstruct snapshots
            // BEFORE: We don't have the full previous text, but we know the diff.
            // AFTER: We have the current text (document state after edit).
            // This is a simplification. Ideally we should cache the 'before' state when the error was first seen.
            // For now, let's treat the 'diff' as the 'after' snippet if it's an insertion/replacement.

            const fix: MistakeFix = {
                id: uuidv4(),
                description: `Fixed via edit in ${path.basename(vscode.Uri.parse(uriStr).fsPath)}`,
                diff: lastEdit.diff,
                after: lastEdit.diff.includes('Replaced') ? lastEdit.diff.split('with "')[1].slice(0, -1) : '...',
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

    public getMemoryCard(diagnostic: vscode.Diagnostic): MemoryCard | undefined {
        const { hash } = this.fingerprintError(diagnostic);
        const fingerprint = this.fingerprints.get(hash);

        if (!fingerprint || fingerprint.count <= 1) {
            return undefined;
        }

        let lastAction = "Unresolved / Ignored";
        let lastFixId: string | undefined;

        if (fingerprint.ignored) {
            lastAction = "You manually dismissed this warning.";
        } else if (fingerprint.fixes && fingerprint.fixes.length > 0) {
            const lastFix = fingerprint.fixes[fingerprint.fixes.length - 1];
            lastAction = `You fixed it by editing code: "${lastFix.diff.substring(0, 60)}..."`;
            lastFixId = lastFix.id;
        }

        // AI-Assisted Analysis (Simulation)
        // In a real system, we'd use embedding similarity here.
        // For MVP, we check if there are multiple fixes for similar patterns.
        let analysis: string | undefined;
        if (fingerprint.fixes && fingerprint.fixes.length > 0) {
            const f = fingerprint.fixes[0];
            analysis = `This resembles a previous change caused by **${f.description.split(' in ')[0]}**. \n\nYou previously resolved this by modifying ${f.diff.length} characters.`;
        }

        return {
            context: `This error has occurred ${fingerprint.count} times in your history.`,
            lastSeen: fingerprint.lastSeen,
            lastAction: lastAction,
            frequency: fingerprint.count,
            consequence: "Potential runtime failure based on previous occurrences.",
            fixId: lastFixId,
            fingerprintId: fingerprint.id,
            analysis: analysis
        };
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
