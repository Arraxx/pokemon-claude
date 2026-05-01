# Pokémon Claude

<img width="3024" height="356" alt="Adobe Express - pokemon" src="https://github.com/user-attachments/assets/032136b2-2a5b-4d9d-b50a-0ec3e8d17fa6" />


**Give your AI agents a little presence on the desktop.**

Pokémon Claude is a tiny, transparent **always-on-top dock** for developers who use coding agents. It shows a row of **First gen style pixel pokemon** that react to what your claude agents are doing—think of it as a mood strip for your automation.

Works on **macOS, Windows, and Linux** (built with [Electron](https://www.electronjs.org/)).

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

---

## Why use it

- **At-a-glance status** — See when claude agents are busy, finished, or waiting on you, without tab-hunting.
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
# Optional: HD animated sprites from Pokémon Showdown (10 iconic species by default).
# npm run vendor-sprites:showdown          # 10 sample species
# npm run vendor-sprites:showdown:all      # full gen1 (~153 species)
# POKEMON_CLAUDE_SPRITE_STYLE=showdown npm start
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
| `POKEMON_CLAUDE_INSTALL_HOOKS` | Set to `0` to skip auto-installing the Claude Code hook bridge in `~/.claude/settings.json` (default: install) |
| `POKEMON_CLAUDE_DOCK_HEIGHT` | Height of the dock in pixels (default `136`) |
| `POKEMON_CLAUDE_DOCK_LIFT` | Extra height when the window is focused (default `36`) |
| `POKEMON_CLAUDE_MOUSE_PASSTHROUGH` | `0` to allow dragging the window (default: passthrough on) |
| `POKEMON_CLAUDE_MAC_LEVEL` | macOS only: `alwaysOnTop` level (e.g. `status`) |
| `POKEMON_CLAUDE_SPRITE_STYLE` | Art style — `vscode` (default, gen1 8fps pixel, walks left/right) or `showdown` (Pokémon Showdown HD animated, stationary — the gif's own animation carries the motion). Run `npm run vendor-sprites:showdown` once first (or `:showdown:all` for the full set). The species pool is restricted to whichever pokémon you've vendored. |

> **About the hook bridge.** On startup the app installs a small script at `~/.claude/pokemon-claude-hook.sh` and adds tagged entries (`"pokemon-claude-bridge": true`) under `hooks` in `~/.claude/settings.json`. Existing hooks are preserved, the original file is backed up to `settings.json.pokemon-claude.bak`, and re-running the app never duplicates the entries. This is what lets the heart bubble appear instantly on prompts like *"Do you want to allow Claude to fetch this content?"* — those prompts only land in the JSONL transcript after you answer, so polling alone can't see them.

The same values were previously read from `POKEMON_INTACT_*` names; those still work as fallbacks if a `POKEMON_CLAUDE_*` variable is not set.

---

## API (local only)

- `GET /` — HUD UI  
- `GET /api/state` — JSON snapshot of agent state  
- `GET /api/stream` — **SSE** stream of state updates  
- `POST /api/event` — Push agent events (JSON body)  
- `POST /api/agents/remove` — Remove an agent by `id`  
- `POST /api/claude-hook` — Receives Claude Code hook payloads from the bridge script (used internally; you generally don't call this yourself)  

The server binds to **127.0.0.1** only.

---

## Contributing

Issues and PRs are welcome. Please keep changes focused; match existing style. For substantial features, open an issue first so we can align on direction.

---

## Legal

- **Pokémon** and related names are **trademarks** of their respective owners. This project is an **independent, fan-made developer utility**; it is not affiliated with or endorsed by Nintendo, The Pokémon Company, or Game Freak.
- In-game style **sprites and media** are not shipped in this repository. They are installed locally by `npm run vendor-sprites` from the [vscode-pokemon](https://github.com/jakobhoeg/vscode-pokemon) project—see that repo’s **license and attribution** after you vendor files. The optional `npm run vendor-sprites:showdown` script downloads animated XY-style sprites from [Pokémon Showdown](https://play.pokemonshowdown.com/), which are fan-maintained pixel art credited at <https://github.com/smogon/sprites>.

This project’s **source code** is released under the **MIT License** (see [LICENSE](LICENSE)).

---

## Acknowledgments

- Inspired by the delightful [vscode-pokemon](https://github.com/jakobhoeg/vscode-pokemon) media workflow.
- Built with [Electron](https://www.electronjs.org/) and a lot of coffee.

If Pokémon Claude makes your day slightly more fun, consider **starring the repo** and sharing it with other agent-heavy devs.
