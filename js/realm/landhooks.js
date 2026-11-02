// Bridge between the realm and the province land grids (js/land/*). Pure (no DOM).
//
// state.land[pid] holds each province's land (docs/LAND.md). A province's yields come from what is
// built on it; the old abstract `fields` / `market` numbers are kept only as derived values
// (synced every month with legacyStats) for display, research points and old saves.
// Saves without state.land fall back to the abstract economy everywhere.

import {
  provinceYield, legacyStats, build as landBuild, repair as landRepair, demolish as landDemolish,
  startProject, damage as landDamage, loot as landLoot, suggestBuild, potential, buildCost,
  listBuildable, PROJECT, B, T, BUILD_KEYS,
} from '../land/land.js';
import { generateAllLand } from '../land/landgen.js';
import { techEffect, hasTech } from './tech.js';
import { PROVINCES } from '../data/world.js';

export const landOf = (state, pid) => state.land?.[pid] || null;

// Tech effects that act on the land itself (the rest are applied by the economy).
//   Irrigation Channels: farms +10% · Guild Charters: buildings 10% cheaper ·
//   Fortification: walls and keep +5% defence (on top of its battle bonus).
export function landMods(state, house) {
  if (!house) return {};
  const m = {};
  if (techEffect(state, house, 'fieldsGain')) m.farm = 1.1;
  if (techEffect(state, house, 'marketGain')) m.cost = 0.9;
  if (hasTech(state, house, 'fortification')) m.defense = 0.05;
  return m;
}
export function landCtx(state, pid, extra = {}) {
  const pr = state.provinces[pid];
  return { gold: pr.gold, month: state.month, mods: landMods(state, pr.owner), ...extra };
}
export function yieldOf(state, pid) {
  const land = landOf(state, pid);
  return land ? provinceYield(land, landCtx(state, pid)) : null;
}

// Keep the abstract numbers in step with the land (UI, research points, tax order, old code).
export function syncLegacy(state, pid) {
  const y = yieldOf(state, pid);
  if (!y) return;
  const { fields, market } = legacyStats(y);
  const pr = state.provinces[pid];
  pr.fields = fields; pr.market = market;
}
export function syncAllLegacy(state) {
  if (!state.land) return;
  for (const pr of state.provinces) syncLegacy(state, pr.id);
}

// Land for a new game: each province starts developed to its abstract fields/market; `develop`
// scales the starting development (bigger scenarios start richer).
export function initLand(state, develop = 1) {
  const target = pid => {
    const pr = state.provinces[pid];
    const f = pr.owner ? develop : 1;
    return { fields: Math.round(pr.fields * f), market: Math.round(pr.market * f) };
  };
  state.land = generateAllLand(state.seed, { start: target });
  // Top up with the land's own builder (orchards on hills, fisheries, markets...) until each
  // province reaches the harvest and income its abstract numbers promised, where the land allows.
  // (Free holds keep their natural state, so barren land looks barren.)
  for (const pr of state.provinces) {
    if (!pr.owner) continue;
    const t = target(pr.id);
    topUp(state.land[pr.id], t.fields * 10, t.market * 0.6);
  }
  syncAllLegacy(state);
}
// Starting land only: turn one marsh or forest tile near the keep into farmland (as if drained or
// cleared long ago), so marsh and forest realms can reach their starting numbers.
function reclaim(land) {
  const k = land.b.indexOf(B.KEEP);
  const kx = k % land.w, ky = (k / land.w) | 0;
  let best = -1, bd = Infinity;
  for (let i = 0; i < land.t.length; i++) {
    if (land.b[i] || (land.t[i] !== T.MARSH && land.t[i] !== T.FOREST)) continue;
    const d = Math.hypot(i % land.w - kx, ((i / land.w) | 0) - ky);
    if (d < bd) { bd = d; best = i; }
  }
  if (best < 0) return false;
  land.t[best] = land.t[best] === T.MARSH ? T.FERTILE : T.PLAIN;
  return true;
}
function topUp(land, food, gold) {
  for (let k = 0; k < 40; k++) {
    const y = provinceYield(land);
    const goal = y.food < food ? 'food' : y.gold < gold ? 'gold' : null;
    if (!goal) return;
    const s = suggestBuild(land, {}, goal);
    if (!s) { if (!reclaim(land)) return; continue; }
    const i = s.y * land.w + s.x;
    land.b[i] = BUILD_KEYS.indexOf(s.kind); land.c[i] = 0; land.d[i] = 0;
  }
}

// Land quality for the UI and AI: 'breadbasket' | 'fertile' | 'modest' | 'barren'.
export function landPotential(state, pid) {
  const land = landOf(state, pid);
  return land ? potential(land) : null;
}
export function landQuality(state, pid) {
  const p = landPotential(state, pid);
  if (!p) return null;
  return p.food >= 900 ? 'breadbasket' : p.food >= 500 ? 'fertile' : p.food >= 250 ? 'modest' : 'barren';
}

// ---------- the build order ----------
// kind: a building key, a project ('clear' | 'drain' | 'excavate'), 'repair' or 'demolish';
// 'dikes' has no tile (it raises the province's dikes as the old develop order did).
export const DIKES_COST = 30;
export function applyBuild(state, pid, o) {
  const pr = state.provinces[pid];
  if (o.kind === 'dikes') {
    if (pr.dikes >= 100) return { ok: false, msg: 'The dikes are as high as they go.' };
    if (pr.gold < DIKES_COST) return { ok: false, msg: `Needs ${DIKES_COST} gold.` };
    pr.gold -= DIKES_COST;
    pr.dikes = Math.min(100, pr.dikes + 8);
    return { ok: true, msg: `The dikes are raised (now ${pr.dikes}).` };
  }
  const land = landOf(state, pid);
  if (!land) return { ok: false, msg: 'This province has no land map.' };
  const x = o.x | 0, y = o.y | 0;
  const ctx = landCtx(state, pid);
  let r;
  if (o.kind === 'repair') r = landRepair(land, x, y, ctx);
  else if (o.kind === 'demolish') r = landDemolish(land, x, y);
  else if (PROJECT[o.kind]) r = startProject(land, x, y, o.kind, ctx);
  else r = landBuild(land, x, y, o.kind, ctx);
  if (!r.ok) return r;
  const cost = r.cost || 0;
  if (cost > pr.gold) return { ok: false, msg: `Needs ${cost} gold.` };   // land.build checks too
  pr.gold -= cost;
  syncLegacy(state, pid);
  return { ok: true, cost, msg: r.msg };
}

// The cheapest thing the province could build now (for listOrders' cost / disabled reason).
export function cheapestBuild(state, pid) {
  const land = landOf(state, pid);
  if (!land) return null;
  const ctx = landCtx(state, pid);
  let best = Infinity;
  for (const key of ['farm', 'houses', 'market', 'orchard', 'lumber', 'granary']) {
    const c = buildCost(land, key, ctx);
    if (c < best) best = c;
  }
  return best;
}

// AI: the house's best build in a province, or null. goal: food | gold | army | loyalty | balanced
export function aiBuild(state, pid, goal, reserve = 0) {
  const land = landOf(state, pid);
  if (!land) return null;
  const ctx = landCtx(state, pid, { gold: state.provinces[pid].gold - reserve });
  if (ctx.gold <= 0) return null;
  const s = suggestBuild(land, ctx, goal);
  if (!s) {
    const d = land.d.findIndex(v => v);
    if (d >= 0) return { province: pid, type: 'build', kind: 'repair', x: d % land.w, y: (d / land.w) | 0 };
    return null;
  }
  return { province: pid, type: 'build', kind: s.kind, x: s.x, y: s.y };
}

// ---------- war ----------
// After a province changes hands: battle damage by intensity (0..1).
export function warDamage(state, pid, intensity, rng) {
  const land = landOf(state, pid);
  if (!land) return null;
  const r = landDamage(land, Math.max(0, Math.min(1, intensity)), rng);
  syncLegacy(state, pid);
  return r;
}
// The conqueror sacks the province: gold now, loyalty -25, buildings damaged.
export function applyLoot(state, pid, rng) {
  const land = landOf(state, pid);
  const pr = state.provinces[pid];
  if (!land) {
    const g = Math.round(pr.gold * 0.5 + 40);
    pr.gold += g; pr.loyalty = Math.max(0, pr.loyalty - 25);
    return { gold: g };
  }
  const r = landLoot(land, rng);
  pr.gold += r.gold;
  pr.lootedTurn = state.turn;   // the land view shows the looted-town banner
  pr.loyalty = Math.max(0, pr.loyalty + r.loyalty);
  syncLegacy(state, pid);
  return r;
}

// Seed Banks: one damaged farm recovers each month for free.
export function seedBankRegrow(state, pid) {
  const land = landOf(state, pid);
  if (!land) return;
  const i = land.d.findIndex((d, k) => d && land.b[k] === B.FARM);
  if (i >= 0) land.d[i] = 0;
}

// Events that hurt fields or markets damage the land instead.
export function eventDamage(state, pid, effect, rng) {
  const land = landOf(state, pid);
  if (!land) return false;
  const hurt = Math.max(0, -(effect.fields || 0)) + Math.max(0, -(effect.market || 0));
  if (hurt > 0) landDamage(land, Math.min(0.5, hurt / 40), rng);
  return true;
}

export { listBuildable, potential, PROJECT, T, B };
export const isFarmTerrain = t => t === T.FERTILE || t === T.PLAIN || t === T.POOR;
export const provinceTerrain = pid => PROVINCES[pid].terrain;
