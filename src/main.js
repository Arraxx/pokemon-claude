const { app, BrowserWindow, screen } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const { sseClients, getState, upsertFromEvent, removeById } = require('./agentStore');
const { startClaudePolling } = require('./claudeSessions');

/** Project root (parent of src/). */
const ROOT = path.join(__dirname, '..');
const RENDERER_ROOT = path.join(ROOT, 'renderer');
const ASSETS_ROOT = path.join(ROOT, 'assets', 'pokemon-media');

/** Prefer `POKEMON_CLAUDE_*`. `POKEMON_INTACT_*` is still read if the new name is unset. */
function env(key, legacyKey) {
  if (key in process.env) return process.env[key];
  if (legacyKey != null && legacyKey in process.env) return process.env[legacyKey];
  return undefined;
}

const DEFAULT_PORT = Number(env('POKEMON_CLAUDE_PORT', 'POKEMON_INTACT_PORT') || 3847);
const HOST = '127.0.0.1';

/** Base strip height — keep small so less of the screen is blocked. */
const DOCK_HEIGHT = Number(env('POKEMON_CLAUDE_DOCK_HEIGHT', 'POKEMON_INTACT_DOCK_HEIGHT') || 136);
/** When this window is focused, grow upward by this many pixels. */
const DOCK_LIFT = Number(env('POKEMON_CLAUDE_DOCK_LIFT', 'POKEMON_INTACT_DOCK_LIFT') || 36);
/** Forward mouse events to apps behind the overlay (default on). Set to 0 to drag the window. */
const MOUSE_PASSTHROUGH = env('POKEMON_CLAUDE_MOUSE_PASSTHROUGH', 'POKEMON_INTACT_MOUSE_PASSTHROUGH') !== '0';
/** Claude `~/.claude/sessions` sync (set to `0` to disable). */
const CLAUDE_SESSION_SYNC = env('POKEMON_CLAUDE_SYNC', 'POKEMON_INTACT_CLAUDE') !== '0';

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function safeResolveAsset(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const rel = path.normalize(decoded.replace(/^\/+/, ''));
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const full = path.join(ASSETS_ROOT, rel);
  if (!full.startsWith(ASSETS_ROOT)) return null;
  return full;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function serveFile(res, filePath) {
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
}

function readBody(req, limit = 65536) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (c) => {
      total += c.length;
      if (total > limit) {
        reject(new Error('body too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${HOST}:${DEFAULT_PORT}`);

    if (req.method === 'GET' && url.pathname === '/api/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(': ok\n\n');
      sseClients.add(res);
      res.on('close', () => sseClients.delete(res));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/meta') {
      json(res, 200, {
        port: DEFAULT_PORT,
        host: HOST,
        claudeSync: CLAUDE_SESSION_SYNC,
        mousePassthrough: MOUSE_PASSTHROUGH,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      json(res, 200, { agents: getState() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/event') {
      let buf;
      try {
        buf = await readBody(req);
      } catch {
        json(res, 413, { error: 'payload too large' });
        return;
      }
      let body;
      try {
        body = JSON.parse(buf.toString('utf8') || '{}');
      } catch {
        json(res, 400, { error: 'invalid JSON' });
        return;
      }
      const result = upsertFromEvent(body);
      if (result.error) {
        json(res, 400, result);
        return;
      }
      json(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/agents/remove') {
      let buf;
      try {
        buf = await readBody(req);
      } catch {
        json(res, 413, { error: 'payload too large' });
        return;
      }
      let body;
      try {
        body = JSON.parse(buf.toString('utf8') || '{}');
      } catch {
        json(res, 400, { error: 'invalid JSON' });
        return;
      }
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!id || !removeById(id)) {
        json(res, 404, { error: 'unknown id' });
        return;
      }
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
      const rel = url.pathname.slice('/assets/'.length);
      const full = safeResolveAsset(rel);
      if (!full) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      serveFile(res, full);
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      serveFile(res, path.join(RENDERER_ROOT, 'index.html'));
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/ui/')) {
      const rel = url.pathname.slice('/ui/'.length);
      const full = path.join(RENDERER_ROOT, path.normalize(rel));
      if (!full.startsWith(RENDERER_ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      serveFile(res, full);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });
}

let mainWindow;
let server;
let claudeTimer;

function layoutDockBounds(lifted) {
  const wa = screen.getPrimaryDisplay().workArea;
  const lift = lifted ? DOCK_LIFT : 0;
  const h = DOCK_HEIGHT + lift;
  return {
    x: wa.x,
    y: wa.y + wa.height - h,
    width: wa.width,
    height: h,
  };
}

function applyDockBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const lifted = mainWindow.isFocused();
  mainWindow.setBounds(layoutDockBounds(lifted));
}

function applyMousePassthrough() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (MOUSE_PASSTHROUGH) {
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
  } else {
    mainWindow.setIgnoreMouseEvents(false);
  }
}

function startServer() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(DEFAULT_PORT, HOST, () => resolve(srv));
    srv.on('error', reject);
  });
}

function createWindow() {
  const winOpts = {
    ...layoutDockBounds(false),
    title: 'Pokémon Claude',
    frame: false,
    transparent: true,
    /** Required on macOS for see-through web contents (no grey backing). */
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    fullscreenable: false,
    /** macOS NSPanel-style helper; stays out of “tab strip” / document flows. */
    type: process.platform === 'darwin' ? 'panel' : undefined,
    skipTaskbar: false,
    show: true,
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  };
  mainWindow = new BrowserWindow(winOpts);
  if (process.platform === 'darwin') {
    /**
     * Higher than “floating” so the dock stays above normal app windows when switching apps / tabs.
     * (Same idea as small always-on-top utilities; tune via env if needed.)
     */
    const level = env('POKEMON_CLAUDE_MAC_LEVEL', 'POKEMON_INTACT_MAC_LEVEL') || 'status';
    mainWindow.setAlwaysOnTop(true, level);
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  mainWindow.loadURL(`http://${HOST}:${DEFAULT_PORT}/`);
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.insertCSS('html,body{background:transparent!important;}');
  });
  mainWindow.on('focus', () => applyDockBounds());
  mainWindow.on('blur', () => applyDockBounds());
  mainWindow.once('ready-to-show', () => {
    applyDockBounds();
    applyMousePassthrough();
  });
}

app.whenReady().then(async () => {
  try {
    server = await startServer();
  } catch (e) {
    console.error(`Could not bind ${HOST}:${DEFAULT_PORT}`, e.message);
    app.quit();
    return;
  }

  if (!fs.existsSync(ASSETS_ROOT) || !fs.existsSync(path.join(ASSETS_ROOT, 'gen1'))) {
    console.warn(
      'Sprite assets missing. Run: npm run vendor-sprites\nThen restart the app.',
    );
  }

  if (CLAUDE_SESSION_SYNC) {
    claudeTimer = startClaudePolling({
      intervalMs: Number(
        env('POKEMON_CLAUDE_POLL_MS', 'POKEMON_INTACT_CLAUDE_POLL_MS') || 2500,
      ),
    });
  }

  createWindow();
  applyDockBounds();
  applyMousePassthrough();

  screen.on('display-metrics-changed', () => {
    applyDockBounds();
    applyMousePassthrough();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (claudeTimer) clearInterval(claudeTimer);
  server?.close();
  app.quit();
});

app.on('before-quit', () => {
  if (claudeTimer) clearInterval(claudeTimer);
  server?.close();
});
