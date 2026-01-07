import * as vscode from 'vscode';

export class StatusBarController {
    private statusBarItem: vscode.StatusBarItem;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.command = 'engram.toggleSensitivity';
        this.context.subscriptions.push(this.statusBarItem);

        this.updateDisplay();
        this.statusBarItem.show();

        // Listen for config changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('engram.sensitivity')) {
                this.updateDisplay();
            }
        });
    }

    private updateDisplay() {
        const config = vscode.workspace.getConfiguration('engram');
        const sensitivity = config.get<string>('sensitivity', 'breeze');

        if (sensitivity === 'strict') {
            this.statusBarItem.text = '$(shield-check) Engram: Strict';
            this.statusBarItem.tooltip = 'Strict Mode: Warnings on first repeat. Click to switch to Breeze.';
        } else {
            this.statusBarItem.text = '$(shield) Engram: Breeze';
            this.statusBarItem.tooltip = 'Breeze Mode: Warnings only on bad habits (3+ repeats). Click to switch to Strict.';
        }
    }

    public async toggle() {
        const config = vscode.workspace.getConfiguration('engram');
        const current = config.get<string>('sensitivity', 'breeze');
        const next = current === 'breeze' ? 'strict' : 'breeze';

        await config.update('sensitivity', next, vscode.ConfigurationTarget.Global);
        // Display update handled by event listener
    }
}
