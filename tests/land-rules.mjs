// Province land grid: node tests/land-rules.mjs (exit 1 on failure).
import { generateLand, generateAllLand } from '../js/land/landgen.js';
import {
  provinceYield, potential, listBuildable, build, demolish, monthTick, damage, loot, suggestBuild,
  legacyStats, canBuild, startProject, repair, cloneLand, T, B, R, W, H, idx, neighbours8,
} from '../js/land/land.js';
import { makeRng } from '../js/rng.js';
import { PROVINCES } from '../js/data/world.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const byName = n => PROVINCES.find(p => p.name === n).id;

// --- determinism and shape
{
  const a = generateLand(8, 42), b = generateLand(8, 42), c = generateLand(8, 43);
  ok(JSON.stringify(a) === JSON.stringify(b), 'same seed -> same land');
  ok(JSON.stringify(a) !== JSON.stringify(c), 'different seed -> different land');
  ok(a.t.length === W * H && a.b.filter(x => x === B.KEEP).length === 1, 'grid size and one keep');
  ok(JSON.stringify(JSON.parse(JSON.stringify(a))) === JSON.stringify(a), 'JSON round trip');
  ok(a.t.every(t => Number.isInteger(t) && t >= 0 && t <= 8), 'terrain codes are small ints');
}

// --- variety: breadbaskets vs barren land, across seeds
{
  const pots = [];
  for (const seed of [1, 2, 3]) for (const L of generateAllLand(seed)) pots.push({ pid: L.pid, food: potential(L).food, gold: potential(L).gold });
  const avg = pid => pots.filter(p => p.pid === pid).reduce((s, p) => s + p.food, 0) / 3;
  const table = PROVINCES.map(p => ({ name: p.name, food: Math.round(avg(p.id)) })).sort((x, y) => y.food - x.food);
  console.log('max potential food (avg of 3 seeds):');
  console.log(table.map(r => `  ${r.name.padEnd(13)} ${String(r.food).padStart(5)}`).join('\n'));
  const top = table[0].food, bottom = table[table.length - 1].food;
  ok(top >= 4 * bottom, `strong spread between breadbasket and barren land (${top} vs ${bottom})`);
  ok(avg(byName('Amberfield')) > 800 && avg(byName('Kingsrest')) > 800, 'plains breadbaskets have high potential');
  ok(avg(byName('Emberrock')) < 300 && avg(byName('Frosthelm')) < 300, 'barren isles have low potential');
  const goldEmber = pots.filter(p => p.pid === byName('Emberrock')).reduce((s, p) => s + p.gold, 0) / 3;
  const goldAmber = pots.filter(p => p.pid === byName('Amberfield')).reduce((s, p) => s + p.gold, 0) / 3;
  ok(goldEmber > goldAmber, 'barren mountain land makes up for it in mineral gold');
}

// --- starting development matches the old abstract stats roughly
{
  const L = generateLand(byName('Aldford'), 5, { start: { fields: 30, market: 25 } });
  const y = provinceYield(L), s = legacyStats(y);
  ok(Math.abs(s.fields - 30) <= 6, `Aldford starts near fields 30 (got ${s.fields})`);
  ok(y.gold >= 8 && y.gold <= 30, `Aldford starting gold sensible (${y.gold})`);
  ok(y.labour >= 0.95, 'starting land is staffed');
}

// --- building, adjacency, construction time
{
  const L = generateLand(byName('Kingsrest'), 3, { start: false });
  // find a fertile tile next to the river with free neighbours
  let farmAt = -1;
  for (let i = 0; i < L.t.length; i++) if (L.t[i] === T.FERTILE && !L.b[i] && neighbours8(L, i).some(j => L.t[j] === T.RIVER)) { farmAt = i; break; }
  ok(farmAt >= 0, 'Kingsrest has fertile river banks');
  const x = farmAt % L.w, y = (farmAt / L.w) | 0;
  const opts = listBuildable(L, x, y, {});
  const farmOpt = opts.find(o => o.kind === 'farm');
  ok(farmOpt && farmOpt.ok && farmOpt.preview.food > 0, 'farm offered with a food preview');
  ok(opts.find(o => o.kind === 'mine' && !o.ok), 'mine refused on soil');
  const before = provinceYield(L).food;
  const r = build(L, x, y, 'farm', { gold: 100 });
  ok(r.ok && r.cost > 0, 'farm build starts');
  ok(provinceYield(L).food === before, 'no output while under construction');
  monthTick(L, makeRng(1));
  const farmFood = provinceYield(L).food;
  ok(farmFood > before, 'farm produces after construction');
  ok(!build(L, x, y, 'farm', {}).ok, 'cannot build twice on a tile');
  ok(!build(L, (x + 1) % L.w, y, 'market', { gold: 5 }).ok || canBuild(L, idx(L, (x + 1) % L.w, y), 'market'), 'gold is checked');
  // a mill next to the farm boosts it
  const millAt = neighbours8(L, farmAt).find(j => !L.b[j] && [T.FERTILE, T.PLAIN, T.POOR].includes(L.t[j]));
  if (millAt != null) {
    build(L, millAt % L.w, (millAt / L.w) | 0, 'mill', {});
    monthTick(L, makeRng(1)); monthTick(L, makeRng(1));
    ok(provinceYield(L).food > farmFood, 'a mill boosts the neighbouring farm');
  }
  // labour: lots of farms without houses lose output
  const L2 = generateLand(byName('Amberfield'), 3, { start: false });
  let n = 0;
  for (let i = 0; i < L2.t.length && n < 20; i++) if (!L2.b[i] && L2.t[i] === T.FERTILE) { L2.b[i] = B.FARM; n++; }
  const y2 = provinceYield(L2);
  ok(y2.labour < 1, 'farms without enough people are short-handed');
  const k = L2.b.indexOf(B.KEEP);
  let h = 0;
  for (let i = 0; i < L2.t.length && h < 10; i++) if (!L2.b[i] && [T.PLAIN, T.POOR, T.HILLS, T.FERTILE].includes(L2.t[i])) { L2.b[i] = B.HOUSES; h++; }
  ok(provinceYield(L2).food > y2.food, 'houses supply the hands farms need');
  ok(k >= 0, 'keep present');
}

// --- markets scale with neighbouring houses
{
  const L = generateLand(byName('Aldford'), 9, { start: false });
  const k = L.b.indexOf(B.KEEP);
  const ring = neighbours8(L, k).filter(j => [T.FERTILE, T.PLAIN, T.POOR, T.HILLS].includes(L.t[j]));
  if (ring.length >= 4) {
    const m = ring[0];
    L.b[m] = B.MARKET;
    const g0 = provinceYield(L).gold;
    for (const j of neighbours8(L, m).filter(j => !L.b[j] && [T.FERTILE, T.PLAIN, T.POOR, T.HILLS].includes(L.t[j])).slice(0, 3)) L.b[j] = B.HOUSES;
    ok(provinceYield(L).gold > g0 + 4, 'market earns more surrounded by houses');
  } else ok(true, 'skip market test (no room)');
}

// --- projects
{
  const L = generateLand(byName('Thornwood'), 2, { start: false });
  const f = L.t.indexOf(T.FOREST);
  ok(f >= 0 && listBuildable(L, f % L.w, (f / L.w) | 0).some(o => o.kind === 'clear' && o.ok), 'clear forest offered');
  const r = startProject(L, f % L.w, (f / L.w) | 0, 'clear', {});
  ok(r.ok, 'clearing starts');
  const rng = makeRng(3);
  monthTick(L, rng); const t2 = monthTick(L, rng);
  ok([T.PLAIN, T.POOR].includes(L.t[f]) && t2.gold === 20, 'forest becomes soil after 2 months, with timber gold');
}

// --- war damage, repair, loot
{
  const L = generateLand(byName('Goldvale'), 4);
  const built = L.b.filter(b => b && b !== B.KEEP).length;
  const d0 = damage(cloneLand(L), 0, makeRng(1));
  ok(d0.damaged === 0 && d0.razed === 0, 'no damage at intensity 0');
  const L2 = cloneLand(L);
  const d1 = damage(L2, 1, makeRng(1));
  ok(d1.damaged > built * 0.2, `heavy fighting damages many buildings (${d1.damaged}/${built})`);
  ok(provinceYield(L2).food < provinceYield(L).food, 'damaged farms lose output');
  const di = L2.d.indexOf(1);
  ok(repair(L2, di % L2.w, (di / L2.w) | 0, { gold: 999 }).ok, 'damaged building can be repaired');
  const d2 = damage(L2, 1, makeRng(2));
  ok(d2.razed > 0, 'a second sack razes damaged buildings');
  const lt = loot(cloneLand(L), makeRng(1));
  ok(lt.gold > 0 && lt.loyalty < 0, 'looting pays now and costs loyalty');
  ok(L2.b.includes(B.KEEP), 'the keep survives');
  ok(demolish(L2, L2.b.indexOf(B.KEEP) % L2.w, (L2.b.indexOf(B.KEEP) / L2.w) | 0).ok === false, 'keep cannot be demolished');
}

// --- AI suggestions grow the province
{
  for (const name of ['Amberfield', 'Frosthelm', 'Pearlcoast']) {
    const L = generateLand(byName(name), 6);
    const y0 = provinceYield(L);
    const rng = makeRng(5);
    let gold = 0, spent = 0;
    for (let m = 0; m < 120; m++) {
      gold += 25;
      const s = suggestBuild(L, { gold }, m % 3 === 0 ? 'gold' : 'food');
      if (s) { const r = build(L, s.x, s.y, s.kind, { gold }); if (r.ok) { gold -= r.cost; spent += r.cost; } }
      monthTick(L, rng);
    }
    const y1 = provinceYield(L);
    console.log(`  AI 10 years in ${name.padEnd(11)}: food ${y0.food} -> ${y1.food}, gold ${y0.gold} -> ${y1.gold}, pop ${y0.pop} -> ${y1.pop} (spent ${spent})`);
    ok(y1.food + y1.gold * 10 > y0.food + y0.gold * 10, `AI development improves ${name}`);
    ok(y1.labour >= 0.85, `AI keeps ${name} staffed (${y1.labour})`);
  }
  const L = generateLand(byName('Amberfield'), 6);
  const s = suggestBuild(L, { gold: 0 }, 'food');
  ok(s === null, 'no suggestion without gold');
}

// --- speed: yield and suggestion are cheap enough for the AI every month
{
  const L = generateLand(byName('Lanterncross'), 1);
  const t0 = performance.now();
  for (let i = 0; i < 200; i++) provinceYield(L);
  const t1 = performance.now();
  for (let i = 0; i < 5; i++) suggestBuild(L, { gold: 200 }, 'balanced');
  const t2 = performance.now();
  console.log(`  provinceYield ${((t1 - t0) / 200).toFixed(3)} ms, suggestBuild ${((t2 - t1) / 5).toFixed(1)} ms`);
  ok((t2 - t1) / 5 < 60, 'suggestBuild under 60 ms');
}

console.log(`land-rules: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
