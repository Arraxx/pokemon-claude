const fs = require('fs');
const path = require('path');

const ASSETS_ROOT = path.join(__dirname, '..', 'assets', 'pokemon-media');

/** @type {{ gen: number, species: string }[] | null} */
let poolCache = null;
let activeStyle = 'vscode';

/** agent id -> { gen, species } */
const idToSpecies = new Map();

/** Restrict the species pool when in `showdown` mode to only those with showdown gifs vendored. */
function setStyle(style) {
  const next = style === 'showdown' ? 'showdown' : 'vscode';
  if (next === activeStyle) return;
  activeStyle = next;
  poolCache = null;
}

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function loadPool() {
  if (poolCache) return poolCache;
  const out = [];
  /** Gen 1 only (per product preference). */
  for (let g = 1; g <= 1; g += 1) {
    const dir = path.join(ASSETS_ROOT, `gen${g}`);
    if (!fs.existsSync(dir)) continue;
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!/^[a-z0-9_]+$/i.test(name)) continue;
      const full = path.join(dir, name);
      try {
        if (!fs.statSync(full).isDirectory()) continue;
        if (activeStyle === 'showdown') {
          // Only include species that have showdown sprites vendored — otherwise the
          // renderer would assign a species that 404s on the showdown gif path.
          if (!fs.existsSync(path.join(full, 'showdown_default.gif'))) continue;
        }
        out.push({ gen: g, species: name.toLowerCase() });
      } catch {
        /* skip */
      }
    }
  }
  out.sort((a, b) => `${a.gen}-${a.species}`.localeCompare(`${b.gen}-${b.species}`));
  poolCache = out;
  return poolCache;
}

function keyOf(p) {
  return `${p.gen}:${p.species}`;
}

/**
 * Stable unique Pokémon per agent id; mutates rows in `agents` Map.
 */
function reconcileSpecies(agents) {
  const pool = loadPool();
  if (!pool.length) return;

  const liveIds = new Set(agents.keys());
  for (const id of idToSpecies.keys()) {
    if (!liveIds.has(id)) idToSpecies.delete(id);
  }

  function usedKeys() {
    return new Set([...idToSpecies.values()].map(keyOf));
  }

  for (const id of [...liveIds].sort()) {
    const row = agents.get(id);
    if (!row) continue;

    if (idToSpecies.has(id)) {
      const p = idToSpecies.get(id);
      row.gen = p.gen;
      row.species = p.species;
      continue;
    }

    const used = usedKeys();
    const start = hashString(id) % pool.length;
    let chosen = null;
    for (let off = 0; off < pool.length; off += 1) {
      const p = pool[(start + off) % pool.length];
      if (!used.has(keyOf(p))) {
        chosen = p;
        break;
      }
    }
    if (!chosen) chosen = pool[start % pool.length];
    idToSpecies.set(id, chosen);
    row.gen = chosen.gen;
    row.species = chosen.species;
  }

  const claimed = new Map();
  for (const id of [...liveIds].sort()) {
    const row = agents.get(id);
    const k = keyOf(row);
    if (!claimed.has(k)) {
      claimed.set(k, id);
      continue;
    }
    const used = new Set();
    for (const other of liveIds) {
      if (other === id) continue;
      const r = agents.get(other);
      if (r) used.add(keyOf(r));
    }
    const pick = pool.find((p) => !used.has(keyOf(p)));
    if (pick) {
      idToSpecies.set(id, pick);
      row.gen = pick.gen;
      row.species = pick.species;
    }
  }
}

function forgetAgent(id) {
  idToSpecies.delete(id);
}

module.exports = {
  reconcileSpecies,
  forgetAgent,
  setStyle,
};
