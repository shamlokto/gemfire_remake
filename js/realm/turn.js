// Month end: AI orders, march resolution (battles), economy, victory, calendar.
//
//   await endMonth(state, { resolveBattle, autoResolve })
//
// resolveBattle(input, state, ctx) is called for battles the human player is in (attacker or
// defender); it returns a BattleResult or a Promise of one (the UI opens the battle screen).
// ctx = { march, seed }. All other battles use autoResolve(input, seed) from ../battle/auto.js,
// loaded lazily (opts.autoResolve overrides it, e.g. in tests). Mutates state; returns a summary
// { battles: [{ march, input, result }], winner, defeated }.
//
// v2: a battle side is up to 4 troop units plus a 5th slot (company or summoned spirit); see
// buildBattleInput. Defenders beyond the 4 fielded units fall back with the vassals if the
// province falls.

import { STORY } from '../data/events.js';
import { HOUSES } from '../data/houses.js';
import { SPIRIT_IDS, SPIRIT_UNIT } from '../data/spirits.js';
import { ADJACENCY, PROVINCES, isSeaLane } from '../data/world.js';
import { MAX_VASSALS_PER_PROVINCE, MAX_UNITS_PER_PROVINCE, COMPANIES } from '../data/units.js';
import { techEffect, spendCharge, setCharge, chargeTick, researchTick } from './tech.js';
import {
  withRng, seasonIndex, season, provinceVassals, ownedProvinces, houseVassals, shardsOf, addLog,
  houseName, provinceName, vassalName, emptyMilitia, isPlayerControlled, aliveHouses,
  VICTORY_PROVINCES, fieldedUnits, availableSpirit, wanderersAt,
} from './state.js';

// A vassal on the losing side with no surviving unit is captured with this chance.
export const UNITLESS_CAPTURE = 0.4;
import { applyOrder, resetOrders, moveVassal } from './orders.js';
import { monthlyTick } from './economy.js';
import { planHouseOrders } from './ai.js';
import { defect, joinHouse } from './diplomacy.js';

let autoModule = null;
async function defaultAuto() {
  if (!autoModule) autoModule = await import('../battle/auto.js');
  return autoModule.autoResolve;
}

// ---------- battle input ----------
// Tech and terrain modifiers become per-unit atkBonus/defBonus multipliers (js/battle/rules.js).
const round2 = x => Math.round(x * 100) / 100;
function troopIn(state, u, mods) {
  const l = u.leader ? state.vassals[u.leader] : null;
  let atk = mods.atk, def = mods.def;
  if (u.type === 'siege') atk *= 1 + techEffect(state, mods.house, 'siegeAtk');
  const r = { id: u.uid, kind: 'troop', type: u.type, soldiers: u.soldiers, training: u.training,
    leader: l ? l.id : null, might: l ? l.might : 0, wits: l ? l.wits : 0 };
  if (atk !== 1) r.atkBonus = round2(atk);
  if (def !== 1) r.defBonus = round2(def);
  return r;
}
function companyIn(c, id, terrain) {
  const r = { id, kind: 'company', type: c.type, soldiers: c.soldiers, training: 60, leader: null, might: 0, wits: 0 };
  const tb = COMPANIES[c.type]?.terrainBonus?.[terrain];
  if (tb) r.atkBonus = tb;
  return r;
}
// A summoned spirit: its spell draws on the best Wits among the vassals present. Lantern Lore
// raises its essence; the enemy's Warding lowers it.
function spiritIn(state, house, enemy, spiritId, id, vassals) {
  const ess = SPIRIT_UNIT[spiritId].soldiers * (1 + techEffect(state, house, 'spiritEssence')) * (1 - techEffect(state, enemy, 'ward'));
  return { id, kind: 'spirit', type: spiritId, soldiers: Math.max(1, Math.round(ess)), training: 100, leader: null,
    might: 40, wits: vassals.reduce((a, v) => Math.max(a, v.wits), 0) };
}

export function buildBattleInput(state, march) {
  const pr = state.provinces[march.to];
  const terrain = PROVINCES[pr.id].terrain;
  const aH = march.house, dH = pr.owner;
  const atkMods = { house: aH, atk: (1 + techEffect(state, aH, 'troopAtk')) * (isSeaLane(march.from, march.to) ? 1 + techEffect(state, aH, 'seaAttack') : 1), def: 1 };
  const defMods = { house: dH, atk: 1 + techEffect(state, dH, 'troopAtk'), def: 1 + techEffect(state, dH, 'homeDef') };
  const atkVassals = march.vassals.map(id => state.vassals[id]).filter(v => v && v.status === 'active');
  const atk = march.units.filter(u => u.soldiers > 0).map(u => troopIn(state, u, atkMods));
  if (march.fifth?.kind === 'company' && march.fifth.soldiers > 0) atk.push(companyIn(march.fifth, 'company:a', terrain));
  else if (march.fifth?.kind === 'spirit' && atkVassals.length) atk.push(spiritIn(state, aH, dH, march.fifth.id, 'spirit:a', atkVassals));

  const defVassals = provinceVassals(state, pr.id);
  const def = fieldedUnits(state, pr.id).map(u => troopIn(state, u, defMods));
  if (pr.company && pr.company.soldiers > 0) def.push(companyIn(pr.company, 'company:d', terrain));
  else if (pr.owner && defVassals.length) {
    const sp = availableSpirit(state, pr.owner);
    if (sp) def.push(spiritIn(state, dH, aH, sp, 'spirit:d', defVassals));
  }
  if (!pr.owner) {
    pr.militia.forEach((n, i) => { if (n > 0) def.push({ id: 'militia:' + i, kind: 'militia', type: 'militia', soldiers: n, training: 30, leader: null, might: 0, wits: 0 }); });
  } else if (!def.some(u => u.kind !== 'spirit')) {
    def.push({ id: 'levy', kind: 'militia', type: 'militia', soldiers: emptyMilitia(pr), training: 25, leader: null, might: 0, wits: 0 });
  }
  return {
    provinceId: pr.id, terrain: PROVINCES[pr.id].terrain, siege: !!pr.owner, season: season(state),
    attacker: { house: march.house, units: atk },
    defender: { house: pr.owner, units: def },
  };
}

// ---------- placing vassals and units after a battle ----------
// An own province with room for `nv` more vassals and `nu` more units (prefer `prefer`, then
// the neighbours of `near`).
function retreatTarget(state, house, near, prefer, nv = 1, nu = 0) {
  const ok = pid => pid != null && state.provinces[pid].owner === house &&
    state.provinces[pid].vassals.length + nv <= MAX_VASSALS_PER_PROVINCE &&
    state.provinces[pid].units.length + nu <= MAX_UNITS_PER_PROVINCE;
  if (ok(prefer)) return prefer;
  const ring = [...ADJACENCY[near]].sort((a, b) => a - b);
  for (const n of ring) if (ok(n)) return n;
  return null;
}

function clearLeader(state, vid) {
  for (const p of state.provinces) for (const u of p.units) if (u.leader === vid) u.leader = null;
  for (const m of state.marches) for (const u of m.units) if (u.leader === vid) u.leader = null;
}

function capture(state, vid, captor) {
  const v = state.vassals[vid];
  if (v.location != null) {
    const p = state.provinces[v.location];
    p.vassals = p.vassals.filter(x => x !== vid);
  }
  clearLeader(state, vid);
  v.location = null; v.marching = false;
  if (captor) { v.status = 'captive'; v.captor = captor; }
  else { v.status = 'exiled'; v.captor = null; }
  addLog(state, captor ? `${vassalName(vid)} is taken captive by ${houseName(captor)}.` : `${vassalName(vid)} flees into exile.`, 'battle');
  const h = state.houses[v.house];
  if (h && h.ruler === vid) succession(state, v.house);
}

function succession(state, house) {
  const h = state.houses[house];
  const heirs = houseVassals(state, house).filter(v => v.id !== h.ruler);
  if (!heirs.length) { h.ruler = null; return; }
  const heir = heirs.reduce((a, b) => (b.might + b.wits + b.charm > a.might + a.wits + a.charm ? b : a));
  h.ruler = heir.id;
  heir.loyalty = 100;
  addLog(state, `${vassalName(heir.id)} now leads ${houseName(house)}.`, 'story');
  if (isPlayerControlled(state, house)) {
    state.pendingEvents.push({ title: 'Succession', text: `Your ruler is lost. ${vassalName(heir.id)} takes command of ${houseName(house)}.` });
  }
}

function eliminate(state, house, by) {
  const h = state.houses[house];
  if (!h.alive) return;
  h.alive = false;
  for (const v of houseVassals(state, house)) capture(state, v.id, by);
  for (const m of state.marches) if (m.house === house) { m.vassals = []; m.units = []; }
  addLog(state, `${houseName(house)} is destroyed.`, 'story');
  if (house === state.player && !state.autoPlayer) {
    state.defeated = true;
    const text = STORY.defeat.text.replace('{house}', houseName(house));
    state.pendingEvents.push({ art: STORY.defeat.art, title: STORY.defeat.title, text });
  }
}

function fixCapital(state, house) {
  const h = state.houses[house];
  if (!h.alive || state.provinces[h.capital]?.owner === house) return;
  const own = ownedProvinces(state, house);
  if (!own.length) return;
  h.capital = (own.find(p => p.shard) || own.reduce((a, b) => (b.units.length > a.units.length ? b : a))).id;
}

// Sends a group (vassals + units, leaders kept) back to an own province; units that find no room
// are lost (they scatter), vassals with no room are captured by `captor`.
function sendBack(state, house, near, prefer, vids, units, captor) {
  let units2 = units.filter(u => u.soldiers > 0);
  const target = retreatTarget(state, house, near, prefer, 0, 0) ?? null;
  for (const vid of vids) {
    const v = state.vassals[vid];
    if (v.status !== 'active') continue;
    const to = retreatTarget(state, house, near, prefer, 1, 0);
    if (to != null) moveVassal(state, vid, to); else capture(state, vid, captor);
  }
  for (const u of units2) {
    const to = retreatTarget(state, house, near, target ?? prefer, 0, 1);
    if (to == null) continue;
    const dst = state.provinces[to];
    if (u.leader && state.vassals[u.leader]?.location !== to) u.leader = null;
    dst.units.push(u);
  }
}

// ---------- applying a battle result ----------
export function applyBattleResult(state, march, input, result) {
  const pr = state.provinces[march.to];
  const defHouse = pr.owner;
  const atkHouse = march.house;
  const spiritOf = side => side.units.find(u => u.kind === 'spirit');
  const as = spiritOf(input.attacker), ds = spiritOf(input.defender);
  // A summon spends the shard's whole charge, win or lose.
  if (as) spendCharge(state, atkHouse, as.type);
  if (ds && defHouse) spendCharge(state, defHouse, ds.type);

  const after = (side, id) => side.units.find(u => u.id === id);
  const left = r => Math.max(0, Math.round(r.soldiers));
  // Update soldiers on both sides.
  for (const u of march.units) { const r = after(result.attacker, u.uid); if (r) u.soldiers = left(r); }
  if (march.fifth?.kind === 'company') { const r = after(result.attacker, 'company:a'); if (r) march.fifth.soldiers = left(r); }
  for (const u of pr.units) { const r = after(result.defender, u.uid); if (r) u.soldiers = left(r); }
  if (pr.company) { const r = after(result.defender, 'company:d'); if (r) pr.company.soldiers = left(r); if (pr.company.soldiers <= 0) pr.company = null; }
  if (!pr.owner) pr.militia = pr.militia.map((n, i) => { const r = after(result.defender, 'militia:' + i); return r ? left(r) : n; }).filter(n => n > 0);
  march.units = march.units.filter(u => u.soldiers > 0);
  pr.units = pr.units.filter(u => u.soldiers > 0);
  // Experience: surviving attackers harden a little.
  for (const u of march.units) u.training = Math.min(100, u.training + 3);
  const atkCompany = march.fifth?.kind === 'company' && march.fifth.soldiers > 0 ? { type: march.fifth.type, soldiers: march.fifth.soldiers } : null;

  const where = provinceName(pr.id);
  withRng(state, rng => {
    // Vassals who lost their unit (or never had one) may be captured on the losing side.
    const leads = (units, vid) => units.some(u => u.leader === vid && u.soldiers > 0);
    if (result.winner === 'attacker') {
      const defenders = provinceVassals(state, pr.id).map(v => v.id);
      const survivors = pr.units;
      pr.units = [];
      for (const vid of defenders) {
        if (defHouse && !leads(survivors, vid) && rng.chance(UNITLESS_CAPTURE)) capture(state, vid, atkHouse);
      }
      if (defHouse) {
        // Survivors fall back together where they can.
        const keep = defenders.filter(vid => state.vassals[vid].status === 'active');
        for (const vid of keep) { const p = state.provinces[pr.id]; p.vassals = p.vassals.filter(x => x !== vid); state.vassals[vid].location = null; }
        sendBack(state, defHouse, pr.id, null, keep, survivors, atkHouse);
      } else {
        for (const vid of defenders) capture(state, vid, atkHouse);
      }
      pr.vassals = pr.vassals.filter(id => state.vassals[id].status === 'active' && state.vassals[id].location === pr.id);
      pr.owner = atkHouse;
      pr.company = null;
      pr.militia = [];
      pr.loyalty = Math.min(pr.loyalty, 45);
      pr.food += march.food;
      for (const id of march.vassals) if (state.vassals[id].status === 'active') moveVassal(state, id, pr.id);
      pr.units.push(...march.units.slice(0, MAX_UNITS_PER_PROVINCE));
      for (const u of pr.units) if (u.leader && state.vassals[u.leader]?.location !== pr.id) u.leader = null;
      if (atkCompany) pr.company = atkCompany;
      state.intel[atkHouse][pr.id] = state.turn;
      addLog(state, `${houseName(atkHouse)} takes ${where}${defHouse ? ' from ' + houseName(defHouse) : ''}.`, 'battle', defHouse ? STORY.siege.art : undefined);
      if (pr.shard) {
        addLog(state, `The ${pr.shard} shard of ${where} passes to ${houseName(atkHouse)}.`, 'story');
        setCharge(state, atkHouse, pr.shard, 0);          // a captured shard starts empty
        if (defHouse && state.houses[defHouse]?.charge) delete state.houses[defHouse].charge[pr.shard];
      }
      offerWanderers(state, rng, pr.id, atkHouse);
      if (defHouse) {
        loyaltyShock(state, rng, defHouse, atkHouse);
        if (!ownedProvinces(state, defHouse).length) eliminate(state, defHouse, atkHouse);
        else fixCapital(state, defHouse);
      }
    } else {
      // Attackers fall back.
      const vids = march.vassals.filter(id => state.vassals[id].status === 'active');
      const free = [];
      for (const vid of vids) {
        if (defHouse && !leads(march.units, vid) && rng.chance(UNITLESS_CAPTURE)) capture(state, vid, defHouse);
        else free.push(vid);
      }
      sendBack(state, atkHouse, march.from, march.from, free, march.units, defHouse);
      march.units = [];
      if (atkCompany) {
        const back = state.provinces[march.from];
        if (back.owner === atkHouse && !back.company) back.company = atkCompany;
      }
      addLog(state, `${houseName(atkHouse)} is driven back from ${where}.`, 'battle');
      if (defHouse) loyaltyShock(state, rng, atkHouse, defHouse);
    }
  });
}

// Wanderers in a conquered province may offer their swords to the conqueror.
export const WANDERER_OFFER = 0.4;
function offerWanderers(state, rng, pid, house) {
  for (const w of wanderersAt(state, pid)) {
    const ruler = state.vassals[state.houses[house].ruler];
    const p = WANDERER_OFFER + (ruler ? ruler.charm / 300 : 0);
    if (rng.chance(p)) joinHouse(state, w.id, house, pid);
  }
}

// Heirs come of age; wanderers drift each new year.
function characterTick(state, rng) {
  for (const v of Object.values(state.vassals)) {
    if (v.status === 'future' && state.turn >= v.dueTurn) {
      const h = state.houses[v.house];
      const home = h?.alive ? [h.capital, ...ownedProvinces(state, v.house).map(p => p.id)]
        .find(pid => state.provinces[pid].owner === v.house && state.provinces[pid].vassals.length < MAX_VASSALS_PER_PROVINCE) : null;
      if (home != null) joinHouse(state, v.id, v.house, home);
      else if (!h?.alive) {
        v.house = null; v.status = 'wandering'; v.location = h ? h.capital : 0; delete v.dueTurn;
        addLog(state, `${vassalName(v.id)} comes of age with no house left to serve, and takes to the roads.`, 'story');
      }
    } else if (v.status === 'wandering' && state.month === 0 && rng.chance(0.3)) {
      v.location = rng.pick(ADJACENCY[v.location]);
    }
  }
}

// Losing a battle shakes the loser's vassals; disloyal ones may change sides.
function loyaltyShock(state, rng, loser, winner) {
  for (const v of houseVassals(state, loser)) {
    if (state.houses[loser].ruler === v.id) continue;
    v.loyalty = Math.max(0, v.loyalty - 2);
    if (v.loyalty < 40 && v.location != null && rng.chance(0.08)) {
      const to = retreatTarget(state, winner, v.location, null) ?? null;
      if (to != null) defect(state, v.id, winner, to);
    }
  }
  for (const v of houseVassals(state, winner)) if (state.houses[winner].ruler !== v.id) v.loyalty = Math.min(100, v.loyalty + 1);
}

// ---------- the month ----------
function houseOrder(state) {
  const ids = HOUSES.map(h => h.id);
  const k = state.turn % ids.length;
  return [...ids.slice(k), ...ids.slice(0, k)];
}

export async function endMonth(state, opts = {}) {
  const summary = { battles: [], winner: null, defeated: false };
  if (state.winner || state.defeated) return summary;
  const order = houseOrder(state);

  // 1. AI orders
  for (const h of order) {
    if (!state.houses[h].alive || isPlayerControlled(state, h)) continue;
    const orders = withRng(state, rng => planHouseOrders(state, h, rng));
    for (const o of orders) applyOrder(state, o);
  }

  // 2. Marches, in rotating house order
  const rank = Object.fromEntries(order.map((h, i) => [h, i]));
  const marches = state.marches.map((m, i) => ({ m, i }))
    .sort((a, b) => rank[a.m.house] - rank[b.m.house] || a.i - b.i).map(x => x.m);
  state.marches = [];
  for (const m of marches) {
    await resolveMarch(state, m, opts, summary);
    if (state.defeated) break;
  }
  // Anyone left marching (e.g. game ended mid-month) goes home.
  for (const m of state.marches) returnHome(state, m);
  state.marches = [];

  // 3. Economy, research, shard charge, characters
  withRng(state, rng => monthlyTick(state, rng));
  researchTick(state);
  chargeTick(state);
  withRng(state, rng => characterTick(state, rng));

  // 4. Victory
  checkVictory(state);

  // 5. Calendar
  state.turn++;
  state.month++;
  if (state.month >= 12) { state.month = 0; state.year++; }
  resetOrders(state);
  for (const k of Object.keys(state.truces)) if (state.truces[k] <= state.turn) delete state.truces[k];
  state.marriages = state.marriages.filter(m => m[2] > state.turn);

  summary.winner = state.winner;
  summary.defeated = state.defeated;
  return summary;
}

function returnHome(state, m) {
  const vids = m.vassals.filter(id => {
    const v = state.vassals[id];
    return v && v.status === 'active' && v.marching;
  });
  sendBack(state, m.house, m.from, m.from, vids, m.units, state.provinces[m.from].owner === m.house ? null : state.provinces[m.from].owner);
  m.units = []; m.vassals = [];
  if (m.fifth?.kind === 'company') {
    const back = state.provinces[m.from];
    if (back.owner === m.house && !back.company) back.company = { type: m.fifth.type, soldiers: m.fifth.soldiers };
  }
}

async function resolveMarch(state, m, opts, summary) {
  m.vassals = m.vassals.filter(id => {
    const v = state.vassals[id];
    return v && v.status === 'active' && v.house === m.house && v.marching;
  });
  if (!state.houses[m.house].alive) return;
  if (!m.vassals.length) { returnHome(state, m); return; }
  const target = state.provinces[m.to];
  // Target became ours meanwhile: just move in (if room), else go home.
  if (target.owner === m.house) {
    sendBack(state, m.house, m.from, m.to, m.vassals, m.units, null);
    m.units = [];
    target.food += m.food;
    if (m.fifth?.kind === 'company' && !target.company) target.company = { type: m.fifth.type, soldiers: m.fifth.soldiers };
    return;
  }
  const input = buildBattleInput(state, m);
  if (!input.attacker.units.length) { returnHome(state, m); return; }
  let result;
  const defenders = input.defender.units.filter(u => u.soldiers > 0);
  if (!defenders.length) {
    result = {
      winner: 'attacker', rounds: 0,
      attacker: { units: input.attacker.units.map(u => ({ id: u.id, soldiers: u.soldiers, fate: 'ok' })), spiritUsed: false },
      defender: { units: input.defender.units.map(u => ({ id: u.id, soldiers: 0, fate: 'routed' })), spiritUsed: false },
    };
  } else {
    const seed = withRng(state, rng => rng.int(1, 0x7fffffff));
    const human = isPlayerControlled(state, m.house) || isPlayerControlled(state, target.owner);
    if (human && opts.resolveBattle) {
      result = await opts.resolveBattle(input, state, { march: m, seed });
    } else {
      const auto = opts.autoResolve || await defaultAuto();
      result = await auto(input, seed);   // auto.js takes a numeric seed
    }
  }
  applyBattleResult(state, m, input, result);
  summary.battles.push({ march: m, input, result });
}

export function checkVictory(state) {
  if (state.winner) return state.winner;
  const alive = aliveHouses(state);
  let winner = null;
  for (const h of alive) {
    const n = ownedProvinces(state, h).length;
    const shards = new Set(shardsOf(state, h));
    if (n >= VICTORY_PROVINCES || SPIRIT_IDS.every(s => shards.has(s))) { winner = h; break; }
  }
  if (!winner && alive.length === 1) winner = alive[0];
  if (winner) {
    state.winner = winner;
    const text = STORY.victory.text.replace('{house}', houseName(winner));
    addLog(state, text, 'story', STORY.victory.art);
    state.pendingEvents.push({ art: STORY.victory.art, title: STORY.victory.title, text, winner });
  }
  return winner;
}
