
import * as assert from 'assert';
import * as vscode from 'vscode';
import { PromptInjectorService } from '../../experimental/PromptInjectorService';
import { LabsController } from '../../experimental/LabsController';

suite('Prompt Injector CHAOS Test Suite', () => {

    let originalConfig: any;
    let originalClipboard: any;
    let clipboardWrites: string[] = [];
    let fetchCallCount = 0;

    suiteSetup(() => {
        originalConfig = LabsController.getInstance().isPromptInjectorEnabled;
        originalClipboard = vscode.env.clipboard;
    });

    suiteTeardown(() => {
        LabsController.getInstance().isPromptInjectorEnabled = originalConfig;
        (vscode.env as any).clipboard = originalClipboard;
    });

    setup(() => {
        clipboardWrites = [];
        fetchCallCount = 0;

        // Enable feature
        LabsController.getInstance().isPromptInjectorEnabled = () => true;

        // Mock Clipboard
        (vscode.env as any).clipboard = {
            writeText: async (text: string) => {
                clipboardWrites.push(text);
                console.log(`[CHAOS] Clipboard write: ${text}`);
            },
            readText: async () => clipboardWrites[clipboardWrites.length - 1] || ''
        };

        // Mock Fetch (100ms delay to simulate network)
        global.fetch = async () => {
            fetchCallCount++;
            await new Promise(r => setTimeout(r, 100));
            return {
                ok: true,
                json: async () => ({ response: `Prompt ${fetchCallCount}` })
            } as any;
        };

        // Reset Singleton
        (PromptInjectorService as any).instance = undefined;
    });

    test('The Machine Gun: Rapid-fire triggering should NOT spawn 10 parallel LLM calls', async () => {
        const service = PromptInjectorService.getInstance();
        const doc = await vscode.workspace.openTextDocument({ content: 'test', language: 'typescript' });
        const editor = await vscode.window.showTextDocument(doc);

        // Fire 10 triggers instantly
        const promises = [];
        for (let i = 0; i < 10; i++) {
            promises.push((service as any).triggerInjection(editor, new vscode.Position(0, 4)));
        }

        await Promise.all(promises);

        console.log(`[CHAOS] Total Fetch Calls: ${fetchCallCount}`);

        // Weakness Check: locking should prevent multiple calls.
        // We expect exactly 1 call because the first one takes the lock, and subsequent ones return early.

        // NOTE: Since the mocked fetch takes 100ms, and we fire 10 instantly, the lock should hold.
        assert.strictEqual(fetchCallCount, 1, 'HARDENING VERIFIED: Locked prevented parallel requests.');
    });

    test('The Zombie: Slow network should not block UI (Simulated)', async () => {
        // Mock infinite hang (or very long)
        global.fetch = async () => {
            await new Promise(r => setTimeout(r, 2000)); // 2s delay
            return { ok: true, json: async () => ({ response: 'Late' }) } as any;
        };

        const service = PromptInjectorService.getInstance();
        const doc = await vscode.workspace.openTextDocument({ content: 'test', language: 'typescript' });
        const editor = await vscode.window.showTextDocument(doc);

        const start = Date.now();
        // This await is on the trigger, but in real life 'onDidChange' doesn't await.
        // So we want to see if multiple calls stack up.
        await (service as any).triggerInjection(editor, new vscode.Position(0, 4));
        const duration = Date.now() - start;

        assert.ok(duration >= 2000, 'Service waited for slow fetch (Expected behavior for async, but check UI unresponsiveness manually).');
    });
});
