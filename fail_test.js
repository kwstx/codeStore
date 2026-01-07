const assert = require('assert');
const crypto = require('crypto');

// --- MOCKS (Same as before) ---
const vscode = {
    DiagnosticSeverity: { Error: 0, Warning: 1 },
    Diagnostic: class { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity || 0; } },
    Range: class { constructor(sl, sc, el, ec) { this.start = { line: sl, character: sc }; this.end = { line: el, character: ec }; } },
    EventEmitter: class { fire() { } event() { } },
    workspace: { getConfiguration: () => ({ get: (k, d) => d }) },
    Uri: { parse: s => ({ fsPath: s, toString: () => s }) }
};

class MistakeDetector {
    constructor() { this.fingerprints = new Map(); }
    fingerprintError(diag) {
        if (!diag || !diag.message) return { hash: 'invalid' };
        const hash = crypto.createHash('sha256').update(diag.message).digest('hex');
        return { hash };
    }
    processError(diag) {
        const { hash } = this.fingerprintError(diag);
        if (hash === 'invalid') return;
        let fp = this.fingerprints.get(hash);
        if (fp) fp.count++;
        else this.fingerprints.set(hash, { id: hash, count: 1 });
    }
}

class SecurityScanner {
    scanText(text) {
        const issues = [];
        // Intentionally naive rules for testing
        if (text.includes('AWS_ACCESS_KEY')) issues.push({ rule: { id: 'no-secrets', risk: 'Critical' } });
        if (text.includes('console.log')) issues.push({ rule: { id: 'no-console', risk: 'Low' } });
        return issues;
    }
}

async function runAdversarial() {
    console.log("😈 Running Adversarial Tests...");
    const detector = new MistakeDetector();
    const scanner = new SecurityScanner();

    // 1. MEMORY BLOAT ATTACK
    console.log("[Attack 1] Memory Flooding (100k distinct errors)");
    const startMem = process.memoryUsage().heapUsed;
    for (let i = 0; i < 100000; i++) {
        detector.processError(new vscode.Diagnostic({}, `Unique Error ${i} - ${Math.random()}`));
    }
    const endMem = process.memoryUsage().heapUsed;
    const mbUsed = (endMem - startMem) / 1024 / 1024;
    console.log(`-> Consumed ~${mbUsed.toFixed(2)} MB for 100k fingerprints.`);
    if (mbUsed > 50) console.warn("⚠ WEAKNESS: Memory usage spiked significantly. No eviction policy!");
    else console.log("✔ Memory contained (but still unbounded potentially).");

    // 2. FALSE POSITIVE INJECTION
    console.log("\n[Attack 2] False Positives (Context Awareness)");
    const safeCode = `
        // This is a comment about AWS_ACCESS_KEY
        const s = "Don't print to console.log";
    `;
    const issues = scanner.scanText(safeCode);
    if (issues.length > 0) {
        console.warn(`⚠ WEAKNESS: False Positives detected! Found ${issues.length} issues in SAFE code.`);
        issues.forEach(i => console.log(`   - Flagged: ${i.rule.id}`));
        console.log("   -> Proposed Fix: AST-based parsing or finer regex.");
    } else {
        console.log("✔ No false positives.");
    }

    // 3. HUGE PAYLOAD (DoS)
    console.log("\n[Attack 3] Huge Payload Scan (2MB Text)");
    const hugeText = "var x = 1; ".repeat(100000) + "console.log('x');";
    const startT = Date.now();
    scanner.scanText(hugeText);
    const duration = Date.now() - startT;
    console.log(`-> Scanned 2MB in ${duration}ms.`);
    if (duration > 100) console.warn("⚠ WEAKNESS: Scanning is synchronous and blocking event loop!");
    else console.log("✔ Speed is acceptable.");

    console.log("\nDONE 😈");
}

runAdversarial().catch(console.error);
