'use strict';
// Ustawienia: dodawanie, zmiana i usuwanie szafarzy, osiedli i terminów harmonogramu.
const { tx, LOCK } = require('./db');

const D = (col) => `to_char(${col}, 'YYYY-MM-DD')`;
const dzis = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(new Date());
class Blad extends Error { constructor(msg, status) { super(msg); this.status = status || 400; } }
const str = (v) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
const terminach = (n) => n + ' ' + (n === 1 ? 'terminie' : 'terminach');

async function lista(q) {
  const today = dzis();
  const szafarze = (await q(`
    SELECT s.id, s.nazwisko, COALESCE(s.imie, '') AS imie,
      (SELECT count(*) FROM sz_przydzialy p WHERE COALESCE(p.szafarz_id, p.szafarz_planowy_id) = s.id AND p.data >= $1)::int AS przyszlych
    FROM sz_szafarze s WHERE s.aktywny`, [today])).rows.sort((a, b) => a.nazwisko.localeCompare(b.nazwisko, 'pl'));
  const osiedla = (await q(`
    SELECT o.kod, o.nazwa,
      (SELECT count(*) FROM sz_chorzy c WHERE c.osiedle = o.kod)::int AS chorych,
      (SELECT count(*) FROM sz_wizyty w WHERE w.osiedle = o.kod AND w.data >= $1)::int AS wizyt
    FROM sz_osiedla o ORDER BY o.kolejnosc, o.kod`, [today])).rows;
  const przydz = {};
  (await q(`SELECT ${D('p.data')} AS data, p.osiedle, s.nazwisko FROM sz_przydzialy p
            LEFT JOIN sz_szafarze s ON s.id = COALESCE(p.szafarz_id, p.szafarz_planowy_id)`)).rows
    .forEach((r) => { (przydz[r.data] = przydz[r.data] || {})[r.osiedle] = r.nazwisko || ''; });
  const terminy = (await q(`SELECT ${D('t.data')} AS data, t.nazwa, (SELECT count(*) FROM sz_wizyty w WHERE w.data = t.data)::int AS wizyt
                            FROM sz_terminy t ORDER BY t.data`)).rows
    .map((t) => Object.assign(t, { przydzialy: przydz[t.data] || {}, minal: t.data < today }));
  return { dzis: today, szafarze, osiedla, terminy };
}

async function dodajSzafarza(pool, body) {
  const nazwisko = str(body.nazwisko), imie = str(body.imie);
  if (nazwisko.length < 2 || nazwisko.length > 40) throw new Blad('Podaj nazwisko (2–40 znaków).');
  if (imie.length > 40) throw new Blad('Imię może mieć najwyżej 40 znaków.');
  return tx(pool, async (c) => {
    const ex = (await c.query('SELECT id, aktywny FROM sz_szafarze WHERE lower(nazwisko) = lower($1)', [nazwisko])).rows[0];
    if (ex && ex.aktywny) throw new Blad('Szafarz o nazwisku „' + nazwisko + '” już jest na liście.', 409);
    if (ex) await c.query('UPDATE sz_szafarze SET aktywny = true, nazwisko = $2, imie = NULLIF($3, \'\') WHERE id = $1', [ex.id, nazwisko, imie]);
    else await c.query('INSERT INTO sz_szafarze (nazwisko, imie) VALUES ($1, NULLIF($2, \'\'))', [nazwisko, imie]);
    return 'Dodano szafarza: ' + (imie ? imie + ' ' : '') + nazwisko + '.';
  });
}

async function usunSzafarza(pool, id) {
  return tx(pool, async (c) => {
    const s = (await c.query('SELECT id, nazwisko FROM sz_szafarze WHERE id = $1 AND aktywny', [Number(id) || 0])).rows[0];
    if (!s) throw new Blad('Nie ma takiego szafarza.', 404);
    const fut = Number((await c.query(`SELECT count(*) AS n FROM sz_przydzialy WHERE COALESCE(szafarz_id, szafarz_planowy_id) = $1 AND data >= $2`, [s.id, dzis()])).rows[0].n);
    if (fut) throw new Blad(s.nazwisko + ' ma przydział w ' + terminach(fut) + ' od dziś. Najpierw przypisz tam innego szafarza w Harmonogramie albo usuń te terminy.', 409);
    const used = Number((await c.query('SELECT count(*) AS n FROM sz_przydzialy WHERE szafarz_id = $1 OR szafarz_planowy_id = $1', [s.id])).rows[0].n);
    if (used) await c.query('UPDATE sz_szafarze SET aktywny = false WHERE id = $1', [s.id]);   // w minionych terminach zostaje nazwisko
    else await c.query('DELETE FROM sz_szafarze WHERE id = $1', [s.id]);
    return 'Usunięto szafarza: ' + s.nazwisko + '.';
  });
}

async function dodajOsiedle(pool, body) {
  const kod = str(body.kod).toUpperCase(), nazwa = str(body.nazwa) || 'Osiedle ' + str(body.kod).toUpperCase();
  if (!/^[A-ZĄĆĘŁŃÓŚŹŻ0-9]{1,4}$/.test(kod)) throw new Blad('Kod osiedla: 1–4 litery lub cyfry, np. W, T2, NO.');
  if (nazwa.length > 60) throw new Blad('Nazwa osiedla może mieć najwyżej 60 znaków.');
  return tx(pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock($1)', [LOCK]);
    if ((await c.query('SELECT 1 FROM sz_osiedla WHERE kod = $1', [kod])).rowCount) throw new Blad('Osiedle ' + kod + ' już jest na liście.', 409);
    await c.query('INSERT INTO sz_osiedla (kod, nazwa, kolejnosc) VALUES ($1, $2, (SELECT COALESCE(max(kolejnosc), 0) + 1 FROM sz_osiedla))', [kod, nazwa]);
    // w istniejących terminach nowe osiedle nie ma jeszcze szafarza – przypisuje się go w Harmonogramie
    await c.query('INSERT INTO sz_przydzialy (data, osiedle) SELECT data, $1 FROM sz_terminy', [kod]);
    return 'Dodano osiedle ' + kod + '. W Harmonogramie przypisz do niego szafarzy w kolejnych terminach.';
  });
}

async function usunOsiedle(pool, kod) {
  return tx(pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock($1)', [LOCK]);
    const o = (await c.query('SELECT kod FROM sz_osiedla WHERE kod = $1', [kod])).rows[0];
    if (!o) throw new Blad('Nie ma takiego osiedla.', 404);
    if (Number((await c.query('SELECT count(*) AS n FROM sz_osiedla')).rows[0].n) <= 1) throw new Blad('Musi zostać co najmniej jedno osiedle.', 409);
    const chorych = Number((await c.query('SELECT count(*) AS n FROM sz_chorzy WHERE osiedle = $1', [kod])).rows[0].n);
    if (chorych) throw new Blad('Na osiedlu ' + kod + ' jest ' + chorych + ' ' + (chorych === 1 ? 'chory' : 'chorych') + '. Najpierw przenieś ich na inne osiedle w „Nasi Chorzy”.', 409);
    await c.query('DELETE FROM sz_wizyty WHERE osiedle = $1', [kod]);
    await c.query('DELETE FROM sz_przydzialy WHERE osiedle = $1', [kod]);
    await c.query('DELETE FROM sz_osiedla WHERE kod = $1', [kod]);
    return 'Usunięto osiedle ' + kod + '.';
  });
}

async function dodajTermin(pool, body) {
  const data = str(body.data), nazwa = str(body.nazwa);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || isNaN(Date.parse(data + 'T00:00:00Z'))) throw new Blad('Podaj poprawną datę terminu.');
  if (!nazwa || nazwa.length > 80) throw new Blad('Podaj nazwę dnia (do 80 znaków), np. „II Niedziela Adwentu”.');
  const wybor = body.przydzialy || {};
  return tx(pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock($1)', [LOCK]);
    if ((await c.query('SELECT 1 FROM sz_terminy WHERE data = $1', [data])).rowCount) throw new Blad('Termin ' + data.split('-').reverse().join('.') + ' już jest w harmonogramie.', 409);
    const osiedla = (await c.query('SELECT kod FROM sz_osiedla ORDER BY kolejnosc')).rows.map((r) => r.kod);
    const ids = {};
    (await c.query('SELECT id, nazwisko FROM sz_szafarze WHERE aktywny')).rows.forEach((r) => { ids[r.nazwisko] = r.id; });
    const brak = osiedla.filter((o) => !ids[wybor[o]]);
    if (brak.length) throw new Blad('Wybierz szafarza dla osiedla: ' + brak.join(', ') + '.');
    await c.query('INSERT INTO sz_terminy (data, nazwa) VALUES ($1, $2)', [data, nazwa]);
    for (const o of osiedla) {
      await c.query('INSERT INTO sz_przydzialy (data, osiedle, szafarz_planowy_id, szafarz_id) VALUES ($1, $2, $3, $3)', [data, o, ids[wybor[o]]]);
    }
    return 'Dodano termin ' + data.split('-').reverse().join('.') + ' (' + nazwa + ').';
  });
}

async function usunTermin(pool, data) {
  return tx(pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock($1)', [LOCK]);
    const r = await c.query(`DELETE FROM sz_terminy WHERE data = $1 RETURNING nazwa`, [/^\d{4}-\d{2}-\d{2}$/.test(data) ? data : '1900-01-01']);
    if (!r.rowCount) throw new Blad('Nie ma takiego terminu.', 404);
    return 'Usunięto termin ' + data.split('-').reverse().join('.') + ' (' + r.rows[0].nazwa + ') razem z zaplanowanymi na ten dzień wizytami.';
  });
}

async function zmienSzafarza(pool, id, body) {
  const nazwisko = str(body.nazwisko), imie = str(body.imie);
  if (nazwisko.length < 2 || nazwisko.length > 40) throw new Blad('Podaj nazwisko (2–40 znaków).');
  if (imie.length > 40) throw new Blad('Imię może mieć najwyżej 40 znaków.');
  return tx(pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock($1)', [LOCK]);
    const s = (await c.query('SELECT id FROM sz_szafarze WHERE id = $1 AND aktywny', [Number(id) || 0])).rows[0];
    if (!s) throw new Blad('Nie ma takiego szafarza.', 404);
    if ((await c.query('SELECT 1 FROM sz_szafarze WHERE lower(nazwisko) = lower($1) AND id <> $2', [nazwisko, s.id])).rowCount) {
      throw new Blad('Szafarz o nazwisku „' + nazwisko + '” już istnieje.', 409);
    }
    await c.query('UPDATE sz_szafarze SET nazwisko = $2, imie = NULLIF($3, \'\') WHERE id = $1', [s.id, nazwisko, imie]);
    return 'Zapisano zmiany: ' + (imie ? imie + ' ' : '') + nazwisko + '.';
  });
}

async function zmienOsiedle(pool, kod, body) {
  const nowy = str(body.kod).toUpperCase(), nazwa = str(body.nazwa) || 'Osiedle ' + str(body.kod).toUpperCase();
  if (!/^[A-ZĄĆĘŁŃÓŚŹŻ0-9]{1,4}$/.test(nowy)) throw new Blad('Kod osiedla: 1–4 litery lub cyfry, np. W, T2, NO.');
  if (nazwa.length > 60) throw new Blad('Nazwa osiedla może mieć najwyżej 60 znaków.');
  return tx(pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock($1)', [LOCK]);
    const o = (await c.query('SELECT kod, kolejnosc FROM sz_osiedla WHERE kod = $1', [kod])).rows[0];
    if (!o) throw new Blad('Nie ma takiego osiedla.', 404);
    if (nowy === o.kod) {
      await c.query('UPDATE sz_osiedla SET nazwa = $2 WHERE kod = $1', [o.kod, nazwa]);
    } else {
      if ((await c.query('SELECT 1 FROM sz_osiedla WHERE kod = $1', [nowy])).rowCount) throw new Blad('Osiedle ' + nowy + ' już jest na liście.', 409);
      // zmiana kodu: nowy wpis, przeniesienie chorych, wizyt, przydziałów i historii, usunięcie starego
      await c.query('INSERT INTO sz_osiedla (kod, nazwa, kolejnosc) VALUES ($1, $2, $3)', [nowy, nazwa, o.kolejnosc]);
      for (const t of ['sz_chorzy', 'sz_wizyty', 'sz_przydzialy', 'sz_zmiany_szafarzy']) await c.query(`UPDATE ${t} SET osiedle = $2 WHERE osiedle = $1`, [o.kod, nowy]);
      await c.query('DELETE FROM sz_osiedla WHERE kod = $1', [o.kod]);
    }
    return 'Zapisano zmiany osiedla ' + nowy + '.';
  });
}

async function zmienTermin(pool, data, body) {
  const nowa = str(body.data), nazwa = str(body.nazwa);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nowa) || isNaN(Date.parse(nowa + 'T00:00:00Z'))) throw new Blad('Podaj poprawną datę terminu.');
  if (!nazwa || nazwa.length > 80) throw new Blad('Podaj nazwę dnia (do 80 znaków), np. „II Niedziela Adwentu”.');
  const wybor = body.przydzialy || {};
  return tx(pool, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock($1)', [LOCK]);
    if (!(await c.query('SELECT 1 FROM sz_terminy WHERE data = $1', [/^\d{4}-\d{2}-\d{2}$/.test(data) ? data : '1900-01-01'])).rowCount) throw new Blad('Nie ma takiego terminu.', 404);
    const osiedla = (await c.query('SELECT kod FROM sz_osiedla ORDER BY kolejnosc')).rows.map((r) => r.kod);
    const ids = {}, nazwy = {};
    (await c.query('SELECT id, nazwisko, aktywny FROM sz_szafarze')).rows.forEach((r) => { if (r.aktywny) ids[r.nazwisko] = r.id; nazwy[r.id] = r.nazwisko; });
    const obecne = {};
    (await c.query('SELECT osiedle, COALESCE(szafarz_id, szafarz_planowy_id) AS id FROM sz_przydzialy WHERE data = $1', [data])).rows.forEach((r) => { obecne[r.osiedle] = r.id; });
    const cel = {};
    for (const o of osiedla) {
      const n = wybor[o];
      if (n && ids[n]) cel[o] = ids[n];
      else if (n && obecne[o] && nazwy[obecne[o]] === n) cel[o] = obecne[o];   // bez zmian (także usunięty szafarz w minionym terminie)
      else throw new Blad('Wybierz szafarza dla osiedla: ' + o + '.');
    }
    if (nowa !== data) {
      if ((await c.query('SELECT 1 FROM sz_terminy WHERE data = $1', [nowa])).rowCount) throw new Blad('Termin ' + nowa.split('-').reverse().join('.') + ' już jest w harmonogramie.', 409);
      await c.query('INSERT INTO sz_terminy (data, nazwa) VALUES ($1, $2)', [nowa, nazwa]);
      for (const t of ['sz_przydzialy', 'sz_wizyty', 'sz_zmiany_szafarzy']) await c.query(`UPDATE ${t} SET data = $2 WHERE data = $1`, [data, nowa]);
      await c.query('DELETE FROM sz_terminy WHERE data = $1', [data]);
    } else {
      await c.query('UPDATE sz_terminy SET nazwa = $2 WHERE data = $1', [data, nazwa]);
    }
    for (const o of osiedla) {
      if (obecne[o] === cel[o]) continue;
      const r = await c.query('UPDATE sz_przydzialy SET szafarz_planowy_id = $3, szafarz_id = $3 WHERE data = $1 AND osiedle = $2', [nowa, o, cel[o]]);
      if (!r.rowCount) await c.query('INSERT INTO sz_przydzialy (data, osiedle, szafarz_planowy_id, szafarz_id) VALUES ($1, $2, $3, $3)', [nowa, o, cel[o]]);
      // zmiana szafarza trafia do logu zmian harmonogramu
      await c.query('INSERT INTO sz_zmiany_szafarzy (czas, data, osiedle, z_szafarza, na_szafarza) VALUES (now(), $1, $2, $3, $4)', [nowa, o, obecne[o] ? nazwy[obecne[o]] : '', nazwy[cel[o]]]);
    }
    return 'Zapisano termin ' + nowa.split('-').reverse().join('.') + ' (' + nazwa + ').';
  });
}

module.exports = { lista, dodajSzafarza, usunSzafarza, zmienSzafarza, dodajOsiedle, usunOsiedle, zmienOsiedle, dodajTermin, usunTermin, zmienTermin, Blad };
