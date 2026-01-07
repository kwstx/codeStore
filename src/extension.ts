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
import { SnippetStore } from './snippetStore';
import { SecurityScanner } from './securityScanner';
import { SecurityExemptionManager } from './securityExemptions';
import { SecurityCodeActionProvider } from './SecurityCodeActionProvider';
import { MemoryCardProvider } from './ui/MemoryCardProvider';
import { StatusBarController } from './ui/StatusBarController';

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

    PasteDetector.getInstance().startListening(context);

    // Initialize Snippet Store
    const snippetStore = SnippetStore.getInstance();
    if (context.storageUri) {
        snippetStore.init(path.join(context.storageUri.fsPath, 'snippets'));
    } else {
        snippetStore.init(path.join(context.globalStorageUri.fsPath, 'snippets'));
    }

    // Security Diagnostics Collection
    const securityDiagnostics = vscode.languages.createDiagnosticCollection('engram-security');
    context.subscriptions.push(securityDiagnostics);

    // Initialize Exemption Manager
    const exemptionManager = SecurityExemptionManager.getInstance();
    if (context.storageUri) {
        exemptionManager.init(path.join(context.storageUri.fsPath, 'exemptions'));
    } else {
        exemptionManager.init(path.join(context.globalStorageUri.fsPath, 'exemptions'));
    }

    // Initialize Status Bar Controller (Sensitivity)
    const statusBarController = new StatusBarController(context); // Manages its own disposables

    // Command: Toggle Sensitivity
    let toggleSensitivityDisposable = vscode.commands.registerCommand('engram.toggleSensitivity', async () => {
        await statusBarController.toggle();
    });
    context.subscriptions.push(toggleSensitivityDisposable);

    // Connect Paste Detector to Snippet Store and Security Scanner
    const pasteDisposable = PasteDetector.getInstance().onPasteDetected(async (event) => {
        // 1. Search for existing snippet (Similarity Search)
        // We rely on the normalized hash we implemented in SnippetStore
        const existing = snippetStore.findSnippet(event.normalized);
        const crypto = require('crypto');
        const hash = crypto.createHash('sha256').update(event.normalized).digest('hex');

        // SECURITY VIBE CHECK (Step 3 & 4)
        // Inline Warnings via Diagnostics
        const securityIssues = SecurityScanner.getInstance().scanText(event.text, event.document.languageId);

        // Filter out exemptions (Step 5)
        let activeIssues = securityIssues.filter(issue => !exemptionManager.isExempt(issue.rule.id, event.document.uri.fsPath));

        // Filter based on Sensitivity
        const config = vscode.workspace.getConfiguration('engram');
        const sensitivity = config.get<string>('sensitivity', 'breeze');

        if (sensitivity === 'breeze') {
            // In Breeze mode, only show Critical issues
            // We assume risk string starts with "Critical" or similar.
            // Our rules (SECURITY_RULES) have risks like "Code Injection Risk (Critical)".
            // Let's filter loosely.
            activeIssues = activeIssues.filter(issue => issue.rule.risk.toLowerCase().includes('critical'));
        }

        if (activeIssues.length > 0) {
            const diags: vscode.Diagnostic[] = [];

            activeIssues.forEach(issue => {
                // Calculate range based on the paste event + the issue's relative position
                // event.range.start is where paste began.
                // issue.line is relative to the *pasted text*.
                const startLine = event.range.start.line + issue.line;
                const startChar = issue.line === 0 ? event.range.start.character + issue.character : issue.character;

                const range = new vscode.Range(
                    startLine, startChar,
                    startLine, startChar + issue.matchText.length
                );

                const diagnostic = new vscode.Diagnostic(
                    range,
                    `[Security Vibe] ${issue.rule.risk}\nAlternative: ${issue.rule.alternative}`,
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostic.source = 'Engram Security';
                diagnostic.code = issue.rule.id;
                diags.push(diagnostic);
            });

            // Update diagnostics for this file
            // Note: We should merge with existing or clear? 
            // For now, let's set them.
            securityDiagnostics.set(event.document.uri, diags);

            // Optional: Non-blocking notification just to say "We found something"
            vscode.window.showInformationMessage(`⚠️ Found ${activeIssues.length} security risks in pasted code. Check problems/hovers.`);
        }


        // Check for Prompt Association
        const lastPrompt = sessionStore.getLastPromptInfo();
        let origin: 'paste' | 'generation' | 'unknown' = 'paste';
        let sessionId: string | undefined = undefined;

        if (lastPrompt) {
            const timeSincePrompt = Date.now() - lastPrompt.timestamp;
            // Challenge: Heuristic. If < 2 minutes?
            if (timeSincePrompt < 120000) { // 2 mins
                origin = 'generation';
                sessionId = lastPrompt.sessionId;
                console.log(`[Extension] Associated paste with Session ${sessionId} (Prompted ${timeSincePrompt / 1000}s ago).`);
            }
        }

        if (existing) {
            console.log(`[Extension] REUSE DETECTED! Found snippet ${hash.substring(0, 8)} (Used ${existing.useCount} times).`);
            // Update usage (increment useCount and update timestamp)
            await snippetStore.saveSnippet({
                ...existing,
                timestamp: Date.now(),
                useCount: existing.useCount + 1,
                // Maybe update origin/session if it was unknown before?
                origin: existing.origin === 'paste' && origin === 'generation' ? 'generation' : existing.origin,
                sessionId: existing.sessionId || sessionId
            });

            // Step 5: Trigger Reuse Suggestion / Notification
            const msg = `♻️ Reused Snippet detected (Seen ${existing.useCount + 1} times).`;
            const action = "View Origin";

            vscode.window.showInformationMessage(msg, action).then(selection => {
                if (selection === action) {
                    vscode.commands.executeCommand('engram.viewSnippetOrigin', existing.id);
                }
            });
        } else {
            console.log(`[Extension] New snippet detected from paste. Saving ${hash.substring(0, 8)}.`);
            await snippetStore.saveSnippet({
                id: hash,
                content: event.text,
                normalized: event.normalized,
                language: event.document.languageId,
                origin: origin,
                sessionId: sessionId,
                timestamp: Date.now(),
                useCount: 1
            });
        }
    });
    context.subscriptions.push(pasteDisposable);

    // Command: View Snippet Origin
    let viewSnippetDisposable = vscode.commands.registerCommand('engram.viewSnippetOrigin', async (snippetId: string) => {
        const snippet = snippetStore.getSnippet(snippetId);
        if (!snippet) return;

        // Construct details
        const details = [
            `ID: ${snippet.id.substring(0, 8)}...`,
            `Language: ${snippet.language}`,
            `First Seen: ${new Date(snippet.timestamp).toLocaleString()}`,
            `Usage Count: ${snippet.useCount}`,
            `Origin: ${snippet.origin}`,
            snippet.sessionId ? `Session ID: ${snippet.sessionId}` : undefined,
            '',
            '--- Content ---',
            snippet.content
        ].filter(Boolean).join('\n');

        const doc = await vscode.workspace.openTextDocument({ content: details, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
    });
    context.subscriptions.push(viewSnippetDisposable);

    // Command: Search Snippets (Safe Reuse)
    let searchSnippetsDisposable = vscode.commands.registerCommand('engram.searchSnippets', async () => {
        const snippets = snippetStore.getAllSnippets().sort((a, b) => b.timestamp - a.timestamp);

        const items = snippets.map(s => {
            // Preview content (first line or truncated)
            const preview = s.content.replace(/\s+/g, ' ').substring(0, 60);
            return {
                label: `$(code) ${s.language} - ${preview}...`,
                description: `Seen ${s.useCount} times`,
                detail: `Last used: ${new Date(s.timestamp).toLocaleTimeString()}`,
                snippet: s
            };
        });

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Search historical snippets to reuse...'
        });

        if (selected) {
            // Open in an untitled document to allow "Safe Reuse" (Preview/Edit/Partial Copy)
            // Setting language automatically
            const doc = await vscode.workspace.openTextDocument({
                content: selected.snippet.content,
                language: selected.snippet.language
            });
            await vscode.window.showTextDocument(doc, {
                preview: false, // Don't use preview mode, keep it open so they can edit
                viewColumn: vscode.ViewColumn.Beside
            });

            vscode.window.showInformationMessage('Snippet opened. Edit or copy parts of it to reuse safely.');
        }
    });
    context.subscriptions.push(searchSnippetsDisposable);

    // Register Security Code Action Provider
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider({ scheme: 'file' }, new SecurityCodeActionProvider(), {
            providedCodeActionKinds: SecurityCodeActionProvider.providedCodeActionKinds
        })
    );

    // Command: Suppress Security Warning (Step 5)
    let suppressCommand = vscode.commands.registerCommand('engram.suppressSecurityWarning', async (ruleId: string, filePath: string) => {
        const reason = await vscode.window.showInputBox({
            placeHolder: 'Reason for suppression (optional)',
            prompt: `Suppressing security warning "${ruleId}" for this file.`
        });

        if (reason !== undefined) { // User didn't cancel (empty string is fine)
            exemptionManager.addExemption(ruleId, filePath, reason);
            vscode.window.showInformationMessage(`Warning suppressed for ${ruleId}.`);

            // Clear specific diagnostic? 
            // We need to re-scan to refresh diagnositcs (which will filter it out).
            // For now, let's clear all security diagnostics for this file and let re-scan happen on next event,
            // OR ideally trigger a re-scan.
            // Since we rely on paste events, we can't easily re-trigger 'onPaste'.
            // But we can clear the diagnostics manually.
            securityDiagnostics.delete(vscode.Uri.file(filePath));
        }
    });
    context.subscriptions.push(suppressCommand);

    // Register CodeLens Provider for Mistakes
    const codeLensProvider = new MistakeCodeLensProvider();
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider)
    );

    // Register Memory Card Provider (Hover)
    const memoryCardProvider = new MemoryCardProvider();
    context.subscriptions.push(
        vscode.languages.registerHoverProvider('*', memoryCardProvider)
    );

    // Command: View Mistake Fix
    let viewMistakeDisposable = vscode.commands.registerCommand('engram.viewMistakeFix', async (fingerprintId: string) => {
        const fp = detector.getFingerprint(fingerprintId);
        if (!fp) return;

        // Prepare Actions
        interface PickerItem extends vscode.QuickPickItem {
            action: 'show' | 'dismiss' | 'replay';
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

                // Add explicit Replay option
                items.push({
                    label: `       $(history) Replay Fix`,
                    description: 'See Before vs After diff',
                    action: 'replay',
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
            } else if (selected.action === 'replay' && selected.fix) {
                // Replay Logic (Virtual Diff)
                const leftContent = selected.fix.before || "// 'Before' snapshot unavailable. \n// Showing raw diff instead:\n" + selected.fix.diff;
                const rightContent = selected.fix.after || selected.fix.diff; // Fallback

                // Create virtual documents
                // We use 'untitled' scheme to open them in memory
                // Note: 'untitled' might mark them as dirty. ContentProvider is better but 'untitled' is easier for now.
                const leftUri = vscode.Uri.parse(`untitled:Before-Fix-${selected.fix.id}`);
                const rightUri = vscode.Uri.parse(`untitled:After-Fix-${selected.fix.id}`);

                const leftDoc = await vscode.workspace.openTextDocument(leftUri);
                // We need to write content. For untitled, we use WorkspaceEdit or inserts.
                // A simpler way: openTextDocument({ content: ... }) doesn't support URI directly.
                // Let's use simple provider or just diffing strings is hard in VS Code? 
                // Actually, vscode.commands.executeCommand('vscode.diff', ...) takes URIs.
                // We need a ContentProvider.

                // HACK: Just show text document with content for now OR register a provider.
                // To keep it clean, let's register a simple 'engram-readonly' scheme provider? 
                // Or just use 'untitled' and fill it.

                const edit = new vscode.WorkspaceEdit();
                edit.insert(leftUri, new vscode.Position(0, 0), leftContent);
                edit.insert(rightUri, new vscode.Position(0, 0), rightContent);
                await vscode.workspace.applyEdit(edit);

                await vscode.commands.executeCommand('vscode.diff',
                    leftUri,
                    rightUri,
                    `Replay Fix: ${new Date(selected.fix.timestamp).toLocaleTimeString()}`
                );
            }
        }
    });
    context.subscriptions.push(viewMistakeDisposable);

    // Command: Direct Replay (for Hover Links)
    let replayFixDisposable = vscode.commands.registerCommand('engram.replayFix', async (fingerprintId: string, fixId: string) => {
        const fp = detector.getFingerprint(fingerprintId);
        if (!fp || !fp.fixes) {
            vscode.window.showErrorMessage('Mistake record not found.');
            return;
        }

        const fix = fp.fixes.find(f => f.id === fixId);
        if (!fix) {
            vscode.window.showErrorMessage('Specific fix version not found.');
            return;
        }

        // Replay Logic (Virtual Diff)
        const leftContent = fix.before || `// 'Before' snapshot unavailable. \n// Showing raw diff instead:\n${fix.diff}`;
        const rightContent = fix.after || fix.diff;

        const leftUri = vscode.Uri.parse(`untitled:Before-Fix-${fix.id}`);
        const rightUri = vscode.Uri.parse(`untitled:After-Fix-${fix.id}`);

        const edit = new vscode.WorkspaceEdit();
        // Since we can't clear 'untitled' easily, we rely on unique IDs or just appending if it exists.
        // Ideally we would use a TextDocumentContentProvider, but for MVP this is okay.

        // Try to open it. If it has lines, clear them?
        // Hard to clear without range. Let's just insert at top.
        // Actually, if we reuse ID, it keeps content.
        // Let's use a random ID suffix if we want fresh? Or unique fix ID is enough.
        // If user replays same fix twice, they get same doc.

        // HACK: To overwrite, we need to delete everything.
        // But untitled docs are managed by VS Code.
        // Let's assume the user closes it.
        // Or we can register a provider if we want cleaner.
        // Let's stick to untitled and just insert.

        edit.insert(leftUri, new vscode.Position(0, 0), leftContent);
        edit.insert(rightUri, new vscode.Position(0, 0), rightContent);
        await vscode.workspace.applyEdit(edit);

        await vscode.commands.executeCommand('vscode.diff',
            leftUri,
            rightUri,
            `Replay Fix: ${new Date(fix.timestamp).toLocaleTimeString()}`
        );
    });
    context.subscriptions.push(replayFixDisposable);

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
            // SECURITY VIBE CHECK (Step 2)
            const securityIssues = SecurityScanner.getInstance().scanText(prompt, 'any'); // 'any' implies checking for secrets/general patterns

            if (securityIssues.length > 0) {
                // Group by rule?
                const issuesText = securityIssues.slice(0, 5).map((m: any) => `• ${m.rule.id} (Line ${m.line + 1}): ${m.rule.risk}`).join('\n');
                const choice = await vscode.window.showWarningMessage(
                    `Security Vibe Check: Found potential risks in prompt!\n${issuesText}`,
                    'Proceed Anyway',
                    'Cancel'
                );

                if (choice !== 'Proceed Anyway') {
                    return; // Cancel logging
                }
            }

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
