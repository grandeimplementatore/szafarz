'use strict';
// Przenosi dane zapisane przez poprzednią wersję aplikacji (tabela szafarz_store, jeden dokument JSON)
// do nowych tabel. Jeśli tamtej tabeli nie ma, nic nie robi.
module.exports = async function (c, { applyState }) {
  const exists = (await c.query(`SELECT to_regclass('public.szafarz_store') AS t`)).rows[0].t;
  if (!exists) return;
  const r = await c.query('SELECT data FROM szafarz_store WHERE id = 1');
  if (!r.rowCount || !r.rows[0].data) return;
  const n = await applyState(c, r.rows[0].data, 'migracja');
  console.log('[szafarz] przeniesiono dane z poprzedniej wersji (zmian: ' + n + ')');
};
