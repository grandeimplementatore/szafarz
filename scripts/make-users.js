#!/usr/bin/env node
// Buduje wartość zmiennej USERS z pliku users.local.json (którego NIE wrzucamy do gita).
// users.local.json: {"pelka": {"name": "Paweł Pełka", "password": "..."}, ...}
'use strict';
const fs = require('fs');
const { hashPassword } = require('../lib/auth');
const file = process.argv[2] || 'users.local.json';
const src = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));   // Notatnik bywa, że dodaje BOM
const out = {};
for (const [login, u] of Object.entries(src)) {
  if (!u.password || u.password.length < 8) { console.error('Hasło dla "' + login + '" musi mieć co najmniej 8 znaków.'); process.exit(1); }
  out[login.toLowerCase()] = { name: u.name || login, hash: hashPassword(u.password) };
}
process.stdout.write(JSON.stringify(out));
