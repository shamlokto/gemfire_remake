// Battlefield generator: a 16 x 12 grid of terrain keys plus a per-tile elevation (0-3), built
// from the province (terrain type and name), the season and a seed. Pure (node-runnable).
//
// Terrain keys: grass road forest hills mountain water marsh bridge village wall gate keep
//   sand (beaches) snow (winter ground) ice (frozen water) farmland ruins lava ash cliffs
//   palisade tents
//
// Every battle gets its own layout:
//   * the objective square (`obj`, the keep centre) sits somewhere on the defender's east half
//     (x 10-13, y 2-9); attackers always deploy on the west columns
//   * a TEMPLATE shapes the whole board: river crossing, lake shore, ridge with a pass, twin hills,
//     forest belt, ravine, open farmland, marsh delta, coastal cliffs, mountain pass, crossroads
//   * sieges get a CASTLE variant around the objective: plain keep, curtain wall with a gatehouse,
//     moat, hill fort, river castle, ruined fort (Lanterncross, Fenwick), island fort (coasts)
//   * field battles get a camp, a hilltop, a village or a ring of standing stones to hold
//   * a road winds from the west edge to the gate (or the camp); villages, trees, boulders and
//     ruins are scattered; elevation comes from smoothed noise with plateaus
// The biome (from the province) still sets the ground: plains, forest, hills, mountain, marsh,
// coast, alpine (Frosthelm, Ironpeak, Cairnholm), volcanic (Emberrock); winter brings snow and ice.
// Every map is checked to have a passable path from the attacker's deployment to the objective.

import { makeRng } from '../rng.js';
import { PROVINCES } from '../data/world.js';

export const W = 16;
export const H = 12;
// Defaults, for saved battles from before maps varied (battle state now carries b.obj / b.gate).
export const OBJ = { x: 13, y: 5 };
export const GATE = { x: 12, y: 5 };

// cost: movement points to enter; def: defence multiplier for a unit standing there.
// horseCost: movement cost for mounted units (if different). high: high ground (ranged +1).
export const TERRAIN = {
  grass:    { name: 'Meadow',    cost: 1, def: 1.0 },
  road:     { name: 'Road',      cost: 1, def: 1.0 },
  forest:   { name: 'Forest',    cost: 2, def: 1.25 },
  hills:    { name: 'Hills',     cost: 2, def: 1.3 },
  village:  { name: 'Village',   cost: 1, def: 1.2 },
  wall:     { name: 'Wall',      cost: 3, def: 1.8 },
  gate:     { name: 'Gate',      cost: 1, def: 1.4 },
  keep:     { name: 'Keep',      cost: 1, def: 1.8 },
  water:    { name: 'River',     cost: 2, def: 0.8 },
  marsh:    { name: 'Marsh',     cost: 2, def: 0.8 },
  bridge:   { name: 'Bridge',    cost: 1, def: 1.0 },
  mountain: { name: 'Mountain',  cost: Infinity, def: 1.5 },
  sand:     { name: 'Beach',     cost: 1, def: 0.95, horseCost: 2 },
  snow:     { name: 'Snowfield', cost: 1.5, def: 1.0 },
  ice:      { name: 'Ice',       cost: 1, def: 0.8 },
  farmland: { name: 'Farmland',  cost: 1, def: 1.0 },
  ruins:    { name: 'Ruins',     cost: 2, def: 1.3 },
  lava:     { name: 'Lava',      cost: Infinity, def: 1.0 },
  ash:      { name: 'Ash',       cost: 1, def: 1.0 },
  cliffs:   { name: 'Cliffs',    cost: 3, def: 1.4, high: true },
  palisade: { name: 'Palisade',  cost: 2, def: 1.4 },
  tents:    { name: 'Camp',      cost: 1, def: 1.1 },
};
// Tiles nobody can stand on (deployment, connectivity).
export const IMPASSABLE = new Set(['mountain', 'lava']);
const CASTLE = new Set(['wall', 'gate', 'keep']);

// Per biome: patch counts, ground, and which templates suit it (weights).
const PROFILE = {
  plains:   { forest: 3, hills: 2, farmland: 5, village: 2,
              templates: { river: 3, lake: 2, open: 4, crossroads: 3, twinhills: 2, forestbelt: 1, ridge: 1 } },
  forest:   { forest: 9, hills: 1, marsh: 1, village: 1,
              templates: { forestbelt: 4, river: 3, lake: 2, ravine: 1, crossroads: 1, twinhills: 1 } },
  hills:    { forest: 2, hills: 6, cliffs: 1, village: 1,
              templates: { ridge: 4, twinhills: 4, ravine: 3, river: 1, pass: 1, open: 1 } },
  mountain: { forest: 1, hills: 5, mountain: 2, cliffs: 2,
              templates: { pass: 4, ravine: 3, ridge: 3, twinhills: 1 } },
  marsh:    { forest: 2, marsh: 8, pools: 3, village: 1,
              templates: { delta: 5, lake: 3, river: 2, forestbelt: 1 } },
  coast:    { forest: 1, hills: 1, farmland: 2, village: 2,
              templates: { coastcliffs: 5, lake: 1, river: 2, crossroads: 1, open: 2 }, sea: true },
  alpine:   { hills: 4, mountain: 2, cliffs: 3, forest: 1, pools: 2,
              templates: { pass: 4, ridge: 3, ravine: 3, lake: 2, twinhills: 1 }, alpine: true },
  volcanic: { hills: 3, mountain: 1, cliffs: 2, lava: 5,
              templates: { ravine: 3, ridge: 2, twinhills: 2, pass: 2 }, sea: true },
};
const ALPINE = new Set(['Frosthelm', 'Ironpeak', 'Cairnholm']);
const RUINED = new Set(['Lanterncross', 'Fenwick']);
export const TEMPLATES = ['river', 'lake', 'ridge', 'twinhills', 'forestbelt', 'ravine', 'open', 'delta', 'coastcliffs', 'pass', 'crossroads'];
export const CASTLES = ['keep', 'curtain', 'moat', 'hillfort', 'rivercastle', 'ruined', 'island'];
export const CAMPS = ['camp', 'hilltop', 'village', 'stones'];

export function biomeOf(terrain, provinceId) {
  const p = provinceId != null ? PROVINCES[provinceId] : null;
  if (p && p.name === 'Emberrock') return 'volcanic';
  if (p && ALPINE.has(p.name)) return 'alpine';
  return PROFILE[terrain] ? terrain : 'plains';
}

export const idx = (x, y) => y * W + x;
const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Back-compatible: the terrain grid only.
export function generateMap(terrain, seed, siege, opts = {}) {
  return generateField(terrain, seed, siege, opts).grid;
}

function weighted(rng, weights) {
  const ent = Object.entries(weights).filter(([, w]) => w > 0);
  let r = rng.next() * ent.reduce((a, [, w]) => a + w, 0);
  for (const [k, w] of ent) { r -= w; if (r <= 0) return k; }
  return ent[ent.length - 1][0];
}

// Smooth value noise over the board (lattice gw x gh), 0..1.
function noiseField(rng, gw, gh) {
  const lat = Array.from({ length: (gw + 1) * (gh + 1) }, () => rng.next());
  const s = t => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / (W - 1) * gw, fy = y / (H - 1) * gh;
    const x0 = Math.min(gw - 1, Math.floor(fx)), y0 = Math.min(gh - 1, Math.floor(fy));
    const tx = s(fx - x0), ty = s(fy - y0);
    const a = lat[y0 * (gw + 1) + x0], b = lat[y0 * (gw + 1) + x0 + 1];
    const c = lat[(y0 + 1) * (gw + 1) + x0], d = lat[(y0 + 1) * (gw + 1) + x0 + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
}

// { grid: [terrain key], elev: [0..3], biome, obj: {x, y}, gate: {x, y} | null, template, castle }
export function generateField(terrain, seed, siege, opts = {}) {
  const rng = makeRng((seed ^ 0x5bd1e995) >>> 0);
  const biome = biomeOf(terrain, opts.provinceId);
  const prov = opts.provinceId != null ? PROVINCES[opts.provinceId] : null;
  const P = PROFILE[biome];
  const winter = opts.season === 3;
  const ground = biome === 'volcanic' ? 'ash' : biome === 'alpine' ? 'snow' : 'grass';
  const g = new Array(W * H).fill(ground);
  const lift = new Array(W * H).fill(0);          // extra elevation from templates (ridges, hill forts)
  const set = (x, y, t) => { if (inside(x, y)) g[idx(x, y)] = t; };
  const get = (x, y) => (inside(x, y) ? g[idx(x, y)] : null);
  const raise = (x, y, z) => { if (inside(x, y)) lift[idx(x, y)] = Math.max(lift[idx(x, y)], z); };

  // ---- objective and layout choices
  // (x 10-13, weighted toward the middle of the defender's half; y 2-9)
  const obj = { x: [10, 10, 11, 11, 12, 13][rng.int(0, 5)], y: rng.int(2, 9) };
  const template = weighted(rng, P.templates);
  let castle = null, camp = null;
  if (siege) {
    if (prov && RUINED.has(prov.name)) castle = rng.chance(0.75) ? 'ruined' : weighted(rng, { keep: 1, curtain: 1 });
    else castle = weighted(rng, {
      keep: 3, curtain: 2, moat: biome === 'volcanic' ? 0 : 2,
      hillfort: ['hills', 'mountain', 'alpine', 'volcanic'].includes(biome) ? 4 : 1,
      rivercastle: ['plains', 'forest', 'marsh'].includes(biome) ? 2 : 0,
      island: P.sea && biome !== 'volcanic' ? 3 : biome === 'marsh' ? 1 : 0,
    });
    // The outer works need room: curtain/moat/island rings sit two squares out.
    if (['curtain', 'moat', 'island'].includes(castle)) { obj.x = Math.min(obj.x, 13); obj.y = Math.max(2, Math.min(9, obj.y)); }
  } else {
    camp = weighted(rng, { camp: 3, hilltop: biome === 'marsh' ? 1 : 3, village: 2, stones: 1 });
  }
  // Gate: in the middle of the west wall; a castle near the top or bottom edge may open on its
  // south or north side instead (always one step from the keep square, never on a corner).
  let gate = null;
  if (siege) {
    gate = { x: obj.x - 1, y: obj.y };
    if (castle !== 'curtain' && castle !== 'moat' && castle !== 'island') {
      if (obj.y <= 3 && rng.chance(0.5)) gate = { x: obj.x, y: obj.y + 1 };
      else if (obj.y >= 8 && rng.chance(0.5)) gate = { x: obj.x, y: obj.y - 1 };
    }
  }
  // The square in front of the gate (outside the walls).
  const gateFront = gate ? { x: gate.x + (gate.x - obj.x), y: gate.y + (gate.y - obj.y) } : null;
  const nearObj = (x, y, r) => Math.max(Math.abs(x - obj.x), Math.abs(y - obj.y)) <= r;
  const reserved = (x, y) => nearObj(x, y, siege ? 3 : 2) || x <= 2;   // templates leave these alone

  // ---- sea edge (coast, volcanic islands)
  let seaTop = null;
  if (P.sea || template === 'coastcliffs') {
    seaTop = obj.y >= 6 ? true : obj.y <= 4 ? false : rng.chance(0.5);
    const depth0 = template === 'coastcliffs' ? 2 : 1;
    for (let x = 0; x < W; x++) {
      const depth = depth0 + (rng.chance(0.4) ? 1 : 0);
      for (let d = 0; d < depth; d++) set(x, seaTop ? d : H - 1 - d, 'water');
      const by = seaTop ? depth : H - 1 - depth;
      if (biome !== 'volcanic' && rng.chance(0.85)) set(x, by, 'sand');
      if (template === 'coastcliffs' && x >= 3 && x <= 11 && rng.chance(0.55)) {
        const cy = seaTop ? depth + 1 : H - 2 - depth;
        if (!reserved(x, cy)) { set(x, cy, 'cliffs'); raise(x, cy, 3); }
      }
    }
  }

  // ---- biome patches
  const blob = (t, size, x0 = rng.int(3, W - 5), y0 = rng.int(0, H - 1)) => {
    let x = x0, y = y0;
    for (let i = 0; i < size; i++) {
      if (!reserved(x, y) && get(x, y) !== 'water') set(x, y, t);
      const d = rng.int(0, 3);
      x = Math.max(3, Math.min(W - 2, x + N4[d][0])); y = Math.max(0, Math.min(H - 1, y + N4[d][1]));
    }
  };
  for (const t of ['farmland', 'forest', 'hills', 'marsh', 'mountain', 'cliffs']) {
    const n = P[t] || 0;
    for (let i = 0; i < n; i++) if (rng.chance(0.6)) blob(t, rng.int(2, 6));
  }
  for (let i = 0; i < (P.pools || 0); i++) if (rng.chance(0.6)) blob('water', rng.int(2, 3));
  for (let i = 0; i < (P.lava || 0); i++) {
    if (!rng.chance(0.7)) continue;
    let x = rng.int(3, W - 5), y = rng.int(0, H - 1);
    const len = rng.int(3, 6), dir = rng.int(0, 3);
    for (let k = 0; k < len; k++) {
      if (!reserved(x, y) && get(x, y) !== 'water') set(x, y, 'lava');
      if (rng.chance(0.65)) { x += N4[dir][0]; y += N4[dir][1]; } else { x += rng.int(-1, 1); y += rng.int(-1, 1); }
      x = Math.max(3, Math.min(W - 3, x)); y = Math.max(0, Math.min(H - 1, y));
    }
  }

  // ---- the template
  const riverLine = (fromX, diag) => {
    // a meandering river from top to bottom (diag: drifts steadily one way)
    let x = fromX;
    const drift = diag ? (rng.chance(0.5) ? 1 : -1) : 0;
    const cells = [];
    for (let y = 0; y < H; y++) {
      if (!reserved(x, y)) { set(x, y, 'water'); cells.push([x, y]); }
      if (rng.chance(0.35) && !reserved(x + 1, y)) { set(x + 1, y, 'water'); cells.push([x + 1, y]); }
      if (diag && rng.chance(0.55)) x += drift; else if (rng.chance(0.3)) x += rng.chance(0.5) ? 1 : -1;
      x = Math.max(3, Math.min(9, x));
    }
    return cells;
  };
  const bridges = (cells, n) => {
    const rows = [...new Set(cells.map(c => c[1]))];
    for (let k = 0; k < n && rows.length; k++) {
      const y = rows.splice(rng.int(0, rows.length - 1), 1)[0];
      for (const [x, yy] of cells) if (yy === y) set(x, y, rng.chance(0.3) ? 'marsh' : 'bridge');   // a bridge or a ford
    }
  };
  switch (template) {
    case 'river': {
      const cells = riverLine(rng.int(4, 8), rng.chance(0.4));
      bridges(cells, rng.int(1, 3));
      // banks: farmland or reeds
      for (const [x, y] of cells) for (const [dx, dy] of N4) if (get(x + dx, y + dy) === ground && rng.chance(0.3) && !reserved(x + dx, y + dy)) set(x + dx, y + dy, biome === 'marsh' ? 'marsh' : 'farmland');
      break;
    }
    case 'lake': {
      const cx = rng.int(4, 8), cy = rng.int(2, H - 3), rx = 1 + rng.next() * 1.8, ry = 1 + rng.next() * 1.5;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (reserved(x, y)) continue;
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
        if (d <= 1) set(x, y, 'water');
        else if (d <= 1.9 && rng.chance(0.7)) set(x, y, biome === 'marsh' ? 'marsh' : biome === 'coast' ? 'sand' : rng.chance(0.5) ? 'farmland' : ground);
      }
      break;
    }
    case 'ridge': {
      // a ridge of hills crossing the board north-south with one or two passes
      let x = rng.int(5, 8);
      const passes = new Set([rng.int(1, H - 2)]);
      if (rng.chance(0.5)) passes.add(rng.int(1, H - 2));
      for (let y = 0; y < H; y++) {
        if (!passes.has(y) && !reserved(x, y)) {
          const peak = rng.chance(0.3);
          set(x, y, peak ? 'cliffs' : 'hills'); raise(x, y, peak ? 3 : 2);
          if (rng.chance(0.5) && !reserved(x + 1, y)) { set(x + 1, y, 'hills'); raise(x + 1, y, 1); }
        }
        if (rng.chance(0.35)) x = Math.max(4, Math.min(9, x + (rng.chance(0.5) ? 1 : -1)));
      }
      break;
    }
    case 'twinhills': {
      for (let k = 0; k < 2; k++) {
        const cx = rng.int(4, 9), cy = k ? rng.int(H / 2, H - 2) : rng.int(1, H / 2 - 1);
        for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) {
          const d = Math.hypot(x - cx, y - cy);
          if (!inside(x, y) || reserved(x, y) || d > 2.3) continue;
          set(x, y, d < 0.8 && rng.chance(0.4) ? 'cliffs' : 'hills');
          raise(x, y, d < 0.8 ? 3 : d < 1.6 ? 2 : 1);
        }
      }
      break;
    }
    case 'forestbelt': {
      const x0 = rng.int(4, 8), w = rng.int(2, 3);
      const clear = new Set([rng.int(0, H - 1), rng.int(0, H - 1), rng.int(0, H - 1)]);
      for (let y = 0; y < H; y++) for (let dx = 0; dx < w; dx++) {
        const x = x0 + dx + (y % 3 === 0 && rng.chance(0.4) ? 1 : 0);
        if (reserved(x, y)) continue;
        set(x, y, clear.has(y) ? (rng.chance(0.4) ? 'village' : ground) : 'forest');
      }
      break;
    }
    case 'ravine': {
      // a gully cut across the board diagonally: low floor flanked by cliffs, crossable at gaps
      let y = rng.int(0, 3);
      const down = rng.chance(0.5);
      if (!down) y = H - 1 - y;
      for (let x = 3; x < W - 2; x++) {
        if (!reserved(x, y)) {
          set(x, y, rng.chance(0.25) ? 'water' : ground);
          for (const dy of [-1, 1]) if (!reserved(x, y + dy) && inside(x, y + dy) && rng.chance(0.75)) { set(x, y + dy, 'cliffs'); raise(x, y + dy, 2 + (rng.chance(0.4) ? 1 : 0)); }
        }
        if (rng.chance(0.6)) y += down ? 1 : -1;
        y = Math.max(0, Math.min(H - 1, y));
      }
      break;
    }
    case 'open': {
      for (let k = 0; k < 6; k++) blob('farmland', rng.int(3, 6));
      for (let k = 0; k < 3; k++) { const x = rng.int(3, 10), y = rng.int(0, H - 1); if (!reserved(x, y)) set(x, y, 'forest'); }
      break;
    }
    case 'delta': {
      for (let k = 0; k < rng.int(2, 4); k++) {
        let y = rng.int(0, H - 1);
        for (let x = rng.int(2, 5); x < W - 3; x++) {
          if (!reserved(x, y)) set(x, y, rng.chance(0.7) ? 'water' : 'marsh');
          if (rng.chance(0.4)) y = Math.max(0, Math.min(H - 1, y + (rng.chance(0.5) ? 1 : -1)));
        }
      }
      for (let k = 0; k < 4; k++) blob('marsh', rng.int(2, 5));
      break;
    }
    case 'coastcliffs': {
      for (let k = 0; k < 2; k++) blob('hills', rng.int(3, 5));
      break;
    }
    case 'pass': {
      // mountains to the north and south leave a corridor around the objective's row
      const c = obj.y + rng.int(-1, 1), half = rng.int(1, 2);
      for (let x = 3; x < W - 3; x++) {
        const lo = c - half - (rng.chance(0.4) ? 1 : 0), hi = c + half + (rng.chance(0.4) ? 1 : 0);
        for (let y = 0; y < H; y++) {
          if (reserved(x, y) || (y >= lo && y <= hi)) continue;
          const edge = y === lo - 1 || y === hi + 1;
          if (edge) { set(x, y, rng.chance(0.5) ? 'cliffs' : 'hills'); raise(x, y, 2); }
          else if (rng.chance(0.7)) { set(x, y, biome === 'volcanic' ? 'lava' : 'mountain'); raise(x, y, 3); }
        }
      }
      break;
    }
    case 'crossroads': {
      const cx = rng.int(5, 8), cy = rng.int(2, H - 3);
      for (let y = 0; y < H; y++) if (!reserved(cx, y)) set(cx, y, 'road');
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) if (rng.chance(0.75) && !reserved(cx + dx, cy + dy)) set(cx + dx, cy + dy, 'village');
      for (let k = 0; k < 3; k++) blob('farmland', rng.int(2, 4));
      break;
    }
  }

  // ---- ruins scattered over the old holy lands
  if (prov && RUINED.has(prov.name)) {
    for (let i = 0; i < 8; i++) {
      const x = rng.int(3, 11), y = rng.int(0, H - 1);
      if (!reserved(x, y) && !['water', 'marsh', 'lava', 'mountain'].includes(get(x, y))) set(x, y, 'ruins');
    }
  }

  // ---- clear the castle grounds and the deployment zone
  const blocked = t => IMPASSABLE.has(t) || t === 'water' || t === 'marsh' || t === 'cliffs';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = get(x, y);
    if ((x <= 2 || nearObj(x, y, siege ? 3 : 2)) && blocked(t)) set(x, y, ground);
    if (nearObj(x, y, 3) && t !== ground && !['farmland', 'road', 'village'].includes(t)) set(x, y, ground);
    if (x <= 2) lift[idx(x, y)] = Math.min(lift[idx(x, y)], 1);
  }

  // ---- the castle, or the field camp
  if (siege) buildCastle(castle, obj, gate, { set, get, raise, rng, ground });
  else buildCamp(camp, obj, { set, get, raise, rng, ground });
  set(obj.x, obj.y, 'keep');

  // ---- the road: winds from the west edge to the gate (or the camp's front)
  const target = siege ? { ...gateFront } : { x: obj.x - 1, y: obj.y };
  if (castle === 'curtain' || castle === 'moat' || castle === 'island') target.x = obj.x - 3;
  windRoad(rng.int(Math.max(0, target.y - 4), Math.min(H - 1, target.y + 4)), target, { set, get, rng });
  if (rng.chance(0.4)) {   // a side road from another edge
    const fromTop = rng.chance(0.5);
    let x = rng.int(4, 9), y = fromTop ? 0 : H - 1;
    while (y !== target.y && inside(x, y)) {
      const t = get(x, y);
      if (!CASTLE.has(t)) set(x, y, t === 'water' ? 'bridge' : t === 'lava' || t === 'mountain' ? 'road' : t === 'village' ? 'village' : 'road');
      y += fromTop ? 1 : -1;
      if (rng.chance(0.3)) x = Math.max(3, Math.min(9, x + (rng.chance(0.5) ? 1 : -1)));
      if (get(x, y) === 'road') break;
    }
  }

  // ---- villages, trees and boulders
  for (let i = 0; i < rng.int(1, 2); i++) {
    for (let tries = 0; tries < 10; tries++) {
      const x = rng.int(3, 9), y = rng.int(0, H - 1);
      if (reserved(x, y) || !['grass', 'farmland', 'snow', 'ash'].includes(get(x, y))) continue;
      const nextToRoad = N4.some(([dx, dy]) => get(x + dx, y + dy) === 'road');
      if (!nextToRoad && tries < 7) continue;
      set(x, y, 'village');
      if (rng.chance(0.5) && get(x + 1, y) === ground) set(x + 1, y, 'village');
      break;
    }
  }
  for (let i = 0; i < 10; i++) {
    const x = rng.int(3, W - 1), y = rng.int(0, H - 1);
    if (get(x, y) !== ground || nearObj(x, y, 1)) continue;
    if (rng.chance(0.6)) set(x, y, 'forest'); else { set(x, y, 'hills'); raise(x, y, 1); }
  }

  // ---- winter: snow over open ground, ice along the banks
  if (winter || P.alpine) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = get(x, y);
      if ((t === 'grass' || t === 'farmland') && (P.alpine || rng.chance(0.65))) set(x, y, 'snow');
      if (t === 'water') {
        const bank = N4.some(([dx, dy]) => { const n = get(x + dx, y + dy); return n && n !== 'water' && n !== 'bridge'; });
        if (bank && rng.chance(winter ? 0.7 : 0.4)) set(x, y, 'ice');
      }
    }
  }

  // ---- deployment squares must be standable
  for (let y = 0; y < H; y++) for (let x = 0; x <= 2; x++) if (IMPASSABLE.has(get(x, y)) || get(x, y) === 'water') set(x, y, winter || P.alpine ? 'snow' : ground);

  ensureConnected(g, obj);
  const elev = elevation(g, lift, rng, biome, castle === 'hillfort' ? obj : null);
  return { grid: g, elev, biome, obj, gate, template, castle, camp };
}

// ---------------------------------------------------------------- castles and camps

function buildCastle(kind, obj, gate, { set, get, raise, rng, ground }) {
  const ring = r => {
    const out = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) out.push([obj.x + dx, obj.y + dy]);
    return out;
  };
  const inner = () => {
    for (const [x, y] of ring(1)) set(x, y, 'wall');
    set(gate.x, gate.y, 'gate');
  };
  switch (kind) {
    case 'curtain': {
      inner();
      // the outer curtain two squares out, with a gatehouse on the west side and a bailey inside
      for (const [x, y] of ring(2)) set(x, y, 'wall');
      for (const [x, y] of ring(2)) if (x === obj.x + 2 && rng.chance(0.35)) set(x, y, ground);   // the back wall is unfinished
      set(obj.x - 2, obj.y, 'gate');
      break;
    }
    case 'moat': case 'island': {
      inner();
      // a ring of water two squares out; the island sits in open water with a beach
      for (const [x, y] of ring(2)) set(x, y, 'water');
      if (kind === 'island') for (const [x, y] of ring(3)) if (get(x, y) && rng.chance(0.7)) set(x, y, rng.chance(0.25) ? 'water' : 'sand');
      set(obj.x - 2, obj.y, 'bridge');
      if (kind === 'island') set(obj.x - 3, obj.y, 'bridge');
      break;
    }
    case 'hillfort': {
      inner();
      // the castle crowns a hill: slopes all round, a ramp road up to the gate
      for (const [x, y] of ring(2)) { if (get(x, y) !== null && rng.chance(0.8)) { set(x, y, 'hills'); raise(x, y, 1); } }
      for (const [x, y] of ring(3)) { if (get(x, y) !== null && rng.chance(0.6)) { set(x, y, 'hills'); raise(x, y, 1); } }
      { const fx = gate.x + (gate.x - obj.x), fy = gate.y + (gate.y - obj.y); set(fx, fy, 'road'); raise(fx, fy, 1); }
      break;
    }
    case 'rivercastle': {
      inner();
      // a river runs past the castle on its north or south side
      const side = obj.y > 5 ? -1 : 1;
      const ry = obj.y + side * 2;
      for (let x = 3; x < 16; x++) if (get(x, ry) !== null) set(x, ry, x === obj.x - 3 ? 'bridge' : 'water');
      break;
    }
    case 'ruined': {
      inner();
      // gaps in the walls: rubble you can climb through
      let gaps = 0;
      for (const [x, y] of ring(1)) {
        if ((x === gate.x && y === gate.y) || gaps >= 3) continue;
        if (rng.chance(0.35)) { set(x, y, 'ruins'); gaps++; }
      }
      for (const [x, y] of ring(2)) if (get(x, y) === ground && rng.chance(0.3)) set(x, y, 'ruins');
      break;
    }
    default: inner();
  }
}

function buildCamp(kind, obj, { set, get, raise, rng, ground }) {
  switch (kind) {
    case 'hilltop': {
      // hold the crown of a hill
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy)), x = obj.x + dx, y = obj.y + dy;
        if (get(x, y) === null) continue;
        if (d === 1) { set(x, y, 'hills'); raise(x, y, 2); }
        else if (d === 2 && rng.chance(0.6)) { set(x, y, rng.chance(0.25) ? 'cliffs' : 'hills'); raise(x, y, 1); }
      }
      raise(obj.x, obj.y, 2);
      break;
    }
    case 'village': {
      for (const [dx, dy] of [[1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) if (rng.chance(0.7)) set(obj.x + dx, obj.y + dy, 'village');
      set(obj.x - 1, obj.y, 'road');
      break;
    }
    case 'stones': {
      // a ring of standing stones around the holy ground
      for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [-1, -1], [1, -1], [-1, 1]]) if (rng.chance(0.75)) set(obj.x + dx, obj.y + dy, 'ruins');
      break;
    }
    default: {
      set(obj.x - 1, obj.y, 'road');
      for (const [dx, dy] of [[1, -1], [1, 1], [0, -1], [0, 1]]) if (rng.chance(0.75)) set(obj.x + dx, obj.y + dy, 'tents');
      for (let y = obj.y - 3; y <= obj.y + 3; y++) {
        if (Math.abs(y - obj.y) <= 1) continue;   // the camp's open front
        if (rng.chance(0.6) && get(obj.x - 2, y) === ground) set(obj.x - 2, y, 'palisade');
      }
    }
  }
}

// A road that wanders east from the west edge (row y0) to `target`, bridging water on the way.
function windRoad(y0, target, { set, get, rng }) {
  let x = 0, y = y0;
  for (let steps = 0; steps < 60 && !(x === target.x && y === target.y); steps++) {
    const t = get(x, y);
    if (!CASTLE.has(t)) set(x, y, t === 'water' || t === 'ice' ? 'bridge' : t === 'village' ? 'village' : 'road');
    const dy = target.y - y, dx = target.x - x;
    if (dx > 0 && (dy === 0 || rng.chance(0.6 + Math.min(0.3, dx / 30)))) x++;
    else if (dy !== 0) y += Math.sign(dy);
    else x += Math.sign(dx);
    if (rng.chance(0.12) && dx > 3) y = Math.max(0, Math.min(H - 1, y + (rng.chance(0.5) ? 1 : -1)));
  }
  const t = get(target.x, target.y);
  if (t && !CASTLE.has(t)) set(target.x, target.y, t === 'water' ? 'bridge' : 'road');
}

// ---------------------------------------------------------------- elevation

// Elevation (0-3): smoothed noise in plateaus, lifted by hills, cliffs and template features;
// water and the castle stay level (walls carry their own defence and are drawn as 3D blocks).
function elevation(g, lift, rng, biome, hillfort) {
  const n1 = noiseField(rng, 4, 3), n2 = noiseField(rng, 7, 5);
  const rough = { hills: 1.3, mountain: 1.5, alpine: 1.5, volcanic: 1.2 }[biome] || 0.9;
  const e = new Array(W * H).fill(0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y), t = g[i];
    const n = (n1(x, y) * 0.7 + n2(x, y) * 0.3) * rough;
    let z = n > 0.95 ? 2 : n > 0.62 ? 1 : 0;   // plateaus
    switch (t) {
      case 'water': case 'ice': case 'marsh': case 'sand': case 'bridge': case 'lava': z = 0; break;
      case 'hills': z = Math.max(1, Math.min(2, z + 1)); break;
      case 'cliffs': case 'mountain': z = 3; break;
      case 'keep': case 'wall': case 'gate': z = 0; break;
    }
    if (!['water', 'ice', 'marsh', 'sand', 'bridge', 'lava', 'keep', 'wall', 'gate'].includes(t)) z = Math.max(z, lift[i]);
    e[i] = Math.min(3, z);
  }
  // roads ease the slopes: never more than one step above their neighbours along the way
  for (let i = 0; i < W * H; i++) if (g[i] === 'road' && e[i] > 1) e[i] = 1;
  return e;
}

// ---------------------------------------------------------------- connectivity

// Make sure the objective can be reached from the west by ground: if not, carve a road along the
// objective's row through whatever blocks it.
function ensureConnected(g, obj) {
  const reach = () => {
    const seen = new Uint8Array(W * H), q = [];
    for (let y = 0; y < H; y++) if (!IMPASSABLE.has(g[idx(0, y)])) { seen[idx(0, y)] = 1; q.push(idx(0, y)); }
    while (q.length) {
      const i = q.shift(); const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (!inside(nx, ny)) continue;
        const j = idx(nx, ny);
        if (seen[j] || IMPASSABLE.has(g[j])) continue;
        seen[j] = 1; q.push(j);
      }
    }
    return seen;
  };
  if (reach()[idx(obj.x, obj.y)]) return;
  for (let x = 0; x < obj.x; x++) if (IMPASSABLE.has(g[idx(x, obj.y)])) g[idx(x, obj.y)] = 'road';
  if (!reach()[idx(obj.x, obj.y)]) for (let i = 0; i < W * H; i++) if (IMPASSABLE.has(g[i])) g[i] = 'hills';
}

// For tests and the UI: is there a passable path from the west edge to the objective?
export function pathExists(grid, obj) {
  const seen = new Uint8Array(W * H), q = [];
  for (let y = 0; y < H; y++) if (!IMPASSABLE.has(grid[idx(0, y)])) { seen[idx(0, y)] = 1; q.push(idx(0, y)); }
  while (q.length) {
    const i = q.shift(); const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy;
      if (!inside(nx, ny)) continue;
      const j = idx(nx, ny);
      if (seen[j] || IMPASSABLE.has(grid[j])) continue;
      seen[j] = 1; q.push(j);
    }
  }
  return !!seen[idx(obj.x, obj.y)];
}
