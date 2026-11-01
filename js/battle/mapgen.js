// Battlefield generator: a 16 x 12 grid of terrain keys built from the province terrain and a
// seed. Pure (node-runnable). Terrain keys: grass road forest hills mountain water marsh bridge
// village wall gate keep. The objective square (keep centre) is always at OBJ; with `siege`
// it is ringed by walls with a gate facing the attacker (west).

import { makeRng } from '../rng.js';

export const W = 16;
export const H = 12;
export const OBJ = { x: 13, y: 5 };
export const GATE = { x: 12, y: 5 };

export const TERRAIN = {
  grass:    { name: 'Meadow',   cost: 1, def: 1.0 },
  road:     { name: 'Road',     cost: 1, def: 1.0 },
  forest:   { name: 'Forest',   cost: 2, def: 1.25 },
  hills:    { name: 'Hills',    cost: 2, def: 1.3 },
  village:  { name: 'Village',  cost: 1, def: 1.2 },
  wall:     { name: 'Wall',     cost: 3, def: 1.8 },
  gate:     { name: 'Gate',     cost: 1, def: 1.4 },
  keep:     { name: 'Keep',     cost: 1, def: 1.8 },
  water:    { name: 'River',    cost: 2, def: 0.8 },
  marsh:    { name: 'Marsh',    cost: 2, def: 0.8 },
  bridge:   { name: 'Bridge',   cost: 1, def: 1.0 },
  mountain: { name: 'Mountain', cost: Infinity, def: 1.5 },
};

// Per province terrain: chance weights for patches.
const PROFILE = {
  plains:   { forest: 4, hills: 2, village: 2, marsh: 0, mountain: 0, river: 0.6 },
  forest:   { forest: 12, hills: 1, village: 1, marsh: 1, mountain: 0, river: 0.4 },
  hills:    { forest: 3, hills: 10, village: 1, marsh: 0, mountain: 3, river: 0.3 },
  mountain: { forest: 2, hills: 8, village: 0, marsh: 0, mountain: 8, river: 0.2 },
  marsh:    { forest: 3, hills: 0, village: 1, marsh: 12, mountain: 0, river: 0.7 },
  coast:    { forest: 2, hills: 2, village: 2, marsh: 2, mountain: 0, river: 0.2, sea: true },
};

export const idx = (x, y) => y * W + x;

export function generateMap(terrain, seed, siege) {
  const rng = makeRng((seed ^ 0x5bd1e995) >>> 0);
  const p = PROFILE[terrain] || PROFILE.plains;
  const g = new Array(W * H).fill('grass');
  const set = (x, y, t) => { if (x >= 0 && y >= 0 && x < W && y < H) g[idx(x, y)] = t; };

  // Coast: the sea runs along the top or bottom edge.
  if (p.sea) {
    const top = rng.chance(0.5);
    for (let x = 0; x < W; x++) {
      const depth = 1 + (rng.chance(0.4) ? 1 : 0);
      for (let d = 0; d < depth; d++) set(x, top ? d : H - 1 - d, 'water');
    }
  }

  // Patches (blobs) of each feature.
  const blob = (t, size) => {
    let x = rng.int(3, W - 5), y = rng.int(0, H - 1);
    for (let i = 0; i < size; i++) {
      set(x, y, t);
      const d = rng.int(0, 3);
      x += [1, -1, 0, 0][d]; y += [0, 0, 1, -1][d];
      x = Math.max(3, Math.min(W - 4, x)); y = Math.max(0, Math.min(H - 1, y));
    }
  };
  for (const t of ['forest', 'hills', 'marsh', 'mountain']) {
    const n = p[t] || 0;
    for (let i = 0; i < n; i++) if (rng.chance(0.55)) blob(t, rng.int(3, 7));
  }
  for (let i = 0; i < (p.village || 0); i++) if (rng.chance(0.6)) set(rng.int(4, 10), rng.int(1, H - 2), 'village');

  // River: meanders north-south through the middle columns.
  if (rng.chance(p.river)) {
    let x = rng.int(6, 8);
    for (let y = 0; y < H; y++) {
      set(x, y, 'water');
      if (rng.chance(0.3)) { const nx = Math.max(5, Math.min(9, x + (rng.chance(0.5) ? 1 : -1))); set(nx, y, 'water'); x = nx; }
    }
  }

  // Road from the west edge to the gate along the gate row; bridges where it crosses water.
  for (let x = 0; x < GATE.x; x++) {
    const t = g[idx(x, GATE.y)];
    set(x, GATE.y, t === 'water' ? 'bridge' : 'road');
  }
  // A second bridge somewhere if there is a river.
  for (let y = 0; y < H; y++) {
    if (y === GATE.y) continue;
    if (Math.abs(y - GATE.y) >= 3 && rng.chance(0.25)) {
      for (let x = 4; x < 11; x++) if (g[idx(x, y)] === 'water') { set(x, y, 'bridge'); break; }
    }
  }

  // Clear the deployment zones and the keep surroundings.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = g[idx(x, y)];
      const deployA = x <= 2;
      const nearKeep = Math.abs(x - OBJ.x) <= 2 && Math.abs(y - OBJ.y) <= 2;
      if ((deployA || nearKeep) && (t === 'mountain' || t === 'water' || t === 'marsh')) set(x, y, 'grass');
      if (x >= 11 && t === 'mountain') set(x, y, 'hills');
    }
  }

  // Keep / objective.
  if (siege) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) set(OBJ.x + dx, OBJ.y + dy, 'wall');
    set(GATE.x, GATE.y, 'gate');
  } else {
    set(OBJ.x - 1, OBJ.y, 'road');
  }
  set(OBJ.x, OBJ.y, 'keep');

  ensureConnected(g);
  return g;
}

// Make sure the objective can be reached from the west by ground (carve through mountains).
function ensureConnected(g) {
  const seen = new Uint8Array(W * H);
  const q = [];
  for (let y = 0; y < H; y++) if (g[idx(0, y)] !== 'mountain') { seen[idx(0, y)] = 1; q.push(idx(0, y)); }
  while (q.length) {
    const i = q.shift(); const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = idx(nx, ny);
      if (seen[j] || g[j] === 'mountain') continue;
      seen[j] = 1; q.push(j);
    }
  }
  if (!seen[idx(OBJ.x, OBJ.y)]) {
    for (let x = 0; x < OBJ.x; x++) if (g[idx(x, GATE.y)] === 'mountain') g[idx(x, GATE.y)] = 'road';
  }
}
