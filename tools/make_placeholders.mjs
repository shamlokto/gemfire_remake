// Writes art-placeholder/NNN.svg for every art slot (js/data/art.js), at the slot's aspect.
// node tools/make_placeholders.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ART from '../js/data/art.js';
const { SLOTS, pad3, HOUSE_ORDER, ORDER_BACKDROP, EXTRA_EVENT } = ART;
import { PROVINCES, ADJACENCY } from '../js/data/world.js';
import { HOUSES } from '../js/data/houses.js';
import { SPIRITS } from '../js/data/spirits.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'art-placeholder');
mkdirSync(out, { recursive: true });

const LABELS = {
  1: 'Key art', 2: 'Council table', 3: 'Parchment', 4: 'Spring', 5: 'Summer', 6: 'Autumn', 7: 'Winter',
  8: 'Victory', 9: 'Defeat', 10: 'World map', 11: 'World map (winter)', 12: 'Fog', 13: 'Castle token',
  14: 'Army token', 15: 'Compass', 57: 'Wolfriders', 58: 'Golem', 59: 'Wyvern', 60: 'Ghost knight',
  61: 'Bandit', 62: 'Druid', 63: 'Footman', 64: 'Pikeman', 65: 'Archer', 66: 'Crossbowman',
  67: 'Light horse', 68: 'Knight', 69: 'Ram crew', 70: 'Catapult', 71: 'General', 72: 'Banner bearer',
  73: 'Supply wagon', 74: 'Militia', 75: 'Grass', 76: 'Forest', 77: 'Hills', 78: 'Mountain', 79: 'Water',
  80: 'Bridge', 81: 'Road', 82: 'Wall', 83: 'Gate', 84: 'Village', 85: 'Wildfire', 86: 'Flood',
  87: 'Lightning', 88: 'Stone wall', 89: 'Shadow mist', 90: 'Bumper harvest', 91: 'Famine', 92: 'Flood',
  93: 'Plague', 94: 'Revolt', 95: 'Betrayal', 96: 'Marriage', 97: 'Night siege', 98: 'Blizzard',
  99: 'The Lantern falls', 100: 'Peace of the Five',
};
const spiritKeys = Object.keys(SPIRITS);
const TROOP_LABEL = ['Footman', 'Pikeman', 'Archer', 'Light horse', 'Knight', 'Catapult'];
HOUSE_ORDER.forEach((h, i) => {
  LABELS[101 + i] = `${HOUSES[i].short} crest`;
  LABELS[185 + i] = `${HOUSES[i].short} ending`;
  TROOP_LABEL.forEach((t, j) => { LABELS[137 + i * 6 + j] = `${HOUSES[i].short} ${t}`; });
});
Object.assign(LABELS, { 107: 'Plains battle', 108: 'Forest battle', 109: 'Mountain battle', 110: 'Marsh battle',
  111: 'World map (spring)', 112: 'World map (autumn)' });
PROVINCES.forEach(p => { LABELS[113 + p.id] = p.name; });
for (const [k, v] of Object.entries(ORDER_BACKDROP)) LABELS[v] = `Order: ${k}`;
for (const [k, v] of Object.entries(EXTRA_EVENT)) LABELS[v] = `Event: ${k}`;
for (const [name, pre] of [['CLASH_CUTIN', 'Clash'], ['SPIRIT_CUTIN', 'Summon'], ['BATTLE_MOMENT', 'Battle'], ['WEATHER_FX', 'Weather'], ['BATTLE_FRAME', 'Frame'], ['BATTLE_EMBLEM', 'Emblem']]) {
  const m = ART[name];
  if (m && typeof m === 'object') for (const [k, v] of Object.entries(m)) if (typeof v === 'number') LABELS[v] = `${pre}: ${k}`;
  else if (typeof m === 'number') LABELS[m] = pre;
}
spiritKeys.forEach((k, i) => { LABELS[52 + i] = SPIRITS[k].name; });

function houseForPortrait(slot) {
  if (slot <= 21) return HOUSES[slot - 16];
  return HOUSES[Math.floor((slot - 22) / 5)];
}

const stamp = (s, w, h) => {
  const fs = Math.max(10, Math.round(Math.min(w, h) * 0.028));
  const label = LABELS[s.slot] || s.kind;
  return `<text x="${fs * 0.6}" y="${h - fs * 0.6}" font-family="Georgia,serif" font-size="${fs}" fill="#f3e3b5" fill-opacity="0.35">${pad3(s.slot)} · ${esc(label)}</text>`;
};
const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function svg(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>\n`;
}

const grad = (id, a, b, vertical = true) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${vertical ? 1 : 0}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;

function scene(s, w, h, top, bottom, extra = '') {
  return svg(w, h, `<defs>${grad('g', top, bottom)}<radialGradient id="v" cx="0.5" cy="0.45" r="0.75"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.65"/></radialGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>
<path d="M0 ${h * 0.72} Q ${w * 0.2} ${h * 0.6} ${w * 0.4} ${h * 0.7} T ${w * 0.8} ${h * 0.66} T ${w} ${h * 0.7} V ${h} H 0 Z" fill="#000" fill-opacity="0.35"/>
<path d="M0 ${h * 0.82} Q ${w * 0.3} ${h * 0.74} ${w * 0.55} ${h * 0.84} T ${w} ${h * 0.8} V ${h} H 0 Z" fill="#000" fill-opacity="0.45"/>
${extra}<rect width="${w}" height="${h}" fill="url(#v)"/>${stamp(s, w, h)}`);
}

function lantern(cx, cy, r, broken) {
  return `<g transform="translate(${cx} ${cy})"><circle r="${r * 2.2}" fill="#ffd27a" fill-opacity="0.18"/><circle r="${r * 1.3}" fill="#ffd27a" fill-opacity="0.25"/>
<path d="M${-r * 0.6} ${-r} L${r * 0.6} ${-r} L${r * 0.8} ${r * 0.7} L${-r * 0.8} ${r * 0.7} Z" fill="#ffe7a8" stroke="#8a6a2a" stroke-width="${r * 0.08}"/>
<rect x="${-r * 0.4}" y="${-r * 1.35}" width="${r * 0.8}" height="${r * 0.35}" fill="#8a6a2a"/>
${broken ? `<path d="M${-r * 0.2} ${-r} L${r * 0.1} ${-r * 0.2} L${-r * 0.15} ${r * 0.2} L${r * 0.2} ${r * 0.7}" stroke="#2a1a08" stroke-width="${r * 0.08}" fill="none"/>` : ''}</g>`;
}

function castle(cx, cy, k, fill = '#2a2230') {
  return `<g transform="translate(${cx} ${cy}) scale(${k})" fill="${fill}"><rect x="-40" y="-30" width="80" height="50"/><rect x="-55" y="-55" width="22" height="75"/><rect x="33" y="-55" width="22" height="75"/><rect x="-12" y="-75" width="24" height="45"/>
<path d="M-55 -55 h6 v-6 h5 v6 h5 v-6 h6 v6 M33 -55 h6 v-6 h5 v6 h5 v-6 h6 v6"/><path d="M0 -75 v-22 l16 6 -16 6" fill="#c9a24a"/></g>`;
}

function portrait(s, w, h) {
  const house = houseForPortrait(s.slot);
  const ruler = s.slot <= 21;
  const c = house.color;
  return svg(w, h, `<defs>${grad('g', '#2b2433', '#0d0b10')}<radialGradient id="r" cx="0.5" cy="0.35" r="0.6"><stop offset="0" stop-color="${c}" stop-opacity="0.45"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/><rect width="${w}" height="${h}" fill="url(#r)"/>
<ellipse cx="${w / 2}" cy="${h * 0.36}" rx="${w * 0.17}" ry="${h * 0.15}" fill="#0a080c" fill-opacity="0.85"/>
<path d="M${w * 0.12} ${h} Q ${w * 0.15} ${h * 0.6} ${w / 2} ${h * 0.56} Q ${w * 0.85} ${h * 0.6} ${w * 0.88} ${h} Z" fill="#0a080c" fill-opacity="0.85"/>
<path d="M${w * 0.3} ${h * 0.62} L${w / 2} ${h * 0.78} L${w * 0.7} ${h * 0.62}" stroke="${c}" stroke-width="${w * 0.03}" fill="none"/>
${ruler ? `<path d="M${w * 0.36} ${h * 0.22} l${w * 0.04} ${-h * 0.07} l${w * 0.05} ${h * 0.05} l${w * 0.05} ${-h * 0.07} l${w * 0.05} ${h * 0.07} l${w * 0.05} ${-h * 0.05} l${w * 0.04} ${h * 0.07} Z" fill="#d8b84a"/>` : ''}
${stamp(s, w, h)}`);
}

function sprite(s, w, h) {
  const label = LABELS[s.slot] || '';
  const hc = s.slot >= 137 ? HOUSES[Math.floor((s.slot - 137) / 6)].color : null;
  const cx = w / 2, cy = h * 0.55, k = w / 256;
  const body = `<ellipse cx="${cx}" cy="${h * 0.86}" rx="${70 * k}" ry="${16 * k}" fill="#000" fill-opacity="0.25"/>`;
  let fig;
  const mounted = /horse|Knight|General|Wolf/.test(label);
  if (/Wyvern/.test(label)) {
    fig = `<path d="M${cx} ${cy - 20 * k} l${-90 * k} ${-50 * k} l${30 * k} ${60 * k} l${-40 * k} ${10 * k} l${100 * k} ${10 * k} l${100 * k} ${-10 * k} l${-40 * k} ${-10 * k} l${30 * k} ${-60 * k} Z" fill="#4a3a52"/><circle cx="${cx}" cy="${cy - 30 * k}" r="${14 * k}" fill="#4a3a52"/>`;
  } else if (/Golem/.test(label)) {
    fig = `<rect x="${cx - 40 * k}" y="${cy - 50 * k}" width="${80 * k}" height="${90 * k}" rx="${12 * k}" fill="#8a6a4a"/><rect x="${cx - 22 * k}" y="${cy - 85 * k}" width="${44 * k}" height="${36 * k}" rx="${8 * k}" fill="#8a6a4a"/><circle cx="${cx - 8 * k}" cy="${cy - 68 * k}" r="${4 * k}" fill="#ffd27a"/><circle cx="${cx + 8 * k}" cy="${cy - 68 * k}" r="${4 * k}" fill="#ffd27a"/>`;
  } else if (/Catapult|Ram|wagon/.test(label)) {
    fig = `<rect x="${cx - 60 * k}" y="${cy - 10 * k}" width="${120 * k}" height="${36 * k}" fill="#6a4a2a"/><circle cx="${cx - 40 * k}" cy="${cy + 32 * k}" r="${16 * k}" fill="#3a2a1a"/><circle cx="${cx + 40 * k}" cy="${cy + 32 * k}" r="${16 * k}" fill="#3a2a1a"/><path d="M${cx} ${cy - 10 * k} L${cx + 50 * k} ${cy - 80 * k}" stroke="#6a4a2a" stroke-width="${10 * k}"/>`;
  } else {
    fig = (mounted ? `<path d="M${cx - 60 * k} ${cy + 10 * k} q${60 * k} ${-30 * k} ${110 * k} ${-10 * k} l${10 * k} ${-25 * k} l${10 * k} ${25 * k} l${-10 * k} ${50 * k} h${-110 * k} Z" fill="#5a4636"/>` : '') +
      `<circle cx="${cx}" cy="${cy - (mounted ? 72 : 55) * k}" r="${15 * k}" fill="#d9d4cc"/><path d="M${cx - 22 * k} ${cy + (mounted ? -10 : 40) * k} l${8 * k} ${-50 * k} h${28 * k} l${8 * k} ${50 * k} Z" fill="${hc || '#e8e4dc'}"/>` +
      (/Pike/.test(label) ? `<path d="M${cx + 30 * k} ${cy + 40 * k} L${cx + 30 * k} ${cy - 110 * k}" stroke="#bbb" stroke-width="${5 * k}"/>` : '') +
      (/Archer|Crossbow|Bandit/.test(label) ? `<path d="M${cx + 30 * k} ${cy - 60 * k} q${25 * k} ${40 * k} 0 ${80 * k}" stroke="#bbb" stroke-width="${4 * k}" fill="none"/>` : '') +
      (/Footman|Militia|Ghost|General|Knight/.test(label) ? `<rect x="${cx - 42 * k}" y="${cy - 30 * k}" width="${22 * k}" height="${32 * k}" rx="${6 * k}" fill="#a8a8b8"/>` : '') +
      (/Banner/.test(label) ? `<path d="M${cx + 30 * k} ${cy + 40 * k} V${cy - 110 * k} l${50 * k} ${12 * k} l${-50 * k} ${16 * k}" stroke="#bbb" stroke-width="${4 * k}" fill="#e8e4dc"/>` : '') +
      (/Druid/.test(label) ? `<path d="M${cx + 30 * k} ${cy + 40 * k} V${cy - 100 * k}" stroke="#6a8a4a" stroke-width="${6 * k}"/><circle cx="${cx + 30 * k}" cy="${cy - 104 * k}" r="${8 * k}" fill="#9eea7a"/>` : '');
  }
  return svg(w, h, body + fig + stamp(s, w, h));
}

const TERRAIN = {
  75: ['#4f7a37', '#6b9a46', 'grass'], 76: ['#244a26', '#33663a', 'trees'], 77: ['#7a7a45', '#9a9455', 'hills'],
  78: ['#5a5650', '#8a847a', 'rocks'], 79: ['#245a8a', '#3a7ab0', 'waves'], 80: ['#245a8a', '#3a7ab0', 'bridge'],
  81: ['#8a7048', '#a88a5a', 'road'], 82: ['#6a6660', '#8a867e', 'bricks'], 83: ['#6a6660', '#8a867e', 'gate'],
  84: ['#7a6a3a', '#9a8048', 'roofs'],
};
function terrain(s, w, h) {
  const [a, b, kind] = TERRAIN[s.slot];
  let pat = '';
  const rnd = mulberry(s.slot * 77);
  if (kind === 'grass') for (let i = 0; i < 70; i++) { const x = rnd() * w, y = rnd() * h; pat += `<path d="M${x} ${y} l2 -8 M${x + 4} ${y} l-1 -7" stroke="#3a6028" stroke-width="2"/>`; }
  if (kind === 'trees') for (let i = 0; i < 26; i++) { const x = rnd() * w, y = rnd() * h, r = 14 + rnd() * 12; pat += `<circle cx="${x}" cy="${y}" r="${r}" fill="#1a3a1c" fill-opacity="0.8"/><circle cx="${x - 3}" cy="${y - 4}" r="${r * 0.7}" fill="#3e7a44"/>`; }
  if (kind === 'hills') for (let i = 0; i < 5; i++) { const x = rnd() * w, y = rnd() * h; pat += `<ellipse cx="${x}" cy="${y}" rx="60" ry="32" fill="#5e5e34" fill-opacity="0.5"/><ellipse cx="${x - 10}" cy="${y - 8}" rx="44" ry="20" fill="#b0aa6a" fill-opacity="0.45"/>`; }
  if (kind === 'rocks') for (let i = 0; i < 5; i++) { const x = rnd() * w, y = rnd() * h; pat += `<path d="M${x - 50} ${y + 30} L${x} ${y - 50} L${x + 50} ${y + 30} Z" fill="#46423c"/><path d="M${x - 14} ${y - 28} L${x} ${y - 50} L${x + 14} ${y - 28} Z" fill="#e8e8f0"/>`; }
  if (kind === 'waves' || kind === 'bridge') for (let i = 0; i < 14; i++) { const x = rnd() * w, y = rnd() * h; pat += `<path d="M${x} ${y} q10 -6 20 0 t20 0" stroke="#9fd0f0" stroke-opacity="0.6" stroke-width="3" fill="none"/>`; }
  if (kind === 'bridge') { pat += `<rect x="0" y="${h * 0.3}" width="${w}" height="${h * 0.4}" fill="#7a5530"/>`; for (let x = 0; x < w; x += 22) pat += `<rect x="${x}" y="${h * 0.3}" width="2" height="${h * 0.4}" fill="#4a3018"/>`; }
  if (kind === 'road') { pat += `<rect x="0" y="0" width="${w}" height="${h}" fill="#a88a5a"/>`; for (let i = 0; i < 60; i++) pat += `<circle cx="${rnd() * w}" cy="${rnd() * h}" r="${2 + rnd() * 4}" fill="#7a6040"/>`; }
  if (kind === 'bricks' || kind === 'gate') for (let y = 0; y < h; y += 32) for (let x = (y / 32) % 2 ? -32 : 0; x < w; x += 64) pat += `<rect x="${x + 2}" y="${y + 2}" width="60" height="28" fill="#7a766e" stroke="#4a4640" stroke-width="2"/>`;
  if (kind === 'gate') pat += `<path d="M${w * 0.25} ${h} V${h * 0.4} Q${w / 2} ${h * 0.05} ${w * 0.75} ${h * 0.4} V${h} Z" fill="#4a2e18" stroke="#2a1a0a" stroke-width="6"/>`;
  if (kind === 'roofs') for (let i = 0; i < 6; i++) { const x = 20 + (i % 3) * 80, y = 30 + Math.floor(i / 3) * 120; pat += `<path d="M${x} ${y + 40} L${x + 30} ${y} L${x + 60} ${y + 40} Z" fill="#c8a050"/><rect x="${x + 5}" y="${y + 40}" width="50" height="40" fill="#8a6a4a"/>`; }
  return svg(w, h, `<defs>${grad('g', b, a)}</defs><rect width="${w}" height="${h}" fill="url(#g)"/>${pat}${stamp(s, w, h)}`);
}

function mulberry(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function worldMap(s, w, h, winter) {
  const k = w / 1000;
  const land = winter ? ['#e8eef2', '#c8d4dc'] : ['#e6d3a3', '#cdb47e'];
  const rnd = mulberry(10);
  let blobs = '';
  for (const p of PROVINCES) {
    const col = winter ? '#dfe8ee' : ({ plains: '#cfc07a', forest: '#7f9a5a', hills: '#b8a070', mountain: '#9a8f80', marsh: '#7a9a7a', coast: '#d8c48a' })[p.terrain];
    blobs += `<ellipse cx="${p.x * k}" cy="${p.y * k}" rx="${(70 + rnd() * 20) * k}" ry="${(60 + rnd() * 15) * k}" fill="${col}" fill-opacity="0.55"/>`;
    if (p.terrain === 'mountain') for (let i = 0; i < 4; i++) { const x = (p.x - 40 + rnd() * 80) * k, y = (p.y - 30 + rnd() * 50) * k; blobs += `<path d="M${x - 16 * k} ${y + 10 * k} L${x} ${y - 16 * k} L${x + 16 * k} ${y + 10 * k} Z" fill="#6a6258" fill-opacity="0.7"/>`; }
    if (p.terrain === 'forest') for (let i = 0; i < 7; i++) { const x = (p.x - 45 + rnd() * 90) * k, y = (p.y - 35 + rnd() * 60) * k; blobs += `<circle cx="${x}" cy="${y}" r="${7 * k}" fill="#3e5a2e" fill-opacity="0.7"/>`; }
  }
  const river = `<path d="M${420 * k} ${0} C ${470 * k} ${180 * k}, ${380 * k} ${300 * k}, ${470 * k} ${380 * k} S ${520 * k} ${600 * k}, ${480 * k} ${750 * k}" stroke="${winter ? '#a8c4d8' : '#5a8ab0'}" stroke-width="${10 * k}" fill="none" stroke-opacity="0.8"/>`;
  return svg(w, h, `<defs>${grad('sea', '#3a6a8a', '#244a66', false)}${grad('land', land[0], land[1])}
<filter id="rough"><feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="3" seed="4"/><feDisplacementMap in="SourceGraphic" scale="${40 * k}"/></filter>
<filter id="paper"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2"/><feColorMatrix values="0 0 0 0 0.4 0 0 0 0 0.3 0 0 0 0 0.2 0 0 0 0.12 0"/></filter>
<radialGradient id="v" cx="0.5" cy="0.5" r="0.75"><stop offset="0.6" stop-color="#2a1a08" stop-opacity="0"/><stop offset="1" stop-color="#2a1a08" stop-opacity="0.55"/></radialGradient></defs>
<rect width="${w}" height="${h}" fill="url(#sea)"/>
<path filter="url(#rough)" d="M${30 * k} ${30 * k} H${860 * k} Q${830 * k} ${200 * k} ${850 * k} ${380 * k} T ${840 * k} ${720 * k} H${30 * k} Z" fill="url(#land)"/>
<g filter="url(#rough)">${blobs}</g>${river}
<rect width="${w}" height="${h}" filter="url(#paper)"/><rect width="${w}" height="${h}" fill="url(#v)"/>${stamp(s, w, h)}`);
}

function fx(s, w, h) {
  const colors = { 85: '#ff7a2f', 86: '#3fb6ff', 87: '#d6e4ff', 88: '#b08d57', 89: '#9a6bff' };
  const c = colors[s.slot];
  return svg(w, h, `<defs><radialGradient id="r" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff" stop-opacity="0.9"/><stop offset="0.3" stop-color="${c}" stop-opacity="0.8"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient></defs>
<rect width="${w}" height="${h}" fill="#000"/><circle cx="${w / 2}" cy="${h / 2}" r="${w * 0.45}" fill="url(#r)"/>${stamp(s, w, h)}`);
}

function spiritArt(s, w, h) {
  const key = spiritKeys[s.slot - 52];
  const c = SPIRITS[key].color;
  return scene(s, w, h, '#14101c', '#05040a', `<circle cx="${w / 2}" cy="${h * 0.45}" r="${w * 0.3}" fill="${c}" fill-opacity="0.18"/><circle cx="${w / 2}" cy="${h * 0.45}" r="${w * 0.16}" fill="${c}" fill-opacity="0.45"/>
<text x="${w / 2}" y="${h * 0.5}" text-anchor="middle" font-family="Georgia,serif" font-size="${w * 0.14}" fill="#fff" fill-opacity="0.85">${({ ember: '🜂', tide: '🜄', gale: '🜁', stone: '🜃', dusk: '☾' })[key]}</text>`);
}

const SCENE_COLORS = {
  1: ['#3a2a4a', '#0e0a14'], 2: ['#3a2818', '#120a06'], 4: ['#9ac8a0', '#4a7a5a'], 5: ['#f0d080', '#8a9a4a'],
  6: ['#d07a3a', '#5a2a18'], 7: ['#8aa0c0', '#2a3450'], 8: ['#f0c070', '#5a3a2a'], 9: ['#3a3a48', '#100c10'],
  90: ['#f0b860', '#6a4020'], 91: ['#8a7a6a', '#2a2420'], 92: ['#6a8a9a', '#2a3a40'], 93: ['#7a7a7a', '#202020'],
  94: ['#c05a2a', '#1a0a08'], 95: ['#6a2a3a', '#140608'], 96: ['#e0c0d0', '#5a4060'], 97: ['#3a2040', '#0a0408'],
  98: ['#c8d8e8', '#4a5a70'], 99: ['#2a1a40', '#06040c'], 100: ['#f0d890', '#4a5a8a'],
};

function make(s) {
  const { slot, kind, w, h } = s;
  if (kind === 'portrait') return portrait(s, w, h);
  if (kind === 'sprite') return sprite(s, w, h);
  if (kind === 'terrain') return terrain(s, w, h);
  if (kind === 'map') return worldMap(s, w, h, slot === 11);
  if (kind === 'crest') return crest(s, w, h);
  if (kind === 'vignette') return vignette(s, w, h);
  if (kind === 'backdrop') return backdrop(s, w, h);
  if (kind === 'fx') return fx(s, w, h);
  if (kind === 'spirit') return spiritArt(s, w, h);
  if (kind === 'texture') {
    return svg(w, h, `<defs><filter id="p"><feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="4" seed="3"/><feColorMatrix values="0 0 0 0 0.85 0 0 0 0 0.74 0 0 0 0 0.55 0 0 0 0.35 0"/></filter></defs><rect width="${w}" height="${h}" fill="#e9d9b4"/><rect width="${w}" height="${h}" filter="url(#p)"/>`);
  }
  if (kind === 'fog') {
    return svg(w, h, `<defs><filter id="f"><feTurbulence type="fractalNoise" baseFrequency="0.006" numOctaves="4" seed="9"/><feColorMatrix values="0 0 0 0 0.75 0 0 0 0 0.78 0 0 0 0 0.85 0 0 0 1.1 -0.2"/></filter></defs><rect width="${w}" height="${h}" fill="#3a3e4a"/><rect width="${w}" height="${h}" filter="url(#f)"/>`);
  }
  if (kind === 'token') {
    const c = w / 2;
    let inner;
    if (slot === 13) inner = castle(c, c + 30, w / 240, '#4a4458');
    else if (slot === 14) inner = `<g stroke="#c9a24a" stroke-width="${w * 0.02}">${[-40, -10, 20, 50].map((dx, i) => `<path d="M${c + dx * w / 256} ${c + 60 * w / 256} V${c - 70 * w / 256}" /><path d="M${c + dx * w / 256} ${c - 70 * w / 256} l${30 * w / 256} ${10 * w / 256} l${-30 * w / 256} ${12 * w / 256}" fill="${['#b03a3a', '#3a6ab0', '#e0c050', '#4a8a3a'][i]}"/>`).join('')}</g>`;
    else inner = `<g transform="translate(${c} ${c})" fill="#c9a24a"><path d="M0 ${-w * 0.4} L${w * 0.06} 0 L0 ${w * 0.4} L${-w * 0.06} 0 Z"/><path d="M${-w * 0.4} 0 L0 ${w * 0.06} L${w * 0.4} 0 L0 ${-w * 0.06} Z" fill-opacity="0.7"/><circle r="${w * 0.08}" fill="none" stroke="#c9a24a" stroke-width="${w * 0.02}"/></g>`;
    const base = slot === 15 ? '' : `<ellipse cx="${c}" cy="${w * 0.8}" rx="${w * 0.38}" ry="${w * 0.1}" fill="#2a2018"/><ellipse cx="${c}" cy="${w * 0.78}" rx="${w * 0.36}" ry="${w * 0.08}" fill="#6a5030"/>`;
    return svg(w, h, base + inner);
  }
  const [a, b] = SCENE_COLORS[slot] || ['#3a3048', '#100c14'];
  let extra = '';
  if (slot === 1 || slot === 99) extra = lantern(w / 2, h * 0.38, h * 0.1, true) + castle(w * 0.2, h * 0.72, h / 600) + castle(w * 0.82, h * 0.74, h / 700);
  else if (slot === 100 || slot === 8 || (slot >= 185 && slot <= 190)) extra = lantern(w / 2, h * 0.4, h * 0.1, false);
  else if ([2, 9, 94, 95, 96, 97].includes(slot)) extra = castle(w / 2, h * 0.7, h / 500);
  return scene(s, w, h, a, b, extra);
}

function crest(s, w, h) {
  const hs = HOUSES[s.slot - 101];
  const c = w / 2;
  const glyph = { aldmere: '≈', corvane: '⋀', isolde: '⛵', hrothgar: '⚔', seraphine: '☀', vey: '♣' }[hs.id];
  return svg(w, h, `<defs>${grad('g', hs.accent, hs.color)}</defs>
<path d="M${c - w * 0.32} ${h * 0.14} H${c + w * 0.32} V${h * 0.5} Q${c + w * 0.32} ${h * 0.78} ${c} ${h * 0.9} Q${c - w * 0.32} ${h * 0.78} ${c - w * 0.32} ${h * 0.5} Z" fill="url(#g)" stroke="#c9a24a" stroke-width="${w * 0.03}"/>
<text x="${c}" y="${h * 0.6}" text-anchor="middle" font-family="Georgia,serif" font-size="${w * 0.3}" fill="#fff" fill-opacity="0.9">${glyph}</text>`);
}

function vignette(s, w, h) {
  const p = PROVINCES[s.slot - 113];
  const col = { plains: ['#e8d088', '#7a8a3a'], forest: ['#9ab88a', '#1e3a20'], hills: ['#d8c090', '#6a5a30'],
    mountain: ['#c8d0e0', '#4a4a50'], marsh: ['#a8b8a0', '#2a3a2a'], coast: ['#a8d0e8', '#2a5a7a'] }[p.terrain];
  return scene(s, w, h, col[0], col[1], castle(w * (0.3 + (p.id % 5) * 0.1), h * 0.7, h / 500));
}

function backdrop(s, w, h) {
  const col = { 107: ['#a8c8e0', '#6a8a3a'], 108: ['#e0b080', '#1e3a20'], 109: ['#c8d8f0', '#4a4a58'], 110: ['#a8b0a0', '#2a3a2a'] }[s.slot]
    || ['#5a4030', '#140c08'];
  return scene(s, w, h, col[0], col[1], s.slot >= 191 ? castle(w / 2, h * 0.75, h / 500, '#1a1418') : '');
}

for (const s of SLOTS) writeFileSync(join(out, pad3(s.slot) + '.svg'), make(s));
console.log(`wrote ${SLOTS.length} placeholders to art-placeholder/`);
