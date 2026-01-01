# Project Scope

The product’s only responsibility is to automatically store meaningful code patterns and allow the developer to retrieve similar past solutions via a command in VSCode.

## Non-goals
- No team features
- No cloud sync
- No analytics dashboard
- No prompt engineering tools
- No multi-IDE support

This document exists to prevent feature creep later.

## Tech Stack
- **Extension**: VSCode Extension API (TypeScript).
- **Engine**: Node.js (Local, invoked by extension).
- **Embeddings**: `@xenova/transformers` (Local, Open Source: `all-MiniLM-L6-v2`).
- **Database**: LanceDB (Local, embedded vector storage).
- **LLM**: None for now (or Local via Ollama if needed later).

## Core User Flow
1. **Capture**: When a developer saves a file in VSCode, the extension captures relevant code and sends it to a local background service for processing. Nothing visible happens in the UI.
2. **Retrieval**: When the developer manually triggers the command “Code Memory: Have I done this before?”, the extension takes the currently open file (or selected code), queries stored memories, and displays the most relevant past solutions inside VSCode.
