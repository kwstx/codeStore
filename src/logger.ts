import * as vscode from 'vscode';

export class Logger {
    private static instance: Logger;
    private outputChannel: vscode.OutputChannel;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel("Pattern Vault");
    }

    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    public log(message: string) {
        const timestamp = new Date().toLocaleTimeString();
        this.outputChannel.appendLine(`[${timestamp}] ${message}`);
        // console.log for debugging extension host
        console.log(`[PatternVault] ${message}`);
    }

    public show() {
        this.outputChannel.show(true);
    }
}
