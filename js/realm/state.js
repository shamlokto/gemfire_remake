// RealmState construction and read helpers. Pure: no DOM, runs in node.
//
// Design note: realm functions MUTATE the state they are given (no cloning). Callers that want
// an undo point should snapshot with JSON.parse(JSON.stringify(state)) first. The whole state is
// plain JSON, so saving is JSON.stringify(state).
//
// v2 army model (docs/DESIGN.md, "v2: islands map and the army model"):
//   province.units: [Unit]          troop units garrisoned there (max MAX_UNITS_PER_PROVINCE)
//   Unit = { uid, type, soldiers, training, leader: vassalId|null }
//   province.militia: [soldiers]    free holds only: 1-3 leaderless militia units ([] when owned)
//   state.nextUid                   counter for unit uids ("u1", "u2", ...)
//   vassals carry no soldiers; a vassal leads at most one unit in the same province.
//
// Other additions beyond docs/DESIGN.md:
//   marches: [March]   queued attacks, resolved at month end (see orders.js / turn.js)
//   autoPlayer: bool   if true the AI also plays the player's house (tests, demo mode)
//   defeated: bool     the player's house has been eliminated (game over)
//   vassal.marching    true while the vassal is part of a queued march (location is null then)
//   scenario           scenario id (js/data/scenarios.js); startYear: the scenario's first year
//   houses[id].tech    research (js/realm/tech.js); houses[id].charge: shard charge per spirit
//   vassal.status      'active' | 'captive' | 'exiled' | 'dead' | 'wandering' (house null, at
//                      `location`, invitable) | 'future' (an heir not yet of age; dueTurn)
// March = { house, from, to, units: [Unit], vassals: [vassalId],
//           fifth: null | { kind: 'company', type, soldiers } | { kind: 'spirit', id }, food }

import { initLand, yieldOf } from './landhooks.js';
import {
  PROVINCES, PROVINCE_DEFAULTS, NEUTRAL_MILITIA, START_YEAR, seasonOf, ADJACENCY, VICTORY_PROVINCES as VP,
} from '../data/world.js';
import { HOUSES, HOUSE_START, HOUSE_BY_ID } from '../data/houses.js';
import { VASSALS, VASSAL_BY_ID, WANDERERS, HEIRS } from '../data/vassals.js';
import { SCENARIO_BY_ID } from '../data/scenarios.js';
import { techState, shardCharge, setCharge, CHARGE_MAX } from './tech.js';
import { TROOPS, COMPANIES, MILITIA, MAX_UNITS_PER_ARMY, MAX_UNITS_PER_PROVINCE, MAX_SOLDIERS } from '../data/units.js';
import { SPIRITS, SPIRIT_UNIT } from '../data/spirits.js';
import { STORY } from '../data/events.js';
import { makeRng } from '../rng.js';

export const STATE_VERSION = 2;
export const VICTORY_PROVINCES = VP;
export const START_TRAINING = 40;
export const CAPITAL_LEVY = { units: 2, type: 'footmen', soldiers: 80 };
export const LEADERLESS_FACTOR = 0.85;   // power estimate of a unit with no leader

export function newUid(state) {
  state.nextUid = (state.nextUid || 0) + 1;
  return 'u' + state.nextUid;
}

// Split a militia total into 1-3 units.
function splitMilitia(rng, total) {
  const n = total < 80 ? 1 : rng.int(1, total > 110 ? 3 : 2);
  const out = [];
  let left = total;
  for (let i = 0; i < n; i++) {
    const part = i === n - 1 ? left : Math.round(total / n);
    out.push(part); left -= part;
  }
  return out;
}

export function newGame(player, seed = 1, scenarioId = 'eclipse') {
  if (!HOUSE_BY_ID[player]) throw new Error('unknown house ' + player);
  const sc = SCENARIO_BY_ID[scenarioId] || SCENARIO_BY_ID.eclipse;
  const rng = makeRng(seed >>> 0);
  const owner = {};
  const lands = h => sc.owners?.[h.id] || h.provinces;
  for (const h of HOUSES) for (const p of lands(h)) owner[p] = h.id;

  const provinces = PROVINCES.map(p => {
    const o = owner[p.id] ?? null;
    const base = { ...PROVINCE_DEFAULTS, ...(o ? HOUSE_START[o] : {}) };
    return {
      id: p.id, owner: o,
      fields: base.fields, market: base.market, dikes: base.dikes, loyalty: base.loyalty,
      food: base.food, gold: base.gold,
      vassals: [], units: [], company: null,
      militia: o ? [] : splitMilitia(rng, rng.int(NEUTRAL_MILITIA.min, NEUTRAL_MILITIA.max)),
      shard: null, ordered: false,
    };
  });
  // Non-capital starting provinces get a little less.
  for (const h of HOUSES) {
    const gm = sc.goldMult?.[h.id] ?? 1;
    for (const pid of lands(h)) {
      const pr = provinces[pid];
      const f = (pid !== h.capital ? 0.6 : 1) * gm;
      pr.food = Math.round(pr.food * f); pr.gold = Math.round(pr.gold * f);
    }
    if (h.shard) provinces[h.capital].shard = h.shard;
  }

  const state = {
    version: STATE_VERSION, seed: seed >>> 0, rng: 0,
    turn: 0, year: sc.year || START_YEAR, month: 0, startYear: sc.year || START_YEAR,
    scenario: sc.id, player,
    houses: {}, provinces, vassals: {},
    truces: {}, marriages: [], intel: {},
    log: [{ turn: 0, text: `${HOUSE_BY_ID[player].name} takes up the struggle for Varenhold.`, kind: 'story' }],
    pendingEvents: [{ art: STORY.prologue.art, title: STORY.prologue.title, text: STORY.prologue.text }],
    marches: [], autoPlayer: false, defeated: false,
    winner: null, nextUid: 0,
    market: null,   // the grain market (js/realm/market.js initMarket)
  };

  const scale = sc.scale || 1;
  const sized = n => Math.min(MAX_SOLDIERS, Math.round(n * scale / 10) * 10);
  for (const v of VASSALS) {
    state.vassals[v.id] = {
      id: v.id, house: v.house, might: v.might, wits: v.wits, charm: v.charm, loyalty: v.loyalty,
      location: v.at, status: 'active', captor: null, marching: false,
    };
    provinces[v.at].vassals.push(v.id);
    provinces[v.at].units.push({ uid: newUid(state), type: v.troop, soldiers: sized(v.soldiers), training: START_TRAINING, leader: v.id });
  }
  for (const h of HOUSES) {
    state.houses[h.id] = { id: h.id, alive: true, ruler: h.ruler, capital: h.capital, spiritUsed: {},
      tech: { researched: [], progress: {}, focus: null }, charge: {} };
    state.intel[h.id] = {};
    for (let i = 0; i < CAPITAL_LEVY.units; i++) {
      provinces[h.capital].units.push({ uid: newUid(state), type: CAPITAL_LEVY.type, soldiers: sized(CAPITAL_LEVY.soldiers), training: 30, leader: null });
    }
    // Scenario: garrisons for extra lands, starting techs, shard charge.
    for (const pid of lands(h)) {
      if (h.provinces.includes(pid) || !sc.garrison) continue;
      for (const [type, n] of sc.garrison) {
        if (provinces[pid].units.length >= MAX_UNITS_PER_PROVINCE) break;
        provinces[pid].units.push({ uid: newUid(state), type, soldiers: sized(n), training: 45, leader: null });
      }
    }
    for (const t of sc.techs?.[h.id] || []) techState(state, h.id).researched.push(t);
    if (h.shard) setCharge(state, h.id, h.shard, sc.charge ?? CHARGE_MAX);
  }
  for (const [a, b, months] of sc.truces || []) state.truces[pairKey(a, b)] = months;
  for (const [a, b, months] of sc.marriages || []) state.marriages.push([a, b, months]);
  // Wanderers roam the land; heirs wait to come of age.
  for (const w of WANDERERS) {
    state.vassals[w.id] = { id: w.id, house: null, might: w.might, wits: w.wits, charm: w.charm, loyalty: w.loyalty,
      location: w.at, status: 'wandering', captor: null, marching: false, troop: w.troop, band: w.soldiers };
  }
  for (const hh of HEIRS) {
    state.vassals[hh.id] = { id: hh.id, house: hh.house, might: hh.might, wits: hh.wits, charm: hh.charm, loyalty: hh.loyalty,
      location: null, status: 'future', captor: null, marching: false, troop: hh.troop, band: hh.soldiers, dueTurn: hh.years * 12 };
  }
  if (sc.id !== 'eclipse') {
    state.log.push({ turn: 0, text: `Scenario: ${sc.name}, year ${state.year}.`, kind: 'story' });
    state.pendingEvents.push({ art: sc.art, title: sc.name, text: sc.blurb });
  }
  // Province land grids, developed to each province's starting fields/market (bigger realms
  // in later scenarios start more developed).
  initLand(state, sc.landDevelop ?? LAND_DEVELOP[sc.id] ?? 1);
  state.rng = rng.state;
  return state;
}
const LAND_DEVELOP = { eclipse: 1, raven: 1.2, crowns: 1.25, lastshard: 1.7 };

// Wanderers in (or invitable from) a province: those standing in it or in a neighbour.
export function wanderersAt(state, pid) {
  return Object.values(state.vassals).filter(v => v.status === 'wandering' && v.location === pid);
}
export function wanderersNear(state, pid) {
  const near = new Set([pid, ...ADJACENCY[pid]]);
  return Object.values(state.vassals).filter(v => v.status === 'wandering' && near.has(v.location));
}

// Keep each province's vassal list honest: only active vassals who actually stand there. Captured,
// fled, exiled or dead vassals (and anyone whose location moved) are dropped. Room checks
// (MAX_VASSALS_PER_PROVINCE) count this list, so stale names would block marches and invitations.
export function pruneVassals(state) {
  for (const pr of state.provinces) {
    const keep = pr.vassals.filter((id, i, a) => {
      const v = state.vassals[id];
      return v && v.status === 'active' && v.location === pr.id && a.indexOf(id) === i;
    });
    if (keep.length !== pr.vassals.length) pr.vassals = keep;
  }
}

// ---------- RNG helper: use the state's rng and write it back ----------
export function withRng(state, fn) {
  const rng = makeRng(state.rng);
  try { return fn(rng); } finally { state.rng = rng.state; }
}

// ---------- read helpers ----------
export const seasonIndex = state => (state.year - START_YEAR) * 4 + seasonOf(state.month);
export const season = state => seasonOf(state.month);

export function ownedProvinces(state, house) {
  return state.provinces.filter(p => p.owner === house);
}
export function provinceVassals(state, pid) {
  return state.provinces[pid].vassals.map(id => state.vassals[id]).filter(v => v && v.status === 'active');
}
export function provinceUnits(state, pid) { return state.provinces[pid].units; }
export function findUnit(state, pid, uid) { return state.provinces[pid].units.find(u => u.uid === uid) || null; }
// The unit a vassal leads (searching their province, or marches if they are marching).
export function unitLedBy(state, vid) {
  const v = state.vassals[vid];
  if (!v) return null;
  if (v.location != null) return state.provinces[v.location].units.find(u => u.leader === vid) || null;
  for (const m of state.marches) { const u = m.units.find(x => x.leader === vid); if (u) return u; }
  return null;
}
export function leaderOf(state, unit) { return unit && unit.leader ? state.vassals[unit.leader] || null : null; }

export function houseVassals(state, house) {
  return Object.values(state.vassals).filter(v => v.house === house && v.status === 'active');
}
export function captivesOf(state, house) {
  return Object.values(state.vassals).filter(v => v.status === 'captive' && v.captor === house);
}
export function aliveHouses(state) {
  return HOUSES.map(h => h.id).filter(id => state.houses[id].alive);
}
export function shardsOf(state, house) {
  return state.provinces.filter(p => p.owner === house && p.shard).map(p => p.shard);
}
export function isRuler(state, vid) {
  const v = state.vassals[vid];
  return !!v && state.houses[v.house] && state.houses[v.house].ruler === vid;
}

// A spirit the house can summon now: it holds the shard, the shard is fully charged, and the
// spirit is not already marching in another queued attack. `exceptQueued` false ignores marches.
export function availableSpirit(state, house, exceptQueued = true) {
  if (!house || !state.houses[house]) return null;
  const queued = exceptQueued ? new Set(state.marches.filter(m => m.house === house && m.fifth?.kind === 'spirit').map(m => m.fifth.id)) : new Set();
  return shardsOf(state, house).find(s => shardCharge(state, house, s) >= CHARGE_MAX && !queued.has(s)) || null;
}

// Governor of a province: the ruler if present, else the vassal with the best charm.
export function governorOf(state, pid) {
  const vs = provinceVassals(state, pid);
  if (!vs.length) return null;
  const pr = state.provinces[pid];
  const ruler = pr.owner && state.houses[pr.owner].ruler;
  return vs.find(v => v.id === ruler) || vs.reduce((a, b) => (b.charm > a.charm ? b : a));
}

// Best envoy (highest charm) in a province.
export function envoyOf(state, pid) {
  const vs = provinceVassals(state, pid);
  return vs.length ? vs.reduce((a, b) => (b.charm > a.charm ? b : a)) : null;
}

export function pairKey(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }
export function atPeace(state, a, b) {
  if (!a || !b || a === b) return false;
  if ((state.truces[pairKey(a, b)] ?? -1) > state.turn) return true;
  return state.marriages.some(([x, y, until]) => until > state.turn &&
    ((x === a && y === b) || (x === b && y === a)));
}

// ---------- strength estimates (AI and UI strength bars) ----------
export function unitStats(type) {
  return TROOPS[type] || COMPANIES[type] || (type === 'militia' ? MILITIA : null) ||
    (SPIRIT_UNIT[type] ? { ...SPIRIT_UNIT[type], name: SPIRITS[type].name } : null);
}
export function unitPower(type, soldiers, training = 50, might = 50) {
  const t = unitStats(type);
  if (!t || soldiers <= 0) return 0;
  return soldiers * (t.atk + t.def) / 2 * (0.7 + training / 333) * (1 + might / 200) / 10;
}
// Power of a garrisoned/marching troop unit, with its leader's Might (leaderless units count less).
export function troopPower(state, u) {
  const l = leaderOf(state, u);
  return unitPower(u.type, u.soldiers, u.training, l ? l.might : 0) * (l ? 1 : LEADERLESS_FACTOR);
}
export const companyPower = c => (c ? unitPower(c.type, c.soldiers, 60, 0) : 0);
export const spiritPower = id => (id ? unitPower(id, SPIRIT_UNIT[id].soldiers, 100, 40) : 0);

// The units a province would field in battle: its strongest MAX_UNITS_PER_ARMY troop units.
export function fieldedUnits(state, pid) {
  return [...state.provinces[pid].units].filter(u => u.soldiers > 0)
    .sort((a, b) => troopPower(state, b) - troopPower(state, a) || (a.uid < b.uid ? -1 : 1))
    .slice(0, MAX_UNITS_PER_ARMY);
}

// Army strength of a province (fielded units + company, or spirit if no company and a vassal).
export function provinceArmyPower(state, pid, house = state.provinces[pid].owner) {
  const pr = state.provinces[pid];
  let s = fieldedUnits(state, pid).reduce((a, u) => a + troopPower(state, u), 0);
  if (pr.company) s += companyPower(pr.company);
  else if (pr.vassals.length) s += spiritPower(availableSpirit(state, house, false));
  return s;
}

// Defensive strength of a province as an attacker would face it.
export function provinceDefence(state, pid) {
  const pr = state.provinces[pid];
  let s = provinceArmyPower(state, pid);
  if (!pr.owner) s += pr.militia.reduce((a, n) => a + unitPower('militia', n, 30, 0), 0);
  else if (s === 0) s += unitPower('militia', emptyMilitia(pr), 25, 0);
  // keep walls; the land's keep and walls (js/land) add on top of the base 10%
  const land = pr.owner ? (yieldOf(state, pid)?.defense || 0.1) : 0;
  return s * (pr.owner ? 1.25 * (1 + land - 0.1) : 1);
}
// An owned province with no troops raises a levy from its people.
export function emptyMilitia(pr) { return Math.round(20 + pr.loyalty); }

export function housePower(state, house) {
  let s = 0;
  for (const p of ownedProvinces(state, house)) {
    s += p.units.reduce((a, u) => a + troopPower(state, u), 0) + companyPower(p.company);
  }
  for (const m of state.marches) if (m.house === house) s += m.units.reduce((a, u) => a + troopPower(state, u), 0);
  return s;
}

export function houseTotals(state, house) {
  const ps = ownedProvinces(state, house);
  const vs = houseVassals(state, house);
  const marching = state.marches.filter(m => m.house === house);
  return {
    provinces: ps.length,
    food: ps.reduce((a, p) => a + p.food, 0),
    gold: ps.reduce((a, p) => a + p.gold, 0),
    soldiers: ps.reduce((a, p) => a + p.units.reduce((b, u) => b + u.soldiers, 0) + (p.company ? p.company.soldiers : 0), 0) +
      marching.reduce((a, m) => a + m.units.reduce((b, u) => b + u.soldiers, 0), 0),
    units: ps.reduce((a, p) => a + p.units.length, 0) + marching.reduce((a, m) => a + m.units.length, 0),
    vassals: vs.length,
    shards: shardsOf(state, house),
    power: Math.round(housePower(state, house)),
  };
}

// Monthly food upkeep of the troops stationed in a province.
export function provinceUpkeep(state, pid) {
  return state.provinces[pid].units.reduce((a, u) => a + u.soldiers * (TROOPS[u.type]?.upkeep ?? 4) / 100, 0);
}

export function neighbours(pid) { return ADJACENCY[pid]; }

// Province can see (UI fog): own, adjacent to own, or spied within the last 6 months.
export function canSee(state, house, pid) {
  const pr = state.provinces[pid];
  if (pr.owner === house) return true;
  if (ADJACENCY[pid].some(n => state.provinces[n].owner === house)) return true;
  const seen = state.intel[house]?.[pid];
  return seen != null && state.turn - seen <= 6;
}

export function addLog(state, text, kind = 'info', art) {
  const e = { turn: state.turn, text, kind };
  if (art) e.art = art;
  state.log.push(e);
  if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
}

export function vassalName(id) { return VASSAL_BY_ID[id]?.name ?? id; }
export function houseName(id) { return id ? (HOUSE_BY_ID[id]?.name ?? id) : 'the free folk'; }
export function provinceName(pid) { return PROVINCES[pid]?.name ?? String(pid); }
export function unitName(u) { return unitStats(u.type)?.name ?? u.type; }

export const isPlayerControlled = (state, house) => house === state.player && !state.autoPlayer;

// Simple stable hash of the state (FNV-1a over JSON), for determinism tests.
export function stateHash(state) {
  const s = JSON.stringify(state);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// Beta tester mode (state.beta = { gold, food }): for the player's house only, gold (and food)
// never run out. Costs are still charged and shown; the treasury is simply topped back up to a
// large floor before every order, after the monthly tick and at the end of each month. AI houses
// are never affected.
export const BETA_GOLD = 9999, BETA_FOOD = 9999;
export function isFree(state, house, kind = 'gold') {
  return !!(state && state.beta && state.beta[kind] && house && house === state.player);
}
export function betaTopUp(state) {
  const b = state && state.beta;
  if (!b || !(b.gold || b.food)) return;
  for (const pr of state.provinces) {
    if (pr.owner !== state.player) continue;
    if (b.gold && pr.gold < BETA_GOLD) pr.gold = BETA_GOLD;
    if (b.food && pr.food < BETA_FOOD) pr.food = BETA_FOOD;
  }
}
export function setBeta(state, on, food = on) {
  state.beta = on ? { gold: true, food: !!food } : null;
  betaTopUp(state);
}
