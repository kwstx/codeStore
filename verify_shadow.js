const assert = require('assert');
const path = require('path');

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
    Range: class { constructor(sl, sc, el, ec) { this.start = { line: sl, character: sc }; this.end = { line: el, character: ec }; } },
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
    // Mock EventEmitter for MistakeDetector
    EventEmitter: class {
        constructor() { this.listeners = []; }
        fire(e) { this.listeners.forEach(l => l(e)); }
        event(listener) { this.listeners.push(listener); return { dispose: () => { } }; }
    }
};

// --- MOCK MODULE LOADER ---
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (path) {
    if (path === 'vscode') return vscode;
    return originalRequire.apply(this, arguments);
};

let ShadowScanner, MistakeDetector;
try {
    ShadowScanner = require('./out/shadowScanner').ShadowScanner;
    MistakeDetector = require('./out/mistakeDetector').MistakeDetector;
} catch (e) {
    console.error("❌ Compile first!", e);
    process.exit(1);
}

async function runShadowTests() {
    console.log("🛡️ Running Shadow Guard Verification...");

    // 1. Setup Data
    const detector = MistakeDetector.getInstance();
    // Inject mock fingerprints
    const map = new Map();
    map.set('silent-rule', {
        id: 'silent-rule',
        pattern: 'bad_var',
        detectionMethod: 'regex',
        enforcementLevel: 'silent',
        count: 5
    });
    map.set('info-rule', {
        id: 'info-rule',
        pattern: 'todo_fix',
        detectionMethod: 'regex',
        enforcementLevel: 'info',
        count: 5
    });
    map.set('strict-rule', {
        id: 'strict-rule',
        pattern: 'DANGEROUS_EVAL',
        detectionMethod: 'regex',
        enforcementLevel: 'error',
        count: 5
    });
    map.set('scoped-rule', {
        id: 'scoped-rule',
        pattern: 'test_only',
        detectionMethod: 'regex',
        enforcementLevel: 'error',
        ignoredScopes: ['**/*.test.ts']
    });

    // Hack: Inject into private property
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Object.defineProperty(detector, 'fingerprints', { value: map });

    const scanner = ShadowScanner.getInstance();
    scanner.startListening({ subscriptions: [] }); // Dummy context

    // Helper to mock document behavior
    const createMockDoc = (path, content) => ({
        uri: { scheme: 'file', fsPath: path },
        fileName: path,
        getText: () => content,
        positionAt: (offset) => ({ line: 0, character: offset }) // Mock position
    });

    // 2. Test Silent Mode (Should NOT produce diagnostic)
    console.log("[Test 1] Silent Mode");
    global.mockDiagnostics = [];
    const docSilent = createMockDoc('/src/code.ts', "const x = bad_var;");
    // Access private method for testing
    scanner['scanDocument'](docSilent);
    assert.strictEqual(global.mockDiagnostics.length, 0, "Silent rule should not trigger diagnostic");
    console.log("✔ Silent verified");

    // 3. Test Info Mode (Blue Squiggle)
    console.log("[Test 2] Info Mode");
    const docInfo = createMockDoc('/src/code.ts', "const x = todo_fix;");
    scanner['scanDocument'](docInfo);
    assert.strictEqual(global.mockDiagnostics.length, 1);
    assert.strictEqual(global.mockDiagnostics[0].severity, vscode.DiagnosticSeverity.Information);
    console.log("✔ Info verified");

    // 4. Test Strict Mode (Red Error)
    console.log("[Test 3] Strict Mode");
    const docStrict = createMockDoc('/src/code.ts', "eval(DANGEROUS_EVAL);");
    scanner['scanDocument'](docStrict);
    assert.strictEqual(global.mockDiagnostics.length, 1);
    assert.strictEqual(global.mockDiagnostics[0].severity, vscode.DiagnosticSeverity.Error);
    console.log("✔ Strict verified");

    // 5. Test Scoped Exclusion
    console.log("[Test 4] Scoped Exclusion");
    const docTest = createMockDoc('/src/my.test.ts', "const x = test_only;");
    scanner['scanDocument'](docTest);
    assert.strictEqual(global.mockDiagnostics.length, 0, "Should be ignored in test file");

    const docReal = createMockDoc('/src/app.ts', "const x = test_only;");
    scanner['scanDocument'](docReal);
    assert.strictEqual(global.mockDiagnostics.length, 1, "Should trigger in normal file");
    console.log("✔ Scope Exclusion verified");

    console.log("\nALL SYSTEMS (Shadow Guard) READY 🛡️");
}

runShadowTests().catch(e => { console.error(e); process.exit(1); });
