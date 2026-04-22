const { reconcileSpecies, forgetAgent } = require('./speciesRegistry');

const sseClients = new Set();
/** @type {Map<string, object>} */
const agents = new Map();

function broadcast(eventName, data) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

function getState() {
  return Object.fromEntries(agents);
}

/**
 * Replace only agents whose ids start with `cc:` (Claude Code sessions).
 * Other ids (manual /api/event) are left as-is.
 */
function syncClaudeAgents(rows) {
  for (const id of [...agents.keys()]) {
    if (id.startsWith('cc:')) agents.delete(id);
  }
  const now = Date.now();
  for (const row of rows) {
    if (!row || !row.id) continue;
    agents.set(row.id, { ...row, updatedAt: row.updatedAt || now });
  }
  reconcileSpecies(agents);
  broadcast('state', { agents: getState() });
}

function upsertFromEvent(body) {
  const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : null;
  if (!id) return { error: 'missing id' };

  const allowed = new Set(['running', 'idle', 'needs_permission', 'completed', 'failed']);
  const status = typeof body.status === 'string' && allowed.has(body.status) ? body.status : null;
  if (!status) return { error: 'invalid status' };

  const gen = Number.isInteger(body.gen) && body.gen >= 1 && body.gen <= 4 ? body.gen : 1;
  const species =
    typeof body.species === 'string' && /^[a-z0-9_]+$/.test(body.species) ? body.species : 'pikachu';
  const shiny = Boolean(body.shiny);
  const label = typeof body.label === 'string' ? body.label.slice(0, 200) : '';

  const prev = agents.get(id) || {};
  const row = {
    id,
    status,
    gen,
    species,
    shiny,
    label,
    updatedAt: Date.now(),
    tokens: typeof body.tokens === 'number' && body.tokens >= 0 ? Math.floor(body.tokens) : prev.tokens,
    source: prev.source || 'api',
  };
  agents.set(id, row);
  reconcileSpecies(agents);
  broadcast('state', { agents: getState() });
  return { ok: true, agent: agents.get(id) };
}

function removeById(id) {
  if (!id || !agents.has(id)) return false;
  forgetAgent(id);
  agents.delete(id);
  broadcast('state', { agents: getState() });
  return true;
}

module.exports = {
  sseClients,
  getState,
  syncClaudeAgents,
  upsertFromEvent,
  removeById,
};
