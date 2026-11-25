#!/usr/bin/env node
// Buduje strony aplikacji (public/*.html) z plików projektu w design/*.dc.html.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'design');
const OUT = path.join(ROOT, 'public');

// strona → [tytuł, odpowiednik na telefon, odpowiednik na komputer]
const PAGES = {
  Main: ['Szafarz 3.0', 'Telefon', null],
  Telefon: ['Szafarz 3.0', null, 'Main'],
  Kalendarz: ['Harmonogram – Szafarz 3.0', 'KalendarzTelefon', null],
  KalendarzTelefon: ['Harmonogram – Szafarz 3.0', null, 'Kalendarz'],
  Planner: ['Planner wizyt – Szafarz 3.0', 'PlannerTelefon', null],
  PlannerTelefon: ['Planner wizyt – Szafarz 3.0', null, 'Planner'],
  Chorzy: ['Nasi Chorzy – Szafarz 3.0', 'ChorzyTelefon', null],
  ChorzyTelefon: ['Nasi Chorzy – Szafarz 3.0', null, 'Chorzy'],
  Obrzed: ['Obrzęd Komunii Świętej – Szafarz 3.0', 'ObrzedTelefon', null],
  ObrzedTelefon: ['Obrzęd Komunii Świętej – Szafarz 3.0', null, 'Obrzed'],
  ObrzedKroki: ['Obrzęd krok po kroku – Szafarz 3.0', null, null],
  Wspolnota: ['Nasza Wspólnota – Szafarz 3.0', 'WspolnotaTelefon', null],
  WspolnotaTelefon: ['Nasza Wspólnota – Szafarz 3.0', null, 'Wspolnota'],
};
const url = (name) => (name === 'Main' ? '/' : '/' + name);

const LOGOUT_D = ' · {{me.name}} · <a href="/logout" style="color: #FFFFFF; font-weight: 700">Wyloguj</a>';
const LOGOUT_M = '<a href="/logout" style="display: flex; align-items: center; gap: 14px; min-height: 56px; padding: 0 18px; border-bottom: 1px solid #EEEEEE; color: #8C3524; text-decoration: none; font-size: 15px; font-weight: 700"><span style="flex: 1">Wyloguj ({{me.name}})</span></a>\n</nav>';

function replaceOnce(s, from, to, what) {
  if (!s.includes(from)) throw new Error('Nie znaleziono: ' + what);
  return s.replace(from, to);
}

function build(name) {
  const [title, mobile, desktop] = PAGES[name];
  const src = fs.readFileSync(path.join(SRC, name + '.dc.html'), 'utf8');
  let tpl = src.slice(src.indexOf('<x-dc>') + 6, src.indexOf('</x-dc>'));
  const helmet = (tpl.match(/<helmet>([\s\S]*?)<\/helmet>/) || [, ''])[1];
  tpl = tpl.replace(/<helmet>[\s\S]*?<\/helmet>/, '');
  let js = src.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];

  // --- logika: dane z serwera zamiast localStorage, bez danych przykładowych w kodzie ---
  js = js.split('window.localStorage.getItem(KEY)').join('SZ.getItem(KEY)');
  js = js.split('window.localStorage.setItem(KEY, JSON.stringify(d))').join('SZ.setItem(KEY, JSON.stringify(d))');
  js = js.replace(/const SICK0 = \[.*\];/g, 'const SICK0 = [];');
  js = js.split("const CODE = '1234';").join('const CODE = SZ.revealCode;');
  if (/localStorage/.test(js)) throw new Error(name + ': pozostało użycie localStorage');

  // --- szablon ---
  tpl = tpl.replace(/href="([A-Za-z]+)\.dc\.html"/g, (m, p) => 'href="' + url(p) + '"');
  tpl = tpl.split('/_blob/76d363a5a7d437f5b94ab76a50712418').join('/img/kosciol.jpg');
  // <select>/<option> w szablonie – parser HTML usuwa w nich nieznane znaczniki (np. <sc-for>)
  tpl = tpl.replace(/<select\b/g, '<sc-select').replace(/<\/select>/g, '</sc-select>')
           .replace(/<option\b/g, '<sc-option').replace(/<\/option>/g, '</sc-option>');
  // ekran telefonu: zamiast ramki 390 px – cała szerokość i wysokość urządzenia
  if (desktop || name === 'ObrzedKroki') {
    tpl = tpl.replace('width: 390px;', 'width: 100%; max-width: 640px; margin: 0 auto;')
             .replace('height: 844px;', 'height: 100vh; height: 100dvh;')
             .replace('height: 1760px;', 'min-height: 100vh;');
  }
  if (tpl.includes('<span>Szczęść Boże! · {{lit.dayName}}</span>')) {
    tpl = tpl.replace('<span>Szczęść Boże! · {{lit.dayName}}</span>', '<span>Szczęść Boże! · {{lit.dayName}}' + LOGOUT_D + '</span>');
  }
  if (name === 'Telefon') tpl = replaceOnce(tpl, '</nav>\n', LOGOUT_M + '\n', 'menu telefonu');

  const opt = JSON.stringify({ mobile: mobile ? url(mobile) : null, desktop: desktop ? url(desktop) : null });
  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#A9442F">
<title>${title}</title>
<link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
${helmet.trim()}
</head>
<body>
<template id="tpl">${tpl}</template>
<div id="root"></div>
<script src="/runtime.js"></script>
<script>
${js.trim()}
SZ.mount(Component, ${opt});
</script>
</body>
</html>
`;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const name of Object.keys(PAGES)) {
  fs.writeFileSync(path.join(OUT, name + '.html'), build(name));
}
fs.cpSync(path.join(ROOT, 'static'), OUT, { recursive: true });
console.log('Zbudowano ' + Object.keys(PAGES).length + ' stron w public/');
