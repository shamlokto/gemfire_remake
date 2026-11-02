// Tactical battle rules (pure, node-runnable). See docs/DESIGN.md "Battle contract".
//
// BattleState is plain JSON. applyAction mutates it in place and returns
// { ok, msg?, events[] } where events describe what happened for the view to animate:
//   { t:'move', unit, from:{x,y}, to:{x,y} }
//   { t:'hit', unit (attacker), target, killed, counter?:bool, ranged:bool, rout?:bool }
//   { t:'rout', unit } { t:'spell', side, spirit, caster, cells:[{x,y}], hits:[{unit,killed}] }
//
// v2 army model (docs/DESIGN.md "v2"): each side fields up to 4 troop/militia units plus a 5th
// slot (a company or a summoned spirit unit). Units carry `leader` (vassal id or null); might/wits
// come from the leader (0 when leaderless). Led units rout below ROUT_LED, leaderless below
// ROUT_LEADERLESS. The spirit unit fights like any unit and casts its spell once (the spell action
// names the spirit unit); once it is banished it cannot cast.
//   { t:'heal', unit, amount } { t:'side', side, round } { t:'over', winner, reason }

import { TROOPS, COMPANIES, MILITIA, MAX_UNITS_PER_ARMY, ROUT_LED, ROUT_LEADERLESS } from '../data/units.js';
import { SPIRITS, SPIRIT_UNIT } from '../data/spirits.js';
import { makeRng } from '../rng.js';
import { W, H, OBJ, TERRAIN, generateMap, idx } from './mapgen.js';

export { W, H, OBJ, TERRAIN };
export const MAX_ROUNDS = 15;
export const ROUT_FRACTION = ROUT_LED; // led units rout below 30% of their starting soldiers
export { ROUT_LED, ROUT_LEADERLESS };
// Rout threshold of one unit (fraction of its starting soldiers).
export function routAt(u) { return u.rout ?? (u.leader || u.kind === 'spirit' ? ROUT_LED : ROUT_LEADERLESS); }
const FIFTH = new Set(['company', 'spirit']);
export const DAMAGE_DIV = 6;           // DESIGN.md had 10; tuned so battles finish in 15 rounds
const CAVALRY = new Set(['horse', 'knights', 'wolfriders']);
// Weather from season (0 spring .. 3 winter) and terrain. Rules effects (kept small):
//   snow: ground units move 1 less (min 1);  fog: ranged attacks reach 1 less (min 2);
//   rain: cosmetic only.
export function weatherFor(season, terrain) {
  if (terrain === 'marsh' && season !== 3) return 'fog';
  if (season === 0) return 'rain';
  if (season === 3) return 'snow';
  return null;
}
const DIRS = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };
export const DIR_NAMES = Object.keys(DIRS);

const SPIRIT_STATS = Object.fromEntries(Object.entries(SPIRIT_UNIT).map(([k, v]) =>
  [k, { ...v, name: SPIRITS[k].name, spirit: true }]));
export function statsOf(type) {
  return TROOPS[type] || COMPANIES[type] || SPIRIT_STATS[type] || MILITIA;
}

// Normalise one side's units to the v2 army: at most 4 troop/militia units plus one 5th-slot unit
// (company or spirit). A legacy side-level `spirit` becomes a spirit unit when the 5th is free.
export function armyOf(side, tag) {
  const list = (side.units || []).filter(u => (u.soldiers || 0) > 0 || u.kind === 'spirit');
  const main = list.filter(u => !FIFTH.has(u.kind)).slice(0, MAX_UNITS_PER_ARMY);
  let fifth = list.find(u => FIFTH.has(u.kind)) || null;
  if (!fifth && side.spirit && SPIRIT_UNIT[side.spirit]) fifth = { id: `${tag}-spirit`, kind: 'spirit', type: side.spirit };
  return fifth ? [...main, fifth] : main;
}
export function enemyOf(side) { return side === 'attacker' ? 'defender' : 'attacker'; }

// ---------------------------------------------------------------- creation

export function createBattle(input, seed = 1) {
  const siege = !!input.siege;
  const grid = generateMap(input.terrain || 'plains', seed, siege);
  const b = {
    v: 2, seed, rng: (seed * 2654435761) >>> 0,
    provinceId: input.provinceId ?? null, terrain: input.terrain || 'plains', siege,
    grid, round: 1, side: 'attacker', winner: null, reason: null,
    season: input.season ?? null,
    weather: input.weather !== undefined ? input.weather : weatherFor(input.season, input.terrain || 'plains'),
    gateBreached: false,
    houses: { attacker: input.attacker.house ?? null, defender: input.defender.house ?? null },
    spirit: { attacker: null, defender: null },        // spirit id per side (from its spirit unit)
    spiritUnit: { attacker: null, defender: null },    // that unit's id
    spiritUsed: { attacker: false, defender: false },
    tempWalls: [],          // { x, y, side, until }
    units: [], log: [],
  };
  const mk = (u, side) => {
    const st = statsOf(u.type);
    const spirit = u.kind === 'spirit';
    const soldiers = Math.max(1, Math.round(u.soldiers || (spirit ? SPIRIT_UNIT[u.type]?.soldiers : 0) || 0));
    // Leader: v2 `leader`, or a legacy vassal-kind unit's vassalId.
    const leader = u.leader !== undefined ? (u.leader ?? null) : (u.kind === 'vassal' ? u.vassalId ?? null : null);
    const kind = u.kind === 'vassal' || !u.kind ? 'troop' : u.kind;
    return {
      id: String(u.id), side, kind, leader, vassalId: leader, type: u.type, ruler: !!u.ruler,
      soldiers, start: soldiers,
      training: u.training ?? (spirit ? 60 : 50),
      might: leader ? (u.might ?? 50) : (spirit ? (u.might ?? 40) : 0),
      wits: leader ? (u.wits ?? 50) : (spirit ? (u.wits ?? 60) : 0),
      x: 0, y: 0, moved: false, acted: false, out: null,   // out: null | 'routed' | 'dead' | 'fled'
      slowed: 0, confused: 0,
      flying: !!st.flying, ghost: !!st.ignoresTerrain,
      // Optional realm modifiers (techs, terrain): multiply attack / divide damage taken.
      atkBonus: u.atkBonus > 0 ? u.atkBonus : 1, defBonus: u.defBonus > 0 ? u.defBonus : 1,
    };
  };
  const att = armyOf(input.attacker, 'attacker').map(u => mk(u, 'attacker'));
  const def = armyOf(input.defender, 'defender').map(u => mk(u, 'defender'));
  for (const u of [...att, ...def]) {
    u.rout = routAt(u);
    if (u.kind === 'spirit') { b.spirit[u.side] = u.type; b.spiritUnit[u.side] = u.id; }
  }
  deploy(b, att, def);
  b.units = [...att, ...def];
  addLog(b, `Battle begins: ${att.length} units attack, ${def.length} defend.`);
  if (!att.length) finish(b, 'defender', 'no attackers');
  else if (!def.length) finish(b, 'attacker', 'no defenders');
  else beginSide(b, 'attacker', []);
  return b;
}

function deploy(b, att, def) {
  const taken = new Set();
  const free = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !taken.has(idx(x, y)) &&
    b.grid[idx(x, y)] !== 'mountain' && b.grid[idx(x, y)] !== 'water';
  const place = (u, x, y) => { u.x = x; u.y = y; taken.add(idx(x, y)); };

  // Attackers: strongest in the middle of the west edge, ranged behind.
  const aSpots = [];
  for (let x = 0; x <= 2; x++) for (let y = 0; y < H; y++) aSpots.push({ x, y });
  const aScore = (s, ranged) => Math.abs(s.y - OBJ.y) * 1.2 + (ranged ? Math.abs(s.x - 0) : Math.abs(s.x - 2));
  const sortedA = [...att].sort((p, q) => q.soldiers - p.soldiers);
  for (const u of sortedA) {
    const ranged = statsOf(u.type).range > 1;
    const s = aSpots.filter(s => free(s.x, s.y)).sort((p, q) => aScore(p, ranged) - aScore(q, ranged))[0];
    if (s) place(u, s.x, s.y);
  }

  // Defenders: melee on the keep and gate, ranged on walls, the rest around the keep.
  const core = [{ x: OBJ.x, y: OBJ.y }, { x: OBJ.x - 1, y: OBJ.y }];
  const ring = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const s = { x: OBJ.x + dx, y: OBJ.y + dy };
    if (!core.some(c => c.x === s.x && c.y === s.y)) ring.push(s);
  }
  const outer = [];
  for (let y = 0; y < H; y++) for (let x = 10; x < W; x++) outer.push({ x, y });
  outer.sort((p, q) => (Math.abs(p.x - OBJ.x) + Math.abs(p.y - OBJ.y)) - (Math.abs(q.x - OBJ.x) + Math.abs(q.y - OBJ.y)));
  const melee = def.filter(u => statsOf(u.type).range === 1).sort((p, q) => q.soldiers * statsOf(q.type).def - p.soldiers * statsOf(p.type).def);
  const ranged = def.filter(u => statsOf(u.type).range > 1).sort((p, q) => q.soldiers - p.soldiers);
  const order = [];
  for (const u of melee) order.push([u, [...core, ...ring, ...outer]]);
  for (const u of ranged) order.push([u, [...ring, ...core, ...outer]]);
  for (const [u, spots] of order) {
    const s = spots.find(s => free(s.x, s.y));
    if (s) place(u, s.x, s.y);
  }
}

// ---------------------------------------------------------------- queries

export function unitAt(b, x, y) {
  for (const u of b.units) if (!u.out && u.x === x && u.y === y) return u;
  return null;
}
export function getUnit(b, id) { return b.units.find(u => u.id === id) || null; }
export function liveUnits(b, side) { return b.units.filter(u => !u.out && (!side || u.side === side)); }
export const dist = (a, c) => Math.abs(a.x - c.x) + Math.abs(a.y - c.y);

function tempWallAt(b, x, y) {
  for (const w of b.tempWalls) if (w.x === x && w.y === y) return w;
  return null;
}

export function terrainAt(b, x, y) { return b.grid[idx(x, y)]; }

export function moveCost(b, u, x, y) {
  if (x < 0 || y < 0 || x >= W || y >= H) return Infinity;
  if (u.flying) return 1;
  if (tempWallAt(b, x, y)) return Infinity;
  const t = TERRAIN[b.grid[idx(x, y)]];
  if (t.cost === Infinity) return Infinity;
  return u.ghost ? 1 : t.cost;
}

// Defence multiplier for a unit standing where it stands.
export function terrainDef(b, u, x = u.x, y = u.y) {
  let d = u.flying ? 1 : TERRAIN[b.grid[idx(x, y)]].def;
  for (const w of b.tempWalls) {
    if (w.side === u.side && Math.abs(w.x - x) + Math.abs(w.y - y) === 1) { d *= 1.5; break; }
  }
  return d;
}

// Reachable cells: Map(idx -> cost). Enemies block; entering a cell next to an enemy ends movement
// (zone of control); friendly units can be passed through but not stopped on.
export function reachable(b, u) {
  const range = moveRange(b, u);
  const res = new Map();
  const best = new Float32Array(W * H).fill(Infinity);
  const occ = new Int8Array(W * H);         // 1 friend, 2 enemy
  for (const o of b.units) if (!o.out && o !== u) occ[idx(o.x, o.y)] = o.side === u.side ? 1 : 2;
  const zoc = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (occ[i] === 2) {
    const x = i % W, y = (i / W) | 0;
    if (x > 0) zoc[i - 1] = 1; if (x < W - 1) zoc[i + 1] = 1;
    if (y > 0) zoc[i - W] = 1; if (y < H - 1) zoc[i + W] = 1;
  }
  const start = idx(u.x, u.y);
  best[start] = 0;
  const open = [start];
  while (open.length) {
    // small grid: pick min linearly
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (best[open[k]] < best[open[bi]]) bi = k;
    const i = open[bi]; open[bi] = open[open.length - 1]; open.pop();
    const c = best[i];
    if (occ[i] === 0 && i !== start) res.set(i, c);
    if (i !== start && zoc[i] && !u.flying) continue;
    const x = i % W, y = (i / W) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0), ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (occ[j] === 2) continue;
      const nc = c + moveCost(b, u, nx, ny);
      if (nc > range || nc >= best[j]) continue;
      best[j] = nc; open.push(j);
    }
  }
  return res;
}

export function canMove(b, u) {
  return !u.out && u.side === b.side && !u.moved && !u.acted && !u.slowed && !b.winner;
}
export function canAct(b, u) {
  return !u.out && u.side === b.side && !u.acted && !b.winner;
}

export function legalMoves(b, unitId) {
  const u = typeof unitId === 'object' ? unitId : getUnit(b, unitId);
  if (!u || !canMove(b, u)) return [];
  return [...reachable(b, u).keys()].map(i => ({ x: i % W, y: (i / W) | 0 }));
}

export function moveRange(b, u) {
  const m = statsOf(u.type).move;
  return b.weather === 'snow' && !u.flying ? Math.max(1, m - 1) : m;
}

// attackRange(u) or attackRange(b, u) (the latter applies fog).
export function attackRange(b, u) {
  if (!u) { u = b; b = null; }
  let r = statsOf(u.type).range;
  if (b && b.weather === 'fog' && r > 1) r = Math.max(2, r - 1);
  return u.moved && r > 1 ? 1 : r;
}

export function legalTargets(b, unitId) {
  const u = typeof unitId === 'object' ? unitId : getUnit(b, unitId);
  if (!u || !canAct(b, u)) return [];
  const r = attackRange(b, u);
  return b.units.filter(o => !o.out && o.side !== u.side && dist(o, u) <= r).map(o => o.id);
}

// ---------------------------------------------------------------- damage

export function bonusAgainst(b, att, tgt) {
  const st = statsOf(att.type);
  let bonus = 1;
  const bv = st.bonusVs || {};
  if (bv[tgt.type]) bonus *= bv[tgt.type];
  else if (bv.horse && CAVALRY.has(tgt.type)) bonus *= bv.horse;
  if (bv.wall) {
    const t = b.grid[idx(tgt.x, tgt.y)];
    if (t === 'wall' || t === 'gate' || t === 'keep') bonus *= bv.wall;
  }
  return bonus;
}

// Expected soldiers killed (no randomness). mult scales (counter-attacks use 0.5).
export function expectedKills(b, att, tgt, mult = 1, at = null) {
  const sa = statsOf(att.type), st = statsOf(tgt.type);
  const def = st.def * terrainDef(b, tgt, at ? at.x : tgt.x, at ? at.y : tgt.y) * DAMAGE_DIV;
  const k = att.soldiers * sa.atk * (1 + att.might / 200) * (0.7 + att.training / 333) * bonusAgainst(b, att, tgt) * mult *
    (att.atkBonus || 1) / (def * (tgt.defBonus || 1));
  return Math.min(tgt.soldiers, k);
}

function rollKills(b, rng, att, tgt, mult) {
  const k = expectedKills(b, att, tgt, mult) * (0.85 + rng.next() * 0.3);
  return Math.min(tgt.soldiers, Math.max(1, Math.round(k)));
}

function applyLoss(b, u, killed, events) {
  u.soldiers = Math.max(0, u.soldiers - killed);
  if (u.soldiers === 0) { u.out = 'dead'; events.push({ t: 'rout', unit: u.id, dead: true }); addLog(b, `${label(u)} is destroyed.`); return true; }
  if (u.soldiers < u.start * routAt(u)) {
    u.out = 'routed'; events.push({ t: 'rout', unit: u.id, banished: u.kind === 'spirit' });
    addLog(b, u.kind === 'spirit' ? `${label(u)} is banished!` : `${label(u)} routs!`); return true;
  }
  return false;
}

export function label(u) {
  if (u.kind === 'spirit') return `The ${statsOf(u.type).name}`;
  return `${u.side === 'attacker' ? 'Attacker' : 'Defender'} ${statsOf(u.type).name}`;
}

// ---------------------------------------------------------------- turn flow

function beginSide(b, side, events) {
  b.side = side;
  events.push({ t: 'side', side, round: b.round });
  const rng = makeRng(b.rng);
  for (const u of b.units) {
    if (u.out || u.side !== side) continue;
    u.moved = false; u.acted = false;
    if (u.slowed > 0) { u.moved = true; u.slowed--; }
  }
  // Druids heal adjacent friends (and themselves).
  for (const u of b.units) {
    if (u.out || u.side !== side) continue;
    const heal = statsOf(u.type).heals;
    if (!heal) continue;
    for (const f of b.units) {
      if (f.out || f.side !== side || dist(f, u) > 1 || f.soldiers >= f.start) continue;
      const amt = Math.min(f.start - f.soldiers, Math.round(f.start * heal));
      if (amt > 0) { f.soldiers += amt; events.push({ t: 'heal', unit: f.id, amount: amt }); }
    }
  }
  // Confused units act on their own: stand still or strike a neighbour of their own side.
  for (const u of b.units) {
    if (u.out || u.side !== side || u.confused <= 0) continue;
    u.confused--;
    u.moved = true; u.acted = true;
    const friends = b.units.filter(f => !f.out && f !== u && f.side === side && dist(f, u) === 1);
    if (friends.length && rng.chance(0.5)) {
      const f = friends[Math.floor(rng.next() * friends.length)];
      const k = rollKills(b, rng, u, f, 0.5);
      events.push({ t: 'hit', unit: u.id, target: f.id, killed: k, ranged: false, confused: true });
      addLog(b, `${label(u)}, bewildered, strikes its own ${statsOf(f.type).name} (-${k}).`);
      applyLoss(b, f, k, events);
    }
  }
  b.rng = rng.state;
  checkOver(b, events);
}

function endRound(b, events) {
  // Keep capture: an attacker on the objective square at the end of a full round wins.
  const holder = unitAt(b, OBJ.x, OBJ.y);
  if (holder && holder.side === 'attacker') { finish(b, 'attacker', 'keep taken', events); return; }
  b.tempWalls = b.tempWalls.filter(w => w.until > b.round);
  b.round++;
  if (b.round > MAX_ROUNDS) { finish(b, 'defender', 'held out', events); return; }
  beginSide(b, 'attacker', events);
}

function finish(b, winner, reason, events = []) {
  if (b.winner) return;
  b.winner = winner; b.reason = reason;
  events.push({ t: 'over', winner, reason });
  addLog(b, `${winner === 'attacker' ? 'The attackers' : 'The defenders'} win (${reason}).`);
}

function checkOver(b, events) {
  if (b.winner) return true;
  if (!liveUnits(b, 'attacker').length) { finish(b, 'defender', 'attackers routed', events); return true; }
  if (!liveUnits(b, 'defender').length) { finish(b, 'attacker', 'defenders routed', events); return true; }
  return false;
}

export function isOver(b) { return !!b.winner; }

function addLog(b, text) {
  b.log.push(`R${b.round}: ${text}`);
  if (b.log.length > 80) b.log.splice(0, b.log.length - 80);
}

// ---------------------------------------------------------------- spells

// Cells a spell would cover. dir is one of right/left/down/up (line and wall).
export function spellCells(b, side, target, dir) {
  const sp = SPIRITS[b.spirit[side]];
  if (!sp) return [];
  const cells = [];
  const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  if (sp.shape === 'line' || sp.shape === 'wall') {
    const [dx, dy] = DIRS[dir] || DIRS[side === 'attacker' ? 'right' : 'left'];
    const len = sp.length;
    for (let i = 0; i < len; i++) {
      const x = target.x + dx * i, y = target.y + dy * i;
      if (inb(x, y)) cells.push({ x, y });
    }
  } else if (sp.shape === 'area') {
    for (let dy = -sp.radius; dy <= sp.radius; dy++) for (let dx = -sp.radius; dx <= sp.radius; dx++) {
      const x = target.x + dx, y = target.y + dy;
      if (inb(x, y)) cells.push({ x, y });
    }
  } else if (sp.shape === 'targets') {
    const foes = liveUnits(b, enemyOf(side)).sort((p, q) => q.soldiers - p.soldiers).slice(0, sp.count);
    for (const f of foes) cells.push({ x: f.x, y: f.y });
  }
  return cells;
}

export function spiritOf(b, side) {
  const id = b.spiritUnit && b.spiritUnit[side];
  return id ? getUnit(b, id) : null;
}
export function canCast(b, side) {
  const u = spiritOf(b, side);
  return !b.winner && b.side === side && !!u && !u.out && !b.spiritUsed[side];
}

function castSpell(b, side, target, dir, events) {
  const spiritId = b.spirit[side];
  const sp = SPIRITS[spiritId];
  const cells = spellCells(b, side, target || { x: OBJ.x, y: OBJ.y }, dir);
  const hits = [];
  b.spiritUsed[side] = true;
  addLog(b, `The ${sp.name} answers: ${sp.spell}!`);
  const foeIn = () => {
    const out = [];
    for (const c of cells) { const u = unitAt(b, c.x, c.y); if (u && u.side !== side) out.push(u); }
    return out;
  };
  const evt = { t: 'spell', side, spirit: spiritId, caster: b.spiritUnit[side], cells, hits };
  events.push(evt);
  if (sp.shape === 'wall') {
    for (const c of cells) {
      if (unitAt(b, c.x, c.y)) continue;
      const t = b.grid[idx(c.x, c.y)];
      if (t === 'mountain' || t === 'keep') continue;
      if (tempWallAt(b, c.x, c.y)) continue;
      b.tempWalls.push({ x: c.x, y: c.y, side, until: b.round + sp.duration - 1 });
    }
    return;
  }
  for (const u of foeIn()) {
    if (sp.power) {
      const k = Math.max(1, Math.round(u.soldiers * sp.power));
      hits.push({ unit: u.id, killed: k });
      applyLoss(b, u, k, events);
    } else hits.push({ unit: u.id, killed: 0 });
    if (!u.out && sp.slow) u.slowed = Math.max(u.slowed, sp.slow);
    if (!u.out && sp.confuse) u.confused = Math.max(u.confused, sp.confuse);
  }
  checkOver(b, events);
}

// ---------------------------------------------------------------- actions

export function applyAction(b, a) {
  const events = [];
  if (b.winner) return { ok: false, msg: 'battle is over', events };
  const fail = msg => ({ ok: false, msg, events });
  switch (a.type) {
    case 'move': {
      const u = getUnit(b, a.unit);
      if (!u || !canMove(b, u)) return fail('unit cannot move');
      const r = reachable(b, u);
      if (!r.has(idx(a.to.x, a.to.y))) return fail('not reachable');
      events.push({ t: 'move', unit: u.id, from: { x: u.x, y: u.y }, to: { x: a.to.x, y: a.to.y } });
      u.x = a.to.x; u.y = a.to.y; u.moved = true;
      if (u.side === 'attacker' && b.grid[idx(u.x, u.y)] === 'gate' && !b.gateBreached) {
        b.gateBreached = true;
        events.push({ t: 'gate', unit: u.id });
        addLog(b, 'The gate is breached!');
      }
      return { ok: true, events };
    }
    case 'attack': {
      const u = getUnit(b, a.unit);
      const t = getUnit(b, a.target);
      if (!u || !t || !canAct(b, u)) return fail('unit cannot attack');
      if (!legalTargets(b, u).includes(t.id)) return fail('target out of range');
      const rng = makeRng(b.rng);
      const ranged = dist(u, t) > 1;
      const k = rollKills(b, rng, u, t, 1);
      u.acted = true; u.moved = true;
      const routed = applyLoss(b, t, k, []);
      events.push({ t: 'hit', unit: u.id, target: t.id, killed: k, ranged, rout: routed });
      addLog(b, `${label(u)} hits ${statsOf(t.type).name} for ${k}.`);
      if (routed) events.push({ t: 'rout', unit: t.id, dead: t.out === 'dead' });
      if (!routed && !ranged) {
        const c = rollKills(b, rng, t, u, 0.5);
        const r2 = applyLoss(b, u, c, []);
        events.push({ t: 'hit', unit: t.id, target: u.id, killed: c, ranged: false, counter: true, rout: r2 });
        if (r2) events.push({ t: 'rout', unit: u.id, dead: u.out === 'dead' });
      }
      b.rng = rng.state;
      checkOver(b, events);
      return { ok: true, events };
    }
    case 'wait': {
      const u = getUnit(b, a.unit);
      if (!u || u.side !== b.side || u.out) return fail('not your unit');
      u.acted = true; u.moved = true;
      return { ok: true, events };
    }
    case 'spell': {
      // { type:'spell', unit: spiritUnitId, target, dir } (legacy: { side } instead of unit).
      const caster = a.unit ? getUnit(b, a.unit) : null;
      const side = caster ? caster.side : a.side;
      if (a.unit && (!caster || caster.kind !== 'spirit')) return fail('not a spirit');
      if (!canCast(b, side)) return fail('spirit unavailable');
      castSpell(b, side, a.target, a.dir, events);
      return { ok: true, events };
    }
    case 'endSide': {
      if (b.side === 'attacker') beginSide(b, 'defender', events);
      else endRound(b, events);
      return { ok: true, events };
    }
    case 'retreat': {
      const side = a.side || b.side;
      for (const u of liveUnits(b, side)) u.out = 'fled';
      finish(b, enemyOf(side), side === 'attacker' ? 'attackers withdrew' : 'defenders fled', events);
      return { ok: true, events };
    }
    default: return fail('unknown action');
  }
}

// True when no unit of the side to act can still do anything (UI uses it to auto-end).
export function sideDone(b) {
  return liveUnits(b, b.side).every(u => u.acted || (u.moved && !legalTargets(b, u).length) ||
    (u.slowed && !legalTargets(b, u).length));
}

// ---------------------------------------------------------------- result

export function result(b) {
  const pack = side => ({
    units: b.units.filter(u => u.side === side).map(u => ({
      id: u.id, soldiers: u.out === 'dead' ? 0 : u.soldiers,
      fate: u.out === 'dead' ? 'dead' : (u.out === 'routed' || u.out === 'fled') ? 'routed' : 'ok',
    })),
    spiritUsed: !!b.spiritUsed[side],
  });
  return { winner: b.winner || 'defender', reason: b.reason, rounds: Math.min(b.round, MAX_ROUNDS), attacker: pack('attacker'), defender: pack('defender') };
}
