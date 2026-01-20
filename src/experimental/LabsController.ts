import * as vscode from 'vscode';
import { OllamaService } from '../llm';

export class LabsController {
    private static instance: LabsController;

    private constructor() { }

    public static getInstance(): LabsController {
        if (!LabsController.instance) {
            LabsController.instance = new LabsController();
        }
        return LabsController.instance;
    }

    public isHypeManEnabled(): boolean {
        return vscode.workspace.getConfiguration('engram').get<boolean>('experimental.hypeMan', false);
    }

    public isGladiatorModeEnabled(): boolean {
        return vscode.workspace.getConfiguration('engram').get<boolean>('experimental.gladiatorMode', false);
    }

    public isOptInDuelEnabled(): boolean {
        return vscode.workspace.getConfiguration('engram').get<boolean>('experimental.optInDuel', false);
    }

    public getSecondaryModel(): string {
        return vscode.workspace.getConfiguration('engram').get<string>('experimental.secondaryModel', 'qwen2.5:0.5b');
    }
}
