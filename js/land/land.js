// Province land: a small SimCity-like grid per province. Pure module (no DOM), JSON-serialisable
// state, used by the realm rules and drawn by js/ui/landview.js. See docs/LAND.md.
//
// A land is { v, pid, w, h, t, r, b, c, d, p }:
//   t[i] terrain code (TERRAIN), r[i] resource code (RESOURCE), b[i] building code (BUILDING),
//   c[i] months of construction left (0 = working), d[i] damage (0 ok, 1 damaged: no output),
//   p    active projects [{ i, kind: 'clear'|'drain'|'excavate', left }].
// All arrays are plain arrays of small ints, indexed i = y * w + x.

export const W = 12, H = 9;

export const T = { WATER: 0, RIVER: 1, FERTILE: 2, PLAIN: 3, POOR: 4, FOREST: 5, HILLS: 6, ROCK: 7, MARSH: 8 };
export const TERRAIN = [
  { key: 'water',   name: 'Sea',           soil: 0 },
  { key: 'river',   name: 'River',         soil: 0 },
  { key: 'fertile', name: 'Fertile soil',  soil: 1.8 },
  { key: 'plain',   name: 'Plain soil',    soil: 1.1 },
  { key: 'poor',    name: 'Poor soil',     soil: 0.55 },
  { key: 'forest',  name: 'Forest',        soil: 0 },
  { key: 'hills',   name: 'Hills',         soil: 0 },
  { key: 'rock',    name: 'Rock',          soil: 0 },
  { key: 'marsh',   name: 'Marsh',         soil: 0 },
];

export const R = { NONE: 0, ORE: 1, SALT: 2, PEARLS: 3, VINES: 4, RUINS: 5, GROVE: 6, SPRINGS: 7 };
export const RESOURCE = [
  { key: 'none',    name: '' },
  { key: 'ore',     name: 'Rich ore',      text: 'A mine here yields +5 gold and cheaper siege engines.' },
  { key: 'salt',    name: 'Salt flats',    text: 'A mine here (salt pans) yields +4 gold.' },
  { key: 'pearls',  name: 'Pearl beds',    text: 'A fishery here yields +5 gold.' },
  { key: 'vines',   name: 'Vineyard slope', text: 'An orchard here becomes a vineyard: +4 gold.' },
  { key: 'ruins',   name: 'Ancient ruins', text: 'Excavate once for treasure, or raise a temple: +2 loyalty.' },
  { key: 'grove',   name: 'Sacred grove',  text: 'A temple here gives +5 loyalty more.' },
  { key: 'springs', name: 'Hot springs',   text: 'Houses or a temple here: +2 loyalty, +30 people.' },
];

export const B = {
  NONE: 0, FARM: 1, ORCHARD: 2, PASTURE: 3, LUMBER: 4, MINE: 5, FISHERY: 6, MARKET: 7, HOUSES: 8,
  GRANARY: 9, MILL: 10, TEMPLE: 11, BARRACKS: 12, WALLS: 13, KEEP: 14,
};
const LAND_SOIL = [T.FERTILE, T.PLAIN, T.POOR];
const DRY = [T.FERTILE, T.PLAIN, T.POOR, T.HILLS];
// on: terrains allowed; cost in gold; time in months; labour: people needed to run it.
export const BUILDING = [
  { key: 'none', name: 'Empty' },
  { key: 'farm',     name: 'Farm',      on: LAND_SOIL, cost: 20, time: 1, labour: 25, text: 'Food by soil: fertile ×2, poor ×½. Irrigated next to a river or lake (+25%).' },
  { key: 'orchard',  name: 'Orchard',   on: [T.HILLS], res: [R.VINES], cost: 30, time: 2, labour: 15, text: 'Food and a little gold on hill slopes; a vineyard on a vineyard slope.' },
  { key: 'pasture',  name: 'Pasture',   on: [T.PLAIN, T.POOR, T.HILLS], cost: 20, time: 1, labour: 10, text: 'Horses: horse and knight musters are cheaper (10% each, up to 30%).' },
  { key: 'lumber',   name: 'Lumber camp', on: [T.FOREST], cost: 25, time: 1, labour: 15, text: 'Gold, and every building costs 5% less (up to 20%).' },
  { key: 'mine',     name: 'Mine',      on: [T.HILLS, T.ROCK], res: [R.ORE, R.SALT], cost: 50, time: 2, labour: 25, text: 'Gold from the hills; more from ore and salt.' },
  { key: 'fishery',  name: 'Fishery',   on: [T.WATER, T.RIVER], cost: 35, time: 2, labour: 15, text: 'Food from the water; gold on pearl beds. A sea fishery is a harbour.' },
  { key: 'market',   name: 'Market',    on: DRY, cost: 60, time: 2, labour: 10, text: 'Gold; +1 for each neighbouring houses (up to 5). Beyond three markets, trade is saturated: half yield.' },
  { key: 'houses',   name: 'Houses',    on: DRY, cost: 30, time: 1, labour: 0, text: 'People: work for farms and mines, taxes, and soldiers to muster.' },
  { key: 'granary',  name: 'Granary',   on: DRY, cost: 40, time: 2, labour: 5, text: 'Stores 200 food; halves winter spoilage (two granaries).' },
  { key: 'mill',     name: 'Mill',      on: LAND_SOIL, cost: 45, time: 2, labour: 10, text: 'Neighbouring farms +20%.' },
  { key: 'temple',   name: 'Temple',    on: [T.FERTILE, T.PLAIN, T.POOR, T.HILLS, T.FOREST], cost: 70, time: 3, labour: 5, text: 'Loyalty +4 (more on a sacred grove, springs or ruins).' },
  { key: 'barracks', name: 'Barracks',  on: DRY, cost: 60, time: 2, labour: 10, text: 'Training +5 per month for units here (two at most).' },
  { key: 'walls',    name: 'Walls',     on: [T.FERTILE, T.PLAIN, T.POOR, T.HILLS, T.ROCK], cost: 40, time: 2, labour: 0, text: 'Defence in battle +5% each, near the keep (up to +40%).' },
  { key: 'keep',     name: 'Keep',      on: [], cost: 0, time: 0, labour: 0, text: 'The lord\'s seat. Cannot be moved.' },
];
export const BUILD_KEYS = BUILDING.map(b => b.key);
export const PROJECT = {
  clear:    { name: 'Clear forest', on: [T.FOREST], cost: 30, time: 2, text: 'Turns forest into plain soil (sometimes poor). Yields 20 gold of timber.' },
  drain:    { name: 'Drain marsh',  on: [T.MARSH], cost: 60, time: 3, text: 'Turns marsh into soil: fertile next to water, plain otherwise.' },
  excavate: { name: 'Excavate ruins', res: R.RUINS, cost: 40, time: 2, text: 'Recover the ruins\' treasure once (80-200 gold).' },
};

// Yield numbers. Tuned so a starting province gives roughly fields 30 / market 25 in the old
// abstract terms (300 food a harvest, 15 gold a month) and a developed breadbasket about triple.
export const Y = {
  farm: 9, irrigation: 0.25, millBoost: 0.2, orchardFood: 9, orchardGold: 1.5, vineGold: 4,
  pastureFood: 4, lumberGold: 1.5, mineHills: 2, mineRock: 3, oreGold: 5, saltGold: 4,
  fishSea: 12, fishRiver: 7, pearlGold: 5, marketGold: 2, marketPerHouse: 1, marketMaxAdj: 5, marketFull: 3,
  housesPop: 50, springsPop: 30, keepPop: 40, keepGold: 3, taxPerPop: 0.012,
  granaryStore: 200, templeLoyalty: 4, groveLoyalty: 5, springsLoyalty: 2, ruinsLoyalty: 2,
  barracksTraining: 5, wallDefense: 0.05, keepDefense: 0.1, maxDefense: 0.5,
  foodPerPop: 0.25,            // food eaten per person per harvest (reported, applied by the realm)
  musterPerPop: 1.2, musterBase: 100,
};

export const idx = (land, x, y) => y * land.w + x;
export const inside = (land, x, y) => x >= 0 && y >= 0 && x < land.w && y < land.h;
export function neighbours8(land, i) {
  const x = i % land.w, y = (i / land.w) | 0, out = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if ((dx || dy) && inside(land, x + dx, y + dy)) out.push(idx(land, x + dx, y + dy));
  }
  return out;
}
export function neighbours4(land, i) {
  const x = i % land.w, y = (i / land.w) | 0, out = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (inside(land, x + dx, y + dy)) out.push(idx(land, x + dx, y + dy));
  return out;
}
export const keepIndex = land => land.b.indexOf(B.KEEP);
const cheb = (land, a, b) => Math.max(Math.abs(a % land.w - b % land.w), Math.abs(((a / land.w) | 0) - ((b / land.w) | 0)));
const working = (land, i) => land.b[i] && !land.c[i] && !land.d[i];

export function cloneLand(land) {
  return { ...land, t: land.t.slice(), r: land.r.slice(), b: land.b.slice(), c: land.c.slice(), d: land.d.slice(), p: land.p.map(p => ({ ...p })) };
}

// ---------------------------------------------------------------- yields

// ctx (all optional): { mods: { food, farm, gold, loyalty, pop, defense } multipliers/adders from
// techs; month }.
export function provinceYield(land, ctx = {}) {
  const m = ctx.mods || {};
  const n = land.t.length;
  let pop = 0, gold = 0, loyalty = 0, defense = 0, store = 0, granaries = 0, barracks = 0, labourNeed = 0;
  let foodFarm = 0, foodOther = 0, horses = 0, lumber = 0;
  const marketGold = [];
  const flags = { horses: 0, ore: false, timber: false, harbour: false, salt: false, pearls: false, vineyards: false, grove: false, springs: false, ruins: false, river: false };
  for (let i = 0; i < n; i++) {
    const t = land.t[i], r = land.r[i];
    if (t === T.RIVER) flags.river = true;
    if (r === R.RUINS) flags.ruins = true;
    if (!working(land, i)) continue;
    const b = land.b[i];
    labourNeed += BUILDING[b].labour || 0;
    switch (b) {
      case B.FARM: {
        let f = Y.farm * TERRAIN[t].soil;
        if (neighbours4(land, i).some(j => land.t[j] === T.RIVER || (land.t[j] === T.WATER && land.lake))) f *= 1 + Y.irrigation;
        if (neighbours8(land, i).some(j => land.b[j] === B.MILL && working(land, j))) f *= 1 + Y.millBoost;
        foodFarm += f; break;
      }
      case B.ORCHARD:
        foodOther += Y.orchardFood; gold += Y.orchardGold;
        if (r === R.VINES) { gold += Y.vineGold; flags.vineyards = true; }
        break;
      case B.PASTURE: foodOther += Y.pastureFood; horses++; break;
      case B.LUMBER: gold += Y.lumberGold; lumber++; flags.timber = true; break;
      case B.MINE:
        gold += t === T.ROCK ? Y.mineRock : Y.mineHills;
        if (r === R.ORE) { gold += Y.oreGold; flags.ore = true; }
        if (r === R.SALT) { gold += Y.saltGold; flags.salt = true; }
        break;
      case B.FISHERY:
        foodOther += t === T.WATER ? Y.fishSea : Y.fishRiver;
        if (t === T.WATER && !land.lake) flags.harbour = true;
        if (r === R.PEARLS) { gold += Y.pearlGold; flags.pearls = true; }
        break;
      case B.MARKET: {
        const adj = neighbours8(land, i).filter(j => land.b[j] === B.HOUSES && working(land, j)).length;
        marketGold.push(Y.marketGold + Y.marketPerHouse * Math.min(adj, Y.marketMaxAdj)); break;
      }
      case B.HOUSES:
        pop += Y.housesPop;
        if (r === R.SPRINGS) { pop += Y.springsPop; loyalty += Y.springsLoyalty; flags.springs = true; }
        break;
      case B.GRANARY: store += Y.granaryStore; granaries++; break;
      case B.MILL: break;
      case B.TEMPLE:
        loyalty += Y.templeLoyalty;
        if (r === R.GROVE) { loyalty += Y.groveLoyalty; flags.grove = true; }
        if (r === R.SPRINGS) { loyalty += Y.springsLoyalty; flags.springs = true; }
        if (r === R.RUINS) loyalty += Y.ruinsLoyalty;
        break;
      case B.BARRACKS: barracks++; break;
      case B.WALLS: defense += Y.wallDefense; break;
      case B.KEEP: pop += Y.keepPop; gold += Y.keepGold; defense += Y.keepDefense; break;
    }
  }
  marketGold.sort((a, b) => b - a).forEach((g, k) => { gold += k < Y.marketFull ? g : g / 2; });
  pop = Math.round(pop * (m.pop || 1));
  // Labour: farms, mines etc. need people. Short-handed land produces proportionally less.
  const labour = labourNeed ? Math.min(1, pop / labourNeed) : 1;
  const food = Math.round((foodFarm * (m.farm || 1) + foodOther) * labour * (m.food || 1));
  gold = (gold * labour + pop * Y.taxPerPop) * (m.gold || 1);
  const foodUpkeep = Math.round(pop * Y.foodPerPop);
  // Overcrowding: more mouths than the land feeds costs loyalty.
  if (foodUpkeep > food) loyalty -= Math.min(10, Math.round((foodUpkeep - food) / 30));
  loyalty += m.loyalty || 0;
  flags.horses = horses;
  return {
    food,                                   // per harvest (gross)
    foodUpkeep,                             // eaten by the people per harvest
    gold: Math.round(gold * 10) / 10,       // per month
    pop,
    labour: Math.round(labour * 100) / 100,
    musterCap: Math.round(Y.musterBase + pop * Y.musterPerPop),
    loyaltyMod: loyalty,
    defense: Math.min(Y.maxDefense, Math.round((defense + (m.defense || 0)) * 100) / 100),
    storage: store,
    winterSpoilage: Math.max(0.05, 0.2 - 0.075 * Math.min(2, granaries)),
    trainingBonus: Y.barracksTraining * Math.min(2, barracks),
    horseDiscount: Math.min(0.3, 0.1 * horses),
    buildDiscount: Math.min(0.2, 0.05 * lumber),
    siegeDiscount: flags.ore ? 0.25 : 0,
    flags,
  };
}

// Old abstract numbers, for the existing economy: harvest = fields * 10, gold = market * 0.6.
export function legacyStats(y) {
  return { fields: Math.round(y.food / 10), market: Math.round(y.gold / 0.6) };
}

// ---------------------------------------------------------------- building

function wallOk(land, i) {
  const k = keepIndex(land);
  return k >= 0 && cheb(land, i, k) <= 2;
}
function fisheryOk(land, i) {
  return neighbours4(land, i).some(j => land.t[j] !== T.WATER && land.t[j] !== T.RIVER);
}

// Why a building can't go on tile i, or null if it can.
export function canBuild(land, i, kind) {
  const def = BUILDING[BUILD_KEYS.indexOf(kind)];
  if (!def || kind === 'none' || kind === 'keep') return 'Unknown building';
  if (land.b[i]) return 'The tile is already built on';
  if (land.p.some(p => p.i === i)) return 'A project is under way here';
  const t = land.t[i], r = land.r[i];
  const terrainOk = def.on.includes(t) || (def.res && def.res.includes(r) && t !== T.WATER);
  if (!terrainOk) return `Needs ${def.on.map(x => TERRAIN[x].name.toLowerCase()).join(', ')}`;
  if (kind === 'fishery' && !fisheryOk(land, i)) return 'Must touch the shore';
  if (kind === 'walls' && !wallOk(land, i)) return 'Walls must be within two tiles of the keep';
  if (kind === 'barracks' && land.b.filter(b => b === B.BARRACKS).length >= 2) return 'Two barracks at most';
  return null;
}

export function buildCost(land, kind, ctx = {}) {
  const def = BUILDING[BUILD_KEYS.indexOf(kind)];
  const y = ctx.yieldCache || provinceYield(land, ctx);
  return Math.round(def.cost * (1 - y.buildDiscount) * ((ctx.mods && ctx.mods.cost) || 1));
}

// Options for tile (x, y): buildings and projects, with cost, time, why-not and a preview of the
// change in province yield if built (food, gold, pop, loyalty, defense).
export function listBuildable(land, x, y, ctx = {}) {
  const i = idx(land, x, y);
  const base = provinceYield(land, ctx);
  const out = [];
  for (const def of BUILDING) {
    if (def.key === 'none' || def.key === 'keep') continue;
    const why = canBuild(land, i, def.key);
    const opt = { kind: def.key, name: def.name, cost: buildCost(land, def.key, { ...ctx, yieldCache: base }), time: def.time, text: def.text, ok: !why, why };
    if (!why) opt.preview = previewDelta(land, i, def.key, base, ctx);
    out.push(opt);
  }
  for (const [k, pr] of Object.entries(PROJECT)) {
    const ok = pr.on ? pr.on.includes(land.t[i]) : land.r[i] === pr.res;
    if (!ok) continue;
    const why = land.b[i] && k !== 'excavate' ? 'Clear the building first' : land.p.some(p => p.i === i) ? 'Already under way' : null;
    out.push({ kind: k, project: true, name: pr.name, cost: pr.cost, time: pr.time, text: pr.text, ok: !why, why });
  }
  return out;
}

function previewDelta(land, i, kind, base, ctx) {
  const L = cloneLand(land);
  L.b[i] = BUILD_KEYS.indexOf(kind); L.c[i] = 0; L.d[i] = 0;
  const y = provinceYield(L, ctx);
  return { food: y.food - base.food, gold: Math.round((y.gold - base.gold) * 10) / 10, pop: y.pop - base.pop,
    loyalty: y.loyaltyMod - base.loyaltyMod, defense: Math.round((y.defense - base.defense) * 100) / 100, labour: y.labour };
}

// Start construction. Returns { ok, cost, msg }. The caller pays the gold (ctx.gold is checked if given).
export function build(land, x, y, kind, ctx = {}) {
  const i = idx(land, x, y);
  if (PROJECT[kind]) return startProject(land, x, y, kind, ctx);
  if (kind === 'repair') return repair(land, x, y, ctx);
  const why = canBuild(land, i, kind);
  if (why) return { ok: false, cost: 0, msg: why };
  const cost = buildCost(land, kind, ctx);
  if (ctx.gold != null && ctx.gold < cost) return { ok: false, cost, msg: `Needs ${cost} gold` };
  const def = BUILDING[BUILD_KEYS.indexOf(kind)];
  land.b[i] = BUILD_KEYS.indexOf(kind); land.c[i] = def.time; land.d[i] = 0;
  return { ok: true, cost, msg: `${def.name} under construction (${def.time} month${def.time > 1 ? 's' : ''}).` };
}

export function repair(land, x, y, ctx = {}) {
  const i = idx(land, x, y);
  if (!land.b[i] || !land.d[i]) return { ok: false, cost: 0, msg: 'Nothing to repair' };
  const def = BUILDING[land.b[i]];
  const cost = Math.round(def.cost * 0.5);
  if (ctx.gold != null && ctx.gold < cost) return { ok: false, cost, msg: `Needs ${cost} gold` };
  land.d[i] = 0; land.c[i] = 1;
  return { ok: true, cost, msg: `${def.name} being repaired.` };
}

export function demolish(land, x, y) {
  const i = idx(land, x, y);
  if (!land.b[i]) return { ok: false, msg: 'Nothing to demolish' };
  if (land.b[i] === B.KEEP) return { ok: false, msg: 'The keep stays' };
  const name = BUILDING[land.b[i]].name;
  land.b[i] = 0; land.c[i] = 0; land.d[i] = 0;
  return { ok: true, msg: `${name} demolished.` };
}

export function startProject(land, x, y, kind, ctx = {}) {
  const i = idx(land, x, y), pr = PROJECT[kind];
  if (!pr) return { ok: false, cost: 0, msg: 'Unknown project' };
  const ok = pr.on ? pr.on.includes(land.t[i]) : land.r[i] === pr.res;
  if (!ok) return { ok: false, cost: 0, msg: `${pr.name} is not possible here` };
  if (land.p.some(p => p.i === i)) return { ok: false, cost: 0, msg: 'Already under way' };
  if (land.b[i] && kind !== 'excavate') return { ok: false, cost: 0, msg: 'Clear the building first' };
  if (ctx.gold != null && ctx.gold < pr.cost) return { ok: false, cost: pr.cost, msg: `Needs ${pr.cost} gold` };
  land.p.push({ i, kind, left: pr.time });
  return { ok: true, cost: pr.cost, msg: `${pr.name} started (${pr.time} months).` };
}

// Advance one month: construction and projects. rng: { next() } (js/rng.js makeRng) for
// excavation treasure. Returns { done: [{i, what}], gold } where gold is one-off income
// (timber from clearing, treasure).
export function monthTick(land, rng) {
  const done = [];
  let gold = 0;
  for (let i = 0; i < land.c.length; i++) {
    if (land.c[i] > 0) { land.c[i]--; if (!land.c[i]) done.push({ i, what: BUILDING[land.b[i]].key }); }
  }
  for (const p of land.p) {
    if (--p.left > 0) continue;
    if (p.kind === 'clear') { land.t[p.i] = rng && rng.next() < 0.35 ? T.POOR : T.PLAIN; gold += 20; }
    if (p.kind === 'drain') {
      const wet = neighbours4(land, p.i).some(j => land.t[j] === T.RIVER || land.t[j] === T.WATER);
      land.t[p.i] = wet ? T.FERTILE : T.PLAIN;
    }
    if (p.kind === 'excavate') { gold += 80 + Math.floor((rng ? rng.next() : 0.5) * 121); land.r[p.i] = R.NONE; }
    done.push({ i: p.i, what: p.kind });
  }
  land.p = land.p.filter(p => p.left > 0);
  return { done, gold };
}

// War damage. intensity 0..1 (e.g. losses / soldiers involved). Each building may be damaged;
// already damaged ones may be razed; farms burn more easily. Returns { damaged, razed }.
export function damage(land, intensity, rng) {
  let damaged = 0, razed = 0;
  const k = Math.max(0, Math.min(1, intensity));
  for (let i = 0; i < land.b.length; i++) {
    const b = land.b[i];
    if (!b || b === B.KEEP) continue;
    const p = k * (b === B.FARM || b === B.ORCHARD ? 0.45 : b === B.WALLS ? 0.5 : 0.3);
    if (rng.next() >= p) continue;
    if (land.d[i] || land.c[i]) { land.b[i] = 0; land.c[i] = 0; land.d[i] = 0; razed++; } else { land.d[i] = 1; damaged++; }
  }
  return { damaged, razed };
}

// Loot a conquered province: gold now, at the price of its markets, houses and granaries.
export function loot(land, rng) {
  let gold = 0;
  for (let i = 0; i < land.b.length; i++) {
    const b = land.b[i];
    if (![B.MARKET, B.HOUSES, B.GRANARY, B.TEMPLE].includes(b) || land.d[i]) continue;
    gold += Math.round(BUILDING[b].cost * 0.6);
    if (rng.next() < 0.6) land.d[i] = 1;
  }
  return { gold, loyalty: -25 };
}

// ---------------------------------------------------------------- AI

// Best affordable build for a goal: 'food' | 'gold' | 'army' | 'loyalty' | 'balanced'.
// Returns { x, y, kind, cost, score, preview } or null.
export function suggestBuild(land, ctx = {}, goal = 'balanced') {
  const base = provinceYield(land, ctx);
  const budget = ctx.gold ?? Infinity;
  const W8 = {
    food:     { food: 1.0, gold: 3, pop: 0.05, loyalty: 2, defense: 0 },
    gold:     { food: 0.15, gold: 10, pop: 0.1, loyalty: 2, defense: 0 },
    army:     { food: 0.3, gold: 3, pop: 0.3, loyalty: 2, defense: 120 },
    loyalty:  { food: 0.2, gold: 2, pop: 0.02, loyalty: 12, defense: 0 },
    balanced: { food: 0.45, gold: 6, pop: 0.12, loyalty: 4, defense: 40 },
  }[goal] || {};
  // Short of hands: houses first.
  const needHands = base.labour < 0.9;
  let best = null;
  for (let i = 0; i < land.t.length; i++) {
    if (land.b[i] || land.p.some(p => p.i === i)) continue;
    for (const def of BUILDING) {
      if (def.key === 'none' || def.key === 'keep') continue;
      if (def.key === 'barracks' && goal !== 'army') continue;
      if (def.key === 'walls' && goal !== 'army' && goal !== 'balanced') continue;
      if (canBuild(land, i, def.key)) continue;
      const cost = buildCost(land, def.key, { ...ctx, yieldCache: base });
      if (cost > budget) continue;
      const d = previewDelta(land, i, def.key, base, ctx);
      let score = d.food * W8.food + d.gold * W8.gold + d.pop * W8.pop + d.loyalty * W8.loyalty + d.defense * W8.defense;
      if (needHands && def.key === 'houses') score += 25;
      if (d.labour < 0.95 && d.labour < base.labour - 1e-6) continue;   // don't build what nobody can work
      if (def.key === 'granary' && base.storage < 200) score += 6;
      score = score / Math.max(10, cost) * 10 - def.time * 0.2;
      if (score > 0 && (!best || score > best.score)) best = { x: i % land.w, y: (i / land.w) | 0, kind: def.key, cost, score: Math.round(score * 100) / 100, preview: d };
    }
  }
  return best;
}

// Upper bound of the land: food if every soil tile were farmed (with mills and enough houses).
// Used to rate provinces (breadbasket vs barren).
export function potential(land) {
  let food = 0, gold = 0;
  for (let i = 0; i < land.t.length; i++) {
    const t = land.t[i];
    const soil = TERRAIN[t].soil;
    if (soil) {
      let f = Y.farm * soil * (1 + Y.millBoost * 0.8);
      if (neighbours4(land, i).some(j => land.t[j] === T.RIVER || (land.t[j] === T.WATER && land.lake))) f *= 1 + Y.irrigation;
      food += f;
    } else if (t === T.WATER || t === T.RIVER) {
      if (fisheryOk(land, i)) food += 0.3 * (t === T.WATER ? Y.fishSea : Y.fishRiver);
    } else if (t === T.HILLS) { food += 0.3 * Y.orchardFood; gold += 0.5 * Y.mineHills; }
    else if (t === T.ROCK) gold += 0.5 * Y.mineRock;
    const r = land.r[i];
    if (r === R.ORE) gold += Y.oreGold; if (r === R.SALT) gold += Y.saltGold;
    if (r === R.PEARLS) gold += Y.pearlGold; if (r === R.VINES) gold += Y.vineGold;
  }
  return { food: Math.round(food * 0.7), gold: Math.round(gold) };   // 0.7: land kept for houses and markets
}
