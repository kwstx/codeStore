import * as vscode from 'vscode';
import * as path from 'path';
import { EmbeddingService } from './embeddings';
import { ExclusionManager } from './exclusions';
import { Logger } from './logger';
import { SessionStore } from './sessionStore';
import { MistakeDetector } from './mistakeDetector';
import { PasteDetector } from './pasteDetector';
import { TimelineProvider } from './ui/TimelineProvider';

import { MistakeCodeLensProvider } from './ui/MistakeCodeLensProvider';

export async function activate(context: vscode.ExtensionContext) {
    const logger = Logger.getInstance();
    logger.log('Activating Engram...');

    // Initialize services
    EmbeddingService.getInstance();
    ExclusionManager.getInstance().setContext(context);

    // Initialize SessionStore (Vibe Sessions)
    const sessionStore = SessionStore.getInstance();
    if (context.storageUri) {
        // Use workspace-specific storage
        const sessionsPath = path.join(context.storageUri.fsPath, 'vibe_sessions');
        sessionStore.init(sessionsPath);
    } else {
        // Fallback for no workspace
        const globalSessionsPath = path.join(context.globalStorageUri.fsPath, 'vibe_sessions');
        sessionStore.init(globalSessionsPath);
    }

    // Start Mistake Detection
    const detector = MistakeDetector.getInstance();
    if (context.storageUri) {
        detector.init(path.join(context.storageUri.fsPath, 'mistakes'));
    } else {
        detector.init(path.join(context.globalStorageUri.fsPath, 'mistakes'));
    }
    detector.startListening(context);

    // Start Paste Detection (Phase 3)
    PasteDetector.getInstance().startListening(context);

    // Register CodeLens Provider for Mistakes
    const codeLensProvider = new MistakeCodeLensProvider();
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider)
    );

    // Command: View Mistake Fix
    let viewMistakeDisposable = vscode.commands.registerCommand('engram.viewMistakeFix', async (fingerprintId: string) => {
        const fp = detector.getFingerprint(fingerprintId);
        if (!fp) return;

        // Prepare Actions
        interface PickerItem extends vscode.QuickPickItem {
            action: 'show' | 'dismiss';
            fix?: any;
        }

        const items: PickerItem[] = [];

        if (fp.fixes && fp.fixes.length > 0) {
            fp.fixes.forEach(f => {
                items.push({
                    label: `$(wrench) View Fix: ${new Date(f.timestamp).toLocaleTimeString()}`,
                    description: f.description,
                    detail: f.diff.substring(0, 60) + '...',
                    action: 'show',
                    fix: f
                });
            });
        } else {
            items.push({
                label: '$(info) No fixes recorded yet',
                description: 'We are watching for how you fix this.',
                action: 'show', // No-op really
                fix: null,
                picked: true // Disabled? No.
            });
        }

        // Add Dismiss Option at bottom
        items.push({
            label: '$(bell-slash) Dismiss this warning',
            description: 'Stop showing warnings for this specific mistake',
            action: 'dismiss'
        });

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `Action for recurring mistake (${fp.count} occurrences)`
        });

        if (selected) {
            if (selected.action === 'dismiss') {
                await detector.ignoreMistake(fp.id);
                vscode.window.showInformationMessage('Warning dismissed for this mistake pattern.');
            } else if (selected.action === 'show' && selected.fix) {
                const doc = await vscode.workspace.openTextDocument({
                    content: selected.fix.diff,
                    language: 'diff'
                });
                await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
            }
        }
    });
    context.subscriptions.push(viewMistakeDisposable);

    // Register Webview Provider
    const timelineProvider = new TimelineProvider(context.extensionUri, sessionStore);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(TimelineProvider.viewType, timelineProvider)
    );

    // Command: Hello World (Sanity Check)
    let disposable = vscode.commands.registerCommand('engram.helloWorld', () => {
        vscode.window.showInformationMessage('Engram is ready for new features!');
    });
    context.subscriptions.push(disposable);

    // Command: Exclude File
    let excludeDisposable = vscode.commands.registerCommand('engram.excludeFile', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const filePath = editor.document.uri.fsPath;
            await ExclusionManager.getInstance().excludePath(filePath);
            vscode.window.showInformationMessage(`Excluded ${path.basename(filePath)} from Engram.`);
        }
    });
    context.subscriptions.push(excludeDisposable);

    // Command: Mark Session Failed (Manual)
    let markFailedDisposable = vscode.commands.registerCommand('engram.markFailure', async () => {
        if (sessionStore.activeSessionId) {
            await sessionStore.updateSessionStatus(sessionStore.activeSessionId, 'failed');
            vscode.window.showErrorMessage('Session marked as FAILED.');
            // Note: timelineProvider.refresh() handles finding the active session.
            timelineProvider.refresh();
        } else {
            vscode.window.showWarningMessage('No active session to mark as failed.');
        }
    });
    context.subscriptions.push(markFailedDisposable);

    // Diagnostics Monitor (Automatic Failure Detection)
    // If errors spike > 5 in active file, mark as likely failed
    let diagnosticsDisposable = vscode.languages.onDidChangeDiagnostics(e => {
        if (!sessionStore.activeSessionId) return;

        // Check active editor
        const editor = vscode.window.activeTextEditor;
        if (editor && e.uris.some(uri => uri.toString() === editor.document.uri.toString())) {
            const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);
            const errorCount = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error).length;

            if (errorCount > 5) {
                const session = sessionStore.getSession(sessionStore.activeSessionId);
                if (session && session.status !== 'failed') {
                    sessionStore.updateSessionStatus(session.id, 'failed');
                    vscode.window.showErrorMessage(`Session flagged as FAILED due to high error count (${errorCount}).`);
                    timelineProvider.refresh();
                }
            }
        }
    });
    context.subscriptions.push(diagnosticsDisposable);



    // Command: Log Prompt (Manual Vibe Tracker)
    // Allows user to manually log a prompt they are about to use, getting warnings if it's risky
    let logPromptDisposable = vscode.commands.registerCommand('engram.logPrompt', async () => {
        if (!sessionStore.activeSessionId) {
            vscode.window.showErrorMessage('No active session. Please start one first (or use a tool).');
            return;
        }

        const prompt = await vscode.window.showInputBox({
            placeHolder: 'Enter your prompt to log/check...',
            prompt: 'Log Prompt & Check Similarity'
        });

        if (prompt) {
            const warning = await sessionStore.addPrompt(sessionStore.activeSessionId, prompt);
            if (warning) {
                const choice = await vscode.window.showWarningMessage(
                    warning,
                    'View Successful Revision', // Dummy action for now
                    'Proceed Anyway'
                );
                if (choice === 'View Successful Revision') {
                    // In a real impl, we'd find the success ID and show diff or open it.
                    vscode.window.showInformationMessage('Showing successful revision... (Placeholder)');
                }
            } else {
                vscode.window.showInformationMessage('Prompt logged safely.');
            }
            timelineProvider.refresh();
        }
    });
    context.subscriptions.push(logPromptDisposable);

    console.log('[Engram] Activated (Legacy features removed).');
}

export function deactivate() { }
