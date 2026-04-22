const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Installs (idempotently) a small bridge script + entries in
 * `~/.claude/settings.json` so Claude Code forwards permission/notification
 * events to the local Pokémon Claude server.
 *
 * Without this, the only signal we have for a "Do you want to allow Claude
 * to fetch this content?" prompt is the JSONL transcript — and Claude Code
 * batch-flushes the tool_use together with the tool_result, so the wait is
 * invisible to the file watcher. Hooks fire the moment the dialog appears.
 *
 * Safety:
 *  - Every entry we add is tagged with a marker key so we can recognise our
 *    own work and never duplicate or clobber the user's hooks.
 *  - We back up the existing settings.json on first modification.
 *  - The bridge script is a one-line `curl` that fails silently if the
 *    server isn't running, so it never blocks Claude Code itself.
 */

const HOOK_MARKER = 'pokemon-claude-bridge';
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json');
const SCRIPT_PATH = path.join(CLAUDE_DIR, 'pokemon-claude-hook.sh');

/** Hook events we care about. Order is informational; values are the matchers. */
const HOOK_EVENTS = [
  // Wait-opening events — fire when Claude is BLOCKED waiting on the user.
  { event: 'PermissionRequest' },
  { event: 'Notification' },
  // Wait-closing events — fire when the user has answered / moved on.
  { event: 'PreToolUse' },
  { event: 'PostToolUse' },
  { event: 'PostToolUseFailure' },
  { event: 'PermissionDenied' },
  { event: 'UserPromptSubmit' },
  // Turn boundary — used for the smile bubble.
  { event: 'Stop' },
];

function buildBridgeScript(port) {
  return `#!/bin/sh
# Auto-installed by Pokémon Claude. Forwards Claude Code hook events to the
# local overlay server so the heart/smile bubbles can react in real time.
# Safe to delete; the app will recreate it on next start unless
# POKEMON_CLAUDE_INSTALL_HOOKS=0 is set.
PORT="\${POKEMON_CLAUDE_PORT:-${port}}"
URL="http://127.0.0.1:\${PORT}/api/claude-hook"
exec curl -sf -m 1 -X POST "$URL" \\
  -H 'Content-Type: application/json' \\
  --data-binary @- >/dev/null 2>&1 || true
`;
}

function ensureBridgeScript(port) {
  if (!fs.existsSync(CLAUDE_DIR)) {
    try {
      fs.mkdirSync(CLAUDE_DIR, { recursive: true });
    } catch {
      return false;
    }
  }
  const want = buildBridgeScript(port);
  let existing = '';
  try {
    existing = fs.readFileSync(SCRIPT_PATH, 'utf8');
  } catch {
    /* fresh write */
  }
  if (existing !== want) {
    fs.writeFileSync(SCRIPT_PATH, want, { mode: 0o755 });
  }
  try {
    fs.chmodSync(SCRIPT_PATH, 0o755);
  } catch {
    /* ignore */
  }
  return true;
}

function readSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) return {};
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch {
    return null; // signal "unparseable — leave alone"
  }
}

function backupOnce() {
  if (!fs.existsSync(SETTINGS_PATH)) return;
  const backup = `${SETTINGS_PATH}.pokemon-claude.bak`;
  if (fs.existsSync(backup)) return;
  try {
    fs.copyFileSync(SETTINGS_PATH, backup);
  } catch {
    /* best-effort */
  }
}

function entryHasMarker(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry[HOOK_MARKER] === true) return true;
  if (Array.isArray(entry.hooks)) {
    return entry.hooks.some(
      (h) => h && typeof h.command === 'string' && h.command.includes(SCRIPT_PATH),
    );
  }
  return false;
}

function makeOurEntry() {
  return {
    [HOOK_MARKER]: true,
    hooks: [
      {
        type: 'command',
        command: SCRIPT_PATH,
      },
    ],
  };
}

/**
 * Merge our hook entries into the settings object. Mutates `settings`.
 * Returns true if anything changed.
 */
function mergeOurHooks(settings) {
  if (!settings.hooks || typeof settings.hooks !== 'object') {
    settings.hooks = {};
  }
  let changed = false;
  for (const { event } of HOOK_EVENTS) {
    const arr = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    if (!arr.some(entryHasMarker)) {
      arr.push(makeOurEntry());
      settings.hooks[event] = arr;
      changed = true;
    }
  }
  return changed;
}

/** Strip our entries (and remove now-empty event arrays). */
function stripOurHooks(settings) {
  if (!settings || !settings.hooks || typeof settings.hooks !== 'object') return false;
  let changed = false;
  for (const event of Object.keys(settings.hooks)) {
    const arr = settings.hooks[event];
    if (!Array.isArray(arr)) continue;
    const filtered = arr.filter((e) => !entryHasMarker(e));
    if (filtered.length !== arr.length) {
      changed = true;
      if (filtered.length === 0) {
        delete settings.hooks[event];
      } else {
        settings.hooks[event] = filtered;
      }
    }
  }
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
    changed = true;
  }
  return changed;
}

/** Idempotent install. Returns { installed: bool, scriptPath, settingsPath }. */
function installHooks({ port }) {
  ensureBridgeScript(port);
  const settings = readSettings();
  if (settings === null) {
    // Couldn't parse user's file; never overwrite.
    return { installed: false, reason: 'settings.json unparseable' };
  }
  const before = JSON.stringify(settings);
  const changed = mergeOurHooks(settings);
  if (!changed) {
    return { installed: true, scriptPath: SCRIPT_PATH, settingsPath: SETTINGS_PATH, changed: false };
  }
  backupOnce();
  fs.writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`);
  return {
    installed: true,
    scriptPath: SCRIPT_PATH,
    settingsPath: SETTINGS_PATH,
    changed: true,
    previous: before,
  };
}

function uninstallHooks() {
  const settings = readSettings();
  if (!settings) return { uninstalled: false };
  const changed = stripOurHooks(settings);
  if (changed) {
    fs.writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`);
  }
  try {
    if (fs.existsSync(SCRIPT_PATH)) fs.unlinkSync(SCRIPT_PATH);
  } catch {
    /* ignore */
  }
  return { uninstalled: true, changed };
}

module.exports = {
  installHooks,
  uninstallHooks,
  HOOK_MARKER,
  SCRIPT_PATH,
  SETTINGS_PATH,
};
