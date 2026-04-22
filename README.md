# Pokémon Claude

**Give your AI agents a little presence on the desktop.**

Pokémon Claude is a tiny, transparent **always-on-top dock** for developers who use coding agents. It shows a row of **Gen‑1 style pixel companions** that react to what your tools are doing—think of it as a mood strip for your automation.

Works on **macOS, Windows, and Linux** (built with [Electron](https://www.electronjs.org/)).

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

---

## Why use it

- **At-a-glance status** — See when agents are busy, finished, or waiting on you, without tab-hunting.
- **Stays out of the way** — Sits in a thin strip along the bottom of the screen. Mouse events pass through to windows below by default (so you can still click the terminal behind it).
- **Claude Code aware (optional)** — Watches `~/.claude/sessions` and syncs live Claude Code sessions on the same machine. Turn it off with an env var if you only want the HTTP API.
- **Hackable** — A small local **HTTP + Server-Sent Events** API on `127.0.0.1` so other tools or scripts can drive the HUD.
- **Offline & local-first** — No cloud account; the ship runs on your box.

---

## Download

### Prebuilt binaries

When [GitHub Releases](https://github.com/YOUR_USERNAME/pokemon-claude/releases) are published, you will typically find:

| Platform | Artifacts (examples) |
| -------- | -------------------- |
| **macOS** | `.dmg` and `.zip` (drag-and-drop or extract) |
| **Windows** | `.exe` (NSIS installer) |
| **Linux** | `.AppImage` and `.deb` |

*(Replace the releases URL with your repository after you publish.)*

> **First launch (macOS):** If Gatekeeper flags an **unsigned** build, open **System Settings → Privacy & Security** and allow the app once, or right-click → **Open** on the app.

### Build from source

Requires **Node.js 18+** and **git** (the sprite vendor script clones a public repo once).

```bash
git clone https://github.com/YOUR_USERNAME/pokemon-claude.git
cd pokemon-claude
npm install
npm run vendor-sprites
npm start
```

---

## Build installers (Windows, macOS, Linux)

**Install dev dependencies** (includes `electron-builder`):

```bash
npm install
npm run vendor-sprites
```

Build **on the same OS** you are targeting (or use CI—see `.github/workflows/`):

```bash
# macOS — produces DMG + ZIP under ./dist
npm run dist:mac

# Windows — NSIS installer under ./dist
npm run dist:win

# Linux — AppImage + .deb under ./dist
npm run dist:linux
```

Quick **unpacked** build (faster, good for testing packaging):

```bash
npm run pack
```

> **CI tip:** A typical pattern is a matrix job on `macos-latest`, `windows-latest`, and `ubuntu-22.04`, each running the matching `dist:*` script and uploading `dist/*` as release assets.

---

## Configuration (environment variables)

| Variable | What it does |
| -------- | ---------------- |
| `POKEMON_CLAUDE_PORT` | HTTP server port (default `3847`) |
| `POKEMON_CLAUDE_SYNC` | Set to `0` to disable Claude session polling |
| `POKEMON_CLAUDE_POLL_MS` | Poll interval in ms (default `2500`) |
| `POKEMON_CLAUDE_DOCK_HEIGHT` | Height of the dock in pixels (default `136`) |
| `POKEMON_CLAUDE_DOCK_LIFT` | Extra height when the window is focused (default `36`) |
| `POKEMON_CLAUDE_MOUSE_PASSTHROUGH` | `0` to allow dragging the window (default: passthrough on) |
| `POKEMON_CLAUDE_MAC_LEVEL` | macOS only: `alwaysOnTop` level (e.g. `status`) |

The same values were previously read from `POKEMON_INTACT_*` names; those still work as fallbacks if a `POKEMON_CLAUDE_*` variable is not set.

---

## API (local only)

- `GET /` — HUD UI  
- `GET /api/state` — JSON snapshot of agent state  
- `GET /api/stream` — **SSE** stream of state updates  
- `POST /api/event` — Push agent events (JSON body)  
- `POST /api/agents/remove` — Remove an agent by `id`  

The server binds to **127.0.0.1** only.

---

## Contributing

Issues and PRs are welcome. Please keep changes focused; match existing style. For substantial features, open an issue first so we can align on direction.

---

## Legal

- **Pokémon** and related names are **trademarks** of their respective owners. This project is an **independent, fan-made developer utility**; it is not affiliated with or endorsed by Nintendo, The Pokémon Company, or Game Freak.
- In-game style **sprites and media** are not shipped in this repository. They are installed locally by `npm run vendor-sprites` from the [vscode-pokemon](https://github.com/jakobhoeg/vscode-pokemon) project—see that repo’s **license and attribution** after you vendor files.

This project’s **source code** is released under the **MIT License** (see [LICENSE](LICENSE)).

---

## Acknowledgments

- Inspired by the delightful [vscode-pokemon](https://github.com/jakobhoeg/vscode-pokemon) media workflow.
- Built with [Electron](https://www.electronjs.org/) and a lot of coffee.

If Pokémon Claude makes your day slightly more fun, consider **starring the repo** and sharing it with other agent-heavy devs.
