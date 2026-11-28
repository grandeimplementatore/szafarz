#!/usr/bin/env node
'use strict';
// Operacje na bazie wykonywane przy każdym wdrożeniu (Heroku: faza „release” z Procfile), przed uruchomieniem nowej wersji:
//  1. tworzy brakujące tabele (db/schema.sql),
//  2. przenosi chorych, wizyty i zmiany z najstarszej wersji aplikacji (tabela szafarz_store), jeśli jeszcze tego nie zrobiono,
//  3. w pustej bazie wczytuje dane startowe: osiedla, szafarzy i harmonogram (db/dane-startowe.sql),
//  4. usuwa tabele, których aplikacja już nie używa.
// Wszystko w jednej transakcji – przy błędzie baza zostaje bez zmian, a Heroku nie uruchamia nowej wersji.
const fs = require('fs');
const path = require('path');
const { createPool, tx, applyState, LOCK } = require('../lib/db');

const NIEPOTRZEBNE = [
  // poprzednia wersja (wszystko w bazie)
  'sz_dziennik', 'sz_migracje', 'sz_obrzedy_kroki', 'sz_obrzedy', 'sz_slowo_na_dzis', 'sz_swieta_stale',
  'sz_ustawienia', 'sz_uwagi_harmonogramu', 'sz_wersja',
  // pierwsza wersja (jeden dokument JSON, konta)
  'szafarz_audit', 'szafarz_config', 'szafarz_users', 'szafarz_store'
];

async function main() {
  const pool = createPool();
  await tx(pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock($1)', [LOCK]);
    await c.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

    const count = async (t) => Number((await c.query(`SELECT count(*) AS n FROM ${t}`)).rows[0].n);
    if (!(await count('sz_terminy'))) {
      await c.query(fs.readFileSync(path.join(__dirname, 'dane-startowe.sql'), 'utf8'));
      console.log('[db] wczytano dane startowe (osiedla, szafarze, harmonogram)');
    }

    const stary = (await c.query(`SELECT to_regclass('public.szafarz_store') AS t`)).rows[0].t;
    if (stary && !(await count('sz_chorzy'))) {
      const r = await c.query('SELECT data FROM szafarz_store WHERE id = 1');
      if (r.rowCount && r.rows[0].data) console.log('[db] przeniesiono dane z pierwszej wersji (zmian: ' + (await applyState(c, r.rows[0].data)) + ')');
    }

    for (const t of NIEPOTRZEBNE) {
      const ok = (await c.query(`SELECT to_regclass($1) AS t`, ['public.' + t])).rows[0].t;
      if (ok) { await c.query(`DROP TABLE ${t} CASCADE`); console.log('[db] usunięto tabelę ' + t); }
    }
  });
  const left = (await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'sz%' ORDER BY 1`)).rows.map((r) => r.tablename);
  console.log('[db] gotowe. Tabele aplikacji: ' + left.join(', '));
  await pool.end();
}

main().catch((e) => { console.error('[db] BŁĄD: ' + e.message); process.exit(1); });
