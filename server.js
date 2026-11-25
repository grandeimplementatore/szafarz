'use strict';
// Szafarz 3.0 – serwer aplikacji (Node.js + PostgreSQL). Nie wymaga żadnych ustawień poza bazą.
const http = require('http');
const fs = require('fs');
const path = require('path');
const auth = require('./lib/auth');
const { createStore } = require('./lib/store');

const PORT = Number(process.env.PORT || 3000);
const PROD = process.env.NODE_ENV === 'production' || !!process.env.DYNO;
const PUBLIC = path.join(__dirname, 'public');
const REVEAL_CODE = process.env.REVEAL_CODE || '1234';
const COOKIE = 'sz_session';
const MAX_BODY = 1024 * 1024;

let store;
try { store = createStore(); } catch (e) { console.error('[szafarz] BŁĄD KONFIGURACJI: ' + e.message); process.exit(1); }
let SECRET = null;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const PUBLIC_ASSETS = new Set(['/img/kosciol.jpg', '/img/favicon.svg']);
const HTML = { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' };

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
function send(res, status, body, headers) { res.writeHead(status, headers || { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(body); }
function redirect(res, to) { send(res, 303, '', { Location: to, 'Cache-Control': 'no-store' }); }
function json(res, status, obj) { send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function readForm(req) { return new URLSearchParams(await readBody(req)); }
function safeNext(n) { return typeof n === 'string' && /^\/[A-Za-z]*$/.test(n) ? n : '/'; }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function clientIp(req) { return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress; }
function sameOrigin(req) { const o = req.headers.origin; return !o || new URL(o).host === req.headers.host; }
const LOGIN_RE = /^[a-z0-9._-]{2,30}$/;

// ---------- ograniczenie prób logowania ----------
const attempts = new Map();
function tooMany(ip) { const a = attempts.get(ip); return a && a.count >= 10 && Date.now() - a.first < 15 * 60e3; }
function failed(ip) {
  const a = attempts.get(ip);
  if (!a || Date.now() - a.first > 15 * 60e3) attempts.set(ip, { count: 1, first: Date.now() }); else a.count++;
}

// ---------- kto jest zalogowany ----------
async function currentUser(req) {
  const t = auth.readToken(SECRET, cookies(req)[COOKIE]);
  if (!t) return null;
  const u = await store.getUser(t.login);
  return u && auth.pwTag(u.hash) === t.tag ? u : null;
}

// ---------- strony logowania i kont (HTML z serwera) ----------
const CSS = `*{box-sizing:border-box}body{margin:0;min-height:100vh;font-family:Lato,system-ui,sans-serif;color:#333;background:#F0F0F0}
.bg{background:#2B3643 url(/img/kosciol.jpg) center/cover no-repeat;display:flex;align-items:center;justify-content:center;padding:20px}
.bg:before{content:"";position:fixed;inset:0;background:rgba(20,24,30,.6)}
main{position:relative;width:100%;max-width:420px;background:#fff;box-shadow:0 20px 50px rgba(0,0,0,.35)}
main.wide{max-width:760px;margin:24px auto;box-shadow:none}
header{background:#BD4F38;color:#fff;padding:22px 24px}h1{margin:0;font:400 26px/1.15 Fondamento,Georgia,serif}header p{margin:6px 0 0;font-size:13px;opacity:.92}
header a{color:#fff}
form{display:flex;flex-direction:column;gap:12px}.box{padding:22px 24px 26px;display:flex;flex-direction:column;gap:18px}
h2{margin:0;font:400 21px Fondamento,Georgia,serif;color:#BD4F38}
label{display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:700}label.row{flex-direction:row;align-items:center;gap:8px}
input[type=text],input[type=password]{min-height:46px;padding:0 12px;border:1px solid #BDBDBD;border-radius:4px;font:16px Lato,system-ui,sans-serif}
input:focus{outline:3px solid #F2B8A9;border-color:#BD4F38}
button{min-height:46px;padding:0 18px;border:0;background:#BD4F38;color:#fff;font:900 15px Lato,system-ui,sans-serif;cursor:pointer}button:hover{background:#A9442F}
button.ghost{background:#fff;color:#B3261E;border:1px solid #E3B5AE;min-height:38px;font-size:13px}
.err{margin:0;padding:10px 12px;background:#FFF6F3;border:1px solid #F1D6CE;color:#8C3524;font-size:14px;font-weight:700}
.ok{margin:0;padding:10px 12px;background:#EEF6F1;border:1px solid #BFDCCB;color:#1F5E3A;font-size:14px;font-weight:700}
.note{margin:0;font-size:13px;color:#5D5D5D;line-height:1.5}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
table{width:100%;border-collapse:collapse;font-size:15px}td{padding:10px 6px;border-bottom:1px solid #E5E5E5;vertical-align:middle}
.tag{font-size:11px;font-weight:900;color:#003C60;background:#E8EEF3;padding:2px 6px;border-radius:999px;margin-left:6px}
td form{flex-direction:row;gap:6px;flex-wrap:wrap;justify-content:flex-end}td input[type=password]{min-height:38px;width:150px;font-size:14px}`;

function page(title, body, wide) {
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${esc(title)} – Szafarz 3.0</title><link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Fondamento&family=Lato:wght@400;700;900&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body${wide ? '' : ' class="bg"'}>${body}</body></html>`;
}
const HEAD = (sub) => `<header><h1>Wspólnota Szafarzy Nadzwyczajnych Komunii Świętej</h1><p>${sub}</p></header>`;
const msgHtml = (m) => (m ? `<p class="${m.ok ? 'ok' : 'err'}" role="${m.ok ? 'status' : 'alert'}">${esc(m.text)}</p>` : '');

function loginPage(m, next, login) {
  return page('Logowanie', `<main>${HEAD('Parafia bł. Karoliny Kózkówny w Tychach')}<div class="box"><form method="post" action="/login">
${msgHtml(m)}<input type="hidden" name="next" value="${esc(next)}">
<label>Login<input type="text" name="login" autocomplete="username" autocapitalize="none" value="${esc(login || '')}" required autofocus></label>
<label>Hasło<input type="password" name="password" autocomplete="current-password" required></label>
<button type="submit">Zaloguj się</button>
<p class="note">Dostęp tylko dla szafarzy parafii. Nie masz konta albo nie pamiętasz hasła? Poproś administratora aplikacji.</p>
</form></div></main>`);
}

function setupPage(m, v) {
  v = v || {};
  return page('Pierwsze uruchomienie', `<main>${HEAD('Pierwsze uruchomienie aplikacji')}<div class="box"><form method="post" action="/setup">
${msgHtml(m)}<p class="note">Załóż pierwsze konto – będzie kontem <b>administratora</b>. Administrator dodaje pozostałych szafarzy w zakładce „Konta”.</p>
<label>Imię i nazwisko<input type="text" name="name" value="${esc(v.name || '')}" required autofocus></label>
<label>Login (małe litery, bez spacji)<input type="text" name="login" autocapitalize="none" value="${esc(v.login || '')}" required></label>
<label>Hasło (co najmniej 8 znaków)<input type="password" name="password" autocomplete="new-password" required></label>
<label>Powtórz hasło<input type="password" name="password2" autocomplete="new-password" required></label>
<button type="submit">Załóż konto administratora</button>
</form></div></main>`);
}

async function accountsPage(me, m) {
  const users = me.isAdmin ? await store.listUsers() : [];
  const rows = users.map((u) => `<tr><td><b>${esc(u.name)}</b>${u.isAdmin ? '<span class="tag">administrator</span>' : ''}<br><span class="note">login: ${esc(u.login)}</span></td>
<td><form method="post" action="/konta/haslo"><input type="hidden" name="login" value="${esc(u.login)}"><input type="password" name="password" placeholder="nowe hasło" autocomplete="new-password" aria-label="Nowe hasło dla ${esc(u.name)}" required><button class="ghost" type="submit">Ustaw hasło</button></form>
${u.login === me.login ? '' : `<form method="post" action="/konta/usun" style="margin-top:6px"><input type="hidden" name="login" value="${esc(u.login)}"><button class="ghost" type="submit" onclick="return confirm('Usunąć konto ${esc(u.name.replace(/['"\\]/g, ''))}?')">Usuń konto</button></form>`}</td></tr>`).join('');
  const admin = me.isAdmin ? `
<section style="display:flex;flex-direction:column;gap:12px"><h2>Dodaj szafarza</h2>
<form method="post" action="/konta/dodaj"><div class="grid">
<label>Imię i nazwisko<input type="text" name="name" required></label>
<label>Login<input type="text" name="login" autocapitalize="none" required></label>
<label>Hasło startowe<input type="password" name="password" autocomplete="new-password" required></label></div>
<label class="row"><input type="checkbox" name="admin" value="1"> Administrator (może zarządzać kontami)</label>
<button type="submit">Dodaj konto</button>
<p class="note">Przekaż szafarzowi login i hasło osobiście. Po zalogowaniu może zmienić hasło na tej stronie.</p></form></section>
<section style="display:flex;flex-direction:column;gap:8px"><h2>Konta (${users.length})</h2><table>${rows}</table></section>` : '';
  return page('Konta', `<main class="wide">${HEAD(`Zalogowany: ${esc(me.name)} · <a href="/">Wróć do aplikacji</a> · <a href="/logout">Wyloguj</a>`)}<div class="box">
${msgHtml(m)}
<section style="display:flex;flex-direction:column;gap:12px"><h2>Moje hasło</h2>
<form method="post" action="/konta/moje-haslo"><div class="grid">
<label>Obecne hasło<input type="password" name="old" autocomplete="current-password" required></label>
<label>Nowe hasło<input type="password" name="password" autocomplete="new-password" required></label>
<label>Powtórz nowe hasło<input type="password" name="password2" autocomplete="new-password" required></label></div>
<button type="submit">Zmień hasło</button></form></section>${admin}
</div></main>`, true);
}

// ---------- obsługa żądań ----------
async function handle(req, res) {
  security(res);
  if (PROD && req.headers['x-forwarded-proto'] === 'http') return send(res, 301, '', { Location: 'https://' + req.headers.host + req.url });
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  const isPost = req.method === 'POST';
  if (isPost && !sameOrigin(req)) return send(res, 403, 'Niedozwolone');

  if (p === '/healthz') return send(res, 200, 'ok');
  if (PUBLIC_ASSETS.has(p)) return serveFile(res, path.join(PUBLIC, p), 'public, max-age=86400');

  // pierwsze uruchomienie – brak kont
  const noUsers = (await store.countUsers()) === 0;
  if (p === '/setup') {
    if (!noUsers) return redirect(res, '/');
    if (!isPost) return send(res, 200, setupPage(), HTML);
    const f = await readForm(req);
    const v = { name: String(f.get('name') || '').trim(), login: String(f.get('login') || '').trim().toLowerCase() };
    const pw = String(f.get('password') || '');
    let err = '';
    if (!v.name) err = 'Podaj imię i nazwisko.';
    else if (!LOGIN_RE.test(v.login)) err = 'Login: 2–30 znaków, tylko małe litery, cyfry, kropka, myślnik.';
    else if (pw.length < 8) err = 'Hasło musi mieć co najmniej 8 znaków.';
    else if (pw !== f.get('password2')) err = 'Hasła się różnią.';
    if (err) return send(res, 400, setupPage({ text: err }, v), HTML);
    const user = { login: v.login, name: v.name, hash: auth.hashPassword(pw), isAdmin: true };
    if (!(await store.addUser(user, true))) return redirect(res, '/login');
    setSession(res, auth.makeToken(SECRET, user), auth.SESSION_DAYS * 86400);
    return redirect(res, '/konta');
  }
  if (noUsers) return redirect(res, '/setup');

  if (p === '/login' && !isPost) return send(res, 200, loginPage(null, safeNext(u.searchParams.get('next'))), HTML);
  if (p === '/login' && isPost) {
    const ip = clientIp(req);
    const f = await readForm(req);
    const login = String(f.get('login') || '').trim().toLowerCase();
    const next = safeNext(f.get('next'));
    if (tooMany(ip)) return send(res, 429, loginPage({ text: 'Zbyt wiele nieudanych prób. Spróbuj ponownie za 15 minut.' }, next, login), HTML);
    const user = await store.getUser(login);
    if (!user || !auth.verifyPassword(f.get('password') || '', user.hash)) {
      failed(ip);
      return send(res, 401, loginPage({ text: 'Nieprawidłowy login lub hasło.' }, next, login), HTML);
    }
    attempts.delete(ip);
    setSession(res, auth.makeToken(SECRET, user), auth.SESSION_DAYS * 86400);
    return redirect(res, next);
  }
  if (p === '/logout') { setSession(res, '', 0); return redirect(res, '/login'); }

  // ---- wszystko poniżej – tylko po zalogowaniu ----
  const me = await currentUser(req);

  if (p === '/api/state') {
    if (!me) return json(res, 401, { error: 'auth' });
    if (req.headers['x-requested-with'] !== 'szafarz') return json(res, 403, { error: 'csrf' });
    if (req.method === 'GET') {
      const s = await store.load();
      return json(res, 200, { version: s.version, db: s.db, user: { login: me.login, name: me.name, isAdmin: me.isAdmin }, config: { revealCode: REVEAL_CODE } });
    }
    if (req.method === 'PUT') {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch (e) { return json(res, 400, { error: 'json' }); }
      if (!body || typeof body.db !== 'object' || body.db === null || !Number.isInteger(body.version)) return json(res, 400, { error: 'format' });
      const db = body.db;
      delete db.focus;
      (db.changelog || []).forEach((c) => { if (c && !c.by) c.by = me.name; });   // podpis autora zmiany szafarza
      const r = await store.save(db, body.version, me.login);
      return r.conflict ? json(res, 409, { error: 'conflict', version: r.version }) : json(res, 200, { version: r.version });
    }
    return json(res, 405, { error: 'method' });
  }

  if (!me) {
    if (req.method !== 'GET') return send(res, 401, 'Zaloguj się.');
    return redirect(res, '/login?next=' + encodeURIComponent(safeNext(p)));
  }

  // ---- konta ----
  if (p === '/konta' && !isPost) return send(res, 200, await accountsPage(me), HTML);
  if (p.startsWith('/konta/') && isPost) {
    const f = await readForm(req);
    const show = async (text, ok) => send(res, ok ? 200 : 400, await accountsPage(await store.getUser(me.login) || me, { text, ok }), HTML);
    const pw = String(f.get('password') || '');
    if (p === '/konta/moje-haslo') {
      if (!auth.verifyPassword(f.get('old') || '', me.hash)) return show('Obecne hasło jest nieprawidłowe.');
      if (pw.length < 8) return show('Nowe hasło musi mieć co najmniej 8 znaków.');
      if (pw !== f.get('password2')) return show('Nowe hasła się różnią.');
      const hash = auth.hashPassword(pw);
      await store.setPassword(me.login, hash);
      setSession(res, auth.makeToken(SECRET, { login: me.login, hash }), auth.SESSION_DAYS * 86400);
      return show('Hasło zmienione.', true);
    }
    if (!me.isAdmin) return send(res, 403, 'Tylko administrator może zarządzać kontami.');
    const login = String(f.get('login') || '').trim().toLowerCase();
    if (p === '/konta/dodaj') {
      const name = String(f.get('name') || '').trim();
      if (!name) return show('Podaj imię i nazwisko.');
      if (!LOGIN_RE.test(login)) return show('Login: 2–30 znaków, tylko małe litery, cyfry, kropka, myślnik.');
      if (pw.length < 8) return show('Hasło musi mieć co najmniej 8 znaków.');
      const ok = await store.addUser({ login, name, hash: auth.hashPassword(pw), isAdmin: f.get('admin') === '1' });
      return ok ? show('Dodano konto: ' + name + ' (login: ' + login + ').', true) : show('Konto z loginem „' + login + '” już istnieje.');
    }
    const target = await store.getUser(login);
    if (!target) return show('Nie ma takiego konta.');
    if (p === '/konta/haslo') {
      if (pw.length < 8) return show('Hasło musi mieć co najmniej 8 znaków.');
      await store.setPassword(login, auth.hashPassword(pw));
      if (login === me.login) setSession(res, '', 0);
      return show('Ustawiono nowe hasło dla: ' + target.name + '.', true);
    }
    if (p === '/konta/usun') {
      if (login === me.login) return show('Nie możesz usunąć własnego konta.');
      await store.deleteUser(login);
      return show('Usunięto konto: ' + target.name + '.', true);
    }
    return send(res, 404, 'Nie ma takiej strony.');
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Metoda niedozwolona');
  if (p === '/') return serveFile(res, path.join(PUBLIC, 'Main.html'), 'no-store');
  if (p === '/runtime.js') return serveFile(res, path.join(PUBLIC, 'runtime.js'), 'no-cache');
  if (/^\/[A-Za-z]+$/.test(p) && p !== '/Main') return serveFile(res, path.join(PUBLIC, p.slice(1) + '.html'), 'no-store');
  if (/^\/img\/[a-z0-9-]+\.(jpg|png|svg)$/.test(p)) return serveFile(res, path.join(PUBLIC, p), 'public, max-age=86400');
  return send(res, 404, 'Nie ma takiej strony.');
}

function serveFile(res, file, cache) {
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Nie ma takiej strony.');
    send(res, 200, data, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache });
  });
}

store.init().then(async () => {
  SECRET = await store.getSecret();
  if (!fs.existsSync(path.join(PUBLIC, 'Main.html'))) console.warn('[szafarz] Brak public/ – uruchom najpierw: npm run build');
  const n = await store.countUsers();
  http.createServer((req, res) => {
    handle(req, res).catch((e) => { console.error(e); if (!res.headersSent) send(res, 500, 'Błąd serwera'); });
  }).listen(PORT, () => {
    console.log(`[szafarz] działa na porcie ${PORT}; dane: ${store.kind}; konta: ${n}`);
    if (!n) console.log('[szafarz] Brak kont – otwórz aplikację w przeglądarce i załóż konto administratora.');
  });
}).catch((e) => { console.error('[szafarz] Nie można połączyć się z bazą: ' + e.message); process.exit(1); });
