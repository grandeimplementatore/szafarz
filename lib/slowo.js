'use strict';
// „Słowo na dziś” – pobierane na bieżąco ze strony Archidiecezji Katowickiej (nie jest przechowywane w bazie).
// Wynik trzymamy chwilę w pamięci serwera, żeby nie odpytywać strony przy każdym wejściu.
const ZRODLO = 'https://www.archidiecezjakatowicka.pl/slowo-na-dzisiaj';
const cache = new Map();
const OK_TTL = 6 * 3600e3, ERR_TTL = 10 * 60e3;

const NAGLOWKI = [
  [/^pierwsze czytanie$/i, 'I czytanie'],
  [/^drugie czytanie$/i, 'II czytanie'],
  [/^psalm( responsoryjny)?$/i, 'Psalm'],
  [/^ewangelia$/i, 'Ewangelia'],
];
const INNY_NAGLOWEK = /^(śpiew przed ewangelią|aklamacja|formacja|pomoc|inne instytucje|media|kontakt)$/i;

function adres(iso) { const [y, m, d] = iso.split('-'); return `${ZRODLO}?data=${d}-${m}-${y}`; }

function htmlNaLinie(html) {
  const ENT = { nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', oacute: 'ó', Oacute: 'Ó', ndash: '–', mdash: '—', hellip: '…', bdquo: '„', rdquo: '”', ldquo: '“' };
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|section|article|header|em|i)>/gi, '\n')
    .replace(/<(h[1-6]|p|div|li|em|i)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => (n in ENT ? ENT[n] : m))
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function sigla(line) {
  const m = /\(([^()]*\d[^()]*)\)\s*$/.exec(line);
  if (m) return m[1].trim();
  return /^[1-3]?\s?[A-ZŁŚŻŹ][a-ząęółśżźćń]{0,4}\.?\s\d/.test(line) && line.length < 60 ? line : null;
}

// Zwraca { quote, ref, rows: [[nazwa, sigla]], url } albo rows: [], gdy strony nie udało się odczytać.
function parse(html, url) {
  const lines = htmlNaLinie(html);
  const rows = [];
  let quote = '', ref = '';
  for (let i = 0; i < lines.length; i++) {
    const h = NAGLOWKI.find(([re]) => re.test(lines[i]));
    if (!h) continue;
    let sig = null, j = i + 1;
    for (; j < Math.min(lines.length, i + 4); j++) { sig = sigla(lines[j]); if (sig) break; }
    if (!sig) continue;
    rows.push([h[1], sig]);
    if (h[1] === 'Ewangelia' && !quote) {
      ref = sig;
      const body = [];
      for (let k = j + 1; k < lines.length && body.join(' ').length < 600; k++) {
        const l = lines[k];
        if (NAGLOWKI.some(([re]) => re.test(l)) || INNY_NAGLOWEK.test(l) || /^oto słowo pańskie/i.test(l)) break;
        if (/^słowa ewangelii według/i.test(l)) continue;
        body.push(l);
      }
      const text = body.join(' ');
      const mowa = /«([^»]+)»/.exec(text);                           // słowa Jezusa, jeśli są w cudzysłowie
      const first = ((mowa ? mowa[1] : text).match(/^.*?[.!?](?=[»”"]?(\s|$))/) || [mowa ? mowa[1] : ''])[0].replace(/^[„"«]|[”"»]$/g, '').trim();
      const words = first.split(' ');
      quote = words.length > 22 ? words.slice(0, 20).join(' ') + '…' : first;
    }
  }
  return { quote, ref, rows, url };
}

async function pobierz(iso) {
  const hit = cache.get(iso);
  if (hit && Date.now() - hit.at < (hit.value.rows.length ? OK_TTL : ERR_TTL)) return hit.value;
  const url = adres(iso);
  let value = { quote: '', ref: '', rows: [], url };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Szafarz/3.0 (aplikacja wspolnoty szafarzy, parafia bl. Karoliny Kozkowny w Tychach)' } });
    clearTimeout(t);
    if (r.ok) value = parse(await r.text(), url);
    else console.warn('[slowo] strona odpowiedziała ' + r.status);
  } catch (e) {
    console.warn('[slowo] nie udało się pobrać: ' + e.message);
  }
  cache.set(iso, { at: Date.now(), value });
  if (cache.size > 60) cache.delete(cache.keys().next().value);
  return value;
}

module.exports = { pobierz, parse, adres };
