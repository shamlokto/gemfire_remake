import assert from 'node:assert/strict';
import { test, done } from './_harness.mjs';
import { newGame } from '../js/realm/state.js';
import { provinceYield, monthTick, T } from '../js/land/land.js';
import { makeRng } from '../js/rng.js';
import { listOrders, applyOrder, assignLeader, marchOptions, musterOptions, DEVELOP_COST } from '../js/realm/orders.js';

const uidsOf = (s, pid) => s.provinces[pid].units.map(u => u.uid);
const ledBy = (s, pid, vid) => s.provinces[pid].units.find(u => u.leader === vid);

test('listOrders for an owned province', () => {
  const s = newGame('aldmere', 1);
  const l = listOrders(s, 8);
  assert.ok(l.find(o => o.type === 'build' && !o.disabled), 'land games build instead of develop');
  assert.ok(l.find(o => o.type === 'march' && !o.disabled));
  assert.ok(l.find(o => o.type === 'muster' && !o.disabled));
  assert.deepEqual(listOrders(s, 13), []);
});

test('one order per province per month; assign is free', () => {
  const s = newGame('aldmere', 1);
  assert.ok(applyOrder(s, { province: 8, type: 'develop', kind: 'fields' }).ok);
  assert.equal(applyOrder(s, { province: 8, type: 'develop', kind: 'market' }).ok, false);
  assert.ok(listOrders(s, 8).filter(o => o.type !== 'build').every(o => o.disabled));   // building is a free action;
  const free = s.provinces[8].units.find(u => !u.leader);
  const r = applyOrder(s, { province: 8, type: 'assign', unit: free.uid, vassal: 'aldmere_4' });
  assert.ok(r.ok, r.msg);
  assert.equal(free.leader, 'aldmere_4');
  assert.equal(s.provinces[8].units.filter(u => u.leader === 'aldmere_4').length, 1, 'left the old unit');
});

test('assignLeader validation', () => {
  const s = newGame('aldmere', 1);
  const u = s.provinces[8].units[0];
  assert.equal(assignLeader(s, 8, u.uid, 'aldmere_2').ok, false, 'aldmere_2 is in Kingsrest');
  assert.equal(assignLeader(s, 8, 'nope', 'aldmere_1').ok, false);
  assert.ok(assignLeader(s, 8, u.uid, null).ok);
  assert.equal(u.leader, null);
});

test('build: a farm on the land costs gold, takes months, then raises the harvest', () => {
  const s = newGame('aldmere', 1);
  const pr = s.provinces[8], land = s.land[8];
  pr.gold = 500;
  const i = land.t.findIndex((t, k) => (t === T.FERTILE || t === T.PLAIN) && !land.b[k]);
  assert.ok(i >= 0);
  const x = i % land.w, y = (i / land.w) | 0;
  const before = provinceYield(land).food, g = pr.gold;
  const r = applyOrder(s, { province: 8, type: 'build', x, y, kind: 'farm' });
  assert.ok(r.ok, r.msg);
  assert.equal(pr.gold, g - r.cost);
  assert.ok(land.c[i] > 0, 'under construction');
  assert.equal(applyOrder(s, { province: 8, type: 'build', x, y, kind: 'farm' }).ok, false, 'one order a month');
  for (let k = 0; k < 4; k++) monthTick(land, makeRng(k));
  assert.ok(provinceYield(land).food > before, 'the new farm feeds people');
  assert.equal(applyOrder(s, { province: 9, type: 'build', x: 0, y: 0, kind: 'nope' }).ok, false);
  // old-style develop maps onto the land
  s.provinces[9].gold = 500;
  assert.ok(applyOrder(s, { province: 9, type: 'develop', kind: 'fields' }).ok);
});

test('muster tops up a unit or raises a new one, within caps', () => {
  const s = newGame('aldmere', 1);
  const pr = s.provinces[8];
  pr.gold = 5000;
  const u = ledBy(s, 8, 'aldmere_4');
  let r = applyOrder(s, { province: 8, type: 'muster', unit: u.uid, soldiers: 9999 });
  assert.ok(r.ok, r.msg);
  assert.equal(u.soldiers, 500);
  const s2 = newGame('aldmere', 1);
  s2.provinces[8].gold = 5000;
  const n0 = s2.provinces[8].units.length;
  r = applyOrder(s2, { province: 8, type: 'muster', troop: 'archers', soldiers: 120 });
  assert.ok(r.ok, r.msg);
  assert.equal(s2.provinces[8].units.length, n0 + 1);
  const nu = s2.provinces[8].units.find(x => x.uid === r.unit);
  assert.deepEqual([nu.type, nu.soldiers, nu.leader], ['archers', 120, null]);
  // Unit cap.
  const s3 = newGame('aldmere', 1);
  while (s3.provinces[8].units.length < 8) s3.provinces[8].units.push({ uid: 'x' + s3.provinces[8].units.length, type: 'footmen', soldiers: 500, training: 50, leader: null });
  s3.provinces[8].gold = 5000;
  assert.equal(applyOrder(s3, { province: 8, type: 'muster', troop: 'pikes', soldiers: 100 }).ok, false);
  const mo = musterOptions(s, 8);
  assert.ok(mo.types.length >= 6 && mo.canRaise === true);
});

test('muster needs no vassal; diplomacy does', () => {
  const s = newGame('aldmere', 1);
  const pr = s.provinces[9];
  for (const v of [...pr.vassals]) { s.vassals[v].location = 8; s.provinces[8].vassals.push(v); }
  pr.vassals = [];
  for (const u of pr.units) u.leader = null;
  pr.gold = 500;
  assert.ok(applyOrder(s, { province: 9, type: 'muster', troop: 'footmen', soldiers: 50 }).ok);
  s.provinces[9].ordered = false;
  assert.equal(applyOrder(s, { province: 9, type: 'diplomacy', kind: 'truce', target: 'vey' }).ok, false);
});

test('cannot order from a province you do not own or with units from elsewhere', () => {
  const s = newGame('aldmere', 1);
  assert.equal(applyOrder(s, { province: 13, type: 'develop', kind: 'fields' }).ok, false);
  assert.equal(applyOrder(s, { province: 8, type: 'march', to: 9, units: [uidsOf(s, 9)[0]] }).ok, false);
});

test('transfer moves units with their leaders; leaderless units move alone', () => {
  const s = newGame('aldmere', 1);
  const u = ledBy(s, 8, 'aldmere_4');
  const free = s.provinces[8].units.find(x => !x.leader);
  let r = applyOrder(s, { province: 8, type: 'march', to: 9, units: [u.uid, free.uid], food: 10 });
  assert.ok(r.ok, r.msg);
  assert.equal(s.vassals.aldmere_4.location, 9, 'leader goes with the unit');
  assert.ok(uidsOf(s, 9).includes(u.uid) && uidsOf(s, 9).includes(free.uid));
  assert.equal(free.leader, null);
});

test('attack queues a march: needs a vassal, max 4 units, 5th slot', () => {
  const s = newGame('aldmere', 1);
  const pr = s.provinces[8];
  pr.gold = 5000;
  for (let i = 0; i < 2; i++) applyOrder(s, { province: 8, type: 'muster', troop: 'footmen', soldiers: 100 }), pr.ordered = false;
  const all = uidsOf(s, 8);
  assert.ok(all.length >= 5);
  assert.equal(applyOrder(s, { province: 8, type: 'march', to: 13, units: all.slice(0, 5) }).ok, false, 'too many units');
  const unled = pr.units.filter(u => !u.leader).map(u => u.uid).slice(0, 2);
  assert.equal(applyOrder(s, { province: 8, type: 'march', to: 13, units: unled }).ok, false, 'no commander');
  const mo = marchOptions(s, 8);
  assert.ok(mo.targets.attack.includes(13) && mo.targets.transfer.includes(9));
  assert.ok(mo.fifth.some(f => f.kind === 'spirit' && f.id === 'tide'));
  const own = ledBy(s, 8, 'aldmere_1');
  const r = applyOrder(s, { province: 8, type: 'march', to: 13, units: unled, vassals: ['aldmere_1'], fifth: 'spirit', food: 20 });
  assert.ok(r.ok, r.msg);
  const m = s.marches[0];
  assert.equal(m.units.length, 2, 'only the chosen units march');
  assert.equal(own.leader, null, "aldmere_1's old unit stays behind, leaderless");
  assert.deepEqual(m.fifth, { kind: 'spirit', id: 'tide' });
  assert.equal(s.vassals.aldmere_1.location, null);
  assert.ok(s.vassals.aldmere_1.marching);
  assert.ok(!uidsOf(s, 8).some(id => m.units.some(u => u.uid === id)));
  // The same spirit cannot be summoned twice.
  assert.ok(!marchOptions(s, 9).fifth.some(f => f.kind === 'spirit'));
});

test('no attacks on truce partners', () => {
  const s = newGame('aldmere', 1);
  s.truces['aldmere|corvane'] = 99;
  s.provinces[3].owner = 'corvane';
  const u = ledBy(s, 8, 'aldmere_1');
  // Aldford (8) is not next to Greywatch (3); use Thornwood route via ownership shuffle.
  s.provinces[7].owner = 'aldmere';
  s.vassals.aldmere_1.location = 7; s.provinces[8].vassals = s.provinces[8].vassals.filter(x => x !== 'aldmere_1'); s.provinces[7].vassals.push('aldmere_1');
  s.provinces[8].units = s.provinces[8].units.filter(x => x !== u); s.provinces[7].units.push(u);
  assert.equal(applyOrder(s, { province: 7, type: 'march', to: 3, units: [u.uid] }).ok, false);
});

test('hire, govern, supply, spy, disband', () => {
  const s = newGame('isolde', 1);
  assert.ok(applyOrder(s, { province: 21, type: 'hire', company: 'bandits' }).ok);
  assert.equal(s.provinces[21].company.type, 'bandits');
  assert.ok(applyOrder(s, { province: 22, type: 'govern', kind: 'feast' }).ok);
  const s2 = newGame('isolde', 1);
  assert.ok(applyOrder(s2, { province: 21, type: 'supply', to: 22, food: 50, gold: 10 }).ok);
  const s3 = newGame('isolde', 1);
  const r = applyOrder(s3, { province: 21, type: 'spy', target: 10 });
  assert.ok(r.ok && r.report.province === 10 && Array.isArray(r.report.units));
  assert.equal(s3.intel.isolde[10], 0);
  const s4 = newGame('isolde', 1);
  const n = s4.provinces[21].units.length;
  assert.ok(applyOrder(s4, { province: 21, type: 'disband', unit: s4.provinces[21].units.at(-1).uid }).ok);
  assert.equal(s4.provinces[21].units.length, n - 1);
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
  assert.equal(applyOrder(s, { province: 8, type: 'diplomacy', kind: 'bribe', vassal: 'vey_0' }).ok, false);
});

await done('realm-orders');
