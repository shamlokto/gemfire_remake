// RealmState construction and read helpers. Pure: no DOM, runs in node.
//
// Design note: realm functions MUTATE the state they are given (no cloning). Callers that want
// an undo point should snapshot with JSON.parse(JSON.stringify(state)) first. The whole state is
// plain JSON, so saving is JSON.stringify(state).
//
// Additions beyond docs/DESIGN.md:
//   marches: [March]   queued attacks, resolved at month end (see orders.js / turn.js)
//   autoPlayer: bool   if true the AI also plays the player's house (tests, demo mode)
//   defeated: bool     the player's house has been eliminated (game over)
//   vassal.marching    true while the vassal is part of a queued march (location is null then)
// March = { house, from, to, vassals: [vassalId], company: {type, soldiers}|null, food }

import { PROVINCES, PROVINCE_DEFAULTS, NEUTRAL_MILITIA, START_YEAR, seasonOf, ADJACENCY } from '../data/world.js';
import { HOUSES, HOUSE_START, HOUSE_BY_ID } from '../data/houses.js';
import { VASSALS, VASSAL_BY_ID } from '../data/vassals.js';
import { TROOPS, COMPANIES, MILITIA } from '../data/units.js';
import { STORY } from '../data/events.js';
import { makeRng } from '../rng.js';

export const STATE_VERSION = 1;
export const VICTORY_PROVINCES = 18;
export const START_TRAINING = 40;

export function newGame(player, seed = 1) {
  if (!HOUSE_BY_ID[player]) throw new Error('unknown house ' + player);
  const rng = makeRng(seed >>> 0);
  const owner = {};
  for (const h of HOUSES) for (const p of h.provinces) owner[p] = h.id;

  const provinces = PROVINCES.map(p => {
    const o = owner[p.id] ?? null;
    const base = { ...PROVINCE_DEFAULTS, ...(o ? HOUSE_START[o] : {}) };
    return {
      id: p.id, owner: o,
      fields: base.fields, market: base.market, dikes: base.dikes, loyalty: base.loyalty,
      food: base.food, gold: base.gold,
      vassals: [], company: null,
      militia: o ? 0 : rng.int(NEUTRAL_MILITIA.min, NEUTRAL_MILITIA.max),
      shard: null, ordered: false,
    };
  });
  // Non-capital starting provinces get a little less.
  for (const h of HOUSES) {
    for (const pid of h.provinces) if (pid !== h.capital) {
      const pr = provinces[pid];
      pr.food = Math.round(pr.food * 0.6); pr.gold = Math.round(pr.gold * 0.6);
    }
    if (h.shard) provinces[h.capital].shard = h.shard;
  }

  const vassals = {};
  for (const v of VASSALS) {
    vassals[v.id] = {
      id: v.id, house: v.house, might: v.might, wits: v.wits, charm: v.charm, loyalty: v.loyalty,
      troop: v.troop, soldiers: v.soldiers, training: START_TRAINING, location: v.at,
      status: 'active', captor: null, marching: false,
    };
    provinces[v.at].vassals.push(v.id);
  }

  const houses = {};
  const intel = {};
  for (const h of HOUSES) {
    houses[h.id] = { id: h.id, alive: true, ruler: h.ruler, capital: h.capital, spiritUsed: {} };
    intel[h.id] = {};
  }

  return {
    version: STATE_VERSION, seed: seed >>> 0, rng: rng.state,
    turn: 0, year: START_YEAR, month: 0,
    player,
    houses, provinces, vassals,
    truces: {}, marriages: [], intel,
    log: [{ turn: 0, text: `${HOUSE_BY_ID[player].name} takes up the struggle for Varenhold.`, kind: 'story' }],
    pendingEvents: [{ art: STORY.prologue.art, title: STORY.prologue.title, text: STORY.prologue.text }],
    marches: [], autoPlayer: false, defeated: false,
    winner: null,
  };
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

// Combat power estimate of a unit (used by AI and the UI's strength bars).
export function unitPower(type, soldiers, training = 50, might = 50) {
  const t = TROOPS[type] || COMPANIES[type] || (type === 'militia' ? MILITIA : null);
  if (!t || soldiers <= 0) return 0;
  return soldiers * (t.atk + t.def) / 2 * (0.7 + training / 333) * (1 + might / 200) / 10;
}
export function vassalPower(v) { return unitPower(v.troop, v.soldiers, v.training, v.might); }

// Defensive strength of a province as an attacker would face it.
export function provinceDefence(state, pid) {
  const pr = state.provinces[pid];
  let s = provinceVassals(state, pid).reduce((a, v) => a + vassalPower(v), 0);
  if (pr.company) s += unitPower(pr.company.type, pr.company.soldiers, 60, 50);
  if (!pr.owner) s += unitPower('militia', pr.militia, 30, 40);
  else if (s === 0) s += unitPower('militia', emptyMilitia(pr), 30, 40);
  return s * (pr.owner ? 1.25 : 1);   // keep walls
}
// An owned province with no defenders raises a levy from its people.
export function emptyMilitia(pr) { return Math.round(20 + pr.loyalty); }

export function housePower(state, house) {
  let s = houseVassals(state, house).reduce((a, v) => a + vassalPower(v), 0);
  for (const p of ownedProvinces(state, house)) if (p.company) s += unitPower(p.company.type, p.company.soldiers, 60, 50);
  return s;
}

export function houseTotals(state, house) {
  const ps = ownedProvinces(state, house);
  const vs = houseVassals(state, house);
  return {
    provinces: ps.length,
    food: ps.reduce((a, p) => a + p.food, 0),
    gold: ps.reduce((a, p) => a + p.gold, 0),
    soldiers: vs.reduce((a, v) => a + v.soldiers, 0) + ps.reduce((a, p) => a + (p.company ? p.company.soldiers : 0), 0),
    vassals: vs.length,
    shards: shardsOf(state, house),
    power: Math.round(housePower(state, house)),
  };
}

// Monthly food upkeep of the troops stationed in a province.
export function provinceUpkeep(state, pid) {
  return provinceVassals(state, pid).reduce((a, v) => a + v.soldiers * (TROOPS[v.troop]?.upkeep ?? 4) / 100, 0);
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

export const isPlayerControlled = (state, house) => house === state.player && !state.autoPlayer;

// Simple stable hash of the state (FNV-1a over JSON), for determinism tests.
export function stateHash(state) {
  const s = JSON.stringify(state);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
