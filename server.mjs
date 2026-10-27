// Octagonle server: serves the static game in public/. No npm dependencies.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
};

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed');
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return sendText(res, 400, 'Bad request');
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC + path.sep)) return sendText(res, 403, 'Forbidden');
  try {
    const data = await readFile(file);
    const ext = path.extname(file);
    const cache = ext === '.png' || ext === '.jpg' ? 'public, max-age=604800' : 'no-cache';
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': cache });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    sendText(res, 404, 'Not found');
  }
});

server.listen(PORT, () => console.log(`Octagonle running at http://localhost:${PORT}`));
