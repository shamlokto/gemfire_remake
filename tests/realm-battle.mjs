import assert from 'node:assert/strict';
import { test, done } from './_harness.mjs';
import { newGame, shardsOf } from '../js/realm/state.js';
import { applyOrder } from '../js/realm/orders.js';
import { buildBattleInput, applyBattleResult, endMonth, checkVictory } from '../js/realm/turn.js';
import { VICTORY_PROVINCES } from '../js/data/world.js';
import { MAX_UNITS_PER_ARMY } from '../js/data/units.js';

const win = side => (input) => ({
  winner: side, rounds: 5,
  attacker: { units: input.attacker.units.map(u => ({ id: u.id, soldiers: side === 'attacker' ? u.soldiers : Math.floor(u.soldiers / 2), fate: 'ok' })), spiritUsed: input.attacker.units.some(u => u.kind === 'spirit') },
  defender: { units: input.defender.units.map(u => ({ id: u.id, soldiers: side === 'defender' ? u.soldiers : 0, fate: side === 'defender' ? 'ok' : 'routed' })), spiritUsed: false },
});

// Detach a vassal and their unit from their province into a march object (as applyOrder would).
function manualMarch(s, house, from, to, vids, fifth = null) {
  const pr = s.provinces[from];
  const units = pr.units.filter(u => vids.includes(u.leader));
  pr.units = pr.units.filter(u => !units.includes(u));
  for (const id of vids) { pr.vassals = pr.vassals.filter(x => x !== id); s.vassals[id].location = null; s.vassals[id].marching = true; }
  return { house, from, to, units, vassals: vids, fifth, food: 0 };
}

test('battle input: free hold militia units, keep, 4 units + 5th slot', () => {
  const s = newGame('aldmere', 1);
  const m = manualMarch(s, 'aldmere', 8, 13, ['aldmere_1'], { kind: 'spirit', id: 'tide' });
  const inp = buildBattleInput(s, m);
  assert.equal(inp.siege, false);
  assert.ok(inp.defender.units.length >= 1 && inp.defender.units.every(u => u.kind === 'militia' && u.leader === null && u.might === 0));
  const sp = inp.attacker.units.find(u => u.kind === 'spirit');
  assert.ok(sp && sp.type === 'tide' && sp.soldiers > 0);
  const tr = inp.attacker.units.find(u => u.kind === 'troop');
  assert.deepEqual([tr.leader, tr.might], ['aldmere_1', s.vassals.aldmere_1.might]);
  // A defending house with 5 units fields its 4 strongest plus its spirit.
  const s2 = newGame('aldmere', 1);
  const m2 = manualMarch(s2, 'aldmere', 8, 2, ['aldmere_1']);
  const r = s2.provinces[2];
  while (r.units.length < 6) r.units.push({ uid: 'z' + r.units.length, type: 'footmen', soldiers: 30, training: 20, leader: null });
  const inp2 = buildBattleInput(s2, m2);
  assert.equal(inp2.siege, true);
  assert.equal(inp2.defender.units.filter(u => u.kind === 'troop').length, MAX_UNITS_PER_ARMY);
  assert.ok(inp2.defender.units.some(u => u.kind === 'spirit' && u.type === 'dusk'));
  assert.ok(!inp2.defender.units.some(u => u.id.startsWith('z')), 'the weak units wait');
});

test('attacker wins a free hold: province, units and vassals move; spirit is spent', async () => {
  const s = newGame('aldmere', 1);
  const u = s.provinces[8].units.find(x => x.leader === 'aldmere_1');
  assert.ok(applyOrder(s, { province: 8, type: 'march', to: 13, units: [u.uid], vassals: ['aldmere_1'], fifth: 'spirit', food: 30 }).ok);
  const sum = await endMonth(s, { resolveBattle: win('attacker'), autoResolve: win('defender') });
  assert.equal(s.provinces[13].owner, 'aldmere');
  assert.equal(s.vassals.aldmere_1.location, 13);
  assert.ok(s.provinces[13].units.some(x => x.uid === u.uid && x.leader === 'aldmere_1'));
  assert.deepEqual(s.provinces[13].militia, []);
  assert.ok(sum.battles.some(b => b.march.to === 13));
  assert.notEqual(s.houses.aldmere.spiritUsed.tide, undefined);
});

test('defender wins: attackers return home with their surviving units', async () => {
  const s = newGame('aldmere', 1);
  const u = s.provinces[8].units.find(x => x.leader === 'aldmere_1');
  const n0 = u.soldiers;
  applyOrder(s, { province: 8, type: 'march', to: 13, units: [u.uid], vassals: ['aldmere_1'], food: 0 });
  await endMonth(s, { resolveBattle: win('defender'), autoResolve: win('defender') });
  assert.notEqual(s.provinces[13].owner, 'aldmere');
  assert.equal(s.vassals.aldmere_1.location, 8);
  const back = s.provinces[8].units.find(x => x.uid === u.uid);
  assert.ok(back && back.soldiers < n0 && back.leader === 'aldmere_1');
});

test('defenders retreat with their units; extra units fall back too', () => {
  const s = newGame('aldmere', 1);
  const m = manualMarch(s, 'aldmere', 8, 9, ['aldmere_1']);
  // Kingsrest (9) is Aldmere's; make it Corvane's for this test, with Coldmere (4) as its retreat.
  s.provinces[9].owner = 'corvane'; s.provinces[4].owner = 'corvane';
  for (const id of s.provinces[9].vassals) s.vassals[id].house = 'corvane';
  const before = s.provinces[9].units.length;
  const input = buildBattleInput(s, m);
  const res = win('attacker')(input);
  for (const u of res.defender.units) u.soldiers = 40;   // everyone survives a little
  applyBattleResult(s, m, input, res);
  assert.equal(s.provinces[9].owner, 'aldmere');
  const fled = s.provinces[4].units.length;
  assert.ok(fled >= 1 && fled <= before, `fled ${fled}`);
  for (const u of s.provinces[4].units) if (u.leader) assert.equal(s.vassals[u.leader].location, 4);
});

test('unitless vassals on the losing side can be captured', () => {
  let captured = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const s = newGame('aldmere', seed);
    const m = manualMarch(s, 'aldmere', 8, 13, ['aldmere_1', 'aldmere_4']);
    for (const u of m.units) if (u.leader === 'aldmere_4') m.units.splice(m.units.indexOf(u), 1);  // aldmere_4 rides alone
    s.provinces[13].owner = 'vey';
    const input = buildBattleInput(s, m);
    const res = win('defender')(input);
    for (const u of res.attacker.units) u.soldiers = 50;
    applyBattleResult(s, m, input, res);
    if (s.vassals.aldmere_4.status === 'captive') captured++;
    assert.equal(s.vassals.aldmere_1.status, 'active', 'a vassal with a surviving unit retreats');
  }
  assert.ok(captured > 3 && captured < 25, `captured ${captured}/30`);
});

test('taking a capital takes the shard; last province eliminates the house', () => {
  const s = newGame('aldmere', 1);
  // Corvane keeps only Ravenscar (2).
  s.provinces[3].owner = 'aldmere';
  const m = manualMarch(s, 'aldmere', 8, 2, ['aldmere_1']);
  m.from = 3;
  for (const id of s.provinces[3].vassals) { s.vassals[id].status = 'exiled'; s.vassals[id].location = null; }
  s.provinces[3].vassals = []; s.provinces[3].units = [];
  const input = buildBattleInput(s, m);
  applyBattleResult(s, m, input, win('attacker')(input));
  assert.equal(s.provinces[2].owner, 'aldmere');
  assert.deepEqual(shardsOf(s, 'aldmere').sort(), ['dusk', 'tide']);
  assert.equal(s.houses.corvane.alive, false);
  assert.ok(Object.values(s.vassals).filter(v => v.house === 'corvane' && v.status === 'captive').every(v => v.captor === 'aldmere'));
});

test('captured ruler: succession', () => {
  const s = newGame('aldmere', 1);
  // Corvane's queen in Ravenscar with nowhere to run: Greywatch belongs to Vey; Skerry is a free hold.
  s.provinces[3].owner = 'vey';
  for (const id of s.provinces[3].vassals) s.vassals[id].house = 'vey';
  s.vassals.corvane_0.loyalty = 100;
  // Give Corvane one far province so it survives and needs an heir.
  s.provinces[26].owner = 'corvane';
  const m = manualMarch(s, 'aldmere', 8, 2, ['aldmere_1']);
  const input = buildBattleInput(s, m);
  const res = win('attacker')(input);
  applyBattleResult(s, m, input, res);
  assert.equal(s.vassals.corvane_0.status, 'captive');
  assert.notEqual(s.houses.corvane.ruler, 'corvane_0');
});

test('victory by provinces', () => {
  const s = newGame('aldmere', 1);
  for (let i = 0; i < VICTORY_PROVINCES; i++) s.provinces[i].owner = 'aldmere';
  assert.equal(checkVictory(s), 'aldmere');
  assert.ok(s.pendingEvents.some(e => e.winner === 'aldmere'));
});

test('victory by shards', () => {
  const s = newGame('vey', 1);
  for (const p of s.provinces) if (p.shard) p.owner = 'vey';
  assert.equal(checkVictory(s), 'vey');
});

await done('realm-battle');
