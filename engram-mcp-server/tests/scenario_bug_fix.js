
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_PATH = path.join(__dirname, '..', 'build', 'index.js');

console.log(`🎬 SCENARIO TEST: "The Network Timeout Bug"`);
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
        await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "scenario-sim", version: "1.0" } });

        // SCENARIO: Developer is asking vague question about fetching data
        const devQuery = "I need to fetch some data from the API.";
        console.log(`👨‍💻 Developer says: "${devQuery}"`);
        console.log(`🤖 AI Agent checks Engram Memory...`);

        const response = await send("tools/call", {
            name: "engram_query",
            arguments: { query: "fetch" } // AI infers "fetch" key from the prompt
        });

        if (response.error) throw new Error(response.error.message);

        const memory = response.result.content[0].text;

        // CHECK: Did we find the specfic rule about Timeouts?
        if (memory.includes("fix_network_timeouts.md")) {
            console.log(`\n✅ Engram Intervened! Found relevant rule:`);
            console.log(`   (Source: fix_network_timeouts.md)`);

            if (memory.includes("networkClient.safeRequest")) {
                console.log(`   📝 Advice: "Do NOT use raw fetch. Use networkClient.safeRequest instead."`);
                console.log(`\n🎉 RESULT: Bug Prevented. Developer will use 'safeRequest' instead of raw 'fetch'.`);
            } else {
                console.log(`   ⚠️ Found file but missing specific advice.`);
            }
        } else {
            console.error(`\n❌ FAILED. Engram did not surface the network timeout rule.`);
            console.log("Memory Returned:", memory.substring(0, 100));
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
