// Province orders. listOrders(state, pid) describes what a province can do (for the UI);
// applyOrder(state, order) validates and applies one order, marks the province as ordered and
// returns { ok, msg }. Mutates state.
//
// v2 army model: troop units live in province.units and are separate from vassals.
//  - muster  {province, troop, soldiers, unit?}  adds to `unit` (uid) or raises a new unit of
//                                                 troop type `troop` (order.type is 'muster')
//  - train   {province, unit?}                    one unit, or every unit in the province
//  - assign  {province, unit, vassal|null}        FREE action (does not use the month's order)
//  - march   {from, to, units:[uid] (<=4), vassals:[vid], fifth:'company'|'spirit'|null, food}
//  - disband {province, unit}
//  - study   {province, branch?|tech?}             research points into a tech (default: focus)
//  - build   {province, x, y, kind}                build on the province's land (js/land): a building
//                                                 key, a project (clear|drain|excavate), 'repair',
//                                                 'demolish', or kind 'dikes' (no tile). Replaces the
//                                                 old `develop` order, which remains for saves without land.
//  - diplomacy kind 'wanderer' {vassal}            invite a wanderer standing in or next to here
// Leaders of the chosen units always march with them. A march to a foreign province is queued in
// state.marches (resolved in turn.js at month end); its units and vassals leave the province now.
// Attacks need at least one vassal. Transfers between own provinces need no vassal.
//
// UI helpers: marchOptions(state, pid) and musterOptions(state, pid) describe the choices.

import {
  TROOPS, TROOP_TYPES, COMPANIES, MAX_SOLDIERS, MAX_VASSALS_PER_PROVINCE, MAX_UNITS_PER_PROVINCE,
  MAX_UNITS_PER_ARMY,
} from '../data/units.js';
import { SPIRIT_UNIT } from '../data/spirits.js';
import { isAdjacent, isSeaLane } from '../data/world.js';
import {
  provinceVassals, governorOf, envoyOf, withRng, atPeace, addLog, provinceName, houseName,
  vassalName, captivesOf, isPlayerControlled, newUid, availableSpirit, troopPower, leaderOf,
  unitName,
} from './state.js';
import { doDiplomacy, DIPLOMACY } from './diplomacy.js';
import { techEffect, hasTech, studyPoints, addResearch, techState, nextInBranch, shardStatus } from './tech.js';
import { companyDiscount } from './economy.js';
import { TECH_BY_ID, BRANCHES } from '../data/tech.js';
import { landOf, yieldOf, applyBuild, cheapestBuild, aiBuild } from './landhooks.js';
import { trade, tradeCap, tradeRoom } from './market.js';
import { betaTopUp } from './state.js';

export const DEVELOP_COST = 30;
export const SPY_COST = 20;
export const FEAST_FOOD = 20;
export const MAX_MARCH = MAX_UNITS_PER_ARMY;   // troop units per army (plus the 5th slot)
export const NEW_UNIT_TRAINING = 20;

export const ORDER_LABELS = {
  develop: 'Develop', build: 'Build', muster: 'Muster', train: 'Train', hire: 'Hire company', dismiss: 'Dismiss company',
  march: 'March', supply: 'Send supplies', govern: 'Govern', diplomacy: 'Diplomacy', spy: 'Spy',
  recruit: 'Recruit captive', disband: 'Disband unit', study: 'Study', trade: 'Trade grain', rest: 'Rest',
};

const clamp = (x, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
// Muster cost; `state`/`house` optional (Siegecraft makes engines cheaper).
// `pid` optional: the province's land (pastures make horse and knights cheaper, ore makes engines cheaper).
export function musterCost(troop, soldiers, state = null, house = null, pid = null) {
  let per = TROOPS[troop].cost * (troop === 'siege' ? 1 + techEffect(state, house, 'siegeCost') : 1);
  const y = state && pid != null ? yieldOf(state, pid) : null;
  if (y && (troop === 'horse' || troop === 'knights')) per *= 1 - y.horseDiscount;
  if (y && troop === 'siege') per *= 1 - y.siegeDiscount;
  return Math.ceil(soldiers / 10) * Math.max(1, Math.round(per));
}
// Most soldiers one muster order can raise in a province: a third of what its people can field
// (land muster cap); without land, no limit beyond the unit size.
export function musterLimit(state, pid) {
  const y = yieldOf(state, pid);
  return y ? Math.max(30, Math.floor(y.musterCap / 3 / 10) * 10) : MAX_SOLDIERS;
}
export const developGain = gov => Math.round(4 + (gov ? gov.wits / 20 : -2));
// Drill gain for a unit: its leader's Might helps; leaderless units drill slower. `bonus` from Drill Yards.
export const trainGain = (leader, bonus = 0) => Math.round((leader ? 10 + leader.might / 10 : 8) + bonus);
// Hire price of a company for a house (Guild Charters, Beast-Taming).
export function hireCost(state, house, type) {
  return Math.round(COMPANIES[type].hire * (1 + techEffect(state, house, 'hire')) * companyDiscount(state, house, type));
}
// Every company with its price and why it cannot be hired here (null if it can).
export function hireOptions(state, pid) {
  betaTopUp(state);
  const pr = state.provinces[pid];
  return Object.entries(COMPANIES).map(([type, c]) => {
    const cost = hireCost(state, pr.owner, type);
    const locked = c.requires && !hasTech(state, pr.owner, c.requires);
    return { type, name: c.name, cost, wage: Math.round(c.wage * companyDiscount(state, pr.owner, type)), size: c.size,
      locked: !!locked, disabled: locked ? `Needs ${TECH_BY_ID[c.requires].name}.` : pr.company ? 'A company is already here.' :
        pr.gold < cost ? `Needs ${cost} gold.` : null };
  });
}
export const recruitChance = (envoy, captive) =>
  Math.max(0.05, Math.min(0.9, envoy.charm / 150 + (100 - captive.loyalty) / 250));

// Order availability for the UI: [{ type, label, cost, disabled: reason|null }].
// 'assign' is a free action and is not listed (use assignLeader / applyOrder type 'assign').
export function listOrders(state, pid) {
  betaTopUp(state);
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
  const cheapestTroop = Math.min(...Object.values(TROOPS).map(t => t.cost));
  const canRaise = pr.units.length < MAX_UNITS_PER_PROVINCE;
  const canAdd = pr.units.some(u => u.soldiers < MAX_SOLDIERS);

  if (landOf(state, pid)) {
    const c = cheapestBuild(state, pid);
    add('build', c, pr.gold < Math.min(c, 30) ? `Needs ${Math.min(c, 30)} gold.` : null);   // free action: never 'done'
  } else {
    add('develop', DEVELOP_COST, done || (pr.gold < DEVELOP_COST ? `Needs ${DEVELOP_COST} gold.` : null));
  }
  add('govern', FEAST_FOOD, done);
  add('muster', cheapestTroop, done || (!canRaise && !canAdd ? 'No room for more soldiers.' : pr.gold < cheapestTroop ? 'No gold.' : null));
  add('train', 0, done || (!pr.units.length ? 'No units to drill.' : null));
  const cheapest = Math.min(...hireOptions(state, pid).filter(o => !o.locked).map(o => o.cost));
  add('hire', cheapest, done || (pr.company ? 'A company is already here.' : pr.gold < cheapest ? `Needs ${cheapest} gold.` : null));
  if (pr.company) add('dismiss', 0, done);
  const mo = marchOptions(state, pid);
  add('march', 0, done || (!mo.units.length && !mo.vassals.length && !pr.company ? 'No one to march.' :
    !foreignAdj.length && !ownAdj.length ? 'Nowhere to march.' : null));
  add('supply', 0, done || (!ownAdj.length ? 'No neighbouring province of yours.' : null));
  add('diplomacy', 0, done || noV);
  add('spy', SPY_COST, done || noV || (pr.gold < SPY_COST ? `Needs ${SPY_COST} gold.` : null));
  add('recruit', 0, done || noV || (!captivesOf(state, house).length ? 'No captives.' : null));
  if (pr.units.length) add('disband', 0, done);
  add('study', 0, done);
  // Trading is a free action, available wherever a Market building works.
  if (landOf(state, pid)) add('trade', 0, tradeCap(state, pid) ? (tradeRoom(state, pid) ? null : 'The merchants here are done for the month.') : 'Build a Market here to trade.');
  add('rest', 0, done);
  return out;
}

// Everything the march dialog needs.
//   units:   [{ uid, type, name, soldiers, training, leader, power }]   (max MAX_MARCH chosen)
//   vassals: [{ id, name, leads: uid|null, might, wits }]
//   fifth:   [{ kind: 'company', type, name, soldiers } | { kind: 'spirit', id, name }]
//   targets: { attack: [pid], transfer: [pid], seaLanes: [pid] }   (seaLanes: reached by sea)
//   maxUnits, needsVassalToAttack: true
export function marchOptions(state, pid) {
  betaTopUp(state);
  const pr = state.provinces[pid];
  const house = pr.owner;
  const units = pr.units.filter(u => u.soldiers > 0).map(u => ({
    uid: u.uid, type: u.type, name: unitName(u), soldiers: u.soldiers, training: u.training,
    leader: u.leader, power: Math.round(troopPower(state, u)),
  }));
  const vassals = provinceVassals(state, pid).map(v => ({
    id: v.id, name: vassalName(v.id), leads: pr.units.find(u => u.leader === v.id)?.uid ?? null,
    might: v.might, wits: v.wits,
  }));
  const fifth = [];
  if (pr.company) fifth.push({ kind: 'company', type: pr.company.type, name: COMPANIES[pr.company.type].name, soldiers: pr.company.soldiers });
  const sp = house ? availableSpirit(state, house) : null;
  if (sp && vassals.length) fifth.push({ kind: 'spirit', id: sp, name: sp, soldiers: SPIRIT_UNIT[sp].soldiers });
  // Every shard the house holds, with its charge (the UI shows why a spirit cannot come).
  const queued = new Set(state.marches.filter(m => m.house === house && m.fifth?.kind === 'spirit').map(m => m.fifth.id));
  const spirits = house ? shardStatus(state, house).map(x => ({ ...x,
    reason: queued.has(x.id) ? 'Already marching in another attack.' : !vassals.length && x.ready ? 'Needs a vassal to call it.' : x.reason })) : [];
  const attack = house ? adjacentForeign(state, pid).filter(t => {
    const o = state.provinces[t].owner;
    return !(o && atPeace(state, house, o));
  }) : [];
  const transfer = house ? adjacentOwn(state, pid) : [];
  const seaLanes = [...attack, ...transfer].filter(t => isSeaLane(pid, t));
  return { units, vassals, fifth, spirits, targets: { attack, transfer, seaLanes }, maxUnits: MAX_MARCH, needsVassalToAttack: true };
}

// Everything the muster dialog needs.
//   types:  [{ type, name, costPer10 }]   for a new unit
//   units:  [{ uid, type, name, soldiers, room }]   existing units that can grow
//   canRaise: whether a new unit fits; maxSoldiers; gold
export function musterOptions(state, pid) {
  betaTopUp(state);
  const pr = state.provinces[pid];
  return {
    types: TROOP_TYPES.map(t => ({ type: t, name: TROOPS[t].name, costPer10: musterCost(t, 10, state, pr.owner, pid) })),
    units: pr.units.filter(u => u.soldiers < MAX_SOLDIERS)
      .map(u => ({ uid: u.uid, type: u.type, name: unitName(u), soldiers: u.soldiers, room: MAX_SOLDIERS - u.soldiers })),
    canRaise: pr.units.length < MAX_UNITS_PER_PROVINCE,
    maxSoldiers: MAX_SOLDIERS, gold: pr.gold, limit: musterLimit(state, pid),
  };
}

export function adjacentForeign(state, pid) {
  const pr = state.provinces[pid];
  return state.provinces.filter(p => p.owner !== pr.owner && isAdjacent(pid, p.id)).map(p => p.id);
}
export function adjacentOwn(state, pid) {
  const pr = state.provinces[pid];
  return state.provinces.filter(p => p.owner === pr.owner && p.id !== pid && isAdjacent(pid, p.id)).map(p => p.id);
}

const fail = msg => ({ ok: false, msg });

// Free action: put vassal `vid` (or nobody, vid = null) at the head of unit `uid` in province `pid`.
// The vassal leaves any unit it led before; the unit's previous leader becomes free.
export function assignLeader(state, pid, uid, vid) {
  const pr = state.provinces[pid];
  if (!pr || !pr.owner) return fail('Not your province.');
  const u = pr.units.find(x => x.uid === uid);
  if (!u) return fail('No such unit here.');
  if (vid == null) { u.leader = null; return { ok: true, msg: `The ${unitName(u).toLowerCase()} have no leader now.` }; }
  const v = state.vassals[vid];
  if (!v || v.status !== 'active' || v.location !== pid || v.house !== pr.owner) return fail('That vassal is not here.');
  for (const o of pr.units) if (o.leader === vid) o.leader = null;
  u.leader = vid;
  return { ok: true, msg: `${vassalName(vid)} takes command of the ${unitName(u).toLowerCase()}.` };
}

export function applyOrder(state, order) {
  if (state.winner || state.defeated) return fail('The game is over.');
  betaTopUp(state);
  const pid = order.province ?? order.from;
  const pr = state.provinces[pid];
  if (!pr) return fail('No such province.');
  const house = pr.owner;
  if (!house) return fail('Not your province.');
  if (order.house && order.house !== house) return fail('Not your province.');
  if (order.type === 'assign') return assignLeader(state, pid, order.unit, order.vassal ?? null);
  // Building on the land is a free action: as many buildings, projects and repairs a month as the
  // province can pay for. It does not use the province's monthly order.
  if (order.type === 'build') { const r = applyBuild(state, pid, order); betaTopUp(state); return r; }
  if (order.type === 'trade') return trade(state, pid, order.food);
  // Inviting wanderers is free too: invite as many as you can afford (and have room for) each month.
  if (order.type === 'diplomacy' && order.kind === 'wanderer') {
    if (!provinceVassals(state, pid).length) return fail('Needs a vassal in the province.');
    const r = HANDLERS.diplomacy(state, pr, house, order);
    betaTopUp(state); return r;
  }
  if (pr.ordered) return fail('This province has already acted this month.');
  const vs = provinceVassals(state, pid);
  const needV = ['diplomacy', 'spy', 'recruit'].includes(order.type);
  if (needV && !vs.length) return fail('Needs a vassal in the province.');
  const handler = HANDLERS[order.type];
  if (!handler) return fail('Unknown order.');
  const r = handler(state, pr, house, order, vs);
  if (r.ok) pr.ordered = true;
  return r;
}

const HANDLERS = {
  rest: () => ({ ok: true, msg: 'The province rests.' }),

  build(state, pr, house, o) {
    return applyBuild(state, pr.id, o);
  },

  develop(state, pr, house, o) {
    const kind = o.kind;
    if (!['fields', 'market', 'dikes'].includes(kind)) return fail('Develop fields, market or dikes.');
    if (landOf(state, pr.id)) {
      // Old-style order on a land map: build the best farm (fields) or trade building (market).
      if (kind === 'dikes') return applyBuild(state, pr.id, { kind: 'dikes' });
      const b = aiBuild(state, pr.id, kind === 'fields' ? 'food' : 'gold');
      return b ? applyBuild(state, pr.id, b) : fail('Nothing worth building that you can afford.');
    }
    if (pr[kind] >= 100) return fail(`The ${kind} are fully developed.`);
    if (pr.gold < DEVELOP_COST) return fail(`Needs ${DEVELOP_COST} gold.`);
    pr.gold -= DEVELOP_COST;
    const g = developGain(governorOf(state, pr.id)) +
      (kind === 'fields' ? techEffect(state, house, 'fieldsGain') : kind === 'market' ? techEffect(state, house, 'marketGain') : 0);
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

  muster(state, pr, house, o) {
    let u = o.unit ? pr.units.find(x => x.uid === o.unit) : null;
    if (o.unit && !u) return fail('That unit is not here.');
    const type = u ? u.type : o.troop;
    if (!TROOPS[type]) return fail('Choose a troop type.');
    if (!u && pr.units.length >= MAX_UNITS_PER_PROVINCE) return fail(`At most ${MAX_UNITS_PER_PROVINCE} units in a province.`);
    const have = u ? u.soldiers : 0;
    let n = Math.floor(Math.min(o.soldiers | 0, MAX_SOLDIERS - have, musterLimit(state, pr.id)) / 10) * 10;
    const per10 = musterCost(type, 10, state, house, pr.id);
    const affordable = Math.floor(pr.gold / per10) * 10;
    n = Math.min(n, affordable);
    if (n <= 0) return fail(have >= MAX_SOLDIERS ? 'This unit is at full strength.' : 'Not enough gold.');
    const cost = musterCost(type, n, state, house, pr.id);
    pr.gold -= cost;
    if (u) {
      u.training = Math.round((u.training * u.soldiers + NEW_UNIT_TRAINING * n) / (u.soldiers + n));
      u.soldiers += n;
    } else {
      u = { uid: newUid(state), type, soldiers: n, training: NEW_UNIT_TRAINING, leader: null };
      pr.units.push(u);
    }
    pr.loyalty = clamp(pr.loyalty - 2);
    return { ok: true, unit: u.uid, msg: `${n} ${TROOPS[type].name.toLowerCase()} mustered for ${cost} gold.` };
  },

  train(state, pr, house, o) {
    const targets = o.unit ? pr.units.filter(x => x.uid === o.unit) : pr.units;
    if (!targets.length) return fail(o.unit ? 'That unit is not here.' : 'No units to drill.');
    let best = 0;
    for (const u of targets) {
      const g = trainGain(leaderOf(state, u), techEffect(state, house, 'trainGain'));
      u.training = clamp(u.training + g);
      best = Math.max(best, u.training);
    }
    return { ok: true, msg: targets.length === 1 ? `Drilling: ${unitName(targets[0])} ${targets[0].training}.` : `${targets.length} units drill (best ${best}).` };
  },

  disband(state, pr, house, o) {
    const i = pr.units.findIndex(x => x.uid === o.unit);
    if (i < 0) return fail('That unit is not here.');
    const [u] = pr.units.splice(i, 1);
    pr.loyalty = clamp(pr.loyalty + 2);
    return { ok: true, msg: `The ${unitName(u).toLowerCase()} go home to their fields.` };
  },

  hire(state, pr, house, o) {
    const c = COMPANIES[o.company];
    if (!c) return fail('Unknown company.');
    if (c.requires && !hasTech(state, house, c.requires)) return fail(`The ${c.name} need ${TECH_BY_ID[c.requires].name}.`);
    if (pr.company) return fail('A company is already here.');
    const cost = hireCost(state, house, o.company);
    if (pr.gold < cost) return fail(`Needs ${cost} gold.`);
    pr.gold -= cost;
    pr.company = { type: o.company, soldiers: c.size };
    if (c.loyaltyHit) pr.loyalty = clamp(pr.loyalty - c.loyaltyHit);
    const wage = Math.round(c.wage * companyDiscount(state, house, o.company));
    return { ok: true, msg: `The ${c.name} sign on (${wage ? wage + ' gold a month' : 'no wages'}).` };
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
    const uids = [...new Set(o.units || [])];
    const units = uids.map(id => pr.units.find(u => u.uid === id));
    if (units.some(u => !u)) return fail('Choose units in this province.');
    if (uids.length > MAX_MARCH) return fail(`At most ${MAX_MARCH} units march together (plus a company or spirit).`);
    // Leaders go with their units.
    const vids = new Set(o.vassals || []);
    for (const u of units) if (u.leader) vids.add(u.leader);
    const marchers = [...vids].map(id => vs.find(v => v.id === id));
    if (marchers.some(v => !v)) return fail('Choose vassals in this province.');
    const food = Math.max(0, Math.min(o.food | 0, pr.food));
    const fifthKind = o.fifth === true ? 'company' : o.fifth || (o.company ? 'company' : null);

    if (to.owner === house) {
      if (!units.length && !marchers.length && fifthKind !== 'company') return fail('Choose who marches.');
      if (to.vassals.length + marchers.length > MAX_VASSALS_PER_PROVINCE) return fail(`${provinceName(to.id)} has room for ${MAX_VASSALS_PER_PROVINCE - to.vassals.length} more vassals.`);
      if (to.units.length + units.length > MAX_UNITS_PER_PROVINCE) return fail(`${provinceName(to.id)} has room for ${MAX_UNITS_PER_PROVINCE - to.units.length} more units.`);
      const bringCompany = fifthKind === 'company' && pr.company;
      if (bringCompany && to.company) return fail(`${provinceName(to.id)} already has a company.`);
      for (const v of marchers) {
        for (const u of pr.units) if (u.leader === v.id && !units.includes(u)) u.leader = null;
        moveVassal(state, v.id, to.id);
      }
      for (const u of units) { pr.units.splice(pr.units.indexOf(u), 1); to.units.push(u); }
      if (bringCompany) { to.company = pr.company; pr.company = null; }
      pr.food -= food; to.food += food;
      return { ok: true, msg: `${describeMove(units.length, marchers.length)} move to ${provinceName(to.id)}.` };
    }
    if (to.owner && atPeace(state, house, to.owner)) return fail(`You are at peace with ${houseName(to.owner)}.`);
    if (!marchers.length) return fail('An attack needs a vassal to command it.');
    let fifth = null;
    if (fifthKind === 'company') {
      if (!pr.company) return fail('There is no company here.');
      fifth = { kind: 'company', type: pr.company.type, soldiers: pr.company.soldiers };
    } else if (fifthKind === 'spirit') {
      const sp = availableSpirit(state, house);
      if (!sp) return fail('No spirit can be summoned this season.');
      fifth = { kind: 'spirit', id: sp };
    }
    if (!units.some(u => u.soldiers > 0) && !fifth) return fail('The attack needs soldiers.');
    for (const v of marchers) {
      for (const u of pr.units) if (u.leader === v.id && !units.includes(u)) u.leader = null;
      pr.vassals = pr.vassals.filter(x => x !== v.id);
      v.location = null; v.marching = true;
    }
    for (const u of units) pr.units.splice(pr.units.indexOf(u), 1);
    if (fifth?.kind === 'company') pr.company = null;
    pr.food -= food;
    state.marches.push({ house, from: pr.id, to: to.id, units, vassals: marchers.map(v => v.id), fifth, food });
    return { ok: true, msg: `${describeMove(units.length, marchers.length)} march on ${provinceName(to.id)}${isSeaLane(pr.id, to.id) ? ' by sea' : ''}.` };
  },

  study(state, pr, house, o, vs) {
    const best = vs.reduce((a, v) => Math.max(a, v.wits), 0);
    const pts = vs.length ? studyPoints(best) : 6;
    let target = o.tech && TECH_BY_ID[o.tech] ? o.tech : null;
    if (!target && o.branch && BRANCHES[o.branch]) target = nextInBranch(state, house, o.branch)?.id || null;
    if (o.branch && !target && !o.tech) return fail(`Nothing left to learn in ${BRANCHES[o.branch].name}.`);
    const done = addResearch(state, house, pts, target);
    const t = techState(state, house);
    const what = done ? `${TECH_BY_ID[done].name} is mastered!` : `${pts} research points${target ? ' into ' + TECH_BY_ID[target].name : t.focus ? ' into ' + TECH_BY_ID[t.focus].name : ''}.`;
    return { ok: true, msg: `Scholars study: ${what}`, points: pts, completed: done };
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
    const target = o.kind === 'bribe' ? state.vassals[o.vassal]?.house : o.kind === 'wanderer' ? null : o.target;
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
        c.location = pr.id; c.marching = false;
        pr.vassals.push(c.id);
        addLog(state, `${vassalName(c.id)} swears service to ${houseName(house)}.`, 'info');
        return { ok: true, success: true, msg: `${vassalName(c.id)} joins your house.` };
      }
      c.loyalty = Math.max(0, c.loyalty - 10);   // each refusal wears their old loyalty down
      return { ok: true, success: false, msg: `${vassalName(c.id)} refuses.` };
    });
  },
};

function describeMove(nu, nv) {
  const parts = [];
  if (nu) parts.push(`${nu} unit${nu > 1 ? 's' : ''}`);
  if (nv) parts.push(`${nv} vassal${nv > 1 ? 's' : ''}`);
  return parts.join(' and ') || 'The company';
}

// Moves a vassal alone (units are moved by the caller). Clears leadership of units left behind.
export function moveVassal(state, vid, toPid) {
  const v = state.vassals[vid];
  if (v.location != null) {
    const src = state.provinces[v.location];
    src.vassals = src.vassals.filter(x => x !== vid);
    for (const u of src.units) if (u.leader === vid) u.leader = null;
  }
  v.location = toPid;
  v.marching = false;
  if (toPid != null && !state.provinces[toPid].vassals.includes(vid)) state.provinces[toPid].vassals.push(vid);
}

export function spyReport(state, pid) {
  const p = state.provinces[pid];
  return {
    province: pid, owner: p.owner, food: p.food, gold: p.gold, fields: p.fields, market: p.market,
    loyalty: p.loyalty, militia: [...p.militia], company: p.company ? { ...p.company } : null, shard: p.shard,
    units: p.units.map(u => ({ uid: u.uid, type: u.type, soldiers: u.soldiers, training: u.training, leader: u.leader })),
    vassals: provinceVassals(state, pid).map(v => ({ id: v.id, loyalty: v.loyalty, might: v.might, wits: v.wits })),
  };
}

// Resets the per-month order flags (turn.js calls this when the month advances).
export function resetOrders(state) { for (const p of state.provinces) p.ordered = false; }

export { isPlayerControlled };
