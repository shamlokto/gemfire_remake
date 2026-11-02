// The Dawnwyrm (js/data/units.js DAWNWYRM): a holy dragon that sometimes comes to help the player
// when the people of the province love their lord. Pure (no DOM); mutates state.
//
// When the player fights a battle (attacking from a province, or defending one), the province's
// loyalty decides: at DRAGON_LOYALTY or above, the chance is (loyalty - DRAGON_LOYALTY + 5) * 1%
// (loyalty 80: 5%, 90: 15%, 100: 25%), at most once every DRAGON_COOLDOWN months. The dragon joins
// as an extra unit (it does not take the 5th slot) and leaves after the battle, win or lose.

import { DAWNWYRM } from '../data/units.js';
import { addLog, isPlayerControlled, provinceName, withRng } from './state.js';

export const DRAGON_LOYALTY = 80;
export const DRAGON_COOLDOWN = 12;
export const DRAGON_ID = 'dawnwyrm';

export function dragonChance(loyalty) {
  return loyalty < DRAGON_LOYALTY ? 0 : Math.min(0.25, (loyalty - DRAGON_LOYALTY + 5) / 100);
}

// Called with each battle's input before it is fought. Adds the dragon to the player's side if it comes.
export function maybeDawnwyrm(state, march, input) {
  const player = state.player;
  let side = null, pid = null;
  if (input.attacker.house === player && isPlayerControlled(state, player)) { side = 'attacker'; pid = march.from; }
  else if (input.defender.house === player && isPlayerControlled(state, player)) { side = 'defender'; pid = march.to; }
  if (!side) return false;
  if (state.dragonTurn != null && state.turn - state.dragonTurn < DRAGON_COOLDOWN) return false;
  const loyalty = state.provinces[pid]?.loyalty ?? 0;
  const p = dragonChance(loyalty);
  if (!p || !withRng(state, rng => rng.chance(p))) return false;
  state.dragonTurn = state.turn;
  input[side].units.push({ id: DRAGON_ID, kind: 'dragon', type: DRAGON_ID, soldiers: DAWNWYRM.soldiers, training: 100, leader: null, might: 60, wits: 60 });
  input[side].dragon = true;
  addLog(state, `The Dawnwyrm descends over ${provinceName(march.to)}: the people of ${provinceName(pid)} love their lord.`, 'story');
  return true;
}

// The dragon is not one of the house's units: drop it from a result before it is applied.
export function stripDragon(result) {
  for (const s of ['attacker', 'defender']) if (result?.[s]?.units) result[s].units = result[s].units.filter(u => u.id !== DRAGON_ID);
  return result;
}
