import * as vscode from 'vscode';
import { SecurityExemptionManager } from './securityExemptions';

export class SecurityCodeActionProvider implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.QuickFix
    ];

    provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection, context: vscode.CodeActionContext, token: vscode.CancellationToken): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];

        // Look for Engram Security diagnostics
        for (const diagnostic of context.diagnostics) {
            if (diagnostic.source === 'Engram Security' && diagnostic.code) {
                const ruleId = diagnostic.code as string;

                // Action: Dismiss (Suppress)
                const dismissAction = new vscode.CodeAction(`Dismiss "${ruleId}" for this file`, vscode.CodeActionKind.QuickFix);
                dismissAction.command = {
                    command: 'engram.suppressSecurityWarning',
                    title: 'Dismiss Security Warning',
                    arguments: [ruleId, document.uri.fsPath]
                };
                dismissAction.diagnostics = [diagnostic];
                dismissAction.isPreferred = false;
                actions.push(dismissAction);
            }
        }

        return actions;
    }
}
