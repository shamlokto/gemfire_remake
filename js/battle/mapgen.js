// Battlefield generator: a 16 x 12 grid of terrain keys plus a per-tile elevation (0-3), built
// from the province (terrain type and name), the season and a seed. Pure (node-runnable).
//
// Terrain keys: grass road forest hills mountain water marsh bridge village wall gate keep
//   sand (beaches) snow (winter ground) ice (frozen water) farmland ruins lava ash cliffs
//   palisade tents
// The objective square (keep centre) is always at OBJ; with `siege` it is ringed by walls with a
// gate facing the attacker (west). Field battles get a camp: tents and a broken palisade.
//
// Biomes (chosen from the province): plains (farmland, villages, a river), forest, hills, marsh
// (reeds and pools), coast (sea edge with beaches), alpine (Frosthelm, Ironpeak, Cairnholm: cliffs,
// peaks, snow, frozen tarns), volcanic (Emberrock: lava seams in ash), ruins (Lanterncross,
// Fenwick: broken pillars over the base land). Winter turns grass to snow and freezes water near
// the banks.

import { makeRng } from '../rng.js';
import { PROVINCES } from '../data/world.js';

export const W = 16;
export const H = 12;
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
const WET = new Set(['water', 'marsh', 'lava']);

// Per biome: patch weights (count of blob attempts), river chance and extras.
const PROFILE = {
  plains:   { forest: 3, hills: 2, village: 2, farmland: 5, river: 0.6 },
  forest:   { forest: 12, hills: 1, village: 1, marsh: 1, river: 0.4 },
  hills:    { forest: 3, hills: 10, village: 1, mountain: 2, cliffs: 2, river: 0.3 },
  mountain: { forest: 2, hills: 7, mountain: 6, cliffs: 3, river: 0.2 },
  marsh:    { forest: 3, village: 1, marsh: 12, pools: 4, river: 0.7 },
  coast:    { forest: 2, hills: 2, village: 2, marsh: 1, farmland: 2, river: 0.2, sea: true },
  alpine:   { hills: 6, mountain: 5, cliffs: 5, snow: 8, forest: 2, pools: 2, alpine: true },
  volcanic: { hills: 4, mountain: 3, cliffs: 2, lava: 5, ash: 10, sea: true },
};
const ALPINE = new Set(['Frosthelm', 'Ironpeak', 'Cairnholm']);
const RUINED = new Set(['Lanterncross', 'Fenwick']);

export function biomeOf(terrain, provinceId) {
  const p = provinceId != null ? PROVINCES[provinceId] : null;
  if (p && p.name === 'Emberrock') return 'volcanic';
  if (p && ALPINE.has(p.name)) return 'alpine';
  return PROFILE[terrain] ? terrain : 'plains';
}

export const idx = (x, y) => y * W + x;

// Back-compatible: the terrain grid only.
export function generateMap(terrain, seed, siege, opts = {}) {
  return generateField(terrain, seed, siege, opts).grid;
}

// { grid: [terrain key], elev: [0..3], biome }
export function generateField(terrain, seed, siege, opts = {}) {
  const rng = makeRng((seed ^ 0x5bd1e995) >>> 0);
  const biome = biomeOf(terrain, opts.provinceId);
  const prov = opts.provinceId != null ? PROVINCES[opts.provinceId] : null;
  const p = PROFILE[biome];
  const winter = opts.season === 3;
  const g = new Array(W * H).fill(biome === 'volcanic' ? 'ash' : biome === 'alpine' ? 'snow' : 'grass');
  const set = (x, y, t) => { if (x >= 0 && y >= 0 && x < W && y < H) g[idx(x, y)] = t; };
  const get = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? g[idx(x, y)] : null);

  // Sea along the top or bottom edge, with a beach behind it.
  if (p.sea) {
    const top = rng.chance(0.5);
    for (let x = 0; x < W; x++) {
      const depth = 1 + (rng.chance(0.4) ? 1 : 0);
      for (let d = 0; d < depth; d++) set(x, top ? d : H - 1 - d, 'water');
      if (biome !== 'volcanic') set(x, top ? depth : H - 1 - depth, rng.chance(0.85) ? 'sand' : get(x, top ? depth : H - 1 - depth));
    }
  }

  // Patches (blobs) of each feature.
  const blob = (t, size) => {
    let x = rng.int(3, W - 5), y = rng.int(0, H - 1);
    for (let i = 0; i < size; i++) {
      if (get(x, y) !== 'water') set(x, y, t);
      const d = rng.int(0, 3);
      x += [1, -1, 0, 0][d]; y += [0, 0, 1, -1][d];
      x = Math.max(3, Math.min(W - 4, x)); y = Math.max(0, Math.min(H - 1, y));
    }
  };
  for (const t of ['farmland', 'forest', 'hills', 'marsh', 'mountain', 'cliffs', 'snow', 'ash']) {
    const n = p[t] || 0;
    for (let i = 0; i < n; i++) if (rng.chance(0.55)) blob(t, rng.int(3, 7));
  }
  // Pools (marsh, alpine tarns): small water blobs.
  for (let i = 0; i < (p.pools || 0); i++) if (rng.chance(0.6)) blob('water', rng.int(2, 3));
  // Lava seams: thin wandering lines through the ash.
  for (let i = 0; i < (p.lava || 0); i++) {
    if (!rng.chance(0.7)) continue;
    let x = rng.int(4, W - 5), y = rng.int(0, H - 1);
    const len = rng.int(3, 6), dir = rng.int(0, 3);
    for (let k = 0; k < len; k++) {
      if (get(x, y) !== 'water') set(x, y, 'lava');
      if (rng.chance(0.65)) { x += [1, -1, 0, 0][dir]; y += [0, 0, 1, -1][dir]; } else { x += rng.int(-1, 1); y += rng.int(-1, 1); }
      x = Math.max(4, Math.min(W - 5, x)); y = Math.max(0, Math.min(H - 1, y));
    }
  }
  for (let i = 0; i < (p.village || 0); i++) if (rng.chance(0.6)) set(rng.int(4, 10), rng.int(1, H - 2), 'village');

  // River: meanders north-south through the middle columns.
  if (rng.chance(p.river || 0)) {
    let x = rng.int(6, 8);
    for (let y = 0; y < H; y++) {
      set(x, y, 'water');
      if (rng.chance(0.3)) { const nx = Math.max(5, Math.min(9, x + (rng.chance(0.5) ? 1 : -1))); set(nx, y, 'water'); x = nx; }
    }
  }

  // Ruins: broken pillars scattered over the land (Lanterncross, Fenwick).
  if (prov && RUINED.has(prov.name)) {
    for (let i = 0; i < 9; i++) {
      const x = rng.int(3, 11), y = rng.int(0, H - 1);
      if (!WET.has(get(x, y)) && get(x, y) !== 'mountain') set(x, y, 'ruins');
    }
  }

  // Road from the west edge to the gate along the gate row; bridges where it crosses water.
  for (let x = 0; x < GATE.x; x++) {
    const t = g[idx(x, GATE.y)];
    set(x, GATE.y, t === 'water' ? 'bridge' : t === 'lava' ? 'ash' : 'road');
  }
  // A second bridge somewhere if there is a river.
  for (let y = 0; y < H; y++) {
    if (y === GATE.y) continue;
    if (Math.abs(y - GATE.y) >= 3 && rng.chance(0.25)) {
      for (let x = 4; x < 11; x++) if (g[idx(x, y)] === 'water') { set(x, y, 'bridge'); break; }
    }
  }

  // Winter: snow over the open ground, ice along the banks (and on small pools).
  if (winter || p.alpine) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = g[idx(x, y)];
      if ((t === 'grass' || t === 'farmland') && (p.alpine || rng.chance(0.65))) set(x, y, 'snow');
      if (t === 'water') {
        const bank = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const n = get(x + dx, y + dy); return n && n !== 'water' && n !== 'bridge'; });
        if (bank && rng.chance(0.7)) set(x, y, 'ice');
      }
    }
  }

  // Clear the deployment zones and the keep surroundings.
  const blockedHere = t => IMPASSABLE.has(t) || t === 'water' || t === 'marsh' || t === 'cliffs';
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = g[idx(x, y)];
      const deployA = x <= 2;
      const nearKeep = Math.abs(x - OBJ.x) <= 2 && Math.abs(y - OBJ.y) <= 2;
      if ((deployA || nearKeep) && blockedHere(t)) set(x, y, biome === 'volcanic' ? 'ash' : (winter || p.alpine) ? 'snow' : 'grass');
      if (x >= 11 && t === 'mountain') set(x, y, 'hills');
    }
  }

  // Keep / objective; field battles get a camp with a broken palisade.
  if (siege) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) set(OBJ.x + dx, OBJ.y + dy, 'wall');
    set(GATE.x, GATE.y, 'gate');
  } else {
    set(OBJ.x - 1, OBJ.y, 'road');
    for (const [dx, dy] of [[1, -1], [1, 1], [0, -1], [0, 1]]) if (rng.chance(0.75)) set(OBJ.x + dx, OBJ.y + dy, 'tents');
    for (let y = OBJ.y - 3; y <= OBJ.y + 3; y++) {
      if (Math.abs(y - OBJ.y) <= 1) continue;   // the camp's open front
      if (rng.chance(0.6) && !blockedHere(get(OBJ.x - 2, y))) set(OBJ.x - 2, y, 'palisade');
    }
  }
  set(OBJ.x, OBJ.y, 'keep');

  ensureConnected(g);
  const elev = elevation(g, rng, biome);
  return { grid: g, elev, biome };
}

// Elevation (0-3): smooth noise lifted by the terrain (hills 1-2, cliffs and peaks 3, water 0).
function elevation(g, rng, biome) {
  const lat = Array.from({ length: 5 * 4 }, () => rng.next());
  const noise = (x, y) => {
    const fx = x / (W - 1) * 4, fy = y / (H - 1) * 3;
    const x0 = Math.min(3, Math.floor(fx)), y0 = Math.min(2, Math.floor(fy)), tx = fx - x0, ty = fy - y0;
    const a = lat[y0 * 5 + x0], b2 = lat[y0 * 5 + x0 + 1], c = lat[(y0 + 1) * 5 + x0], d = lat[(y0 + 1) * 5 + x0 + 1];
    return (a * (1 - tx) + b2 * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
  const hilly = biome === 'hills' || biome === 'mountain' || biome === 'alpine' || biome === 'volcanic';
  const e = new Array(W * H).fill(0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y), t = g[i], n = noise(x, y);
    let z;
    switch (t) {
      case 'water': case 'ice': case 'marsh': case 'sand': case 'bridge': z = 0; break;
      case 'lava': z = 0; break;
      case 'hills': z = n > 0.55 ? 2 : 1; break;
      case 'cliffs': z = 3; break;
      case 'mountain': z = 3; break;
      case 'keep': case 'wall': case 'gate': case 'road': z = 0; break;   // walls have their own defence; drawn as 3D blocks
      default: z = hilly ? (n > 0.62 ? 1 : 0) : (n > 0.78 ? 1 : 0);
    }
    e[i] = z;
  }
  // Roads and bridges follow the ground; the gate row is level with the keep.
  return e;
}

// Make sure the objective can be reached from the west by ground (carve through obstacles).
function ensureConnected(g) {
  const seen = new Uint8Array(W * H);
  const q = [];
  for (let y = 0; y < H; y++) if (!IMPASSABLE.has(g[idx(0, y)])) { seen[idx(0, y)] = 1; q.push(idx(0, y)); }
  while (q.length) {
    const i = q.shift(); const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = idx(nx, ny);
      if (seen[j] || IMPASSABLE.has(g[j])) continue;
      seen[j] = 1; q.push(j);
    }
  }
  if (!seen[idx(OBJ.x, OBJ.y)]) {
    for (let x = 0; x < OBJ.x; x++) if (IMPASSABLE.has(g[idx(x, GATE.y)])) g[idx(x, GATE.y)] = 'road';
  }
}
