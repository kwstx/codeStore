# Engram

**The gateway to code memory.**

Engram is a local-first VS Code extension that creates a semantic index of your codebase, allows for instant context retrieval, and keeps your flow state unbroken. It acts as a privacy-first "smart memory" for your development workflow.

## Core Capabilities

### 🧠 Prompt Tracker & Context Memory
Visualize your thought process. Engram tracks, versions, and recalls every prompt iteration, helping you understand the "why" behind your code changes.
*   **Automatic indexing** of prompts and intent.
*   **Searchable history** of your coding decisions.

### 🛡️ Mistake Shield
Fingerprint your errors. Engram remembers what broke previously so you don't repeat the same mistakes.
*   **Active warning system** when you are about to repeat a known bad pattern.
*   **Local failure database** that grows with your experience.

### ♻️ Smart Recall
Cross-tool memory. Automatically link pasted code back to its original prompt.
*   **Instant context** for code snippets pasted from LLMs or other sources.
*   **Pattern matching** to find where you've solved similar problems before.

### 🚨 Security Vibe Check
Real-time scanning. Catch secrets and risky patterns before they run.
*   **Inline warnings** for dangerous patterns like `eval()`, SQL injection, or exposed secrets.
*   **Non-blocking**: Warnings appear as vibes (diagnostics), not blockers.
*   **Informed Overrides**: Dismiss warnings with a documented reason if you know what you're doing.

## Privacy First
**100% Local Processing.**
Your code, your prompts, and your patterns never leave your machine. Engram uses local embedding models and vector stores to ensure total privacy.

## Quick Start

1.  **Install** the extension.
2.  **Start coding!** Engram actively indexes your workflow in the background.
3.  **Paste code** to see Smart Recall in action.
4.  **Use `Cmd+Shift+P` -> `Engram: Find Similar Patterns`** to search your memory.
5.  **Use `Cmd+.` (Quick Fix)** to dismiss security warnings if needed.

## Links

*   [Website](https://use-engram.vercel.app)
*   [Repository](https://github.com/kwstx/Engram)
*   [Privacy Policy](https://use-engram.vercel.app/privacy.html)
