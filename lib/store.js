'use strict';
// Wspólne dane aplikacji: jeden dokument JSON z numerem wersji w bazie PostgreSQL
// (tabela szafarz_store) + dziennik zapisów (tabela szafarz_audit). Tabele tworzą się same.

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
  async init() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS szafarz_store (
      id integer PRIMARY KEY, version integer NOT NULL, data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(), updated_by text)`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS szafarz_audit (
      id serial PRIMARY KEY, ts timestamptz NOT NULL DEFAULT now(), username text, version integer)`);
    await this.pool.query(
      `INSERT INTO szafarz_store (id, version, data, updated_by) VALUES (1, 1, $1, 'system') ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify(emptyDb(this.seedDemo))]);
  }
  async load() {
    const r = await this.pool.query('SELECT version, data FROM szafarz_store WHERE id = 1');
    return { version: r.rows[0].version, db: r.rows[0].data };
  }
  async save(db, expected, user) {
    const r = await this.pool.query(
      `UPDATE szafarz_store SET data = $1, version = version + 1, updated_at = now(), updated_by = $2
       WHERE id = 1 AND version = $3 RETURNING version`,
      [JSON.stringify(db), user, expected]);
    if (!r.rowCount) {
      const cur = await this.load();
      return { conflict: true, version: cur.version };
    }
    await this.pool.query('INSERT INTO szafarz_audit (username, version) VALUES ($1, $2)', [user, r.rows[0].version]);
    return { version: r.rows[0].version };
  }
}

function createStore() {
  if (!process.env.DATABASE_URL) {
    throw new Error('Brak DATABASE_URL – podaj adres bazy PostgreSQL (na Heroku ustawia go dodatek Heroku Postgres).');
  }
  return new PgStore(process.env.DATABASE_URL, process.env.SEED_DEMO === '1');
}

module.exports = { createStore };
