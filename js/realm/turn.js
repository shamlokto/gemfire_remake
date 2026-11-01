// Month end: AI orders, march resolution (battles), economy, victory, calendar.
//
//   await endMonth(state, { resolveBattle, autoResolve })
//
// resolveBattle(input, state, ctx) is called for battles the human player is in (attacker or
// defender); it returns a BattleResult or a Promise of one (the UI opens the battle screen).
// ctx = { march, seed }. All other battles use autoResolve(input, seed) from ../battle/auto.js,
// loaded lazily (opts.autoResolve overrides it, e.g. in tests). Mutates state; returns a summary
// { battles: [{ march, input, result }], winner, defeated }.

import { STORY } from '../data/events.js';
import { HOUSES } from '../data/houses.js';
import { SPIRIT_IDS } from '../data/spirits.js';
import { ADJACENCY, PROVINCES } from '../data/world.js';
import { MAX_VASSALS_PER_PROVINCE } from '../data/units.js';
import {
  withRng, seasonIndex, provinceVassals, ownedProvinces, houseVassals, shardsOf, addLog,
  houseName, provinceName, vassalName, emptyMilitia, isPlayerControlled, aliveHouses,
  VICTORY_PROVINCES,
} from './state.js';
import { applyOrder, resetOrders, moveVassal } from './orders.js';
import { monthlyTick } from './economy.js';
import { planHouseOrders } from './ai.js';
import { defect } from './diplomacy.js';

let autoModule = null;
async function defaultAuto() {
  if (!autoModule) autoModule = await import('../battle/auto.js');
  return autoModule.autoResolve;
}

// ---------- battle input ----------
function availableSpirit(state, house) {
  if (!house) return null;
  const si = seasonIndex(state);
  const used = state.houses[house].spiritUsed;
  return shardsOf(state, house).find(s => used[s] !== si) || null;
}

const vassalUnit = v => ({
  id: v.id, kind: 'vassal', vassalId: v.id, type: v.troop, soldiers: v.soldiers,
  training: v.training, might: v.might, wits: v.wits,
});

export function buildBattleInput(state, march) {
  const pr = state.provinces[march.to];
  const atk = march.vassals.map(id => state.vassals[id]).filter(v => v && v.soldiers > 0).map(vassalUnit);
  if (march.company && march.company.soldiers > 0) {
    atk.push({ id: 'company:a', kind: 'company', type: march.company.type, soldiers: march.company.soldiers, training: 60, might: 50, wits: 50 });
  }
  const def = provinceVassals(state, pr.id).filter(v => v.soldiers > 0).map(vassalUnit);
  if (pr.company && pr.company.soldiers > 0) {
    def.push({ id: 'company:d', kind: 'company', type: pr.company.type, soldiers: pr.company.soldiers, training: 60, might: 50, wits: 50 });
  }
  if (!pr.owner && pr.militia > 0) {
    def.push({ id: 'militia', kind: 'militia', type: 'militia', soldiers: pr.militia, training: 30, might: 40, wits: 30 });
  } else if (pr.owner && !def.length) {
    def.push({ id: 'militia', kind: 'militia', type: 'militia', soldiers: emptyMilitia(pr), training: 25, might: 35, wits: 30 });
  }
  return {
    provinceId: pr.id, terrain: PROVINCES[pr.id].terrain, siege: !!pr.owner,
    attacker: { house: march.house, units: atk, spirit: atk.some(u => u.kind === 'vassal') ? availableSpirit(state, march.house) : null },
    defender: { house: pr.owner, units: def, spirit: def.some(u => u.kind === 'vassal') ? availableSpirit(state, pr.owner) : null },
  };
}

// ---------- placing vassals after a battle ----------
function retreatTarget(state, house, near, prefer) {
  const ok = pid => pid != null && state.provinces[pid].owner === house &&
    state.provinces[pid].vassals.length < MAX_VASSALS_PER_PROVINCE;
  if (ok(prefer)) return prefer;
  const ring = [...ADJACENCY[near]].sort((a, b) => a - b);
  for (const n of ring) if (ok(n)) return n;
  return null;
}

function capture(state, vid, captor) {
  const v = state.vassals[vid];
  if (v.location != null) {
    const p = state.provinces[v.location];
    p.vassals = p.vassals.filter(x => x !== vid);
  }
  v.location = null; v.marching = false; v.soldiers = 0;
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
  for (const m of state.marches) if (m.house === house) m.vassals = [];
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
  h.capital = (own.find(p => p.shard) || own.reduce((a, b) => (b.vassals.length > a.vassals.length ? b : a))).id;
}

// ---------- applying a battle result ----------
export function applyBattleResult(state, march, input, result) {
  const pr = state.provinces[march.to];
  const defHouse = pr.owner;
  const atkHouse = march.house;
  const si = seasonIndex(state);
  if (result.attacker.spiritUsed && input.attacker.spirit) state.houses[atkHouse].spiritUsed[input.attacker.spirit] = si;
  if (result.defender.spiritUsed && input.defender.spirit && defHouse) state.houses[defHouse].spiritUsed[input.defender.spirit] = si;

  const after = (side, id) => side.units.find(u => u.id === id);
  // Update soldiers on both sides.
  for (const u of input.attacker.units) {
    const r = after(result.attacker, u.id); if (!r) continue;
    const left = Math.max(0, Math.round(r.soldiers));
    if (u.kind === 'vassal') state.vassals[u.vassalId].soldiers = left;
    else if (u.kind === 'company' && march.company) march.company.soldiers = left;
  }
  for (const u of input.defender.units) {
    const r = after(result.defender, u.id); if (!r) continue;
    const left = Math.max(0, Math.round(r.soldiers));
    if (u.kind === 'vassal') state.vassals[u.vassalId].soldiers = left;
    else if (u.kind === 'company' && pr.company) pr.company.soldiers = left;
    else if (u.kind === 'militia' && !pr.owner) pr.militia = left;
  }
  // Experience: survivors on both sides harden a little.
  for (const id of march.vassals) { const v = state.vassals[id]; if (v.soldiers > 0) v.training = Math.min(100, v.training + 3); }

  const where = provinceName(pr.id);
  withRng(state, rng => {
    if (result.winner === 'attacker') {
      // Defenders retreat or are captured.
      for (const v of provinceVassals(state, pr.id)) {
        const to = defHouse ? retreatTarget(state, defHouse, pr.id, null) : null;
        if (to != null) moveVassal(state, v.id, to);
        else capture(state, v.id, atkHouse);
      }
      pr.vassals = pr.vassals.filter(id => state.vassals[id].status === 'active' && state.vassals[id].location === pr.id);
      pr.owner = atkHouse;
      pr.company = null;
      pr.militia = 0;
      pr.loyalty = Math.min(pr.loyalty, 45);
      pr.food += march.food;
      for (const id of march.vassals) if (state.vassals[id].status === 'active') moveVassal(state, id, pr.id);
      if (march.company && march.company.soldiers > 0) pr.company = march.company;
      state.intel[atkHouse][pr.id] = state.turn;
      addLog(state, `${houseName(atkHouse)} takes ${where}${defHouse ? ' from ' + houseName(defHouse) : ''}.`, 'battle', defHouse ? STORY.siege.art : undefined);
      if (pr.shard) addLog(state, `The ${pr.shard} shard of ${where} passes to ${houseName(atkHouse)}.`, 'story');
      if (defHouse) {
        loyaltyShock(state, rng, defHouse, atkHouse);
        if (!ownedProvinces(state, defHouse).length) eliminate(state, defHouse, atkHouse);
        else fixCapital(state, defHouse);
      }
    } else {
      // Attackers fall back.
      for (const id of march.vassals) {
        const v = state.vassals[id];
        if (v.status !== 'active') continue;
        const to = retreatTarget(state, atkHouse, march.from, march.from);
        if (to != null) moveVassal(state, id, to);
        else capture(state, id, defHouse);
      }
      if (march.company && march.company.soldiers > 0) {
        const back = state.provinces[march.from];
        if (back.owner === atkHouse && !back.company) back.company = march.company;
      }
      addLog(state, `${houseName(atkHouse)} is driven back from ${where}.`, 'battle');
      if (defHouse) loyaltyShock(state, rng, atkHouse, defHouse);
    }
  });
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

  // 3. Economy
  withRng(state, rng => monthlyTick(state, rng));

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
  for (const id of m.vassals) {
    const v = state.vassals[id];
    if (!v || v.status !== 'active' || !v.marching) continue;
    const to = retreatTarget(state, v.house, m.from, m.from);
    if (to != null) moveVassal(state, id, to);
    else capture(state, id, state.provinces[m.from].owner);
  }
}

async function resolveMarch(state, m, opts, summary) {
  m.vassals = m.vassals.filter(id => {
    const v = state.vassals[id];
    return v && v.status === 'active' && v.house === m.house && v.marching;
  });
  if (!m.vassals.length || !state.houses[m.house].alive) return;
  const target = state.provinces[m.to];
  // Target became ours meanwhile: just move in (if room), else go home.
  if (target.owner === m.house) {
    for (const id of m.vassals) {
      const to = retreatTarget(state, m.house, m.to, m.to);
      if (to != null) moveVassal(state, id, to); else capture(state, id, null);
    }
    target.food += m.food;
    if (m.company && !target.company) target.company = m.company;
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
