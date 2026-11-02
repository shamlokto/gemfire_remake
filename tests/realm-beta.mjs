// Beta tester mode: unlimited gold (and food) for the player only. node tests/realm-beta.mjs
import assert from 'node:assert/strict';
import { test, done } from './_harness.mjs';
import { newGame, setBeta, isFree, BETA_GOLD } from '../js/realm/state.js';
import { applyOrder, listOrders } from '../js/realm/orders.js';
import { aiBuild } from '../js/realm/landhooks.js';
import { endMonth } from '../js/realm/turn.js';
import { autoResolve } from '../js/battle/auto.js';

test('beta: the player musters, builds and hires with an empty treasury', () => {
  const s = newGame('aldmere', 3);
  setBeta(s, true);
  for (const pr of s.provinces) if (pr.owner === 'aldmere') pr.gold = 0;
  assert.ok(isFree(s, 'aldmere') && !isFree(s, 'corvane'));
  assert.ok(!listOrders(s, 8).find(o => o.type === 'muster').disabled, 'muster not blocked');
  const m = applyOrder(s, { province: 8, type: 'muster', troop: 'knights', soldiers: 100 });
  assert.ok(m.ok, m.msg);
  s.provinces[9].gold = 0;
  listOrders(s, 9);                               // the UI lists orders first; the treasury refills
  const b = aiBuild(s, 9, 'food');
  s.provinces[9].gold = 0;                        // and even if it hit zero again, the order still goes through
  assert.ok(b && applyOrder(s, b).ok, 'build with 0 gold');
  s.provinces[8].ordered = false; s.provinces[8].gold = 0;
  const h = applyOrder(s, { province: 8, type: 'hire', company: 'wolfriders' });
  assert.ok(h.ok, h.msg);
  assert.ok(s.provinces[8].gold >= 0);
});

test('beta: AI houses are unaffected; months keep the player topped up', async () => {
  const s = newGame('aldmere', 4);
  setBeta(s, true);
  s.provinces[2].gold = 0;                       // Corvane's capital
  const before = s.provinces[2].gold;
  assert.equal(before, 0);
  assert.ok(applyOrder(s, { province: 2, type: 'muster', troop: 'footmen', soldiers: 50 }).ok === false, 'AI cannot muster with 0 gold');
  await endMonth(s, { resolveBattle: (inp, st, o) => autoResolve(inp, o?.seed ?? 1) });
  for (const pr of s.provinces) if (pr.owner === 'aldmere') assert.ok(pr.gold >= BETA_GOLD && pr.food >= 9999);
  assert.ok(s.provinces[2].owner !== 'corvane' || s.provinces[2].gold < BETA_GOLD, 'AI gold is not topped up');
});

test('beta: survives a save round trip; off means normal rules', () => {
  const s = newGame('vey', 5);
  setBeta(s, true, false);
  const t = JSON.parse(JSON.stringify(s));
  assert.deepEqual(t.beta, { gold: true, food: false });
  assert.ok(isFree(t, 'vey', 'gold') && !isFree(t, 'vey', 'food'));
  const u = newGame('vey', 5);
  u.provinces[17].gold = 0;
  assert.ok(!applyOrder(u, { province: 17, type: 'muster', troop: 'footmen', soldiers: 50 }).ok);
});

await done('realm-beta');
