// All-AI campaigns: N seeds, up to 60 years each. Asserts no exceptions, JSON round-trips, and
// determinism (same seed -> same final hash). Reports winners and game length.
//   node tests/aivai.mjs [N=12] [years=60]      STUB=1 forces the stub battle resolver
import { newGame, stateHash, ownedProvinces, aliveHouses } from '../js/realm/state.js';
import { endMonth } from '../js/realm/turn.js';
import { HOUSES } from '../js/data/houses.js';
import { getAutoResolve } from './_resolver.mjs';

const N = Number(process.argv[2] || 12);
const YEARS = Number(process.argv[3] || 60);
const { autoResolve, real } = await getAutoResolve();

async function campaign(seed) {
  const player = HOUSES[seed % HOUSES.length].id;
  let s = newGame(player, seed);
  s.autoPlayer = true;
  let battles = 0;
  for (let m = 0; m < YEARS * 12 && !s.winner; m++) {
    const sum = await endMonth(s, { autoResolve });
    battles += sum.battles.length;
    s.pendingEvents = [];
    if (m % 24 === 0) {
      const copy = JSON.parse(JSON.stringify(s));
      if (JSON.stringify(copy) !== JSON.stringify(s)) throw new Error('state does not round-trip');
      s = copy;                     // keep playing from the round-tripped copy
    }
    checkInvariants(s);
  }
  return { seed, winner: s.winner, years: s.turn / 12, battles, hash: stateHash(s),
    provinces: Object.fromEntries(aliveHouses(s).map(h => [h, ownedProvinces(s, h).length])) };
}

function checkInvariants(s) {
  for (const p of s.provinces) {
    if (p.vassals.length > 5) throw new Error(`province ${p.id} has ${p.vassals.length} vassals`);
    for (const id of p.vassals) {
      const v = s.vassals[id];
      if (v.location !== p.id || v.status !== 'active') throw new Error(`vassal ${id} misplaced`);
      if (v.house !== p.owner) throw new Error(`vassal ${id} of ${v.house} in ${p.owner}'s province ${p.id}`);
    }
    for (const k of ['food', 'gold']) if (!(p[k] >= 0) || !Number.isFinite(p[k])) throw new Error(`bad ${k} in ${p.id}`);
  }
  for (const v of Object.values(s.vassals)) {
    if (v.status === 'active' && v.location == null && !v.marching) throw new Error(`vassal ${v.id} lost`);
    if (!(v.soldiers >= 0)) throw new Error(`vassal ${v.id} soldiers ${v.soldiers}`);
  }
  if (s.marches.length) throw new Error('marches left after month end');
}

const t0 = Date.now();
const results = [];
let failed = false;
for (let seed = 1; seed <= N; seed++) {
  try { results.push(await campaign(seed)); }
  catch (e) { failed = true; console.log(`seed ${seed}: EXCEPTION ${e.stack}`); }
}
// Determinism on the first two seeds.
for (const r of results.slice(0, 2)) {
  const again = await campaign(r.seed);
  if (again.hash !== r.hash) { failed = true; console.log(`seed ${r.seed}: nondeterministic (${r.hash} vs ${again.hash})`); }
}
const wins = {};
for (const r of results) wins[r.winner || 'none'] = (wins[r.winner || 'none'] || 0) + 1;
const ended = results.filter(r => r.winner);
const avg = ended.reduce((a, r) => a + r.years, 0) / (ended.length || 1);
console.log(`resolver: ${real ? 'battle/auto.js' : 'stub'}; ${results.length} campaigns in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
for (const r of results) console.log(`  seed ${r.seed}: ${r.winner || 'no winner'} in ${r.years.toFixed(1)} y, ${r.battles} battles ${r.winner ? '' : JSON.stringify(r.provinces)}`);
console.log('wins:', JSON.stringify(wins), `avg length ${avg.toFixed(1)} years`);
if (failed) process.exit(1);
