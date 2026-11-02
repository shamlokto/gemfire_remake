// Realm AI: planHouseOrders(state, houseId, rng) -> order[].
// Per province, after free 'assign' actions (best vassals lead the biggest units), in priority
// order: attack a clearly weaker neighbour (free holds and shard provinces preferred; crossing a
// sea lane needs a bigger margin), reinforce or raise units when threatened or rich, hire a
// company, move interior troops toward the frontier (chokepoints first), diplomacy from the
// capital, drill, feast, develop. Reads state only; orders are applied by turn.js in sequence.

import { TROOPS, COMPANIES, MAX_SOLDIERS, MAX_VASSALS_PER_PROVINCE, MAX_UNITS_PER_PROVINCE } from '../data/units.js';
import { ADJACENCY, isSeaLane } from '../data/world.js';
import {
  ownedProvinces, provinceVassals, provinceDefence, unitPower, atPeace, troopPower, companyPower,
  spiritPower, housePower, captivesOf, isRuler, provinceUpkeep, envoyOf, availableSpirit,
  provinceArmyPower,
} from './state.js';
import { DEVELOP_COST, FEAST_FOOD, MAX_MARCH, musterCost, hireOptions } from './orders.js';
import { averageLoyalty, techEffect } from './tech.js';
import { truceChance, bribeCost, bribeChance, biggestThreat } from './diplomacy.js';
import { HARVEST_MONTH, goldIncome, companyWage, troopPay, SOLDIERS_PER_GOLD } from './economy.js';

// Tunables (exported object so tests can sweep them).
export const TUNING = {
  attackRatio: 1.4,        // our power / their defence needed to attack a house
  freeholdRatio: 1.3,      // ... a free hold
  followUp: 0.6,           // share of a queued attack's power assumed to wear the target down
  seaLaneExtra: 0.15,      // extra margin to attack across a sea lane
  minMarchSoldiers: 100,   // a unit joins an attack only with this many soldiers
  minMarchTraining: 35,
  aggression: 0.6,         // chance per province per month to consider attacking a house
  raiseGold: 160,          // gold (after reserve) before raising a new unit in peacetime
  coalition: 0.2,          // attack margin given up against the leading house (balance of power)
  closingProvinces: 12,    // a house with this many provinces always considers attacking ...
  closingBonus: 0.25,      // ... and accepts this much less margin
  finishingProvinces: 16,  // past this, the margin drops again (the last holdouts must fall)
};

// The house everyone fears: most provinces (at least 7) or 3+ shards.
function leadingHouse(state) {
  let best = null, bn = 0;
  for (const [id, h] of Object.entries(state.houses)) {
    if (!h.alive) continue;
    const n = state.provinces.filter(p => p.owner === id).length + 2 * state.provinces.filter(p => p.owner === id && p.shard).length;
    if (n > bn) { bn = n; best = id; }
  }
  return bn >= 9 ? best : null;
}
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
function threatTo(state, house, pid, exclude = -1) {
  let t = 0;
  for (const n of ADJACENCY[pid]) {
    if (n === exclude) continue;
    const p = state.provinces[n];
    if (!p.owner || !hostile(state, house, n)) continue;
    t = Math.max(t, provinceArmyPower(state, n));
  }
  return t;
}

export function planHouseOrders(state, house, rng) {
  const orders = [];
  const owned = ownedProvinces(state, house);
  if (!owned.length) return orders;
  const dist = frontierDistance(state, house);
  const early = state.turn < 48;
  const ctx = { dist, early, incoming: {}, incomingUnits: {}, diplomacyDone: false, spiritQueued: false, queued: {}, leader: leadingHouse(state),
    shards: state.provinces.some(p => p.owner === house && p.shard), avgLoyalty: averageLoyalty(state, house), studied: 0 };

  // Free actions first: leaders for the biggest units.
  for (const pr of owned) orders.push(...assignLeaders(state, pr));

  // Frontier provinces first, so their decisions see full strength.
  const list = [...owned].sort((a, b) => dist[a.id] - dist[b.id] || a.id - b.id);
  for (const pr of list) {
    const o = planProvince(state, house, pr, rng, ctx);
    if (o) {
      if (o.type === 'diplomacy') ctx.diplomacyDone = true;
      if (o.fifth === 'spirit') ctx.spiritQueued = true;
      orders.push(o);
    }
  }
  return orders;
}

// Pair the strongest free vassals with the biggest unled units (and upgrade weak leaders).
function assignLeaders(state, pr) {
  const out = [];
  const vs = provinceVassals(state, pr.id);
  if (!vs.length || !pr.units.length) return out;
  const leading = new Map(pr.units.filter(u => u.leader).map(u => [u.leader, u]));
  const idle = vs.filter(v => !leading.has(v.id)).sort((a, b) => b.might - a.might || (a.id < b.id ? -1 : 1));
  const unled = pr.units.filter(u => !u.leader && u.soldiers > 0).sort((a, b) => b.soldiers - a.soldiers || (a.uid < b.uid ? -1 : 1));
  for (const u of unled) {
    const v = idle.shift();
    if (!v) break;
    out.push({ province: pr.id, type: 'assign', unit: u.uid, vassal: v.id });
  }
  return out;
}

function planProvince(state, house, pr, rng, ctx) {
  const pid = pr.id;
  const vs = provinceVassals(state, pid);
  const units = pr.units.filter(u => u.soldiers > 0);
  const myPower = units.reduce((a, u) => a + troopPower(state, u), 0) + companyPower(pr.company);
  const threat = threatTo(state, house, pid);
  const upkeep = provinceUpkeep(state, pid);
  const monthsToHarvest = (HARVEST_MONTH - state.month + 12) % 12 || 12;
  const foodTight = pr.food < upkeep * (monthsToHarvest + 1);
  const threatened = threat > myPower * 0.8;

  // --- Attack ---
  if (vs.length) {
    const attack = chooseAttack(state, house, pr, vs, units, ctx, rng);
    if (attack) return attack;
  }

  // --- Emergency: hungry or rebellious ---
  if (pr.loyalty < 30 && pr.food >= FEAST_FOOD * 2 && !foodTight) return { province: pid, type: 'govern', kind: 'feast' };
  // Shard holders keep the people content: loyalty charges the spirits.
  if (ctx.shards && pr.loyalty < 55 && ctx.avgLoyalty < 65 && pr.food >= FEAST_FOOD * 3 && !foodTight && !threatened) {
    return { province: pid, type: 'govern', kind: 'feast' };
  }

  // --- Drill green units before raising more (unless the enemy is at the gate) ---
  const raw = units.filter(u => u.training < TUNING.minMarchTraining + 5);
  if (raw.length && !threatened) return { province: pid, type: 'train' };

  // --- Reinforce or raise ---
  const m = ctx.shards && pr.loyalty < 40 && !threatened ? null : planMuster(state, pr, units, threatened, foodTight, ctx);
  if (m) return m;

  // --- Hire a company when threatened and rich ---
  if (threatened && !pr.company && rng.chance(0.5)) {
    const options = hireOptions(state, pid).filter(o => !o.locked && pr.gold >= o.cost + o.wage * 4 + RESERVE_GOLD &&
      !(ctx.shards && COMPANIES[o.type].loyaltyHit));
    if (options.length) {
      options.sort((a, b) => unitPower(b.type, b.size, 60, 0) / b.cost - unitPower(a.type, a.size, 60, 0) / a.cost);
      return { province: pid, type: 'hire', company: options[0].type };
    }
  }

  // --- Move interior troops to the front ---
  if (ctx.dist[pid] >= 2 && units.length) {
    const move = moveToFront(state, house, pr, vs, units, ctx);
    if (move) return move;
  }

  // --- Diplomacy from the capital ---
  if (vs.length && !ctx.diplomacyDone && state.houses[house].capital === pid) {
    const d = planDiplomacy(state, house, pr, rng);
    if (d) return d;
  }

  // --- Drill ---
  const green = units.filter(u => u.training < 70);
  if (green.length && (threatened || rng.chance(0.5))) return { province: pid, type: 'train' };

  if (pr.loyalty < 45 && pr.food >= FEAST_FOOD * 3 && !foodTight) return { province: pid, type: 'govern', kind: 'feast' };

  // --- Develop ---
  if (pr.gold >= DEVELOP_COST + RESERVE_GOLD / 2) {
    const d = develop(pr, foodTight, state);
    if (d) return d;
  }
  // --- Study: scholars at the capital, or wherever there is nothing better to do ---
  if (vs.length && ctx.studied < 2 && !threatened && (state.houses[house].capital === pid ? rng.chance(0.35) : rng.chance(0.15))) {
    ctx.studied++;
    return { province: pid, type: 'study' };
  }
  if (green.length) return { province: pid, type: 'train' };
  if (pr.gold < 20 && pr.loyalty > (ctx.shards ? 75 : 60)) return { province: pid, type: 'govern', kind: 'tax' };
  return vs.length && rng.chance(0.5) ? { province: pid, type: 'study' } : { province: pid, type: 'rest' };
}

// Troop type for a new unit, by what the province already has and can afford.
function newUnitType(pr, gold, closing = false) {
  const have = t => pr.units.filter(u => u.type === t).length;
  if (closing && !have('siege') && gold > 250) return 'siege';
  if (!have('archers')) return 'archers';
  if (!have('pikes') && have('footmen') >= 1) return 'pikes';
  if (gold > 600 && have('knights') < 2) return 'knights';
  if (gold > 350 && have('horse') < 2) return 'horse';
  return 'footmen';
}

function planMuster(state, pr, units, threatened, foodTight, ctx) {
  if (foodTight) return null;
  const spend = Math.max(0, pr.gold - RESERVE_GOLD);
  // Monthly budget: soldiers we can still pay for out of this province's income (plus savings
  // spread over two years when rich).
  const net = goldIncome(pr, state) - companyWage(pr, state) - troopPay(pr) + Math.floor(pr.gold / 24);
  const payRoom = Math.max(0, net) * SOLDIERS_PER_GOLD;
  if (payRoom < 40 && !threatened) return null;
  // Top up the weakest unit first.
  const weakest = units.length ? units.reduce((a, b) => (b.soldiers < a.soldiers ? b : a)) : null;
  if (weakest) {
    const room = MAX_SOLDIERS - weakest.soldiers;
    const want = threatened ? room : (weakest.soldiers < 280 ? Math.min(room, 330 - weakest.soldiers) : 0);
    if (want >= 40) {
      const n = Math.min(want, threatened ? want : payRoom, Math.floor(spend / TROOPS[weakest.type].cost) * 10);
      if (n >= 40 || (threatened && n >= 20)) return { province: pr.id, type: 'muster', unit: weakest.uid, soldiers: n };
    }
  }
  // Raise a new (leaderless) unit when there is room and money: always if fewer than 4 units on
  // the frontier, or when rich.
  const frontier = ctx.dist[pr.id] <= 1;
  if (pr.units.length < MAX_UNITS_PER_PROVINCE && ((spend >= TUNING.raiseGold && pr.units.length < 6) || (threatened && spend >= 60) || (frontier && pr.units.length < 4 && spend >= 100))) {
    const type = newUnitType(pr, spend, state.provinces.filter(p => p.owner === pr.owner).length >= TUNING.closingProvinces && ctx.dist[pr.id] <= 1);
    const n = Math.min(300, threatened ? 300 : payRoom, Math.floor(spend * 0.8 / TROOPS[type].cost) * 10);
    if (n >= 60) return { province: pr.id, type: 'muster', troop: type, soldiers: n };
  }
  return null;
}

function develop(pr, foodTight, state) {
  let kind;
  if (pr.dikes < 40 && state.month >= 8 && pr.fields > 30) kind = 'dikes';
  else if (foodTight || pr.fields < pr.market) kind = pr.fields < 100 ? 'fields' : 'market';
  else kind = pr.market < 100 ? 'market' : 'fields';
  if (pr[kind] >= 100) return null;
  return { province: pr.id, type: 'develop', kind };
}

function chooseAttack(state, house, pr, vs, units, ctx, rng) {
  const fighters = units.filter(u => u.soldiers >= TUNING.minMarchSoldiers && u.training >= TUNING.minMarchTraining)
    .sort((a, b) => troopPower(state, b) - troopPower(state, a) || (a.uid < b.uid ? -1 : 1));
  if (!fighters.length) return null;
  // A house close to ruling the realm presses on to finish the war.
  const mine = state.provinces.filter(p => p.owner === house).length;
  const closing = mine >= TUNING.closingProvinces;
  const finishing = mine >= TUNING.finishingProvinces;
  const warlike = closing || rng.chance(TUNING.aggression);
  const spirit = !ctx.spiritQueued ? availableSpirit(state, house) : null;
  const fifth = spirit && spiritPower(spirit) >= companyPower(pr.company) ? 'spirit' : pr.company ? 'company' : null;
  const fifthPower = fifth === 'spirit' ? spiritPower(spirit) : fifth === 'company' ? companyPower(pr.company) : 0;
  let best = null;
  for (const n of ADJACENCY[pr.id]) {
    const t = state.provinces[n];
    if (t.owner === house || (t.owner && atPeace(state, house, t.owner))) continue;
    if (t.owner && !warlike) continue;
    const raw = provinceDefence(state, n) * (1 + techEffect(state, t.owner, 'homeDef')) / (1 + techEffect(state, house, 'troopAtk'));
    const def = Math.max(raw * 0.25, raw - TUNING.followUp * (ctx.queued[n] || 0)) + 1;
    // Who goes: the strongest four, but keep the best unit home when another enemy is next door.
    let group = fighters.slice(0, MAX_MARCH);
    if (threatTo(state, house, pr.id, n) > 0 && fighters.length > 1) group = fighters.slice(1, MAX_MARCH + 1);
    const power = group.reduce((a, u) => a + troopPower(state, u), 0) + fifthPower;
    const ratio = power / def;
    const vsLeader = t.owner && t.owner === ctx.leader && house !== ctx.leader;
    const need = (t.owner ? TUNING.attackRatio : TUNING.freeholdRatio) + (isSeaLane(pr.id, n) ? TUNING.seaLaneExtra : 0) -
      (vsLeader ? TUNING.coalition : 0) - (closing ? TUNING.closingBonus : 0) - (finishing ? TUNING.closingBonus : 0);
    if (ratio < need) continue;
    let score = ratio;
    if (!t.owner && ctx.early) score += 0.6;
    if (t.shard) score += 1.2;
    if (vsLeader) score += 0.5;
    if (t.owner && state.houses[t.owner].capital === n) score += 0.3;
    if (ADJACENCY[n].length === 1) score += 0.2;   // dead ends are safe to hold
    score += t.fields / 200 + t.market / 200;
    if (!best || score > best.score) best = { score, n, group };
  }
  if (!best) return null;
  // Commander: the group's leaders; if none, the mightiest vassal who is free (or any vassal).
  const leaders = best.group.map(u => u.leader).filter(Boolean);
  let vassals = leaders;
  if (!vassals.length) {
    const ruler = state.houses[house].ruler;
    const pick = [...vs].sort((a, b) => (a.id === ruler) - (b.id === ruler) || b.might - a.might)[0];
    vassals = [pick.id];
  }
  ctx.queued[best.n] = (ctx.queued[best.n] || 0) + best.group.reduce((a, u) => a + troopPower(state, u), 0) + fifthPower;
  const food = Math.min(Math.floor(pr.food * 0.3), 200);
  return { province: pr.id, type: 'march', to: best.n, units: best.group.map(u => u.uid), vassals, fifth, food };
}

function moveToFront(state, house, pr, vs, units, ctx) {
  // Keep a governor (best charm) home with the unit they lead; send the rest one step toward
  // the front, preferring chokepoints (provinces with few neighbours) and thin garrisons.
  const keep = vs.length ? vs.reduce((a, b) => (b.charm > a.charm ? b : a)) : null;
  const movers = units.filter(u => !keep || u.leader !== keep.id).filter(u => !u.leader || !isRuler(state, u.leader));
  if (!movers.length) return null;
  const steps = ADJACENCY[pr.id].filter(n => state.provinces[n].owner === house && ctx.dist[n] < ctx.dist[pr.id]);
  steps.sort((a, b) => ctx.dist[a] - ctx.dist[b] ||
    ADJACENCY[a].length - ADJACENCY[b].length ||
    state.provinces[a].units.length - state.provinces[b].units.length || a - b);
  for (const n of steps) {
    const dst = state.provinces[n];
    const freeU = MAX_UNITS_PER_PROVINCE - dst.units.length - (ctx.incomingUnits[n] || 0);
    if (freeU <= 0) continue;
    let go = movers.slice(0, Math.min(freeU, MAX_MARCH));
    const leaders = go.map(u => u.leader).filter(Boolean);
    const freeV = MAX_VASSALS_PER_PROVINCE - dst.vassals.length - (ctx.incoming[n] || 0);
    if (leaders.length > freeV) go = go.filter(u => !u.leader).concat(go.filter(u => u.leader).slice(0, Math.max(0, freeV)));
    if (!go.length) continue;
    const nl = go.filter(u => u.leader).length;
    ctx.incomingUnits[n] = (ctx.incomingUnits[n] || 0) + go.length;
    ctx.incoming[n] = (ctx.incoming[n] || 0) + nl;
    const food = Math.floor(pr.food * 0.4);
    return { province: pr.id, type: 'march', to: n, units: go.map(u => u.uid), vassals: [], fifth: null, food };
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
  // Invite a wanderer standing here or next door.
  if (pr.vassals.length < MAX_VASSALS_PER_PROVINCE && pr.gold >= 120 && rng.chance(0.5)) {
    const near = new Set([pr.id, ...ADJACENCY[pr.id]]);
    const w = Object.values(state.vassals).filter(v => v.status === 'wandering' && near.has(v.location))
      .sort((a, b) => (b.might + b.wits + b.charm) - (a.might + a.wits + a.charm) || (a.id < b.id ? -1 : 1))[0];
    if (w) return { province: pr.id, type: 'diplomacy', kind: 'wanderer', vassal: w.id };
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
