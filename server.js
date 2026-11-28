'use strict';
// Szafarz 3.0 – serwer aplikacji (Node.js + PostgreSQL). Aplikacja jest publiczna.
// Baza: harmonogram, szafarze, osiedla, chorzy, wizyty i log zmian harmonogramu. Słowo na dziś – z API Archidiecezji.
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./lib/db');
const slowo = require('./lib/slowo');

const PORT = Number(process.env.PORT || 3000);
const PROD = process.env.NODE_ENV === 'production' || !!process.env.DYNO;
const VIEWS = path.join(__dirname, 'views');
const STATIC = path.join(__dirname, 'static');
const REVEAL_CODE = process.env.REVEAL_CODE || '1234';
const MAX_BODY = 1024 * 1024;

let pool;
try { pool = db.createPool(); } catch (e) { console.error('[szafarz] BŁĄD KONFIGURACJI: ' + e.message); process.exit(1); }
const q = (sql, p) => pool.query(sql, p);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json; charset=utf-8' };

// ---------- pomocnicze ----------
function security(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (PROD) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}
function send(res, status, body, headers) { res.writeHead(status, headers || { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(body); }
function json(res, status, obj) { send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function sameOrigin(req) { const o = req.headers.origin; return !o || new URL(o).host === req.headers.host; }


// ---------- obsługa żądań ----------
async function handle(req, res) {
  security(res);
  if (PROD && req.headers['x-forwarded-proto'] === 'http') return send(res, 301, '', { Location: 'https://' + req.headers.host + req.url });
  const p = new URL(req.url, 'http://x').pathname;

  if (p === '/healthz') return send(res, 200, 'ok');

  if (p === '/api/slowo') {
    const iso = new URL(req.url, 'http://x').searchParams.get('data') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return json(res, 400, { error: 'data' });
    return json(res, 200, await slowo.pobierz(iso));
  }

  if (p === '/api/state') {
    if (req.headers['x-requested-with'] !== 'szafarz') return json(res, 403, { error: 'csrf' });
    if (req.method === 'GET') {
      const [s, ref] = await Promise.all([db.loadState(q), db.loadRef(q)]);
      return json(res, 200, { version: s.version, db: s.db, ref, config: { revealCode: REVEAL_CODE } });
    }
    if (req.method === 'PUT') {
      if (!sameOrigin(req)) return json(res, 403, { error: 'origin' });
      let body;
      try { body = JSON.parse(await readBody(req)); } catch (e) { return json(res, 400, { error: 'json' }); }
      if (!body || typeof body.db !== 'object' || body.db === null || typeof body.version !== 'string') return json(res, 400, { error: 'format' });
      delete body.db.focus;
      const r = await db.saveState(pool, body.db, body.version);
      return r.conflict ? json(res, 409, { error: 'conflict', version: r.version }) : json(res, 200, { version: r.version });
    }
    return json(res, 405, { error: 'method' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Metoda niedozwolona');
  if (p === '/') return serveFile(res, path.join(VIEWS, 'Main.html'), 'no-store');
  if (p === '/favicon.ico') return serveFile(res, path.join(STATIC, 'img', 'icon-192.png'), 'public, max-age=86400');
  if (p === '/manifest.webmanifest') return serveFile(res, path.join(STATIC, 'manifest.webmanifest'), 'public, max-age=86400');
  if (p === '/tresci.js') return serveFile(res, path.join(STATIC, 'tresci.js'), 'no-cache');
  if (p === '/runtime.js') return serveFile(res, path.join(STATIC, 'runtime.js'), 'no-cache');
  if (/^\/[A-Za-z]+$/.test(p) && p !== '/Main') return serveFile(res, path.join(VIEWS, p.slice(1) + '.html'), 'no-store');
  if (/^\/img\/[a-z0-9-]+\.(jpg|png|svg)$/.test(p)) return serveFile(res, path.join(STATIC, p), 'public, max-age=86400');
  return send(res, 404, 'Nie ma takiej strony.');
}

function serveFile(res, file, cache) {
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Nie ma takiej strony.');
    send(res, 200, data, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache });
  });
}

pool.query('SELECT 1 FROM sz_terminy LIMIT 1').then(() => {
  http.createServer((req, res) => {
    handle(req, res).catch((e) => { console.error(e); if (!res.headersSent) send(res, 500, 'Błąd serwera'); });
  }).listen(PORT, () => console.log(`[szafarz] działa na porcie ${PORT}; dane: PostgreSQL`));
}).catch((e) => { console.error('[szafarz] Baza niegotowa (' + e.message + '). Uruchom: npm run db'); process.exit(1); });
