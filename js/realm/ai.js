// Realm AI: planHouseOrders(state, houseId, rng) -> order[] (one per owned province).
// Utility rules, in priority order per province: attack a clearly weaker neighbour (free holds
// and shard provinces are preferred), reinforce when threatened, keep units full and drilled,
// feast when loyalty is low, develop otherwise; interior armies move toward the frontier.
// Once per month the house may also try diplomacy from its capital. Reads state only.

import { TROOPS, COMPANIES, MAX_SOLDIERS, MAX_VASSALS_PER_PROVINCE } from '../data/units.js';
import { ADJACENCY } from '../data/world.js';
import {
  ownedProvinces, provinceVassals, provinceDefence, vassalPower, unitPower, atPeace,
  housePower, captivesOf, isRuler, provinceUpkeep, envoyOf,
} from './state.js';
import { DEVELOP_COST, FEAST_FOOD, MAX_MARCH, musterCost } from './orders.js';
import { truceChance, bribeCost, bribeChance, biggestThreat } from './diplomacy.js';
import { HARVEST_MONTH } from './economy.js';

// Tunables (exported object so tests can sweep them).
export const TUNING = {
  attackRatio: 1.6,        // our power / their defence needed to attack a house
  freeholdRatio: 1.4,      // ... a free hold
  minMarchSoldiers: 120,   // a vassal joins an attack only with this many soldiers
  minMarchTraining: 40,
  aggression: 0.6,         // chance per province per month to consider attacking a house
};
const RESERVE_GOLD = 30;

function hostile(state, house, pid) {
  const o = state.provinces[pid].owner;
  return o !== house && !(o && atPeace(state, house, o));
}

// Distance (in steps) from each province to the nearest hostile province.
function frontierDistance(state, house) {
  const dist = state.provinces.map(() => Infinity);
  const q = [];
  for (const p of state.provinces) if (hostile(state, house, p.id)) { dist[p.id] = 0; q.push(p.id); }
  while (q.length) {
    const c = q.shift();
    for (const n of ADJACENCY[c]) if (dist[n] > dist[c] + 1) { dist[n] = dist[c] + 1; q.push(n); }
  }
  return dist;
}

// Strongest hostile army that could strike this province next month.
function threatTo(state, house, pid) {
  let t = 0;
  for (const n of ADJACENCY[pid]) {
    const p = state.provinces[n];
    if (!p.owner || !hostile(state, house, n)) continue;
    const s = provinceVassals(state, n).reduce((a, v) => a + vassalPower(v), 0) +
      (p.company ? unitPower(p.company.type, p.company.soldiers, 60, 50) : 0);
    t = Math.max(t, s);
  }
  return t;
}

const companyPower = c => (c ? unitPower(c.type, c.soldiers, 60, 50) : 0);

export function planHouseOrders(state, house, rng) {
  const orders = [];
  const owned = ownedProvinces(state, house);
  if (!owned.length) return orders;
  const dist = frontierDistance(state, house);
  const total = owned.length;
  const early = state.turn < 48;
  let diplomacyDone = false;
  const incoming = {};                    // vassal slots already claimed by planned transfers

  // Frontier provinces first, so their decisions see full strength.
  const list = [...owned].sort((a, b) => dist[a.id] - dist[b.id] || a.id - b.id);
  for (const pr of list) {
    const o = planProvince(state, house, pr, rng, { dist, early, total, incoming, diplomacyDone });
    if (o) {
      if (o.type === 'diplomacy') diplomacyDone = true;
      orders.push(o);
    }
  }
  return orders;
}

function planProvince(state, house, pr, rng, ctx) {
  const pid = pr.id;
  const vs = provinceVassals(state, pid);
  const myPower = vs.reduce((a, v) => a + vassalPower(v), 0) + companyPower(pr.company);
  const threat = threatTo(state, house, pid);
  const upkeep = provinceUpkeep(state, pid);
  const monthsToHarvest = (HARVEST_MONTH - state.month + 12) % 12 || 12;
  const foodTight = pr.food < upkeep * (monthsToHarvest + 1);

  if (!vs.length) {
    if (pr.loyalty < 40 && pr.food >= FEAST_FOOD * 2) return { province: pid, type: 'govern', kind: 'feast' };
    if (pr.gold >= DEVELOP_COST) return develop(pr, foodTight, state);
    return { province: pid, type: 'rest' };
  }

  // --- Attack ---
  const attack = chooseAttack(state, house, pr, vs, threat, ctx, rng);
  if (attack) return attack;

  // --- Emergency: hungry or rebellious ---
  if (pr.loyalty < 30 && pr.food >= FEAST_FOOD * 2 && !foodTight) return { province: pid, type: 'govern', kind: 'feast' };

  // --- Reinforce ---
  const threatened = threat > myPower * 0.8;
  const weakest = vs.reduce((a, b) => (b.soldiers < a.soldiers ? b : a));
  const room = MAX_SOLDIERS - weakest.soldiers;
  const want = threatened ? room : (weakest.soldiers < 300 ? Math.min(room, 300 - weakest.soldiers + 50) : 0);
  if (want >= 40 && !foodTight) {
    const per10 = TROOPS[weakest.troop].cost;
    const spend = Math.max(0, pr.gold - RESERVE_GOLD);
    const n = Math.min(want, Math.floor(spend / per10) * 10);
    if (n >= 40 || (threatened && n >= 20)) return { province: pid, type: 'muster', vassal: weakest.id, soldiers: n };
  }

  // --- Hire a company when threatened and rich ---
  if (threatened && !pr.company && rng.chance(0.5)) {
    const options = Object.entries(COMPANIES).filter(([, c]) => pr.gold >= c.hire + c.wage * 4 + RESERVE_GOLD);
    if (options.length) {
      options.sort((a, b) => unitPower(b[0], b[1].size, 60, 50) / b[1].hire - unitPower(a[0], a[1].size, 60, 50) / a[1].hire);
      return { province: pid, type: 'hire', company: options[0][0] };
    }
  }

  // --- Move interior armies to the front ---
  if (ctx.dist[pid] >= 2 && vs.length) {
    const move = moveToFront(state, house, pr, vs, ctx);
    if (move) return move;
  }

  // --- Diplomacy from the capital ---
  if (!ctx.diplomacyDone && state.houses[house].capital === pid) {
    const d = planDiplomacy(state, house, pr, rng);
    if (d) return d;
  }

  // --- Drill ---
  const green = vs.filter(v => v.training < 70 && v.soldiers > 0);
  if (green.length && (threatened || rng.chance(0.5))) return { province: pid, type: 'train' };

  if (pr.loyalty < 45 && pr.food >= FEAST_FOOD * 3 && !foodTight) return { province: pid, type: 'govern', kind: 'feast' };

  // --- Develop ---
  if (pr.gold >= DEVELOP_COST + RESERVE_GOLD / 2) {
    const d = develop(pr, foodTight, state);
    if (d) return d;
  }
  if (green.length) return { province: pid, type: 'train' };
  if (pr.gold < 20 && pr.loyalty > 60) return { province: pid, type: 'govern', kind: 'tax' };
  return { province: pid, type: 'rest' };
}

function develop(pr, foodTight, state) {
  let kind;
  if (pr.dikes < 40 && state.month >= 8 && pr.fields > 30) kind = 'dikes';
  else if (foodTight || pr.fields < pr.market) kind = pr.fields < 100 ? 'fields' : 'market';
  else kind = pr.market < 100 ? 'market' : 'fields';
  if (pr[kind] >= 100) return { province: pr.id, type: 'rest' };
  return { province: pr.id, type: 'develop', kind };
}

function chooseAttack(state, house, pr, vs, threat, ctx, rng) {
  const fighters = vs.filter(v => v.soldiers >= TUNING.minMarchSoldiers && v.training >= TUNING.minMarchTraining)
    .sort((a, b) => vassalPower(b) - vassalPower(a));
  if (!fighters.length) return null;
  const warlike = rng.chance(TUNING.aggression);
  let best = null;
  for (const n of ADJACENCY[pr.id]) {
    const t = state.provinces[n];
    if (t.owner === house || (t.owner && atPeace(state, house, t.owner))) continue;
    if (t.owner && !warlike) continue;
    const def = provinceDefence(state, n) + 1;
    // Who would go: everyone if safe, else keep the strongest home when the threat is real.
    let group = fighters.slice(0, MAX_MARCH);
    const otherThreat = threatExcluding(state, house, pr.id, n);
    if (otherThreat > 0 && fighters.length > 1) group = fighters.slice(1, MAX_MARCH + 1);
    const power = group.reduce((a, v) => a + vassalPower(v), 0) + (pr.company ? companyPower(pr.company) : 0);
    const ratio = power / def;
    const need = t.owner ? TUNING.attackRatio : TUNING.freeholdRatio;
    if (ratio < need) continue;
    let score = ratio;
    if (!t.owner && ctx.early) score += 0.6;
    if (t.shard) score += 1.2;
    if (t.owner && state.houses[t.owner].capital === n) score += 0.3;
    score += t.fields / 200 + t.market / 200;
    if (!best || score > best.score) best = { score, n, group };
  }
  if (!best) return null;
  const food = Math.min(Math.floor(pr.food * 0.3), 200);
  return { province: pr.id, type: 'march', to: best.n, vassals: best.group.map(v => v.id), company: !!pr.company, food };
}

function threatExcluding(state, house, pid, exclude) {
  let t = 0;
  for (const n of ADJACENCY[pid]) {
    if (n === exclude) continue;
    const p = state.provinces[n];
    if (!p.owner || p.owner === house || atPeace(state, house, p.owner)) continue;
    t = Math.max(t, provinceVassals(state, n).reduce((a, v) => a + vassalPower(v), 0));
  }
  return t;
}

function moveToFront(state, house, pr, vs, ctx) {
  // Keep one governor home (the best charm), send the rest one step toward the front.
  const keep = vs.reduce((a, b) => (b.charm > a.charm ? b : a));
  const movers = vs.filter(v => v !== keep && v.soldiers > 0 && !isRuler(state, v.id));
  if (!movers.length) return null;
  const steps = ADJACENCY[pr.id].filter(n => state.provinces[n].owner === house && ctx.dist[n] < ctx.dist[pr.id]);
  steps.sort((a, b) => ctx.dist[a] - ctx.dist[b] || a - b);
  for (const n of steps) {
    const free = MAX_VASSALS_PER_PROVINCE - state.provinces[n].vassals.length - (ctx.incoming[n] || 0);
    if (free <= 0) continue;
    const go = movers.slice(0, free);
    ctx.incoming[n] = (ctx.incoming[n] || 0) + go.length;
    const food = Math.floor(pr.food * 0.4);
    return { province: pr.id, type: 'march', to: n, vassals: go.map(v => v.id), company: false, food };
  }
  return null;
}

function planDiplomacy(state, house, pr, rng) {
  const envoy = envoyOf(state, pr.id);
  if (!envoy) return null;
  // Recruit captives first.
  const caps = captivesOf(state, house);
  if (caps.length && pr.vassals.length < MAX_VASSALS_PER_PROVINCE && rng.chance(0.6)) {
    return { province: pr.id, type: 'recruit', captive: caps[0].id };
  }
  const mine = housePower(state, house);
  const threat = biggestThreat(state, house);
  if (threat) {
    const theirs = housePower(state, threat);
    if (theirs > mine * 1.6 && pr.gold >= 80 && truceChance(state, house, threat, envoy) > 0.3 && rng.chance(0.5)) {
      return { province: pr.id, type: 'diplomacy', kind: 'truce', target: threat };
    }
  }
  // Rich houses try to buy disloyal enemy vassals nearby.
  if (pr.gold > 350 && rng.chance(0.25) && pr.vassals.length < MAX_VASSALS_PER_PROVINCE) {
    let target = null;
    for (const v of Object.values(state.vassals)) {
      if (v.status !== 'active' || v.house === house || isRuler(state, v.id) || v.location == null) continue;
      if (bribeCost(v) > pr.gold - 50) continue;
      const c = bribeChance(state, envoy, v);
      if (c > 0.3 && (!target || c > target.c)) target = { v, c };
    }
    if (target) return { province: pr.id, type: 'diplomacy', kind: 'bribe', vassal: target.v.id };
  }
  return null;
}

export { musterCost };
