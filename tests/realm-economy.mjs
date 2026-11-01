import assert from 'node:assert/strict';
import { test, done } from './_harness.mjs';
import { newGame, ownedProvinces, governorOf, stateHash } from '../js/realm/state.js';
import { monthlyTick, goldIncome, harvestYield, applyEffect, HARVEST_MONTH } from '../js/realm/economy.js';
import { makeRng } from '../js/rng.js';

test('newGame layout', () => {
  const s = newGame('aldmere', 7);
  assert.equal(s.provinces.length, 24);
  assert.equal(s.provinces[8].owner, 'aldmere');
  assert.equal(s.provinces[8].shard, 'tide');
  assert.equal(s.provinces[19].shard, null);
  assert.equal(s.provinces.filter(p => !p.owner).length, 12);
  for (const p of s.provinces.filter(p => !p.owner)) assert.ok(p.militia >= 60 && p.militia <= 140);
  assert.equal(Object.keys(s.vassals).length, 36);
  for (const v of Object.values(s.vassals)) assert.ok(s.provinces[v.location].vassals.includes(v.id));
  assert.equal(s.pendingEvents.length, 1);
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(s))), JSON.stringify(s));
});

test('same seed same game', () => {
  assert.equal(stateHash(newGame('vey', 3)), stateHash(newGame('vey', 3)));
  assert.notEqual(stateHash(newGame('vey', 3)), stateHash(newGame('vey', 4)));
});

test('governor is the ruler when present', () => {
  const s = newGame('aldmere', 1);
  assert.equal(governorOf(s, 8).id, 'aldmere_0');
  assert.equal(governorOf(s, 9).id, 'aldmere_5');   // best charm in Kingsrest
});

test('gold income and upkeep', () => {
  const s = newGame('aldmere', 1);
  const pr = s.provinces[8];
  const g0 = pr.gold, f0 = pr.food;
  const inc = goldIncome(pr);
  monthlyTick(s, makeRng(99));
  assert.ok(inc > 0);
  // Events can change things; with no event, gold rose by income and food fell by upkeep.
  assert.ok(pr.gold >= g0 || s.log.some(l => l.kind === 'event'));
  assert.ok(pr.food <= f0 || s.log.some(l => l.kind === 'event'));
});

test('harvest in the harvest month', () => {
  const s = newGame('aldmere', 1);
  s.month = HARVEST_MONTH;
  const pr = s.provinces[8];
  const expect = harvestYield(pr);
  const f0 = pr.food;
  monthlyTick(s, makeRng(1));
  assert.ok(pr.food >= f0 + expect - 60, `food ${f0} -> ${pr.food}, harvest ${expect}`);
});

test('starvation costs soldiers and loyalty', () => {
  const s = newGame('hrothgar', 1);
  const pr = s.provinces[12];
  pr.food = 0;
  const before = pr.vassals.map(id => s.vassals[id].soldiers);
  const l0 = pr.loyalty;
  monthlyTick(s, makeRng(5));
  const after = pr.vassals.map(id => s.vassals[id].soldiers);
  assert.ok(after.every((n, i) => n <= Math.floor(before[i] * 0.9) + 1));
  assert.ok(pr.loyalty < l0);
});

test('unpaid company deserts', () => {
  const s = newGame('isolde', 1);
  const pr = s.provinces[11];
  pr.company = { type: 'golem', soldiers: 60 };
  pr.gold = 0; pr.market = 0;
  monthlyTick(s, makeRng(2));
  assert.equal(pr.company, null);
});

test('event effects clamp', () => {
  const s = newGame('vey', 1);
  const pr = s.provinces[19];
  applyEffect(s, pr, { fields: -500, loyalty: 500, foodPct: -2 });
  assert.equal(pr.fields, 0); assert.equal(pr.loyalty, 100); assert.equal(pr.food, 0);
});

test('free hold militia grows', () => {
  const s = newGame('vey', 1);
  const m0 = s.provinces[14].militia;
  monthlyTick(s, makeRng(3));
  assert.ok(s.provinces[14].militia >= m0);
});

await done('realm-economy');
