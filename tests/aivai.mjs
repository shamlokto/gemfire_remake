// All-AI campaigns: N seeds, up to 60 years each. Asserts no exceptions, JSON round-trips, and
// determinism (same seed -> same final hash). Reports winners and game length.
//   node tests/aivai.mjs [N=12] [years=60] [scenario=eclipse|all]   STUB=1 forces the stub resolver
import { newGame, stateHash, ownedProvinces, aliveHouses } from '../js/realm/state.js';
import { endMonth } from '../js/realm/turn.js';
import { HOUSES } from '../js/data/houses.js';
import { getAutoResolve } from './_resolver.mjs';
import { MAX_SOLDIERS, MAX_VASSALS_PER_PROVINCE, MAX_UNITS_PER_PROVINCE } from '../js/data/units.js';

import { SCENARIOS } from '../js/data/scenarios.js';
const N = Number(process.argv[2] || 12);
const YEARS = Number(process.argv[3] || 60);
const SC_ARG = process.argv[4] || 'eclipse';
const SC_LIST = SC_ARG === 'all' ? SCENARIOS.map(x => x.id) : [SC_ARG];
const { autoResolve, real } = await getAutoResolve();

async function campaign(seed, scenario) {
  const player = HOUSES[seed % HOUSES.length].id;
  let s = newGame(player, seed, scenario);
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
  const techs = Object.values(s.houses).reduce((a, h) => a + h.tech.researched.length, 0);
  const recruited = Object.values(s.vassals).filter(v => v.house && (v.id.startsWith('w_'))).length;
  return { seed, scenario, winner: s.winner, years: s.turn / 12, battles, hash: stateHash(s), techs, recruited,
    provinces: Object.fromEntries(aliveHouses(s).map(h => [h, ownedProvinces(s, h).length])) };
}

function checkInvariants(s) {
  const seenUid = new Set();
  for (const p of s.provinces) {
    if (p.vassals.length > MAX_VASSALS_PER_PROVINCE) throw new Error(`province ${p.id} has ${p.vassals.length} vassals`);
    if (p.units.length > MAX_UNITS_PER_PROVINCE) throw new Error(`province ${p.id} has ${p.units.length} units`);
    if (p.owner && p.militia.length) throw new Error(`owned province ${p.id} has militia`);
    if (!p.owner && p.units.length) throw new Error(`free hold ${p.id} has units`);
    for (const id of p.vassals) {
      const v = s.vassals[id];
      if (v.location !== p.id || v.status !== 'active') throw new Error(`vassal ${id} misplaced`);
      if (v.house !== p.owner) throw new Error(`vassal ${id} of ${v.house} in ${p.owner}'s province ${p.id}`);
    }
    const leaders = new Set();
    for (const u of p.units) {
      if (seenUid.has(u.uid)) throw new Error(`duplicate unit ${u.uid}`);
      seenUid.add(u.uid);
      if (!(u.soldiers > 0) || u.soldiers > MAX_SOLDIERS) throw new Error(`unit ${u.uid} soldiers ${u.soldiers}`);
      if (u.leader) {
        if (!p.vassals.includes(u.leader)) throw new Error(`unit ${u.uid} in ${p.id} led by absent ${u.leader}`);
        if (leaders.has(u.leader)) throw new Error(`${u.leader} leads two units`);
        leaders.add(u.leader);
      }
    }
    for (const k of ['food', 'gold']) if (!(p[k] >= 0) || !Number.isFinite(p[k])) throw new Error(`bad ${k} in ${p.id}`);
  }
  for (const v of Object.values(s.vassals)) {
    if (v.status === 'active' && v.location == null && !v.marching) throw new Error(`vassal ${v.id} lost`);
  }
  if (s.marches.length) throw new Error('marches left after month end');
}

let failed = false;
for (const SC of SC_LIST) {
const t0 = Date.now();
const results = [];
for (let seed = 1; seed <= N; seed++) {
  try { results.push(await campaign(seed, SC)); }
  catch (e) { failed = true; console.log(`${SC} seed ${seed}: EXCEPTION ${e.stack}`); }
}
// Determinism on the first two seeds.
for (const r of results.slice(0, 2)) {
  const again = await campaign(r.seed, SC);
  if (again.hash !== r.hash) { failed = true; console.log(`${SC} seed ${r.seed}: nondeterministic (${r.hash} vs ${again.hash})`); }
}
const wins = {};
for (const r of results) wins[r.winner || 'none'] = (wins[r.winner || 'none'] || 0) + 1;
const ended = results.filter(r => r.winner);
const avg = ended.reduce((a, r) => a + r.years, 0) / (ended.length || 1);
console.log(`== scenario ${SC}: resolver ${real ? 'battle/auto.js' : 'stub'}; ${results.length} campaigns in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
for (const r of results) console.log(`  seed ${r.seed}: ${r.winner || 'no winner'} in ${r.years.toFixed(1)} y, ${r.battles} battles, ${r.techs} techs, ${r.recruited} wanderers recruited ${r.winner ? '' : JSON.stringify(r.provinces)}`);
console.log('wins:', JSON.stringify(wins), `avg length ${avg.toFixed(1)} years`);
}
if (failed) process.exit(1);
