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
];
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
