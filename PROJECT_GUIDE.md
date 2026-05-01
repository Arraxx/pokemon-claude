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
The app uses two complementary signals so the heart appears the instant Claude is blocked, and disappears the instant you've answered:

- **Primary — Claude Code hooks** (`src/claudeHooks.js` + `src/hookState.js`). On startup the app installs a tiny bridge script (`~/.claude/pokemon-claude-hook.sh`) and registers entries under `~/.claude/settings.json` for `PermissionRequest`, `Notification`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionDenied`, `UserPromptSubmit`, and `Stop`. Each fired event is POSTed to `/api/claude-hook` and updates an in-memory truth table per session. This catches interactive prompts like *"Do you want to allow Claude to fetch this content?"* — those don't appear in the JSONL until after you answer, so transcript scanning alone can't see them.
- **Fallback — transcript inference** (`src/claudeTranscript.js`). For sessions that have never sent a hook (older Claude Code, hooks disabled, etc.), the app scans the JSONL for an unmatched `tool_use` block, or for a permission phrase / question mark in the **most recent** assistant turn. The "most recent" qualifier is key — older prompts that the user already answered remain in the file forever, so a global match would pin the heart on permanently.

The install is idempotent and tagged with a marker so it never duplicates or clobbers your own hooks. Your original `settings.json` is backed up to `settings.json.pokemon-claude.bak` on first modification. Set `POKEMON_CLAUDE_INSTALL_HOOKS=0` to opt out.

### 3. Detection of "Task Complete" (The Happy Bubble 😊)
- **Primary — `Stop` hook.** When Claude Code finishes a turn, the bridge fires a `Stop` event, the session is flagged `completed` for 10 s, and the smile bubble shows.
- **Fallback — fingerprint diff.** For hookless sessions, `claudeTranscript.js` fingerprints the last "final" assistant message (text only, no tool use). When the fingerprint changes, a new task has just finished.

---

## 🛠️ Key Files to Explore

- **`src/main.js`**: Entry point, HTTP server, and the `/api/claude-hook` endpoint.
- **`renderer/pet-engine.js`**: The core animation + bubble logic.
- **`src/claudeTranscript.js`**: Transcript parsing fallback.
- **`src/claudeHooks.js`**: Idempotent installer for the Claude Code hook bridge.
- **`src/hookState.js`**: Per-session truth table driven by hook events.

---

## 🚀 Running the Project
```bash
npm install
npm run vendor-sprites # Downloads the Pokémon assets (vscode-pokemon, gen1 8fps)
npm start
```
By default, the overlay is passthrough (you can't click it). Set `POKEMON_CLAUDE_MOUSE_PASSTHROUGH=0` in your env if you want to drag the Pokémon around! (The legacy name `POKEMON_INTACT_MOUSE_PASSTHROUGH` is still supported.)

### 🎨 Sprite Style: vscode vs. showdown
Two art styles ship side-by-side. Pick with `POKEMON_CLAUDE_SPRITE_STYLE`:
- **`vscode`** *(default)* — small gen1 8fps pixel gifs from `vscode-pokemon`, with separate walk/idle animations. Vendored by `npm run vendor-sprites`.
- **`showdown`** — larger XY-style HD animated sprites from Pokémon Showdown (single continuously-animated gif). Showdown ships idle-only anims, so `renderer/style.css` synthesizes a walk feel via a CSS `translateY` keyframe (`sprite-walk-bob`) toggled by the `unit--walking` class. The bob lives on a dedicated `.sprite-bob` wrapper so it doesn't fight the sprite's `scaleX(±1)` facing transform. Vendor with `npm run vendor-sprites:showdown` (defaults to 10 iconic species — pikachu/charizard/bulbasaur/squirtle/charmander/mewtwo/mew/snorlax/eevee/gengar) or `npm run vendor-sprites:showdown:all` for the full gen1 set. Custom subset: `bash scripts/vendor-pokemon-showdown.sh --species=name1,name2,...`. Requires `vendor-sprites` to have run first to provide the species directories.

The chosen style is exposed to the renderer via `GET /api/meta` (`spriteStyle` field). `renderer/pet-engine.js` picks the file path inside `spritePath()`. `src/speciesRegistry.js` filters the species pool to only species with `showdown_default.gif` vendored when style is `showdown`, so a sparse vendor never produces broken images.
