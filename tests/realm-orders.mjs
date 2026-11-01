import assert from 'node:assert/strict';
import { test, done } from './_harness.mjs';
import { newGame } from '../js/realm/state.js';
import { listOrders, applyOrder, DEVELOP_COST } from '../js/realm/orders.js';

test('listOrders for an owned province', () => {
  const s = newGame('aldmere', 1);
  const l = listOrders(s, 8);
  assert.ok(l.find(o => o.type === 'develop' && !o.disabled));
  assert.ok(l.find(o => o.type === 'march' && !o.disabled));
  assert.deepEqual(listOrders(s, 14), []);
});

test('one order per province per month', () => {
  const s = newGame('aldmere', 1);
  assert.ok(applyOrder(s, { province: 8, type: 'develop', kind: 'fields' }).ok);
  const r = applyOrder(s, { province: 8, type: 'develop', kind: 'market' });
  assert.equal(r.ok, false);
  assert.ok(listOrders(s, 8).every(o => o.disabled));
});

test('develop spends gold and raises the stat', () => {
  const s = newGame('aldmere', 1);
  const pr = s.provinces[8];
  const g = pr.gold, f = pr.fields;
  assert.ok(applyOrder(s, { province: 8, type: 'develop', kind: 'fields' }).ok);
  assert.equal(pr.gold, g - DEVELOP_COST);
  assert.ok(pr.fields > f);
  pr.gold = 0;
  assert.equal(applyOrder(s, { province: 9, type: 'develop', kind: 'nope' }).ok, false);
});

test('muster is limited by gold and the unit cap', () => {
  const s = newGame('aldmere', 1);
  const pr = s.provinces[8];
  pr.gold = 1000;
  const v = s.vassals.aldmere_4;
  const r = applyOrder(s, { province: 8, type: 'muster', vassal: 'aldmere_4', soldiers: 9999 });
  assert.ok(r.ok, r.msg);
  assert.equal(v.soldiers, 500);
});

test('cannot order from a province you do not own or use absent vassals', () => {
  const s = newGame('aldmere', 1);
  assert.equal(applyOrder(s, { province: 14, type: 'develop', kind: 'fields' }).ok, false);
  assert.equal(applyOrder(s, { province: 8, type: 'muster', vassal: 'vey_0', soldiers: 10 }).ok, false);
});

test('march to own province transfers; to foreign queues', () => {
  const s = newGame('aldmere', 1);
  let r = applyOrder(s, { province: 8, type: 'march', to: 9, vassals: ['aldmere_4'], food: 10 });
  assert.ok(r.ok, r.msg);
  assert.equal(s.vassals.aldmere_4.location, 9);
  r = applyOrder(s, { province: 9, type: 'march', to: 14, vassals: ['aldmere_2'], food: 0 });
  assert.equal(r.ok, false, 'not adjacent? 9-14 not adjacent');
  r = applyOrder(s, { province: 9, type: 'march', to: 15, vassals: ['aldmere_2', 'aldmere_3'], food: 20 });
  assert.ok(r.ok, r.msg);
  assert.equal(s.marches.length, 1);
  assert.equal(s.vassals.aldmere_2.location, null);
  assert.ok(s.vassals.aldmere_2.marching);
});

test('no attacks on truce partners; at most five marchers', () => {
  const s = newGame('aldmere', 1);
  s.truces['aldmere|corvane'] = 99;
  assert.equal(applyOrder(s, { province: 8, type: 'march', to: 2, vassals: ['aldmere_1'] }).ok, false);
  assert.equal(applyOrder(s, { province: 8, type: 'march', to: 14, vassals: ['a', 'b', 'c', 'd', 'e', 'f'] }).ok, false);
});

test('hire, govern, supply, spy', () => {
  const s = newGame('isolde', 1);
  assert.ok(applyOrder(s, { province: 11, type: 'hire', company: 'bandits' }).ok);
  assert.equal(s.provinces[11].company.type, 'bandits');
  assert.ok(applyOrder(s, { province: 17, type: 'govern', kind: 'feast' }).ok);
  const s2 = newGame('isolde', 1);
  assert.ok(applyOrder(s2, { province: 11, type: 'supply', to: 17, food: 50, gold: 10 }).ok);
  const s3 = newGame('isolde', 1);
  const r = applyOrder(s3, { province: 11, type: 'spy', target: 1 });
  assert.ok(r.ok && r.report.province === 1);
  assert.equal(s3.intel.isolde[1], 0);
});

test('diplomacy runs and is deterministic', () => {
  const run = () => {
    const s = newGame('aldmere', 42);
    s.provinces[8].gold = 1000;
    const r = applyOrder(s, { province: 8, type: 'diplomacy', kind: 'truce', target: 'vey' });
    return [r.ok, r.success, s.rng];
  };
  assert.deepEqual(run(), run());
  assert.ok(run()[0]);
});

test('bribe cannot target rulers', () => {
  const s = newGame('aldmere', 1);
  s.provinces[8].gold = 5000;
  const r = applyOrder(s, { province: 8, type: 'diplomacy', kind: 'bribe', vassal: 'vey_0' });
  assert.equal(r.ok, false);
});

await done('realm-orders');
