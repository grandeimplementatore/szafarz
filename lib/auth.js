'use strict';
// Konta szafarzy, hasła (scrypt) i podpisane ciasteczko sesji.
const crypto = require('crypto');

const SESSION_DAYS = Number(process.env.SESSION_DAYS || 14);

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1 });
  return 'scrypt$' + salt.toString('base64') + '$' + hash.toString('base64');
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'base64');
  const expected = Buffer.from(parts[2], 'base64');
  const got = crypto.scryptSync(String(password), salt, expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(got, expected);
}

// USERS = {"pelka": {"name": "Paweł Pełka", "hash": "scrypt$..."}, ...}
function loadUsers() {
  const raw = process.env.USERS;
  if (!raw) {
    if (process.env.NODE_ENV === 'production') return {};
    console.warn('[auth] Brak zmiennej USERS – konto testowe: login "test", hasło "test" (tylko poza produkcją).');
    return { test: { name: 'Szafarz testowy', hash: hashPassword('test') } };
  }
  let parsed;
  try { parsed = JSON.parse(raw.replace(/^\uFEFF/, '').trim()); } catch (e) {
    throw new Error('Zmienna USERS nie jest poprawnym JSON-em. Wklej do niej cały wynik polecenia: node scripts/make-users.js users.local.json (zaczyna się od {"login":{"name":...).');
  }
  const users = {};
  Object.keys(parsed).forEach((login) => {
    const v = parsed[login];
    users[login.toLowerCase()] = typeof v === 'string' ? { name: login, hash: v } : { name: v.name || login, hash: v.hash };
  });
  return users;
}

function secret() {
  const s = process.env.SESSION_SECRET;
  if (s && s.trim().length >= 32) return s.trim();
  if (s) throw new Error('SESSION_SECRET jest za krótki (' + s.trim().length + ' znaków) – potrzeba co najmniej 32.');
  if (process.env.NODE_ENV === 'production') throw new Error('Ustaw SESSION_SECRET (co najmniej 32 znaki).');
  return 'tylko-do-testow-lokalnych-tylko-do-testow-lokalnych';
}

function sign(data) { return crypto.createHmac('sha256', secret()).update(data).digest('base64url'); }

function makeToken(login) {
  const body = Buffer.from(JSON.stringify({ u: login, exp: Date.now() + SESSION_DAYS * 864e5 })).toString('base64url');
  return body + '.' + sign(body);
}

function readToken(token, users) {
  if (!token || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  const good = sign(body);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try {
    const d = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!d.exp || d.exp < Date.now() || !users[d.u]) return null;
    return { login: d.u, name: users[d.u].name };
  } catch (e) { return null; }
}

module.exports = { hashPassword, verifyPassword, loadUsers, makeToken, readToken, secret, SESSION_DAYS };
