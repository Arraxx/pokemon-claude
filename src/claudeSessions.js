const fs = require('fs');
const path = require('path');
const os = require('os');
const { syncClaudeAgents } = require('./agentStore');
const {
  inferNeedsPermissionFromTranscript,
  getLastFinalAssistantFingerprint,
} = require('./claudeTranscript');
const hookState = require('./hookState');

const SESSIONS_DIR = path.join(os.homedir(), '.claude', 'sessions');

/** sessionId -> last transcript "needs input" bool — drives permissionFence bumps on false→true */
const permissionHintPrev = new Map();
/** sessionId -> monotonic counter; bumps when a new permission prompt starts after none / after cleared */
const permissionFence = new Map();

/**
 * sessionId -> last seen "final assistant" fingerprint.
 * When this changes, Claude just finished a task → flash the happy bubble.
 */
const lastFinalFP = new Map();

/**
 * sessionId -> { expiresAt }
 * Active happy-bubble flash windows per session.
 */
const taskFlash = new Map();
const TASK_FLASH_MS = 10000;

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * One row per live Claude Code process found in ~/.claude/sessions/*.json.
 */
function scanSessions() {
  if (!fs.existsSync(SESSIONS_DIR)) return [];

  let files = [];
  try {
    files = fs.readdirSync(SESSIONS_DIR);
  } catch {
    return [];
  }

  const rows = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    let data;
    try {
      const raw = fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8');
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    const pid = data.pid;
    const sessionId = data.sessionId;
    if (typeof pid !== 'number' || typeof sessionId !== 'string' || !sessionId) continue;
    if (!isPidAlive(pid)) continue;

    const cwd = typeof data.cwd === 'string' ? data.cwd : '';
    const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : '';
    const label = name || (cwd ? path.basename(cwd) : sessionId.slice(0, 8));

    // ── Permission detection ─────────────────────────────────────────────
    // Hook events from Claude Code are the most accurate source. When we've
    // received any hook for this session we trust them; only sessions that
    // have never sent a hook fall back to the transcript heuristic.
    let status = 'running';
    const hs = hookState.getState(sessionId);
    const useHooks = hookState.hasAnyHookSignal(sessionId);

    let transcriptNeed = false;
    if (!useHooks) {
      try {
        transcriptNeed = inferNeedsPermissionFromTranscript(cwd, sessionId);
      } catch {
        /* ignore */
      }
    }

    const needsPermission = useHooks ? hs.needsPermission : transcriptNeed;
    if (needsPermission) status = 'needs_permission';

    let fence;
    if (useHooks) {
      fence = hs.fence;
      permissionFence.set(sessionId, fence);
      permissionHintPrev.set(sessionId, needsPermission);
    } else {
      const wasNeeding = permissionHintPrev.get(sessionId);
      fence = permissionFence.get(sessionId) || 0;
      if (transcriptNeed && wasNeeding !== true) {
        fence += 1;
        permissionFence.set(sessionId, fence);
      }
      permissionHintPrev.set(sessionId, transcriptNeed);
    }

    // ── Per-task completion detection ────────────────────────────────────
    // Hook-driven `Stop` events are authoritative when present; transcript
    // fingerprint comparison still runs as a fallback for sessions without
    // hooks installed (e.g. older Claude Code versions).
    const now = Date.now();
    if (status === 'running') {
      if (useHooks) {
        if (hs.completed) status = 'completed';
      } else {
        let fp = null;
        try {
          fp = getLastFinalAssistantFingerprint(cwd, sessionId);
        } catch {
          /* ignore */
        }
        if (fp !== null) {
          const prev = lastFinalFP.get(sessionId);
          if (prev === undefined) {
            lastFinalFP.set(sessionId, fp);
          } else if (fp !== prev) {
            lastFinalFP.set(sessionId, fp);
            taskFlash.set(sessionId, { expiresAt: now + TASK_FLASH_MS });
          }
        }
        const flash = taskFlash.get(sessionId);
        if (flash && now < flash.expiresAt) {
          status = 'completed';
        } else if (flash && now >= flash.expiresAt) {
          taskFlash.delete(sessionId);
        }
      }
    }

    rows.push({
      id: `cc:${sessionId}`,
      status,
      gen: 1,
      species: 'pikachu',
      shiny: false,
      label: String(label).slice(0, 120),
      updatedAt: now,
      permissionFence: fence,
      source: 'claude-code',
      claude: {
        pid,
        sessionId,
        entrypoint: data.entrypoint || '',
        kind: data.kind || '',
      },
    });
  }

  // Clean up tracking for dead sessions.
  const liveSessionIds = new Set(rows.map((r) => r.claude.sessionId));
  for (const sid of [...permissionHintPrev.keys()]) {
    if (!liveSessionIds.has(sid)) {
      permissionHintPrev.delete(sid);
      permissionFence.delete(sid);
      lastFinalFP.delete(sid);
      taskFlash.delete(sid);
      hookState.forgetSession(sid);
    }
  }

  return rows;
}

/** @type {(() => void) | null} */
let activeTick = null;

function startClaudePolling({ intervalMs }) {
  const tick = () => {
    try {
      const rows = scanSessions();
      syncClaudeAgents(rows);
    } catch (e) {
      console.warn('[pokemon-claude] Claude session sync:', e.message);
    }
  };
  activeTick = tick;
  tick();
  return setInterval(tick, intervalMs);
}

/** Run an extra scan immediately — used to react to hook events without waiting for the next poll. */
function forceTick() {
  if (activeTick) activeTick();
}

module.exports = { startClaudePolling, forceTick };
