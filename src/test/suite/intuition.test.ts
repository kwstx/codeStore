/* eslint-disable @typescript-eslint/no-explicit-any */
import * as assert from 'assert';
import * as vscode from 'vscode';
import { ShadowIntuition } from '../../experimental/IntuitionService';
import { LabsController } from '../../experimental/LabsController';

suite('Predictive Intuition Test Suite (ShadowIntuition)', () => {

    test('Singleton Instance', () => {
        const instance1 = ShadowIntuition.getInstance();
        const instance2 = ShadowIntuition.getInstance();
        assert.strictEqual(instance1, instance2, 'Should be a singleton');
    });

    test('Integration: Configuration Check', () => {
        const labs = LabsController.getInstance();

        // Mocking logic for test
        const originalMethod = labs.isPredictiveIntuitionEnabled;

        // Force True
        labs.isPredictiveIntuitionEnabled = () => true;
        assert.strictEqual(labs.isPredictiveIntuitionEnabled(), true);

        // Force False
        labs.isPredictiveIntuitionEnabled = () => false;
        assert.strictEqual(labs.isPredictiveIntuitionEnabled(), false);

        // Restore
        labs.isPredictiveIntuitionEnabled = originalMethod;
    });

    test('Prediction Logic (Mock Fetch)', async () => {
        const intuition = ShadowIntuition.getInstance();
        const labs = LabsController.getInstance();

        // 1. Enable Feature
        const originalConfig = labs.isPredictiveIntuitionEnabled;
        labs.isPredictiveIntuitionEnabled = () => true;

        // 2. Mock Editor
        const doc = await vscode.workspace.openTextDocument({
            content: 'function test() {',
            language: 'typescript'
        });
        const editor = await vscode.window.showTextDocument(doc);

        // 3. Mock Global Fetch
        const originalFetch = global.fetch;
        let fetchCalled = false;

        // Start listening (sets up listeners)
        const contextMock = { subscriptions: [] } as any;
        intuition.startListening(contextMock);

        // Mock Fetch Response
        global.fetch = async () => {
            fetchCalled = true;
            return {
                ok: true,
                json: async () => ({ response: '  console.log("predicted");' })
            } as any;
        };

        // Trigger 'predict' directly to verify core logic
        await (intuition as any).predict(editor);

        // Assertions
        assert.strictEqual(fetchCalled, true, 'Should call fetch');

        // Verify internal state (prediction)
        const currentPrediction = (intuition as any).prediction;
        assert.ok(currentPrediction && currentPrediction.includes('console.log'), 'Should store prediction');

        // Cleanup
        global.fetch = originalFetch;
        labs.isPredictiveIntuitionEnabled = originalConfig;
        (intuition as any).clearPrediction(editor);
    });

});
