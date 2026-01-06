const assert = require('assert');
const path = require('path');
const fs = require('fs');

const OUT_DIR = path.join(__dirname, 'out');

async function run() {
    try {
        console.log('Loading modules from:', OUT_DIR);
        const { SecurityScanner } = require(path.join(OUT_DIR, 'securityScanner'));
        const { SecurityExemptionManager } = require(path.join(OUT_DIR, 'securityExemptions'));
        const { SnippetStore } = require(path.join(OUT_DIR, 'snippetStore'));

        console.log('Running Standalone Feature Verification...');

        // 1. Verify Security Scanner
        console.log('[Test] Security Scanner...');
        const scanner = SecurityScanner.getInstance();
        const text = 'eval("foo")';
        console.log(`Scanning text: "${text}"`);
        // We need to inspect the RULES inside scanner if possible, or just trust scanText
        const risky = scanner.scanText(text, 'typescript');

        console.log('Matches found:', risky.length);
        if (risky.length > 0) {
            console.log('First match rule:', risky[0].rule.id);
            console.log('First match line:', risky[0].line);
        } else {
            console.log('NO MATCHES FOUND. Rules might be empty or regex failing.');
        }

        assert.strictEqual(risky.length > 0, true, 'Should detect eval');
        assert.strictEqual(risky[0].rule.id, 'no-eval', 'Rule ID should be no-eval');
        console.log('PASS: Security Scanner');

        // 2. Verify Exemptions
        console.log('[Test] Exemption Manager...');
        const manager = SecurityExemptionManager.getInstance();
        const tmpDir = path.join(__dirname, 'tmp_verify');
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
        manager.init(tmpDir);

        const ruleId = 'no-eval';
        const file = 'test.ts';
        manager.addExemption(ruleId, file, 'Reason');
        const isExempt = manager.isExempt(ruleId, file);
        console.log(`Is Exempt (${ruleId}, ${file}):`, isExempt);
        assert.strictEqual(isExempt, true);
        console.log('PASS: Exemption Manager');

        // 3. Verify Snippet Store
        console.log('[Test] Snippet Store...');
        const store = SnippetStore.getInstance();
        store.init(path.join(tmpDir, 'snippets'));

        const code = "console.log('hello')";
        const normalized = "console.log('hello')";
        const hash = 'hash1';

        await store.saveSnippet({
            id: hash, content: code, normalized, language: 'js', origin: 'paste', timestamp: Date.now(), useCount: 1
        });

        const found = store.findSnippet(normalized);
        console.log('Snippet Found:', found ? found.id : 'undefined');
        if (found) console.log('Snippet UseCount:', found.useCount);

        assert.ok(found, 'Snippet should be found');
        assert.strictEqual(found.useCount, 1, 'Use count should be 1');
        console.log('PASS: Snippet Store');

        console.log('ALL CHECKS PASSED.');

    } catch (e) {
        console.error('Verification Failed:', e);
        process.exit(1);
    }
}

run();
