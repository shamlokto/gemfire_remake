// Stand-in for js/battle/auto.js: a strength-ratio resolver matching the v2 BattleResult contract
// (UnitIn with kind troop/company/spirit/militia and the leader's might).
import { unitPower } from '../js/realm/state.js';
import { makeRng } from '../js/rng.js';

export function autoResolve(input, seed = 1) {
  const rng = typeof seed === 'number' ? makeRng(seed) : seed;
  const pow = side => side.units.reduce((a, u) => a + unitPower(u.type, u.soldiers, u.training, u.might || 0) * (u.kind === 'troop' && !u.leader ? 0.85 : 1), 0);
  const a = pow(input.attacker) * (0.85 + rng.next() * 0.3);
  const d = pow(input.defender) * (input.siege ? 1.25 : 1) * (0.85 + rng.next() * 0.3);
  const winner = a > d ? 'attacker' : 'defender';
  const lossA = Math.min(0.9, 0.35 * d / Math.max(a, 1));
  const lossD = Math.min(0.9, 0.35 * a / Math.max(d, 1));
  const side = (s, loss, lost) => ({
    units: s.units.map(u => {
      const left = Math.round(u.soldiers * (1 - loss));
      return { id: u.id, soldiers: left, fate: left <= 0 ? 'dead' : lost ? 'routed' : 'ok' };
    }),
    spiritUsed: s.units.some(u => u.kind === 'spirit'),
  });
  return { winner, rounds: 10, attacker: side(input.attacker, lossA, winner !== 'attacker'),
           defender: side(input.defender, lossD, winner !== 'defender') };
}
