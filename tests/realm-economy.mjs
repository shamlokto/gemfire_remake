import assert from 'node:assert/strict';
import { test, done } from './_harness.mjs';
import { newGame, governorOf, stateHash, houseTotals, provinceUpkeep } from '../js/realm/state.js';
import { monthlyTick, goldIncome, harvestYield, applyEffect, HARVEST_MONTH } from '../js/realm/economy.js';
import { PROVINCES, ADJACENCY, SEA_LANES } from '../js/data/world.js';
import { makeRng } from '../js/rng.js';

test('newGame layout (28 provinces, units apart from vassals)', () => {
  const s = newGame('aldmere', 7);
  assert.equal(s.provinces.length, PROVINCES.length);
  assert.equal(s.provinces.length, 28);
  assert.equal(s.provinces[8].owner, 'aldmere');
  assert.equal(s.provinces[8].shard, 'tide');
  assert.equal(s.provinces[17].owner, 'vey');
  assert.equal(s.provinces[17].shard, null);
  assert.equal(s.provinces.filter(p => !p.owner).length, 16);
  for (const p of s.provinces.filter(p => !p.owner)) {
    const t = p.militia.reduce((a, n) => a + n, 0);
    assert.ok(p.militia.length >= 1 && p.militia.length <= 3 && t >= 60 && t <= 140, JSON.stringify(p.militia));
    assert.equal(p.units.length, 0);
  }
  assert.equal(Object.keys(s.vassals).length, 36);
  for (const v of Object.values(s.vassals)) {
    assert.ok(s.provinces[v.location].vassals.includes(v.id));
    assert.equal(v.soldiers, undefined);
    const led = s.provinces[v.location].units.filter(u => u.leader === v.id);
    assert.equal(led.length, 1, v.id + ' leads one unit');
  }
  // Two leaderless footmen in each capital.
  for (const h of Object.values(s.houses)) {
    assert.equal(s.provinces[h.capital].units.filter(u => !u.leader && u.type === 'footmen' && u.soldiers === 80).length, 2);
  }
  const uids = s.provinces.flatMap(p => p.units.map(u => u.uid));
  assert.equal(new Set(uids).size, uids.length);
  assert.equal(s.pendingEvents.length, 1);
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(s))), JSON.stringify(s));
});

test('map: islands are reached by single sea lanes; dead ends exist', () => {
  const deg = id => ADJACENCY[id].length;
  for (const name of ['Frosthelm', 'Mirefen', 'Cairnholm', 'Emberrock', 'Tidesend']) {
    assert.equal(deg(PROVINCES.find(p => p.name === name).id), 1, name);
  }
  // Every province is reachable.
  const seen = new Set([0]); const q = [0];
  while (q.length) for (const n of ADJACENCY[q.shift()]) if (!seen.has(n)) { seen.add(n); q.push(n); }
  assert.equal(seen.size, PROVINCES.length);
  // Removing a sea lane cuts its island off.
  for (const [a, b] of SEA_LANES) {
    const s2 = new Set([a]); const q2 = [a];
    while (q2.length) { const c = q2.shift(); for (const n of ADJACENCY[c]) if (!(c === a && n === b) && !(c === b && n === a) && !s2.has(n)) { s2.add(n); q2.push(n); } }
    assert.ok(!s2.has(b), `lane ${a}-${b} is the only link`);
  }
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

test('gold income and upkeep from units', () => {
  const s = newGame('aldmere', 1);
  const pr = s.provinces[8];
  assert.ok(provinceUpkeep(s, 8) > 0);
  const g0 = pr.gold, f0 = pr.food;
  const inc = goldIncome(pr);
  monthlyTick(s, makeRng(99));
  assert.ok(inc > 0);
  assert.ok(pr.gold >= g0 || s.log.some(l => l.kind === 'event'));
  assert.ok(pr.food <= f0 || s.log.some(l => l.kind === 'event'));
  assert.ok(houseTotals(s, 'aldmere').soldiers > 0);
});

test('harvest in the harvest month', () => {
  const s = newGame('aldmere', 1);
  s.month = HARVEST_MONTH;
  const pr = s.provinces[8];
  const expect = harvestYield(pr);
  const f0 = pr.food;
  monthlyTick(s, makeRng(1));
  assert.ok(pr.food >= f0 + expect - 80, `food ${f0} -> ${pr.food}, harvest ${expect}`);
});

test('starvation costs soldiers and loyalty', () => {
  const s = newGame('hrothgar', 1);
  const pr = s.provinces[11];
  pr.food = 0;
  const before = pr.units.map(u => u.soldiers);
  const l0 = pr.loyalty;
  monthlyTick(s, makeRng(5));
  const after = pr.units.map(u => u.soldiers);
  assert.ok(after.every((n, i) => n <= Math.floor(before[i] * 0.9) + 1));
  assert.ok(pr.loyalty < l0);
});

test('unpaid company deserts', () => {
  const s = newGame('isolde', 1);
  const pr = s.provinces[21];
  pr.company = { type: 'golem', soldiers: 60 };
  pr.gold = 0; pr.market = 0;
  monthlyTick(s, makeRng(2));
  assert.equal(pr.company, null);
});

test('event effects clamp and hit units', () => {
  const s = newGame('vey', 1);
  const pr = s.provinces[17];
  const n0 = pr.units[0].soldiers;
  applyEffect(s, pr, { fields: -500, loyalty: 500, foodPct: -2, soldiersPct: -0.5 });
  assert.equal(pr.fields, 0); assert.equal(pr.loyalty, 100); assert.equal(pr.food, 0);
  assert.equal(pr.units[0].soldiers, Math.round(n0 * 0.5));
});

test('free hold militia grows', () => {
  const s = newGame('vey', 1);
  const total = p => p.militia.reduce((a, n) => a + n, 0);
  const m0 = total(s.provinces[13]);
  monthlyTick(s, makeRng(3));
  assert.ok(total(s.provinces[13]) >= m0);
});

await done('realm-economy');
