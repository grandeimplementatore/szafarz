'use strict';
// Dostęp do bazy PostgreSQL: migracje, odczyt danych dla stron i zapis zmian.
const fs = require('fs');
const path = require('path');

const MIGRACJE = path.join(__dirname, '..', 'db', 'migracje');
const D = (col) => `to_char(${col}, 'YYYY-MM-DD')`;                       // data jako tekst RRRR-MM-DD
const TS = (col) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

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

// ---------- migracje (każdy plik z db/migracje wykonywany dokładnie raz) ----------
async function migrate(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS sz_migracje (nazwa text PRIMARY KEY, wykonano timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await pool.query('SELECT nazwa FROM sz_migracje')).rows.map((r) => r.nazwa));
  const files = fs.readdirSync(MIGRACJE).filter((f) => /\.(sql|js)$/.test(f)).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    await tx(pool, async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(4224242)');            // tylko jeden proces migruje naraz
      if ((await c.query('SELECT 1 FROM sz_migracje WHERE nazwa = $1', [f])).rowCount) return;
      if (f.endsWith('.sql')) await c.query(fs.readFileSync(path.join(MIGRACJE, f), 'utf8'));
      else await require(path.join(MIGRACJE, f))(c, { applyState });
      await c.query('INSERT INTO sz_migracje (nazwa) VALUES ($1)', [f]);
    });
    console.log('[szafarz] migracja wykonana: ' + f);
  }
}

// ---------- dane słownikowe i treści (tylko do odczytu w aplikacji) ----------
async function loadRef(q) {
  const osiedla = (await q(`SELECT kod FROM sz_osiedla ORDER BY kolejnosc`)).rows.map((r) => r.kod);
  const idx = {}; osiedla.forEach((o, i) => { idx[o] = i + 2; });
  const terminy = (await q(`SELECT ${D('data')} AS data, nazwa FROM sz_terminy ORDER BY data`)).rows;
  const przydz = (await q(`SELECT ${D('p.data')} AS data, p.osiedle, s.nazwisko FROM sz_przydzialy p JOIN sz_szafarze s ON s.id = p.szafarz_planowy_id`)).rows;
  const byDate = {}; przydz.forEach((r) => { (byDate[r.data] = byDate[r.data] || {})[r.osiedle] = r.nazwisko; });
  const harmonogram = terminy.map((t) => [t.data, t.nazwa].concat(osiedla.map((o) => (byDate[t.data] || {})[o] || '')));
  const szafarze = (await q(`SELECT nazwisko FROM sz_szafarze WHERE aktywny ORDER BY nazwisko COLLATE "C"`)).rows.map((r) => r.nazwisko)
    .sort((a, b) => a.localeCompare(b, 'pl'));
  const uwagi = (await q(`SELECT tytul, tresc FROM sz_uwagi_harmonogramu ORDER BY kolejnosc, id`)).rows
    .map((u) => ({ tytul: u.tytul || '', tresc: u.tresc, maTytul: !!u.tytul, bezTytulu: !u.tytul }));
  const slowo = {};
  (await q(`SELECT ${D('data')} AS data, cytat, sigla_cytatu, czytania FROM sz_slowo_na_dzis`)).rows.forEach((r) => {
    slowo[r.data] = [r.cytat || '', r.sigla_cytatu || '', (r.czytania || []).map((c) => [c.nazwa, c.sigla])];
  });
  const swieta = (await q(`SELECT miesiac AS m, dzien AS d, nazwa, kolor, ranga FROM sz_swieta_stale`)).rows;
  const obrzedy = (await q(`SELECT id, zakladka, skrot, tytul, wstep FROM sz_obrzedy ORDER BY kolejnosc`)).rows;
  const kroki = (await q(`SELECT obrzed_id, sekcja, tytul, bloki FROM sz_obrzedy_kroki ORDER BY obrzed_id, nr`)).rows;
  const ust = {};
  (await q(`SELECT klucz, wartosc FROM sz_ustawienia`)).rows.forEach((r) => { ust[r.klucz] = r.wartosc; });

  const GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
  const dlugo = (iso) => { const [y, m, d] = iso.split('-').map(Number); return d + ' ' + GEN[m - 1] + ' ' + y; };
  const krotko = (iso) => { const [y, m, d] = iso.split('-').map(Number); return d + '.' + String(m).padStart(2, '0') + '.' + y; };
  const od = terminy.length ? terminy[0].data : null, doo = terminy.length ? terminy[terminy.length - 1].data : null;
  const opis = String(ust.wspolnota_opis || '').split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean).map((t) => ({ tekst: t }));

  return {
    osiedla, osiedlaIdx: idx, harmonogram, szafarze, uwagi, slowo, swieta,
    uwagiKrotko: uwagi.filter((u) => u.maTytul).map((u) => u.tytul + ' – ' + u.tresc.replace(/\.$/, '')).join(' · '),
    zakres: od ? { od: dlugo(od), do: dlugo(doo), krotko: krotko(od) + ' – ' + krotko(doo) } : { od: '', do: '', krotko: '' },
    obrzedy: obrzedy.map((o) => ({ id: o.id, tab: o.zakladka, short: o.skrot, title: o.tytul, intro: o.wstep,
      steps: kroki.filter((k) => k.obrzed_id === o.id).map((k) => ({ sec: k.sekcja, title: k.tytul, b: k.bloki })) })),
    ust, wspolnota: { wstep: ust.wspolnota_wstep || '', akapity: opis }
  };
}

// ---------- dane wspólnoty (chorzy, plan wizyt, zamiany szafarzy) ----------
async function loadState(q) {
  const wersja = (await q('SELECT wersja FROM sz_wersja WHERE id = 1')).rows[0].wersja;
  const chorzy = (await q(`SELECT id, imie, nazwisko, ulica, nr_domu, nr_mieszkania, pietro, uwagi, osiedle FROM sz_chorzy ORDER BY nazwisko, imie`)).rows;
  const plan = {};
  (await q(`SELECT ${D('data')} AS data, osiedle, chory_id FROM sz_wizyty ORDER BY zaplanowano`)).rows.forEach((r) => {
    plan[r.data] = plan[r.data] || {};
    (plan[r.data][r.osiedle] = plan[r.data][r.osiedle] || []).push(r.chory_id);
  });
  const overrides = {};
  (await q(`SELECT ${D('p.data')} AS data, p.osiedle, s.nazwisko FROM sz_przydzialy p JOIN sz_szafarze s ON s.id = p.szafarz_id
            WHERE p.szafarz_id IS DISTINCT FROM p.szafarz_planowy_id`)).rows.forEach((r) => {
    (overrides[r.data] = overrides[r.data] || {})[r.osiedle] = r.nazwisko;
  });
  const changelog = (await q(`SELECT ${TS('czas')} AS ts, ${D('data')} AS iso, osiedle AS os, z_szafarza AS "from", na_szafarza AS "to"
                              FROM sz_zmiany_szafarzy ORDER BY czas DESC`)).rows;
  return {
    version: wersja,
    db: {
      sickOs: {}, edits: {}, removed: [],
      added: chorzy.map((c) => ({ id: c.id, fn: c.imie, ln: c.nazwisko, street: c.ulica, no: c.nr_domu, flat: c.nr_mieszkania || '',
        floor: c.pietro || '', note: c.uwagi || '', os: c.osiedle })),
      plan, overrides, changelog
    }
  };
}

const str = (v) => (v == null ? '' : String(v)).trim();

// Zapisuje stan przysłany przez stronę: porównuje z bazą i wykonuje tylko potrzebne zmiany, każdą odnotowując w dzienniku.
async function applyState(c, doc, ip) {
  const q = (sql, p) => c.query(sql, p);
  const log = (akcja, szczegoly) => q('INSERT INTO sz_dziennik (akcja, szczegoly, adres_ip) VALUES ($1, $2, $3)', [akcja, JSON.stringify(szczegoly), ip || null]);
  const osiedla = new Set((await q('SELECT kod FROM sz_osiedla')).rows.map((r) => r.kod));
  const terminy = new Set((await q(`SELECT ${D('data')} AS d FROM sz_terminy`)).rows.map((r) => r.d));
  const edits = doc.edits || {}, sickOs = doc.sickOs || {}, removed = new Set(doc.removed || []);
  let n = 0;

  // chorzy
  const cur = {};
  (await q('SELECT id, imie, nazwisko, ulica, nr_domu, nr_mieszkania, pietro, uwagi, osiedle FROM sz_chorzy')).rows.forEach((r) => { cur[r.id] = r; });
  for (const p of doc.added || []) {
    if (!p || typeof p.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(p.id)) continue;
    if (removed.has(p.id)) continue;
    const e = Object.assign({}, p, edits[p.id] || {});
    const v = { imie: str(e.fn), nazwisko: str(e.ln), ulica: str(e.street), nr_domu: str(e.no), nr_mieszkania: str(e.flat),
      pietro: str(e.floor), uwagi: str(e.note), osiedle: str(sickOs[p.id] || e.os) };
    if (!v.imie || !v.nazwisko || !v.ulica || !v.nr_domu || !osiedla.has(v.osiedle)) continue;
    const old = cur[p.id];
    if (!old) {
      await q(`INSERT INTO sz_chorzy (id, imie, nazwisko, ulica, nr_domu, nr_mieszkania, pietro, uwagi, osiedle) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [p.id, v.imie, v.nazwisko, v.ulica, v.nr_domu, v.nr_mieszkania, v.pietro, v.uwagi, v.osiedle]);
      await log('dodano chorego', { id: p.id, osiedle: v.osiedle }); n++;
      cur[p.id] = Object.assign({ id: p.id }, v);
    } else {
      const changed = Object.keys(v).filter((k) => str(old[k]) !== v[k]);
      if (changed.length) {
        await q(`UPDATE sz_chorzy SET imie=$2, nazwisko=$3, ulica=$4, nr_domu=$5, nr_mieszkania=$6, pietro=$7, uwagi=$8, osiedle=$9, zmieniono=now() WHERE id=$1`,
          [p.id, v.imie, v.nazwisko, v.ulica, v.nr_domu, v.nr_mieszkania, v.pietro, v.uwagi, v.osiedle]);
        await log('zmieniono dane chorego', { id: p.id, pola: changed }); n++;
      }
    }
  }
  for (const id of removed) {
    if (cur[id]) { await q('DELETE FROM sz_chorzy WHERE id = $1', [id]); delete cur[id]; await log('usunięto chorego', { id }); n++; }
  }

  // plan wizyt
  const plan = doc.plan || {};
  for (const iso of Object.keys(plan)) {
    if (!terminy.has(iso)) continue;
    const want = new Map();
    for (const o of Object.keys(plan[iso] || {})) {
      if (!osiedla.has(o)) continue;
      for (const id of plan[iso][o] || []) if (cur[id] && !want.has(id)) want.set(id, o);
    }
    const have = new Map((await q(`SELECT chory_id, osiedle FROM sz_wizyty WHERE data = $1`, [iso])).rows.map((r) => [r.chory_id, r.osiedle]));
    for (const [id, o] of have) {
      if (!want.has(id)) { await q('DELETE FROM sz_wizyty WHERE data = $1 AND chory_id = $2', [iso, id]); await log('usunięto wizytę z planu', { data: iso, chory: id, osiedle: o }); n++; }
    }
    for (const [id, o] of want) {
      if (!have.has(id)) { await q('INSERT INTO sz_wizyty (data, chory_id, osiedle) VALUES ($1, $2, $3)', [iso, id, o]); await log('zaplanowano wizytę', { data: iso, chory: id, osiedle: o }); n++; }
      else if (have.get(id) !== o) { await q('UPDATE sz_wizyty SET osiedle = $3 WHERE data = $1 AND chory_id = $2', [iso, id, o]); await log('przeniesiono wizytę', { data: iso, chory: id, osiedle: o }); n++; }
    }
  }

  // zamiany szafarzy
  const ids = {};
  (await q('SELECT id, nazwisko FROM sz_szafarze')).rows.forEach((r) => { ids[r.nazwisko] = r.id; });
  const ov = doc.overrides || {};
  const przydz = (await q(`SELECT ${D('data')} AS data, osiedle, szafarz_planowy_id AS plan, szafarz_id AS akt FROM sz_przydzialy`)).rows;
  for (const p of przydz) {
    const name = ov[p.data] && ov[p.data][p.osiedle];
    const target = name && ids[name] ? ids[name] : p.plan;
    if (target !== p.akt) {
      await q('UPDATE sz_przydzialy SET szafarz_id = $3 WHERE data = $1 AND osiedle = $2', [p.data, p.osiedle, target]);
      await log('zmieniono szafarza', { data: p.data, osiedle: p.osiedle, szafarz: Object.keys(ids).find((k) => ids[k] === target) }); n++;
    }
  }
  for (const e of doc.changelog || []) {
    if (!e || !e.ts || !terminy.has(e.iso) || !osiedla.has(e.os) || isNaN(Date.parse(e.ts))) continue;
    const r = await q(`INSERT INTO sz_zmiany_szafarzy (czas, data, osiedle, z_szafarza, na_szafarza) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [e.ts, e.iso, e.os, str(e.from), str(e.to)]);
    n += r.rowCount;
  }
  return n;
}

async function saveState(pool, doc, expected, ip) {
  return tx(pool, async (c) => {
    const v = (await c.query('SELECT wersja FROM sz_wersja WHERE id = 1 FOR UPDATE')).rows[0].wersja;
    if (v !== expected) return { conflict: true, version: v };
    const n = await applyState(c, doc, ip);
    if (!n) return { version: v };
    const nv = (await c.query('UPDATE sz_wersja SET wersja = wersja + 1 WHERE id = 1 RETURNING wersja')).rows[0].wersja;
    return { version: nv };
  });
}

module.exports = { createPool, migrate, loadRef, loadState, saveState, applyState };
