import * as vscode from 'vscode';
import * as path from 'path';
import { EmbeddingService } from './embeddings';
import { ExclusionManager } from './exclusions';
import { Logger } from './logger';
import { MistakeDetector } from './mistakeDetector';
import { PasteDetector } from './pasteDetector';
import { ContextInjector } from './contextInjector';
import { SmartClipboard } from './smartClipboard';
import { ShadowScanner } from './shadowScanner';
import { ShadowCodeActionProvider } from './ui/ShadowCodeActionProvider';
import { MistakeCodeLensProvider } from './ui/MistakeCodeLensProvider';
import { SnippetStore } from './snippetStore';
import { MemoryCardProvider } from './ui/MemoryCardProvider';
import { StatusBarController } from './ui/StatusBarController';
import { LabsController } from './experimental/LabsController';
import { GladiatorArena } from './experimental/gladiator';

export async function activate(context: vscode.ExtensionContext) {
    const logger = Logger.getInstance();
    logger.log('Activating Engram...');

    // Initialize services
    EmbeddingService.getInstance();
    ExclusionManager.getInstance().setContext(context);

    // --- RATING PROMPT ---
    const installDate = context.globalState.get<number>('engramInstallDate');
    const hasRated = context.globalState.get<boolean>('engramHasRated', false);

    if (!installDate) {
        context.globalState.update('engramInstallDate', Date.now());
    } else if (!hasRated) {
        const threeDays = 3 * 24 * 60 * 60 * 1000;
        if (Date.now() - installDate > threeDays) {
            vscode.window.showInformationMessage(
                "Engram has been guarding your workflow for 3 days. Has it saved you time?",
                "Yes, Rate It", "Not Yet", "Don't Ask Again"
            ).then(selection => {
                if (selection === "Yes, Rate It") {
                    vscode.env.openExternal(vscode.Uri.parse('https://marketplace.visualstudio.com/items?itemName=use-engram.engram&ssr=false#review-details'));
                    context.globalState.update('engramHasRated', true);
                } else if (selection === "Don't Ask Again") {
                    context.globalState.update('engramHasRated', true);
                }
            });
        }
    }

    // --- MCP SERVER AUTO-CONFIG ---
    try {
        const config = vscode.workspace.getConfiguration('amp');
        const mcpServers = config.get<any>('mcpServers') || {};

        if (!mcpServers['engram']) {
            const serverPath = context.asAbsolutePath(path.join('server', 'dist', 'index.js'));

            logger.log(`Auto-configuring Engram MCP Server at: ${serverPath}`);

            await config.update('mcpServers', {
                ...mcpServers,
                "engram": {
                    "command": "node",
                    "args": [serverPath],
                    "disabled": false,
                    "autoAllow": true
                }
            }, vscode.ConfigurationTarget.Global);

            vscode.window.showInformationMessage("Engram MCP Server connected for Universal Protection. 🛡️");
        }
    } catch (e) {
        logger.log(`Failed to auto-configure MCP server: ${e}`);
    }

    // Start Mistake Detection
    const detector = MistakeDetector.getInstance();
    if (context.storageUri) {
        detector.init(path.join(context.storageUri.fsPath, 'mistakes'));
    } else {
        detector.init(path.join(context.globalStorageUri.fsPath, 'mistakes'));
    }
    detector.startListening(context);

    // [LABS] Beta Features - Opt-In Duel
    // Triggered via Context Menu

    context.subscriptions.push(
        vscode.commands.registerCommand('engram.gladiatorChallenge', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return; }

            const selection = editor.selection;
            const code = editor.document.getText(selection);

            if (!code.trim()) {
                vscode.window.showWarningMessage("Select some code to challenge first.");
                return;
            }

            vscode.window.showInformationMessage("⚔️ Gladiator is critiquing your selection...");

            const critique = await GladiatorArena.critiqueCode(code);

            if (critique) {
                const edit = new vscode.WorkspaceEdit();
                const insertPos = new vscode.Position(selection.end.line + 1, 0);
                edit.insert(editor.document.uri, insertPos, critique);
                await vscode.workspace.applyEdit(edit);
            } else {
                vscode.window.showWarningMessage("Gladiator failed to generate critique (Check Ollama).");
            }
        })
    );

    // Initialize Context Injector (AI Whisperer)
    const contextInjector = ContextInjector.getInstance();
    contextInjector.setContext(context);

    // Listen for Mistake Repeats -> Update .cursorrules
    context.subscriptions.push(
        detector.onMistakeRepeated(async () => {
            console.log('[Extension] Mistake repeated! Updating .cursorrules...');
            const fingerprints = detector.getAllFingerprints();
            await contextInjector.updateCursorRules(fingerprints);
        })
    );

    PasteDetector.getInstance().startListening(context);

    // Initialize Snippet Store
    const snippetStore = SnippetStore.getInstance();
    if (context.storageUri) {
        snippetStore.init(path.join(context.storageUri.fsPath, 'snippets'));
    } else {
        snippetStore.init(path.join(context.globalStorageUri.fsPath, 'snippets'));
    }

    // Initialize Status Bar Controller (Sensitivity)
    const statusBarController = new StatusBarController(context); // Manages its own disposables

    // Command: Smart Copy (Universal AI Support)
    const smartClipboard = SmartClipboard.getInstance();
    let smartCopyDisposable = vscode.commands.registerCommand('engram.smartCopy', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            await smartClipboard.copy(editor);
        }
    });
    context.subscriptions.push(smartCopyDisposable);

    // Command: Toggle Sensitivity
    let toggleSensitivityDisposable = vscode.commands.registerCommand('engram.toggleSensitivity', async () => {
        await statusBarController.toggle();
    });
    context.subscriptions.push(toggleSensitivityDisposable);

    // --- SHADOW GUARD ---
    const shadowScanner = ShadowScanner.getInstance();
    shadowScanner.startListening(context);

    // Code Actions
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            { scheme: 'file' },
            new ShadowCodeActionProvider(),
            { providedCodeActionKinds: ShadowCodeActionProvider.providedCodeActionKinds }
        )
    );

    // Commands for Code Actions
    context.subscriptions.push(vscode.commands.registerCommand('engram.updateRuleLevel', (ruleId, level) => {
        const fp = detector.getFingerprint(ruleId);
        if (fp) {
            fp.enforcementLevel = level;
            detector.updateFingerprint(fp); // Need to expose update method or modify reference
            shadowScanner.updateDiagnostics();
            console.log(`[ShadowGuard] Rule ${ruleId} updated to ${level}`);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('engram.addRuleScopeException', (ruleId, scope) => {
        const fp = detector.getFingerprint(ruleId);
        if (fp) {
            if (!fp.ignoredScopes) fp.ignoredScopes = [];
            fp.ignoredScopes.push(scope);
            shadowScanner.updateDiagnostics();
            console.log(`[ShadowGuard] Rule ${ruleId} ignored for ${scope}`);
        }
    }));

    // Connect Paste Detector to Snippet Store (Reuse Only, No Security Check)
    const pasteDisposable = PasteDetector.getInstance().onPasteDetected(async (event) => {
        // 1. Search for existing snippet (Similarity Search)
        const existing = snippetStore.findSnippet(event.normalized);
        const crypto = require('crypto');
        const hash = crypto.createHash('sha256').update(event.normalized).digest('hex');

        if (existing) {
            console.log(`[Extension] REUSE DETECTED! Found snippet ${hash.substring(0, 8)} (Used ${existing.useCount} times).`);
            // Update usage (increment useCount and update timestamp)
            await snippetStore.saveSnippet({
                ...existing,
                timestamp: Date.now(),
                useCount: existing.useCount + 1,
                origin: existing.origin
            });

            // Trigger Reuse Suggestion / Notification
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
                origin: 'paste',
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
            const doc = await vscode.workspace.openTextDocument({
                content: selected.snippet.content,
                language: selected.snippet.language
            });
            await vscode.window.showTextDocument(doc, {
                preview: false,
                viewColumn: vscode.ViewColumn.Beside
            });

            vscode.window.showInformationMessage('Snippet opened. Edit or copy parts of it to reuse safely.');
        }
    });
    context.subscriptions.push(searchSnippetsDisposable);

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
                picked: true
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

                const leftUri = vscode.Uri.parse(`untitled:Before-Fix-${selected.fix.id}`);
                const rightUri = vscode.Uri.parse(`untitled:After-Fix-${selected.fix.id}`);

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

        const leftContent = fix.before || `// 'Before' snapshot unavailable. \n// Showing raw diff instead:\n${fix.diff}`;
        const rightContent = fix.after || fix.diff;

        const leftUri = vscode.Uri.parse(`untitled:Before-Fix-${fix.id}`);
        const rightUri = vscode.Uri.parse(`untitled:After-Fix-${fix.id}`);

        const edit = new vscode.WorkspaceEdit();
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

    // Command: Import Rules (JSON)
    let importRulesDisposable = vscode.commands.registerCommand('engram.importRules', async () => {
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { 'JSON': ['json'] },
            openLabel: 'Import Rules'
        });

        if (uris && uris[0]) {
            try {
                const content = await vscode.workspace.fs.readFile(uris[0]);
                const rules = JSON.parse(new TextDecoder().decode(content));
                if (Array.isArray(rules)) {
                    const count = await detector.importRules(rules);
                    vscode.window.showInformationMessage(`Successfully imported ${count} new rules into Engram.`);
                    shadowScanner.updateDiagnostics(); // Refresh
                } else {
                    vscode.window.showErrorMessage('Invalid file format. Expected an array of rules.');
                }
            } catch (e) {
                vscode.window.showErrorMessage(`Failed to import rules: ${e}`);
            }
        }
    });
    context.subscriptions.push(importRulesDisposable);

    // Command: Load Starter Kit
    let starterKitDisposable = vscode.commands.registerCommand('engram.loadStarterKit', async () => {
        try {
            const kitPath = path.join(context.extensionPath, 'src', 'starter_kit.json');
            // Check if exists (dev mode vs prod mode issues?) 
            // In prod, 'src' might not exist in the same way. 
            // We should ideally bundle it or read it from 'out' or root.
            // For resilience, let's try root/src or just assume it's bundled.
            // A safer bet for now is to just inline the data OR make sure we copy it.
            // Note: We need to ensure starter_kit.json is copied to 'out' or 'dist' in a real build.
            // For this environment, we'll read it from where we wrote it.

            // Simpler: Just define it inline to avoid FS issues in build?
            // "Hack Engram" spirit prefers external file, but reliability prefers inline.
            // Let's use the file but fallback to reading it via 'require' if possible, or just fs.
            // Wait, we are in 'out/extension.js' usually. 'src' is sibling in dev.

            // Re-use logic: Ask user if they confirm?
            const selection = await vscode.window.showInformationMessage(
                "Load 'Engram Starter Kit'? (Includes checks for Secrets, Console Logs, and React Keys)",
                "Yes, Load It", "Cancel"
            );

            if (selection === "Yes, Load It") {
                // Read via FS
                // We wrote it to src/starter_kit.json.
                // In extension mode: context.extensionPath/src/starter_kit.json
                const kitUri = vscode.Uri.file(path.join(context.extensionPath, 'src', 'starter_kit.json'));
                // Note: User needs to ensure this file is included in VSIX. 
                // I will add it to package.json files/vsceignore later. 

                const content = await vscode.workspace.fs.readFile(kitUri);
                const rules = JSON.parse(new TextDecoder().decode(content));
                const count = await detector.importRules(rules);
                vscode.window.showInformationMessage(`Starter Kit Loaded! Added ${count} rules.`);
                shadowScanner.updateDiagnostics();
            }
        } catch (e) {
            vscode.window.showErrorMessage(`Could not load Starter Kit: ${e}`);
        }
    });
    context.subscriptions.push(starterKitDisposable);

    console.log('[Engram] Activated (Features: Mistake Shield, Memory Cards, Starter Kit).');
}

export function deactivate() { }
