// Province orders. listOrders(state, pid) describes what a province can do (for the UI);
// applyOrder(state, order) validates and applies one order, marks the province as ordered and
// returns { ok, msg }. Mutates state.
//
// A march to a foreign province is queued in state.marches (resolved in turn.js at month end):
// the vassals leave the province at once (location = null, marching = true).

import { TROOPS, COMPANIES, MAX_SOLDIERS, MAX_VASSALS_PER_PROVINCE } from '../data/units.js';
import { isAdjacent } from '../data/world.js';
import {
  provinceVassals, governorOf, envoyOf, withRng, atPeace, addLog, provinceName, houseName,
  vassalName, captivesOf, isPlayerControlled,
} from './state.js';
import { doDiplomacy, DIPLOMACY } from './diplomacy.js';

export const DEVELOP_COST = 30;
export const SPY_COST = 20;
export const FEAST_FOOD = 20;
export const MAX_MARCH = 5;

export const ORDER_LABELS = {
  develop: 'Develop', muster: 'Muster', train: 'Train', hire: 'Hire company', dismiss: 'Dismiss company',
  march: 'March', supply: 'Send supplies', govern: 'Govern', diplomacy: 'Diplomacy', spy: 'Spy',
  recruit: 'Recruit captive', rest: 'Rest',
};

const clamp = (x, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
export const musterCost = (troop, soldiers) => Math.ceil(soldiers / 10) * TROOPS[troop].cost;
export const developGain = gov => Math.round(4 + (gov ? gov.wits / 20 : -2));
export const trainGain = v => Math.round(10 + v.might / 10);
export const recruitChance = (envoy, captive) =>
  Math.max(0.05, Math.min(0.9, envoy.charm / 150 + (100 - captive.loyalty) / 250));

// Order availability for the UI: [{ type, label, cost, disabled: reason|null }].
export function listOrders(state, pid) {
  const pr = state.provinces[pid];
  const house = pr.owner;
  const out = [];
  const add = (type, cost, disabled) => out.push({ type, label: ORDER_LABELS[type], cost, disabled: disabled || null });
  if (!house) return out;
  const done = pr.ordered ? 'This province has already acted this month.' : null;
  const vs = provinceVassals(state, pid);
  const noV = vs.length ? null : 'Needs a vassal in the province.';
  const foreignAdj = adjacentForeign(state, pid);
  const ownAdj = adjacentOwn(state, pid);

  add('develop', DEVELOP_COST, done || (pr.gold < DEVELOP_COST ? `Needs ${DEVELOP_COST} gold.` : null));
  add('govern', FEAST_FOOD, done);
  add('muster', TROOPS.footmen.cost, done || noV || (pr.gold < TROOPS.footmen.cost ? 'No gold.' : null));
  add('train', 0, done || noV);
  const cheapest = Math.min(...Object.values(COMPANIES).map(c => c.hire));
  add('hire', cheapest, done || noV || (pr.company ? 'A company is already here.' : pr.gold < cheapest ? `Needs ${cheapest} gold.` : null));
  if (pr.company) add('dismiss', 0, done);
  add('march', 0, done || noV || (!foreignAdj.length && !ownAdj.length ? 'Nowhere to march.' : null));
  add('supply', 0, done || noV || (!ownAdj.length ? 'No neighbouring province of yours.' : null));
  add('diplomacy', 0, done || noV);
  add('spy', SPY_COST, done || noV || (pr.gold < SPY_COST ? `Needs ${SPY_COST} gold.` : null));
  add('recruit', 0, done || noV || (!captivesOf(state, house).length ? 'No captives.' : null));
  add('rest', 0, done);
  return out;
}

export function adjacentForeign(state, pid) {
  const pr = state.provinces[pid];
  return [...state.provinces].filter(p => p.owner !== pr.owner && isAdjacent(pid, p.id)).map(p => p.id);
}
export function adjacentOwn(state, pid) {
  const pr = state.provinces[pid];
  return state.provinces.filter(p => p.owner === pr.owner && p.id !== pid && isAdjacent(pid, p.id)).map(p => p.id);
}

const fail = msg => ({ ok: false, msg });

export function applyOrder(state, order) {
  if (state.winner || state.defeated) return fail('The game is over.');
  const pid = order.province ?? order.from;
  const pr = state.provinces[pid];
  if (!pr) return fail('No such province.');
  const house = pr.owner;
  if (!house) return fail('Not your province.');
  if (order.house && order.house !== house) return fail('Not your province.');
  if (pr.ordered) return fail('This province has already acted this month.');
  const vs = provinceVassals(state, pid);
  const needV = !['develop', 'govern', 'rest', 'dismiss'].includes(order.type);
  if (needV && !vs.length) return fail('Needs a vassal in the province.');
  const handler = HANDLERS[order.type];
  if (!handler) return fail('Unknown order.');
  const r = handler(state, pr, house, order, vs);
  if (r.ok) pr.ordered = true;
  return r;
}

const HANDLERS = {
  rest: () => ({ ok: true, msg: 'The province rests.' }),

  develop(state, pr, house, o) {
    const kind = o.kind;
    if (!['fields', 'market', 'dikes'].includes(kind)) return fail('Develop fields, market or dikes.');
    if (pr[kind] >= 100) return fail(`The ${kind} are fully developed.`);
    if (pr.gold < DEVELOP_COST) return fail(`Needs ${DEVELOP_COST} gold.`);
    pr.gold -= DEVELOP_COST;
    const g = developGain(governorOf(state, pr.id));
    pr[kind] = clamp(pr[kind] + g);
    return { ok: true, msg: `${kind[0].toUpperCase() + kind.slice(1)} +${g} (now ${pr[kind]}).` };
  },

  govern(state, pr, house, o) {
    if (o.kind === 'feast') {
      if (pr.food < FEAST_FOOD) return fail(`Needs ${FEAST_FOOD} food.`);
      pr.food -= FEAST_FOOD;
      pr.loyalty = clamp(pr.loyalty + 8);
      return { ok: true, msg: `Food is handed out. Loyalty ${pr.loyalty}.` };
    }
    if (o.kind === 'tax') {
      const g = pr.market;
      pr.gold += g;
      pr.loyalty = clamp(pr.loyalty - 10);
      return { ok: true, msg: `Taxes raise ${g} gold. Loyalty ${pr.loyalty}.` };
    }
    return fail('Feast or tax.');
  },

  muster(state, pr, house, o, vs) {
    const v = vs.find(x => x.id === o.vassal);
    if (!v) return fail('That vassal is not here.');
    let n = Math.floor(Math.min(o.soldiers | 0, MAX_SOLDIERS - v.soldiers) / 10) * 10;
    const affordable = Math.floor(pr.gold / TROOPS[v.troop].cost) * 10;
    n = Math.min(n, affordable);
    if (n <= 0) return fail(v.soldiers >= MAX_SOLDIERS ? 'This unit is at full strength.' : 'Not enough gold.');
    const cost = musterCost(v.troop, n);
    pr.gold -= cost;
    v.training = Math.round((v.training * v.soldiers + 20 * n) / (v.soldiers + n));
    v.soldiers += n;
    pr.loyalty = clamp(pr.loyalty - 2);
    return { ok: true, msg: `${vassalName(v.id)} musters ${n} ${TROOPS[v.troop].name.toLowerCase()} for ${cost} gold.` };
  },

  train(state, pr, house, o, vs) {
    const targets = o.vassal ? vs.filter(x => x.id === o.vassal) : vs;
    if (!targets.length) return fail('That vassal is not here.');
    const parts = [];
    for (const v of targets) {
      const g = trainGain(v);
      v.training = clamp(v.training + g);
      parts.push(`${vassalName(v.id)} ${v.training}`);
    }
    return { ok: true, msg: `Drilling: ${parts.join(', ')}.` };
  },

  hire(state, pr, house, o) {
    const c = COMPANIES[o.company];
    if (!c) return fail('Unknown company.');
    if (pr.company) return fail('A company is already here.');
    if (pr.gold < c.hire) return fail(`Needs ${c.hire} gold.`);
    pr.gold -= c.hire;
    pr.company = { type: o.company, soldiers: c.size };
    return { ok: true, msg: `The ${c.name} sign on (${c.wage} gold a month).` };
  },

  dismiss(state, pr) {
    if (!pr.company) return fail('No company here.');
    const name = COMPANIES[pr.company.type].name;
    pr.company = null;
    return { ok: true, msg: `The ${name} are paid off.` };
  },

  march(state, pr, house, o, vs) {
    const to = state.provinces[o.to];
    if (!to || !isAdjacent(pr.id, to.id)) return fail('You can only march to a neighbouring province.');
    const ids = [...new Set(o.vassals || [])];
    const marchers = ids.map(id => vs.find(v => v.id === id));
    if (!ids.length || marchers.some(v => !v)) return fail('Choose vassals in this province.');
    if (ids.length > MAX_MARCH) return fail(`At most ${MAX_MARCH} vassals march together.`);
    const food = Math.max(0, Math.min(o.food | 0, pr.food));
    const bringCompany = !!o.company && !!pr.company;
    if (to.owner === house) {
      if (to.vassals.length + ids.length > MAX_VASSALS_PER_PROVINCE) return fail(`${provinceName(to.id)} has room for ${MAX_VASSALS_PER_PROVINCE - to.vassals.length} more.`);
      if (bringCompany && to.company) return fail(`${provinceName(to.id)} already has a company.`);
      for (const v of marchers) moveVassal(state, v.id, to.id);
      if (bringCompany) { to.company = pr.company; pr.company = null; }
      pr.food -= food; to.food += food;
      return { ok: true, msg: `${ids.length} vassal(s) move to ${provinceName(to.id)}.` };
    }
    if (to.owner && atPeace(state, house, to.owner)) return fail(`You are at peace with ${houseName(to.owner)}.`);
    if (!marchers.some(v => v.soldiers > 0) && !bringCompany) return fail('The marching vassals have no soldiers.');
    for (const v of marchers) {
      pr.vassals = pr.vassals.filter(x => x !== v.id);
      v.location = null; v.marching = true;
    }
    const company = bringCompany ? pr.company : null;
    if (bringCompany) pr.company = null;
    pr.food -= food;
    state.marches.push({ house, from: pr.id, to: to.id, vassals: ids, company, food });
    return { ok: true, msg: `${ids.length} vassal(s) march on ${provinceName(to.id)}.` };
  },

  supply(state, pr, house, o) {
    const to = state.provinces[o.to];
    if (!to || to.owner !== house || !isAdjacent(pr.id, to.id)) return fail('Send supplies to a neighbouring province of yours.');
    const food = Math.max(0, Math.min(o.food | 0, pr.food));
    const gold = Math.max(0, Math.min(o.gold | 0, pr.gold));
    if (!food && !gold) return fail('Send some food or gold.');
    pr.food -= food; pr.gold -= gold; to.food += food; to.gold += gold;
    return { ok: true, msg: `${food} food and ${gold} gold sent to ${provinceName(to.id)}.` };
  },

  diplomacy(state, pr, house, o) {
    if (!DIPLOMACY[o.kind]) return fail('Unknown diplomacy.');
    const envoy = o.envoy ? state.vassals[o.envoy] : envoyOf(state, pr.id);
    if (!envoy || envoy.location !== pr.id || envoy.house !== house) return fail('That envoy is not here.');
    const target = o.kind === 'bribe' ? state.vassals[o.vassal]?.house : o.target;
    return withRng(state, rng => doDiplomacy(state, rng, o.kind, { province: pr, house, envoy, target, vassal: o.vassal }));
  },

  spy(state, pr, house, o) {
    const t = state.provinces[o.target];
    if (!t) return fail('Choose a province to spy on.');
    if (pr.gold < SPY_COST) return fail(`Needs ${SPY_COST} gold.`);
    pr.gold -= SPY_COST;
    state.intel[house][t.id] = state.turn;
    return { ok: true, msg: `Spies report from ${provinceName(t.id)}.`, report: spyReport(state, t.id) };
  },

  recruit(state, pr, house, o) {
    const c = state.vassals[o.captive];
    if (!c || c.status !== 'captive' || c.captor !== house) return fail('Choose one of your captives.');
    if (pr.vassals.length >= MAX_VASSALS_PER_PROVINCE) return fail('No room in this province.');
    const envoy = envoyOf(state, pr.id);
    return withRng(state, rng => {
      if (rng.chance(recruitChance(envoy, c))) {
        c.house = house; c.status = 'active'; c.captor = null; c.loyalty = 50;
        c.location = pr.id; c.soldiers = 0; c.marching = false;
        pr.vassals.push(c.id);
        addLog(state, `${vassalName(c.id)} swears service to ${houseName(house)}.`, 'info');
        return { ok: true, success: true, msg: `${vassalName(c.id)} joins your house.` };
      }
      c.loyalty = Math.max(0, c.loyalty - 10);   // each refusal wears their old loyalty down
      return { ok: true, success: false, msg: `${vassalName(c.id)} refuses.` };
    });
  },
};

export function moveVassal(state, vid, toPid) {
  const v = state.vassals[vid];
  if (v.location != null) {
    const src = state.provinces[v.location];
    src.vassals = src.vassals.filter(x => x !== vid);
  }
  v.location = toPid;
  v.marching = false;
  if (toPid != null && !state.provinces[toPid].vassals.includes(vid)) state.provinces[toPid].vassals.push(vid);
}

export function spyReport(state, pid) {
  const p = state.provinces[pid];
  return {
    province: pid, owner: p.owner, food: p.food, gold: p.gold, fields: p.fields, market: p.market,
    loyalty: p.loyalty, militia: p.militia, company: p.company ? { ...p.company } : null, shard: p.shard,
    vassals: provinceVassals(state, pid).map(v => ({ id: v.id, troop: v.troop, soldiers: v.soldiers, training: v.training, loyalty: v.loyalty })),
  };
}

// Resets the per-month order flags (turn.js calls this when the month advances).
export function resetOrders(state) { for (const p of state.provinces) p.ordered = false; }

export { isPlayerControlled };
