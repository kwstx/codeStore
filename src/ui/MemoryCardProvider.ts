import * as vscode from 'vscode';
import { MistakeDetector } from '../mistakeDetector';

export class MemoryCardProvider implements vscode.HoverProvider {
    public provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {

        // Get diagnostics at this exact position
        const diagnostics = vscode.languages.getDiagnostics(document.uri).filter(d => {
            return d.range.contains(position);
        });

        for (const diag of diagnostics) {
            // We only trigger if there is historical data for this error
            const card = MistakeDetector.getInstance().getMemoryCard(diag);

            if (card) {
                const markdown = new vscode.MarkdownString();
                markdown.isTrusted = true;

                markdown.appendMarkdown(`### 🧠 Engram Memory Card\n\n`);
                markdown.appendMarkdown(`**Why:** ${card.context}\n\n`);

                const timeAgo = Math.floor((Date.now() - card.lastSeen) / 1000);
                let timeString = `${timeAgo} seconds ago`;
                if (timeAgo > 60) {
                    const mins = Math.floor(timeAgo / 60);
                    timeString = `${mins} minute${mins > 1 ? 's' : ''} ago`;
                    if (mins > 60) {
                        const hours = Math.floor(mins / 60);
                        timeString = `${hours} hour${hours > 1 ? 's' : ''} ago`;
                    }
                }
                if (timeAgo > 86400) {
                    const days = Math.floor(timeAgo / 86400);
                    timeString = `${days} day${days > 1 ? 's' : ''} ago`;
                }

                markdown.appendMarkdown(`**When:** Last seen ${timeString} \n\n`);
                markdown.appendMarkdown(`**Past Action:** ${card.lastAction}\n\n`);

                if (card.consequence) {
                    markdown.appendMarkdown(`---\nWarning: ${card.consequence}\n\n`);
                }

                if (card.analysis) {
                    markdown.appendMarkdown(`---\n**Analysis:** ${card.analysis}\n\n`);
                }

                if (card.fixId && card.fingerprintId) {
                    const commandUri = vscode.Uri.parse(
                        `command:engram.replayFix?${encodeURIComponent(JSON.stringify([card.fingerprintId, card.fixId]))}`
                    );
                    markdown.appendMarkdown(`[$(history) Replay Fix](${commandUri} "Compare your past fix with current code")\n`);
                }

                return new vscode.Hover(markdown);
            }
        }

        return undefined;
    }
}
