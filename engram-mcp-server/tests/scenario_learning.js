
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_PATH = path.join(__dirname, '..', 'build', 'index.js');

console.log(`🎬 SCENARIO TEST: "The Autonomous Learner"`);
console.log(`   Server: ${SERVER_PATH}\n`);

const server = spawn('node', [SERVER_PATH], { stdio: ['pipe', 'pipe', 'inherit'] });

let messageId = 0;
let pendingRequests = new Map();

server.stdout.on('data', (buffer) => {
    const lines = buffer.toString().split('\n');
    for (const line of lines) {
        if (!line.trim()) continue;
        try {
            const msg = JSON.parse(line);
            if (msg.id) {
                const resolve = pendingRequests.get(msg.id);
                if (resolve) {
                    pendingRequests.delete(msg.id);
                    resolve(msg);
                }
            }
        } catch (e) { }
    }
});

function send(method, params = {}) {
    messageId++;
    const msg = { jsonrpc: "2.0", id: messageId, method, params };
    const promise = new Promise((resolve) => {
        pendingRequests.set(messageId, resolve);
    });
    server.stdin.write(JSON.stringify(msg) + '\n');
    return promise;
}

async function run() {
    try {
        await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "learner-sim", version: "1.0" } });

        // SCENARIO: 
        // 1. Agent notices a bad pattern (e.g., using `eval()`)
        // 2. Agent decides to SAVE a rule about it.

        console.log(`📉 EVENT: Developer wrote 'eval(input)'`);
        console.log(`🤖 AI Agent: "That's dangerous. I should remember this."`);
        console.log(`   Action: saving rule "No Eval" to Engram...`);

        const saveResponse = await send("tools/call", {
            name: "engram_save_rule",
            arguments: {
                title: "No Eval Allowed",
                problem: "Using eval() is a massive security risk.",
                solution: "Use JSON.parse() or specific parsers instead."
            }
        });

        if (saveResponse.error) throw new Error(saveResponse.error.message);
        console.log(`   ✅ Engram Confirms: Rule Saved.`);

        // 3. LATER...
        console.log(`\n⏳ LATER... New developer asks about "eval"...`);

        const queryResponse = await send("tools/call", {
            name: "engram_query",
            arguments: { query: "eval" }
        });

        const memory = queryResponse.result.content[0].text;

        if (memory.includes("massive security risk")) {
            console.log(`   ✅ Engram Recalls: "Using eval() is a massive security risk."`);
            console.log(`\n🎉 PROVEN: The AI successfully created a new rule and used it to prevent a future bug.`);
        } else {
            console.error(`❌ FAILED. Memory did not return the new rule.`);
            process.exit(1);
        }

    } catch (e) {
        console.error('CRASH:', e);
        process.exit(1);
    } finally {
        server.kill();
        process.exit(0);
    }
}

run();
