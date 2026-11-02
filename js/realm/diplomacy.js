// Diplomacy: truce, tribute, marriage pact, bribe. Called by orders.js (order.type 'diplomacy').
// Each function: (state, rng, ctx) -> { ok, msg }. ok=false with a reason when the attempt cannot
// be made at all (nothing spent); success:false when it was made and failed (cost spent).
// ctx = { province, house, envoy, target, vassal }.

import { MAX_VASSALS_PER_PROVINCE, MAX_UNITS_PER_PROVINCE } from '../data/units.js';
import { STORY } from '../data/events.js';
import {
  housePower, ownedProvinces, pairKey, atPeace, addLog, houseName, vassalName, isRuler,
  provinceName, isPlayerControlled, houseTotals,
} from './state.js';

export const DIPLOMACY = {
  truce:    { label: 'Offer truce',       cost: 50,  months: 12 },
  tribute:  { label: 'Demand tribute',    cost: 0 },
  marriage: { label: 'Propose marriage',  cost: 150, months: 36 },
  bribe:    { label: 'Bribe a vassal',    cost: null },   // cost depends on the vassal
};

export const bribeCost = v => 100 + v.might + v.wits;

const clamp01 = x => Math.max(0.02, Math.min(0.95, x));
function ratio(state, a, b) {
  return (housePower(state, a) + 1) / (housePower(state, b) + 1);
}

// Chances, exposed so the UI can show them.
export function truceChance(state, house, target, envoy) {
  // Weaker targets welcome a truce; stronger ones less so.
  return clamp01(0.25 + envoy.charm / 250 + (ratio(state, house, target) - 1) * 0.25);
}
export function marriageChance(state, house, target, envoy) {
  return clamp01(0.1 + envoy.charm / 300 + (ratio(state, house, target) - 0.8) * 0.2);
}
export function tributeChance(state, house, target, envoy) {
  const r = ratio(state, house, target);
  return r < 1.5 ? 0.02 : clamp01((r - 1.5) * 0.35 + envoy.charm / 500);
}
export function bribeChance(state, envoy, v) {
  if (isRuler(state, v.id)) return 0;
  return clamp01(((100 - v.loyalty) / 100) * (0.4 + envoy.charm / 120) - 0.05);
}

function spend(pr, cost) {
  if (pr.gold < cost) return false;
  pr.gold -= cost; return true;
}

export function doDiplomacy(state, rng, kind, ctx) {
  const { province: pr, house, envoy, target } = ctx;
  if (!envoy) return { ok: false, msg: 'An envoy (vassal) is needed in this province.' };
  if (kind !== 'bribe' && (!target || target === house || !state.houses[target]?.alive)) {
    return { ok: false, msg: 'Choose a living house.' };
  }
  const tName = houseName(target);
  const notify = (title, text, art) => {
    if (isPlayerControlled(state, target)) state.pendingEvents.push({ title, text, art });
  };

  if (kind === 'truce') {
    if (atPeace(state, house, target)) return { ok: false, msg: `Already at peace with ${tName}.` };
    if (!spend(pr, DIPLOMACY.truce.cost)) return { ok: false, msg: 'Not enough gold for gifts (50).' };
    if (rng.chance(truceChance(state, house, target, envoy))) {
      state.truces[pairKey(house, target)] = state.turn + DIPLOMACY.truce.months;
      addLog(state, `${houseName(house)} and ${tName} agree a truce for a year.`, 'diplomacy');
      notify('Truce', `${houseName(house)} and your house agree a truce for a year.`);
      return { ok: true, success: true, msg: `${tName} accepts a truce for twelve months.` };
    }
    return { ok: true, success: false, msg: `${tName} refuses the truce.` };
  }

  if (kind === 'marriage') {
    if (state.marriages.some(([a, b, u]) => u > state.turn && ((a === house && b === target) || (a === target && b === house)))) {
      return { ok: false, msg: 'A marriage pact already binds you.' };
    }
    if (!spend(pr, DIPLOMACY.marriage.cost)) return { ok: false, msg: 'Not enough gold for a dowry (150).' };
    if (rng.chance(marriageChance(state, house, target, envoy))) {
      state.marriages.push([house, target, state.turn + DIPLOMACY.marriage.months]);
      const cap = provinceName(state.houses[house].capital);
      const text = STORY.marriage.text.replace('{capital}', cap).replace('{house}', houseName(house)).replace('{other}', tName);
      addLog(state, text, 'diplomacy', STORY.marriage.art);
      if (isPlayerControlled(state, house) || isPlayerControlled(state, target)) {
        state.pendingEvents.push({ art: STORY.marriage.art, title: STORY.marriage.title, text });
      }
      return { ok: true, success: true, msg: `${tName} accepts the marriage pact.` };
    }
    return { ok: true, success: false, msg: `${tName} declines the match. The dowry is not returned.` };
  }

  if (kind === 'tribute') {
    if (rng.chance(tributeChance(state, house, target, envoy))) {
      const tp = ownedProvinces(state, target);
      let paid = 0;
      for (const p of tp) { const g = Math.floor(p.gold * 0.25); p.gold -= g; paid += g; }
      pr.gold += paid;
      addLog(state, `${tName} pays ${houseName(house)} ${paid} gold in tribute.`, 'diplomacy');
      notify('Tribute', `Fearing ${houseName(house)}, your house pays ${paid} gold.`);
      return { ok: true, success: true, msg: `${tName} pays ${paid} gold.` };
    }
    for (const v of Object.values(state.vassals)) if (v.house === house && v.status === 'active') v.loyalty = Math.max(0, v.loyalty - (isRuler(state, v.id) ? 0 : 1));
    return { ok: true, success: false, msg: `${tName} laughs at your envoy.` };
  }

  if (kind === 'bribe') {
    const v = state.vassals[ctx.vassal];
    if (!v || v.status !== 'active' || v.house === house) return { ok: false, msg: 'Choose an enemy vassal.' };
    if (isRuler(state, v.id)) return { ok: false, msg: 'A ruler cannot be bought.' };
    if (pr.vassals.length >= MAX_VASSALS_PER_PROVINCE) return { ok: false, msg: 'No room in this province for a turncoat.' };
    const cost = bribeCost(v);
    if (!spend(pr, cost)) return { ok: false, msg: `Not enough gold (${cost}).` };
    const victim = v.house;
    if (rng.chance(bribeChance(state, envoy, v))) {
      defect(state, v.id, house, pr.id);
      return { ok: true, success: true, msg: `${vassalName(v.id)} joins you with their troops.` };
    }
    v.loyalty = Math.min(100, v.loyalty + 5);
    notify('Bribe refused', `${vassalName(v.id)} refused gold from ${houseName(house)}.`);
    void victim;
    return { ok: true, success: false, msg: `${vassalName(v.id)} refuses the gold.` };
  }
  return { ok: false, msg: 'Unknown diplomacy.' };
}

// Moves a vassal (with the unit they lead, if it fits) to another house, into province toPid (or keeps them where they
// stand if toPid is null and their province changes hands elsewhere).
export function defect(state, vid, newHouse, toPid) {
  const v = state.vassals[vid];
  const old = v.house;
  const dst = state.provinces[toPid];
  if (v.location != null) {
    const src = state.provinces[v.location];
    src.vassals = src.vassals.filter(x => x !== vid);
    // The vassal's own unit follows them if there is room; otherwise it stays, leaderless.
    const u = src.units.find(x => x.leader === vid);
    if (u) {
      if (src.id !== toPid && dst.units.length < MAX_UNITS_PER_PROVINCE) {
        src.units.splice(src.units.indexOf(u), 1);
        dst.units.push(u);
      } else if (src.id !== toPid) u.leader = null;
    }
  }
  v.house = newHouse;
  v.loyalty = 55;
  v.location = toPid;
  v.marching = false;
  state.provinces[toPid].vassals.push(vid);
  const text = STORY.betrayal.text.replace('{vassal}', vassalName(vid)).replace('{house}', houseName(newHouse));
  addLog(state, text, 'betrayal', STORY.betrayal.art);
  if (isPlayerControlled(state, old) || isPlayerControlled(state, newHouse)) {
    state.pendingEvents.push({ art: STORY.betrayal.art, title: STORY.betrayal.title, text });
  }
}

// Used by the AI: the strongest neighbouring house that is not at peace with us.
export function biggestThreat(state, house) {
  let best = null, bp = 0;
  for (const id of Object.keys(state.houses)) {
    if (id === house || !state.houses[id].alive || atPeace(state, house, id)) continue;
    const p = houseTotals(state, id).power;
    if (p > bp) { bp = p; best = id; }
  }
  return best;
}
