// Research and shard charge. Pure (no DOM); mutates state.
//
// state.houses[id].tech = { researched: [techId], progress: { techId: points }, focus: techId|null }
// state.houses[id].charge = { spiritId: 0..100 }   charge of each shard the house holds
//
// Research: each month a house earns researchPoints() (markets) into its focus tech; `study`
// orders add more (orders.js). AI houses (and players with no focus) pick a focus with
// chooseResearch(). Techs complete when progress reaches techCost().
//
// Shard charge: summoning a spirit needs a full charge (CHARGE_MAX) and spends it. Each month every
// shard a house holds recharges by chargeGain(): driven by the average loyalty of all the house's
// provinces, so squeezing the people slows the spirits. A captured shard starts empty.

import { TECHS, TECH_BY_ID, TECH_COST, TECH_INFLATION, BRANCH_IDS, RESEARCH_LEANING, techsOf } from '../data/tech.js';
import { SPIRITS } from '../data/spirits.js';
import { addLog, ownedProvinces, isPlayerControlled, houseName } from './state.js';

// ---------- tech queries ----------
export function techState(state, house) {
  const h = state.houses[house];
  if (!h) return null;
  if (!h.tech) h.tech = { researched: [], progress: {}, focus: null };
  return h.tech;
}
export function hasTech(state, house, id) {
  return !!house && !!state.houses[house]?.tech?.researched.includes(id);
}
// Sum of a numeric effect over the house's researched techs (0 if none).
export function techEffect(state, house, key) {
  const t = house && state.houses[house]?.tech;
  if (!t) return 0;
  let s = 0;
  for (const id of t.researched) { const v = TECH_BY_ID[id]?.effect[key]; if (typeof v === 'number') s += v; }
  return s;
}
export function techUnlocks(state, house) {
  const t = house && state.houses[house]?.tech;
  return t ? t.researched.flatMap(id => TECH_BY_ID[id]?.effect.unlock || []) : [];
}
export function techCost(state, house, id) {
  const t = TECH_BY_ID[id];
  const known = state.houses[house]?.tech?.researched.length || 0;
  return Math.round(TECH_COST[t.tier] * (1 + TECH_INFLATION * known));
}
export function canResearch(state, house, id) {
  const t = TECH_BY_ID[id];
  if (!t || hasTech(state, house, id)) return false;
  return t.requires.every(r => hasTech(state, house, r));
}
export function availableTechs(state, house) {
  return TECHS.filter(t => canResearch(state, house, t.id));
}
export function nextInBranch(state, house, branch) {
  return techsOf(branch).filter(t => canResearch(state, house, t.id)).sort((a, b) => a.tier - b.tier)[0] || null;
}

// Monthly research from markets: 1 point per 30 market across the house's provinces.
export const MARKET_PER_POINT = 30;
export function researchPoints(state, house) {
  return Math.round(ownedProvinces(state, house).reduce((a, p) => a + p.market, 0) / MARKET_PER_POINT * 10) / 10;
}
// Points from a `study` order: 6 + the best Wits in the province / 8.
export const studyPoints = wits => Math.round(6 + (wits || 0) / 8);

// Free action: choose what to research.
export function setResearch(state, house, id) {
  if (!canResearch(state, house, id)) return { ok: false, msg: 'That cannot be researched yet.' };
  techState(state, house).focus = id;
  return { ok: true, msg: `Scholars turn to ${TECH_BY_ID[id].name}.` };
}

// Adds points to a tech (default: the focus); completes it when paid for.
export function addResearch(state, house, pts, id = null) {
  const t = techState(state, house);
  let target = id || t.focus;
  if (!target || !canResearch(state, house, target)) target = chooseResearch(state, house);
  if (!target) return null;
  t.progress[target] = (t.progress[target] || 0) + pts;
  const cost = techCost(state, house, target);
  if (t.progress[target] >= cost) {
    const over = t.progress[target] - cost;
    delete t.progress[target];
    t.researched.push(target);
    if (t.focus === target) t.focus = null;
    const name = TECH_BY_ID[target].name;
    addLog(state, `${houseName(house)} masters ${name}.`, 'tech');
    if (isPlayerControlled(state, house)) {
      state.pendingEvents.push({ title: `Research: ${name}`, text: TECH_BY_ID[target].text, kind: 'tech' });
    }
    if (over > 0) addResearch(state, house, over);
    return target;
  }
  return null;
}

// AI (and default) choice: the cheapest available tech, weighted by the house's leanings.
export function chooseResearch(state, house) {
  const t = techState(state, house);
  const lean = RESEARCH_LEANING[house] || {};
  const opts = availableTechs(state, house);
  if (!opts.length) return null;
  let best = null, bs = -Infinity;
  for (const o of opts) {
    let s = (lean[o.branch] || 1) * 10 - o.tier * 6 + (t.progress[o.id] || 0) / 10;
    if (o.id === 'black_powder' || o.id === 'attunement') s += 4;
    if (s > bs) { bs = s; best = o; }
  }
  if (!isPlayerControlled(state, house) || !t.focus) t.focus = best.id;
  return best.id;
}

export function researchTick(state) {
  for (const [id, h] of Object.entries(state.houses)) {
    if (!h.alive) continue;
    const pts = researchPoints(state, id);
    if (pts > 0) addResearch(state, id, pts);
  }
}

// ---------- shard charge ----------
export const CHARGE_MAX = 100;
export const CHARGE_LOYALTY_FLOOR = 35;
export const CHARGE_RATE = 0.5;

export function averageLoyalty(state, house) {
  const ps = ownedProvinces(state, house);
  return ps.length ? ps.reduce((a, p) => a + p.loyalty, 0) / ps.length : 0;
}
// Charge gained per month by each shard the house holds.
export function chargeGain(state, house) {
  const base = Math.max(0, averageLoyalty(state, house) - CHARGE_LOYALTY_FLOOR) * CHARGE_RATE;
  return Math.round(base * (1 + techEffect(state, house, 'recharge')) * 10) / 10;
}
export function shardCharge(state, house, spirit) {
  return state.houses[house]?.charge?.[spirit] ?? 0;
}
export function setCharge(state, house, spirit, v) {
  const h = state.houses[house];
  if (!h) return;
  if (!h.charge) h.charge = {};
  h.charge[spirit] = Math.max(0, Math.min(CHARGE_MAX, v));
}
// Spend a summon (the battle used the spirit).
export function spendCharge(state, house, spirit) {
  setCharge(state, house, spirit, techEffect(state, house, 'chargeRefund'));
}
export function chargeTick(state) {
  for (const [id, h] of Object.entries(state.houses)) {
    if (!h.alive) continue;
    const g = chargeGain(state, id);
    const held = new Set(state.provinces.filter(p => p.owner === id && p.shard).map(p => p.shard));
    if (!h.charge) h.charge = {};
    for (const sp of Object.keys(h.charge)) if (!held.has(sp)) delete h.charge[sp];
    for (const sp of held) {
      const before = h.charge[sp] ?? 0;
      setCharge(state, id, sp, before + g);
      if (before < CHARGE_MAX && h.charge[sp] >= CHARGE_MAX && isPlayerControlled(state, id)) {
        addLog(state, `The ${SPIRITS[sp].name} stirs in its shard: ready to be summoned.`, 'story');
      }
    }
  }
}
// For the UI: each shard the house holds with its charge, monthly gain and readiness.
export function shardStatus(state, house) {
  const gain = chargeGain(state, house);
  return state.provinces.filter(p => p.owner === house && p.shard).map(p => {
    const charge = Math.floor(shardCharge(state, house, p.shard));
    return {
      id: p.shard, province: p.id, charge, gain, ready: charge >= CHARGE_MAX,
      months: charge >= CHARGE_MAX ? 0 : gain > 0 ? Math.ceil((CHARGE_MAX - charge) / gain) : Infinity,
      reason: charge >= CHARGE_MAX ? null : `Recharging: ${charge}/${CHARGE_MAX}, ${gain > 0 ? '+' + gain + '/month' : 'not recharging (loyalty too low)'}`,
    };
  });
}

export { BRANCH_IDS };
