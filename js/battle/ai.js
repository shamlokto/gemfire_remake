// Battle AI (pure). chooseAction(b, side) returns the next action for `side` (always legal).
// Call it repeatedly until it returns { type: 'endSide' }.
//
// Heuristics: cast the spirit when it hits enough; ranged units shoot first and keep distance;
// focus fire on units that will rout; melee units pick a square by attack value, terrain and
// objective (attackers push for the keep, defenders hold the walls and the keep square).

import {
  W, objOf, statsOf, reachable, elevAt, legalTargets, expectedKills, terrainDef, liveUnits, enemyOf,
  dist, getUnit, canCast, spellCells, canBreathe, breathCells, dragonOf, DAWNWYRM, unitAt, routAt, MAX_ROUNDS, DIR_NAMES, terrainAt,
  moveRange, attackRange,
} from './rules.js';
import { SPIRITS } from '../data/spirits.js';

const value = u => statsOf(u.type).atk + statsOf(u.type).def;      // per-soldier worth

function attackScore(b, u, t, from) {
  const k = expectedKills(b, u, t, 1);
  let s = k * value(t);
  const left = t.soldiers - k;
  if (left < t.start * routAt(t)) s += left * value(t) + 40 * value(t);   // finish it
  if (from && dist(from, t) <= 1 && left >= t.start * routAt(t)) {
    // counter-attack (melee only), computed with u's hypothetical soldiers unchanged
    const c = expectedKills(b, { ...t, soldiers: left }, { ...u, x: from.x, y: from.y }, 0.5, from);
    s -= c * value(u) * 0.8;
  }
  if (t.x === objOf(b).x && t.y === objOf(b).y) s *= 1.3;
  return s;
}

function bestTarget(b, u) {
  const ids = legalTargets(b, u);
  let best = null, bs = -Infinity;
  for (const id of ids) {
    const t = getUnit(b, id);
    const s = attackScore(b, u, t, dist(u, t) <= 1 ? u : null);
    if (s > bs) { bs = s; best = t; }
  }
  return best ? { target: best, score: bs } : null;
}

// ---- spells

function spellValue(b, side, cells) {
  const sp = SPIRITS[b.spirit[side]];
  let v = 0;
  for (const c of cells) {
    const u = unitAt(b, c.x, c.y);
    if (!u || u.side === side) continue;
    if (sp.power) v += u.soldiers * sp.power * value(u) / 20;
    if (sp.slow) v += u.soldiers * 0.06 * value(u) / 20 * sp.slow;
    if (sp.confuse) v += u.soldiers * 0.12 * value(u) / 20 * sp.confuse;
  }
  return v;
}

function planSpell(b, side) {
  if (!canCast(b, side)) return null;
  const sp = SPIRITS[b.spirit[side]];
  const foes = liveUnits(b, enemyOf(side));
  const foeTotal = foes.reduce((s, f) => s + f.soldiers, 0);
  if (!foes.length) return null;
  const late = b.round >= MAX_ROUNDS - 2;
  if (sp.shape === 'wall') {
    // Defenders: seal the approach when enemies close in. Attackers: shield ranged units.
    const mine = liveUnits(b, side);
    let best = null, bd = Infinity;
    for (const m of mine) for (const f of foes) {
      const d = dist(m, f);
      if (d >= 2 && d <= 4 && d < bd) { bd = d; best = { m, f }; }
    }
    if (!best) return null;
    const mx = Math.round((best.m.x + best.f.x) / 2), my = Math.round((best.m.y + best.f.y) / 2);
    const vertical = Math.abs(best.m.x - best.f.x) >= Math.abs(best.m.y - best.f.y);
    return { type: 'spell', unit: b.spiritUnit[side], side, target: vertical ? { x: mx, y: Math.max(0, my - 2) } : { x: Math.max(0, mx - 2), y: my },
      dir: vertical ? 'down' : 'right' };
  }
  // Hold area spells until the armies are close (the spirit is worth more in the melee).
  const mine0 = liveUnits(b, side);
  let gap = Infinity;
  for (const m of mine0) for (const f of foes) gap = Math.min(gap, dist(m, f));
  if (gap > 4 && !late) return null;
  let best = null, bv = -1;
  const tryCast = (target, dir) => {
    const v = spellValue(b, side, spellCells(b, side, target, dir));
    if (v > bv) { bv = v; best = { type: 'spell', unit: b.spiritUnit[side], side, target, dir }; }
  };
  if (sp.shape === 'targets') tryCast({ x: 0, y: 0 });
  else for (const f of foes) {
    if (sp.shape === 'line') {
      for (const d of DIR_NAMES) tryCast({ x: f.x, y: f.y }, d);
      // also lines that start before the unit
      tryCast({ x: f.x - 1, y: f.y }, 'right'); tryCast({ x: f.x, y: f.y - 1 }, 'down');
    } else tryCast({ x: f.x, y: f.y });
  }
  const threshold = late ? 1 : Math.max(8, foeTotal * 0.18 * 0.5);
  return bv >= threshold ? best : null;
}

// ---- movement

function cellScore(b, u, x, y, foes, side) {
  const st = statsOf(u.type);
  const at = { x, y };
  let s = 0;
  const ranged = st.range > 1;
  const tdef = terrainDef(b, u, x, y);
  s += (tdef - 1) * 25;
  // Terrain awareness: high ground (archers love it, everyone strikes down better); stay off the
  // squares next to lava.
  if (!u.flying) {
    s += elevAt(b, x, y) * (ranged ? 2 : 1);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (terrainAt(b, x + dx, y + dy) === 'lava') { s -= 18; break; }
  }
  if (side === 'attacker') {
    const dObj = dist(at, objOf(b));
    s -= dObj * (ranged ? 2 : 4) * (1 + b.round / MAX_ROUNDS);
    if (x === objOf(b).x && y === objOf(b).y) s += 120;
  } else {
    const t = terrainAt(b, x, y);
    if (t === 'keep') s += 70; else if (t === 'gate') s += 30; else if (t === 'wall') s += 25;
    s -= dist(at, objOf(b)) * 3;
  }
  // Threat: enemy melee that can reach us next round.
  let nearestFoe = Infinity, threat = 0;
  for (const f of foes) {
    const d = dist(at, f);
    if (d < nearestFoe) nearestFoe = d;
    const fs = statsOf(f.type);
    if (fs.range === 1 && d <= moveRange(b, f) + 1) threat += expectedKills(b, f, { ...u, x, y }, 1, at) / Math.max(1, u.soldiers);
  }
  if (ranged) {
    // Want an enemy in range next turn but not adjacent; fear melee.
    let inRange = false;
    const rr = attackRange(b, { ...u, x, y, moved: false });   // high ground reaches further
    for (const f of foes) if (dist(at, f) <= rr) { inRange = true; break; }
    s += inRange ? 25 : 0;
    s -= threat * 60;
    if (nearestFoe <= 1) s -= 30;
  } else {
    s -= threat * (side === 'attacker' ? 8 : 20);
    if (side === 'attacker' || nearestFoe <= 4) s -= nearestFoe * 1.5;
  }
  return s;
}

function planUnit(b, u) {
  const st = statsOf(u.type);
  const side = u.side;
  const foes = liveUnits(b, enemyOf(side));
  // Already moved (or slowed): attack if possible, else done.
  if (u.moved) {
    const bt = bestTarget(b, u);
    return bt ? { type: 'attack', unit: u.id, target: bt.target.id } : { type: 'wait', unit: u.id };
  }
  // Ranged: shoot from here if anything is in range.
  if (st.range > 1) {
    const bt = bestTarget(b, u);
    const adjacentThreat = foes.some(f => dist(f, u) === 1);
    if (bt && !adjacentThreat) return { type: 'attack', unit: u.id, target: bt.target.id };
  }
  // Defender holding the keep square never leaves it; it strikes adjacent foes.
  if (side === 'defender' && u.x === objOf(b).x && u.y === objOf(b).y) {
    const bt = bestTarget(b, u);
    return bt ? { type: 'attack', unit: u.id, target: bt.target.id } : { type: 'wait', unit: u.id };
  }
  const reach = reachable(b, u);
  const here = { x: u.x, y: u.y };
  let bestCell = here, bs = cellScore(b, u, u.x, u.y, foes, side);
  // Value of attacking from here.
  if (st.range === 1) {
    for (const f of foes) if (dist(f, u) === 1) bs = Math.max(bs, cellScore(b, u, u.x, u.y, foes, side) + attackScore(b, u, f, here) * 0.12);
  }
  for (const [i] of reach) {
    const x = i % W, y = (i / W) | 0;
    let s = cellScore(b, u, x, y, foes, side);
    if (st.range === 1) {
      let ba = 0;
      for (const f of foes) if (Math.abs(f.x - x) + Math.abs(f.y - y) === 1) ba = Math.max(ba, attackScore(b, u, f, { x, y }));
      s += ba * 0.12;
    }
    if (s > bs) { bs = s; bestCell = { x, y }; }
  }
  if (bestCell !== here) return { type: 'move', unit: u.id, to: bestCell };
  const bt = bestTarget(b, u);
  if (bt && (st.range > 1 || bt.score > 0)) return { type: 'attack', unit: u.id, target: bt.target.id };
  return { type: 'wait', unit: u.id };
}

// The Dawnwyrm's breath: the line through enemies that burns the most value; held until it is worth
// a good share of the enemy (or the battle is late).
function planBreath(b, side) {
  if (!canBreathe(b, side)) return null;
  const me = dragonOf(b, side), foes = liveUnits(b, enemyOf(side));
  if (!foes.length) return null;
  let best = null, bv = 0;
  for (const f of foes) for (const d of DIR_NAMES) for (const back of [0, 1, 2]) {
    const [dx, dy] = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] }[d];
    const target = { x: f.x - dx * back, y: f.y - dy * back };
    let v = 0;
    for (const c of breathCells(b, side, target, d)) { const u = unitAt(b, c.x, c.y); if (u && u.side !== side) v += u.soldiers * DAWNWYRM.breath.power * value(u) / 20; if (u && u.side === side) v -= 0; }
    if (v > bv) { bv = v; best = { type: 'spell', unit: me.id, target, dir: d }; }
  }
  const foeTotal = foes.reduce((s, f) => s + f.soldiers, 0);
  return best && (bv >= Math.max(10, foeTotal * 0.12) || b.round >= MAX_ROUNDS - 2) ? best : null;
}

export function chooseAction(b, side = b.side) {
  if (b.winner || b.side !== side) return { type: 'endSide' };
  const br = planBreath(b, side);
  if (br) return br;
  const sp = planSpell(b, side);
  if (sp) return sp;
  // Ranged units first (they shoot before melee blocks lines), then the rest by strength.
  const mine = liveUnits(b, side).filter(u => !u.acted)
    .sort((p, q) => (statsOf(q.type).range > 1) - (statsOf(p.type).range > 1) || q.soldiers - p.soldiers);
  for (const u of mine) {
    if (u.moved && !legalTargets(b, u).length) continue;
    return planUnit(b, u);
  }
  return { type: 'endSide' };
}
