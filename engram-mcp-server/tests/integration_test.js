import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serverPath = path.join(__dirname, '..', 'build', 'index.js');
const serverDir = path.join(__dirname, '..');

console.log(`Spawn server at: ${serverPath}`);

const server = spawn('node', [serverPath], { cwd: serverDir });

let step = 0;

server.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim() !== '');
    for (const line of lines) {
        console.log(`[SERVER]: ${line}`);
        try {
            const msg = JSON.parse(line);
            handleMessage(msg);
        } catch (e) {
            // Include error parsing, might be partial chunk
        }
    }
});

server.stderr.on('data', (data) => {
    console.error(`[STDERR]: ${data}`);
});

function send(msg) {
    const str = JSON.stringify(msg) + '\n';
    server.stdin.write(str);
}

function handleMessage(msg) {
    // 1. Initialized
    if (step === 0 && msg.id === 1) {
        console.log('✅ Initialization successful');
        step++;

        // List Tools
        send({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/list"
        });
    }
    // 2. Tools List
    else if (step === 1 && msg.id === 2) {
        console.log('Received Tool List');
        const tools = msg.result.tools;
        const toolNames = tools.map(t => t.name);
        console.log('Tools found:', toolNames);

        if (toolNames.includes('engram_query') && toolNames.includes('engram_save_rule')) {
            console.log('✅ Expected tools present');
            step++;

            // Call Tool
            send({
                jsonrpc: "2.0",
                id: 3,
                method: "tools/call",
                params: {
                    name: "engram_query",
                    arguments: {
                        query: "fetch"
                    }
                }
            });
        } else {
            console.error('❌ Missing Expected Tools');
            process.exit(1);
        }
    }
    // 3. Call Result
    else if (step === 2 && msg.id === 3) {
        console.log('Received Tool Call Result');

        // Check for error
        if (msg.error) {
            console.error('❌ Tool Call Error:', msg.error);
            process.exit(1);
        }

        const content = msg.result.content[0].text;
        console.log('Content preview:', content.substring(0, 50) + '...');

        if (content.includes('fix_network_timeouts.md') || content.includes('networkClient.safeRequest')) {
            console.log('✅ Successfully retrieved "fetch" rule from history');
            console.log('ALL TESTS PASSED');
            process.exit(0);
        } else {
            console.error('❌ Did not find expected rule in content');
            console.log('Full content:', content);
            process.exit(1);
        }
    }
}

// Start sequence
// 0. Initialize
send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
        protocolVersion: "2024-11-05", // Example version, SDK is permissive usually or we match what it expects. 
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0" }
    }
});

setTimeout(() => {
    console.error('❌ Timeout waiting for response');
    process.exit(1);
}, 5000);
