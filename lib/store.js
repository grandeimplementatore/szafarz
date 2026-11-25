'use strict';
// Dane w bazie PostgreSQL – tabele tworzą się same przy starcie:
//  • szafarz_store – wspólne dane (jeden dokument JSON z numerem wersji),
//  • szafarz_audit – kiedy zapisano zmiany.

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
    await this.q(`INSERT INTO szafarz_store (id, version, data, updated_by) VALUES (1, 1, $1, 'system') ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify(emptyDb(this.seedDemo))]);
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

}

// Tylko do testów na własnym komputerze: DATABASE_URL=memory (dane znikają po zatrzymaniu).
class MemoryStore {
  constructor(seedDemo) { this.kind = 'pamięć (test)'; this.doc = { version: 1, db: emptyDb(seedDemo) }; }
  async init() {}
  async load() { return JSON.parse(JSON.stringify(this.doc)); }
  async save(db, expected) {
    if (this.doc.version !== expected) return { conflict: true, version: this.doc.version };
    this.doc = { version: expected + 1, db };
    return { version: this.doc.version };
  }
}

function createStore() {
  const url = process.env.DATABASE_URL;
  const seedDemo = process.env.SEED_DEMO === '1';
  if (url === 'memory' && process.env.NODE_ENV !== 'production') return new MemoryStore(seedDemo);
  if (!url) throw new Error('Brak DATABASE_URL – podłącz bazę Heroku Postgres do aplikacji.');
  return new PgStore(url, seedDemo);
}

module.exports = { createStore };
