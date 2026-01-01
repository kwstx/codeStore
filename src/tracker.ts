import * as vscode from 'vscode';
import { PatternEngine } from './engine';

interface TrackedRegion {
    id: string; // conversationId
    recordId: string; // LanceDB ID
    uri: vscode.Uri;
    range: vscode.Range;
    lastContent: string;
}

export class EditTracker {
    private static instance: EditTracker;
    // Map uri string -> regions
    private trackedRegions: Map<string, TrackedRegion[]> = new Map();
    private engine: PatternEngine;
    private saveTimeout: NodeJS.Timeout | null = null;

    private constructor() {
        this.engine = PatternEngine.getInstance();
    }

    public static getInstance(): EditTracker {
        if (!EditTracker.instance) {
            EditTracker.instance = new EditTracker();
        }
        return EditTracker.instance;
    }

    public registerRegion(uri: vscode.Uri, range: vscode.Range, conversationId: string, recordId: string, initialContent: string) {
        const key = uri.toString();
        if (!this.trackedRegions.has(key)) {
            this.trackedRegions.set(key, []);
        }

        const regions = this.trackedRegions.get(key)!;
        regions.push({
            id: conversationId,
            recordId: recordId,
            uri: uri,
            range: range,
            lastContent: initialContent
        });

        console.log(`[Tracker] Registered region for ${conversationId} at lines ${range.start.line}-${range.end.line}`);
    }

    public onTextChange(event: vscode.TextDocumentChangeEvent) {
        const key = event.document.uri.toString();
        if (!this.trackedRegions.has(key)) return;

        const regions = this.trackedRegions.get(key)!;
        if (regions.length === 0) return;

        // Simple range logic: if edit intersects, we assume modification.
        // We also need to shift ranges if edits happen before them, but for this MVP 
        // we'll focus on direct edits to the content itself.

        // Note: VS Code provides ways to track ranges but here we do simple intersection check.
        // Ideally we would assume the document state is fresh.

        for (const change of event.contentChanges) {
            // Update ranges simply based on line delta (very naive, but works for MVP blocks)
            const lineDelta = change.text.split('\n').length - (change.range.end.line - change.range.start.line + 1);

            regions.forEach(region => {
                // If change is strictly BEFORE region, shift region
                if (change.range.end.line < region.range.start.line) {
                    // Shift lines
                    const newStart = region.range.start.line + lineDelta;
                    const newEnd = region.range.end.line + lineDelta;
                    region.range = new vscode.Range(newStart, 0, newEnd, region.range.end.character);
                }
                // If change INTERSECTS region
                else if (change.range.intersection(region.range)) {
                    // Update content roughly
                    // For accuracy, we just re-read the text at the (potentially expanded) range
                    // But determining the new range exact boundary is hard without a full diff engine.

                    // HEURISTIC: Just expand the end line by delta if it's inside.
                    const newEnd = region.range.end.line + lineDelta;
                    region.range = new vscode.Range(region.range.start.line, 0, newEnd, 1000); // 1000 char arbitrary end

                    // Mark for update
                    this.scheduleUpdate(region, event.document);
                }
            });
        }
    }

    private scheduleUpdate(region: TrackedRegion, document: vscode.TextDocument) {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);

        this.saveTimeout = setTimeout(async () => {
            // Get current text of region
            // We use safe logic to clamp range to doc
            const startLine = Math.max(0, region.range.start.line);
            const endLine = Math.min(document.lineCount - 1, region.range.end.line);

            if (startLine > endLine) return; // Region deleted/invalid

            const currentText = document.getText(new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length));

            if (currentText !== region.lastContent) {
                region.lastContent = currentText;

                // Update DB incrementally
                this.engine.updateMemory(region.recordId, {
                    finalEditedCode: currentText,
                    // We could also update confidence if heavily edited?
                    // For now, just track the text.
                }).catch(err => console.error('[Tracker] Update failed:', err));

                console.log(`[Tracker] Updated final_edited_code for ${region.id}`);
            }
        }, 2000); // Debounce 2s
    }

    // Helper to accept record ID
    public updateRecordId(conversationId: string, recordId: string) {
        // Find region and attach recordId for fast updates
        // ... (Implementation detail, for now we will cheat and assume we search the DB or just pass recordId in register)
    }

    public getConversationId(filePath: string, startLine: number, endLine: number): string | undefined {
        // Convert OS path to URI string format correctly? 
        // VS Code URI structure might differ from fsPath. 
        // Ideally we convert to URI before check.
        const targetUri = vscode.Uri.file(filePath).toString();

        if (!this.trackedRegions.has(targetUri)) return undefined;

        const regions = this.trackedRegions.get(targetUri)!;

        // Check for overlap
        for (const region of regions) {
            const rStart = region.range.start.line;
            const rEnd = region.range.end.line;

            // Simple overlap check
            if (Math.max(startLine, rStart) <= Math.min(endLine, rEnd)) {
                return region.id;
            }
        }
        return undefined;
    }
}
