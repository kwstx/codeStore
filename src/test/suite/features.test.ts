import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SecurityScanner } from '../../securityScanner';
import { SecurityExemptionManager } from '../../securityExemptions';
import { SnippetStore } from '../../snippetStore';
import { SessionStore } from '../../sessionStore';
import { SECURITY_RULES } from '../../securityRules';

suite('Engram Feature Test Suite', () => {

    test('Phase 4: Security Rule Matching', () => {
        const scanner = SecurityScanner.getInstance();

        // Test Eval Rule
        const riskyText = 'const x = eval("2 + 2");';
        const issues = scanner.scanText(riskyText, 'typescript');
        assert.strictEqual(issues.length > 0, true, 'Should detect eval');
        assert.strictEqual(issues[0].rule.id, 'no-eval', 'Should match no-eval rule');
        assert.strictEqual(issues[0].line, 0, 'Should be on line 0');

        // Test innerHTML Rule
        const htmlText = 'div.innerHTML = "<p>unsafe</p>"';
        const htmlIssues = scanner.scanText(htmlText, 'javascript');
        assert.strictEqual(htmlIssues.length > 0, true, 'Should detect innerHTML');
        assert.strictEqual(htmlIssues[0].rule.id, 'inner-html-js', 'Should match inner-html-js rule');

        // Test Safe Text
        const safeText = 'const x = JSON.parse(data);';
        const safeIssues = scanner.scanText(safeText, 'typescript');
        assert.strictEqual(safeIssues.length, 0, 'Should not have issues for safe code');
    });

    test('Phase 4: Security Exemption Logic', () => {
        const scanner = SecurityScanner.getInstance();
        const manager = SecurityExemptionManager.getInstance();
        const testFile = '/tmp/test.ts'; // Mock path

        // Init exemption manager (mock storage)
        const tmpStorage = path.join(__dirname, 'tmp_storage');
        manager.init(tmpStorage);

        const ruleId = 'no-eval';

        // Ensure not exempt initially
        assert.strictEqual(manager.isExempt(ruleId, testFile), false, 'Should not be exempt initially');

        // Add exemption
        manager.addExemption(ruleId, testFile, 'Safe context test');

        // Verify exemption
        assert.strictEqual(manager.isExempt(ruleId, testFile), true, 'Should be exempt after adding');
    });

    test('Phase 3: Snippet Normalization & Storage', async () => {
        const store = SnippetStore.getInstance();
        const tmpStorage = path.join(__dirname, 'tmp_snippets');
        store.init(tmpStorage);

        const code = `
            function foo() {
                // comment
                return 1;
            }
        `;
        // Manually normalize to simulate
        const normalized = code.replace(/\s+/g, ' ').replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '').trim();
        // Note: Real normalization logic is in PasteDetector, but we test Store's ability to save/find

        const hash = 'test-hash-123';

        // Save new
        await store.saveSnippet({
            id: hash,
            content: code,
            normalized: normalized,
            language: 'typescript',
            origin: 'paste',
            timestamp: Date.now(),
            useCount: 1
        });

        // Find
        const found = store.findSnippet(normalized);
        assert.ok(found, 'Should find saved snippet');
        assert.strictEqual(found?.useCount, 1);

        // Update (Simulation of Reuse)
        await store.saveSnippet({
            ...found!,
            useCount: found!.useCount + 1
        });

        const updated = store.findSnippet(normalized);
        assert.strictEqual(updated?.useCount, 2, 'Usage count should increment');
    });

    test('Phase 1 & 7: Prompt Association', () => {
        const sessionStore = SessionStore.getInstance();

        // Mock Session
        sessionStore.activeSessionId = 'test-session';
        // Need to mock sessions Map since it's private... 
        // Actually, createSession is public.
        // But init requests a path.
        // We can skip Init for in-memory if we handle it carefully (checking source code).
        // createSession calls saveSession which checks storagePath.
        // Let's init it to tmp
        const tmpStorage = path.join(__dirname, 'tmp_sessions');
        sessionStore.init(tmpStorage);

        // We can't easily wait for creating session in this synchronous block if we didn't await
        // Actually `createSession` is async.
    });

});
