// Deterministic land generation for each province (see docs/LAND.md). Pure module.
// generateLand(provinceId, seed, { start }) -> land (js/land/land.js format).
import { makeRng } from '../rng.js';
import { PROVINCES, MAP_W, MAP_H } from '../data/world.js';
import { W, H, T, R, B, idx, inside, neighbours4, neighbours8, provinceYield, BUILDING } from './land.js';

// Rivers and lakes of Varenhold (by province name). Rivers cross the grid; lakes sit inside it.
const RIVERS = { Aldford: 'ns', Kingsrest: 'we', Lanterncross: 'ns', Millbrook: 'we', Greywatch: 'ns',
  Reedwater: 'we', Goldvale: 'ns', Thornwood: 'we', Amberfield: 'we' };
const LAKES = { Coldmere: 1, Mirefen: 1, Highcairn: 1 };
// Land quality nudges on top of terrain: the realm's breadbaskets and its barren places.
const QUALITY = { Aldford: 0.18, Kingsrest: 0.15, Amberfield: 0.2, Goldvale: 0.15, Millbrook: 0.12,
  Lanterncross: 0.08, Oakhollow: 0.05, Frosthelm: -0.25, Emberrock: -0.3, Cairnholm: -0.2, Ironpeak: -0.1, Skerry: -0.15 };
const TERRAIN_Q = { plains: 0.22, coast: 0.02, forest: -0.05, hills: -0.12, marsh: -0.05, mountain: -0.32 };
// Guaranteed resources by province (lore), plus random ones by terrain.
const FIXED_RES = { Lanterncross: [R.RUINS], Sunspire: [R.GROVE], Emberrock: [R.SPRINGS, R.ORE], Ironpeak: [R.ORE],
  Pearlcoast: [R.PEARLS], Saltmarch: [R.SALT], Goldvale: [R.VINES], Fenwick: [R.RUINS], Oakhollow: [R.GROVE], Frosthelm: [R.SPRINGS] };
const RANDOM_RES = {
  plains: [R.RUINS, R.GROVE, R.VINES], coast: [R.PEARLS, R.SALT, R.RUINS], forest: [R.GROVE, R.RUINS],
  hills: [R.ORE, R.VINES, R.SPRINGS], marsh: [R.SALT, R.RUINS, R.SPRINGS], mountain: [R.ORE, R.SPRINGS],
};

function hashSeed(pid, seed) {
  let h = (seed >>> 0) ^ Math.imul(pid + 1, 0x9E3779B1);
  h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B); h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35);
  return (h ^ (h >>> 16)) >>> 0;
}

// Smooth value noise on the grid: random lattice of (gw x gh), bilinear.
function noise(rng, gw, gh) {
  const g = Array.from({ length: (gw + 1) * (gh + 1) }, () => rng.next());
  return (x, y) => {
    const fx = x / (W - 1) * gw, fy = y / (H - 1) * gh;
    const x0 = Math.min(gw - 1, Math.floor(fx)), y0 = Math.min(gh - 1, Math.floor(fy));
    const tx = fx - x0, ty = fy - y0, s = t => t * t * (3 - 2 * t);
    const a = g[y0 * (gw + 1) + x0], b = g[y0 * (gw + 1) + x0 + 1];
    const c = g[(y0 + 1) * (gw + 1) + x0], d = g[(y0 + 1) * (gw + 1) + x0 + 1];
    const u = s(tx), v = s(ty);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
}

// Which edges face the sea: map borders near the province, and all round for islands.
function seaEdges(p) {
  const e = { n: 0, s: 0, w: 0, e: 0 };
  const near = 130;
  if (p.y < near) e.n = 1; if (p.y > MAP_H - near + 40) e.s = 1;
  if (p.x < near) e.w = 1; if (p.x > MAP_W - near) e.e = 1;
  if (p.region !== 'main') {
    for (const k of Object.keys(e)) e[k] = Math.min(1, e[k]) || 1;
    // the side facing away from the mainland gets the deep water
    const cx = 500, cy = 380;
    if (Math.abs(p.x - cx) > Math.abs(p.y - cy)) e[p.x > cx ? 'e' : 'w'] = 2; else e[p.y > cy ? 's' : 'n'] = 2;
  } else if (p.terrain === 'coast') {
    const cx = 500, cy = 380;
    if (Math.abs(p.x - cx) > Math.abs(p.y - cy)) e[p.x > cx ? 'e' : 'w'] = Math.max(2, e[p.x > cx ? 'e' : 'w']);
  }
  return e;
}

export function generateLand(pid, seed = 1, opts = {}) {
  const p = PROVINCES[pid];
  const rng = makeRng(hashSeed(pid, seed));
  const n = W * H;
  const land = { v: 1, pid, w: W, h: H, t: Array(n).fill(T.PLAIN), r: Array(n).fill(0), b: Array(n).fill(0),
    c: Array(n).fill(0), d: Array(n).fill(0), p: [] };
  if (LAKES[p.name]) land.lake = 1;
  const elev = noise(rng, 4, 3), moist = noise(rng, 3, 3), detail = noise(rng, 7, 5);
  const q = (TERRAIN_Q[p.terrain] ?? 0) + (QUALITY[p.name] ?? 0) + (rng.next() * 0.16 - 0.08) + (RIVERS[p.name] ? 0.06 : 0);
  land.quality = Math.round(q * 100) / 100;

  // 1. base terrain from elevation/moisture, biased by the province's terrain type
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(land, x, y);
    const e = elev(x, y) * 0.75 + detail(x, y) * 0.25, m = moist(x, y);
    let t;
    switch (p.terrain) {
      case 'mountain': t = e > 0.55 ? T.ROCK : e > 0.32 ? T.HILLS : m > 0.7 ? T.FOREST : T.POOR; break;
      case 'hills':    t = e > 0.8 ? T.ROCK : e > 0.5 ? T.HILLS : m > 0.72 ? T.FOREST : -1; break;
      case 'forest':   t = m > 0.42 && e < 0.8 ? T.FOREST : e > 0.78 ? T.HILLS : -1; break;
      case 'marsh':    t = m > 0.45 ? T.MARSH : e > 0.85 ? T.HILLS : -1; break;
      case 'coast':    t = e > 0.78 ? T.HILLS : m > 0.82 ? T.FOREST : -1; break;
      default:         t = e > 0.8 ? T.HILLS : m > 0.86 ? T.FOREST : -1;   // plains
    }
    if (t === -1) {
      const s = m * 0.55 + (1 - e) * 0.45 + q;
      t = s > 0.78 ? T.FERTILE : s > 0.48 ? T.PLAIN : T.POOR;
    }
    land.t[i] = t;
  }

  // 2. sea along the edges facing water (ragged shoreline)
  const se = seaEdges(p);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(land, x, y), j = detail(x, y);
    const depth = (d, k) => d > 0 && k < d + (j > 0.6 ? 1 : 0) - (j < 0.25 ? 1 : 0);
    if (depth(se.n, y) || depth(se.s, H - 1 - y) || depth(se.w, x) || depth(se.e, W - 1 - x)) land.t[i] = T.WATER;
  }

  // 3. lake
  if (land.lake) {
    const cx = 2 + Math.floor(rng.next() * (W - 5)), cy = 2 + Math.floor(rng.next() * (H - 4));
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 2; x <= cx + 1; x++) {
      if (inside(land, x, y) && (rng.next() < 0.8 || (x === cx && y === cy))) land.t[idx(land, x, y)] = T.WATER;
    }
  }

  // 4. river: a meandering path across the grid; fertile banks
  const dir = RIVERS[p.name];
  if (dir) {
    if (dir === 'ns') {
      let x = 3 + Math.floor(rng.next() * (W - 6));
      for (let y = 0; y < H; y++) {
        land.t[idx(land, x, y)] = T.RIVER;
        const step = rng.next();
        if (step < 0.28 && x > 1) { x--; land.t[idx(land, x, y)] = T.RIVER; } else if (step > 0.72 && x < W - 2) { x++; land.t[idx(land, x, y)] = T.RIVER; }
      }
    } else {
      let y = 2 + Math.floor(rng.next() * (H - 4));
      for (let x = 0; x < W; x++) {
        land.t[idx(land, x, y)] = T.RIVER;
        const step = rng.next();
        if (step < 0.25 && y > 1) { y--; land.t[idx(land, x, y)] = T.RIVER; } else if (step > 0.75 && y < H - 2) { y++; land.t[idx(land, x, y)] = T.RIVER; }
      }
    }
    for (let i = 0; i < n; i++) {
      if (land.t[i] !== T.PLAIN && land.t[i] !== T.POOR && land.t[i] !== T.FERTILE) continue;
      const nearRiver = neighbours8(land, i).some(j => land.t[j] === T.RIVER);
      if (nearRiver) land.t[i] = rng.next() < 0.75 ? T.FERTILE : T.PLAIN;
    }
  }

  // 5. keep: the dry tile nearest the centre (prefer soil/hills, away from water)
  const dryish = [T.FERTILE, T.PLAIN, T.POOR, T.HILLS];
  let keep = -1, bestD = Infinity;
  for (let i = 0; i < n; i++) {
    if (!dryish.includes(land.t[i])) continue;
    const x = i % W, y = (i / W) | 0;
    const d = Math.hypot(x - (W - 1) / 2, (y - (H - 1) / 2) * 1.2) + (land.t[i] === T.FERTILE ? 0.8 : 0)
      + (neighbours4(land, i).some(j => land.t[j] === T.WATER || land.t[j] === T.RIVER) ? 1.5 : 0);
    if (d < bestD) { bestD = d; keep = i; }
  }
  if (keep < 0) { keep = idx(land, (W / 2) | 0, (H / 2) | 0); land.t[keep] = T.HILLS; }
  land.b[keep] = B.KEEP;

  // 6. resources: fixed (lore) then 0-2 random
  const wants = [...(FIXED_RES[p.name] || [])];
  const pool = RANDOM_RES[p.terrain] || [];
  const extra = rng.next() < 0.35 ? 0 : rng.next() < 0.7 ? 1 : 2;
  for (let k = 0; k < extra; k++) wants.push(pool[Math.floor(rng.next() * pool.length)]);
  for (const res of new Set(wants)) placeResource(land, res, rng);

  // 7. starting development to match the old abstract numbers (fields, market)
  if (opts.start !== false) seedBuildings(land, opts.start || {}, rng);
  return land;
}

function resourceTerrain(res) {
  switch (res) {
    case R.ORE: return [T.HILLS, T.ROCK];
    case R.SALT: return [T.POOR, T.PLAIN, T.MARSH];
    case R.PEARLS: return [T.WATER];
    case R.VINES: return [T.HILLS];
    case R.GROVE: return [T.FOREST, T.PLAIN, T.FERTILE];
    case R.SPRINGS: return [T.HILLS, T.POOR, T.ROCK, T.PLAIN];
    default: return [T.PLAIN, T.POOR, T.HILLS, T.FOREST, T.FERTILE];
  }
}
function placeResource(land, res, rng) {
  const okT = resourceTerrain(res);
  const cands = [];
  for (let i = 0; i < land.t.length; i++) {
    if (land.r[i] || land.b[i] || !okT.includes(land.t[i])) continue;
    if (res === R.PEARLS && !neighbours4(land, i).some(j => land.t[j] !== T.WATER && land.t[j] !== T.RIVER)) continue;
    cands.push(i);
  }
  if (!cands.length) {
    // make room: turn a suitable-ish tile into the right terrain (e.g. vines need a slope)
    if (res === R.PEARLS) return;
    const any = land.t.map((t, i) => i).filter(i => !land.b[i] && !land.r[i] && land.t[i] !== T.WATER && land.t[i] !== T.RIVER);
    if (!any.length) return;
    const i = any[Math.floor(rng.next() * any.length)];
    land.t[i] = okT[0]; land.r[i] = res; return;
  }
  land.r[cands[Math.floor(rng.next() * cands.length)]] = res;
}

// Place farms near the keep on the best soil and a few houses (and a market) so the province
// starts near the given abstract stats: fields ~ harvest/10, market ~ gold/0.6.
export function seedBuildings(land, { fields = 30, market = 25 } = {}, rng = makeRng(7)) {
  const k = land.b.indexOf(B.KEEP);
  const kx = k % land.w, ky = (k / land.w) | 0;
  const dist = i => Math.hypot(i % land.w - kx, ((i / land.w) | 0) - ky);
  const put = (i, b) => { if (land.b[i]) return false; land.b[i] = b; land.c[i] = 0; land.d[i] = 0; return true; };
  const free = (i, terr) => !land.b[i] && terr.includes(land.t[i]);
  const byDist = Array.from({ length: land.t.length }, (_, i) => i).sort((a, b) => dist(a) - dist(b));
  // houses around the keep
  const houses = 1 + Math.round(fields / 25);
  let placed = 0;
  for (const i of byDist) { if (placed >= houses) break; if (free(i, [T.FERTILE, T.PLAIN, T.POOR, T.HILLS]) && dist(i) < 2.5) { put(i, B.HOUSES); placed++; } }
  // farms on the best soil near the keep until the harvest reaches fields*10
  const targetFood = fields * 10;
  const soilRank = t => (t === T.FERTILE ? 0 : t === T.PLAIN ? 1 : 2);
  const farmTiles = byDist.filter(i => free(i, [T.FERTILE, T.PLAIN, T.POOR]))
    .sort((a, b) => soilRank(land.t[a]) - soilRank(land.t[b]) || dist(a) - dist(b));
  let farms = 0;
  for (const i of farmTiles) {
    if (land.b[i]) continue;
    if (provinceYield(land).food >= targetFood || farms >= 24) break;
    if (!put(i, B.FARM)) continue;
    farms++;
    // hands for the new farm: houses near the keep (prefer poorer tiles, not fertile soil)
    while (provinceYield(land).labour < 1) {
      const h = byDist.find(j => free(j, [T.POOR, T.HILLS, T.PLAIN])) ?? byDist.find(j => free(j, [T.FERTILE]));
      if (h == null || !put(h, B.HOUSES)) break;
    }
  }
  // market near the houses if trade is worth it, and a fishery for sea provinces
  if (market >= 20) {
    const m = byDist.find(i => free(i, [T.FERTILE, T.PLAIN, T.POOR, T.HILLS]) && neighbours8(land, i).filter(j => land.b[j] === B.HOUSES).length >= 1);
    if (m != null) put(m, B.MARKET);
  }
  if (market >= 40) {
    const m2 = byDist.find(i => free(i, [T.FERTILE, T.PLAIN, T.POOR, T.HILLS]) && neighbours8(land, i).some(j => land.b[j] === B.HOUSES));
    if (m2 != null) put(m2, B.HOUSES);
  }
  const fish = byDist.find(i => !land.b[i] && land.t[i] === T.WATER && neighbours4(land, i).some(j => land.t[j] !== T.WATER && land.t[j] !== T.RIVER));
  if (fish != null && rng.next() < 0.7) put(fish, B.FISHERY);
  return land;
}

// Convenience: the land of every province for a game (seeded), with starting development
// (opts.start(pid) -> {fields, market} or omitted for the defaults).
export function generateAllLand(seed, opts = {}) {
  return PROVINCES.map(p => generateLand(p.id, seed, { start: opts.start ? opts.start(p.id) : {} }));
}

export { BUILDING };
