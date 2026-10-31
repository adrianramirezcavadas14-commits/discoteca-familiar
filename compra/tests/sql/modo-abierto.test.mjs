// Modo abierto (por defecto): sin clave familiar, como la discoteca y la biblioteca.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pgAvailable, freshDatabase, asAnon, rpc } from './helpers.mjs';

const available = await pgAvailable();
const skip = !available && 'PostgreSQL no disponible';
let pool;
before(async () => { if (available) pool = await freshDatabase('compra_abierta_test', { withKey: false }); });
after(async () => { await pool?.end(); });

test('sin clave puesta, la app funciona sin enviar ninguna clave', { skip }, async () => {
  await asAnon(pool, null, async (c) => {
    const who = await rpc(c, 'whoami');
    assert.equal(who.ok, true);
    assert.equal((await c.query('select count(*)::int n from compra.store_zones')).rows[0].n, 15);
    const r = await rpc(c, 'save_list_draft', { p_changes: [], p_actor: 'adrian' });
    assert.equal(r.list.status, 'draft');
  });
  // Las escrituras directas siguen prohibidas: todo pasa por las funciones que validan
  await assert.rejects(asAnon(pool, null, (c) => c.query('delete from compra.store_zones')), /permission denied/);
  await assert.rejects(asAnon(pool, null, (c) => c.query(`select compra.set_household_key('una-clave-muy-larga')`)), /permission denied/);
});

test('si se activa una clave, deja de abrirse sin ella; y se puede quitar', { skip }, async () => {
  await pool.query(`select compra.set_household_key('una-clave-muy-larga')`);
  await asAnon(pool, null, async (c) => {
    const who = await rpc(c, 'whoami');
    assert.equal(who.ok, false);
    assert.equal(who.reason, 'missing_key');
  });
  await asAnon(pool, 'una-clave-muy-larga', async (c) => assert.equal((await rpc(c, 'whoami')).ok, true));
  await pool.query('select compra.clear_household_key()');
  await asAnon(pool, null, async (c) => assert.equal((await rpc(c, 'whoami')).ok, true));
});
