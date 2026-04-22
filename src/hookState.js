/**
 * Per-session truth table driven by Claude Code hook events.
 *
 * Hooks give us instant, definitive signals that the JSONL transcript can't:
 *  - PermissionRequest / Notification(permission_prompt|elicitation_dialog)
 *    → Claude is BLOCKED waiting for the user.
 *  - PreToolUse / PostToolUse / UserPromptSubmit
 *    → The user has just answered (or moved on); clear the wait.
 *  - Stop                         → Claude finished a turn. We peek at the
 *    final assistant message before deciding: if it ends with a question or
 *    permission ask, that's a HEART (not a smile) — Claude is waiting on the
 *    user. Otherwise it's a real "task complete" → smile bubble.
 *
 * Each "wait" entry has a TTL so a stuck process can never pin a heart on
 * forever; in practice the clear events above cover every interactive path.
 */

const {
  inferNeedsPermissionFromTranscriptPath,
  textLooksLikeQuestion,
} = require('./claudeTranscript');

/** sessionId → { since: ms, expiresAt: ms, fence: int, source: 'hook' } */
const waiting = new Map();
/** sessionId → { expiresAt: ms } — short-lived completion flash */
const completed = new Map();
/** sessionId → monotonic permissionFence (bumps on each fresh open) */
const fenceCounters = new Map();

const WAIT_TTL_MS = 10 * 60 * 1000;
const COMPLETE_FLASH_MS = 10 * 1000;

function bumpFence(sessionId) {
  const next = (fenceCounters.get(sessionId) || 0) + 1;
  fenceCounters.set(sessionId, next);
  return next;
}

function markNeedsPermission(sessionId) {
  if (!sessionId) return;
  const now = Date.now();
  const prev = waiting.get(sessionId);
  const fence = prev ? prev.fence : bumpFence(sessionId);
  waiting.set(sessionId, {
    since: prev ? prev.since : now,
    expiresAt: now + WAIT_TTL_MS,
    fence,
  });
}

/** New question/permission opened where there wasn't one — bump the fence so the renderer re-flashes. */
function markFreshNeedsPermission(sessionId) {
  if (!sessionId) return;
  const fence = bumpFence(sessionId);
  const now = Date.now();
  waiting.set(sessionId, {
    since: now,
    expiresAt: now + WAIT_TTL_MS,
    fence,
  });
}

function clearNeedsPermission(sessionId) {
  if (!sessionId) return;
  waiting.delete(sessionId);
}

function markCompleted(sessionId) {
  if (!sessionId) return;
  completed.set(sessionId, { expiresAt: Date.now() + COMPLETE_FLASH_MS });
  // A finished turn implies the user is no longer being prompted.
  waiting.delete(sessionId);
}

function reapExpired(now = Date.now()) {
  for (const [sid, w] of waiting) {
    if (w.expiresAt <= now) waiting.delete(sid);
  }
  for (const [sid, c] of completed) {
    if (c.expiresAt <= now) completed.delete(sid);
  }
}

/** Returns { needsPermission, completed, fence } for a sessionId. */
function getState(sessionId) {
  reapExpired();
  const w = waiting.get(sessionId);
  const c = completed.get(sessionId);
  return {
    needsPermission: Boolean(w),
    completed: Boolean(c),
    fence: fenceCounters.get(sessionId) || 0,
  };
}

/** Has any hook EVER fired for this session? Used to decide whether to fall back to transcript heuristics. */
function hasAnyHookSignal(sessionId) {
  return fenceCounters.has(sessionId);
}

function forgetSession(sessionId) {
  waiting.delete(sessionId);
  completed.delete(sessionId);
  fenceCounters.delete(sessionId);
}

/**
 * Apply a hook event from Claude Code.
 * `event` is the raw payload Claude sent; `eventName` is `hook_event_name`.
 * Returns true if it was a recognised event.
 */
function applyHookEvent(eventName, payload) {
  const sessionId = payload && typeof payload.session_id === 'string' ? payload.session_id : '';
  if (!sessionId) return false;

  switch (eventName) {
    case 'PermissionRequest':
      markFreshNeedsPermission(sessionId);
      return true;

    case 'Notification': {
      // `idle_prompt` fires when the USER has been idle, not because Claude
      // is waiting on input — ignore it, otherwise the heart pops on after a
      // quiet stretch and sticks until the TTL expires.
      const t = payload.notification_type;
      if (t === 'permission_prompt' || t === 'elicitation_dialog') {
        markFreshNeedsPermission(sessionId);
        return true;
      }
      return false;
    }

    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostToolUseFailure':
    case 'PermissionDenied':
    case 'UserPromptSubmit':
      // Each of these means the user has either answered the prompt or moved
      // the conversation forward. Clear the wait state.
      clearNeedsPermission(sessionId);
      return true;

    case 'Stop': {
      // Stop fires at the end of EVERY assistant turn — including turns that
      // end in a question to the user. Decide between heart and smile based
      // on the actual final text. Priority order:
      //   1. payload.last_assistant_message  ← always present, no I/O race
      //   2. transcript scan                 ← fallback for older Claude Code
      // Any "?" in Claude's final reply means a question is being asked, so
      // show the heart instead of the smile.
      const lastMsg =
        typeof payload.last_assistant_message === 'string'
          ? payload.last_assistant_message
          : '';
      let endsWithQuestion = textLooksLikeQuestion(lastMsg);

      if (!endsWithQuestion) {
        const transcriptPath =
          typeof payload.transcript_path === 'string' ? payload.transcript_path : '';
        if (transcriptPath) {
          try {
            endsWithQuestion = inferNeedsPermissionFromTranscriptPath(transcriptPath);
          } catch {
            /* keep the no-question default */
          }
        }
      }

      if (endsWithQuestion) {
        markFreshNeedsPermission(sessionId);
      } else {
        markCompleted(sessionId);
      }
      return true;
    }

    default:
      return false;
  }
}

module.exports = {
  applyHookEvent,
  getState,
  markNeedsPermission,
  markFreshNeedsPermission,
  clearNeedsPermission,
  markCompleted,
  hasAnyHookSignal,
  forgetSession,
};
