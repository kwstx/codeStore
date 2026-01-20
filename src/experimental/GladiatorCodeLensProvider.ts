import * as vscode from 'vscode';
import { LabsController } from './LabsController';
import { GladiatorArena } from './gladiator';

export class GladiatorCodeLensProvider implements vscode.CodeLensProvider {

    public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] {
        if (!LabsController.getInstance().isOptInDuelEnabled()) {
            return [];
        }

        const lenses: vscode.CodeLens[] = [];
        const text = document.getText();

        // Simple Regex to find functions/classes (Proof of Concept)
        // Matches "function foo()", "class Bar", "export const baz = () =>"
        const regex = /(function\s+\w+|class\s+\w+|export\s+(const|var|let)\s+\w+\s*=\s*(\(|async))/g;

        let match;
        while ((match = regex.exec(text)) !== null) {
            const line = document.positionAt(match.index).line;
            const range = new vscode.Range(line, 0, line, 0);

            // The "Challenge" Button
            const cmd: vscode.Command = {
                title: "⚔️ Challenge",
                tooltip: "Send this code to the Gladiator Arena for critique",
                command: "engram.gladiatorChallenge",
                arguments: [document, range]
            };

            lenses.push(new vscode.CodeLens(range, cmd));
        }

        return lenses;
    }
}
