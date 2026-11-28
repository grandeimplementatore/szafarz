'use strict';
// Szafarz 3.0 – serwer aplikacji (Node.js + PostgreSQL). Aplikacja jest publiczna.
// Baza: harmonogram, szafarze, osiedla, chorzy, wizyty, log zmian harmonogramu i atrybuty aplikacji. Słowo na dziś – z API Archidiecezji.
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./lib/db');
const slowo = require('./lib/slowo');
const ust = require('./lib/ustawienia');
const wejscie = require('./lib/wejscie');

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
// prosty limit zdarzeń z jednego adresu (60 na minutę)
const zdarzenia = new Map();
function zaCzesto(ip) { const t = Date.now(), a = (zdarzenia.get(ip) || []).filter((x) => t - x < 60e3); a.push(t); zdarzenia.set(ip, a); return a.length > 60; }
function clientIp(req) { return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress; }


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

  // ---- Ustawienia: wejście na hasło (zmienna SETTING_ENTRY) ----
  const STRONY_UST = { '/Ustawienia': false, '/UstawieniaTelefon': true };
  if (p === '/ustawienia/wejscie' && req.method === 'POST') {
    if (!sameOrigin(req)) return send(res, 403, 'Niedozwolone');
    const f = new URLSearchParams(await readBody(req));
    const dalej = f.get('dalej') in STRONY_UST ? f.get('dalej') : '/Ustawienia';
    const ip = clientIp(req);
    const html = (msg, st) => send(res, st, wejscie.stronaHasla(msg, dalej, STRONY_UST[dalej]), { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' });
    if (!wejscie.wlaczone()) return html('Ustawienia są niedostępne – nie ustawiono hasła (zmienna SETTING_ENTRY).', 503);
    if (wejscie.zaDuzoProb(ip)) return html('Zbyt wiele błędnych prób. Spróbuj ponownie za 15 minut.', 429);
    if (!wejscie.sprawdzHaslo(f.get('haslo'))) { wejscie.blednaProba(ip); return html('Nieprawidłowe hasło.', 401); }
    wejscie.udanaProba(ip);
    return send(res, 303, '', { Location: dalej, 'Set-Cookie': wejscie.ciasteczko(wejscie.token(), wejscie.GODZIN * 3600, PROD), 'Cache-Control': 'no-store' });
  }
  if (p === '/ustawienia/wyjscie') {
    return send(res, 303, '', { Location: '/', 'Set-Cookie': wejscie.ciasteczko('', 0, PROD), 'Cache-Control': 'no-store' });
  }
  if (p in STRONY_UST && !wejscie.zalogowany(req)) {
    const msg = wejscie.wlaczone() ? '' : 'Ustawienia są niedostępne – nie ustawiono hasła (zmienna SETTING_ENTRY).';
    return send(res, wejscie.wlaczone() ? 200 : 503, wejscie.stronaHasla(msg, p, STRONY_UST[p]), { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' });
  }

  if (p.startsWith('/api/ustawienia')) {
    if (req.headers['x-requested-with'] !== 'szafarz') return json(res, 403, { error: 'csrf' });
    if (!wejscie.zalogowany(req)) return json(res, 401, { error: 'Wejście do ustawień wygasło – podaj hasło ponownie.' });
    if (req.method !== 'GET' && !sameOrigin(req)) return json(res, 403, { error: 'origin' });
    const parts = p.split('/').slice(3).map(decodeURIComponent);           // ['szafarze', '12'] itd.
    try {
      if (req.method === 'GET' && !parts.length) return json(res, 200, await ust.lista(q));
      let body = {};
      if (req.method === 'POST' || req.method === 'PUT') { try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return json(res, 400, { error: 'Nieprawidłowe dane.' }); } }
      const route = req.method + ' ' + parts[0] + (parts.length > 1 ? '/:x' : '');
      const ip = clientIp(req);
      if (req.method === 'GET' && parts[0] === 'logi') {
        const u = new URL(req.url, 'http://x');
        return json(res, 200, await db.loadLogi(q, u.searchParams.get('przed'), u.searchParams.get('limit') || 100));
      }
      const ops = {
        'POST szafarze': () => ust.dodajSzafarza(pool, body, ip), 'DELETE szafarze/:x': () => ust.usunSzafarza(pool, parts[1], ip),
        'POST osiedla': () => ust.dodajOsiedle(pool, body, ip), 'DELETE osiedla/:x': () => ust.usunOsiedle(pool, parts[1], ip),
        'POST terminy': () => ust.dodajTermin(pool, body, ip), 'DELETE terminy/:x': () => ust.usunTermin(pool, parts[1], ip),
        'PUT szafarze/:x': () => ust.zmienSzafarza(pool, parts[1], body, ip), 'PUT osiedla/:x': () => ust.zmienOsiedle(pool, parts[1], body, ip),
        'PUT terminy/:x': () => ust.zmienTermin(pool, parts[1], body, ip),
        'PUT atrybuty/:x': () => ust.zmienAtrybut(pool, parts[1], body, ip)
      };
      if (!ops[route]) return json(res, 404, { error: 'Nie ma takiej operacji.' });
      return json(res, 200, { message: await ops[route]() });
    } catch (e) {
      if (e instanceof ust.Blad) return json(res, e.status, { error: e.message });
      throw e;
    }
  }

  // Zdarzenia bez zapisu danych, które też trafiają do logu: odkrycie i ukrycie nazwisk chorych.
  if (p === '/api/zdarzenie' && req.method === 'POST') {
    if (req.headers['x-requested-with'] !== 'szafarz' || !sameOrigin(req)) return json(res, 403, { error: 'csrf' });
    let b; try { b = JSON.parse(await readBody(req)); } catch (e) { return json(res, 400, { error: 'json' }); }
    const STRONY = { Chorzy: 'Nasi Chorzy', ChorzyTelefon: 'Nasi Chorzy (telefon)', Planner: 'Planner', PlannerTelefon: 'Planner (telefon)' };
    if (!b || !['odkryte', 'ukryte'].includes(b.nazwiska) || !STRONY[b.strona]) return json(res, 400, { error: 'format' });
    const ip = clientIp(req);
    if (zaCzesto(ip)) return json(res, 429, { error: 'limit' });
    const kier = b.nazwiska === 'odkryte' ? 'ukryte → widoczne' : 'widoczne → ukryte';
    if (b.chory != null) {   // jeden chory
      if (typeof b.chory !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(b.chory)) return json(res, 400, { error: 'format' });
      const c = (await q('SELECT imie, nazwisko, osiedle FROM sz_chorzy WHERE id = $1', [b.chory])).rows[0];
      if (!c) return json(res, 404, { error: 'brak' });
      await db.log({ query: q }, b.nazwiska === 'odkryte' ? 'Odkryto nazwisko chorego' : 'Ukryto nazwisko chorego',
        'strona: ' + STRONY[b.strona] + ', ' + c.imie + ' ' + c.nazwisko + ' (osiedle ' + c.osiedle + ') [id ' + b.chory + '], nazwisko: ' + kier, ip);
    } else {
      await db.log({ query: q }, b.nazwiska === 'odkryte' ? 'Odkryto nazwiska chorych' : 'Ukryto nazwiska chorych', 'strona: ' + STRONY[b.strona] + ', nazwiska: ' + kier, ip);
    }
    return json(res, 200, { ok: true });
  }

  if (p === '/api/state') {
    if (req.headers['x-requested-with'] !== 'szafarz') return json(res, 403, { error: 'csrf' });
    if (req.method === 'GET') {
      const [s, ref, atr] = await Promise.all([db.loadState(q), db.loadRef(q), db.loadAtrybuty(q)]);
      return json(res, 200, { version: s.version, db: s.db, ref, config: { revealCode: REVEAL_CODE, nazwiskaUkryte: atr.nazwiska_ukryte === 'true' } });
    }
    if (req.method === 'PUT') {
      if (!sameOrigin(req)) return json(res, 403, { error: 'origin' });
      let body;
      try { body = JSON.parse(await readBody(req)); } catch (e) { return json(res, 400, { error: 'json' }); }
      if (!body || typeof body.db !== 'object' || body.db === null || typeof body.version !== 'string') return json(res, 400, { error: 'format' });
      delete body.db.focus;
      const r = await db.saveState(pool, body.db, body.version, clientIp(req));
      return r.conflict ? json(res, 409, { error: 'conflict', version: r.version }) : json(res, 200, { version: r.version });
    }
    return json(res, 405, { error: 'method' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Metoda niedozwolona');
  if (p === '/') return serveFile(res, path.join(VIEWS, 'Main.html'), 'no-store');
  if (p === '/favicon.ico') return serveFile(res, path.join(STATIC, 'img', 'icon-192.png'), 'public, max-age=86400');
  if (p === '/manifest.webmanifest') return serveFile(res, path.join(STATIC, 'manifest.webmanifest'), 'public, max-age=86400');
  if (p === '/ustawienia.js') return serveFile(res, path.join(STATIC, 'ustawienia.js'), 'no-cache');
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
