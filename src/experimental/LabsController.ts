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

    // For testing
    public static setInstance(mock: LabsController) {
        LabsController.instance = mock;
    }



    public isPredictiveIntuitionEnabled(): boolean {
        return vscode.workspace.getConfiguration('engram').get<boolean>('experimental.predictiveIntuition', false);
    }



    public getIntuitionDelay(): number {
        return vscode.workspace.getConfiguration('engram').get<number>('experimental.intuitionDelay', 1200);
    }

    public isPhotographicMemoryEnabled(): boolean {
        return vscode.workspace.getConfiguration('engram').get<boolean>('experimental.photographicMemory', false);
    }

    public isHippocampusEnabled(): boolean {
        return vscode.workspace.getConfiguration('engram').get<boolean>('experimental.hippocampus', false);
    }

    public isArchitectEnabled(): boolean {
        return vscode.workspace.getConfiguration('engram').get<boolean>('experimental.architect', false);
    }
}
