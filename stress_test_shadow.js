const assert = require('assert');

// --- MOCKS ---
const vscode = {
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2 },
    Diagnostic: class { constructor(range, message, severity) { this.message = message; this.severity = severity || 0; } },
    Range: class { constructor(sl, sc, el, ec) { } },
    Uri: { parse: (s) => ({ fsPath: s }) },
    languages: { createDiagnosticCollection: () => ({ set: () => { }, dispose: () => { } }) },
    workspace: { onDidChangeTextDocument: () => ({ dispose: () => { } }), onDidOpenTextDocument: () => ({ dispose: () => { } }) },
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

let ShadowScanner, MistakeDetector;
try {
    ShadowScanner = require('./out/shadowScanner').ShadowScanner;
    MistakeDetector = require('./out/mistakeDetector').MistakeDetector;
} catch (e) { console.error(e); process.exit(1); }

async function runStressTest() {
    console.log("🔥 STARTING SHADOW GUARD RED TEAMING 🔥");

    const detector = MistakeDetector.getInstance();
    const scanner = ShadowScanner.getInstance();

    // Test 1: Catastrophic Backtracking (ReDoS)
    console.log("\n[Test 1] Evil Regex (ReDoS Attack)");
    const map = new Map();
    map.set('redos', {
        id: 'redos',
        pattern: '(x+x+)+y', // Classic ReDoS pattern
        detectionMethod: 'regex',
        enforcementLevel: 'error',
        count: 5
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Object.defineProperty(detector, 'fingerprints', { value: map });

    const evilText = "x".repeat(25) + "!"; // Trigger backtracking (short enough to test, long enough to slow)
    // Actually 25 chars might be instant in V8 modern engine, usually need more.
    // But let's see if it crashes or hangs.

    const start = Date.now();
    const docReDoS = {
        uri: { scheme: 'file', fsPath: 'redos.ts' },
        fileName: 'redos.ts',
        getText: () => evilText,
        positionAt: (o) => ({ line: 0, char: o })
    };

    try {
        scanner['scanDocument'](docReDoS);
        const duration = Date.now() - start;
        console.log(`⏱️ Scan time: ${duration}ms`);
        if (duration > 100) {
            console.warn("⚠️ WEAKNESS: Regex performance impacted by backtracking.");
        } else {
            console.log("✅ PASSED: Regex engine handled it (or pattern too simple).");
        }
    } catch (e) {
        console.error("❌ FAILED: Regex crashed the scanner.", e);
    }


    // Test 2: Huge File Performance
    console.log("\n[Test 2] Massive File Scan (1MB)");
    const hugeText = "const safe = 1;\n".repeat(50000);
    const docHuge = {
        uri: { scheme: 'file', fsPath: 'huge.ts' },
        fileName: 'huge.ts',
        getText: () => hugeText,
        positionAt: (o) => ({ line: 0, char: o })
    };

    const startHuge = Date.now();
    scanner['scanDocument'](docHuge); // this runs sync
    const durationHuge = Date.now() - startHuge;
    console.log(`⏱️ Massive File Scan time: ${durationHuge}ms`);

    if (durationHuge > 50) { // Should include "Debounce" in real life, but logic is sync
        console.warn("⚠️ WEAKNESS: Large file scanning blocks the Event Loop.");
    } else {
        console.log("✅ PASSED: Scan is fast enough.");
    }

    // Test 3: Invalid Regex robustness
    console.log("\n[Test 3] Invalid Regex Injection");
    map.set('broken', {
        id: 'broken',
        pattern: '(', // Invalid regex
        detectionMethod: 'regex',
        enforcementLevel: 'error',
        count: 5
    });

    try {
        scanner['scanDocument'](docHuge); // Should gracefully ignore 'broken'
        console.log("✅ PASSED: Invalid regex did not crash scanner.");
    } catch (e) {
        console.error("❌ FAILED: Invalid regex crashed scanner!", e);
    }
}

runStressTest().catch(console.error);
