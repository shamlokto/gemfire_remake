// Monthly economy tick: income, harvest, upkeep, wages, loyalty drift, random events, revolts.
// Mutates state. Pure (no DOM).

import { RANDOM_EVENTS } from '../data/events.js';
import { COMPANIES } from '../data/units.js';
import { PROVINCES, seasonOf, NEUTRAL_MILITIA, ADJACENCY } from '../data/world.js';
import { techEffect } from './tech.js';
import { monthTick as landTick } from '../land/land.js';
import { landOf, yieldOf, syncLegacy, seedBankRegrow, eventDamage } from './landhooks.js';
import {
  governorOf, provinceUpkeep, addLog, provinceName, isPlayerControlled,
} from './state.js';

// Tunables (DESIGN.md numbers, with the harvest raised so armies can be fed).
export const GOLD_RATE = 0.6;
export const LAND_GOLD = 0.6;     // land gold (taxes, markets, mines) to treasury, keeps the old income scale
export const HARVEST_MONTH = 6;
export const HARVEST_RATE = 10;
export const REVOLT_LOYALTY = 20;
export const REVOLT_CHANCE = 0.3;
export const MILITIA_GROWTH = 3;
export const SOLDIERS_PER_GOLD = 50;   // troop pay: 1 gold per 50 soldiers per month
export const DESERT_UNPAID = 0.05;     // unpaid troops: this share deserts each month

const clamp = (x, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
const loyaltyFactor = pr => 0.5 + pr.loyalty / 200;

// `state` is optional in these helpers: without it, tech bonuses are ignored (old callers/tests).
const owns = (state, pr) => (state ? pr.owner : null);
// With land (state.land), the base comes from what is built on the province (js/land);
// otherwise from the abstract market/fields numbers.
export function goldIncome(pr, state = null) {
  const h = owns(state, pr);
  const y = state ? yieldOf(state, pr.id) : null;
  let g = (y ? y.gold * LAND_GOLD : pr.market * GOLD_RATE) * loyaltyFactor(pr) * (1 + techEffect(state, h, 'gold'));
  const trade = techEffect(state, h, 'tradeGold');
  if (trade) g += Math.min(4, trade * ADJACENCY[pr.id].filter(n => state.provinces[n].owner === h).length);
  return Math.round(g);
}
export function harvestYield(pr, state = null) {
  const h = owns(state, pr);
  const high = ['hills', 'mountain'].includes(PROVINCES[pr.id]?.terrain) ? techEffect(state, h, 'highHarvest') : 0;
  const y = state ? yieldOf(state, pr.id) : null;
  return Math.round((y ? y.food : pr.fields * HARVEST_RATE) * loyaltyFactor(pr) * (1 + techEffect(state, h, 'harvest') + high));
}
// Monster companies are cheaper with Beast-Taming.
export function companyDiscount(state, house, type) {
  return COMPANIES[type]?.monster ? 1 + techEffect(state, house, 'monsterCost') : 1;
}
export function companyWage(pr, state = null) {
  return pr.company ? Math.round(COMPANIES[pr.company.type].wage * companyDiscount(state, owns(state, pr), pr.company.type)) : 0;
}
export function troopPay(pr) { return Math.round(pr.units.reduce((a, u) => a + u.soldiers, 0) / SOLDIERS_PER_GOLD); }
export function loyaltyTarget(state, pid) {
  const g = governorOf(state, pid);
  const y = yieldOf(state, pid);          // temples, springs, overcrowding
  return clamp(40 + (g ? g.charm / 4 : 0) + (y ? y.loyaltyMod : 0));
}
export const WINTER_MONTH = 9;            // stored food above granary storage spoils at the start of winter
export const STORE_BASE = 150;            // food a province keeps safely without granaries

// Applies an event effect to a province (shared with tests and diplomacy).
export function applyEffect(state, pr, effect, rng = null) {
  // With land, lost fields and markets are damaged buildings instead.
  const landHit = rng && (effect.fields < 0 || effect.market < 0) && eventDamage(state, pr.id, effect, rng);
  if (effect.foodPct) pr.food = Math.max(0, Math.round(pr.food * (1 + effect.foodPct)));
  if (effect.goldPct) pr.gold = Math.max(0, Math.round(pr.gold * (1 + effect.goldPct)));
  for (const k of ['fields', 'market', 'dikes', 'loyalty']) {
    if (!effect[k] || (landHit && (k === 'fields' || k === 'market'))) continue;
    pr[k] = clamp(pr[k] + effect[k]);
  }
  if (landHit) syncLegacy(state, pr.id);
  if (effect.soldiersPct) {
    for (const u of pr.units) u.soldiers = Math.max(0, Math.round(u.soldiers * (1 + effect.soldiersPct)));
    pr.units = pr.units.filter(u => u.soldiers > 0);
    if (pr.company) pr.company.soldiers = Math.max(0, Math.round(pr.company.soldiers * (1 + effect.soldiersPct)));
    pr.militia = pr.militia.map(n => Math.max(0, Math.round(n * (1 + effect.soldiersPct)))).filter(n => n > 0);
  }
}

function fireEvent(state, pr, ev, rng = null) {
  // Granaries halve the food that famine and storms spoil.
  const foodLoss = techEffect(state, pr.owner, 'foodLoss');
  const eff = foodLoss && ev.effect.foodPct < 0 ? { ...ev.effect, foodPct: ev.effect.foodPct * (1 - foodLoss) } : ev.effect;
  applyEffect(state, pr, eff, rng);
  const text = ev.text.replace('{province}', provinceName(pr.id));
  addLog(state, `${ev.title}: ${text}`, 'event', ev.art);
  if (isPlayerControlled(state, pr.owner)) state.pendingEvents.push({ art: ev.art, title: ev.title, text });
}

export function monthlyTick(state, rng) {
  const s = seasonOf(state.month);
  const revolt = RANDOM_EVENTS.find(e => e.id === 'revolt');
  for (const pr of state.provinces) {
    if (!pr.owner) {
      // Free holds slowly rebuild their militia (one more unit if all were lost).
      if (!pr.militia.length) pr.militia.push(10);
      const total = pr.militia.reduce((a, n) => a + n, 0);
      if (total < NEUTRAL_MILITIA.max + 40) pr.militia[pr.militia.indexOf(Math.min(...pr.militia))] += MILITIA_GROWTH;
      continue;
    }
    // Land: construction and projects advance; barracks drill; Seed Banks regrow a burnt farm.
    const land = landOf(state, pr.id);
    if (land) {
      const t = landTick(land, rng);
      pr.gold += t.gold;
      if (t.done.length && isPlayerControlled(state, pr.owner)) {
        addLog(state, `${provinceName(pr.id)}: ${t.done.map(d => d.what).join(', ')} finished.`, 'build');
      }
      if (techEffect(state, pr.owner, 'fieldsRegrow')) seedBankRegrow(state, pr.id);
      const y = yieldOf(state, pr.id);
      if (y.trainingBonus) for (const u of pr.units) u.training = clamp(u.training + y.trainingBonus);
      // Winter spoilage of food beyond what the granaries keep.
      if (state.month === WINTER_MONTH) {
        const safe = STORE_BASE + y.storage;
        if (pr.food > safe) pr.food -= Math.round((pr.food - safe) * y.winterSpoilage);
      }
    }
    // Income
    pr.gold += goldIncome(pr, state);
    if (state.month === HARVEST_MONTH) {
      const y = harvestYield(pr, state);
      pr.food += y;
    }
    const regrow = techEffect(state, pr.owner, 'fieldsRegrow');
    if (!land && regrow && pr.fields < 60) pr.fields = clamp(pr.fields + regrow);
    // Upkeep
    pr.food -= Math.round(foodUpkeep(state, pr));
    pr.gold -= companyWage(pr, state) + troopPay(pr);
    if (pr.food < 0) {
      pr.food = 0;
      for (const u of pr.units) u.soldiers = Math.floor(u.soldiers * 0.9);
      pr.units = pr.units.filter(u => u.soldiers > 0);
      pr.loyalty = clamp(pr.loyalty - 10);
      addLog(state, `Hunger in ${provinceName(pr.id)}: soldiers desert.`, 'warn');
    }
    if (pr.gold < 0) {
      pr.gold = 0;
      for (const u of pr.units) u.soldiers = Math.floor(u.soldiers * (1 - DESERT_UNPAID));
      pr.units = pr.units.filter(u => u.soldiers > 0);
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
      fireEvent(state, pr, revolt, rng);
      pr.loyalty = clamp(pr.loyalty + 15);   // the anger is spent
      continue;
    }
    // Random events for this season
    for (const ev of RANDOM_EVENTS) {
      if (!ev.chance || !ev.seasons.includes(s)) continue;
      let p = ev.chance;
      if (ev.floodable) p *= (1 - pr.dikes / 120) * (1 - techEffect(state, pr.owner, 'floodChance'));
      if (rng.chance(p)) { fireEvent(state, pr, ev, rng); break; }
    }
  }
  for (const pr of state.provinces) syncLegacy(state, pr.id);
}

// Food eaten by a province's troops this month (Granaries cut it).
export function foodUpkeep(state, pr) {
  return provinceUpkeep(state, pr.id) * (1 + techEffect(state, pr.owner, 'upkeep'));
}

// Forecast for the UI: what a province will gain or lose next month.
export function forecast(state, pid) {
  const pr = state.provinces[pid];
  if (!pr.owner) return null;
  return {
    gold: goldIncome(pr, state) - companyWage(pr, state) - troopPay(pr),
    pay: troopPay(pr),
    food: -Math.round(foodUpkeep(state, pr)),
    harvest: harvestYield(pr, state),
    loyaltyTarget: Math.round(loyaltyTarget(state, pid)),
    name: PROVINCES[pid].name,
    land: yieldOf(state, pid),
  };
}
