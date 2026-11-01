// Monthly economy tick: income, harvest, upkeep, wages, loyalty drift, random events, revolts.
// Mutates state. Pure (no DOM).

import { RANDOM_EVENTS } from '../data/events.js';
import { COMPANIES } from '../data/units.js';
import { PROVINCES, seasonOf, NEUTRAL_MILITIA } from '../data/world.js';
import {
  governorOf, provinceVassals, provinceUpkeep, addLog, provinceName, isPlayerControlled,
} from './state.js';

// Tunables (DESIGN.md numbers, with the harvest raised so armies can be fed).
export const GOLD_RATE = 0.6;
export const HARVEST_MONTH = 6;
export const HARVEST_RATE = 10;
export const REVOLT_LOYALTY = 20;
export const REVOLT_CHANCE = 0.3;
export const MILITIA_GROWTH = 3;

const clamp = (x, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
const loyaltyFactor = pr => 0.5 + pr.loyalty / 200;

export function goldIncome(pr) { return Math.round(pr.market * GOLD_RATE * loyaltyFactor(pr)); }
export function harvestYield(pr) { return Math.round(pr.fields * HARVEST_RATE * loyaltyFactor(pr)); }
export function companyWage(pr) { return pr.company ? COMPANIES[pr.company.type].wage : 0; }
export function loyaltyTarget(state, pid) {
  const g = governorOf(state, pid);
  return 40 + (g ? g.charm / 4 : 0);
}

// Applies an event effect to a province (shared with tests and diplomacy).
export function applyEffect(state, pr, effect) {
  if (effect.foodPct) pr.food = Math.max(0, Math.round(pr.food * (1 + effect.foodPct)));
  if (effect.goldPct) pr.gold = Math.max(0, Math.round(pr.gold * (1 + effect.goldPct)));
  for (const k of ['fields', 'market', 'dikes', 'loyalty']) if (effect[k]) pr[k] = clamp(pr[k] + effect[k]);
  if (effect.soldiersPct) {
    for (const v of provinceVassals(state, pr.id)) v.soldiers = Math.max(0, Math.round(v.soldiers * (1 + effect.soldiersPct)));
    if (pr.company) pr.company.soldiers = Math.max(0, Math.round(pr.company.soldiers * (1 + effect.soldiersPct)));
    if (!pr.owner) pr.militia = Math.max(0, Math.round(pr.militia * (1 + effect.soldiersPct)));
  }
}

function fireEvent(state, pr, ev) {
  applyEffect(state, pr, ev.effect);
  const text = ev.text.replace('{province}', provinceName(pr.id));
  addLog(state, `${ev.title}: ${text}`, 'event', ev.art);
  if (isPlayerControlled(state, pr.owner)) state.pendingEvents.push({ art: ev.art, title: ev.title, text });
}

export function monthlyTick(state, rng) {
  const s = seasonOf(state.month);
  const revolt = RANDOM_EVENTS.find(e => e.id === 'revolt');
  for (const pr of state.provinces) {
    if (!pr.owner) {
      pr.militia = Math.min(NEUTRAL_MILITIA.max + 40, pr.militia + MILITIA_GROWTH);
      continue;
    }
    // Income
    pr.gold += goldIncome(pr);
    if (state.month === HARVEST_MONTH) {
      const y = harvestYield(pr);
      pr.food += y;
    }
    // Upkeep
    pr.food -= Math.round(provinceUpkeep(state, pr.id));
    pr.gold -= companyWage(pr);
    if (pr.food < 0) {
      pr.food = 0;
      for (const v of provinceVassals(state, pr.id)) v.soldiers = Math.floor(v.soldiers * 0.9);
      pr.loyalty = clamp(pr.loyalty - 10);
      addLog(state, `Hunger in ${provinceName(pr.id)}: soldiers desert.`, 'warn');
    }
    if (pr.gold < 0) {
      pr.gold = 0;
      if (pr.company) {
        addLog(state, `Unpaid, the ${COMPANIES[pr.company.type].name} leave ${provinceName(pr.id)}.`, 'warn');
        pr.company = null;
      }
    }
    if (pr.company && pr.company.soldiers <= 0) pr.company = null;
    // Loyalty drift toward the governor's target
    const target = loyaltyTarget(state, pr.id);
    const d = target - pr.loyalty;
    if (d) pr.loyalty = clamp(pr.loyalty + Math.sign(d) * Math.min(2, Math.abs(d)));
    // Revolt
    if (pr.loyalty < REVOLT_LOYALTY && rng.chance(REVOLT_CHANCE)) {
      fireEvent(state, pr, revolt);
      pr.loyalty = clamp(pr.loyalty + 15);   // the anger is spent
      continue;
    }
    // Random events for this season
    for (const ev of RANDOM_EVENTS) {
      if (!ev.chance || !ev.seasons.includes(s)) continue;
      let p = ev.chance;
      if (ev.floodable) p *= 1 - pr.dikes / 120;
      if (rng.chance(p)) { fireEvent(state, pr, ev); break; }
    }
  }
}

// Forecast for the UI: what a province will gain or lose next month.
export function forecast(state, pid) {
  const pr = state.provinces[pid];
  if (!pr.owner) return null;
  return {
    gold: goldIncome(pr) - companyWage(pr),
    food: -Math.round(provinceUpkeep(state, pid)),
    harvest: harvestYield(pr),
    loyaltyTarget: Math.round(loyaltyTarget(state, pid)),
    name: PROVINCES[pid].name,
  };
}
