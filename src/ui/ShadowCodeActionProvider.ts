import * as vscode from 'vscode';
import { MistakeDetector } from '../mistakeDetector';
import { ShadowScanner } from '../shadowScanner';

export class ShadowCodeActionProvider implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.QuickFix
    ];

    public provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection, context: vscode.CodeActionContext): vscode.CodeAction[] | undefined {
        // Filter for our diagnostics
        const diagnostics = context.diagnostics.filter(d => d.source === 'Engram Shadow Guard');
        if (diagnostics.length === 0) return;

        const actions: vscode.CodeAction[] = [];

        for (const diagnostic of diagnostics) {
            const ruleId = typeof diagnostic.code === 'object' ? String(diagnostic.code.value) : String(diagnostic.code);

            // Action 1: Promote to Strict (if currently Info)
            if (diagnostic.severity === vscode.DiagnosticSeverity.Information) {
                const promote = this.createAction('🛡️ Promote to Strict Rule (Blocker)', ruleId, 'error', document);
                promote.diagnostics = [diagnostic];
                actions.push(promote);
            }

            // Action 2: Demote to Silent (Ignore globally)
            const ignore = this.createAction('🔇 Ignore Rule Globally', ruleId, 'silent', document);
            ignore.diagnostics = [diagnostic];
            actions.push(ignore);

            // Action 3: Ignore in this file type
            // e.g. "*.test.ts"
            const ext = document.fileName.split('.').pop(); // simple extension check
            if (ext) {
                const pattern = `**/*.${ext}`; // sloppy glob, but functional for MVP
                const ignoreScope = this.createScopeAction(`🙈 Ignore in .${ext} files`, ruleId, pattern);
                ignoreScope.diagnostics = [diagnostic];
                actions.push(ignoreScope);
            }
        }

        return actions;
    }

    private createAction(title: string, ruleId: string, targetLevel: 'silent' | 'info' | 'error', doc: vscode.TextDocument): vscode.CodeAction {
        const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
        action.command = {
            command: 'engram.updateRuleLevel',
            title: title,
            arguments: [ruleId, targetLevel]
        };
        return action;
    }

    private createScopeAction(title: string, ruleId: string, scope: string): vscode.CodeAction {
        const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
        action.command = {
            command: 'engram.addRuleScopeException',
            title: title,
            arguments: [ruleId, scope]
        };
        return action;
    }
}
