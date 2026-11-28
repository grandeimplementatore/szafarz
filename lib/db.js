'use strict';
// Dostęp do bazy PostgreSQL. W bazie są tylko: osiedla, szafarze, harmonogram (terminy, przydziały i ich zmiany),
// log zmian harmonogramu, chorzy, wizyty i atrybuty aplikacji. Pozostałe treści są w kodzie (static/tresci.js) albo z API (Słowo na dziś).
const crypto = require('crypto');

const D = (col) => `to_char(${col}, 'YYYY-MM-DD')`;
const TS = (col) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const LOCK = 4224242;

function createPool() {
  if (!process.env.DATABASE_URL) throw new Error('Brak DATABASE_URL – podłącz bazę Heroku Postgres do aplikacji.');
  const { Pool } = require('pg');
  const ssl = process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false };
  return new Pool({ connectionString: process.env.DATABASE_URL, ssl, max: 5 });
}

async function tx(pool, fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

// ---------- słowniki i harmonogram ----------
async function loadRef(q) {
  const osiedla = (await q(`SELECT kod FROM sz_osiedla ORDER BY kolejnosc`)).rows.map((r) => r.kod);
  const idx = {}; osiedla.forEach((o, i) => { idx[o] = i + 2; });
  const terminy = (await q(`SELECT ${D('data')} AS data, nazwa FROM sz_terminy ORDER BY data`)).rows;
  const byDate = {};
  (await q(`SELECT ${D('p.data')} AS data, p.osiedle, s.nazwisko FROM sz_przydzialy p LEFT JOIN sz_szafarze s ON s.id = p.szafarz_planowy_id`)).rows
    .forEach((r) => { (byDate[r.data] = byDate[r.data] || {})[r.osiedle] = r.nazwisko || ''; });
  const harmonogram = terminy.map((t) => [t.data, t.nazwa].concat(osiedla.map((o) => (byDate[t.data] || {})[o] || '')));
  const szafarze = (await q(`SELECT nazwisko FROM sz_szafarze WHERE aktywny`)).rows.map((r) => r.nazwisko).sort((a, b) => a.localeCompare(b, 'pl'));
  const GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
  const dlugo = (iso) => { const [y, m, d] = iso.split('-').map(Number); return d + ' ' + GEN[m - 1] + ' ' + y; };
  const krotko = (iso) => { const [y, m, d] = iso.split('-').map(Number); return d + '.' + String(m).padStart(2, '0') + '.' + y; };
  const od = terminy.length ? terminy[0].data : null, doo = terminy.length ? terminy[terminy.length - 1].data : null;
  return {
    osiedla, osiedlaIdx: idx, osiedlaN: Math.max(osiedla.length, 1), harmonogram, szafarze,
    zakres: od ? { od: dlugo(od), do: dlugo(doo), krotko: krotko(od) + ' – ' + krotko(doo) } : { od: '', do: '', krotko: '' }
  };
}

// ---------- chorzy, wizyty, zamiany szafarzy ----------
async function loadState(q) {
  const chorzy = (await q(`SELECT id, imie, nazwisko, ulica, nr_domu, nr_mieszkania, pietro, uwagi, osiedle FROM sz_chorzy ORDER BY nazwisko, imie, id`)).rows;
  const plan = {};
  (await q(`SELECT ${D('data')} AS data, osiedle, chory_id FROM sz_wizyty ORDER BY data, zaplanowano, chory_id`)).rows.forEach((r) => {
    plan[r.data] = plan[r.data] || {};
    (plan[r.data][r.osiedle] = plan[r.data][r.osiedle] || []).push(r.chory_id);
  });
  const overrides = {};
  (await q(`SELECT ${D('p.data')} AS data, p.osiedle, s.nazwisko FROM sz_przydzialy p JOIN sz_szafarze s ON s.id = p.szafarz_id
            WHERE p.szafarz_id IS DISTINCT FROM p.szafarz_planowy_id ORDER BY p.data, p.osiedle`)).rows.forEach((r) => {
    (overrides[r.data] = overrides[r.data] || {})[r.osiedle] = r.nazwisko;
  });
  const changelog = (await q(`SELECT ${TS('czas')} AS ts, ${D('data')} AS iso, osiedle AS os, z_szafarza AS "from", na_szafarza AS "to"
                              FROM sz_zmiany_szafarzy ORDER BY czas DESC, id DESC`)).rows;
  const db = {
    sickOs: {}, edits: {}, removed: [],
    added: chorzy.map((c) => ({ id: c.id, fn: c.imie, ln: c.nazwisko, street: c.ulica, no: c.nr_domu, flat: c.nr_mieszkania || '',
      floor: c.pietro || '', note: c.uwagi || '', os: c.osiedle })),
    plan, overrides, changelog
  };
  // Wersja = skrót aktualnego stanu; chroni przed nadpisaniem cudzych zmian przy równoczesnym zapisie.
  const version = crypto.createHash('sha256').update(JSON.stringify(db)).digest('hex').slice(0, 16);
  return { version, db };
}

const str = (v) => (v == null ? '' : String(v)).trim();

// Zapisuje stan przysłany przez stronę: porównuje z bazą i wykonuje tylko potrzebne zmiany.
async function applyState(c, doc) {
  const q = (sql, p) => c.query(sql, p);
  const osiedla = new Set((await q('SELECT kod FROM sz_osiedla')).rows.map((r) => r.kod));
  const terminy = new Set((await q(`SELECT ${D('data')} AS d FROM sz_terminy`)).rows.map((r) => r.d));
  const edits = doc.edits || {}, sickOs = doc.sickOs || {}, removed = new Set(doc.removed || []);
  let n = 0;

  // chorzy
  const cur = {};
  (await q('SELECT id, imie, nazwisko, ulica, nr_domu, nr_mieszkania, pietro, uwagi, osiedle FROM sz_chorzy')).rows.forEach((r) => { cur[r.id] = r; });
  for (const p of doc.added || []) {
    if (!p || typeof p.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(p.id) || removed.has(p.id)) continue;
    const e = Object.assign({}, p, edits[p.id] || {});
    const v = { imie: str(e.fn), nazwisko: str(e.ln), ulica: str(e.street), nr_domu: str(e.no), nr_mieszkania: str(e.flat),
      pietro: str(e.floor), uwagi: str(e.note), osiedle: str(sickOs[p.id] || e.os) };
    if (!v.imie || !v.nazwisko || !v.ulica || !v.nr_domu || !osiedla.has(v.osiedle)) continue;
    const old = cur[p.id];
    if (!old) {
      await q(`INSERT INTO sz_chorzy (id, imie, nazwisko, ulica, nr_domu, nr_mieszkania, pietro, uwagi, osiedle) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [p.id, v.imie, v.nazwisko, v.ulica, v.nr_domu, v.nr_mieszkania, v.pietro, v.uwagi, v.osiedle]);
      cur[p.id] = Object.assign({ id: p.id }, v); n++;
    } else if (Object.keys(v).some((k) => str(old[k]) !== v[k])) {
      await q(`UPDATE sz_chorzy SET imie=$2, nazwisko=$3, ulica=$4, nr_domu=$5, nr_mieszkania=$6, pietro=$7, uwagi=$8, osiedle=$9, zmieniono=now() WHERE id=$1`,
        [p.id, v.imie, v.nazwisko, v.ulica, v.nr_domu, v.nr_mieszkania, v.pietro, v.uwagi, v.osiedle]);
      n++;
    }
  }
  for (const id of removed) {
    if (cur[id]) { await q('DELETE FROM sz_chorzy WHERE id = $1', [id]); delete cur[id]; n++; }
  }

  // wizyty
  const plan = doc.plan || {};
  for (const iso of Object.keys(plan)) {
    if (!terminy.has(iso)) continue;
    const want = new Map();
    for (const o of Object.keys(plan[iso] || {})) {
      if (!osiedla.has(o)) continue;
      for (const id of plan[iso][o] || []) if (cur[id] && !want.has(id)) want.set(id, o);
    }
    const have = new Map((await q(`SELECT chory_id, osiedle FROM sz_wizyty WHERE data = $1`, [iso])).rows.map((r) => [r.chory_id, r.osiedle]));
    for (const id of have.keys()) {
      if (!want.has(id)) { await q('DELETE FROM sz_wizyty WHERE data = $1 AND chory_id = $2', [iso, id]); n++; }
    }
    for (const [id, o] of want) {
      if (!have.has(id)) { await q('INSERT INTO sz_wizyty (data, chory_id, osiedle) VALUES ($1, $2, $3)', [iso, id, o]); n++; }
      else if (have.get(id) !== o) { await q('UPDATE sz_wizyty SET osiedle = $3 WHERE data = $1 AND chory_id = $2', [iso, id, o]); n++; }
    }
  }

  // zamiany szafarzy w harmonogramie
  const ids = {};
  (await q('SELECT id, nazwisko FROM sz_szafarze')).rows.forEach((r) => { ids[r.nazwisko] = r.id; });
  const ov = doc.overrides || {};
  for (const p of (await q(`SELECT ${D('data')} AS data, osiedle, szafarz_planowy_id AS plan, szafarz_id AS akt FROM sz_przydzialy`)).rows) {
    const name = ov[p.data] && ov[p.data][p.osiedle];
    const target = name && ids[name] ? ids[name] : p.plan;
    if (target !== p.akt) { await q('UPDATE sz_przydzialy SET szafarz_id = $3 WHERE data = $1 AND osiedle = $2', [p.data, p.osiedle, target]); n++; }
  }

  // log zmian harmonogramu
  for (const e of doc.changelog || []) {
    if (!e || !e.ts || !terminy.has(e.iso) || !osiedla.has(e.os) || isNaN(Date.parse(e.ts))) continue;
    const r = await q(`INSERT INTO sz_zmiany_szafarzy (czas, data, osiedle, z_szafarza, na_szafarza) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [e.ts, e.iso, e.os, str(e.from), str(e.to)]);
    n += r.rowCount;
  }
  return n;
}

async function saveState(pool, doc, expected) {
  return tx(pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock($1)', [LOCK]);          // zapisy wykonują się po kolei
    const q = (sql, p) => c.query(sql, p);
    const now = await loadState(q);
    if (now.version !== expected) return { conflict: true, version: now.version };
    await applyState(c, doc);
    return { version: (await loadState(q)).version };
  });
}

// Atrybuty aplikacji (tabela sz_atrybuty) jako obiekt { klucz: wartość }.
async function loadAtrybuty(q) {
  const out = {};
  (await q('SELECT klucz, wartosc FROM sz_atrybuty')).rows.forEach((r) => { out[r.klucz] = r.wartosc; });
  return out;
}

module.exports = { createPool, tx, loadRef, loadState, saveState, applyState, loadAtrybuty, LOCK };
