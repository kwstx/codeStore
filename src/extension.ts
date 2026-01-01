import * as vscode from 'vscode';
import * as path from 'path';
import { PatternEngine } from './engine';
import { EmbeddingService } from './embeddings';
import { ExclusionManager } from './exclusions';
import { Logger } from './logger';
import { EditTracker } from './tracker';
import { v4 as uuidv4 } from 'uuid';

export async function activate(context: vscode.ExtensionContext) {
    const logger = Logger.getInstance();
    logger.log('Activating Engram...');

    const engine = PatternEngine.getInstance();

    // Initialize services
    EmbeddingService.getInstance();
    ExclusionManager.getInstance().setContext(context);

    // 6. Failure Awareness: Log Failure
    let logFailureDisposable = vscode.commands.registerCommand('engram.logFailure', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('Open the file that caused the failure.');
            return;
        }

        const selection = editor.selection;
        const text = editor.document.getText(selection);
        if (!text) {
            vscode.window.showWarningMessage('Select the code that failed.');
            return;
        }

        // Find the memory
        const results = await engine.query(text); // Find exact or near match
        // Filter for high confidence match
        const match = results.find(r => r.score < 0.1);

        if (!match) {
            vscode.window.showWarningMessage('No matching memory found for this code. Save it first?');
            return;
        }

        const failureReason = await vscode.window.showInputBox({
            placeHolder: 'Why did this code fail?',
            prompt: 'Log the failure reason (e.g. "Infinite loop on large arrays")'
        });

        if (failureReason) {
            await engine.updateMemory(match.id, {
                failureLog: failureReason,
                confidence: 0.1 // Downgrade confidence
            });
            vscode.window.showInformationMessage(`Failure logged. Engram will warn you next time.`);
        }
    });

    context.subscriptions.push(logFailureDisposable);

    // 7. Edit Tracking & AI Detection
    const tracker = EditTracker.getInstance();

    let changeDisposable = vscode.workspace.onDidChangeTextDocument(async (e) => {
        // Track edits
        tracker.onTextChange(e);

        if (e.contentChanges.length === 1) {
            const change = e.contentChanges[0];
            // Heuristic: If paste > 300 chars, assume AI generation / large snippet
            if (change.text.length > 300) {
                // Check Privacy Setting
                const config = vscode.workspace.getConfiguration('engram');
                const storeAiContext = config.get<boolean>('storeAiContext', true);

                const workspaceFolder = vscode.workspace.getWorkspaceFolder(e.document.uri);
                const workspaceName = workspaceFolder ? workspaceFolder.name : 'Unknown';
                const conversationId = storeAiContext ? uuidv4() : undefined; // Only gen ID if storing context

                // Immediately capture as candidate
                const results = await engine.store({
                    content: change.text,
                    filePath: e.document.uri.fsPath,
                    languageId: e.document.languageId,
                    workspaceName: workspaceName,
                    source: 'ai_candidate',
                    prompt: '',
                    confidence: 0.5,
                    conversationId: conversationId,
                    pastedResponse: storeAiContext ? change.text : undefined, // Only store raw response if allowed
                    finalEditedCode: storeAiContext ? '' : undefined
                });

                // Begin Tracking Edits (only if context is enabled, otherwise plain code is enough?)
                // Actually tracking is fine, it just won't have the rich context. 
                // But linking relies on ID. If no ID, no linking.
                if (storeAiContext && results && results.length > 0 && conversationId) {
                    const firstRecord = results[0];
                    if (firstRecord.id) {
                        tracker.registerRegion(
                            e.document.uri,
                            change.range,
                            conversationId,
                            firstRecord.id,
                            change.text
                        );
                    }
                }

                // Resolve Prompt Asynchronously (Only if enabled)
                if (storeAiContext && results && results.length > 0) {
                    results.forEach(async (record: any) => {
                        const recordId = record.id;
                        if (!recordId) return;

                        const inferredPrompt = await engine.inferIntent(record.content);

                        if (inferredPrompt) {
                            await engine.updateMemory(recordId, {
                                prompt: inferredPrompt,
                                confidence: 0.7
                            });
                            logger.log(`Resolved prompt for ${recordId}: "${inferredPrompt.substring(0, 30)}..."`);
                        }
                    });
                }

                logger.log(`Captured candidate AI content (${change.text.length} chars). Privacy: ${storeAiContext}`);
            }
        }
    });

    context.subscriptions.push(changeDisposable);

    // Command: Forget AI Context
    let forgetContextDisposable = vscode.commands.registerCommand('engram.forgetAiContext', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage("Open the file to forget its AI context.");
            return;
        }

        // Find memory for this file
        // This is a bit loose; ideally we search for exact content or file path match.
        // Let's use file path query.
        const filePath = editor.document.uri.fsPath;
        // We probably need a specific 'getByFilePath' or just query returns it.
        // Let's assume query(file_content) finds it.
        const queryText = editor.document.getText();
        const results = await engine.query(queryText);

        // Find exact match
        const match = results.find(r => r.filePath === filePath && r.score < 0.05);

        if (match) {
            const confirmed = await vscode.window.showWarningMessage(
                "Are you sure you want to forget the AI context (Prompts, Original Response) for this file? Code memory will be kept.",
                "Yes, Forget Context",
                "Cancel"
            );

            if (confirmed === "Yes, Forget Context") {
                await engine.forgetContext(match.id);
                vscode.window.showInformationMessage("AI context forgotten for this file.");
            }
        } else {
            vscode.window.showInformationMessage("No tracked memory found for this file.");
        }
    });

    context.subscriptions.push(forgetContextDisposable);

    // 1. File Capture (Updated for Pattern Vault Alert)
    let saveDisposable = vscode.workspace.onDidSaveTextDocument(async (document) => {
        if (document.languageId === 'git-commit' || document.languageId === 'log') {
            return;
        }

        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        const workspaceName = workspaceFolder ? workspaceFolder.name : 'Unknown';

        const potentialPatterns = await engine.store({
            content: document.getText(),
            filePath: document.uri.fsPath,
            languageId: document.languageId,
            workspaceName: workspaceName
        });

        // Pattern Vault Alert
        if (potentialPatterns && potentialPatterns.length > 0) {
            // 1. RISK ALERT (Reuse of Unstable Pattern)
            const riskMatch = potentialPatterns.find((p: any) => p.riskAlert);
            if (riskMatch && riskMatch.riskAlert) {
                // Show prominent warning
                const selection = await vscode.window.showWarningMessage(
                    "You’ve tried something similar before and it failed.",
                    "View Details",
                    "Trust This Pattern"
                );

                if (selection === "View Details") {
                    const details = await engine.getPatternDetails(riskMatch.riskAlert.id);
                    if (details) {
                        const channel = vscode.window.createOutputChannel("Pattern Vault Risk");
                        channel.show();
                        channel.appendLine("⚠️ RISK ANALYSIS: UNSTABLE PATTERN REUSE");
                        channel.appendLine("----------------------------------------");
                        channel.appendLine(`ID: ${details.id}`);
                        channel.appendLine(`File: ${details.filePath}`);
                        channel.appendLine(`Failures Detected: ${details.failureCount || 'Unknown'}`);
                        channel.appendLine(`Last Failure: ${details.lastFailure || 'Unknown'}`);
                        channel.appendLine(`Status: ${details.isUnstable ? 'UNSTABLE' : 'Stable'}`);
                        channel.appendLine("");
                        channel.appendLine("Suggestion: Review the failure history before proceeding.");
                    }
                } else if (selection === "Trust This Pattern") {
                    await engine.trustPattern(riskMatch.riskAlert.id);
                    vscode.window.showInformationMessage("Pattern trusted. You won't be warned about this again.");
                }
            }

            // 2. Reuse (Same Pattern) - Info only
            const reuseMatch = potentialPatterns.find((p: any) => p.matchedPattern && p.matchedPattern.usageCount >= 2);
            if (reuseMatch) {
                const label = reuseMatch.matchedPattern.label.length > 30 ? reuseMatch.matchedPattern.label.substring(0, 30) + '...' : reuseMatch.matchedPattern.label;
                vscode.window.setStatusBarMessage(`$(verified) You've used this pattern before: "${label}" (${reuseMatch.matchedPattern.usageCount} times)`, 5000);
            }

            // 3. Check for Similarity (Different Workspace)
            // Dedup alerts
            const uniquePatterns = [...new Set(potentialPatterns.map(p => p.workspaceName))];

            // Heuristic: Warn if found in DIFFERENT workspace
            const crossProject = potentialPatterns.find(p => p.workspaceName !== workspaceName);
            if (crossProject) {
                vscode.window.setStatusBarMessage(`$(info) Engram: Similar logic found in workspace "${crossProject.workspaceName}".`, 5000);
            }
        }
    });

    // 2. Retrieval Command (Updated for Failure Warning)
    let searchDisposable = vscode.commands.registerCommand('engram.search', async () => {
        const editor = vscode.window.activeTextEditor;
        let query = '';

        if (editor && !editor.selection.isEmpty) {
            query = editor.document.getText(editor.selection);
        }

        if (!query) {
            query = await vscode.window.showInputBox({
                placeHolder: 'Describe what you are looking for or select code...'
            }) || '';
        }

        if (query) {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Searching Engram...",
                cancellable: false
            }, async (progress) => {
                const results = await engine.query(query);

                if (results.length === 0) {
                    vscode.window.showInformationMessage('No similar patterns found.');
                    return;
                }

                const items = results.map((r: any) => {
                    // Failure Context on Recall
                    const failureCount = r.failureCount || 0;
                    const isUnstable = r.isUnstable;
                    const failureIcon = failureCount > 0 ? '$(alert) ' : (r.failureLog ? '$(warning) ' : '');
                    const confidenceIcon = r.confidence && r.confidence < 0.5 ? '$(issue-opened) ' : '';

                    // Prioritize Match Context for description if available
                    let baseDesc = r.matchContext || (r.prompt ? `Intent: ${r.prompt}` : (r.summary ? `Summary: ${r.summary.substring(0, 60)}...` : new Date(r.timestamp).toLocaleDateString()));
                    let description = failureCount > 0 ? `${baseDesc} | ⚠️ Failed ${failureCount} times` : baseDesc;

                    // Rich Detail
                    let detailBase = r.content.substring(0, 100).replace(/[\n\r]+/g, ' ') + '...';
                    let detail = (r.failureLog ? `⚠️ Last Error: ${r.failureLog}\n` : '') + detailBase;

                    return {
                        label: `${failureIcon}${confidenceIcon}${path.basename(r.filePath)}`,
                        description: description,
                        detail: detail,
                        link: r.filePath,
                        content: r.content,
                        pattern: r
                    };
                });
                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select a pattern to view',
                    matchOnDescription: true,
                    matchOnDetail: true
                });

                if (selected) {
                    // Open Rich Context View (Webview)
                    const panel = vscode.window.createWebviewPanel(
                        'patternVaultMemory',
                        `Context: ${path.basename(selected.pattern.filePath)}`,
                        vscode.ViewColumn.One,
                        {
                            enableScripts: true
                        }
                    );

                    // HTML Content for the Webview
                    const prompt = selected.pattern.prompt || 'No specific prompt recorded.';
                    const aiResponse = selected.pattern.pastedResponse || 'No raw AI response stored.';
                    const finalCode = selected.pattern.finalEditedCode || selected.pattern.content;
                    const matchContext = selected.pattern.matchContext ? `<div class="match-highlight">${selected.pattern.matchContext}</div>` : '';

                    panel.webview.html = `
                        <!DOCTYPE html>
                        <html lang="en">
                        <head>
                            <meta charset="UTF-8">
                            <meta name="viewport" content="width=device-width, initial-scale=1.0">
                            <title>Memory Context</title>
                            <style>
                                body { font-family: var(--vscode-font-family); padding: 20px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
                                h3 { margin-top: 5px; color: var(--vscode-textLink-foreground); }
                                pre { background: var(--vscode-editor-inactiveSelectionBackground); padding: 10px; border-radius: 5px; overflow-x: auto; white-space: pre-wrap; }
                                .section { margin-bottom: 20px; border-left: 3px solid var(--vscode-activityBar-foreground); padding-left: 10px; }
                                details { cursor: pointer; margin-bottom: 10px; }
                                summary { font-weight: bold; padding: 5px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border-radius: 3px; }
                                .arrow { text-align: center; font-size: 20px; color: var(--vscode-descriptionForeground); margin: 5px 0; }
                                .btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 12px; cursor: pointer; border-radius: 2px; text-decoration: none; display: inline-block; margin-top: 10px; }
                                .btn:hover { background: var(--vscode-button-hoverBackground); }
                                .match-highlight { background: var(--vscode-editor-findMatchHighlightBackground); padding: 5px; border-radius: 3px; margin-bottom: 15px; border: 1px solid var(--vscode-editor-findMatchBorder); }
                            </style>
                        </head>
                        <body>
                            ${matchContext}
                            <h2>Memory Recall</h2>
                            
                            <div class="section">
                                <details>
                                    <summary>1. Prompt (User Intent) ▾</summary>
                                    <p><strong>Intent:</strong> ${prompt}</p>
                                </details>
                            </div>

                            <div class="arrow">↓</div>

                            <div class="section">
                                <details>
                                    <summary>2. AI Response (Original) ▾</summary>
                                    <pre>${aiResponse.replace(/</g, '&lt;')}</pre>
                                </details>
                            </div>

                            <div class="arrow">↓</div>

                            <div class="section">
                                <h3>3. Final Code</h3>
                                <pre><code>${finalCode.replace(/</g, '&lt;')}</code></pre>
                                <button class="btn" onclick="openFile()">Open Source File</button>
                            </div>

                            <script>
                                const vscode = acquireVsCodeApi();
                                function openFile() {
                                    vscode.postMessage({ 
                                        command: 'openFile', 
                                        filePath: '${selected.pattern.filePath.replace(/\\/g, '\\\\')}',
                                        id: '${selected.pattern.id}' 
                                    });
                                }
                            </script>
                        </body>
                        </html>
                    `;

                    // Handle messages from the webview
                    panel.webview.onDidReceiveMessage(async (message) => {
                        if (message.command === 'openFile') {
                            try {
                                if (message.id) {
                                    await engine.recordPatternAccess(message.id);
                                }
                                const doc = await vscode.workspace.openTextDocument(message.filePath);
                                await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One });
                            } catch (e) {
                                vscode.window.showErrorMessage(`Could not open file: ${message.filePath}`);
                            }
                        }
                    }, undefined, context.subscriptions);
                }
            });
        }
    });

    // 3. Exclude File Command
    let excludeDisposable = vscode.commands.registerCommand('engram.excludeFile', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const filePath = editor.document.uri.fsPath;
            await ExclusionManager.getInstance().excludePath(filePath);
            vscode.window.showInformationMessage(`Excluded file from Engram: ${path.basename(filePath)}`);
        } else {
            vscode.window.showErrorMessage('Open a file to exclude it.');
        }
    });

    // 4. Delete Memory Command
    let deleteDisposable = vscode.commands.registerCommand('engram.deleteMemory', async () => {
        const query = await vscode.window.showInputBox({
            placeHolder: 'Search for memory to DELETE...'
        });

        if (query) {
            const results = await engine.query(query);
            if (results.length === 0) {
                vscode.window.showInformationMessage('No patterns found to delete.');
                return;
            }

            const items = results.map((r: any) => ({
                label: `DELETE: ${path.basename(r.filePath)}`,
                description: r.summary || (r.content.substring(0, 50) + '...'),
                detail: `ID: ${r.id}`,
                pattern: r
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: '⚠️ Select a memory to PERMANENTLY DELETE ⚠️'
            });

            if (selected) {
                await engine.deleteMemory(selected.pattern.id);
                vscode.window.showInformationMessage(`Deleted memory: ${path.basename(selected.pattern.filePath)}`);
            }
        }
    });

    // 5. Context Memory: Paste with Context
    let pasteContextDisposable = vscode.commands.registerCommand('engram.pasteWithContext', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('Open a file to paste code.');
            return;
        }

        const clipboardContent = await vscode.env.clipboard.readText();
        if (!clipboardContent) {
            vscode.window.showWarningMessage('Clipboard is empty.');
            return;
        }

        const prompt = await vscode.window.showInputBox({
            placeHolder: 'What is this code for? (Optional - leave empty to auto-detect)',
            prompt: 'Capture the intent or original prompt for this code.'
        });

        // Paste content
        editor.edit(editBuilder => {
            editBuilder.insert(editor.selection.active, clipboardContent);
        });

        // Store with metadata
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
        const workspaceName = workspaceFolder ? workspaceFolder.name : 'Unknown';

        await engine.store({
            content: clipboardContent,
            filePath: editor.document.uri.fsPath, // Associated with current file
            languageId: editor.document.languageId,
            workspaceName: workspaceName,
            prompt: prompt || '', // Store prompt
            source: 'ai', // Assume pasted code might be AI
            confidence: 0.8
        });

        logger.log(`Context Memory saved with prompt: ${prompt ? 'Yes' : 'No'}`);
    });

    context.subscriptions.push(pasteContextDisposable);

    // 7. Failure-Aware Memory: Capture Runtime Errors
    // Debug Adapter Tracker
    vscode.debug.registerDebugAdapterTrackerFactory('*', {
        createDebugAdapterTracker(session: vscode.DebugSession) {
            return {
                onDidSendMessage: message => {
                    if (message.type === 'event' && message.event === 'output' && message.body) {
                        const output = message.body.output;
                        const category = message.body.category; // 'console', 'stderr', etc.

                        // Check for error signals
                        const isError = category === 'stderr' || /(Exception|Error|Traceback|Panic|Stack trace)/i.test(output);

                        if (isError && output.trim().length > 0) {
                            // Attempt to get file path from session config or currently active editor
                            // Ideally we'd map the error back to the source file, but that's complex.
                            // For v1, we associate it with the file currently being debugged (program).
                            let filePath = session.configuration.program || '';

                            // If program isn't set, try active editor fallback
                            if (!filePath && vscode.window.activeTextEditor) {
                                filePath = vscode.window.activeTextEditor.document.uri.fsPath;
                            }

                            if (filePath) {
                                engine.recordFailure({
                                    type: 'runtime',
                                    message: output.trim(),
                                    filePath: filePath
                                });
                            }
                        }
                    }
                }
            };
        }
    });

    // Task Process Listener (Exit Codes)
    context.subscriptions.push(vscode.tasks.onDidEndTaskProcess(e => {
        if (e.exitCode !== undefined && e.exitCode !== 0) {
            // Task failed
            // Which file? We don't know easily without parsing output.
            // Fallback to active editor or just log generic
            const activeEditor = vscode.window.activeTextEditor;
            const filePath = activeEditor ? activeEditor.document.uri.fsPath : 'unknown';

            engine.recordFailure({
                type: 'process',
                message: `Task "${e.execution.task.name}" failed with exit code ${e.exitCode}`,
                filePath: filePath
            });
        }
    }));

    // Persistent Status Bar Item (Hidden by default)
    const patternStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    patternStatusBar.command = 'engram.showPatternHistory';
    context.subscriptions.push(patternStatusBar);

    let lastDetectedClusterId: string | null = null;

    let historyDisposable = vscode.commands.registerCommand('engram.showPatternHistory', async (clusterId?: string) => {
        const targetId = clusterId || lastDetectedClusterId;
        if (!targetId) {
            vscode.window.showInformationMessage('No recent pattern detected.');
            return;
        }

        const memories = await engine.getClusterMemories(targetId);
        if (memories.length === 0) {
            vscode.window.showInformationMessage('No history found for this pattern.');
            return;
        }

        // Create Panel
        const panel = vscode.window.createWebviewPanel(
            'patternVaultHistory',
            `Pattern History (${memories.length})`,
            vscode.ViewColumn.Two,
            { enableScripts: true }
        );

        const rows = memories.map((m: any) => {
            const date = new Date(m.timestamp).toLocaleDateString() + ' ' + new Date(m.timestamp).toLocaleTimeString();
            const summary = m.summary || m.content.substring(0, 80) + '...';
            const workspace = m.workspaceName || 'Unknown';
            return `
                <div class="memory-card">
                    <div class="header">
                        <span class="date">${date}</span>
                        <span class="workspace badge">${workspace}</span>
                    </div>
                    <div class="file-path">
                        <a href="#" onclick="openFile('${m.filePath.replace(/\\/g, '\\\\')}')">${path.basename(m.filePath)}</a>
                    </div>
                    <div class="summary">${summary}</div>
                </div>
            `;
        }).join('');

        panel.webview.html = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: var(--vscode-font-family); padding: 20px; color: var(--vscode-foreground); }
                    .memory-card { 
                        background: var(--vscode-editor-inactiveSelectionBackground); 
                        padding: 10px; margin-bottom: 10px; border-radius: 5px; 
                        border-left: 4px solid var(--vscode-textLink-foreground);
                    }
                    .header { display: flex; justify-content: space-between; font-size: 0.85em; color: var(--vscode-descriptionForeground); margin-bottom: 5px; }
                    .badge { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 2px 6px; border-radius: 3px; }
                    .file-path a { font-weight: bold; font-size: 1.1em; text-decoration: none; color: var(--vscode-textLink-foreground); }
                    .file-path a:hover { text-decoration: underline; }
                    .summary { margin-top: 5px; font-style: italic; opacity: 0.9; }
                </style>
            </head>
            <body>
                <h2>Pattern History</h2>
                <p>Found ${memories.length} instances of this logic.</p>
                ${rows}
                <script>
                    const vscode = acquireVsCodeApi();
                    function openFile(path) {
                        vscode.postMessage({ command: 'openFile', filePath: path });
                    }
                </script>
            </body>
            </html>
        `;

        panel.webview.onDidReceiveMessage(async (message) => {
            if (message.command === 'openFile') {
                try {
                    const doc = await vscode.workspace.openTextDocument(message.filePath);
                    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One });
                } catch (e) {
                    vscode.window.showErrorMessage(`Could not open file: ${message.filePath}`);
                }
            }
        });
    });

    context.subscriptions.push(historyDisposable);

    // Update Save Handler to use Status Bar
    saveDisposable.dispose(); // Remove old one
    saveDisposable = vscode.workspace.onDidSaveTextDocument(async (document) => {
        if (document.languageId === 'git-commit' || document.languageId === 'log') return;

        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        const workspaceName = workspaceFolder ? workspaceFolder.name : 'Unknown';

        const potentialPatterns = await engine.store({
            content: document.getText(),
            filePath: document.uri.fsPath,
            languageId: document.languageId,
            workspaceName: workspaceName
        });

        if (potentialPatterns && potentialPatterns.length > 0) {
            const reuseMatch = potentialPatterns.find((p: any) => p.matchedPattern && p.matchedPattern.usageCount >= 2);
            if (reuseMatch) {
                lastDetectedClusterId = reuseMatch.matchedPattern.id;

                const label = reuseMatch.matchedPattern.label.length > 30 ? reuseMatch.matchedPattern.label.substring(0, 30) + '...' : reuseMatch.matchedPattern.label;
                patternStatusBar.text = `$(verified) Pattern: "${label}" (${reuseMatch.matchedPattern.usageCount})`;
                patternStatusBar.tooltip = "Click to view pattern history";
                patternStatusBar.show();

                // Auto-hide after 15 seconds
                setTimeout(() => {
                    patternStatusBar.hide();
                }, 15000);
            }
        }
    });
    context.subscriptions.push(saveDisposable);

    context.subscriptions.push(searchDisposable);
    context.subscriptions.push(excludeDisposable);
    context.subscriptions.push(deleteDisposable);
    context.subscriptions.push(pasteContextDisposable);

    // Command: Toggle AI Context
    let toggleContextDisposable = vscode.commands.registerCommand('engram.toggleAiContext', async () => {
        const config = vscode.workspace.getConfiguration('engram');
        const current = config.get<boolean>('storeAiContext', true);
        const newValue = !current;
        await config.update('storeAiContext', newValue, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Engram: AI Context Capture is now ${newValue ? 'ENABLED' : 'DISABLED'}.`);
    });
    context.subscriptions.push(toggleContextDisposable);

    vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('engram')) {
            engine.reloadConfig();
        }
    });

    console.log('[Engram] Activated!');
}

export function deactivate() { }
