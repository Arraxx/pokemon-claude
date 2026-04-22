const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects');

/** Matches assistant copy like "Can I proceed with these changes?" */
const PERMISSION_TEXT_RE =
  /can i proceed|proceed with these|would you like me to (apply|proceed)|should i (apply|run|continue)|do you want me to (apply|proceed)|needs your (approval|confirmation)|awaiting your (approval|response)|please confirm|permission to (run|execute)|before i (can )?(continue|make changes)|shall i (go ahead|proceed)|may i (proceed|apply)|are you okay with|want me to (apply|run these)/i;

/**
 * Decide whether a single string of assistant text looks like Claude is
 * waiting on the user. The literal "?" check is the highest-priority signal
 * — any question mark in Claude's final reply means the user is being asked
 * something, so we should show the heart, never the smile.
 */
function textLooksLikeQuestion(text) {
  if (typeof text !== 'string' || !text) return false;
  if (text.includes('?')) return true;
  if (PERMISSION_TEXT_RE.test(text)) return true;
  return false;
}

function cwdToProjectSlug(cwd) {
  if (!cwd || typeof cwd !== 'string') return '';
  const norm = path.normalize(cwd);
  const parts = norm.split(path.sep).filter(Boolean);
  if (parts.length === 0) return '';
  return `-${parts.join('-')}`;
}

function readFileTailUtf8(filePath, maxBytes) {
  let st;
  try {
    st = fs.statSync(filePath);
  } catch {
    return '';
  }
  if (!st.isFile() || st.size === 0) return '';
  const len = Math.min(maxBytes, st.size);
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    let s = buf.toString('utf8');
    const nl = s.indexOf('\n');
    if (nl !== -1 && st.size > len) {
      s = s.slice(nl + 1);
    }
    return s;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Inspect the most recent transcript entry. If it is an assistant message,
 * decide whether it is still asking the user to do something (matches the
 * permission regex OR contains a "?"). If the latest entry is from the user,
 * the user has already replied — any older assistant question is now closed.
 *
 * This is what prevents stale matches in the file tail from pinning the heart
 * bubble on forever.
 */
function latestAssistantNeedsAnswer(lines) {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type === 'user') return false;
    if (obj.type !== 'assistant') continue;
    const content =
      obj.message && Array.isArray(obj.message.content) ? obj.message.content : null;
    if (!content) return false;
    const texts = content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n');
    if (!texts) return false;
    return textLooksLikeQuestion(texts);
  }
  return false;
}

/**
 * Scan lines and return true if there is any tool_use block (from an assistant
 * message) that does NOT yet have a matching tool_result in a subsequent user
 * message. This covers ALL tool calls — Bash, Read, Write, AskUserQuestion, etc.
 *
 * When Claude Code shows "Do you want to proceed?" it has already written the
 * assistant+tool_use to the JSONL and is waiting for the user to approve before
 * writing the tool_result. So an unmatched tool_use = waiting for permission.
 */
function hasPendingToolUse(lines) {
  const pending = new Set();
  for (const line of lines) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (obj.type === 'assistant' && obj.message && Array.isArray(obj.message.content)) {
      for (const block of obj.message.content) {
        if (block && block.type === 'tool_use' && block.id) {
          pending.add(block.id);
        }
      }
    }

    if (obj.type === 'user' && obj.message && Array.isArray(obj.message.content)) {
      for (const block of obj.message.content) {
        if (block && block.type === 'tool_result' && block.tool_use_id) {
          pending.delete(block.tool_use_id);
        }
      }
    }
  }
  return pending.size > 0;
}

/**
 * Returns true if the transcript suggests the user should respond.
 *
 * A "needs response" state requires a CURRENTLY OPEN prompt — i.e. one that
 * the user has not already answered. We therefore evaluate signals against
 * the tail of the transcript only:
 *  1. Any pending tool_use (Bash, Read, Write, AskUserQuestion, …) with no
 *     matching tool_result yet — Claude Code writes the tool_use first and
 *     waits for approval before the tool_result arrives.
 *  2. The most recent assistant message contains a permission-asking phrase
 *     OR a literal "?" (and no user reply has come in after it).
 *
 * Importantly, we do NOT scan the full file body for permission phrases:
 * old prompts like "Can I proceed?" stay in the JSONL forever, so a global
 * regex match would pin the heart bubble on permanently.
 */
function inferNeedsPermissionFromTranscript(cwd, sessionId) {
  if (!cwd || !sessionId) return false;
  const slug = cwdToProjectSlug(cwd);
  if (!slug) return false;
  const jsonl = path.join(PROJECTS_ROOT, slug, `${sessionId}.jsonl`);
  return inferNeedsPermissionFromTranscriptPath(jsonl);
}

/**
 * Same as `inferNeedsPermissionFromTranscript` but takes a direct path to the
 * JSONL. Used by the Stop hook handler, which receives `transcript_path`
 * directly in its payload.
 */
function inferNeedsPermissionFromTranscriptPath(jsonl) {
  if (!jsonl || !fs.existsSync(jsonl)) return false;
  const tail = readFileTailUtf8(jsonl, 768 * 1024);
  const lines = tail.split('\n').filter(Boolean);
  const slice = lines.length > 6000 ? lines.slice(-6000) : lines;
  if (hasPendingToolUse(slice)) return true;
  return latestAssistantNeedsAnswer(slice);
}

/**
 * Scan the tail of the transcript backwards for the last "final" assistant
 * message — one whose content contains ONLY text blocks (no tool_use, no thinking).
 * This is the message Claude sends when it has finished a task and is idle.
 *
 * Returns a short fingerprint (first 120 chars of the text content) so the
 * caller can detect when a NEW final response has appeared.
 * Returns null if Claude is still mid-task.
 */
function getLastFinalAssistantFingerprint(cwd, sessionId) {
  if (!cwd || !sessionId) return null;
  const slug = cwdToProjectSlug(cwd);
  if (!slug) return null;
  const jsonl = path.join(PROJECTS_ROOT, slug, `${sessionId}.jsonl`);
  if (!fs.existsSync(jsonl)) return null;

  const tail = readFileTailUtf8(jsonl, 256 * 1024);
  const rawLines = tail.split('\n');

  for (let i = rawLines.length - 1; i >= 0; i--) {
    const line = rawLines[i].trim();
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (obj.type !== 'assistant') continue;

    const content =
      obj.message && Array.isArray(obj.message.content) ? obj.message.content : null;
    if (!content) continue;

    // Mid-task if any tool_use block is present. Thinking blocks alone are
    // fine — Claude often emits a short reasoning trace right before the
    // final answer and we still want to flash on that.
    const hasToolUse = content.some((b) => b && b.type === 'tool_use');
    if (hasToolUse) return null;

    const text = content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n');
    if (!text) return null;

    // Combine length + head + tail so that two short, similar answers
    // ("Done!" vs "Done.") don't collide and silently swallow a flash.
    return `${text.length}|${text.slice(0, 120)}|${text.slice(-40)}`;
  }

  return null;
}

module.exports = {
  inferNeedsPermissionFromTranscript,
  inferNeedsPermissionFromTranscriptPath,
  getLastFinalAssistantFingerprint,
  textLooksLikeQuestion,
};
