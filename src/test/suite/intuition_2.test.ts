
import * as assert from 'assert';
import * as vscode from 'vscode';
import { ShadowIntuition } from '../../experimental/IntuitionService';
import { LabsController } from '../../experimental/LabsController';

suite('Predictive Intuition 2.0 (Native API) Test Suite', () => {
    let originalFetch: any;

    setup(() => {
        // Mock Fetch globally
        originalFetch = global.fetch;
    });

    teardown(() => {
        global.fetch = originalFetch;
    });

    test('Should respect Dynamic Delay configuration', async () => {
        // Mock Controller to return custom delay
        const mockController = {
            isPredictiveIntuitionEnabled: () => true,
            getIntuitionDelay: () => 50, // Fast for test

        } as LabsController;
        LabsController.setInstance(mockController);

        const service = ShadowIntuition.getInstance();

        // Mock Token
        const tokenSource = new vscode.CancellationTokenSource();
        const token = tokenSource.token;

        // Mock Document & Position
        const document = {
            offsetAt: () => 0,
            getText: () => 'console.log("hello");',
            lineAt: () => ({ text: 'console.log("hello");' })
        } as unknown as vscode.TextDocument;
        const position = new vscode.Position(0, 10);

        const start = Date.now();
        // We mock fetch to just return immediately so we measure the DELAY mainly
        global.fetch = async () => ({
            ok: true,
            json: async () => ({ response: 'console.log("world");' })
        } as any);

        // Run provider
        await service.provideInlineCompletionItems(document, position, {} as any, token);

        const duration = Date.now() - start;
        assert.ok(duration >= 50, 'Should wait at least the configured delay time');
        // We accept some overhead, but it shouldn't be instant if delay is 50ms
    });

    test('FIM: Should include Suffix in prompt', async () => {
        const mockController = {
            isPredictiveIntuitionEnabled: () => true,
            getIntuitionDelay: () => 0,

        } as LabsController;
        LabsController.setInstance(mockController);

        const service = ShadowIntuition.getInstance();

        // Document: "pre { cursor } post"
        const text = 'function test() {  }';
        const document = {
            offsetAt: (pos: any) => 18, // inside the braces
            getText: () => text,
            lineAt: () => ({ text: 'function test() {  }' })
        } as unknown as vscode.TextDocument;
        const position = new vscode.Position(0, 18);

        let capturedPrompt = '';
        global.fetch = async (url: any, options: any) => {
            const body = JSON.parse(options.body);
            capturedPrompt = body.prompt;
            return {
                ok: true,
                json: async () => ({ response: '' })
            } as any;
        };

        await service.provideInlineCompletionItems(document, position, {} as any, new vscode.CancellationTokenSource().token);

        assert.ok(capturedPrompt.includes('PREFIX:'), 'Prompt should have PREFIX section');
        assert.ok(capturedPrompt.includes('SUFFIX:'), 'Prompt should have SUFFIX section');
        assert.ok(capturedPrompt.includes('function test() {'), 'Prompt should contain prefix content');
        assert.ok(capturedPrompt.includes('}'), 'Prompt should contain suffix content');
    });

    test('Prompt Director: Should detect comments', async () => {
        const mockController = {
            isPredictiveIntuitionEnabled: () => true,
            getIntuitionDelay: () => 0,

        } as LabsController;
        LabsController.setInstance(mockController);

        const service = ShadowIntuition.getInstance();

        // Line is a comment
        const document = {
            offsetAt: () => 10,
            getText: () => '// Refactor this',
            lineAt: () => ({ text: '// Refactor this' })
        } as unknown as vscode.TextDocument;
        const position = new vscode.Position(0, 10);

        let capturedPrompt = '';
        global.fetch = async (url: any, options: any) => {
            const body = JSON.parse(options.body);
            capturedPrompt = body.prompt;
            return {
                ok: true,
                json: async () => ({ response: '' })
            } as any;
        };

        await service.provideInlineCompletionItems(document, position, {} as any, new vscode.CancellationTokenSource().token);

        // Check if the specialized rule was added
        assert.ok(capturedPrompt.includes('Ask AI:'), 'Prompt should include instructions for Director Mode');
    });

    test('Robustness: Should abort on cancellation', async () => {
        const mockController = {
            isPredictiveIntuitionEnabled: () => true,
            getIntuitionDelay: () => 100, // Long enough to cancel

        } as LabsController;
        LabsController.setInstance(mockController);

        const service = ShadowIntuition.getInstance();
        const tokenSource = new vscode.CancellationTokenSource();

        // Cancel immediately
        tokenSource.cancel();

        const result = await service.provideInlineCompletionItems({
            offsetAt: () => 0, getText: () => '', lineAt: () => ({ text: '' })
        } as any, new vscode.Position(0, 0), {} as any, tokenSource.token);

        assert.strictEqual(result, null, 'Should return null if cancelled');
    });
});
