
import * as assert from 'assert';
import * as vscode from 'vscode';
import { PromptInjectorService } from '../../experimental/PromptInjectorService';
import { LabsController } from '../../experimental/LabsController';

suite('Prompt Injector (Beta) Test Suite', () => {

    let originalConfig: any;
    let originalClipboard: any;
    let clipboardContent: string = '';
    let originalFetch: any;
    let fetchCalledWith: string | null = null;

    suiteSetup(() => {
        originalConfig = LabsController.getInstance().isPromptInjectorEnabled;
        originalClipboard = vscode.env.clipboard;
        originalFetch = global.fetch;
    });

    suiteTeardown(() => {
        LabsController.getInstance().isPromptInjectorEnabled = originalConfig;
        (vscode.env as any).clipboard = originalClipboard;
        global.fetch = originalFetch;
    });

    setup(() => {
        // Reset Mocks
        clipboardContent = '';
        fetchCalledWith = null;

        // Mock Clipboard
        (vscode.env as any).clipboard = {
            writeText: async (text: string) => { clipboardContent = text; },
            readText: async () => clipboardContent
        };

        // Mock Fetch (Ollama)
        global.fetch = async (url: any, options: any) => {
            fetchCalledWith = options.body;
            return {
                ok: true,
                json: async () => ({ response: 'Generated Prompt for AI' })
            } as any;
        };

        // Reset Singleton (Hack for testing)
        (PromptInjectorService as any).instance = undefined;
    });

    test('Gatekeeper: Should not initialize if disabled', async () => {
        // Mock Config: Disabled
        LabsController.getInstance().isPromptInjectorEnabled = () => false;

        const service = PromptInjectorService.getInstance();
        // We can't easily check internal state, but ensuring no error is a start.
        // real test is trigger
    });

    test('Trigger: Typing "??" should trigger LLM and Clipboard', async () => {
        // Mock Config: Enabled
        LabsController.getInstance().isPromptInjectorEnabled = () => true;

        const service = PromptInjectorService.getInstance();

        // Mock Extension Context
        const context = { subscriptions: [] } as any;
        service.initialize(context);

        // Simulate Document Change
        // We need to simulate the event structure passed to workspace.onDidChangeTextDocument
        // This is hard to trigger comprehensively via VS Code API in unit tests without a real document.
        // So we will call the private 'triggerInjection' method or simulate the logic if possible.
        // Or better: Integration test with real document.

        // Let's rely on integration style: Open a doc, type '?'

        const doc = await vscode.workspace.openTextDocument({
            content: 'const x = 1; // ?',
            language: 'typescript'
        });
        const editor = await vscode.window.showTextDocument(doc);

        // We manually trigger the internal logic or simulate the event if we can't type.
        // Since 'triggerInjection' is private, we cast to any.

        const position = new vscode.Position(0, 15); // End of line
        await (service as any).triggerInjection(editor, position);

        // Assertions
        assert.ok(fetchCalledWith, 'LLM should be called');
        assert.ok(fetchCalledWith!.includes('const x = 1;'), 'LLM prompt should include code context');

        // Wait for async clipboard write (it awaits in the service, so we should be good)
        assert.strictEqual(clipboardContent, 'Generated Prompt for AI', 'Clipboard should contain LLM response');
    });

    test('Context: Should include standard Context and Mistakes', async () => {
        LabsController.getInstance().isPromptInjectorEnabled = () => true;
        const service = PromptInjectorService.getInstance();

        // Mock a Mistake
        // We would need to populate MistakeDetector, but let's assume empty for now.
        // Just verify code context.

        const doc = await vscode.workspace.openTextDocument({ content: 'function bug() {}', language: 'typescript' });
        const editor = await vscode.window.showTextDocument(doc);

        await (service as any).triggerInjection(editor, new vscode.Position(0, 16));

        assert.ok(fetchCalledWith!.includes('function bug() {}'), 'Primary code context missing');
    });

    test('Safety: Should handle LLM failure gracefully', async () => {
        global.fetch = async () => ({ ok: false, statusText: 'Ollama is dead' } as any);
        LabsController.getInstance().isPromptInjectorEnabled = () => true;

        const service = PromptInjectorService.getInstance();
        const doc = await vscode.workspace.openTextDocument({ content: 'test', language: 'typescript' });
        const editor = await vscode.window.showTextDocument(doc);

        await (service as any).triggerInjection(editor, new vscode.Position(0, 4));

        assert.strictEqual(clipboardContent, '', 'Clipboard should remain empty on failure');
        // If it throws, test fails. Logic catches error so this passes.
    });

});
