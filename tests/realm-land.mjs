// Land integration: the realm economy runs on the province land grids (js/realm/landhooks.js).
import assert from 'node:assert/strict';
import { test, done } from './_harness.mjs';
import { newGame, withRng } from '../js/realm/state.js';
import { applyOrder, musterLimit } from '../js/realm/orders.js';
import { forecast, harvestYield, goldIncome, monthlyTick } from '../js/realm/economy.js';
import { buildBattleInput, applyBattleResult } from '../js/realm/turn.js';
import { yieldOf, landQuality, applyLoot, aiBuild, warDamage } from '../js/realm/landhooks.js';
import { provinceYield, B, T } from '../js/land/land.js';
import { SCENARIOS } from '../js/data/scenarios.js';
import { makeRng } from '../js/rng.js';

const houseIncome = (s, h) => s.provinces.filter(p => p.owner === h)
  .reduce((a, p) => ({ food: a.food + harvestYield(p, s), gold: a.gold + goldIncome(p, s) }), { food: 0, gold: 0 });

test('every scenario starts with land for all 28 provinces, and it survives a save', () => {
  for (const sc of SCENARIOS) {
    const s = newGame('aldmere', 5, sc.id);
    assert.equal(s.land.length, 28, sc.id);
    for (const pr of s.provinces) assert.ok(yieldOf(s, pr.id), `${sc.id} ${pr.id}`);
    const back = JSON.parse(JSON.stringify(s));
    assert.deepEqual(yieldOf(back, 8), yieldOf(s, 8));
  }
  // later scenarios start more developed
  const e = newGame('aldmere', 5, 'eclipse'), l = newGame('aldmere', 5, 'lastshard');
  assert.ok(yieldOf(l, 8).food > yieldOf(e, 8).food, 'Last Shard lands are more developed');
});

test('the economy reads the land: harvest and gold follow what is built', () => {
  const s = newGame('aldmere', 2);
  const pr = s.provinces[8];
  const f = forecast(s, 8);
  assert.ok(f.land && f.harvest > 0);
  const before = harvestYield(pr, s);
  // burn half the farms: the harvest falls
  const land = s.land[8];
  let n = 0;
  land.b.forEach((b, i) => { if (b === B.FARM && n++ % 2 === 0) land.d[i] = 1; });
  assert.ok(harvestYield(pr, s) < before, 'damaged farms grow nothing');
});

test('conquering a breadbasket changes a house\'s income materially', () => {
  const s = newGame('vey', 3);
  // the richest free hold by land potential
  const free = s.provinces.filter(p => !p.owner);
  const rich = free.sort((a, b) => yieldOf(s, b.id).food - yieldOf(s, a.id).food)[0];
  const before = houseIncome(s, 'vey');
  rich.owner = 'vey'; rich.militia = [];
  const after = houseIncome(s, 'vey');
  assert.ok(after.food > before.food * 1.25, `harvest ${before.food} -> ${after.food}`);
  // and a barren one adds far less food
  const barren = free.filter(p => p.id !== rich.id).sort((a, b) => yieldOf(s, a.id).food - yieldOf(s, b.id).food)[0];
  assert.ok(yieldOf(s, barren.id).food < yieldOf(s, rich.id).food / 2, 'land quality differs');
  assert.ok(['breadbasket', 'fertile'].includes(landQuality(s, rich.id)) || yieldOf(s, rich.id).food > 250);
});

test('battles: walls make defenders stronger; conquest scars the land; loot pays and angers', () => {
  const s = newGame('aldmere', 4);
  const target = s.provinces[2];   // Ravenscar, Corvane's capital
  const land = s.land[2];
  const march = { house: 'aldmere', from: 7, to: 2, units: [{ uid: 'x1', type: 'footmen', soldiers: 300, training: 50, leader: null }], vassals: [], fifth: null, food: 0 };
  const plain = buildBattleInput(s, march);
  const k = land.b.indexOf(B.KEEP), kx = k % land.w, ky = (k / land.w) | 0;
  let walls = 0;
  for (let i = 0; i < land.t.length && walls < 4; i++) {
    const x = i % land.w, y = (i / land.w) | 0;
    if (land.b[i] !== B.KEEP && Math.max(Math.abs(x - kx), Math.abs(y - ky)) <= 2 && land.t[i] !== T.WATER && land.t[i] !== T.RIVER) { land.b[i] = B.WALLS; land.c[i] = 0; land.d[i] = 0; walls++; }
  }
  assert.ok(walls > 0);
  const walled = buildBattleInput(s, march);
  const dPlain = plain.defender.units.find(u => u.kind === 'troop').defBonus || 1;
  const dWalled = walled.defender.units.find(u => u.kind === 'troop').defBonus || 1;
  assert.ok(dWalled > dPlain, `defBonus ${dPlain} -> ${dWalled}`);
  // damage
  const built = () => land.b.filter((b, i) => b && b !== B.KEEP && !land.d[i]).length;
  const n0 = built();
  withRng(s, rng => warDamage(s, 2, 1, rng));
  assert.ok(built() < n0, 'war damage');
  // loot
  const g = target.gold, l = target.loyalty;
  const r = withRng(s, rng => applyLoot(s, 2, rng));
  assert.ok(target.gold >= g && target.loyalty === Math.max(0, l - 25));
  assert.ok(r.gold >= 0);
});

test('conquest by the player queues a loot choice; AI decides itself', () => {
  const s = newGame('aldmere', 6);
  const march = { house: 'aldmere', from: 8, to: 13, units: [{ uid: 'x1', type: 'footmen', soldiers: 400, training: 60, leader: null }], vassals: [], fifth: null, food: 0 };
  const input = buildBattleInput(s, march);
  const result = { winner: 'attacker', rounds: 5, attacker: { units: [{ id: 'x1', soldiers: 350, fate: 'ok' }] },
    defender: { units: input.defender.units.map(u => ({ id: u.id, soldiers: 0, fate: 'routed' })) } };
  s.pendingEvents = [];
  applyBattleResult(s, march, input, result);
  assert.equal(s.provinces[13].owner, 'aldmere');
  assert.ok(s.pendingEvents.some(e => e.kind === 'loot' && e.province === 13));
});

test('build orders, muster limits and AI builds', () => {
  const s = newGame('hrothgar', 7);
  const lim = musterLimit(s, 11);
  assert.ok(lim >= 30 && lim < 500);
  s.provinces[11].gold = 2000;
  const r = applyOrder(s, { province: 11, type: 'muster', troop: 'footmen', soldiers: 500 });
  assert.ok(r.ok, r.msg);
  assert.ok(s.provinces[11].units.find(u => u.uid === r.unit).soldiers <= lim, 'one muster is limited by the people');
  // AI build suggestions are valid orders
  const s2 = newGame('isolde', 8);
  s2.provinces[21].gold = 400;
  const b = aiBuild(s2, 21, 'food');
  assert.ok(b && b.type === 'build');
  const rr = applyOrder(s2, b);
  assert.ok(rr.ok, rr.msg);
  // dikes have no tile
  s2.provinces[22].gold = 100;
  const d0 = s2.provinces[22].dikes;
  assert.ok(applyOrder(s2, { province: 22, type: 'build', kind: 'dikes' }).ok);
  assert.ok(s2.provinces[22].dikes > d0);
});

test('construction finishes over months; unstored food spoils in winter', () => {
  const s = newGame('aldmere', 9);
  const land = s.land[9];
  s.provinces[9].gold = 500;
  const i = land.t.findIndex((t, k) => (t === T.PLAIN || t === T.FERTILE || t === T.POOR) && !land.b[k]);
  const x = i % land.w, y = (i / land.w) | 0;
  assert.ok(applyOrder(s, { province: 9, type: 'build', x, y, kind: 'houses' }).ok);
  assert.ok(land.c[i] > 0);
  withRng(s, rng => monthlyTick(s, rng));
  assert.equal(land.c[i], 0, 'houses take one month');
  // winter spoilage
  s.month = 9;
  const pr = s.provinces[8];
  pr.food = 5000;
  withRng(s, rng => monthlyTick(s, rng));
  assert.ok(pr.food < 5000 - 200, `spoiled to ${pr.food}`);
});

done('realm-land');
