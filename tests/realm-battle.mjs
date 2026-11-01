import assert from 'node:assert/strict';
import { test, done } from './_harness.mjs';
import { newGame, ownedProvinces, shardsOf } from '../js/realm/state.js';
import { applyOrder } from '../js/realm/orders.js';
import { buildBattleInput, applyBattleResult, endMonth, checkVictory } from '../js/realm/turn.js';

const win = side => (input) => ({
  winner: side, rounds: 5,
  attacker: { units: input.attacker.units.map(u => ({ id: u.id, soldiers: side === 'attacker' ? u.soldiers : Math.floor(u.soldiers / 2), fate: 'ok' })), spiritUsed: !!input.attacker.spirit },
  defender: { units: input.defender.units.map(u => ({ id: u.id, soldiers: side === 'defender' ? u.soldiers : 0, fate: side === 'defender' ? 'ok' : 'routed' })), spiritUsed: false },
});

test('battle input: free hold has militia, owned province has keep', () => {
  const s = newGame('aldmere', 1);
  const inp = buildBattleInput(s, { house: 'aldmere', from: 8, to: 14, vassals: ['aldmere_1'], company: null, food: 0 });
  assert.equal(inp.siege, false);
  assert.equal(inp.defender.units[0].kind, 'militia');
  assert.equal(inp.attacker.spirit, 'tide');
  const inp2 = buildBattleInput(s, { house: 'aldmere', from: 8, to: 2, vassals: ['aldmere_1'], company: null, food: 0 });
  assert.equal(inp2.siege, true);
  assert.equal(inp2.defender.spirit, 'dusk');   // a house's spirit can defend any of its provinces
  assert.ok(inp2.defender.units.every(u => u.kind === 'vassal'));
});

test('attacker wins a free hold: province and vassals move', async () => {
  const s = newGame('aldmere', 1);
  s.autoPlayer = false;
  assert.ok(applyOrder(s, { province: 8, type: 'march', to: 14, vassals: ['aldmere_1', 'aldmere_4'], food: 30 }).ok);
  // Freeze AI so the test is about this battle only.
  for (const h of Object.keys(s.houses)) if (h !== 'aldmere') s.houses[h].alive = s.houses[h].alive;
  const sum = await endMonth(s, { resolveBattle: win('attacker'), autoResolve: win('defender') });
  assert.equal(s.provinces[14].owner, 'aldmere');
  assert.equal(s.vassals.aldmere_1.location, 14);
  assert.ok(sum.battles.some(b => b.march.to === 14));
  assert.equal(s.houses.aldmere.spiritUsed.tide !== undefined, true);
});

test('defender wins: attackers return home', async () => {
  const s = newGame('aldmere', 1);
  applyOrder(s, { province: 8, type: 'march', to: 14, vassals: ['aldmere_1'], food: 0 });
  await endMonth(s, { resolveBattle: win('defender'), autoResolve: win('defender') });
  assert.notEqual(s.provinces[14].owner, 'aldmere');
  assert.equal(s.vassals.aldmere_1.location, 8);
  assert.equal(s.vassals.aldmere_1.status, 'active');
});

test('taking a capital takes the shard; last province eliminates the house', () => {
  const s = newGame('aldmere', 1);
  // Corvane keeps only Ravenscar.
  s.provinces[2].owner = 'aldmere';
  for (const id of [...s.provinces[2].vassals]) { s.vassals[id].location = 1; s.provinces[1].vassals.push(id); }
  s.provinces[2].vassals = [];
  s.provinces[1].vassals = s.provinces[1].vassals.slice(0, 5);
  for (const v of Object.values(s.vassals)) if (v.house === 'corvane' && !s.provinces[1].vassals.includes(v.id)) { v.status = 'exiled'; v.location = null; }
  const march = { house: 'aldmere', from: 2, to: 1, vassals: ['aldmere_1'], company: null, food: 0 };
  s.vassals.aldmere_1.location = null; s.vassals.aldmere_1.marching = true;
  s.provinces[8].vassals = s.provinces[8].vassals.filter(x => x !== 'aldmere_1');
  const input = buildBattleInput(s, march);
  applyBattleResult(s, march, input, win('attacker')(input));
  assert.equal(s.provinces[1].owner, 'aldmere');
  assert.deepEqual(shardsOf(s, 'aldmere').sort(), ['dusk', 'tide']);
  assert.equal(s.houses.corvane.alive, false);
  assert.ok(Object.values(s.vassals).filter(v => v.house === 'corvane' && v.status === 'captive').every(v => v.captor === 'aldmere'));
});

test('captured ruler: succession', () => {
  const s = newGame('aldmere', 1);
  const march = { house: 'aldmere', from: 8, to: 2, vassals: ['aldmere_1'], company: null, food: 0 };
  // Put Corvane's queen in Greywatch with no room to retreat.
  for (const pid of [1]) { s.provinces[pid].owner = 'vey'; }
  const q = s.vassals.corvane_0;
  s.provinces[1].vassals = s.provinces[1].vassals.filter(x => x !== q.id);
  q.location = 2; s.provinces[2].vassals.push(q.id);
  s.vassals.aldmere_1.location = null; s.provinces[8].vassals = s.provinces[8].vassals.filter(x => x !== 'aldmere_1');
  const input = buildBattleInput(s, march);
  applyBattleResult(s, march, input, win('attacker')(input));
  assert.equal(q.status, 'captive');
  // Corvane has no provinces left (Ravenscar was given to Vey) -> eliminated.
  assert.equal(s.houses.corvane.alive, false);
});

test('victory by provinces', () => {
  const s = newGame('aldmere', 1);
  for (let i = 0; i < 18; i++) s.provinces[i].owner = 'aldmere';
  assert.equal(checkVictory(s), 'aldmere');
  assert.ok(s.pendingEvents.some(e => e.winner === 'aldmere'));
});

test('victory by shards', () => {
  const s = newGame('vey', 1);
  for (const p of s.provinces) if (p.shard) p.owner = 'vey';
  assert.equal(checkVictory(s), 'vey');
});

await done('realm-battle');
