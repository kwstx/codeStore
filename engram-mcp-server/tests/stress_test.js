
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_PATH = path.join(__dirname, '..', 'build', 'index.js');

console.log(`⚡ Engram MCP Stress Test`);
console.log(`   Target Server: ${SERVER_PATH}`);

const server = spawn('node', [SERVER_PATH], { stdio: ['pipe', 'pipe', 'inherit'] });

let messageId = 0;
let pendingRequests = new Map();
let startTime = Date.now();

// Handle Server Output
server.stdout.on('data', (buffer) => {
    const lines = buffer.toString().split('\n');
    for (const line of lines) {
        if (!line.trim()) continue;
        try {
            const msg = JSON.parse(line);

            if (msg.id) {
                const req = pendingRequests.get(msg.id);
                if (req) {
                    const elapsed = Date.now() - req.start;
                    // console.log(`   ✅ [${msg.id}] ${req.type} completed in ${elapsed}ms`);
                    pendingRequests.delete(msg.id);
                }
            }

            if (msg.error) {
                console.error(`   ❌ [${msg.id || '?'}] Error:`, msg.error);
                process.exit(1);
            }

            // If we are initialized, start the flood
            if (msg.id === 1 && pendingRequests.size === 0) {
                console.log('   🚀 Server Initialized. Starting flood...');
                runFlood();
            }

        } catch (e) {
            // Partial JSON is possible in pipe, ignoring for simple test
        }
    }
});

function send(method, params = {}) {
    messageId++;
    const msg = {
        jsonrpc: "2.0",
        id: messageId,
        method,
        params
    };
    pendingRequests.set(messageId, { type: method, start: Date.now() });
    server.stdin.write(JSON.stringify(msg) + '\n');
}

// 1. Initialize
send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "stress-test", version: "1.0" }
});

function runFlood() {
    const TOTAL_REQUESTS = 50;
    console.log(`   🌊 Sending ${TOTAL_REQUESTS} concurrent requests...`);

    for (let i = 0; i < TOTAL_REQUESTS; i++) {
        send("tools/call", {
            name: "engram_query",
            arguments: { query: "fetch" }
        });
    }

    // Check completion
    const checkInterval = setInterval(() => {
        const remaining = pendingRequests.size;
        if (remaining === 0) {
            clearInterval(checkInterval);
            const duration = Date.now() - startTime;
            console.log(`   🏆 SUCCESS! Processed ${TOTAL_REQUESTS} requests cleanly.`);
            console.log(`   ⏱️  Total Duration: ${duration}ms`);
            server.kill();
            process.exit(0);
        }
    }, 100);

    // Timeout safety
    setTimeout(() => {
        console.error('   ❌ TIMEOUT: Server did not handle requests in time.');
        server.kill();
        process.exit(1);
    }, 15000);
}
