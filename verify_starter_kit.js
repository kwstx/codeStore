const assert = require('assert');
const path = require('path');
const fs = require('fs');

// --- MOCKS ---
const vscode = {
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    Diagnostic: class {
        constructor(range, message, severity) {
            this.range = range;
            this.message = message;
            this.severity = severity || 0;
            this.code = null;
            this.source = '';
        }
    },
    Range: class { constructor(sl, sc, el, ec) { } },
    Uri: { parse: (s) => ({ fsPath: s, toString: () => s }) },
    languages: {
        createDiagnosticCollection: () => ({
            set: (uri, diags) => { global.mockDiagnostics = diags; },
            dispose: () => { }
        }),
        registerCodeActionsProvider: () => ({ dispose: () => { } })
    },
    workspace: {
        onDidChangeTextDocument: () => ({ dispose: () => { } }),
        onDidOpenTextDocument: () => ({ dispose: () => { } }),
    },
    window: { activeTextEditor: null },
    EventEmitter: class {
        constructor() { this.listeners = []; }
        fire(e) { this.listeners.forEach(l => l(e)); }
        event(listener) { this.listeners.push(listener); return { dispose: () => { } }; }
    }
};

const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (path) {
    if (path === 'vscode') return vscode;
    return originalRequire.apply(this, arguments);
};

let MistakeDetector, ShadowScanner;
try {
    MistakeDetector = require('./out/mistakeDetector').MistakeDetector;
    ShadowScanner = require('./out/shadowScanner').ShadowScanner;
} catch (e) {
    console.error("❌ Compile first!", e);
    process.exit(1);
}

async function runStarterKitTest() {
    console.log("📦 Running Rule Starter Kit Verification...");

    // 1. Setup
    const testStoragePath = path.join(__dirname, 'tmp_starter_test');
    if (fs.existsSync(testStoragePath)) {
        fs.rmSync(testStoragePath, { recursive: true, force: true });
    }

    const detector = MistakeDetector.getInstance();
    // Reset internal state manually since it's a singleton
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Object.defineProperty(detector, 'fingerprints', { value: new Map() });

    detector.init(testStoragePath);

    // 2. Load Starter Kit JSON
    const kitPath = path.join(__dirname, 'src', 'starter_kit.json');
    if (!fs.existsSync(kitPath)) {
        throw new Error("Starter Kit JSON missing!");
    }
    const kitContent = fs.readFileSync(kitPath, 'utf8');
    const rules = JSON.parse(kitContent);

    console.log(`[Test] read ${rules.length} rules from starter_kit.json`);

    // 3. Import Rules
    const count = await detector.importRules(rules);
    assert.strictEqual(count, 5, "Should import exactly 5 rules");
    console.log("✔ Import count verified");

    // 4. Verify Rule Properties
    const fingerprints = detector.getAllFingerprints();
    const awsRule = fingerprints.find(f => f.id === 'starter-secrets-aws');
    assert.ok(awsRule, "AWS Rule must exist");
    assert.strictEqual(awsRule.pattern, "(AKIA|ASIA)[A-Z0-9]{16}");
    assert.strictEqual(awsRule.enforcementLevel, "error");

    // 5. Verify Shadow Scanner uses them
    const scanner = ShadowScanner.getInstance();
    scanner.startListening({ subscriptions: [] }); // Dummy context (re-init)

    // Mock Document with AWS Secret
    const docSecret = {
        uri: { scheme: 'file', fsPath: '/src/config.ts' },
        fileName: '/src/config.ts',
        getText: () => "const aws = 'AKIAIOSFODNN7EXAMPLE';",
        positionAt: (o) => ({ line: 0, char: o })
    };

    global.mockDiagnostics = [];
    // Access private method
    scanner['scanDocument'](docSecret);

    assert.strictEqual(global.mockDiagnostics.length, 1, "Shadow Scanner should detect imported rule");
    assert.strictEqual(global.mockDiagnostics[0].severity, vscode.DiagnosticSeverity.Error, "AWS should be Error");
    console.log("✔ Shadow Scanner verification passed");

    console.log("✅ STARTER KIT SYSTEM VERIFIED");

    // Cleanup
    if (fs.existsSync(testStoragePath)) {
        fs.rmSync(testStoragePath, { recursive: true, force: true });
    }
}

runStarterKitTest().catch(console.error);
