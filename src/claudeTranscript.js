const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects');

/** Matches assistant copy like "Can I proceed with these changes?" */
const PERMISSION_TEXT_RE =
  /can i proceed|proceed with these|would you like me to (apply|proceed)|should i (apply|run|continue)|do you want me to (apply|proceed)|needs your (approval|confirmation)|awaiting your (approval|response)|please confirm|permission to (run|execute)|before i (can )?(continue|make changes)|shall i (go ahead|proceed)|may i (proceed|apply)|are you okay with|want me to (apply|run these)/i;

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
 * True when the most recent transcript entry is an assistant message whose text
 * blocks contain "?". If the latest entry is from the user, the user just
 * replied — do not treat an older assistant question as still open.
 */
function transcriptEndsWithAssistantQuestion(lines) {
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
    return texts.includes('?');
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
 * Returns true if transcript suggests the user should respond (permission / question).
 * Detects:
 *  1. Any assistant text matching permission-asking phrases
 *  2. Any pending tool_use (Bash, Read, Write, AskUserQuestion, etc.) with no tool_result yet
 *  3. The latest transcript line is assistant text that contains "?"
 */
function inferNeedsPermissionFromTranscript(cwd, sessionId) {
  if (!cwd || !sessionId) return false;
  const slug = cwdToProjectSlug(cwd);
  if (!slug) return false;
  const jsonl = path.join(PROJECTS_ROOT, slug, `${sessionId}.jsonl`);
  if (!fs.existsSync(jsonl)) {
    return false;
  }

  const tail = readFileTailUtf8(jsonl, 768 * 1024);
  if (PERMISSION_TEXT_RE.test(tail)) {
    return true;
  }

  const lines = tail.split('\n').filter(Boolean);
  const slice = lines.length > 6000 ? lines.slice(-6000) : lines;
  if (hasPendingToolUse(slice)) return true;
  return transcriptEndsWithAssistantQuestion(slice);
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

    // Mid-task if any tool_use or thinking block is present.
    const hasMidTaskBlock = content.some(
      (b) => b && (b.type === 'tool_use' || b.type === 'thinking'),
    );
    if (hasMidTaskBlock) return null;

    const textBlock = content.find((b) => b && b.type === 'text');
    if (!textBlock || !textBlock.text) return null;

    return String(textBlock.text).slice(0, 120);
  }

  return null;
}

module.exports = {
  inferNeedsPermissionFromTranscript,
  getLastFinalAssistantFingerprint,
};
