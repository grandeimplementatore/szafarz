#!/usr/bin/env node
// Tworzy skrót hasła do zmiennej USERS.  Użycie: npm run hash -- "TajneHaslo123"
'use strict';
const { hashPassword } = require('../lib/auth');
const pwd = process.argv[2];
if (!pwd || pwd.length < 8) { console.error('Podaj hasło (co najmniej 8 znaków): npm run hash -- "TajneHaslo123"'); process.exit(1); }
console.log(hashPassword(pwd));
