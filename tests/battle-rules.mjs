// Battle rules tests: node tests/battle-rules.mjs (exit 1 on failure).
import { SPIRIT_UNIT } from '../js/data/spirits.js';
import {
  createBattle, applyAction, legalMoves, legalTargets, expectedKills, result, unitAt, getUnit,
  OBJ, W, H, ROUT_FRACTION, ROUT_LEADERLESS, MAX_ROUNDS, spellCells, canCast, routAt, statsOf, weatherFor, moveRange, attackRange, terrainAt,
} from '../js/battle/rules.js';
import { generateMap } from '../js/battle/mapgen.js';
import { runToEnd, autoResolve } from '../js/battle/auto.js';

let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) passes++; else { fails++; console.error('FAIL:', msg); } };
// v2 UnitIn: a led troop (leader = a vassal id) unless extra overrides it.
const U = (id, type, soldiers, extra = {}) => ({ id, kind: 'troop', type, soldiers, training: 50, leader: 'v-' + id, might: 50, wits: 50, ...extra });
const SP = (id, spirit, extra = {}) => ({ id, kind: 'spirit', type: spirit, ...extra });
const input = (a, d, extra = {}) => ({ provinceId: 0, terrain: 'plains', siege: true, attacker: { house: 'aldmere', units: a, spirit: null },
  defender: { house: 'corvane', units: d, spirit: null }, ...extra });
// Put units at chosen squares on an all-grass board.
function sandbox(a, d, extra) {
  const b = createBattle(input(a, d, extra), 1);
  b.grid = b.grid.map(() => 'grass');
  b.grid[OBJ.y * W + OBJ.x] = 'keep';
  return b;
}
const place = (b, id, x, y) => { const u = getUnit(b, id); u.x = x; u.y = y; return u; };

// Maps: every terrain/seed has a reachable keep and passable deployment.
for (const t of ['plains', 'forest', 'hills', 'mountain', 'marsh', 'coast']) for (let s = 1; s <= 30; s++) {
  const g = generateMap(t, s, true);
  ok(g.length === W * H, 'grid size');
  ok(g[OBJ.y * W + OBJ.x] === 'keep', 'keep at objective');
  ok(g[5 * W + 12] === 'gate', 'gate in siege');
  ok([0, 1, 2].every(x => [...Array(H).keys()].every(y => !['mountain', 'water'].includes(g[y * W + x]))), 'deploy zone clear ' + t);
}

// Damage formula matches DESIGN (with tuned divisor) and terrain reduces it.
{
  const b = sandbox([U('a', 'footmen', 200)], [U('d', 'footmen', 200)]);
  const a = place(b, 'a', 5, 5), d = place(b, 'd', 6, 5);
  const k1 = expectedKills(b, a, d);
  b.grid[5 * W + 6] = 'hills';
  const k2 = expectedKills(b, a, d);
  ok(k1 > 20 && k1 < 80, 'kills in sane range ' + k1);
  ok(Math.abs(k2 - k1 / 1.3) < 0.01, 'hills defence 1.3');
  const p = sandbox([U('p', 'pikes', 200)], [U('h', 'horse', 200)]);
  const pk = expectedKills(p, place(p, 'p', 5, 5), place(p, 'h', 6, 5));
  const fk = expectedKills(p, { ...getUnit(p, 'p'), type: 'footmen' }, getUnit(p, 'h'));
  ok(pk > fk, 'pikes bonus vs horse');
}

// Movement: footmen move 3 on grass, enemies block, zone of control stops.
{
  const b = sandbox([U('a', 'footmen', 200)], [U('d', 'footmen', 200)]);
  place(b, 'a', 2, 2); place(b, 'd', 10, 10);
  const m = legalMoves(b, 'a');
  ok(m.every(c => Math.abs(c.x - 2) + Math.abs(c.y - 2) <= 3), 'move range 3');
  ok(m.length === 24 - 0 || m.length > 15, 'many moves on open grass ' + m.length);
  place(b, 'd', 4, 2);
  const m2 = legalMoves(b, 'a');
  ok(!m2.some(c => c.x === 5 && c.y === 2), 'cannot pass through enemy / ZOC');
  ok(!m2.some(c => c.x === 4 && c.y === 2), 'cannot stop on enemy');
}

// Attack: ranged cannot shoot after moving except adjacent; counter-attack happens in melee only.
{
  const b = sandbox([U('a', 'archers', 200)], [U('d', 'footmen', 200)]);
  place(b, 'a', 2, 5); place(b, 'd', 5, 5);
  ok(legalTargets(b, 'a').includes('d'), 'archers range 4');
  applyAction(b, { type: 'move', unit: 'a', to: { x: 2, y: 4 } });
  ok(!legalTargets(b, 'a').includes('d'), 'no shooting after moving');
  const c = sandbox([U('a', 'footmen', 200)], [U('d', 'footmen', 200)]);
  place(c, 'a', 5, 5); place(c, 'd', 6, 5);
  const r = applyAction(c, { type: 'attack', unit: 'a', target: 'd' });
  ok(r.ok && r.events.some(e => e.t === 'hit' && e.counter), 'melee counter-attack');
  ok(getUnit(c, 'a').soldiers < 200 && getUnit(c, 'd').soldiers < 200, 'both lose soldiers');
  const bad = applyAction(c, { type: 'attack', unit: 'a', target: 'd' });
  ok(!bad.ok, 'cannot attack twice');
}

// Routing below the threshold.
{
  const b = sandbox([U('a', 'knights', 400, { might: 100, training: 100 })], [U('d', 'footmen', 100), U('d2', 'footmen', 100)]);
  place(b, 'a', 5, 5); place(b, 'd', 6, 5); place(b, 'd2', 14, 1);
  getUnit(b, 'd').soldiers = Math.ceil(100 * ROUT_FRACTION) + 2;
  applyAction(b, { type: 'attack', unit: 'a', target: 'd' });
  ok(getUnit(b, 'd').out, 'unit routs below threshold');
}

// Keep capture: an attacker on the keep at the end of the round wins.
{
  const b = sandbox([U('a', 'footmen', 200)], [U('d', 'archers', 200)]);
  place(b, 'a', OBJ.x - 1, OBJ.y); place(b, 'd', 1, 11);
  applyAction(b, { type: 'move', unit: 'a', to: { x: OBJ.x, y: OBJ.y } });
  applyAction(b, { type: 'endSide' });
  ok(!b.winner, 'no win before defender acts');
  applyAction(b, { type: 'endSide' });
  ok(b.winner === 'attacker' && b.reason === 'keep taken', 'keep taken');
}

// Defender wins after MAX_ROUNDS.
{
  const b = sandbox([U('a', 'footmen', 200)], [U('d', 'footmen', 200)]);
  place(b, 'a', 0, 0); place(b, 'd', 15, 11);
  for (let i = 0; i < MAX_ROUNDS * 2 && !b.winner; i++) applyAction(b, { type: 'endSide' });
  ok(b.winner === 'defender' && result(b).rounds === MAX_ROUNDS, 'held out after 15 rounds');
}

// Spells.
{
  // The spirit is a unit in the 5th slot; the spell action names it.
  const b = sandbox([U('a', 'footmen', 200), SP('sp', 'ember')], [U('d1', 'footmen', 200), U('d2', 'footmen', 200)]);
  place(b, 'a', 1, 1); place(b, 'sp', 1, 3); place(b, 'd1', 8, 5); place(b, 'd2', 10, 5);
  const spU = getUnit(b, 'sp');
  ok(spU.kind === 'spirit' && spU.soldiers === SPIRIT_UNIT.ember.soldiers && b.spirit.attacker === 'ember' && b.spiritUnit.attacker === 'sp', 'spirit unit from SPIRIT_UNIT');
  ok(!applyAction(b, { type: 'spell', unit: 'a', target: { x: 7, y: 5 }, dir: 'right' }).ok, 'only the spirit casts');
  const r = applyAction(b, { type: 'spell', unit: 'sp', target: { x: 7, y: 5 }, dir: 'right' });
  ok(r.ok && r.events.some(e => e.t === 'spell' && e.caster === 'sp'), 'spell names its caster');
  ok(getUnit(b, 'd1').soldiers === 140 && getUnit(b, 'd2').soldiers === 140, 'ember line 30%');
  ok(!applyAction(b, { type: 'spell', unit: 'sp', target: { x: 7, y: 5 } }).ok, 'spell once');
  ok(legalTargets(b, 'sp').length === 0 && legalMoves(b, 'sp').length > 0, 'spirit still moves and fights after casting');
  const t = sandbox([U('a', 'footmen', 200), SP('sp', 'tide')], [U('d', 'footmen', 200)]);
  place(t, 'a', 1, 1); place(t, 'sp', 1, 3); place(t, 'd', 8, 5);
  applyAction(t, { type: 'spell', unit: 'sp', target: { x: 9, y: 6 } });
  ok(getUnit(t, 'd').slowed === 2, 'tide slows');
  const s = sandbox([U('a', 'footmen', 200), SP('sp', 'stone')], [U('d', 'footmen', 200)]);
  place(s, 'a', 1, 1); place(s, 'sp', 0, 8); place(s, 'd', 12, 10);
  applyAction(s, { type: 'spell', unit: 'sp', target: { x: 4, y: 0 }, dir: 'down' });
  ok(s.tempWalls.length === 5, 'stone wall placed');
  ok(!legalMoves(s, 'a').some(c => c.x === 4 && c.y <= 4), 'wall blocks');
  const g = sandbox([U('a', 'footmen', 200), SP('sp', 'gale')], [U('d1', 'footmen', 300), U('d2', 'footmen', 100), U('d3', 'footmen', 200), U('d4', 'footmen', 50)]);
  ok(spellCells(g, 'attacker', { x: 0, y: 0 }).length === 3, 'gale hits 3');
  ok(getUnit(g, 'sp').flying, 'gale owl flies');
  const d = sandbox([U('a', 'footmen', 200), SP('sp', 'dusk')], [U('d', 'footmen', 200)]);
  place(d, 'a', 1, 1); place(d, 'sp', 1, 3); place(d, 'd', 8, 5);
  applyAction(d, { type: 'spell', unit: 'sp', target: { x: 8, y: 5 } });
  ok(getUnit(d, 'd').confused === 2, 'dusk confuses');
  // A banished spirit cannot cast.
  const x = sandbox([U('a', 'footmen', 200), SP('sp', 'ember')], [U('d', 'knights', 400, { might: 100, training: 100 })]);
  place(x, 'a', 1, 1); place(x, 'sp', 6, 5); place(x, 'd', 7, 5);
  getUnit(x, 'sp').soldiers = 30;   // below 30% of 120
  applyAction(x, { type: 'endSide' });
  applyAction(x, { type: 'attack', unit: 'd', target: 'sp' });
  applyAction(x, { type: 'endSide' });
  ok(getUnit(x, 'sp').out && !canCast(x, 'attacker'), 'banished spirit cannot cast');
  ok(!applyAction(x, { type: 'spell', unit: 'sp', target: { x: 7, y: 5 }, dir: 'right' }).ok, 'no spell from a banished spirit');
}

// v2 army: 4 troop units + the 5th slot; leaders; leaderless units rout at 40%.
{
  const many = [1, 2, 3, 4, 5, 6].map(i => U('a' + i, 'footmen', 100));
  const b = createBattle(input([...many, { id: 'c', kind: 'company', type: 'golem', soldiers: 60 }, SP('sp', 'ember')],
    [U('d', 'footmen', 100)]), 3);
  const att = b.units.filter(u => u.side === 'attacker');
  ok(att.length === 5, '4 units + 5th slot (got ' + att.length + ')');
  ok(att.filter(u => u.kind === 'troop').length === 4 && att.filter(u => u.kind === 'company' || u.kind === 'spirit').length === 1, 'one 5th-slot unit');
  const L = createBattle(input([U('led', 'footmen', 100), U('free', 'footmen', 100, { leader: null, might: 80, wits: 80 })], [U('d', 'footmen', 100)]), 1);
  const led = getUnit(L, 'led'), free = getUnit(L, 'free');
  ok(led.leader === 'v-led' && led.might === 50, 'led unit takes leader stats');
  ok(free.leader === null && free.might === 0 && free.wits === 0, 'leaderless: might/wits 0');
  ok(routAt(led) === ROUT_FRACTION && routAt(free) === ROUT_LEADERLESS && ROUT_LEADERLESS === 0.4, 'rout thresholds 30% / 40%');
  const k = sandbox([U('a', 'knights', 400, { might: 100, training: 100 })], [U('d', 'footmen', 100, { leader: null }), U('d2', 'footmen', 100)]);
  place(k, 'a', 5, 5); place(k, 'd', 6, 5); place(k, 'd2', 14, 1);
  const dd = getUnit(k, 'd');
  // Make sure the hit leaves it between 30% and 40%: set soldiers so a small hit lands there.
  dd.soldiers = 100; dd.start = 100;
  const kills = Math.round(expectedKills(k, getUnit(k, 'a'), dd));
  ok(kills > 0, 'knights hurt footmen');
  dd.soldiers = 39 + Math.min(kills, 60);
  applyAction(k, { type: 'attack', unit: 'a', target: 'd' });
  ok(dd.soldiers >= 40 || dd.out, 'leaderless unit under 40% routs (soldiers ' + dd.soldiers + ', out ' + dd.out + ')');
  const legacy = createBattle({ terrain: 'plains', siege: false, attacker: { house: 'aldmere', units: [{ id: 'v', kind: 'vassal', vassalId: 'aldmere_1', type: 'knights', soldiers: 100, might: 70 }], spirit: 'tide' },
    defender: { house: null, units: [{ id: 'm', kind: 'militia', type: 'militia', soldiers: 80 }] } }, 1);
  ok(getUnit(legacy, 'v').leader === 'aldmere_1' && getUnit(legacy, 'attacker-spirit')?.kind === 'spirit', 'legacy input: vassal leader and side spirit become v2 units');
  ok(getUnit(legacy, 'm').leader === null && routAt(getUnit(legacy, 'm')) === 0.4, 'militia is leaderless');
  ok(statsOf('stone').def === 24 && statsOf('stone').name === 'Stone Warden', 'spirit stats');
}

// Weather.
{
  ok(weatherFor(3, 'plains') === 'snow' && weatherFor(0, 'hills') === 'rain' && weatherFor(1, 'marsh') === 'fog' && weatherFor(1, 'plains') === null, 'weather table');
  const b = sandbox([U('a', 'footmen', 200)], [U('d', 'archers', 200)], { season: 3, terrain: 'plains' });
  ok(b.weather === 'snow' && moveRange(b, getUnit(b, 'a')) === 2, 'snow slows');
  const f = sandbox([U('a', 'footmen', 200)], [U('d', 'archers', 200)], { season: 1, terrain: 'marsh' });
  ok(attackRange(f, getUnit(f, 'd')) === 3, 'fog shortens range');
}

// Gate breach event.
{
  const b = createBattle(input([U('a', 'footmen', 200)], [U('d', 'archers', 200)]), 2);
  b.units.find(u => u.id === 'd').x = 15; b.units.find(u => u.id === 'd').y = 0;
  const a = getUnit(b, 'a'); a.x = 11; a.y = 5;
  b.grid[5 * W + 11] = 'road';
  const r = applyAction(b, { type: 'move', unit: 'a', to: { x: 12, y: 5 } });
  ok(r.ok && r.events.some(e => e.t === 'gate') && b.gateBreached, 'gate breach event');
}

// Determinism, JSON round-trip, result shape.
{
  const inp = input([U('a1', 'knights', 200), U('a2', 'archers', 150), U('a3', 'siege', 80), SP('as', 'gale')],
    [U('d1', 'pikes', 200), U('d2', 'archers', 150, { leader: null }), SP('ds', 'stone')], { season: 0 });
  const r1 = autoResolve(inp, 42), r2 = autoResolve(inp, 42);
  ok(JSON.stringify(r1) === JSON.stringify(r2), 'deterministic by seed');
  const b = createBattle(inp, 42);
  const copy = JSON.parse(JSON.stringify(b));
  runToEnd(b); runToEnd(copy);
  ok(JSON.stringify(result(b)) === JSON.stringify(result(copy)), 'state survives JSON round-trip');
  ok(['attacker', 'defender'].includes(r1.winner) && r1.attacker.units.length === 4 && r1.defender.units.length === 3, 'result shape (every unit, spirits included)');
  ok(r1.attacker.units.every(u => ['ok', 'routed', 'dead'].includes(u.fate)), 'fates');
  const empty = createBattle(input([U('a', 'footmen', 200)], []), 1);
  ok(empty.winner === 'attacker', 'empty defender loses');
  const ret = createBattle(input([U('a', 'footmen', 200)], [U('d', 'footmen', 100)]), 1);
  applyAction(ret, { type: 'retreat', side: 'attacker' });
  ok(ret.winner === 'defender' && result(ret).attacker.units[0].fate === 'routed', 'retreat');
}

console.log(`battle-rules: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
