'use strict';
// Wszystko w bazie PostgreSQL – tabele tworzą się same przy starcie:
//  • szafarz_store  – wspólne dane (jeden dokument JSON z numerem wersji),
//  • szafarz_audit  – kto i kiedy zapisał zmiany,
//  • szafarz_users  – konta szafarzy (hasła jako skróty scrypt),
//  • szafarz_config – ustawienia wewnętrzne (np. klucz podpisujący sesje – generowany automatycznie).
const crypto = require('crypto');

function emptyDb(seedDemo) {
  return {
    sickOs: {}, edits: {}, removed: [],
    added: seedDemo ? require('./demo-patients.json') : [],
    plan: {}, overrides: {}, changelog: []
  };
}

class PgStore {
  constructor(url, seedDemo) {
    const { Pool } = require('pg');
    const ssl = process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false };
    this.pool = new Pool({ connectionString: url, ssl, max: 4 });
    this.seedDemo = seedDemo;
    this.kind = 'PostgreSQL';
  }
  q(sql, params) { return this.pool.query(sql, params); }

  async init() {
    await this.q(`CREATE TABLE IF NOT EXISTS szafarz_store (
      id integer PRIMARY KEY, version integer NOT NULL, data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(), updated_by text)`);
    await this.q(`CREATE TABLE IF NOT EXISTS szafarz_audit (
      id serial PRIMARY KEY, ts timestamptz NOT NULL DEFAULT now(), username text, version integer)`);
    await this.q(`CREATE TABLE IF NOT EXISTS szafarz_users (
      login text PRIMARY KEY, name text NOT NULL, hash text NOT NULL,
      is_admin boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now())`);
    await this.q(`CREATE TABLE IF NOT EXISTS szafarz_config (key text PRIMARY KEY, value text NOT NULL)`);
    await this.q(`INSERT INTO szafarz_store (id, version, data, updated_by) VALUES (1, 1, $1, 'system') ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify(emptyDb(this.seedDemo))]);
    await this.q(`INSERT INTO szafarz_config (key, value) VALUES ('session_secret', $1) ON CONFLICT (key) DO NOTHING`,
      [crypto.randomBytes(48).toString('base64url')]);
  }

  // --- dane wspólnoty ---
  async load() {
    const r = await this.q('SELECT version, data FROM szafarz_store WHERE id = 1');
    return { version: r.rows[0].version, db: r.rows[0].data };
  }
  async save(db, expected, user) {
    const r = await this.q(
      `UPDATE szafarz_store SET data = $1, version = version + 1, updated_at = now(), updated_by = $2
       WHERE id = 1 AND version = $3 RETURNING version`, [JSON.stringify(db), user, expected]);
    if (!r.rowCount) return { conflict: true, version: (await this.load()).version };
    await this.q('INSERT INTO szafarz_audit (username, version) VALUES ($1, $2)', [user, r.rows[0].version]);
    return { version: r.rows[0].version };
  }

  // --- ustawienia i konta ---
  async getSecret() {
    return (await this.q(`SELECT value FROM szafarz_config WHERE key = 'session_secret'`)).rows[0].value;
  }
  async countUsers() { return Number((await this.q('SELECT count(*) AS n FROM szafarz_users')).rows[0].n); }
  async getUser(login) {
    const r = await this.q('SELECT login, name, hash, is_admin FROM szafarz_users WHERE login = $1', [login]);
    return r.rows[0] ? { login: r.rows[0].login, name: r.rows[0].name, hash: r.rows[0].hash, isAdmin: r.rows[0].is_admin } : null;
  }
  async listUsers() {
    const r = await this.q('SELECT login, name, is_admin FROM szafarz_users ORDER BY name');
    return r.rows.map((x) => ({ login: x.login, name: x.name, isAdmin: x.is_admin }));
  }
  async addUser(u, onlyIfEmpty) {
    const sql = onlyIfEmpty
      ? `INSERT INTO szafarz_users (login, name, hash, is_admin) SELECT $1, $2, $3, $4 WHERE NOT EXISTS (SELECT 1 FROM szafarz_users)`
      : `INSERT INTO szafarz_users (login, name, hash, is_admin) VALUES ($1, $2, $3, $4) ON CONFLICT (login) DO NOTHING`;
    return (await this.q(sql, [u.login, u.name, u.hash, !!u.isAdmin])).rowCount === 1;
  }
  async deleteUser(login) { await this.q('DELETE FROM szafarz_users WHERE login = $1', [login]); }
  async setPassword(login, hash) { await this.q('UPDATE szafarz_users SET hash = $2 WHERE login = $1', [login, hash]); }
}

// Tylko do testów na własnym komputerze: DATABASE_URL=memory (dane znikają po zatrzymaniu).
class MemoryStore {
  constructor(seedDemo) { this.kind = 'pamięć (test)'; this.doc = { version: 1, db: emptyDb(seedDemo) }; this.users = new Map(); this.secret = crypto.randomBytes(48).toString('base64url'); }
  async init() {}
  async load() { return JSON.parse(JSON.stringify(this.doc)); }
  async save(db, expected) {
    if (this.doc.version !== expected) return { conflict: true, version: this.doc.version };
    this.doc = { version: expected + 1, db };
    return { version: this.doc.version };
  }
  async getSecret() { return this.secret; }
  async countUsers() { return this.users.size; }
  async getUser(login) { return this.users.get(login) || null; }
  async listUsers() { return [...this.users.values()].map((u) => ({ login: u.login, name: u.name, isAdmin: u.isAdmin })).sort((a, b) => a.name.localeCompare(b.name)); }
  async addUser(u, onlyIfEmpty) { if ((onlyIfEmpty && this.users.size) || this.users.has(u.login)) return false; this.users.set(u.login, Object.assign({}, u)); return true; }
  async deleteUser(login) { this.users.delete(login); }
  async setPassword(login, hash) { const u = this.users.get(login); if (u) u.hash = hash; }
}

function createStore() {
  const url = process.env.DATABASE_URL;
  const seedDemo = process.env.SEED_DEMO === '1';
  if (url === 'memory' && process.env.NODE_ENV !== 'production') return new MemoryStore(seedDemo);
  if (!url) throw new Error('Brak DATABASE_URL – podłącz bazę Heroku Postgres do aplikacji.');
  return new PgStore(url, seedDemo);
}

module.exports = { createStore };
