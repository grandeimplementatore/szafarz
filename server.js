'use strict';
// Szafarz 3.0 – serwer aplikacji (Node.js, bez dodatkowych bibliotek poza opcjonalnym „pg”).
const http = require('http');
const fs = require('fs');
const path = require('path');
const auth = require('./lib/auth');
const { createStore } = require('./lib/store');

const PORT = Number(process.env.PORT || 3000);
const PROD = process.env.NODE_ENV === 'production';
const PUBLIC = path.join(__dirname, 'public');
const REVEAL_CODE = process.env.REVEAL_CODE || '1234';
const COOKIE = 'sz_session';
const MAX_BODY = 1024 * 1024;

const users = auth.loadUsers();
auth.secret();                       // w produkcji przerwie start, jeśli brak SESSION_SECRET
const store = createStore();

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const PUBLIC_ASSETS = new Set(['/img/kosciol.jpg', '/img/favicon.svg']);

// ---------- pomocnicze ----------
function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((c) => { const i = c.indexOf('='); if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); });
  return out;
}
function setSession(res, token, maxAgeSec) {
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${PROD ? '; Secure' : ''}`);
}
function security(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (PROD) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}
function send(res, status, body, type, extra) {
  res.writeHead(status, Object.assign({ 'Content-Type': type || 'text/plain; charset=utf-8' }, extra || {}));
  res.end(body);
}
function json(res, status, obj) { send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' }); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function safeNext(n) { return typeof n === 'string' && /^\/[A-Za-z]*$/.test(n) ? n : '/'; }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function clientIp(req) { return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress; }

// ---------- ograniczenie prób logowania ----------
const attempts = new Map();
function tooMany(ip) {
  const a = attempts.get(ip);
  return a && a.count >= 10 && Date.now() - a.first < 15 * 60e3;
}
function failed(ip) {
  const a = attempts.get(ip);
  if (!a || Date.now() - a.first > 15 * 60e3) attempts.set(ip, { count: 1, first: Date.now() });
  else a.count++;
}

// ---------- strona logowania ----------
function loginPage(msg, next, login) {
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Logowanie – Szafarz 3.0</title><link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Fondamento&family=Lato:wght@400;700;900&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;font-family:Lato,system-ui,sans-serif;color:#333;background:#2B3643 url(/img/kosciol.jpg) center/cover no-repeat;display:flex;align-items:center;justify-content:center;padding:20px}
body:before{content:"";position:fixed;inset:0;background:rgba(20,24,30,.6)}
main{position:relative;width:100%;max-width:400px;background:#fff;box-shadow:0 20px 50px rgba(0,0,0,.35)}
header{background:#BD4F38;color:#fff;padding:22px 24px}h1{margin:0;font:400 26px/1.15 Fondamento,Georgia,serif}header p{margin:6px 0 0;font-size:13px;opacity:.92}
form{padding:22px 24px 26px;display:flex;flex-direction:column;gap:14px}label{display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:700}
input{min-height:46px;padding:0 12px;border:1px solid #BDBDBD;border-radius:4px;font:16px Lato,system-ui,sans-serif}input:focus{outline:3px solid #F2B8A9;border-color:#BD4F38}
button{min-height:48px;border:0;background:#BD4F38;color:#fff;font:900 15px Lato,system-ui,sans-serif;cursor:pointer}button:hover{background:#A9442F}
.err{margin:0;padding:10px 12px;background:#FFF6F3;border:1px solid #F1D6CE;color:#8C3524;font-size:14px;font-weight:700}
.note{margin:0;font-size:12px;color:#5D5D5D;line-height:1.5}
</style></head><body><main>
<header><h1>Wspólnota Szafarzy Nadzwyczajnych Komunii Świętej</h1><p>Parafia bł. Karoliny Kózkówny w Tychach</p></header>
<form method="post" action="/login">
${msg ? `<p class="err" role="alert">${esc(msg)}</p>` : ''}
<input type="hidden" name="next" value="${esc(next)}">
<label>Login<input name="login" autocomplete="username" autocapitalize="none" value="${esc(login || '')}" required autofocus></label>
<label>Hasło<input name="password" type="password" autocomplete="current-password" required></label>
<button type="submit">Zaloguj się</button>
<p class="note">Dostęp tylko dla szafarzy parafii. Nie znasz hasła? Zapytaj lidera wspólnoty.</p>
</form></main></body></html>`;
}

// ---------- obsługa żądań ----------
async function handle(req, res) {
  security(res);
  if (PROD && req.headers['x-forwarded-proto'] === 'http') {
    return send(res, 301, '', 'text/plain', { Location: 'https://' + req.headers.host + req.url });
  }
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;

  if (p === '/healthz') return send(res, 200, 'ok');

  if (p === '/login' && req.method === 'GET') {
    return send(res, 200, loginPage('', safeNext(u.searchParams.get('next'))), TYPES['.html'], { 'Cache-Control': 'no-store' });
  }
  if (p === '/login' && req.method === 'POST') {
    const ip = clientIp(req);
    const form = new URLSearchParams(await readBody(req));
    const login = String(form.get('login') || '').trim().toLowerCase();
    const next = safeNext(form.get('next'));
    if (tooMany(ip)) return send(res, 429, loginPage('Zbyt wiele nieudanych prób. Spróbuj ponownie za 15 minut.', next, login), TYPES['.html']);
    const user = users[login];
    if (!user || !auth.verifyPassword(form.get('password') || '', user.hash)) {
      failed(ip);
      return send(res, 401, loginPage('Nieprawidłowy login lub hasło.', next, login), TYPES['.html']);
    }
    attempts.delete(ip);
    setSession(res, auth.makeToken(login), auth.SESSION_DAYS * 86400);
    return send(res, 303, '', 'text/plain', { Location: next });
  }
  if (p === '/logout') {
    setSession(res, '', 0);
    return send(res, 303, '', 'text/plain', { Location: '/login' });
  }
  if (PUBLIC_ASSETS.has(p)) return serveFile(res, path.join(PUBLIC, p), 'public, max-age=86400');

  // wszystko poniżej – tylko po zalogowaniu
  const me = auth.readToken(cookies(req)[COOKIE], users);

  if (p === '/api/state') {
    if (!me) return json(res, 401, { error: 'auth' });
    if (req.headers['x-requested-with'] !== 'szafarz') return json(res, 403, { error: 'csrf' });
    if (req.method === 'GET') {
      const s = await store.load();
      return json(res, 200, { version: s.version, db: s.db, user: me, config: { revealCode: REVEAL_CODE } });
    }
    if (req.method === 'PUT') {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) return json(res, 403, { error: 'origin' });
      let body;
      try { body = JSON.parse(await readBody(req)); } catch (e) { return json(res, 400, { error: 'json' }); }
      if (!body || typeof body.db !== 'object' || body.db === null || !Number.isInteger(body.version)) return json(res, 400, { error: 'format' });
      const db = body.db;
      delete db.focus;
      // podpis autora przy nowych wpisach w dzienniku zmian szafarzy
      (db.changelog || []).forEach((c) => { if (c && !c.by) c.by = me.name; });
      const r = await store.save(db, body.version, me.login);
      return r.conflict ? json(res, 409, { error: 'conflict', version: r.version }) : json(res, 200, { version: r.version });
    }
    return json(res, 405, { error: 'method' });
  }

  if (!me) {
    if (req.method !== 'GET') return send(res, 401, 'Zaloguj się.');
    return send(res, 303, '', 'text/plain', { Location: '/login?next=' + encodeURIComponent(safeNext(p)) });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Metoda niedozwolona');
  if (p === '/' ) return serveFile(res, path.join(PUBLIC, 'Main.html'), 'no-store');
  if (p === '/runtime.js') return serveFile(res, path.join(PUBLIC, 'runtime.js'), 'no-cache');
  if (/^\/[A-Za-z]+$/.test(p) && p !== '/Main') return serveFile(res, path.join(PUBLIC, p.slice(1) + '.html'), 'no-store');
  if (/^\/img\/[a-z0-9-]+\.(jpg|png|svg)$/.test(p)) return serveFile(res, path.join(PUBLIC, p), 'public, max-age=86400');
  return send(res, 404, 'Nie ma takiej strony.');
}

function serveFile(res, file, cache) {
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Nie ma takiej strony.');
    send(res, 200, data, TYPES[path.extname(file)] || 'application/octet-stream', { 'Cache-Control': cache });
  });
}

store.init().then(() => {
  if (!fs.existsSync(path.join(PUBLIC, 'Main.html'))) console.warn('[szafarz] Brak public/ – uruchom najpierw: npm run build');
  http.createServer((req, res) => {
    handle(req, res).catch((e) => { console.error(e); if (!res.headersSent) send(res, 500, 'Błąd serwera'); });
  }).listen(PORT, () => {
    console.log(`[szafarz] działa na porcie ${PORT}; dane: ${store.kind}; konta: ${Object.keys(users).length}`);
    if (PROD && !Object.keys(users).length) console.error('[szafarz] UWAGA: brak kont w zmiennej USERS – nikt się nie zaloguje.');
  });
}).catch((e) => { console.error('[szafarz] Nie można uruchomić:', e.message); process.exit(1); });
