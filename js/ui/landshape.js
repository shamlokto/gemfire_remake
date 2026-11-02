// Procedural landmasses for the world map, used when there is no painted map yet (canvas in
// mapview.js and the SVG placeholders in tools/make_placeholders.mjs). Pure and deterministic.
//
// Each region (world.js) becomes one island: wobbly discs around its provinces, filled corridors
// along land borders, and filled polygons for small cycles of land borders (so the mainland has no
// holes). Disc radii shrink near provinces of other regions so islands never touch.
import { PROVINCES, ADJACENCY, SEA_LANES, isSeaLane } from '../data/world.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Land borders (not sea lanes) as [a, b] with a < b.
export const LAND_EDGES = [];
ADJACENCY.forEach((ns, a) => ns.forEach(b => { if (b > a && !isSeaLane(a, b)) LAND_EDGES.push([a, b]); }));
export { SEA_LANES };

// Province disc radius: up to 74, at most 38% of the distance to the nearest other-region province.
// Peninsula and dead-end provinces (two or fewer land borders) also keep a gap to nearby provinces
// they do not border, so a neck of land like Fenwick reads as the only way in.
const LAND_DEGREE = PROVINCES.map(p => LAND_EDGES.filter(e => e.includes(p.id)).length);
export const RADIUS = PROVINCES.map(p => {
  let r = 74;
  for (const q of PROVINCES) {
    if (q.id === p.id) continue;
    if (q.region !== p.region) r = Math.min(r, dist(p, q) * 0.38);
    else if (!ADJACENCY[p.id].includes(q.id) && (LAND_DEGREE[p.id] <= 2 || LAND_DEGREE[q.id] <= 2)) r = Math.min(r, dist(p, q) * 0.42);
  }
  return r;
});

// Simple cycles (length 3-5) of land edges: filled so the mainland has no holes.
function cycles() {
  const adj = PROVINCES.map(() => []);
  for (const [a, b] of LAND_EDGES) { adj[a].push(b); adj[b].push(a); }
  const found = new Map();
  const walk = (start, path) => {
    const last = path[path.length - 1];
    for (const n of adj[last]) {
      if (n === start && path.length >= 3) {
        const key = [...path].sort((x, y) => x - y).join(',');
        if (!found.has(key)) found.set(key, [...path]);
      } else if (n > start && !path.includes(n) && path.length < 5) walk(start, [...path, n]);
    }
  };
  PROVINCES.forEach(p => walk(p.id, [p.id]));
  // Drop cycles that contain another (smaller) cycle's vertex set strictly inside? Keep all: fills overlap harmlessly,
  // but skip long cycles whose polygon would swallow a province outside the cycle.
  const out = [];
  for (const cyc of found.values()) {
    const poly = cyc.map(i => PROVINCES[i]);
    const inside = PROVINCES.some(p => !cyc.includes(p.id) && pointInPoly(p, poly));
    if (!inside) out.push(cyc);
  }
  return out;
}

function pointInPoly(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

let cache = null;
// Returns { circles: [{x, y, r, region}], polys: [{pts: [{x,y}], region}] } in map space (1000 x 750).
export function landShapes() {
  if (cache) return cache;
  const circles = [], polys = [];
  for (const p of PROVINCES) {
    const R = RADIUS[p.id], r = rng(1000 + p.id * 77);
    circles.push({ x: p.x, y: p.y, r: R, region: p.region });
    const n = 7;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + r() * 0.8;
      const d = R * (0.35 + r() * 0.3);
      circles.push({ x: p.x + Math.cos(ang) * d, y: p.y + Math.sin(ang) * d, r: R * (0.45 + r() * 0.25), region: p.region });
    }
  }
  for (const [a, b] of LAND_EDGES) {
    const A = PROVINCES[a], B = PROVINCES[b];
    const w = Math.min(RADIUS[a], RADIUS[b]) * 0.62;
    const steps = Math.ceil(dist(A, B) / 18), r = rng(a * 31 + b);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      circles.push({ x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t, r: w * (0.85 + r() * 0.3), region: A.region });
    }
  }
  for (const cyc of cycles()) polys.push({ pts: cyc.map(i => ({ x: PROVINCES[i].x, y: PROVINCES[i].y })), region: PROVINCES[cyc[0]].region });
  cache = { circles, polys };
  return cache;
}

// Land palette per season (0 spring, 1 summer, 2 autumn, 3 winter).
export const LAND_PALETTE = [
  { land: '#a9c27a', land2: '#7f9e57', beach: '#e3d29b', coast: '#2c3a2a', sea: ['#3c7393', '#1d4560'] },
  { land: '#c9b978', land2: '#9a9a55', beach: '#ead7a0', coast: '#3a3220', sea: ['#3a7092', '#1b425e'] },
  { land: '#c79a5a', land2: '#9a6a38', beach: '#e2c993', coast: '#3a2814', sea: ['#3a6580', '#1b3b52'] },
  { land: '#e6ecf0', land2: '#bfcbd4', beach: '#f2f4f6', coast: '#4a5662', sea: ['#47657a', '#24394a'] },
];
