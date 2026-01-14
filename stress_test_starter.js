const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { performance } = require('perf_hooks');

// --- MOCKS ---
const vscode = {
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    Diagnostic: class { constructor(r, m, s) { this.message = m; this.severity = s; } },
    Range: class { constructor() { } },
    Uri: { parse: (s) => ({ fsPath: s, toString: () => s }) },
    languages: { createDiagnosticCollection: () => ({ set: () => { }, dispose: () => { } }) },
    workspace: { onDidChangeTextDocument: () => ({ dispose: () => { } }), onDidOpenTextDocument: () => ({ dispose: () => { } }) },
    window: { activeTextEditor: null },
    EventEmitter: class { event() { return { dispose: () => { } }; } }
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
    console.error("❌ Compile first!");
    process.exit(1);
}

async function runStressTest() {
    console.log("🔥 RUNNING STARTER KIT STRESS TEST 🔥");
    const testStoragePath = path.join(__dirname, 'tmp_stress_starter');
    if (fs.existsSync(testStoragePath)) fs.rmSync(testStoragePath, { recursive: true, force: true });

    const detector = MistakeDetector.getInstance();
    Object.defineProperty(detector, 'fingerprints', { value: new Map() });
    detector.init(testStoragePath);

    // TEST 1: The "Death Regex" (ReDoS)
    console.log("\n[Test 1] Attempting ReDoS Attack...");
    const deathRule = [{
        id: "death-regex",
        pattern: "(x+x+)+y", // Classic Evil Regex
        detectionMethod: "regex",
        enforcementLevel: "error"
    }];

    await detector.importRules(deathRule);

    const scanner = ShadowScanner.getInstance();
    // scanner.startListening({ subscriptions: [] }); // Not strictly needed for this unit test

    const longString = "x".repeat(25) + "!"; // Trigger backtracking (but keep it small enough to not hang FOREVER if it fails)
    const doc = {
        uri: { scheme: 'file', fsPath: 'test.js' },
        fileName: 'test.js',
        getText: () => longString,
        positionAt: () => ({})
    };

    const start = performance.now();
    try {
        scanner['scanDocument'](doc);
        const duration = performance.now() - start;
        console.log(`✅ ReDoS Survived! Took ${duration.toFixed(2)}ms`);
        if (duration > 1000) console.warn("⚠️  WARNING: Scan took > 1s. ReDoS vulnerability likely exists.");
    } catch (e) {
        console.error("❌ CRASHED on ReDoS:", e);
    }

    // TEST 2: Massive Load (10k Rules)
    console.log("\n[Test 2] Importing 10,000 Rules...");
    const bulkRules = [];
    for (let i = 0; i < 10000; i++) {
        bulkRules.push({
            id: `bulk-${i}`,
            pattern: `console\\.log\\('${i}'\\)`,
            detectionMethod: "regex",
            enforcementLevel: "silent"
        });
    }

    const startImport = performance.now();
    const count = await detector.importRules(bulkRules);
    const durationImport = performance.now() - startImport;

    assert.strictEqual(count, 10000);
    console.log(`✅ Imported 10k rules in ${durationImport.toFixed(2)}ms`);

    // Verify Scanning Performance with 10k rules loaded
    // scanning relies on iterating ALL rules. This might be slow.
    console.log("[Test 2.1] Scanning a file against 10,000 rules...");
    const simpleDoc = {
        uri: { scheme: 'file', fsPath: 'test.js' },
        fileName: 'test.js',
        getText: () => "const foo = 1;",
        positionAt: () => ({})
    };

    const startScan = performance.now();
    scanner['scanDocument'](simpleDoc);
    const durationScan = performance.now() - startScan;

    console.log(`✅ Scan against 10k rules took ${durationScan.toFixed(2)}ms`);
    if (durationScan > 100) {
        console.warn("⚠️  Performance Alert: High rule count slows down scanner significantly.");
    }

    // cleanup
    if (fs.existsSync(testStoragePath)) fs.rmSync(testStoragePath, { recursive: true, force: true });
}

runStressTest().catch(console.error);
