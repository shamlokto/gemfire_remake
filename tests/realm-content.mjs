// Tech tree, shard charge, scenarios, wanderers and heirs: node tests/realm-content.mjs
import assert from 'node:assert/strict';
import { test, done } from './_harness.mjs';
import { newGame, ownedProvinces, availableSpirit, wanderersNear } from '../js/realm/state.js';
import { applyOrder, listOrders, marchOptions, hireOptions, musterCost } from '../js/realm/orders.js';
import { buildBattleInput, applyBattleResult, endMonth } from '../js/realm/turn.js';
import { harvestYield, goldIncome, monthlyTick } from '../js/realm/economy.js';
import {
  techCost, canResearch, setResearch, addResearch, hasTech, chargeGain, averageLoyalty, chargeTick,
  shardCharge, setCharge, CHARGE_MAX, researchPoints, shardStatus,
} from '../js/realm/tech.js';
import { SCENARIOS } from '../js/data/scenarios.js';
import { TECHS } from '../js/data/tech.js';
import { MAX_UNITS_PER_PROVINCE, MAX_VASSALS_PER_PROVINCE } from '../js/data/units.js';
import { createBattle, expectedKills } from '../js/battle/rules.js';
import { makeRng } from '../js/rng.js';

const win = side => input => ({
  winner: side, rounds: 5,
  attacker: { units: input.attacker.units.map(u => ({ id: u.id, soldiers: side === 'attacker' ? u.soldiers : Math.floor(u.soldiers / 2), fate: 'ok' })) },
  defender: { units: input.defender.units.map(u => ({ id: u.id, soldiers: side === 'defender' ? u.soldiers : 0, fate: side === 'defender' ? 'ok' : 'routed' })) },
});

// ---------- tech ----------
test('tech tree: prerequisites, costs rise, research completes', () => {
  const s = newGame('aldmere', 1);
  assert.ok(canResearch(s, 'aldmere', 'crop_rotation'));
  assert.ok(!canResearch(s, 'aldmere', 'irrigation'));
  assert.equal(setResearch(s, 'aldmere', 'irrigation').ok, false);
  const c0 = techCost(s, 'aldmere', 'crop_rotation');
  assert.equal(setResearch(s, 'aldmere', 'crop_rotation').ok, true);
  addResearch(s, 'aldmere', c0);
  assert.ok(hasTech(s, 'aldmere', 'crop_rotation'));
  assert.ok(canResearch(s, 'aldmere', 'irrigation'));
  assert.ok(techCost(s, 'aldmere', 'markets') > 40, 'costs inflate with techs known');
  for (const t of TECHS) for (const r of t.requires) assert.ok(TECHS.some(x => x.id === r), t.id + ' needs ' + r);
});

test('tech effects: harvest, gold, drill, siege cost, black powder unlock', () => {
  const s = newGame('aldmere', 1);
  const pr = s.provinces[8];
  const h0 = harvestYield(pr, s), g0 = goldIncome(pr, s);
  s.houses.aldmere.tech.researched.push('crop_rotation', 'markets');
  assert.ok(harvestYield(pr, s) > h0 * 1.1);
  assert.ok(goldIncome(pr, s) > g0);
  assert.ok(hireOptions(s, 8).find(o => o.type === 'bombard').locked);
  assert.equal(applyOrder(s, { province: 8, type: 'hire', company: 'bombard' }).ok, false);
  const base = musterCost('siege', 100, s, 'aldmere');
  s.houses.aldmere.tech.researched.push('drill_yards', 'smithing', 'siegecraft', 'fortification', 'black_powder');
  assert.ok(musterCost('siege', 100, s, 'aldmere') < base);
  assert.ok(!hireOptions(s, 8).find(o => o.type === 'bombard').locked);
  s.provinces[8].gold = 1000;
  assert.equal(applyOrder(s, { province: 8, type: 'hire', company: 'bombard' }).ok, true);
});

test('study order adds research; Military techs reach battle units', () => {
  const s = newGame('aldmere', 1);
  const r = applyOrder(s, { province: 8, type: 'study', branch: 'military' });
  assert.ok(r.ok && r.points >= 6);
  assert.ok(s.houses.aldmere.tech.progress.drill_yards >= 6);
  s.houses.aldmere.tech.researched.push('drill_yards', 'smithing', 'fortification');
  const u = s.provinces[8].units.find(x => x.leader === 'aldmere_1');
  assert.ok(applyOrder(s, { province: 9, type: 'march', to: 4, units: [s.provinces[9].units[0].uid], vassals: [s.provinces[9].units[0].leader], food: 0 }).ok);
  const input = buildBattleInput(s, s.marches[0]);
  assert.ok(input.attacker.units.every(x => x.kind !== 'troop' || x.atkBonus === 1.12));
  void u;
  // atkBonus / defBonus are honoured by the battle rules.
  const mk = (atkBonus, defBonus) => createBattle({ terrain: 'plains', siege: false,
    attacker: { units: [{ id: 'a', kind: 'troop', type: 'footmen', soldiers: 200, training: 50, leader: null, atkBonus }] },
    defender: { units: [{ id: 'd', kind: 'troop', type: 'footmen', soldiers: 200, training: 50, leader: null, defBonus }] } }, 3);
  const b1 = mk(1, 1), b2 = mk(1.2, 1), b3 = mk(1, 1.5);
  const k = b => expectedKills(b, b.units[0], b.units[1]);
  assert.ok(k(b2) > k(b1) * 1.15 && k(b3) < k(b1) * 0.7);
});

test('research ticks from markets each month', async () => {
  const s = newGame('isolde', 2);
  s.autoPlayer = true;
  assert.ok(researchPoints(s, 'isolde') > 0);
  for (let i = 0; i < 24; i++) { await endMonth(s, { autoResolve: win('defender') }); s.pendingEvents = []; }
  assert.ok(Object.values(s.houses).some(h => h.tech.researched.length > 0), 'someone learned something in two years');
});

// ---------- shard charge ----------
test('shard charge: gain follows average loyalty; none below the floor', () => {
  const s = newGame('aldmere', 1);
  for (const p of ownedProvinces(s, 'aldmere')) p.loyalty = 75;
  assert.equal(averageLoyalty(s, 'aldmere'), 75);
  assert.equal(chargeGain(s, 'aldmere'), 20);
  for (const p of ownedProvinces(s, 'aldmere')) p.loyalty = 30;
  assert.equal(chargeGain(s, 'aldmere'), 0);
  for (const p of ownedProvinces(s, 'aldmere')) p.loyalty = 55;
  setCharge(s, 'aldmere', 'tide', 40);
  chargeTick(s);
  assert.equal(shardCharge(s, 'aldmere', 'tide'), 50);
  s.houses.aldmere.tech.researched.push('attunement');
  assert.equal(chargeGain(s, 'aldmere'), 15, 'Attunement: +50%');
});

test('no summon without a full charge; marchOptions explains why', () => {
  const s = newGame('aldmere', 1);
  assert.equal(availableSpirit(s, 'aldmere'), 'tide');
  setCharge(s, 'aldmere', 'tide', 60);
  assert.equal(availableSpirit(s, 'aldmere'), null);
  const mo = marchOptions(s, 8);
  assert.ok(!mo.fifth.some(f => f.kind === 'spirit'));
  assert.match(mo.spirits[0].reason, /Recharging: 60\/100/);
  const u = s.provinces[8].units.find(x => x.leader === 'aldmere_1');
  const r = applyOrder(s, { province: 8, type: 'march', to: 13, units: [u.uid], vassals: ['aldmere_1'], fifth: 'spirit', food: 0 });
  assert.equal(r.ok, false);
  // The defender's spirit is only fielded when charged.
  const s2 = newGame('corvane', 1);
  setCharge(s2, 'aldmere', 'tide', 10);
  s2.provinces[8].company = null;
  const m = { house: 'corvane', from: 3, to: 8, units: [], vassals: ['corvane_2'], fifth: null, food: 0 };
  assert.ok(!buildBattleInput(s2, m).defender.units.some(x => x.kind === 'spirit'));
  setCharge(s2, 'aldmere', 'tide', 100);
  assert.ok(buildBattleInput(s2, m).defender.units.some(x => x.kind === 'spirit'));
});

test('a summon spends the charge even in defeat; a captured shard starts empty', () => {
  const s = newGame('aldmere', 1);
  const u = s.provinces[8].units.find(x => x.leader === 'aldmere_1');
  applyOrder(s, { province: 8, type: 'march', to: 13, units: [u.uid], vassals: ['aldmere_1'], fifth: 'spirit', food: 0 });
  const m = s.marches.pop();
  const input = buildBattleInput(s, m);
  applyBattleResult(s, m, input, win('defender')(input));
  assert.equal(shardCharge(s, 'aldmere', 'tide'), 0);
  // Capture Aldford's shard.
  const s2 = newGame('corvane', 1);
  const m2 = { house: 'corvane', from: 3, to: 8, units: [], vassals: ['corvane_2'], fifth: null, food: 0 };
  s2.vassals.corvane_2.marching = true; s2.vassals.corvane_2.location = null;
  s2.provinces[3].vassals = s2.provinces[3].vassals.filter(x => x !== 'corvane_2');
  const in2 = buildBattleInput(s2, m2);
  applyBattleResult(s2, m2, in2, win('attacker')(in2));
  assert.equal(s2.provinces[8].owner, 'corvane');
  assert.equal(shardCharge(s2, 'corvane', 'tide'), 0);
  assert.equal(shardStatus(s2, 'corvane').find(x => x.id === 'tide').ready, false);
});

// ---------- scenarios ----------
test('every scenario starts valid', () => {
  for (const sc of SCENARIOS) {
    for (const house of ['aldmere', 'corvane', 'vey']) {
      const s = newGame(house, 7, sc.id);
      assert.equal(s.scenario, sc.id);
      assert.equal(s.year, sc.year);
      for (const p of s.provinces) {
        assert.ok(p.units.length <= MAX_UNITS_PER_PROVINCE, `${sc.id}: ${p.id} units`);
        assert.ok(p.vassals.length <= MAX_VASSALS_PER_PROVINCE, `${sc.id}: ${p.id} vassals`);
        if (p.owner) assert.deepEqual(p.militia, []);
        for (const id of p.vassals) assert.equal(s.vassals[id].house, p.owner, `${sc.id}: ${id} in ${p.id}`);
      }
      for (const [id, h] of Object.entries(s.houses)) {
        assert.equal(s.provinces[h.capital].owner, id, `${sc.id}: capital of ${id}`);
        for (const t of h.tech.researched) assert.ok(TECHS.some(x => x.id === t));
      }
      JSON.parse(JSON.stringify(s));
    }
  }
  assert.equal(ownedProvinces(newGame('aldmere', 1, 'raven'), 'corvane').length, 7);
  assert.equal(newGame('aldmere', 1, 'lastshard').provinces.filter(p => !p.owner).length, 0);
  assert.ok(newGame('aldmere', 1, 'crowns').marriages.length >= 6);
});

// ---------- wanderers and heirs ----------
test('wanderers: invite by diplomacy from a neighbouring province', () => {
  const s = newGame('aldmere', 1);
  // Wanderers stand in Lanterncross (13), next to Aldford (8).
  const near = wanderersNear(s, 8);
  assert.ok(near.length >= 2);
  assert.ok(near.every(w => w.status === 'wandering' && w.house === null));
  s.provinces[8].gold = 5000;
  // Retry until one accepts (deterministic RNG; each refusal raises the next chance).
  let joined = null;
  for (let i = 0; i < 12 && !joined; i++) {
    s.provinces[8].ordered = false;
    const w = wanderersNear(s, 8)[0];
    const r = applyOrder(s, { province: 8, type: 'diplomacy', kind: 'wanderer', vassal: w.id });
    assert.ok(r.ok, r.msg);
    if (r.success) joined = w.id;
  }
  assert.ok(joined, 'a wanderer joins eventually');
  const v = s.vassals[joined];
  assert.equal(v.house, 'aldmere'); assert.equal(v.status, 'active'); assert.equal(v.location, 8);
  assert.ok(s.provinces[8].vassals.includes(joined));
  // Too far away: Frosthelm (0) is not next to Aldford.
  const far = Object.values(s.vassals).find(x => x.status === 'wandering' && x.location === 0);
  s.provinces[8].ordered = false;
  assert.equal(applyOrder(s, { province: 8, type: 'diplomacy', kind: 'wanderer', vassal: far.id }).ok, false);
});

test('heirs come of age and join their house', async () => {
  const s = newGame('isolde', 4);
  s.autoPlayer = true;
  for (let i = 0; i < 37; i++) { await endMonth(s, { autoResolve: win('defender') }); s.pendingEvents = []; }
  const heir = s.vassals.heir_isolde;   // comes of age after 3 years
  assert.notEqual(heir.status, 'future');
  if (s.houses.isolde.alive) assert.equal(heir.status === 'active' || heir.status === 'captive', true);
});

await done('realm-content');
void makeRng; void monthlyTick; void listOrders;
