// Octagonle server: static files + accounts + stats. No npm dependencies.
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { applyResult, emptyStats, sanitizeStats, isDay, isDailyMode, MODES, MAX_GUESSES } from './public/js/stats.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'octagonle.db');
const SESSION_DAYS = 30;
const scryptAsync = promisify(scrypt);

await mkdir(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash TEXT NOT NULL,
    stats TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
`);
// daily_results gained a mode column when Easy mode was added; move old rows over as Hard daily.
const hasMode = db.prepare('PRAGMA table_info(daily_results)').all().some((c) => c.name === 'mode');
const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'daily_results'").get();
if (hasTable && !hasMode) db.exec('ALTER TABLE daily_results RENAME TO daily_results_old');
db.exec(`
  CREATE TABLE IF NOT EXISTS daily_results (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode TEXT NOT NULL,
    day TEXT NOT NULL,
    won INTEGER NOT NULL,
    guesses TEXT NOT NULL,
    PRIMARY KEY (user_id, mode, day)
  );
`);
if (hasTable && !hasMode) {
  db.exec(`INSERT INTO daily_results SELECT user_id, 'daily', day, won, guesses FROM daily_results_old; DROP TABLE daily_results_old;`);
}

const loadIds = async (file) => new Set(JSON.parse(await readFile(path.join(PUBLIC, 'data', file), 'utf8')).map((f) => f.id));
const hardIds = await loadIds('fighters.json');
const easyIds = await loadIds('champions.json');
const poolFor = (mode) => (mode.startsWith('easy') ? easyIds : hardIds);

// ---------- auth helpers ----------

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [saltHex, keyHex] = stored.split(':');
  const key = await scryptAsync(password, Buffer.from(saltHex, 'hex'), 64);
  return timingSafeEqual(key, Buffer.from(keyHex, 'hex'));
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

function createSession(res, req, userId) {
  const token = randomBytes(32).toString('base64url');
  const expires = Date.now() + SESSION_DAYS * 86400000;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), userId, expires);
  setSessionCookie(res, req, token, SESSION_DAYS * 86400);
}

function setSessionCookie(res, req, value, maxAge) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
  res.setHeader('Set-Cookie', `session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

function sessionToken(req) {
  return req.headers.cookie?.match(/(?:^|;\s*)session=([^;]+)/)?.[1] ?? null;
}

function currentUser(req) {
  const token = sessionToken(req);
  if (!token) return null;
  return db.prepare(`
    SELECT u.id, u.username, u.stats FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`).get(sha256(token), Date.now()) ?? null;
}

// Basic brute-force protection for login/signup: 20 attempts per IP per 10 minutes.
const attempts = new Map();
function rateLimited(req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now - entry.start > 600000) {
    attempts.set(ip, { start: now, count: 1 });
    return false;
  }
  return ++entry.count > 20;
}

// `today` holds the player's finished daily games for `day`, keyed by mode.
function publicUser(user, day) {
  const rows = isDay(day)
    ? db.prepare('SELECT mode, won, guesses FROM daily_results WHERE user_id = ? AND day = ?').all(user.id, day)
    : [];
  return {
    username: user.username,
    stats: sanitizeStats(JSON.parse(user.stats)),
    today: Object.fromEntries(rows.map((r) => [r.mode, { won: !!r.won, guesses: JSON.parse(r.guesses) }])),
  };
}

const validGuesses = (guesses, mode) => Array.isArray(guesses) && guesses.length >= 1 && guesses.length <= MAX_GUESSES
  && guesses.every((g) => poolFor(mode).has(g));

// ---------- API ----------

const routes = {
  'GET /api/me': (req, res, url) => {
    const user = currentUser(req);
    send(res, 200, { user: user ? publicUser(user, url.searchParams.get('day')) : null });
  },

  'POST /api/signup': async (req, res, url, body) => {
    if (rateLimited(req)) return send(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
    const username = String(body.username ?? '').trim();
    const password = String(body.password ?? '');
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return send(res, 400, { error: 'Username must be 3–20 letters, numbers or underscores.' });
    if (password.length < 6 || password.length > 200) return send(res, 400, { error: 'Password must be at least 6 characters.' });
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return send(res, 409, { error: 'That username is taken.' });

    // Carry over anything the player did as a guest.
    const stats = body.guestStats ? sanitizeStats(body.guestStats) : emptyStats();
    const { lastInsertRowid } = db.prepare('INSERT INTO users (username, pass_hash, stats, created_at) VALUES (?, ?, ?, ?)')
      .run(username, await hashPassword(password), JSON.stringify(stats), Date.now());
    // Today's dailies are already in the imported stats; just mark them as played.
    for (const mode of MODES.filter(isDailyMode)) {
      const game = body.today?.[mode];
      if (isDay(body.day) && validGuesses(game?.guesses, mode)) {
        db.prepare('INSERT OR IGNORE INTO daily_results (user_id, mode, day, won, guesses) VALUES (?, ?, ?, ?, ?)')
          .run(lastInsertRowid, mode, body.day, game.won ? 1 : 0, JSON.stringify(game.guesses));
      }
    }
    createSession(res, req, lastInsertRowid);
    const user = db.prepare('SELECT id, username, stats FROM users WHERE id = ?').get(lastInsertRowid);
    send(res, 201, { user: publicUser(user, body.day) });
  },

  'POST /api/login': async (req, res, url, body) => {
    if (rateLimited(req)) return send(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
    const row = db.prepare('SELECT id, username, stats, pass_hash FROM users WHERE username = ?').get(String(body.username ?? '').trim());
    if (!row || !(await verifyPassword(String(body.password ?? ''), row.pass_hash))) {
      return send(res, 401, { error: 'Wrong username or password.' });
    }
    createSession(res, req, row.id);
    send(res, 200, { user: publicUser(row, body.day) });
  },

  'POST /api/logout': (req, res) => {
    const token = sessionToken(req);
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    setSessionCookie(res, req, '', 0);
    send(res, 200, { ok: true });
  },

  'POST /api/result': (req, res, url, body) => {
    const user = currentUser(req);
    if (!user) return send(res, 401, { error: 'Not signed in.' });
    const { mode, won, guesses, day } = body;
    if (!MODES.includes(mode) || typeof won !== 'boolean' || !isDay(day)
      || !validGuesses(guesses, mode) || (!won && guesses.length !== MAX_GUESSES)) {
      return send(res, 400, { error: 'Invalid result.' });
    }
    if (isDailyMode(mode)) {
      // One result per user per daily mode per day; replays don't count.
      const inserted = db.prepare('INSERT OR IGNORE INTO daily_results (user_id, mode, day, won, guesses) VALUES (?, ?, ?, ?, ?)')
        .run(user.id, mode, day, won ? 1 : 0, JSON.stringify(guesses));
      if (inserted.changes === 0) return send(res, 200, { user: publicUser(user, day) });
    }
    const stats = applyResult(sanitizeStats(JSON.parse(user.stats)), { mode, won, guessCount: guesses.length, day });
    db.prepare('UPDATE users SET stats = ? WHERE id = ?').run(JSON.stringify(stats), user.id);
    send(res, 200, { user: publicUser({ ...user, stats: JSON.stringify(stats) }, day) });
  },
};

// ---------- HTTP plumbing ----------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 100_000) throw Object.assign(new Error('Body too large'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, { error: 'Forbidden' });
  try {
    const data = await readFile(file);
    const ext = path.extname(file);
    const cache = ext === '.png' || ext === '.jpg' ? 'public, max-age=604800' : 'no-cache';
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': cache });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    const route = routes[`${req.method} ${url.pathname}`];
    if (route) {
      const body = req.method === 'POST' ? await readBody(req) : {};
      return await route(req, res, url, body);
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
    await serveStatic(req, res, url);
  } catch (err) {
    if (!err.status) console.error(err);
    if (!res.headersSent) send(res, err.status ?? 500, { error: err.status ? err.message : 'Server error' });
  }
});

// Clear expired sessions hourly.
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 3600000).unref();

server.listen(PORT, () => console.log(`Octagonle running at http://localhost:${PORT}`));
