'use strict';
// Hasło do Ustawień: wartość zmiennej środowiskowej SETTING_ENTRY (Heroku → Settings → Config Vars).
// Po podaniu hasła przeglądarka dostaje podpisane ciasteczko ważne kilka godzin. Podpis wynika z samego hasła,
// więc zmiana SETTING_ENTRY od razu unieważnia wszystkie wcześniejsze wejścia.
const crypto = require('crypto');

const COOKIE = 'sz_ustawienia';
const GODZIN = 8;
const haslo = () => process.env.SETTING_ENTRY || '';
const klucz = () => crypto.createHash('sha256').update('szafarz-ustawienia|' + haslo()).digest();
const podpis = (s) => crypto.createHmac('sha256', klucz()).update(s).digest('base64url');
const rowne = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

function wlaczone() { return haslo().length > 0; }

function sprawdzHaslo(podane) {
  if (!wlaczone()) return false;
  const a = crypto.createHash('sha256').update(String(podane || '')).digest();
  const b = crypto.createHash('sha256').update(haslo()).digest();
  return crypto.timingSafeEqual(a, b);
}

function token() {
  const exp = String(Date.now() + GODZIN * 3600e3);
  return exp + '.' + podpis(exp);
}

function zalogowany(req) {
  if (!wlaczone()) return false;
  const m = /(?:^|;\s*)sz_ustawienia=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return false;
  const [exp, sig] = decodeURIComponent(m[1]).split('.');
  return !!exp && !!sig && Number(exp) > Date.now() && rowne(sig, podpis(exp));
}

function ciasteczko(wartosc, sekund, bezpieczne) {
  return `${COOKIE}=${wartosc}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sekund}${bezpieczne ? '; Secure' : ''}`;
}

// --- ograniczenie prób (10 błędnych w 15 minut z jednego adresu) ---
const proby = new Map();
function zaDuzoProb(ip) { const a = proby.get(ip); return !!a && a.n >= 10 && Date.now() - a.t < 15 * 60e3; }
function blednaProba(ip) { const a = proby.get(ip); if (!a || Date.now() - a.t > 15 * 60e3) proby.set(ip, { n: 1, t: Date.now() }); else a.n++; }
function udanaProba(ip) { proby.delete(ip); }

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function stronaHasla(komunikat, dalej, telefon) {
  const wroc = telefon ? '/Telefon' : '/';
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Ustawienia – hasło – Szafarz 3.0</title><link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Fondamento&family=Lato:wght@400;700;900&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;font-family:Lato,system-ui,sans-serif;color:#333;background:#2B3643 url(/img/kosciol.jpg) center/cover no-repeat;display:flex;align-items:center;justify-content:center;padding:20px}
body:before{content:"";position:fixed;inset:0;background:rgba(20,24,30,.6)}
main{position:relative;width:100%;max-width:400px;background:#fff;box-shadow:0 20px 50px rgba(0,0,0,.35)}
header{background:#BD4F38;color:#fff;padding:20px 24px}h1{margin:0;font:400 28px/1.15 Fondamento,Georgia,serif}header p{margin:6px 0 0;font-size:13px;opacity:.92}
form{padding:22px 24px 26px;display:flex;flex-direction:column;gap:14px}label{display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:700}
input{min-height:46px;padding:0 12px;border:1px solid #BDBDBD;border-radius:4px;font:16px Lato,system-ui,sans-serif}input:focus{outline:3px solid #F2B8A9;border-color:#BD4F38}
button{min-height:48px;border:0;background:#BD4F38;color:#fff;font:900 15px Lato,system-ui,sans-serif;cursor:pointer}button:hover{background:#A9442F}
.err{margin:0;padding:10px 12px;background:#FFF6F3;border:1px solid #F1D6CE;color:#8C3524;font-size:14px;font-weight:700}
a{color:#BD4F38;font-size:14px;font-weight:700;text-align:center}
</style></head><body><main>
<header><h1>Ustawienia</h1><p>Wspólnota Szafarzy Nadzwyczajnych Komunii&nbsp;Świętej</p></header>
<form method="post" action="/ustawienia/wejscie">
${komunikat ? `<p class="err" role="alert">${esc(komunikat)}</p>` : ''}
<input type="hidden" name="dalej" value="${esc(dalej)}">
${wlaczone() ? `<label>Hasło do ustawień<input type="password" name="haslo" autocomplete="current-password" required autofocus></label>
<button type="submit">Wejdź</button>` : ''}
<a href="${wroc}">‹ Wróć do strony głównej</a>
</form></main></body></html>`;
}

module.exports = { wlaczone, sprawdzHaslo, token, zalogowany, ciasteczko, zaDuzoProb, blednaProba, udanaProba, stronaHasla, GODZIN };
