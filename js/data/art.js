import { PROVINCES } from './world.js';
const PROVINCE_NAMES = PROVINCES.map(p => p.name);

// Art slots 1-100 (see docs/SHOTLIST.md). Each slot: id, kind, target size (w x h) after
// processing, and how tools/process_art.py treats it:
//   cover   = centre-crop to aspect, resize
//   cutout  = crop, resize, remove the flat pale-grey background (PNG/WebP with alpha)
//   tile    = square crop, resize, make seamless-ish by edge blend
//   fx      = keep black background; drawn with 'screen' blending
// art(slot) returns the processed file URL, or the placeholder SVG if the slot is not filled
// yet (art/manifest.json lists filled slots).

const S = (from, to, kind, w, h, mode) => {
  const out = [];
  for (let i = from; i <= to; i++) out.push({ slot: i, kind, w, h, mode });
  return out;
};

export const SLOTS = [
  ...S(1, 2, 'title', 1600, 900, 'cover'),
  ...S(3, 3, 'texture', 1024, 1024, 'tile'),
  ...S(4, 7, 'season', 1200, 400, 'cover'),
  ...S(8, 9, 'scene', 1600, 900, 'cover'),
  ...S(10, 11, 'map', 2000, 1500, 'cover'),
  ...S(12, 12, 'fog', 1024, 1024, 'tile'),
  ...S(13, 15, 'token', 256, 256, 'cutout'),
  ...S(16, 51, 'portrait', 512, 640, 'cover'),
  ...S(52, 56, 'spirit', 1024, 1024, 'cover'),
  ...S(57, 74, 'sprite', 256, 256, 'cutout'),
  ...S(75, 84, 'terrain', 256, 256, 'tile'),
  ...S(85, 89, 'fx', 512, 512, 'fx'),
  ...S(90, 100, 'scene', 1600, 900, 'cover'),
  // Extra set (docs/SHOTLIST-EXTRA.md)
  ...S(101, 106, 'crest', 384, 384, 'cutout'),
  ...S(107, 110, 'backdrop', 1600, 700, 'cover'),
  ...S(111, 112, 'map', 2000, 1500, 'cover'),
  ...S(113, 136, 'vignette', 800, 450, 'cover'),
  ...S(137, 172, 'sprite', 256, 256, 'cutout'),
  ...S(173, 190, 'scene', 1600, 900, 'cover'),
  ...S(191, 200, 'backdrop', 1600, 700, 'cover'),
  // Battle set
  ...S(201, 225, 'cutin', 1600, 700, 'cover'),
  ...S(226, 228, 'fx', 1024, 1024, 'fx'),
  ...S(229, 230, 'ui', 1024, 1024, 'cutout'),
  // Vignettes for the four island provinces added with the 28-province map
  ...S(231, 234, 'vignette', 800, 450, 'cover'),
];

// Battle set lookups.
export const CLASH_CUTIN = { footmen: 201, pikes: 202, archers: 203, horse: 204, knights: 205,
  siege: 206, wolfriders: 207, golem: 208, wyvern: 209, ghosts: 210, bandits: 211, druids: 212,
  militia: 213 };
export const SPIRIT_CUTIN = { ember: 214, tide: 215, gale: 216, stone: 217, dusk: 218 };
export const BATTLE_MOMENT = { gateBreach: 219, ladders: 220, rout: 221, keepTaken: 222,
  lastStand: 223, duel: 224, intro: 225 };
export const WEATHER_FX = { rain: 226, snow: 227, fog: 228 };
export const BATTLE_FRAME = 229, BATTLE_EMBLEM = 230;

// Extra-set lookups. House order matches HOUSES in houses.js.
export const HOUSE_ORDER = ['aldmere', 'corvane', 'isolde', 'hrothgar', 'seraphine', 'vey'];
export const CREST = Object.fromEntries(HOUSE_ORDER.map((h, i) => [h, 101 + i]));
export const ENDING = Object.fromEntries(HOUSE_ORDER.map((h, i) => [h, 185 + i]));
// Vignette slot by province name (slots 113-136 follow the shot list's order; 231-234 are the
// island provinces added later).
const VIGNETTE_BY_NAME = {
  Frosthelm: 113, Ravenscar: 114, Greywatch: 115, Coldmere: 116, Ironpeak: 117, Skerry: 118,
  Highcairn: 119, Thornwood: 120, Aldford: 121, Kingsrest: 122, Saltmarch: 123, Gullhaven: 124,
  Bramblefell: 125, Oakhollow: 126, Lanterncross: 127, Millbrook: 128, Amberfield: 129, Pearlcoast: 130,
  Mirefen: 131, Reedwater: 132, Fenwick: 133, Sunspire: 134, Goldvale: 135, Tidesend: 136,
  Westreach: 231, Cairnholm: 232, Sunderisle: 233, Emberrock: 234,
};
export const PROVINCE_VIGNETTE = id => VIGNETTE_BY_NAME[PROVINCE_NAMES[id]] ?? 113;
export const BATTLE_BACKDROP = { plains: 107, coast: 107, forest: 108, hills: 109, mountain: 109, marsh: 110 };
export const SEASON_MAP = [111, 10, 112, 11];         // spring, summer, autumn, winter
// Troop sprite in house colours (fallback: neutral sprite from units.js, tinted).
const HOUSE_TROOP_ORDER = ['footmen', 'pikes', 'archers', 'horse', 'knights', 'siege'];
export function houseTroopSprite(house, troop) {
  const h = HOUSE_ORDER.indexOf(house), t = HOUSE_TROOP_ORDER.indexOf(troop);
  return h < 0 || t < 0 ? null : 137 + h * 6 + t;
}
export const ORDER_BACKDROP = { throne: 191, council: 192, market: 193, fields: 194, muster: 195,
  train: 196, dikes: 197, hire: 198, diplomacy: 199, spy: 200 };
export const EXTRA_EVENT = { spy: 173, bribe: 174, duel: 175, tribute: 176, hire: 177, captive: 178,
  shard: 179, truce: 180, succession: 181, granaryFire: 182, refugees: 183, feast: 184 };
export const SLOT = Object.fromEntries(SLOTS.map(s => [s.slot, s]));

// Terrain tile slot per battle terrain key.
export const TERRAIN_TILE = {
  grass: 75, forest: 76, hills: 77, mountain: 78, water: 79, bridge: 80,
  road: 81, wall: 82, gate: 83, village: 84, marsh: 79,
};

export const pad3 = n => String(n).padStart(3, '0');

let filled = null;   // Set of slot numbers with real art, loaded from art/manifest.json
export async function loadArtManifest(base = '') {
  try {
    const r = await fetch(base + 'art/manifest.json', { cache: 'no-cache' });
    const m = r.ok ? await r.json() : { slots: {} };
    filled = new Map(Object.entries(m.slots || {}).map(([k, v]) => [Number(k), v]));
  } catch { filled = new Map(); }
  return filled;
}

export function art(slot, base = '') {
  const f = filled && filled.get(slot);
  if (f) return base + 'art/' + f;                 // e.g. "016.webp"
  return base + 'art-placeholder/' + pad3(slot) + '.svg';
}
export function hasArt(slot) { return !!(filled && filled.get(slot)); }
