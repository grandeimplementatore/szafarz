'use strict';
// Hasła (scrypt) i podpisane ciasteczko sesji. Klucz podpisu jest w bazie (szafarz_config).
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
  const expected = Buffer.from(parts[2], 'base64');
  const got = crypto.scryptSync(String(password), Buffer.from(parts[1], 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(got, expected);
}

// Odcisk hasła w sesji: zmiana hasła unieważnia stare logowania.
const pwTag = (hash) => crypto.createHash('sha256').update(hash).digest('base64url').slice(0, 10);
const sign = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

function makeToken(secret, user) {
  const body = Buffer.from(JSON.stringify({ u: user.login, p: pwTag(user.hash), exp: Date.now() + SESSION_DAYS * 864e5 })).toString('base64url');
  return body + '.' + sign(secret, body);
}

// Zwraca login z ważnej sesji albo null. Konto i odcisk hasła sprawdza serwer.
function readToken(secret, token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  const good = sign(secret, body);
  if (!sig || sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try {
    const d = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return d.exp && d.exp > Date.now() ? { login: d.u, tag: d.p } : null;
  } catch (e) { return null; }
}

module.exports = { hashPassword, verifyPassword, makeToken, readToken, pwTag, SESSION_DAYS };
