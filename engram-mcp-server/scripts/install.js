
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import JSON5 from 'json5'; // Requires: npm install json5

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Determine Server Path (The build artifact)
const SERVER_PATH = path.resolve(__dirname, '..', 'build', 'index.js');
console.log(`🔌 Engram MCP Installer`);
console.log(`   Target Server: ${SERVER_PATH}`);

// 2. Define standard config locations
const HOME = os.homedir();
const PLATFORM = os.platform();

const CONFIGS = [
    {
        name: "Claude Desktop",
        path: PLATFORM === 'win32'
            ? path.join(HOME, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json')
            : path.join(HOME, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
        key: "mcpServers"
    },
    {
        name: "VS Code (User Settings)",
        path: PLATFORM === 'win32'
            ? path.join(HOME, 'AppData', 'Roaming', 'Code', 'User', 'settings.json')
            : path.join(HOME, 'Library', 'Application Support', 'Code', 'User', 'settings.json'),
        key: "amp.mcpServers" // Try 'antigravity.mcpServers' or 'mcpServers' if this fails
    }
];

async function install() {
    for (const config of CONFIGS) {
        await updateConfig(config);
    }
}

async function updateConfig(config) {
    console.log(`\nChecking ${config.name}...`);
    try {
        // Check availability
        try {
            await fs.access(config.path);
        } catch {
            console.log(`   ❌ File not found: ${config.path}`);
            return;
        }

        // Read
        const raw = await fs.readFile(config.path, 'utf8');

        // Parse with JSON5 (The "Nuclear Option" for robustness)
        let data;
        try {
            data = JSON5.parse(raw);
        } catch (e) {
            console.log(`   ⚠️  Could not parse JSON in ${config.name} even with JSON5.`);
            console.log(`       Error: ${e.message}`);
            return;
        }

        // Update with deep merge safety
        if (!data[config.key]) data[config.key] = {};

        // Logic: Check if it's already there to avoid unnecessary overwrites? 
        // No, user said "Get it no matter what", so we overwrite to ensure correctness.
        data[config.key]['engram'] = {
            command: "node",
            args: [SERVER_PATH],
            disabled: false,
            autoAllow: true
        };

        // Write back
        // Warning: standard JSON.stringify will remove comments. 
        // Users with heavily commented configs might lose them, but this is the "No Matter What" solution.
        console.log(`   ⚠️  Note: This operation standardizes the JSON (removes comments/commas).`);
        await fs.writeFile(config.path, JSON.stringify(data, null, 4), 'utf8');
        console.log(`   ✅ Successfully configured ${config.name}!`);

    } catch (error) {
        console.error(`   ❌ Error updating ${config.name}:`, error.message);
    }
}

install();
