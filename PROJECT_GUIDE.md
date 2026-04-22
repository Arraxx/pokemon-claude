# Pokémon Claude: Project Guide

Welcome to the internal documentation for **Pokémon Claude**. This project brings a bit of fun to your development workflow by spawning Pokémon on your desktop that react to your activity—specifically, your Claude Code sessions.

---

## 🏗️ Architecture Overview

The application is built on **Electron**, following a clear separation between the background systems (Main Process) and the visual interface (Renderer Process).

### 🖥️ Main Process (Backend)
Located in `src/`, this manages the heavy lifting:
- **`main.js`**: The orchestrator. It creates the transparent, always-on-top window and runs a lightweight HTTP server (default port `3847`). This server handles asset delivery and the API.
- **`agentStore.js`**: The single source of truth for all "agents" (Pokémon). It manages their state and broadcasts updates to the UI using **Server-Sent Events (SSE)**.
- **`claudeSessions.js`**: Monitors your system for live Claude Code sessions. It polls `~/.claude/sessions/` to see which PIDs are still active.
- **`claudeTranscript.js`**: The "brain" that watches what Claude is doing. It analyzes JSONL transcripts to detect when Claude needs your permission or has finished a task.
- **`speciesRegistry.js`**: Manages the mapping of session IDs to specific Pokémon species.

### 🎨 Renderer Process (Frontend)
Located in `renderer/`, this is what you see:
- **`pet-engine.js`**: A sophisticated movement engine and state machine. It handles:
  - Random movement logic (walking, sitting, idling).
  - Sprite animation state.
  - The **Tooltip Bubble System** (`heart.png` for input needed, `happy.png` for success).
- **`app.js`**: The glue. It connects to the SSE stream from the backend and updates the `PetEngine` in real-time.
- **`style.css`**: Defines the "Dock" layout and the visual effects (like the glows around Pokémon when bubbles appear).

---

## 🤖 How Claude Integration Works

Pokémon Claude doesn't just show Pokémon; it makes them reactive to your Claude Code tasks.

### 1. Session Detection
The app looks into `~/.claude/sessions/`. Every JSON file there represents a Claude session. The app checks if the `pid` inside is still alive on your Mac.

### 2. Detection of "Input Required" (The Heart Bubble 🫀)
When Claude Code waits for you to approve a command (like `Bash` or `Write`), it writes the tool call to its transcript but hasn't received a result yet. 
- `claudeTranscript.js` scans the transcript for any `tool_use` that doesn't have a matching `tool_result`.
- It also looks for common permission-asking phrases in the text.
- If detected, status becomes `needs_permission`, and the Pokémon shows a heart.

### 3. Detection of "Task Complete" (The Happy Bubble 😊)
Claude Code identifies tasks through "turns".
- `claudeTranscript.js` generates a **fingerprint** of the very last assistant message that was a "final answer" (text only, no tool use).
- When this fingerprint changes, the system knows a new task has finished.
- The Pokémon flashes the `completed` status for 10 seconds, showing the happy bubble.

---

## 🛠️ Key Files to Explore

- **`src/main.js`**: Entry point and server logic.
- **`renderer/pet-engine.js`**: The core animation logic.
- **`src/claudeTranscript.js`**: The transcript parsing logic.

---

## 🚀 Running the Project
```bash
npm install
npm run vendor-sprites # Downloads the Pokémon assets
npm start
```
By default, the overlay is passthrough (you can't click it). Set `POKEMON_CLAUDE_MOUSE_PASSTHROUGH=0` in your env if you want to drag the Pokémon around! (The legacy name `POKEMON_INTACT_MOUSE_PASSTHROUGH` is still supported.)
