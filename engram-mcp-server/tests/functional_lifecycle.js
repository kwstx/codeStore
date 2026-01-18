
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_PATH = path.join(__dirname, '..', 'build', 'index.js');

console.log(`🤖 Agent Simulation: Full Lifecycle Test`);
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
        console.log('1. 🔌 Initializing...');
        await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "agent-sim", version: "1.0" } });
        console.log('   ✅ Connected.');

        // Step 1: Prove ignorance (optional, but good for demo)
        // ... skipping for speed

        // Step 2: TEACH (Set Rule)
        console.log('\n2. 🧠 TEACHING: Saving new rule about passwords...');
        const uniqueId = Date.now();
        const teachResponse = await send("tools/call", {
            name: "engram_save_rule",
            arguments: {
                title: `Secure Passwords ${uniqueId}`,
                problem: "Using md5 for passwords is insecure.",
                solution: "ALWAYS use bcrypt or argon2 for password hashing."
            }
        });

        if (teachResponse.error) throw new Error(teachResponse.error.message);
        console.log('   ✅ Rule Saved: "Secure Passwords"');

        // Step 3: PREVENT (Query)
        console.log('\n3. 🛡️  PREVENTING: Agent is coding and asks about "md5"...');
        const queryResponse = await send("tools/call", {
            name: "engram_query",
            arguments: { query: "md5" }
        });

        if (queryResponse.error) throw new Error(queryResponse.error.message);

        const content = queryResponse.result.content[0].text;
        console.log(`   🔍 Agent received memory:\n   "${content.substring(0, 80).replace(/\n/g, ' ')}..."`);

        // Step 4: VERIFY
        if (content.includes("ALWAYS use bcrypt") && content.includes("Secure Passwords")) {
            console.log('\n   🏆 SUCCESS: The Agent successfully recalled the rule to prevent the bug!');
        } else {
            console.error('\n   ❌ FAILURE: The Agent did not find the correct rule.');
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
