// Auto-resolve balance and speed: node tests/battle-auto.mjs (exit 1 on failure).
import { autoResolve } from '../js/battle/auto.js';

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error('FAIL:', m); } };
const U = (id, type, soldiers, kind = 'vassal') => ({ id, kind, type, soldiers, training: kind === 'militia' ? 20 : 50, might: kind === 'militia' ? 30 : 55, wits: 50 });
const army = (p, types, n) => types.map((t, i) => U(p + i, t, n));
const MIX = ['footmen', 'archers', 'horse'];
const TERRAINS = ['plains', 'forest', 'hills', 'mountain', 'marsh', 'coast'];

function rate(mk, N = 120) {
  let a = 0, ms = 0;
  for (let s = 1; s <= N; s++) {
    const inp = mk(s);
    const t0 = performance.now();
    const r = autoResolve(inp, s);
    ms += performance.now() - t0;
    if (r.winner === 'attacker') a++;
  }
  return { win: a / N, ms: ms / N };
}
const siege = (a, d, extra = {}) => s => ({ terrain: TERRAINS[s % 6], siege: true, season: s % 4,
  attacker: { house: 'aldmere', units: a, spirit: null }, defender: { house: 'vey', units: d, spirit: null }, ...extra });

const results = {
  equal: rate(siege(army('a', MIX, 200), army('d', MIX, 200))),
  double: rate(siege(army('a', [...MIX, ...MIX], 200), army('d', MIX, 200))),
  half: rate(siege(army('a', ['footmen'], 150), army('d', MIX, 200))),
  militiaVsArmy: rate(s => ({ terrain: TERRAINS[s % 6], siege: false, attacker: { units: army('a', ['footmen', 'archers'], 180) },
    defender: { house: null, units: [U('m', 'militia', 120, 'militia')] } })),
  bigMixed: rate(siege(army('a', ['knights', 'archers', 'siege', 'pikes', 'footmen'], 300).concat([{ ...U('c', 'golem', 60, 'company') }]),
    army('d', ['pikes', 'archers', 'archers', 'footmen', 'horse'], 300), {})),
};
for (const [k, v] of Object.entries(results)) console.log(k.padEnd(14), 'attacker wins', (v.win * 100).toFixed(0) + '%', 'avg', v.ms.toFixed(2), 'ms');

ok(results.equal.win > 0.2 && results.equal.win < 0.8, 'equal forces are contested');
ok(results.double.win > 0.85, 'double force usually wins');
ok(results.half.win < 0.1, 'weak attacker loses');
ok(results.militiaVsArmy.win > 0.95, 'army beats militia');
const avg = Object.values(results).reduce((s, v) => s + v.ms, 0) / Object.keys(results).length;
ok(avg < 5, 'auto-resolve under 5 ms on average (' + avg.toFixed(2) + ')');
console.log(`battle-auto: ${fails ? fails + ' failed' : 'all passed'}`);
process.exit(fails ? 1 : 0);
