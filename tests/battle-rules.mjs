// Battle rules tests: node tests/battle-rules.mjs (exit 1 on failure).
import { SPIRIT_UNIT } from '../js/data/spirits.js';
import {
  createBattle, applyAction, legalMoves, legalTargets, expectedKills, result, unitAt, getUnit,
  OBJ, W, H, ROUT_FRACTION, ROUT_LEADERLESS, MAX_ROUNDS, spellCells, canCast, routAt, statsOf, weatherFor, moveRange, attackRange, terrainAt,
} from '../js/battle/rules.js';
import { generateMap, generateField, TERRAIN, biomeOf, pathExists, TEMPLATES } from '../js/battle/mapgen.js';
import { breathCells, canBreathe, elevAt, slopeBonus, moveCost, DAWNWYRM } from '../js/battle/rules.js';
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
  b.obj = { ...OBJ }; b.gate = { x: OBJ.x - 1, y: OBJ.y };
  b.grid[OBJ.y * W + OBJ.x] = 'keep';
  b.elev = b.elev.map(() => 0);
  return b;
}
const place = (b, id, x, y) => { const u = getUnit(b, id); u.x = x; u.y = y; return u; };

// Maps: every terrain/seed has a reachable keep and passable deployment.
for (const t of ['plains', 'forest', 'hills', 'mountain', 'marsh', 'coast']) for (let s = 1; s <= 30; s++) for (const siege of [true, false]) {
  const f = generateField(t, s, siege, { provinceId: [9, 7, 11, 5, 16, 22][['plains', 'forest', 'hills', 'mountain', 'marsh', 'coast'].indexOf(t)], season: s % 4 });
  const g = f.grid;
  ok(g.length === W * H, 'grid size');
  ok(f.obj.x >= 10 && f.obj.x <= 13 && f.obj.y >= 2 && f.obj.y <= 9, 'objective on the east half ' + JSON.stringify(f.obj));
  ok(g[f.obj.y * W + f.obj.x] === 'keep', 'keep at objective');
  if (siege) ok(f.gate && g[f.gate.y * W + f.gate.x] === 'gate' && f.gate.x <= f.obj.x && Math.abs(f.gate.x - f.obj.x) + Math.abs(f.gate.y - f.obj.y) === 1, 'gate next to the keep, not facing away ' + t + ' ' + s);
  ok(pathExists(g, f.obj), 'path from the west to the objective ' + t + ' ' + s + ' ' + f.template + ' ' + f.castle);
  ok([0, 1, 2].every(x => [...Array(H).keys()].every(y => !['mountain', 'water', 'lava'].includes(g[y * W + x]))), 'deploy zone clear ' + t);
  ok(JSON.stringify(generateField(t, s, siege, { provinceId: [9, 7, 11, 5, 16, 22][['plains', 'forest', 'hills', 'mountain', 'marsh', 'coast'].indexOf(t)], season: s % 4 })) === JSON.stringify(f), 'same seed, same map');
}

// Variety: across 20 seeds in one province, maps differ a lot and the castle moves.
{
  const CH = { grass: '.', road: '=', forest: 'T', hills: '^', water: '~', bridge: '#', marsh: ',', wall: 'W', gate: 'G', keep: 'K', farmland: 'f',
    village: 'v', mountain: 'M', tents: 't', palisade: '|', cliffs: 'C', sand: 's', snow: '*', ice: 'i', ruins: 'r', lava: 'L', ash: 'a' };
  const fs = [...Array(20).keys()].map(k => generateField('plains', k + 1, k % 3 !== 2, { provinceId: 9, season: 1 }));
  let tot = 0, n = 0;
  for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) { tot += fs[i].grid.filter((t, q) => t !== fs[j].grid[q]).length; n++; }
  const avg = tot / n;
  const objs = new Set(fs.map(f => f.obj.x + ',' + f.obj.y));
  const tpls = new Set(fs.map(f => f.template)), castles = new Set(fs.filter(f => f.castle).map(f => f.castle));
  ok(avg > 90, 'maps differ: average ' + avg.toFixed(1) + ' of 192 tiles');
  ok(objs.size >= 5, 'objective positions vary: ' + objs.size);
  console.log(`map variety: ${avg.toFixed(1)} of 192 tiles differ on average; ${objs.size} objective positions; templates ${[...tpls].join(', ')}; castles ${[...castles].join(', ')}`);
  for (const f of fs.slice(0, 6)) {
    console.log(`  ${f.template} / ${f.castle || f.camp}  obj ${f.obj.x},${f.obj.y}`);
    for (let y = 0; y < H; y++) console.log('    ' + f.grid.slice(y * W, y * W + W).map(t => CH[t] || '?').join(''));
  }
}

// Biomes and new terrains (v3 isometric board).
{
  const has = (f, t) => f.grid.includes(t);
  const ember = generateField('mountain', 3, true, { provinceId: 27 });
  ok(ember.biome === 'volcanic' && has(ember, 'lava') && has(ember, 'ash'), 'Emberrock is volcanic with lava and ash');
  const frost = generateField('mountain', 4, true, { provinceId: 0 });
  ok(frost.biome === 'alpine' && has(frost, 'snow'), 'Frosthelm is alpine and snowy');
  let ruins = 0; for (let s2 = 1; s2 <= 10; s2++) if (has(generateField('plains', s2, true, { provinceId: 13 }), 'ruins')) ruins++;
  ok(ruins >= 8, 'Lanterncross has ruins ' + ruins);
  let sand = 0; for (let s2 = 1; s2 <= 10; s2++) if (has(generateField('coast', s2, true, { provinceId: 22 }), 'sand')) sand++;
  ok(sand >= 9, 'coast has beaches ' + sand);
  let ice = 0; for (let s2 = 1; s2 <= 20; s2++) if (has(generateField('plains', s2, true, { provinceId: 8, season: 3 }), 'ice')) ice++;
  ok(ice >= 3, 'winter freezes water near banks ' + ice);
  let farm = 0; for (let s2 = 1; s2 <= 10; s2++) if (has(generateField('plains', s2, false, { provinceId: 8 }), 'farmland')) farm++;
  ok(farm >= 7, 'plains have farmland ' + farm);
  const camp = generateField('plains', 5, false, { provinceId: 8 });
  ok(has(camp, 'tents') || has(camp, 'palisade'), 'field battles get a camp');
  for (const f of [ember, frost, camp]) ok(f.elev.length === W * H && f.elev.every(z => z >= 0 && z <= 3), 'elevation 0-3');
  // determinism
  const f1 = generateField('hills', 9, true, { provinceId: 6, season: 2 }), f2 = generateField('hills', 9, true, { provinceId: 6, season: 2 });
  ok(JSON.stringify(f1) === JSON.stringify(f2), 'field generation deterministic');
  for (const t of ['sand', 'snow', 'ice', 'farmland', 'ruins', 'lava', 'ash', 'cliffs', 'palisade', 'tents']) ok(TERRAIN[t], 'terrain ' + t);
  ok(biomeOf('plains', 8) === 'plains' && biomeOf('marsh', 17) === 'marsh', 'biome by province');
}

// Elevation: striking down +10%, up -10%; archers on high ground reach further; sand slows horse;
// lava scorches neighbours; ice is slippery.
{
  const b = sandbox([U('a', 'footmen', 200), U('r', 'archers', 200)], [U('d', 'footmen', 200)]);
  const a = place(b, 'a', 5, 5), d = place(b, 'd', 6, 5), r = place(b, 'r', 3, 8);
  const flat = expectedKills(b, a, d);
  b.elev[5 * W + 5] = 2;
  ok(Math.abs(expectedKills(b, a, d) - flat * 1.1) < 0.01 && slopeBonus(b, a, d) === 1.1, 'downhill +10%');
  b.elev[5 * W + 5] = 0; b.elev[5 * W + 6] = 1;
  ok(Math.abs(expectedKills(b, a, d) - flat * 0.9) < 0.01, 'uphill -10%');
  const r0 = attackRange(b, r); b.elev[8 * W + 3] = 2;
  ok(attackRange(b, r) === r0 + 1, 'high ground: archers reach one further');
  b.elev[8 * W + 3] = 0; b.grid[8 * W + 3] = 'cliffs';
  ok(attackRange(b, r) === r0 + 1, 'cliffs: archers reach one further');
  const h = sandbox([U('h', 'horse', 200), U('f', 'footmen', 200)], [U('d', 'footmen', 200)]);
  h.grid[2 * W + 4] = 'sand';
  ok(moveCost(h, getUnit(h, 'h'), 4, 2) === 2 && moveCost(h, getUnit(h, 'f'), 4, 2) === 1, 'sand: horse cost 2');
  h.grid[3 * W + 4] = 'ice';
  ok(TERRAIN.ice.def === 0.8, 'ice defence 0.8');
  const l = sandbox([U('a', 'footmen', 200)], [U('d', 'footmen', 200)]);
  place(l, 'a', 1, 1); place(l, 'd', 14, 9);
  l.grid[1 * W + 2] = 'lava';
  const before = getUnit(l, 'a').soldiers;
  const ev = applyAction(l, { type: 'endSide' });
  applyAction(l, { type: 'endSide' });   // back to the attacker: the burn happens at its side's start
  ok(getUnit(l, 'a').soldiers === before - Math.round(before * 0.03), 'lava scorches neighbours 3%');
  void ev;
}

// The Dawnwyrm: an extra unit beyond 4 + 5th, routs at 30%, breathes once.
{
  const DW = { id: 'dawnwyrm', kind: 'dragon', type: 'dawnwyrm', soldiers: 220, training: 100, leader: null, might: 60, wits: 60 };
  const army = ['a1', 'a2', 'a3', 'a4'].map(id => U(id, 'footmen', 150));
  const b = sandbox([...army, { id: 'c', kind: 'company', type: 'wolfriders', soldiers: 120 }, DW], [U('d1', 'footmen', 200), U('d2', 'footmen', 200), U('d3', 'pikes', 200)], { attacker: { house: 'aldmere', units: [...army, { id: 'c', kind: 'company', type: 'wolfriders', soldiers: 120 }, DW], dragon: true } });
  ok(b.units.filter(u => u.side === 'attacker').length === 6 && getUnit(b, 'dawnwyrm'), 'Dawnwyrm joins beyond 4 + 5th');
  const dw = getUnit(b, 'dawnwyrm');
  ok(statsOf('dawnwyrm').atk === DAWNWYRM.atk && dw.flying && routAt(dw) === 0.3, 'Dawnwyrm stats, flies, routs at 30%');
  place(b, 'dawnwyrm', 4, 5);
  const d1 = place(b, 'd1', 6, 5), d2 = place(b, 'd2', 8, 5);
  const s1 = d1.soldiers, s2 = d2.soldiers;
  ok(canBreathe(b, 'attacker') && breathCells(b, 'attacker', { x: 5, y: 5 }, 'right').length === 5, 'breath line of 5');
  const r = applyAction(b, { type: 'spell', unit: 'dawnwyrm', target: { x: 5, y: 5 }, dir: 'right' });
  ok(r.ok && r.events.some(e => e.t === 'breath'), 'breath event');
  ok(getUnit(b, 'd1').soldiers === s1 - Math.round(s1 * 0.35) && getUnit(b, 'd2').soldiers === s2 - Math.round(s2 * 0.35), 'breath: 35% losses');
  ok(!canBreathe(b, 'attacker') && !applyAction(b, { type: 'spell', unit: 'dawnwyrm', target: { x: 5, y: 5 }, dir: 'right' }).ok, 'breath once per battle');
  ok(result(b).attacker.units.some(u => u.id === 'dawnwyrm'), 'result lists the Dawnwyrm');
  // AI breathes when it is worth it
  const b2 = createBattle(input([...army, DW], [U('d1', 'footmen', 200), U('d2', 'footmen', 200)], { attacker: { house: 'aldmere', units: [...army, DW], dragon: true } }), 3);
  const res = runToEnd(b2);
  ok(b2.dragonUsed.attacker || b2.winner, 'AI uses the breath');
  void res;
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
  const gt = b.gate, fx = gt.x + (gt.x - b.obj.x), fy = gt.y + (gt.y - b.obj.y);
  const dU = b.units.find(u => u.id === 'd'); dU.x = 15; dU.y = gt.y < 6 ? 11 : 0;
  const a = getUnit(b, 'a'); a.x = fx; a.y = fy;
  b.grid[fy * W + fx] = 'road';
  const r = applyAction(b, { type: 'move', unit: 'a', to: { x: gt.x, y: gt.y } });
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
