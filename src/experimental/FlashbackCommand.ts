import * as vscode from 'vscode';
import { PhotographerService } from './PhotographerService';
import { LabsController } from './LabsController';

export async function flashbackCommand() {
    if (!LabsController.getInstance().isPhotographicMemoryEnabled()) {
        vscode.window.showWarningMessage('Photographic Memory is not enabled (Hidden Beta).');
        return;
    }

    const query = await vscode.window.showInputBox({
        placeHolder: 'What are you looking for? (e.g. "deleted auth logic from yesterday")',
        prompt: 'Engram Flashback: Search your code memory'
    });

    if (!query) return;

    // Show loading
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Scanning timeline...",
        cancellable: false
    }, async () => {
        const snapshots = await PhotographerService.getInstance().searchTimeStream(query);

        if (snapshots.length === 0) {
            vscode.window.showInformationMessage('No matching memories found.');
            return;
        }

        // Show Picker
        const items = snapshots.map(s => ({
            label: `$(history) ${new Date(s.timestamp).toLocaleString()}`,
            description: s.path,
            detail: s.content.substring(0, 100).replace(/\n/g, ' ') + '...',
            snapshot: s
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a memory to restore'
        });

        if (selected) {
            // Open as Untitled file for comparison vs diff
            // Diff might be better but let's start with viewing content
            const doc = await vscode.workspace.openTextDocument({
                content: selected.snapshot.content,
                language: 'typescript' // Naive, should match file ext
            });
            await vscode.window.showTextDocument(doc);
        }
    });
}
