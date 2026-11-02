// Battle screen. runBattle(container, input, opts) -> Promise<BattleResult>.
//
// opts: { seed, playerSide: 'attacker'|'defender'|null (null = watch), houses?: {attacker:
//   {name,color,accent}, defender:{...}}, onLog?(text), state?: BattleState (resume),
//   onState?(b) (called after every action, for saving), cutins?: 'full'|'short'|'off',
//   speed?: 1|2 }
//
// Presentation: board with backdrop, frame, procedural or painted terrain, units drawn as 1-5
// figures by strength, idle bob, banners, strength bars; clash cut-ins on every attack, spirit
// summons, intro and outcome moments, weather, projectiles, particles, barks, sound effects.
// Every image goes through hasArt(slot); without real art the view draws everything itself.

import {
  createBattle, applyAction, legalMoves, legalTargets, result, getUnit, unitAt, liveUnits,
  spellCells, canCast, spiritOf, routAt, sideDone, statsOf, terrainAt, enemyOf, W, H, OBJ, TERRAIN, MAX_ROUNDS,
  moveRange, attackRange, expectedKills, DIR_NAMES,
} from '../battle/rules.js';
import { chooseAction } from '../battle/ai.js';
import { bark } from '../battle/barks.js';
import { sfx } from './sfx.js';
import { playSting } from './audio.js';
import {
  art, hasArt, TERRAIN_TILE, CLASH_CUTIN, SPIRIT_CUTIN, BATTLE_MOMENT, WEATHER_FX, BATTLE_FRAME,
  BATTLE_BACKDROP, CREST, houseTroopSprite,
} from '../data/art.js';
import { HOUSE_BY_ID } from '../data/houses.js';
import { VASSAL_BY_ID } from '../data/vassals.js';
import { SPIRITS } from '../data/spirits.js';
import { PROVINCES } from '../data/world.js';
import { palette, squadSize, formation, attackAct, MOUNTED, POWDER, launchPoint } from './battle-anim/figures.js';
import { blitFigure } from './battle-anim/figcache.js';
import { drawSpirit } from './battle-anim/spirit-art.js';
import { Particles, reducedMotion, blob } from './battle-anim/fx.js';
import { ClashScene } from './battle-anim/choreo.js';
import { ClashRenderer } from './battle-anim/clashfx.js';
import { drawInfoCard } from './battle-anim/infocard.js';
import { SpellAnim } from './battle-anim/spells.js';

const NEUTRAL = { name: 'Free Hold', short: 'Free Hold', color: '#8a8070', accent: '#e0d6c0' };
const PREF_KEY = 'lf.battle.prefs';
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; } };
const savePrefs = p => { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* private mode */ } };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const hash = (x, y, s = 0) => { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (hex, a) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };
function shade(hex, f) {   // f > 0 lighten, < 0 darken
  const [r, g, b] = hexToRgb(hex);
  const m = c => Math.round(f > 0 ? c + (255 - c) * f : c * (1 + f));
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

// ------------------------------------------------------------------ images

const imgCache = new Map();
function loadImg(url) {
  if (imgCache.has(url)) return imgCache.get(url);
  const p = new Promise(res => {
    const im = new Image();
    im.onload = () => { p.img = im; res(im); };
    im.onerror = () => { p.img = null; res(null); };
    im.src = url;
  });
  imgCache.set(url, p);
  return p;
}
// Synchronous accessor: the image if it is real art and already loaded, else null.
function artImg(slot) {
  if (slot == null || !hasArt(slot)) return null;
  const p = loadImg(art(slot));
  return p.img || null;
}

const tintCache = new Map();
function tinted(img, color, key) {
  const k = key + color;
  if (tintCache.has(k)) return tintCache.get(k);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.globalAlpha = 0.38; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
  tintCache.set(k, c);
  return c;
}

function drawCover(g, img, x, y, w, h, zoom = 1, panX = 0.5, panY = 0.5) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const s = Math.max(w / iw, h / ih) * zoom;
  const dw = iw * s, dh = ih * s;
  g.drawImage(img, x + (w - dw) * panX, y + (h - dh) * panY, dw, dh);
}

// ------------------------------------------------------------------ procedural art

const TERRAIN_COL = {
  grass: '#4f6d35', road: '#8b7451', forest: '#3d5a2c', hills: '#6b7340', village: '#5a6b38',
  wall: '#837c70', gate: '#7a7266', keep: '#8d8578', water: '#2c5b85', marsh: '#4c5a3a',
  bridge: '#2c5b85', mountain: '#6e6a66',
};

function drawTerrainCell(g, t, x, y, cs, gx, gy, season) {
  const r = (i) => hash(gx, gy, i);
  g.fillStyle = TERRAIN_COL[t] || '#555';
  if (t === 'forest' || t === 'hills' || t === 'village') g.fillStyle = TERRAIN_COL.grass;
  g.fillRect(x, y, cs + 0.5, cs + 0.5);
  // speckle
  for (let i = 0; i < 10; i++) {
    g.fillStyle = r(i) > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
    g.fillRect(x + r(i + 20) * cs, y + r(i + 40) * cs, cs * 0.08, cs * 0.05);
  }
  const cx = x + cs / 2, cy = y + cs / 2;
  switch (t) {
    case 'grass':
      g.strokeStyle = 'rgba(160,200,90,0.35)'; g.lineWidth = Math.max(1, cs / 40);
      for (let i = 0; i < 4; i++) { const px = x + r(i + 60) * cs, py = y + r(i + 70) * cs; g.beginPath(); g.moveTo(px, py); g.lineTo(px - cs * 0.03, py - cs * 0.08); g.moveTo(px, py); g.lineTo(px + cs * 0.03, py - cs * 0.07); g.stroke(); }
      break;
    case 'road':
      g.fillStyle = 'rgba(60,40,20,0.25)'; g.fillRect(x, cy - cs * 0.22, cs + 0.5, cs * 0.06); g.fillRect(x, cy + cs * 0.16, cs + 0.5, cs * 0.06);
      break;
    case 'forest':
      for (let i = 0; i < 3; i++) {
        const tx = x + cs * (0.25 + 0.5 * r(i + 80)), ty = y + cs * (0.3 + 0.45 * r(i + 90)), rr = cs * (0.17 + 0.07 * r(i + 95));
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(tx + rr * 0.3, ty + rr * 0.9, rr, rr * 0.4, 0, 0, 7); g.fill();
        g.fillStyle = '#4a3220'; g.fillRect(tx - cs * 0.02, ty, cs * 0.04, rr * 0.9);
        g.fillStyle = season === 2 ? '#8a5a22' : season === 3 ? '#2f4a35' : '#2f5a26'; g.beginPath(); g.arc(tx, ty, rr, 0, 7); g.fill();
        g.fillStyle = season === 2 ? 'rgba(240,170,70,0.4)' : 'rgba(150,200,90,0.35)'; g.beginPath(); g.arc(tx - rr * 0.3, ty - rr * 0.3, rr * 0.5, 0, 7); g.fill();
      }
      break;
    case 'hills':
      for (let i = 0; i < 2; i++) {
        const hx = x + cs * (0.3 + 0.4 * i), hy = y + cs * (0.65 - 0.2 * i);
        const grd = g.createLinearGradient(hx - cs * 0.3, hy - cs * 0.3, hx + cs * 0.3, hy);
        grd.addColorStop(0, '#8d9455'); grd.addColorStop(1, '#4e5a2e');
        g.fillStyle = grd; g.beginPath(); g.ellipse(hx, hy, cs * 0.32, cs * 0.22, 0, Math.PI, 0); g.fill();
      }
      break;
    case 'mountain': {
      g.fillStyle = '#4f4b48'; g.beginPath(); g.moveTo(x + cs * 0.05, y + cs * 0.92); g.lineTo(cx - cs * 0.05, y + cs * 0.12); g.lineTo(x + cs * 0.95, y + cs * 0.92); g.fill();
      g.fillStyle = '#7d7873'; g.beginPath(); g.moveTo(cx - cs * 0.05, y + cs * 0.12); g.lineTo(x + cs * 0.95, y + cs * 0.92); g.lineTo(cx + cs * 0.1, y + cs * 0.92); g.fill();
      g.fillStyle = '#eef2f5'; g.beginPath(); g.moveTo(cx - cs * 0.05, y + cs * 0.12); g.lineTo(cx - cs * 0.19, y + cs * 0.38); g.lineTo(cx, y + cs * 0.33); g.lineTo(cx + cs * 0.09, y + cs * 0.36); g.fill();
      break;
    }
    case 'water': case 'bridge': {
      g.strokeStyle = 'rgba(180,220,255,0.35)'; g.lineWidth = Math.max(1, cs / 30);
      for (let i = 0; i < 3; i++) { const wy = y + cs * (0.25 + 0.25 * i), wx = x + cs * r(i + 100) * 0.4; g.beginPath(); g.moveTo(wx, wy); g.quadraticCurveTo(wx + cs * 0.15, wy - cs * 0.06, wx + cs * 0.3, wy); g.stroke(); }
      if (t === 'bridge') {
        g.fillStyle = '#7a5532'; g.fillRect(x - 0.5, cy - cs * 0.3, cs + 1, cs * 0.6);
        g.strokeStyle = '#4e331c'; g.lineWidth = Math.max(1, cs / 32);
        for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(x + cs * i / 6, cy - cs * 0.3); g.lineTo(x + cs * i / 6, cy + cs * 0.3); g.stroke(); }
        g.fillStyle = '#5a3d22'; g.fillRect(x, cy - cs * 0.34, cs + 0.5, cs * 0.06); g.fillRect(x, cy + cs * 0.28, cs + 0.5, cs * 0.06);
      }
      break;
    }
    case 'marsh':
      for (let i = 0; i < 3; i++) { g.fillStyle = 'rgba(60,100,120,0.55)'; g.beginPath(); g.ellipse(x + cs * (0.2 + 0.6 * r(i + 110)), y + cs * (0.2 + 0.6 * r(i + 120)), cs * 0.14, cs * 0.07, 0, 0, 7); g.fill(); }
      g.strokeStyle = '#8a9a50'; g.lineWidth = Math.max(1, cs / 40);
      for (let i = 0; i < 5; i++) { const px = x + r(i + 130) * cs, py = y + cs * (0.4 + 0.5 * r(i + 140)); g.beginPath(); g.moveTo(px, py); g.lineTo(px + cs * 0.02, py - cs * 0.18); g.stroke(); }
      break;
    case 'village':
      for (let i = 0; i < 2; i++) {
        const hx = x + cs * (0.18 + 0.42 * i), hy = y + cs * (0.35 + 0.25 * r(i + 150));
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(hx + cs * 0.05, hy + cs * 0.3, cs * 0.34, cs * 0.06);
        g.fillStyle = '#c8b48a'; g.fillRect(hx, hy + cs * 0.1, cs * 0.32, cs * 0.22);
        g.fillStyle = season === 3 ? '#e8eef0' : '#9a6a3a'; g.beginPath(); g.moveTo(hx - cs * 0.04, hy + cs * 0.12); g.lineTo(hx + cs * 0.16, hy - cs * 0.04); g.lineTo(hx + cs * 0.36, hy + cs * 0.12); g.fill();
        g.fillStyle = '#3a2a1a'; g.fillRect(hx + cs * 0.12, hy + cs * 0.2, cs * 0.07, cs * 0.12);
      }
      break;
    case 'wall': case 'gate': case 'keep': {
      g.strokeStyle = 'rgba(40,35,30,0.55)'; g.lineWidth = Math.max(1, cs / 40);
      const rows = 4;
      for (let i = 0; i < rows; i++) {
        const yy = y + cs * i / rows;
        g.beginPath(); g.moveTo(x, yy); g.lineTo(x + cs, yy); g.stroke();
        for (let j = 0; j < 3; j++) { const xx = x + cs * (j / 3 + (i % 2) / 6); g.beginPath(); g.moveTo(xx, yy); g.lineTo(xx, yy + cs / rows); g.stroke(); }
      }
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x, y, cs, cs * 0.08);
      if (t === 'wall') {   // crenellations
        g.fillStyle = '#6a6358';
        for (let j = 0; j < 4; j++) g.fillRect(x + cs * (0.04 + j * 0.25), y, cs * 0.14, cs * 0.12);
      }
      if (t === 'gate') {
        g.fillStyle = '#3a2614'; g.beginPath(); g.moveTo(x + cs * 0.2, y + cs); g.lineTo(x + cs * 0.2, y + cs * 0.4); g.quadraticCurveTo(cx, y + cs * 0.1, x + cs * 0.8, y + cs * 0.4); g.lineTo(x + cs * 0.8, y + cs); g.fill();
        g.strokeStyle = '#1e140a'; for (let j = 1; j < 4; j++) { g.beginPath(); g.moveTo(x + cs * (0.2 + 0.15 * j), y + cs * 0.3); g.lineTo(x + cs * (0.2 + 0.15 * j), y + cs); g.stroke(); }
      }
      if (t === 'keep') {
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + cs * 0.12, y + cs * 0.12, cs * 0.76, cs * 0.76);
        g.fillStyle = '#9a9284'; g.fillRect(x + cs * 0.16, y + cs * 0.16, cs * 0.68, cs * 0.68);
      }
      break;
    }
  }
  if (season === 3 && t !== 'water' && t !== 'bridge') { g.fillStyle = 'rgba(235,242,250,0.28)'; g.fillRect(x, y, cs + 0.5, cs + 0.5); }
  if (season === 2) { g.fillStyle = 'rgba(200,120,30,0.08)'; g.fillRect(x, y, cs + 0.5, cs + 0.5); }
}

// Bust portrait for vassals without art: shoulders, head, house colours, initials.
function drawBust(g, x, y, w, h, col, acc, name, flip = false) {
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  const grd = g.createLinearGradient(x, y, x, y + h);
  grd.addColorStop(0, shade(col, -0.25)); grd.addColorStop(1, shade(col, -0.7));
  g.fillStyle = grd; g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(255,255,255,0.06)'; g.beginPath(); g.arc(x + w * 0.5, y + h * 0.35, w * 0.6, 0, 7); g.fill();
  const cx = x + w * (flip ? 0.52 : 0.48);
  g.fillStyle = shade(col, 0.1); g.beginPath(); g.ellipse(cx, y + h * 1.02, w * 0.48, h * 0.36, 0, Math.PI, 0); g.fill();
  g.fillStyle = acc; g.fillRect(cx - w * 0.06, y + h * 0.7, w * 0.12, h * 0.3);
  g.fillStyle = '#d9b48c'; g.beginPath(); g.ellipse(cx, y + h * 0.44, w * 0.17, h * 0.17, 0, 0, 7); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(cx, y + h * 0.33, w * 0.19, h * 0.1, 0, Math.PI, 0); g.fill();
  const initials = (name || '?').replace(/^(Lord|Lady|Queen|Prince|Chief|Ser|High Mother|Warden|Admiral|Count|Captain|Inquisitor|Sister|Pilgrim|Elder|Granny|Old|The|Big)\s+/i, '').split(/\s+/).map(s => s[0]).slice(0, 2).join('');
  g.fillStyle = 'rgba(255,240,210,0.85)'; g.font = `700 ${Math.round(h * 0.13)}px Cinzel, Georgia, serif`; g.textAlign = 'center';
  g.fillText(initials, x + w / 2, y + h * 0.95);
  g.restore();
}

function drawCrestFallback(g, x, y, s, col, acc, letter) {
  g.save();
  g.translate(x, y);
  g.beginPath(); g.moveTo(-s * 0.4, -s * 0.45); g.lineTo(s * 0.4, -s * 0.45); g.lineTo(s * 0.4, 0); g.quadraticCurveTo(s * 0.4, s * 0.38, 0, s * 0.5); g.quadraticCurveTo(-s * 0.4, s * 0.38, -s * 0.4, 0); g.closePath();
  const grd = g.createLinearGradient(0, -s * 0.45, 0, s * 0.5); grd.addColorStop(0, shade(col, 0.15)); grd.addColorStop(1, shade(col, -0.35));
  g.fillStyle = grd; g.fill(); g.lineWidth = Math.max(2, s * 0.05); g.strokeStyle = '#d8b05a'; g.stroke();
  g.fillStyle = acc; g.font = `900 ${Math.round(s * 0.42)}px Cinzel, Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(letter, 0, s * 0.02);
  g.restore();
}

// ------------------------------------------------------------------ the view

export async function runBattle(container, input, opts = {}) {
  const prefs = { cutins: 'full', speed: 1, sound: true, ...loadPrefs() };
  if (opts.cutins) prefs.cutins = opts.cutins;
  if (opts.speed) prefs.speed = opts.speed;
  sfx.muted = !prefs.sound;
  const seed = opts.seed ?? 1;
  const b = opts.state || createBattle(input, seed);
  const playerSide = opts.playerSide === undefined ? 'attacker' : opts.playerSide;
  const sideInfo = side => {
    const o = opts.houses && opts.houses[side];
    const hid = b.houses[side];
    const h = hid ? HOUSE_BY_ID[hid] : null;
    return { id: hid, name: o?.name || h?.short || NEUTRAL.short, full: o?.name || h?.name || NEUTRAL.name,
      color: o?.color || h?.color || NEUTRAL.color, accent: o?.accent || h?.accent || NEUTRAL.accent };
  };
  const S = { attacker: sideInfo('attacker'), defender: sideInfo('defender') };
  const province = PROVINCES[b.provinceId] || null;
  const vassalOf = u => (u.vassalId && VASSAL_BY_ID[u.vassalId]) || null;
  const isSpirit = u => u.kind === 'spirit';
  const unitName = u => vassalOf(u)?.name || (isSpirit(u) ? SPIRITS[u.type].name : u.kind === 'militia' ? 'Militia' : statsOf(u.type).name);
  // Short role line: leader title, "Leaderless", "Hired company", "Summoned spirit".
  const roleOf = u => isSpirit(u) ? 'Summoned spirit' : u.kind === 'company' ? 'Hired company' :
    u.kind === 'militia' ? 'Local militia' : vassalOf(u) ? vassalOf(u).title : 'Leaderless';
  const isRuler = u => u.ruler || (u.vassalId && b.houses[u.side] && HOUSE_BY_ID[b.houses[u.side]]?.ruler === u.vassalId);
  const portraitSlot = u => isSpirit(u) ? SPIRITS[u.type].art : (vassalOf(u)?.portrait ?? null);
  const spriteSlot = u => {
    const hs = houseTroopSprite(b.houses[u.side], u.type);
    if (hs && hasArt(hs)) return { slot: hs, tint: false };
    const s = statsOf(u.type).sprite;
    return s && hasArt(s) ? { slot: s, tint: true } : null;
  };
  const isAI = side => playerSide !== side || view.auto;

  // Preload real art only (placeholders are never drawn on the board).
  const want = new Set([BATTLE_FRAME, BATTLE_BACKDROP[b.terrain], ...Object.values(BATTLE_MOMENT), CREST[b.houses.attacker], CREST[b.houses.defender]]);
  if (b.weather) want.add(WEATHER_FX[b.weather]);
  for (const k of new Set(b.grid)) want.add(TERRAIN_TILE[k]);
  for (const u of b.units) { want.add(isSpirit(u) ? SPIRIT_CUTIN[u.type] : CLASH_CUTIN[u.type]); want.add(portraitSlot(u)); const s = spriteSlot(u); if (s) want.add(s.slot); }
  for (const side of ['attacker', 'defender']) if (b.spirit[side]) { want.add(SPIRIT_CUTIN[b.spirit[side]]); want.add(SPIRITS[b.spirit[side]].fx); want.add(SPIRITS[b.spirit[side]].art); }
  await Promise.all([...want].filter(s => s != null && hasArt(s)).map(s => loadImg(art(s))));

  // ---------------------------------------------------------------- DOM
  container.innerHTML = '';
  const root = el('div', 'bt-root');
  root.innerHTML = `
    <div class="bt-header">
      <div class="bt-side bt-side-a"><canvas class="bt-crest"></canvas><div><div class="bt-house"></div><div class="bt-total"></div></div></div>
      <div class="bt-mid"><div class="bt-turn"></div><div class="bt-round"></div></div>
      <div class="bt-side bt-side-d"><div class="bt-right"><div class="bt-house"></div><div class="bt-total"></div></div><canvas class="bt-crest"></canvas></div>
    </div>
    <div class="bt-main">
      <div class="bt-roster bt-roster-a"></div>
      <div class="bt-stage"><canvas class="bt-board"></canvas><div class="bt-tip" hidden></div><div class="bt-barks"></div><div class="bt-banner" hidden></div></div>
      <div class="bt-roster bt-roster-d"></div>
    </div>
    <div class="bt-bar">
      <button class="bt-btn bt-spirit" hidden><canvas width="40" height="40"></canvas><span></span></button>
      <button class="bt-btn bt-rotate" hidden title="Rotate (R)">&#8635; Rotate</button>
      <button class="bt-btn bt-hold" title="Hold this unit (H)">Hold</button>
      <button class="bt-btn bt-end bt-primary" title="End turn (E)">End Turn</button>
      <span class="bt-spacer"></span>
      <button class="bt-btn bt-auto" title="Let the AI command your side">Auto</button>
      <button class="bt-btn bt-speed" title="Animation speed">1x</button>
      <button class="bt-btn bt-cut" title="Cut-ins: full, short or off">Cut-ins: Full</button>
      <button class="bt-btn bt-sound" title="Sound effects">&#9835;</button>
      <button class="bt-btn bt-retreat bt-danger">Retreat</button>
    </div>
    <div class="bt-log"></div>
    <div class="bt-overlay" hidden><canvas class="bt-cutin"></canvas><div class="bt-skip">click to skip</div></div>
    <div class="bt-modal" hidden></div>`;
  container.appendChild(root);
  const $ = s => root.querySelector(s);
  const canvas = $('.bt-board'), stage = $('.bt-stage'), tip = $('.bt-tip');
  const g = canvas.getContext('2d');
  const overlay = $('.bt-overlay'), ocv = $('.bt-cutin'), og = ocv.getContext('2d');
  const modal = $('.bt-modal');

  // ---------------------------------------------------------------- state
  const view = {
    cs: 32, ox: 0, oy: 0, w: 0, h: 0, dpr: 1, staticBoard: null,
    disp: new Map(), particles: [], floats: [], projectiles: [], tweens: [], shake: 0,
    sel: null, hover: null, mode: 'idle', spellDir: 'right', spellAt: null, busy: false,
    auto: playerSide == null, cutin: null, fx: null, now: 0, alive: true, lastStand: new Set(),
    banner: null, weatherT: 0,
    P: new Particles({ unit: 32, max: 700 }), reduced: reducedMotion(),
    hitStopUntil: 0, slowUntil: 0, pulse: 0, pulseCol: '200,40,30', spell: null, whiteout: 0, whiteCol: '255,250,235',
  };
  for (const u of b.units) view.disp.set(u.id, {
    x: u.x, y: u.y, alpha: u.out ? 0 : 1, flash: 0, phase: hash(u.x, u.y, 7) * 6.28, lunge: null,
    shown: u.soldiers, facing: u.side === 'attacker' ? 1 : -1, walking: false, walkPh: 0, act: null, recoil: null,
    squad: null, flee: false, rim: null,
  });
  const pals = { attacker: palette(S.attacker.color, S.attacker.accent), defender: palette(S.defender.color, S.defender.accent) };
  const rims = { attacker: shade(S.attacker.color, 0.5), defender: shade(S.defender.color, 0.5) };
  // Juice helpers (disabled with prefers-reduced-motion).
  const shakeBy = v => { if (!view.reduced) view.shake = Math.min(16, Math.max(view.shake, v)); };
  const hitStop = ms => { if (!view.reduced) view.hitStopUntil = Math.max(view.hitStopUntil, performance.now() + ms); };
  const slowMo = ms => { if (!view.reduced) view.slowUntil = Math.max(view.slowUntil, performance.now() + ms); };
  const pulse = (a, col = '200,40,30') => { view.pulse = Math.max(view.pulse, a); view.pulseCol = col; };

  // When the player hands the battle to Auto, play it faster with short cut-ins.
  const autoHurry = () => view.auto && playerSide != null;
  const speed = () => prefs.speed * (autoHurry() ? 3 : 1);
  const cutMode = () => (autoHurry() && prefs.cutins === 'full' ? 'short' : prefs.cutins);
  function tween(ms, fn) {
    return new Promise(res => view.tweens.push({ t0: view.now, dur: Math.max(1, ms / speed()), fn, res }));
  }
  const wait = ms => tween(ms, () => {});

  // ---------------------------------------------------------------- layout
  function layout() {
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    view.dpr = dpr;
    view.w = Math.max(200, r.width); view.h = Math.max(160, r.height);
    canvas.width = Math.round(view.w * dpr); canvas.height = Math.round(view.h * dpr);
    canvas.style.width = view.w + 'px'; canvas.style.height = view.h + 'px';
    const margin = Math.max(10, Math.min(view.w, view.h) * 0.035);
    const cs = Math.floor(Math.min((view.w - margin * 2) / W, (view.h - margin * 2) / H));
    view.cs = Math.max(12, cs);
    view.ox = Math.round((view.w - view.cs * W) / 2); view.oy = Math.round((view.h - view.cs * H) / 2);
    view.P.unit = view.cs;
    buildStatic();
    const ro = root.getBoundingClientRect();
    ocv.width = Math.round(ro.width * dpr); ocv.height = Math.round(ro.height * dpr);
    ocv.style.width = ro.width + 'px'; ocv.style.height = ro.height + 'px';
  }

  function buildStatic() {
    const { cs, dpr } = view;
    const c = document.createElement('canvas');
    c.width = Math.round(cs * W * dpr); c.height = Math.round(cs * H * dpr);
    const sg = c.getContext('2d'); sg.scale(dpr, dpr);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = b.grid[y * W + x];
      const im = artImg(TERRAIN_TILE[t]);
      if (im && t !== 'keep') {
        sg.drawImage(im, x * cs, y * cs, cs + 0.5, cs + 0.5);
        if (b.season === 3) { sg.fillStyle = 'rgba(235,242,250,0.22)'; sg.fillRect(x * cs, y * cs, cs + 0.5, cs + 0.5); }
      } else drawTerrainCell(sg, t, x * cs, y * cs, cs, x, y, b.season);
    }
    // soft grid
    sg.strokeStyle = 'rgba(0,0,0,0.13)'; sg.lineWidth = 1;
    for (let x = 1; x < W; x++) { sg.beginPath(); sg.moveTo(x * cs + 0.5, 0); sg.lineTo(x * cs + 0.5, H * cs); sg.stroke(); }
    for (let y = 1; y < H; y++) { sg.beginPath(); sg.moveTo(0, y * cs + 0.5); sg.lineTo(W * cs, y * cs + 0.5); sg.stroke(); }
    // keep banner
    const kx = OBJ.x * cs + cs / 2, ky = OBJ.y * cs + cs / 2;
    sg.strokeStyle = '#3a2a1a'; sg.lineWidth = Math.max(2, cs / 16); sg.beginPath(); sg.moveTo(kx, ky + cs * 0.3); sg.lineTo(kx, ky - cs * 0.42); sg.stroke();
    sg.fillStyle = S.defender.color; sg.beginPath(); sg.moveTo(kx, ky - cs * 0.42); sg.lineTo(kx + cs * 0.32, ky - cs * 0.32); sg.lineTo(kx, ky - cs * 0.2); sg.fill();
    // vignette
    const vg = sg.createRadialGradient(cs * W / 2, cs * H / 2, cs * 4, cs * W / 2, cs * H / 2, cs * W * 0.65);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.35)');
    sg.fillStyle = vg; sg.fillRect(0, 0, cs * W, cs * H);
    view.staticBoard = c;
  }

  const px = (cx, cy) => ({ x: view.ox + (cx + 0.5) * view.cs, y: view.oy + (cy + 0.5) * view.cs });

  // ---------------------------------------------------------------- drawing
  function drawBackdrop() {
    const im = artImg(BATTLE_BACKDROP[b.terrain]);
    if (im) {
      drawCover(g, im, 0, 0, view.w, view.h, 1.05 + Math.sin(view.now / 9000) * 0.02);
      g.fillStyle = 'rgba(10,8,14,0.45)'; g.fillRect(0, 0, view.w, view.h);
      return;
    }
    const sky = g.createLinearGradient(0, 0, 0, view.h);
    const top = { 0: '#3a4d6a', 1: '#3b5c80', 2: '#5a3e3a', 3: '#4a5566' }[b.season] || '#2d2a3a';
    sky.addColorStop(0, top); sky.addColorStop(0.55, '#1a1620'); sky.addColorStop(1, '#0d0b10');
    g.fillStyle = sky; g.fillRect(0, 0, view.w, view.h);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath(); g.moveTo(0, view.h * 0.35);
    for (let i = 0; i <= 12; i++) g.lineTo(view.w * i / 12, view.h * (0.28 + 0.08 * hash(i, 3, 1)));
    g.lineTo(view.w, view.h); g.lineTo(0, view.h); g.fill();
  }

  function drawFrame() {
    const { ox, oy, cs } = view;
    const bw = cs * W, bh = cs * H;
    const im = artImg(BATTLE_FRAME);
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = 24; g.fillStyle = '#000'; g.fillRect(ox, oy, bw, bh);
    g.restore();
    g.drawImage(view.staticBoard, ox, oy, bw, bh);
    if (im) {
      const m = cs * 0.55;
      g.drawImage(im, ox - m, oy - m, bw + m * 2, bh + m * 2);
    } else {
      g.strokeStyle = '#8a6a2a'; g.lineWidth = 5; g.strokeRect(ox - 4, oy - 4, bw + 8, bh + 8);
      g.strokeStyle = '#e0bb62'; g.lineWidth = 1.5; g.strokeRect(ox - 6.5, oy - 6.5, bw + 13, bh + 13);
      g.strokeStyle = 'rgba(224,187,98,0.4)'; g.strokeRect(ox - 1.5, oy - 1.5, bw + 3, bh + 3);
      g.fillStyle = '#e0bb62';
      for (const [cx, cy] of [[ox, oy], [ox + bw, oy], [ox, oy + bh], [ox + bw, oy + bh]]) {
        g.save(); g.translate(cx, cy); g.rotate(Math.PI / 4); g.fillRect(-6, -6, 12, 12); g.fillStyle = '#5a4012'; g.fillRect(-3, -3, 6, 6); g.restore(); g.fillStyle = '#e0bb62';
      }
    }
  }

  function drawTempWalls() {
    const { cs } = view;
    for (const w of b.tempWalls) {
      const p = px(w.x, w.y);
      if (!w.born) w.born = view.now;
      const rise = clamp((view.now - w.born) / 260, 0, 1);
      if (rise <= 0) continue;
      g.save(); g.translate(p.x, p.y + cs * 0.35);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(0, 0, cs * 0.45, cs * 0.14, 0, 0, 7); g.fill();
      const hgt = cs * 0.75 * easeOut(rise);
      const grd = g.createLinearGradient(0, -hgt, 0, 0); grd.addColorStop(0, '#c9a56a'); grd.addColorStop(1, '#6a5232');
      g.fillStyle = grd;
      g.beginPath(); g.moveTo(-cs * 0.4, 0); g.lineTo(-cs * 0.3, -hgt); g.lineTo(cs * 0.05, -hgt * 1.08); g.lineTo(cs * 0.32, -hgt * 0.95); g.lineTo(cs * 0.42, 0); g.fill();
      g.strokeStyle = 'rgba(255,220,150,0.5)'; g.lineWidth = 1; g.stroke();
      g.restore();
    }
  }

  function drawOverlays() {
    const { cs } = view;
    // objective glow
    const op = px(OBJ.x, OBJ.y);
    g.strokeStyle = `rgba(255,215,120,${0.35 + 0.25 * Math.sin(view.now / 300)})`; g.lineWidth = 2;
    g.strokeRect(op.x - cs / 2 + 2, op.y - cs / 2 + 2, cs - 4, cs - 4);
    const sel = view.sel && getUnit(b, view.sel);
    if (view.mode === 'spell' && view.spellAt) {
      const side = b.side, sp = SPIRITS[b.spirit[side]];
      for (const c of spellCells(b, side, view.spellAt, view.spellDir)) {
        const p = px(c.x, c.y);
        g.fillStyle = rgba(sp.color, 0.3 + 0.15 * Math.sin(view.now / 150)); g.fillRect(p.x - cs / 2, p.y - cs / 2, cs, cs);
        g.strokeStyle = rgba(sp.color, 0.9); g.lineWidth = 1.5; g.strokeRect(p.x - cs / 2 + 1, p.y - cs / 2 + 1, cs - 2, cs - 2);
      }
    } else if (sel && !view.busy && sel.side === b.side && !isAI(b.side)) {
      for (const c of legalMoves(b, sel)) {
        const p = px(c.x, c.y);
        g.fillStyle = 'rgba(90,160,255,0.22)'; g.fillRect(p.x - cs / 2 + 1, p.y - cs / 2 + 1, cs - 2, cs - 2);
        g.strokeStyle = 'rgba(140,200,255,0.55)'; g.lineWidth = 1; g.strokeRect(p.x - cs / 2 + 1.5, p.y - cs / 2 + 1.5, cs - 3, cs - 3);
      }
      for (const id of legalTargets(b, sel)) {
        const t = getUnit(b, id), p = px(t.x, t.y);
        const pulse = 0.5 + 0.5 * Math.sin(view.now / 160);
        g.strokeStyle = `rgba(255,80,60,${0.6 + 0.4 * pulse})`; g.lineWidth = 2.5;
        g.beginPath(); g.arc(p.x, p.y, cs * (0.38 + 0.04 * pulse), 0, 7); g.stroke();
        for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; g.beginPath(); g.moveTo(p.x + Math.cos(a) * cs * 0.3, p.y + Math.sin(a) * cs * 0.3); g.lineTo(p.x + Math.cos(a) * cs * 0.5, p.y + Math.sin(a) * cs * 0.5); g.stroke(); }
        // expected kills hint
        const k = Math.round(expectedKills(b, sel, t));
        g.font = `700 ${Math.max(10, cs * 0.26)}px Cinzel, Georgia, serif`; g.textAlign = 'center';
        g.fillStyle = 'rgba(0,0,0,0.7)'; g.fillText('~' + k, p.x + 1, p.y - cs * 0.48 + 1); g.fillStyle = '#ffb4a0'; g.fillText('~' + k, p.x, p.y - cs * 0.48);
      }
    }
    if (view.hover && !view.busy) {
      const p = px(view.hover.x, view.hover.y);
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1; g.strokeRect(p.x - cs / 2 + 0.5, p.y - cs / 2 + 0.5, cs - 1, cs - 1);
    }
  }

  // ---- squads: 1-6 remastered figures per unit by strength, each with its own life
  function squadOf(u, d) {
    const N = squadSize(u.type);
    const want = clamp(Math.round(N * d.shown / u.start), d.shown > 0 ? 1 : 0, N);
    if (!d.squad) {
      d.squad = formation(N).map((pos, i) => ({ pos, i, dieT: null, ph: hash(i, u.x + u.y, 3) * 6.28 }));
      d.squad.forEach((f, i) => { if (i >= want) f.dieT = -1e9; });
    }
    const alive = d.squad.filter(f => f.dieT == null);
    if (alive.length > want) {   // the front ranks fall first, staggered
      const drop = alive.slice(0, alive.length - want);
      drop.forEach((f, j) => { f.dieT = view.now + j * 70; });
    }
    return d.squad;
  }

  function figPose(u, d, f, t) {
    if (f.dieT != null && view.now >= f.dieT) return { act: 'fall', k: clamp((view.now - f.dieT) / 900, 0, 1), t };
    if (d.flee) return { act: 'flee', walk: d.walkPh * 1.4 + f.ph, t, run: true };
    if (d.act) {
      const st = d.act.t0 + f.i * (d.act.stagger ?? 55);
      const k = clamp((view.now - st) / d.act.len, 0, 1);
      if (view.now >= st && k < 1) return { act: d.act.name, k, t };
    }
    if (d.walking) return { act: 'idle', walk: d.walkPh + f.ph * 0.3, t, run: d.run };
    return { act: 'idle', t: t + f.ph };
  }

  function drawUnit(u, d) {
    const { cs } = view;
    if (d.alpha <= 0.01) return;
    const base = { x: view.ox + (d.x + 0.5) * cs, y: view.oy + (d.y + 0.5) * cs };
    let lx = 0, ly = 0;
    if (d.lunge) { const k = Math.sin(Math.PI * d.lunge.p); lx = d.lunge.dx * k * cs * (d.lunge.reach ?? 0.3); ly = d.lunge.dy * k * cs * (d.lunge.reach ?? 0.3); }
    if (d.recoil) { const k = d.recoil.p; lx += d.recoil.dx * Math.sin(Math.PI * k) * cs * d.recoil.amt; ly += d.recoil.dy * Math.sin(Math.PI * k) * cs * d.recoil.amt; }
    const cx = base.x + lx, cy = base.y + ly;
    const facing = d.facing;
    const done = !u.out && u.side === b.side && (u.acted) && !isAI(u.side);
    g.save();
    g.globalAlpha = d.alpha * (done ? 0.72 : 1);
    if (view.sel === u.id) {
      g.strokeStyle = `rgba(255,215,110,${0.7 + 0.3 * Math.sin(view.now / 140)})`; g.lineWidth = 2.5;
      g.beginPath(); g.ellipse(cx, cy + cs * 0.32, cs * 0.46, cs * 0.17, 0, 0, 7); g.stroke();
    }
    // house-coloured ground disc
    g.fillStyle = rgba(S[u.side].color, 0.4); g.beginPath(); g.ellipse(cx, cy + cs * 0.32, cs * 0.38, cs * 0.11, 0, 0, 7); g.fill();
    const t = view.now / 1000;
    if (isSpirit(u)) drawSpiritUnit(u, cx, cy, d, t);
    const sprite = !isSpirit(u) && spriteSlot(u);
    const im = sprite && artImg(sprite.slot);
    if (!isSpirit(u)) {
      const squad = squadOf(u, d);
      const n = squad.length;
      const s = cs * (n >= 5 ? 0.54 : n >= 3 ? 0.58 : n === 2 ? 0.64 : 0.72) * (u.type === 'siege' || u.type === 'bombards' ? 0.95 : 1);
      const order = squad.slice().sort((p, q) => p.pos[1] - q.pos[1]);
      // soft shadows first
      for (const f of order) {
        if (f.dieT != null && view.now - f.dieT > 900) continue;
        const fx = cx + f.pos[0] * cs * facing, fy = cy + f.pos[1] * cs + cs * 0.24;
        const r = s * (MOUNTED.has(u.type) || u.type === 'siege' ? 0.5 : 0.28);
        g.globalAlpha = d.alpha * 0.4 * (f.dieT != null && view.now > f.dieT ? clamp(1 - (view.now - f.dieT) / 900, 0, 1) : 1);
        g.drawImage(blob(0, 0, 0), fx - r, fy - r * 0.3, r * 2, r * 0.6);
      }
      g.globalAlpha = d.alpha * (done ? 0.72 : 1);
      for (const f of order) {
        if (f.dieT != null && view.now - f.dieT > 900) continue;
        const pose = figPose(u, d, f, t);
        const fx = cx + f.pos[0] * cs * facing, fy = cy + f.pos[1] * cs + cs * 0.24;
        if (im) {
          const src = sprite.tint ? tinted(im, S[u.side].color, sprite.slot) : im;
          const ss = cs * (n === 1 ? 1.0 : 0.7);
          g.save(); g.translate(fx, fy); g.scale(facing, 1);
          if (pose.act === 'fall') { g.rotate(-pose.k * 1.4); g.globalAlpha *= 1 - pose.k; }
          g.drawImage(src, -ss / 2, -ss * 0.92, ss, ss); g.restore();
        } else blitFigure(g, u.type, pals[u.side], fx, fy, s, facing, pose, rims[u.side]);
      }
    }
    // banner on the lead (leaderless units carry a plain pennant: grey cloth)
    const bx = cx - cs * 0.36 * facing, by = cy - cs * 0.46;
    if (!isSpirit(u) && !d.flee) {
      g.strokeStyle = '#2a1d10'; g.lineWidth = Math.max(1.2, cs / 28);
      g.beginPath(); g.moveTo(bx, by + cs * 0.6); g.lineTo(bx, by); g.stroke();
      const wave = Math.sin(t * 4 + d.phase) * cs * 0.04, wave2 = Math.sin(t * 4 + d.phase + 1.4) * cs * 0.03;
      g.fillStyle = S[u.side].color; g.beginPath(); g.moveTo(bx, by); g.quadraticCurveTo(bx + cs * 0.12 * facing, by - wave, bx + cs * 0.26 * facing, by + cs * 0.04 + wave2);
      g.lineTo(bx + cs * 0.22 * facing, by + cs * 0.13 + wave2); g.quadraticCurveTo(bx + cs * 0.1 * facing, by + cs * 0.15 + wave, bx, by + cs * 0.17); g.fill();
      if (!u.leader && u.kind !== 'company') { g.fillStyle = 'rgba(20,16,24,0.55)'; g.fill(); }
      g.strokeStyle = S[u.side].accent; g.lineWidth = 1; g.stroke();
    }
    if (isRuler(u)) { g.fillStyle = '#ffd66e'; g.font = `${Math.max(8, cs * 0.22)}px serif`; g.textAlign = 'center'; g.fillText('♛', bx + cs * 0.1 * facing, by - cs * 0.04); }
    // hit flash
    if (d.flash > 0) {
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = d.flash * 0.7;
      const r = cs * 0.6; g.drawImage(blob(255, 235, 210), cx - r, cy - r, r * 2, r * 2); g.globalCompositeOperation = 'source-over';
      g.globalAlpha = d.alpha;
    }
    if (d.flee) { g.restore(); return; }
    // strength bar + count
    const frac = d.shown / u.start;
    const bw = cs * 0.78, bh = Math.max(3, cs * 0.08), bxx = cx - bw / 2, byy = cy + cs * 0.42;
    g.fillStyle = 'rgba(0,0,0,0.65)'; g.fillRect(bxx - 1, byy - 1, bw + 2, bh + 2);
    g.fillStyle = frac > 0.6 ? '#7fcf6a' : frac > 0.35 ? '#e6c04a' : '#e0564a'; g.fillRect(bxx, byy, bw * clamp(frac, 0, 1), bh);
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(bxx + bw * routAt(u), byy, 1, bh);   // rout line (30% led, 40% leaderless)
    const fs = Math.max(9, Math.round(cs * 0.24));
    g.font = `700 ${fs}px Cinzel, Georgia, serif`; g.textAlign = 'center';
    const label = String(d.shown), tw = g.measureText(label).width + 6;
    const tx = cx + cs * 0.12 * facing, ty = cy - cs * 0.5;
    g.fillStyle = 'rgba(15,12,18,0.85)'; g.beginPath(); g.roundRect(tx - tw / 2, ty - fs * 0.8, tw, fs * 1.05, 3); g.fill();
    g.strokeStyle = rgba(S[u.side].color, 0.9); g.lineWidth = 1; g.stroke();
    g.fillStyle = '#f5ead0'; g.fillText(label, tx, ty);
    // status: slowed (water drops), confused (spinning stars)
    if (u.slowed && !u.out) { for (let i = 0; i < 3; i++) { const a = t * 2 + i * 2.1; g.fillStyle = 'rgba(110,190,255,0.85)'; g.beginPath(); g.arc(cx + Math.cos(a) * cs * 0.3, cy + cs * 0.3 + Math.sin(a) * cs * 0.06, cs * 0.04, 0, 7); g.fill(); } }
    if (u.confused && !u.out) {
      for (let i = 0; i < 3; i++) {
        const a = t * 3.2 + i * 2.09, x = cx + Math.cos(a) * cs * 0.3, y = cy - cs * 0.52 + Math.sin(a) * cs * 0.08;
        g.save(); g.translate(x, y); g.rotate(t * 4 + i); g.fillStyle = i % 2 ? '#ffe680' : '#c9a0ff';
        g.beginPath(); for (let j = 0; j < 10; j++) { const r = j % 2 ? cs * 0.035 : cs * 0.08, aa = j * Math.PI / 5; j ? g.lineTo(Math.cos(aa) * r, Math.sin(aa) * r) : g.moveTo(Math.cos(aa) * r, Math.sin(aa) * r); } g.fill(); g.restore();
      }
    }
    g.restore();
  }

  // A summoned spirit on the board: the animated creature, floating over its square.
  function drawSpiritUnit(u, cx, cy, d, t) {
    const { cs } = view, sp = SPIRITS[u.type];
    const fly = u.type === 'gale' || u.type === 'dusk';
    const fy = cy - cs * (fly ? 0.45 : 0.3) + Math.sin(t * 1.8 + d.phase) * cs * 0.06;
    g.save();
    g.globalAlpha *= 0.4; g.drawImage(blob(0, 0, 0), cx - cs * 0.5, cy + cs * 0.22, cs, cs * 0.25); g.restore();
    drawSpirit(g, u.type, cx, fy, cs * (u.type === 'tide' ? 1.5 : 1.35), t + d.phase, { facing: d.facing, run: d.walking ? 1 : 0 });
    if (b.spiritUsed[u.side]) { g.strokeStyle = 'rgba(255,255,255,0.25)'; g.setLineDash([3, 3]); g.beginPath(); g.arc(cx, fy, cs * 0.62, 0, 7); g.stroke(); g.setLineDash([]); }
    void sp;
  }

  // Projectiles: arrows/bolts/thorns with faint trails, bullets as streaks, burning stones and
  // iron balls with a ground shadow. Each lands once (onLand) and is then removed.
  function drawProjectiles() {
    const now = view.now, cs = view.cs;
    view.projectiles = view.projectiles.filter(p => {
      if (now < p.t0) return true;
      const k = clamp((now - p.t0) / p.dur, 0, 1);
      const pos = kk => ({ x: lerp(p.a.x, p.b.x, kk), y: lerp(p.a.y, p.b.y, kk) - Math.sin(Math.PI * kk) * p.arc });
      const c = pos(k), q = pos(Math.max(0, k - 0.06));
      const ang = Math.atan2(c.y - q.y, c.x - q.x);
      if (p.kind === 'stone' || p.kind === 'ball') {
        const gx = lerp(p.a.x, p.b.x, k), gy = lerp(p.a.y, p.b.y, k) + cs * 0.3;
        g.save(); g.globalAlpha = 0.25 + 0.2 * k; const r = cs * (0.12 + 0.1 * (1 - Math.sin(Math.PI * k))); g.drawImage(blob(0, 0, 0), gx - r, gy - r * 0.4, r * 2, r * 0.8); g.restore();
        if (p.kind === 'stone' && Math.random() < 0.8) view.P.fire(c.x, c.y, 1, 0.16);
        if (Math.random() < 0.4) view.P.smoke(c.x, c.y, 1, 0.22, p.kind === 'ball' ? 100 : 50, 0);
        g.fillStyle = p.kind === 'stone' ? '#5a524a' : '#1e2024'; g.beginPath(); g.arc(c.x, c.y, cs * (p.kind === 'stone' ? 0.11 : 0.08), 0, 7); g.fill();
        if (p.kind === 'stone') { g.save(); g.globalCompositeOperation = 'lighter'; const r2 = cs * 0.3; g.drawImage(blob(255, 140, 40), c.x - r2, c.y - r2, r2 * 2, r2 * 2); g.restore(); }
      } else if (p.kind === 'bullet') {
        g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = 'rgba(255,230,170,0.95)'; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(c.x, c.y); g.lineTo(c.x - Math.cos(ang) * cs * 0.4, c.y - Math.sin(ang) * cs * 0.4); g.stroke(); g.restore();
      } else {
        g.save();
        g.strokeStyle = 'rgba(255,255,235,0.16)'; g.lineWidth = 1.2;
        const tq = pos(Math.max(0, k - 0.15));
        g.beginPath(); g.moveTo(tq.x, tq.y); g.lineTo(c.x, c.y); g.stroke();
        g.translate(c.x, c.y); g.rotate(ang);
        const L = cs * (p.kind === 'bolt' ? 0.2 : 0.28);
        g.strokeStyle = p.kind === 'thorn' ? '#7ad060' : '#e8dcc0'; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(-L, 0); g.lineTo(0, 0); g.stroke();
        g.fillStyle = p.kind === 'thorn' ? '#b0ff90' : '#cdd1d6'; g.beginPath(); g.moveTo(cs * 0.06, 0); g.lineTo(-cs * 0.01, -cs * 0.03); g.lineTo(-cs * 0.01, cs * 0.03); g.fill();
        if (p.kind === 'arrow') { g.fillStyle = '#c84040'; g.fillRect(-L, -cs * 0.025, cs * 0.05, cs * 0.05); }
        g.restore();
      }
      if (k >= 1) { if (p.onLand) p.onLand(p); return false; }
      return true;
    });
  }

  function spawn(n, f) { for (let i = 0; i < n; i++) view.particles.push(f(i)); }
  function drawParticles(dt) {
    view.particles = view.particles.filter(p => {
      p.life -= dt;
      if (p.life <= 0) return false;
      p.vy += (p.grav || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      const a = clamp(p.life / p.max, 0, 1);
      g.save();
      g.globalCompositeOperation = p.add ? 'lighter' : 'source-over';
      g.globalAlpha = a * (p.alpha ?? 1);
      g.fillStyle = p.color;
      if (p.kind === 'streak') { g.strokeStyle = p.color; g.lineWidth = p.size; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); g.stroke(); }
      else if (p.kind === 'puff') { const r = p.size * (1.6 - a); const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r); gr.addColorStop(0, p.color); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, r, 0, 7); g.fill(); }
      else if (p.kind === 'rock') { g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); }
      else { g.beginPath(); g.arc(p.x, p.y, p.size * (0.5 + a * 0.5), 0, 7); g.fill(); }
      g.restore();
      return true;
    });
  }
  function drawFloats(dt) {
    view.floats = view.floats.filter(f => {
      f.life -= dt;
      if (f.life <= 0) return false;
      const k = 1 - f.life / f.max;
      const y = f.y - easeOut(k) * view.cs * 0.8;
      g.save(); g.globalAlpha = clamp(f.life / (f.max * 0.4), 0, 1);
      g.font = `900 ${Math.round(view.cs * (f.big ? 0.48 : 0.34) * (1 + 0.3 * Math.max(0, 0.2 - k) * 5))}px Cinzel, Georgia, serif`;
      g.textAlign = 'center'; g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.8)'; g.strokeText(f.text, f.x, y);
      g.fillStyle = f.color; g.fillText(f.text, f.x, y);
      g.restore();
      return true;
    });
  }
  const floatText = (cx, cy, text, color, big = false) => { const p = px(cx, cy); view.floats.push({ x: p.x, y: p.y - view.cs * 0.2, text, color, big, life: 1.2, max: 1.2 }); };

  // Weather: painted layer (if any) plus particles.
  const weatherParts = [];
  function drawWeather(dt) {
    if (!b.weather) return;
    const { w, h } = view;
    const im = artImg(WEATHER_FX[b.weather]);
    view.weatherT += dt;
    if (im) {
      g.save(); g.globalCompositeOperation = 'screen'; g.globalAlpha = b.weather === 'fog' ? 0.35 : 0.45;
      const s = Math.max(w, h) * 0.8;
      const offX = (view.weatherT * (b.weather === 'rain' ? 60 : b.weather === 'snow' ? 18 : 10)) % s;
      const offY = (view.weatherT * (b.weather === 'rain' ? 380 : b.weather === 'snow' ? 40 : 0)) % s;
      for (let x = -s; x < w + s; x += s) for (let y = -s; y < h + s; y += s) g.drawImage(im, x + offX, y + offY, s, s);
      g.restore();
    }
    const want = b.weather === 'rain' ? 140 : b.weather === 'snow' ? 110 : 10;
    while (weatherParts.length < want) weatherParts.push({ x: Math.random() * w, y: Math.random() * h, s: Math.random() });
    g.save();
    for (const p of weatherParts) {
      if (b.weather === 'rain') {
        p.x += dt * (80 + p.s * 40); p.y += dt * (600 + p.s * 300);
        g.strokeStyle = `rgba(190,210,240,${0.25 + p.s * 0.3})`; g.lineWidth = 1;
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - 4, p.y - 16 - p.s * 8); g.stroke();
      } else if (b.weather === 'snow') {
        p.x += dt * (Math.sin(view.weatherT + p.s * 10) * 20 + 10); p.y += dt * (30 + p.s * 40);
        g.fillStyle = `rgba(255,255,255,${0.5 + p.s * 0.4})`; g.beginPath(); g.arc(p.x, p.y, 1 + p.s * 2.2, 0, 7); g.fill();
      } else {
        p.x += dt * (8 + p.s * 10);
        const r = Math.max(w, h) * (0.18 + p.s * 0.15);
        const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        gr.addColorStop(0, 'rgba(210,220,215,0.16)'); gr.addColorStop(1, 'rgba(210,220,215,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, r, 0, 7); g.fill();
      }
      if (p.y > h + 20) { p.y = -20; p.x = Math.random() * w; }
      if (p.x > w + (b.weather === 'fog' ? 300 : 20)) { p.x = b.weather === 'fog' ? -300 : -20; }
    }
    g.restore();
  }

  function drawSpellFx() {
    const fx = view.fx;
    if (!fx) return;
    const k = clamp((view.now - fx.t0) / fx.dur, 0, 1);
    const sp = SPIRITS[fx.spirit];
    const im = artImg(sp.fx);
    const a = Math.sin(Math.PI * k);
    g.save();
    g.globalCompositeOperation = 'screen';
    for (const c of fx.cells) {
      const p = px(c.x, c.y), s = view.cs * (1.3 + 0.3 * k);
      g.globalAlpha = a;
      if (im) g.drawImage(im, p.x - s / 2, p.y - s / 2, s, s);
      else {
        const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, s * 0.6);
        gr.addColorStop(0, rgba(sp.color, 0.95)); gr.addColorStop(1, rgba(sp.color, 0));
        g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, s * 0.6, 0, 7); g.fill();
      }
    }
    g.restore();
    if (fx.bolts) {
      g.save(); g.globalCompositeOperation = 'lighter';
      for (const c of fx.cells) {
        if (Math.random() > 0.35) continue;
        const p = px(c.x, c.y);
        g.strokeStyle = 'rgba(220,235,255,0.95)'; g.lineWidth = 2.5; g.shadowColor = '#bcd4ff'; g.shadowBlur = 14;
        g.beginPath(); let x = p.x + (Math.random() - 0.5) * 40, y = 0; g.moveTo(x, y);
        while (y < p.y) { y += 18 + Math.random() * 20; x += (Math.random() - 0.5) * 26; g.lineTo(y > p.y ? p.x : x, Math.min(y, p.y)); }
        g.stroke();
      }
      g.restore();
    }
    if (k >= 1) view.fx = null;
  }

  // ---------------------------------------------------------------- cut-ins (overlay canvas)
  function drawCutin(dt) {
    const c = view.cutin;
    if (!c) return;
    const W2 = ocv.width / view.dpr, H2 = ocv.height / view.dpr;
    og.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    og.clearRect(0, 0, W2, H2);
    if (c.scene) {   // fixed 60 Hz choreography, rendered with interpolation
      c.acc += dt * speed();
      let n = 0;
      while (c.acc >= 1 / 60 && n++ < 8) { c.scene.step(); c.fx.update(); c.acc -= 1 / 60; }
      const f = c.scene.f, L = c.scene.length;
      const open = f < 9 ? easeOut(f / 9) : f > L - 9 ? easeOut(Math.max(0, L - f) / 9) : 1;
      c.fx.render(og, W2, H2, clamp(c.acc * 60, 0, 1), open);
      if (c.scene.done || c.skip) { view.cutin = null; overlay.hidden = true; c.res(); }
      return;
    }
    const k = clamp((view.now - c.t0) / c.dur, 0, 1);
    c.draw(og, W2, H2, k, dt);
    if (k >= 1 || c.skip) { view.cutin = null; overlay.hidden = true; c.res(); }
  }

  function showCutin(dur, draw) {
    return new Promise(res => {
      overlay.hidden = false;
      view.cutin = { t0: view.now, dur: dur / speed(), draw, res, skip: false, parts: [] };
    });
  }
  overlay.addEventListener('pointerdown', e => { e.preventDefault(); if (view.cutin) view.cutin.skip = true; });

  // strip geometry for clash cut-ins: a wide band across the middle
  function band(W2, H2, k, inT = 0.12, outT = 0.12) {
    const bh = Math.min(H2 * 0.62, W2 * 0.48);
    const open = k < inT ? easeOut(k / inT) : k > 1 - outT ? easeOut((1 - k) / outT) : 1;
    return { y: H2 / 2 - bh / 2 * open, h: bh * open, full: bh, open };
  }

  function portraitCard(cg, u, x, y, w, h, side, flip) {
    const slot = portraitSlot(u);
    const im = artImg(slot);
    cg.save();
    cg.shadowColor = 'rgba(0,0,0,0.6)'; cg.shadowBlur = 18;
    cg.fillStyle = '#100c14'; cg.fillRect(x - 4, y - 4, w + 8, h + 8);
    cg.shadowBlur = 0;
    if (im) { cg.save(); cg.beginPath(); cg.rect(x, y, w, h); cg.clip(); if (flip) { cg.translate(x * 2 + w, 0); cg.scale(-1, 1); } drawCover(cg, im, x, y, w, h); cg.restore(); }
    else if (u.vassalId) drawBust(cg, x, y, w, h, S[side].color, S[side].accent, unitName(u), flip);
    else if (isSpirit(u)) {
      const sp = SPIRITS[u.type];
      const grd = cg.createRadialGradient(x + w / 2, y + h * 0.45, 0, x + w / 2, y + h * 0.45, h * 0.7);
      grd.addColorStop(0, rgba(sp.color, 0.6)); grd.addColorStop(1, '#0c0912');
      cg.fillStyle = grd; cg.fillRect(x, y, w, h);
      cg.save(); cg.beginPath(); cg.rect(x, y, w, h); cg.clip(); drawSpirit(cg, u.type, x + w / 2, y + h * 0.5, Math.min(w, h) * 0.95, view.now / 1000); cg.restore();
    } else {   // leaderless troop / company / militia: draw the troop and its banner as the card
      const grd = cg.createLinearGradient(x, y, x, y + h); grd.addColorStop(0, shade(S[side].color, -0.3)); grd.addColorStop(1, '#120e16');
      cg.fillStyle = grd; cg.fillRect(x, y, w, h);
      blitFigure(cg, u.type, pals[side], x + w / 2, y + h * 0.9, h * 0.5, flip ? -1 : 1, { act: 'idle', t: view.now / 1000 }, rims[side]);
      if (u.kind === 'troop' || u.kind === 'militia') {   // "no leader" ribbon
        const rh = Math.max(10, h * 0.11);
        cg.fillStyle = 'rgba(12,9,16,0.8)'; cg.fillRect(x, y + h * 0.04, w, rh);
        cg.font = `700 ${Math.round(rh * 0.62)}px Cinzel, Georgia, serif`; cg.textAlign = 'center'; cg.textBaseline = 'middle';
        cg.fillStyle = '#cbb98e'; cg.fillText('NO LEADER', x + w / 2, y + h * 0.04 + rh / 2); cg.textBaseline = 'alphabetic';
      }
    }
    cg.strokeStyle = '#d8b05a'; cg.lineWidth = 2; cg.strokeRect(x - 2, y - 2, w + 4, h + 4);
    cg.strokeStyle = rgba(S[side].color, 0.9); cg.lineWidth = 1; cg.strokeRect(x - 5, y - 5, w + 10, h + 10);
    cg.restore();
  }

  function crestAt(cg, side, x, y, s) {
    const im = artImg(CREST[b.houses[side]]);
    if (im) cg.drawImage(im, x - s / 2, y - s / 2, s, s);
    else drawCrestFallback(cg, x, y, s, S[side].color, S[side].accent, S[side].name[0]);
  }

  function text(cg, str, x, y, size, color, align = 'left', weight = 700, font = 'Cinzel') {
    cg.font = `${weight} ${Math.round(size)}px ${font}, Georgia, serif`; cg.textAlign = align; cg.textBaseline = 'alphabetic';
    cg.lineWidth = Math.max(2, size / 7); cg.strokeStyle = 'rgba(0,0,0,0.75)'; cg.strokeText(str, x, y);
    cg.fillStyle = color; cg.fillText(str, x, y);
  }

  function clashSfx(type) {
    const st = statsOf(type);
    if (type === 'siege') sfx.play('catapult');
    else if (st.range > 1) sfx.play('arrows');
    else if (['horse', 'knights', 'wolfriders', 'ghosts'].includes(type)) { sfx.play('hooves'); sfx.play('clash', { delay: 0.35 }); }
    else if (type === 'golem') { sfx.play('hit'); sfx.play('clash', { delay: 0.1 }); }
    else sfx.play('clash');
  }

  // ---- the clash: a pre-fight info screen, then the animated scene (choreo.js + clashfx.js)
  // "Ser Halden Brook charges" / "Footmen attack": one named subject or a plural troop.
  const verbOf = u => {
    const one = !!vassalOf(u) || isSpirit(u) || u.type === 'wyvern' || u.type === 'golem';
    const v = isSpirit(u) ? ['strikes', 'strike'] : MOUNTED.has(u.type) ? ['charges', 'charge'] : u.type === 'siege' || POWDER.has(u.type) ? ['opens fire', 'open fire'] :
      u.type === 'archers' || u.type === 'bandits' || u.type === 'druids' ? ['looses', 'loose'] : u.type === 'wyvern' ? ['dives', 'dive'] : ['attacks', 'attack'];
    return one ? v[0] : v[1];
  };
  const terrName = u => { const tt = TERRAIN[terrainAt(b, u.x, u.y)]; return tt ? `${tt.name}${tt.def !== 1 ? ` ×${tt.def}` : ''}` : '—'; };
  const typeName = u => isSpirit(u) ? 'Summoned spirit' : statsOf(u.type).name;
  const leaderLine = u => vassalOf(u) ? `${vassalOf(u).name}, ${vassalOf(u).title}` : isSpirit(u) ? SPIRITS[u.type].spell : u.kind === 'company' ? 'Hired company' : u.kind === 'militia' ? 'Local militia' : 'No leader';
  const roleSides = (att, def) => ({ attacker: att, defender: def });

  function infoCard(att, def, hit, counter, before) {
    const R = roleSides(att, def);
    const sideData = (u, n) => ({ house: S[u.side].full, col: shade(S[u.side].color, 0.4), unit: typeName(u), leader: leaderLine(u),
      noLeader: !vassalOf(u) && !isSpirit(u) && u.kind !== 'company', soldiers: n, training: isSpirit(u) ? '—' : u.training, terrain: terrName(u) });
    const round5 = n => Math.max(1, Math.round(n / 5) * 5);
    const d = {
      caption: `${unitName(att)} ${verbOf(att)}`,
      sides: { attacker: sideData(att, before.att), defender: sideData(def, before.def) },
      expected: { kill: round5(hit.killed), counter: counter ? round5(counter.killed) : 0, ranged: !!hit.ranged },
      drawPortrait: (cg, role, x, y, w, h, flip) => portraitCard(cg, R[role], x, y, w, h, R[role].side, flip),
      drawCrest: (cg, role, x, y, s2) => crestAt(cg, R[role].side, x, y, s2),
    };
    return showCutin(1900, (cg, W2, H2, k) => drawInfoCard(cg, W2, H2, k, d));
  }

  function clashCutin(att, def, hit, counter, before) {
    const mode = cutMode();
    if (mode === 'off') return Promise.resolve();
    const short = mode === 'short';
    const R = roleSides(att, def);
    const pre = !short && prefs.info !== 'off' ? infoCard(att, def, hit, counter, before) : Promise.resolve();
    return pre.then(() => {
      const cfg = {
        seed: (hash(att.x * 31 + def.x, att.y * 17 + def.y, b.round) * 1e9) | 0, short, terrain: b.terrain, weather: b.weather, season: b.season,
        att: { type: att.type, kind: att.kind, spirit: isSpirit(att) ? att.type : null, before: before.att, after: att.soldiers },
        def: { type: def.type, kind: def.kind, spirit: isSpirit(def) ? def.type : null, before: before.def, after: def.soldiers },
        hit: { killed: hit.killed, ranged: !!hit.ranged, rout: !!hit.rout }, counter: counter ? { killed: counter.killed, rout: !!counter.rout } : null,
      };
      const scene = new ClashScene(cfg);
      const nm = u => ({ house: S[u.side].full, title: isSpirit(u) ? `Summoned spirit · ${SPIRITS[u.type].spell}` : `${typeName(u)} · ${vassalOf(u) ? vassalOf(u).name : roleOf(u)}`, col: shade(S[u.side].color, 0.45),
        noLeader: !vassalOf(u) && !isSpirit(u) && (u.kind === 'troop' || u.kind === 'militia') });
      const fx = new ClashRenderer(scene, {
        colours: { attacker: { color: S[att.side].color, accent: S[att.side].accent }, defender: { color: S[def.side].color, accent: S[def.side].accent } },
        names: { attacker: nm(att), defender: nm(def) },
        art: artImg(isSpirit(att) ? SPIRIT_CUTIN[att.type] : (CLASH_CUTIN[att.type] ?? null)),
        terrain: b.terrain, weather: b.weather, season: b.season, caption: `${unitName(att)} ${verbOf(att)}`,
        drawPortrait: (cg, role, x, y, w, h, flip) => portraitCard(cg, R[role], x, y, w, h, R[role].side, flip),
        drawCrest: (cg, role, x, y, s2) => crestAt(cg, R[role].side, x, y, s2),
        sfx: name => sfx.play(name),
      });
      return new Promise(res => {
        overlay.hidden = false;
        view.cutin = { scene, fx, acc: 0, res, skip: false };
      });
    });
  }

  function spiritCutin(side, spiritId, summon = false) {
    const sp = SPIRITS[spiritId];
    sfx.play('spell'); sfx.play('wind');
    try { playSting('summon'); } catch { /* audio unavailable */ }
    if (cutMode() === 'off') return Promise.resolve();
    const short = cutMode() === 'short';
    const motes = [];
    return showCutin(short ? 1000 : 2100, (cg, W2, H2, k, dt) => {
      const dark = k < 0.2 ? k / 0.2 : k > 0.85 ? (1 - k) / 0.15 : 1;
      cg.fillStyle = `rgba(4,3,10,${0.82 * dark})`; cg.fillRect(0, 0, W2, H2);
      // sky glow
      const gr = cg.createRadialGradient(W2 / 2, H2 * 0.45, 0, W2 / 2, H2 * 0.45, Math.max(W2, H2) * 0.6);
      gr.addColorStop(0, rgba(sp.color, 0.55 * dark)); gr.addColorStop(1, 'rgba(0,0,0,0)');
      cg.fillStyle = gr; cg.fillRect(0, 0, W2, H2);
      const im = artImg(SPIRIT_CUTIN[spiritId]) || artImg(sp.art);
      const appear = clamp((k - 0.12) / 0.3, 0, 1) * dark;
      if (im) {
        cg.save(); cg.globalAlpha = appear;
        const bh = Math.min(H2 * 0.8, W2 * 0.55);
        cg.beginPath(); cg.rect(0, H2 / 2 - bh / 2, W2, bh); cg.clip();
        drawCover(cg, im, 0, H2 / 2 - bh / 2, W2, bh, 1.05 + 0.12 * k, 0.5, 0.45);
        cg.restore();
        cg.fillStyle = sp.color; cg.globalAlpha = appear; cg.fillRect(0, H2 / 2 - bh / 2 - 2, W2, 2); cg.fillRect(0, H2 / 2 + bh / 2, W2, 2); cg.globalAlpha = 1;
        cg.save(); cg.globalCompositeOperation = 'lighter'; cg.globalAlpha = 0.35 * appear;
        const gr2 = cg.createRadialGradient(W2 / 2, H2 / 2, 0, W2 / 2, H2 / 2, bh * 0.6); gr2.addColorStop(0, sp.color); gr2.addColorStop(1, 'rgba(0,0,0,0)');
        cg.fillStyle = gr2; cg.fillRect(0, H2 / 2 - bh / 2, W2, bh); cg.restore();
      } else {
        drawSpirit(cg, spiritId, W2 / 2, H2 * 0.45 + (1 - appear) * H2 * 0.08, Math.min(W2, H2) * 0.62 * (0.9 + 0.1 * k), view.now / 1000, { alpha: appear, glow: 1 });
      }
      // motes
      if (motes.length < 90 && k < 0.8) for (let i = 0; i < 4; i++) motes.push({ x: Math.random() * W2, y: H2 + 10, v: 60 + Math.random() * 160, s: 1 + Math.random() * 3, life: 2 });
      cg.save(); cg.globalCompositeOperation = 'lighter';
      for (const m of motes) { m.y -= m.v * dt; m.x += Math.sin(m.y / 40) * 0.5; cg.globalAlpha = clamp(dark * 0.8, 0, 1); cg.fillStyle = sp.color; cg.beginPath(); cg.arc(m.x, m.y, m.s, 0, 7); cg.fill(); }
      cg.restore();
      const ta = clamp((k - 0.3) / 0.2, 0, 1) * dark;
      cg.globalAlpha = ta;
      const fs = Math.max(20, Math.min(W2, H2) * 0.075);
      text(cg, sp.name.toUpperCase(), W2 / 2, H2 * 0.82, fs, '#ffffff', 'center', 900);
      text(cg, summon ? 'answers the call' : sp.spell, W2 / 2, H2 * 0.82 + fs * 1.0, fs * 0.6, sp.color, 'center', 700);
      text(cg, summon ? `summoned to the field by ${S[side].full}` : `called by ${S[side].full}`, W2 / 2, H2 * 0.82 + fs * 1.7, fs * 0.38, '#d9ccb0', 'center', 500, 'EB Garamond');
      cg.globalAlpha = 1;
    });
  }

  // Outcome moments: a banner strip with art, a title and a bark.
  function momentCutin(slot, title, sub, color = '#ffd27a') {
    if (cutMode() === 'off') { showBanner(title); return Promise.resolve(); }
    const short = cutMode() === 'short';
    return showCutin(short ? 900 : 1600, (cg, W2, H2, k) => {
      const bd = band(W2, H2, k, 0.12, 0.15);
      cg.fillStyle = `rgba(5,4,8,${0.5 * bd.open})`; cg.fillRect(0, 0, W2, H2);
      const im = artImg(slot);
      if (im) { cg.save(); cg.beginPath(); cg.rect(0, bd.y, W2, bd.h); cg.clip(); drawCover(cg, im, 0, bd.y, W2, bd.h, 1.05 + 0.08 * k, 0.5 - 0.1 * k, 0.5); cg.restore(); }
      else {
        const gr = cg.createLinearGradient(0, bd.y, 0, bd.y + bd.h); gr.addColorStop(0, '#2a1f2e'); gr.addColorStop(0.5, shade(color, -0.6)); gr.addColorStop(1, '#120d16');
        cg.fillStyle = gr; cg.fillRect(0, bd.y, W2, bd.h);
        cg.save(); cg.globalAlpha = 0.15; cg.strokeStyle = color; cg.lineWidth = 2;
        for (let i = 0; i < 14; i++) { const x = (i / 14 + k * 0.2) * W2 * 1.2 - W2 * 0.1; cg.beginPath(); cg.moveTo(x, bd.y); cg.lineTo(x - bd.h * 0.4, bd.y + bd.h); cg.stroke(); }
        cg.restore();
      }
      cg.fillStyle = '#d8b05a'; cg.fillRect(0, bd.y - 2, W2, 2); cg.fillRect(0, bd.y + bd.h, W2, 2);
      if (bd.open > 0.7) {
        const fs = Math.max(22, bd.full * 0.16);
        const slide = easeOut(clamp(k / 0.25, 0, 1));
        cg.globalAlpha = clamp((k - 0.05) / 0.15, 0, 1);
        text(cg, title, lerp(W2 * 0.4, W2 / 2, slide), bd.y + bd.h * 0.52, fs, color, 'center', 900);
        if (sub) text(cg, sub, W2 / 2, bd.y + bd.h * 0.52 + fs * 0.85, fs * 0.38, '#f0e4c8', 'center', 500, 'EB Garamond');
        cg.globalAlpha = 1;
      }
    });
  }

  // Small banner on the board (turn changes and quiet moments).
  function showBanner(str, side) {
    const el2 = $('.bt-banner');
    el2.textContent = str;
    el2.style.setProperty('--banner-col', side ? S[side].color : '#d8b05a');
    el2.hidden = false;
    el2.classList.remove('bt-banner-go'); void el2.offsetWidth; el2.classList.add('bt-banner-go');
    clearTimeout(view.bannerTimer);
    view.bannerTimer = setTimeout(() => { el2.hidden = true; }, 1300 / speed());
  }

  function showBark(u, moment) {
    if (!u) return;
    const v = vassalOf(u);
    const line = bark(v, moment, Math.floor(view.now / 97) + (u.x * 7 + u.y));
    const d = view.disp.get(u.id) || u;
    const p = px(d.x, d.y);
    const el2 = el('div', 'bt-bark');
    el2.textContent = line;
    el2.style.left = p.x + 'px'; el2.style.top = (p.y - view.cs * 0.9) + 'px';
    el2.style.setProperty('--bark-col', S[u.side].color);
    $('.bt-barks').appendChild(el2);
    setTimeout(() => el2.remove(), 2200 / speed());
    log(`${unitName(u)}: "${line}"`);
  }

  // ---------------------------------------------------------------- HUD
  function crestCanvas(cv, side) {
    const s = 44; cv.width = s * 2; cv.height = s * 2; cv.style.width = s + 'px'; cv.style.height = s + 'px';
    const cg = cv.getContext('2d'); cg.scale(2, 2);
    crestAt(cg, side, s / 2, s / 2, s * 0.95);
  }
  crestCanvas(root.querySelector('.bt-side-a .bt-crest'), 'attacker');
  crestCanvas(root.querySelector('.bt-side-d .bt-crest'), 'defender');
  root.querySelector('.bt-side-a .bt-house').textContent = S.attacker.full + (playerSide === 'attacker' ? ' (you)' : '');
  root.querySelector('.bt-side-d .bt-house').textContent = S.defender.full + (playerSide === 'defender' ? ' (you)' : '');
  root.style.setProperty('--col-a', S.attacker.color); root.style.setProperty('--col-d', S.defender.color);

  function portraitThumb(u) {
    const c = document.createElement('canvas');
    c.width = 72; c.height = 90;
    const cg = c.getContext('2d');
    const im = artImg(portraitSlot(u));
    if (im) drawCover(cg, im, 0, 0, 72, 90);
    else if (u.vassalId) drawBust(cg, 0, 0, 72, 90, S[u.side].color, S[u.side].accent, unitName(u));
    else if (isSpirit(u)) { const sp = SPIRITS[u.type]; cg.fillStyle = shade(sp.color, -0.7); cg.fillRect(0, 0, 72, 90); drawSpirit(cg, u.type, 36, 46, 66, 1); }
    else { cg.fillStyle = shade(S[u.side].color, -0.5); cg.fillRect(0, 0, 72, 90); blitFigure(cg, u.type, pals[u.side], 36, 82, 46, 1, { act: 'idle', t: 0 }, rims[u.side]); }
    return c;
  }
  const rosterEls = new Map();
  function buildRosters() {
    for (const side of ['attacker', 'defender']) {
      const box = root.querySelector(side === 'attacker' ? '.bt-roster-a' : '.bt-roster-d');
      box.innerHTML = '';
      const mine = b.units.filter(x => x.side === side);
      const main = mine.filter(x => x.kind !== 'company' && x.kind !== 'spirit');
      const fifth = mine.find(x => x.kind === 'company' || x.kind === 'spirit') || null;
      // 4 main slots + the 5th (company or spirit); empty slots shown dim.
      const slots = [...main.slice(0, 4)];
      while (slots.length < 4) slots.push(null);
      slots.push(fifth || 'fifth-empty');
      slots.forEach((u, i) => {
        if (i === 4) { const h = el('div', 'bt-slot-label'); h.textContent = fifth ? `5th: ${fifth.kind === 'spirit' ? 'spirit' : 'company'}` : '5th: company / spirit'; box.appendChild(h); }
        if (!u || u === 'fifth-empty') { const e = el('div', 'bt-card bt-card-empty'); e.textContent = i === 4 ? 'none' : 'empty slot'; box.appendChild(e); return; }
        const card = el('button', 'bt-card' + (isSpirit(u) ? ' bt-card-spirit' : '') + (!u.leader && u.kind === 'troop' ? ' bt-card-noleader' : ''));
        if (isSpirit(u)) card.style.setProperty('--spirit-col', SPIRITS[u.type].color);
        card.appendChild(portraitThumb(u));
        const info = el('div', 'bt-card-info');
        info.innerHTML = `<div class="bt-card-name"></div><div class="bt-card-type"></div><div class="bt-card-bar"><i></i></div><div class="bt-card-status"></div>`;
        info.querySelector('.bt-card-name').textContent = (isRuler(u) ? '♛ ' : '') + unitName(u);
        info.querySelector('.bt-card-type').textContent = isSpirit(u) ? `${roleOf(u)} · ${SPIRITS[u.type].spell}` :
          (vassalOf(u) ? statsOf(u.type).name : roleOf(u));
        card.appendChild(info);
        card.addEventListener('click', () => { if (!u.out) { view.sel = u.id; view.mode = 'idle'; showTip(u); } });
        card.addEventListener('pointerenter', () => { if (!u.out) view.hover = { x: u.x, y: u.y }; });
        box.appendChild(card);
        rosterEls.set(u.id, card);
      });
    }
  }
  function updateHud() {
    for (const u of b.units) {
      const c = rosterEls.get(u.id);
      if (!c) continue;
      c.querySelector('.bt-card-bar i').style.width = (100 * u.soldiers / u.start) + '%';
      const st = u.out === 'dead' ? 'Destroyed' : u.out === 'routed' ? (isSpirit(u) ? 'Banished' : 'Routed') : u.out === 'fled' ? 'Withdrew' :
        `${u.soldiers} / ${u.start}` + (u.slowed ? ' · slowed' : '') + (u.confused ? ' · confused' : '') + (!isAI(u.side) && u.side === b.side && u.acted ? ' · done' : '');
      c.querySelector('.bt-card-status').textContent = st;
      c.classList.toggle('bt-out', !!u.out);
      c.classList.toggle('bt-sel', view.sel === u.id);
    }
    for (const side of ['attacker', 'defender']) {
      const tot = liveUnits(b, side).reduce((s, u) => s + u.soldiers, 0);
      root.querySelector(side === 'attacker' ? '.bt-side-a .bt-total' : '.bt-side-d .bt-total').textContent = `${tot} soldiers`;
    }
    const W_ICON = { rain: '☔ rain', snow: '❄ snow: move -1', fog: '☁ fog: range -1' };
    $('.bt-round').textContent = `Round ${Math.min(b.round, MAX_ROUNDS)} / ${MAX_ROUNDS}` + (b.weather ? ` · ${W_ICON[b.weather]}` : '') + (province ? ` · ${province.name}` : '');
    $('.bt-turn').textContent = b.winner ? 'Battle over' : `${S[b.side].name}'s move`;
    $('.bt-turn').style.setProperty('--turn-col', S[b.side].color);
    const myTurn = !b.winner && !isAI(b.side) && !view.busy;
    $('.bt-end').disabled = !myTurn; $('.bt-hold').disabled = !myTurn || !view.sel;
    $('.bt-end').classList.toggle('bt-glow', myTurn && sideDone(b));
    $('.bt-retreat').hidden = playerSide == null;
    $('.bt-auto').classList.toggle('bt-on', view.auto);
    $('.bt-auto').hidden = playerSide == null;
    $('.bt-speed').textContent = prefs.speed + 'x';
    $('.bt-cut').textContent = 'Cut-ins: ' + { full: 'Full', short: 'Short', off: 'Off' }[prefs.cutins];
    $('.bt-sound').classList.toggle('bt-on', prefs.sound);
    const spBtn = $('.bt-spirit');
    const mySp = playerSide && b.spirit[playerSide];
    const spU = playerSide && spiritOf(b, playerSide);
    spBtn.hidden = !mySp;
    if (mySp) {
      spBtn.querySelector('span').textContent = spU && spU.out ? `${SPIRITS[mySp].name} (banished)` :
        b.spiritUsed[playerSide] ? `${SPIRITS[mySp].name} (spent)` : `${SPIRITS[mySp].spell}`;
      spBtn.classList.toggle('bt-linked', !!spU && view.sel === spU.id);
      spBtn.disabled = !myTurn || !canCast(b, playerSide);
      spBtn.classList.toggle('bt-on', view.mode === 'spell');
      spBtn.title = SPIRITS[mySp].text;
    }
    $('.bt-rotate').hidden = !(view.mode === 'spell' && ['line', 'wall'].includes(SPIRITS[b.spirit[b.side]]?.shape));
  }
  function spiritIcon() {
    const mySp = playerSide && b.spirit[playerSide];
    if (!mySp) return;
    const cv = $('.bt-spirit canvas'), cg = cv.getContext('2d');
    cg.clearRect(0, 0, 40, 40);
    const im = artImg(SPIRITS[mySp].art);
    if (im) { cg.save(); cg.beginPath(); cg.arc(20, 20, 19, 0, 7); cg.clip(); drawCover(cg, im, 0, 0, 40, 40); cg.restore(); }
    else { cg.fillStyle = '#120e18'; cg.beginPath(); cg.arc(20, 20, 19, 0, 7); cg.fill(); drawSpirit(cg, mySp, 20, 21, 36, 1); }
  }

  function log(textLine) {
    const lg = $('.bt-log');
    lg.textContent = textLine;
    if (opts.onLog) opts.onLog(textLine);
  }

  function showTip(u) {
    if (!u) { tip.hidden = true; return; }
    const st = statsOf(u.type);
    const t = terrainAt(b, u.x, u.y);
    const v = vassalOf(u);
    tip.innerHTML = '';
    const head = el('div', 'bt-tip-head');
    head.appendChild(portraitThumb(u));
    const hd = el('div');
    hd.innerHTML = `<b></b><div class="bt-tip-sub"></div><div class="bt-tip-sub2"></div>`;
    hd.querySelector('b').textContent = unitName(u);
    hd.querySelector('.bt-tip-sub').textContent = `${S[u.side].name} · ${st.name}${isRuler(u) ? ' · Ruler' : ''}`;
    hd.querySelector('.bt-tip-sub2').textContent = v ? `Led by ${v.name} · Might ${u.might} · Wits ${u.wits}` :
      isSpirit(u) ? `${roleOf(u)} · ${SPIRITS[u.type].spell}${b.spiritUsed[u.side] ? ' (spent)' : ''}` :
      `${roleOf(u)} · routs below ${Math.round(routAt(u) * 100)}%`;
    head.appendChild(hd); tip.appendChild(head);
    const rows = el('div', 'bt-tip-rows');
    rows.innerHTML = `<span>Soldiers</span><b>${u.soldiers} / ${u.start}</b><span>Attack / Defence</span><b>${st.atk} / ${st.def}</b>
      <span>Move / Range</span><b>${moveRange(b, u)} / ${attackRange(b, { ...u, moved: false })}</b><span>Training</span><b>${u.training}</b>
      <span>Ground</span><b>${TERRAIN[t].name} (def x${TERRAIN[t].def})</b>`;
    tip.appendChild(rows);
    if (st.note) { const n = el('div', 'bt-tip-note'); n.textContent = st.note; tip.appendChild(n); }
    tip.hidden = false;
    const p = px(u.x, u.y);
    const left = p.x > view.w / 2;
    tip.style.left = left ? '' : Math.min(view.w - 230, p.x + view.cs * 0.7) + 'px';
    tip.style.right = left ? Math.max(4, view.w - p.x + view.cs * 0.7) + 'px' : '';
    tip.style.top = clamp(p.y - 40, 4, view.h - 170) + 'px';
  }

  // ---------------------------------------------------------------- event playback
  async function play(events) {
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.t === 'move') {
        const d = view.disp.get(e.unit), u = getUnit(b, e.unit);
        const mounted = MOUNTED.has(u.type) || u.type === 'wyvern';
        if (mounted) sfx.play('hooves');
        const dist2 = Math.abs(e.to.x - e.from.x) + Math.abs(e.to.y - e.from.y);
        const from = { ...e.from };
        if (e.to.x !== e.from.x) d.facing = e.to.x > e.from.x ? 1 : -1;
        d.walking = true; d.run = mounted;
        let lastX = from.x, lastY = from.y;
        await tween(180 + dist2 * (mounted ? 70 : 95), k => {
          const kk = ease(k); d.x = lerp(from.x, e.to.x, kk); d.y = lerp(from.y, e.to.y, kk);
          const moved = Math.hypot(d.x - lastX, d.y - lastY); lastX = d.x; lastY = d.y;
          d.walkPh += moved * (mounted ? 9 : 14);
          if (Math.random() < (mounted ? 0.5 : 0.22)) dustAt(d.x, d.y, 1);
        });
        d.x = e.to.x; d.y = e.to.y; d.walking = false; d.run = false;
      } else if (e.t === 'hit' && e.confused) {
        const t = getUnit(b, e.target), d = view.disp.get(t.id), src = getUnit(b, e.unit), ds = view.disp.get(src.id);
        ds.act = { name: attackAct(src.type) === 'draw' ? 'swing' : attackAct(src.type), t0: view.now, len: 420 };
        await wait(220);
        d.flash = 1; sfx.play('hit'); d.shown = Math.max(t.soldiers, d.shown - e.killed);
        const p = px(t.x, t.y); view.P.clash(p.x, p.y - view.cs * 0.2, 0.4, [200, 160, 255]);
        floatText(t.x, t.y, '-' + e.killed, '#c9a0ff');
        floatText(src.x, src.y, 'Bewildered!', '#c9a0ff');
        await tween(300, k => { d.flash = 1 - k; });
      } else if (e.t === 'hit' && !e.counter) {
        const att = getUnit(b, e.unit), def = getUnit(b, e.target);
        const next = events[i + 1] && events[i + 1].t === 'rout' && events[i + 1].unit === def.id ? events[i + 1] : null;
        let j = i + 1 + (next ? 1 : 0);
        const counter = events[j] && events[j].t === 'hit' && events[j].counter ? events[j] : null;
        if (counter) j++;
        const counterRout = counter && events[j] && events[j].t === 'rout' && events[j].unit === att.id ? events[j] : null;
        if (counterRout) j++;
        i = j - 1;
        await attackSequence(att, def, e, counter, !!next, !!counterRout);
      } else if (e.t === 'hit' && e.counter) {
        const t = getUnit(b, e.target); view.disp.get(t.id).shown = t.soldiers;
        floatText(t.x, t.y, '-' + e.killed, '#ff9a70');
      } else if (e.t === 'rout') {
        await routUnit(getUnit(b, e.unit));
      } else if (e.t === 'spell') {
        await spellSequence(e, events.slice(i + 1));
      } else if (e.t === 'heal') {
        const u = getUnit(b, e.unit);
        view.disp.get(u.id).shown = u.soldiers;
        floatText(u.x, u.y, '+' + e.amount, '#8dffa0');
        const p = px(u.x, u.y);
        view.P.embers(p.x, p.y + view.cs * 0.1, 10, [140, 255, 150], 0.7);
      } else if (e.t === 'gate') {
        sfx.play('gate');
        const u = getUnit(b, e.unit), p = px(u.x, u.y);
        view.P.explode(p.x, p.y, 0.9, [255, 170, 80]); view.P.debris(p.x, p.y, 12, [110, 80, 50], 4); shakeBy(10);
        await momentCutin(BATTLE_MOMENT.gateBreach, 'The Gate Falls!', bark(vassalOf(u), 'gate', view.now | 0), '#ffb060');
        showBark(u, 'gate');
      } else if (e.t === 'side') {
        updateHud();
        if (!b.winner) {
          showBanner(`${S[e.side].name}'s move${e.side === 'attacker' && e.round > 1 ? ` · Round ${e.round}` : ''}`, e.side);
          await wait(isAI(e.side) ? 450 : 250);
        }
      } else if (e.t === 'over') {
        // handled by finish()
      }
      updateHud();
    }
    for (const u of b.units) { const d = view.disp.get(u.id); if (d) d.shown = u.soldiers; }
  }

  function dustAt(cx, cy, n) {
    const p = px(cx, cy);
    if (b.season === 3) view.P.snowPuff(p.x, p.y + view.cs * 0.32, n);
    else view.P.dust(p.x, p.y + view.cs * 0.32, n, b.terrain === 'marsh' ? [120, 130, 100] : [175, 155, 120], 0.22);
  }

  // Board-level impact on the defender: figures drop, sparks, numbers, camera kick.
  function boardImpact(att, def, hit, dD, ranged, power) {
    const p = px(def.x, def.y), cs = view.cs;
    dD.shown = def.soldiers; dD.flash = 1;
    const big = hit.killed >= Math.max(25, def.start * 0.15);
    if (!ranged) view.P.clash(p.x - Math.sign(def.x - att.x) * cs * 0.25, p.y - cs * 0.15, power, [255, 210, 140]);
    else view.P.hit(p.x, p.y);
    if (b.terrain === 'forest' || terrainAt(b, def.x, def.y) === 'forest') view.P.leaves(p.x, p.y - cs * 0.3, 4);
    dustAt(def.x, def.y, 3);
    shakeBy(clamp(3 + hit.killed / 8, 3, 13));
    if (big) { hitStop(70); pulse(0.35); }
    floatText(def.x, def.y, '-' + hit.killed, '#ff6a50', true);
    const dir = { dx: Math.sign(def.x - att.x) || 0, dy: Math.sign(def.y - att.y) || 0 };
    dD.recoil = { p: 0, ...dir, amt: MOUNTED.has(att.type) ? 0.22 : 0.1 };
    tween(260, k => { if (dD.recoil) dD.recoil.p = k; }).then(() => { dD.recoil = null; });
  }

  async function attackSequence(att, def, hit, counter, routed, counterRouted) {
    const dA = view.disp.get(att.id), dD = view.disp.get(def.id);
    const ranged = hit.ranged, cs = view.cs;
    const before = { att: att.soldiers + (counter ? counter.killed : 0), def: def.soldiers + hit.killed };
    dA.shown = before.att; dD.shown = before.def;
    if (def.x !== att.x) dA.facing = def.x > att.x ? 1 : -1;
    if (!ranged && def.x !== att.x) dD.facing = att.x > def.x ? 1 : -1;
    const showClash = cutMode() !== 'off' && (!ranged || cutMode() === 'full');
    const a = px(att.x, att.y), bb = px(def.x, def.y);
    const mounted = MOUNTED.has(att.type) || att.type === 'wyvern';
    const act = attackAct(att.type);
    if (showClash) {
      // a short wind-up on the board, then the clash scene
      dA.act = { name: act, t0: view.now, len: 380 };
      if (Math.random() < 0.35 || routed) showBark(att, 'attack');
      await wait(260);
      await clashCutin(att, def, hit, counter, before);
      dA.act = null;
      boardImpact(att, def, hit, dD, ranged, mounted ? 0.9 : 0.5);
      if (counter) { dA.shown = att.soldiers; dA.flash = 0.8; floatText(att.x, att.y, '-' + counter.killed, '#ff9a70'); }
      await tween(240, k => { dD.flash = 1 - k; dA.flash = Math.min(dA.flash, 1 - k); });
    } else if (ranged) {
      // a volley on the board: draw, loose, arrows in flight, landing spread over the square
      const engine = att.type === 'siege' || att.type === 'bombards';
      const powder = POWDER.has(att.type);
      dA.act = { name: engine ? 'loose' : 'draw', t0: view.now, len: engine ? 700 : 420, stagger: engine ? 0 : 40 };
      await wait(engine ? 280 : 400);
      const lp = launchPoint(att.type, cs * 0.55, dA.facing);
      const from = { x: a.x + lp.x, y: a.y + lp.y + cs * 0.24 };
      let landed = 0, need = 1;
      const onLand = () => { landed++; };
      if (engine) {
        sfx.play('catapult');
        if (att.type === 'bombards') { view.P.flash(from.x, from.y, 0.9, [255, 220, 150]); view.P.smoke(from.x, from.y, 6, 0.6, 150, 0); shakeBy(6); }
        view.projectiles.push({ a: from, b: { x: bb.x, y: bb.y }, t0: view.now, dur: (att.type === 'siege' ? 720 : 300) / speed(), kind: att.type === 'siege' ? 'stone' : 'ball',
          arc: att.type === 'siege' ? cs * 2.6 + Math.abs(bb.x - a.x) * 0.15 : cs * 0.3, onLand });
      } else {
        sfx.play(powder ? 'catapult' : 'arrows');
        const n = clamp(Math.round(att.soldiers / 18), 6, 14);
        need = n;
        for (let i = 0; i < n; i++) {
          const jit = { x: (Math.random() - 0.5) * cs * 0.8, y: (Math.random() - 0.5) * cs * 0.6 };
          const t0 = view.now + i * (powder ? 25 : 35) / speed();
          if (powder) setTimeout(() => { view.P.flash(from.x + (Math.random() - 0.5) * cs * 0.3, from.y, 0.3, [255, 220, 150]); view.P.smoke(from.x, from.y, 1, 0.3, 160, 0); }, i * 25 / speed());
          view.projectiles.push({ a: { x: from.x + (Math.random() - 0.5) * cs * 0.3, y: from.y }, b: { x: bb.x + jit.x, y: bb.y + jit.y }, t0,
            dur: (powder ? 160 : 460 + Math.random() * 80) / speed(), kind: powder ? 'bullet' : att.type === 'druids' ? 'thorn' : att.type === 'bandits' ? 'bolt' : 'arrow',
            arc: powder ? 2 : cs * (0.9 + Math.random() * 0.5) + Math.abs(bb.x - a.x) * 0.1,
            onLand: q => { landed++; view.P.hit(q.b.x, q.b.y, [230, 215, 180]); } });
        }
      }
      for (let guard = 0; landed < need && view.alive && guard < 120; guard++) await wait(30);
      if (engine) { view.P.explode(bb.x, bb.y, att.type === 'siege' ? 1.1 : 0.9); hitStop(90); pulse(0.4, '255,140,60'); sfx.play('hit'); }
      else sfx.play('hit');
      dA.act = null;
      boardImpact(att, def, hit, dD, true, 0.5);
      await tween(220, k => { dD.flash = 1 - k; });
    } else {
      // melee on the board: charge into contact, weapons swing, the defender recoils
      const reach = mounted ? 0.55 : isSpirit(att) ? 0.5 : 0.36;
      dA.lunge = { p: 0, dx: Math.sign(def.x - att.x), dy: Math.sign(def.y - att.y), reach };
      dA.act = { name: act, t0: view.now + 80, len: 420, stagger: 45 };
      if (mounted) sfx.play('hooves');
      dA.walking = true; dA.run = mounted;
      await tween(mounted ? 260 : 220, k => {
        dA.lunge.p = k * 0.5; dA.walkPh += 0.25;
        if (mounted && Math.random() < 0.7) { const p = px(lerp(att.x, def.x, k * 0.5), lerp(att.y, def.y, k * 0.5)); view.P.dust(p.x - dA.facing * cs * 0.3, p.y + cs * 0.3, 1, [175, 155, 120], 0.25); }
      });
      dA.walking = false;
      clashSfx(att.type);
      if (isSpirit(att)) { const sp = SPIRITS[att.type]; view.P.explode(bb.x, bb.y, 0.8, sp.color); pulse(0.3, '200,200,255'); }
      boardImpact(att, def, hit, dD, false, mounted ? 1 : 0.6);
      if (mounted) { hitStop(80); view.P.ring(bb.x, bb.y + cs * 0.3, 0.9, [255, 230, 190], 3); }
      await tween(mounted ? 220 : 180, k => { dA.lunge.p = 0.5 + k * 0.5; dD.flash = Math.max(0, 1 - k * 1.2); });
      dA.lunge = null; dA.act = null;
      if (counter) {   // the defender strikes back
        await wait(80);
        dD.lunge = { p: 0, dx: -Math.sign(def.x - att.x), dy: -Math.sign(def.y - att.y), reach: 0.28 };
        dD.act = { name: attackAct(def.type) === 'draw' ? 'swing' : attackAct(def.type), t0: view.now, len: 380, stagger: 45 };
        await tween(180, k => { dD.lunge.p = k * 0.5; });
        sfx.play('clash');
        dA.shown = att.soldiers; dA.flash = 0.9;
        view.P.clash(a.x + Math.sign(def.x - att.x) * cs * 0.25, a.y - cs * 0.15, 0.45, [255, 180, 140]);
        floatText(att.x, att.y, '-' + counter.killed, '#ff9a70');
        shakeBy(4);
        await tween(180, k => { dD.lunge.p = 0.5 + k * 0.5; dA.flash = 1 - k; });
        dD.lunge = null; dD.act = null;
      }
    }
    // last stand: a ruler's unit falls low
    for (const u of [def, att]) {
      if (!u.out && isRuler(u) && u.soldiers < u.start * 0.45 && !view.lastStand.has(u.id)) {
        view.lastStand.add(u.id);
        await momentCutin(BATTLE_MOMENT.lastStand, 'Last Stand', `${unitName(u)}: "${bark(vassalOf(u), 'lastStand', view.now | 0)}"`, '#ff8a6a');
      }
    }
    if (routed) await routUnit(def);
    if (counterRouted) await routUnit(att);
  }

  async function routUnit(u) {
    const d = view.disp.get(u.id);
    if (!d || d.alpha <= 0) return;
    d.shown = u.soldiers;
    sfx.play('rout');
    const p = px(u.x, u.y);
    const dead = u.out === 'dead';
    view.P.unitBurst(p.x, p.y, isSpirit(u) ? SPIRITS[u.type].color : S[u.side].color, dead || isSpirit(u));
    shakeBy(dead ? 9 : 6);
    const last = !liveUnits(b, u.side).length;
    if (last || isRuler(u)) slowMo(700);
    floatText(u.x, u.y, dead ? 'Destroyed!' : isSpirit(u) ? 'Banished!' : 'Routed!', '#ffd27a', true);
    showBark(u, 'rout');
    if (cutMode() === 'full' && (isRuler(u) || u.start >= 150 || last)) {
      await momentCutin(BATTLE_MOMENT.rout, dead ? 'Destroyed' : isSpirit(u) ? 'Banished' : 'Routed', `${unitName(u)} breaks and flees the field.`, '#ffc070');
    }
    // survivors turn and run for their own edge
    const away = u.side === 'attacker' ? -1 : 1;
    d.facing = away; d.flee = !dead && !isSpirit(u) && u.soldiers > 0;
    const sx = d.x;
    await tween(d.flee ? 900 : 500, k => {
      d.alpha = 1 - k * k; d.x = sx + away * k * (d.flee ? 1.6 : 0.4); d.walkPh += 0.35;
      if (d.flee && Math.random() < 0.4) dustAt(d.x, d.y, 1);
    });
    d.alpha = 0; d.flee = false;
    if (view.sel === u.id) view.sel = null;
  }

  async function spellSequence(e, rest = []) {
    const sp = SPIRITS[e.spirit];
    const caster = e.caster ? getUnit(b, e.caster) : spiritOf(b, e.side);
    if (caster) {   // the spirit rears up
      const d = view.disp.get(caster.id);
      d.flash = 1; tween(500, k => { d.flash = 1 - k; });
      const p = px(caster.x, caster.y); view.P.flash(p.x, p.y, 1.2, sp.color); view.P.embers(p.x, p.y, 16, sp.color, 1);
    }
    if (cutMode() === 'full') await momentCutin(SPIRIT_CUTIN[e.spirit], sp.spell, `${sp.name} unleashes its power`, sp.color);
    else sfx.play('spell');
    showBanner(`${sp.name}: ${sp.spell}`, e.side);
    const anim = new SpellAnim({ ...e, casterAt: caster ? { x: caster.x, y: caster.y } : null }, {
      px, cs: view.cs, P: view.P, shake: v => shakeBy(v), sfx: n => sfx.play(n),
      whiteout: (a, rgb) => { view.whiteout = Math.max(view.whiteout, a); view.whiteCol = rgb.join(','); },
      board: { x: view.ox, y: view.oy, w: view.cs * W, h: view.cs * H },
    });
    const dur = anim.dur;
    // Bulwark: the new wall squares rise one after another
    if (sp.shape === 'wall') {
      e.cells.forEach((c, i) => { const w = b.tempWalls.find(w2 => w2.x === c.x && w2.y === c.y); if (w) w.born = view.now + anim.wallRiseAt(i) * dur / speed(); });
    }
    const hits = e.hits.map(h => {
      const u = getUnit(b, h.unit);
      return { h, u, k: anim.hitK({ x: u.x, y: u.y }), done: false };
    });
    const routs = new Set(rest.filter(r => r.t === 'rout').map(r => r.unit));
    view.spell = { anim, t0: view.now, dur: dur / speed() };
    await tween(dur, k => {
      for (const it of hits) if (!it.done && k >= it.k) {
        it.done = true;
        const d = view.disp.get(it.u.id);
        d.flash = 1; if (it.h.killed) { d.shown = Math.max(it.u.soldiers, d.shown - it.h.killed); floatText(it.u.x, it.u.y, '-' + it.h.killed, sp.color, true); }
        else floatText(it.u.x, it.u.y, sp.spell, sp.color);
        tween(400, kk => { d.flash = 1 - kk; });
        if (routs.has(it.u.id)) d.shown = it.u.soldiers;
      }
    });
    view.spell = null;
    await wait(150);
  }

  // ---------------------------------------------------------------- flow
  let resolveDone;
  const done = new Promise(r => { resolveDone = r; });

  async function act(action) {
    if (view.busy || b.winner) return false;
    view.busy = true;
    if (action.type === 'spell') view.mode = 'idle';
    const r = applyAction(b, action);
    if (!r.ok) { view.busy = false; updateHud(); return false; }
    try { await play(r.events); } catch (err) { console.error(err); }
    view.busy = false;
    if (opts.onState) opts.onState(b);
    updateHud();
    if (b.winner) { await finish(); return true; }
    schedule();
    return true;
  }

  let scheduled = false;
  function schedule() {
    if (scheduled || b.winner || !view.alive) return;
    scheduled = true;
    setTimeout(async () => {
      scheduled = false;
      if (b.winner || view.busy || !view.alive) return;
      if (isAI(b.side)) {
        const a = chooseAction(b, b.side);
        if (a.type === 'endSide') await wait(150);
        const ok = await act(a);
        if (!ok && a.unit) await act({ type: 'wait', unit: a.unit });
        else if (!ok) await act({ type: 'endSide' });
      } else if (sideDone(b) && !canCast(b, b.side)) {
        // player has nothing left to do: end the side automatically after a beat
        await wait(500);
        if (!isAI(b.side) && sideDone(b) && !view.busy && !b.winner) await act({ type: 'endSide' });
      } else if (view.sel == null) {
        const first = liveUnits(b, b.side).find(u => !u.acted);
        if (first) view.sel = first.id;
        updateHud();
      }
    }, (isAI(b.side) ? 90 : 30) / speed());
  }

  async function finish() {
    const res = result(b);
    const reason = b.reason;
    const winSide = b.winner;
    const winner = liveUnits(b, winSide).sort((p, q) => q.soldiers - p.soldiers)[0] || b.units.find(u => u.side === winSide);
    if (reason === 'keep taken') await momentCutin(BATTLE_MOMENT.keepTaken, 'The Keep Is Taken!', `${S.attacker.full} raises its banner over ${province ? province.name : 'the keep'}.`, '#ffd27a');
    else if (reason === 'defenders routed' || reason === 'attackers routed') await momentCutin(BATTLE_MOMENT.rout, 'The Field Is Won', `${S[enemyOf(winSide)].full} flees in disorder.`, '#ffd27a');
    if (winner) showBark(winner, 'win');
    const playerWon = playerSide ? winSide === playerSide : null;
    sfx.play(playerWon === false ? 'lose' : 'win');
    await wait(400);
    modal.hidden = false;
    modal.innerHTML = '';
    const box = el('div', 'bt-result');
    const title = playerWon == null ? `${S[winSide].full} wins` : playerWon ? 'Victory' : 'Defeat';
    const REASON = { 'keep taken': 'The keep was taken.', 'held out': `The defenders held out for ${MAX_ROUNDS} rounds.`, 'attackers routed': 'The attackers were routed.',
      'defenders routed': 'The defenders were routed.', 'attackers withdrew': 'The attackers withdrew.', 'defenders fled': 'The defenders fled.', 'no attackers': 'No one came to fight.', 'no defenders': 'The province was undefended.' };
    box.innerHTML = `<h2 class="${playerWon === false ? 'bt-lose' : 'bt-win'}"></h2><p class="bt-reason"></p><div class="bt-losses"></div><button class="bt-btn bt-primary bt-continue">Continue</button>`;
    box.querySelector('h2').textContent = title;
    box.querySelector('.bt-reason').textContent = REASON[reason] || reason;
    const ls = box.querySelector('.bt-losses');
    for (const side of ['attacker', 'defender']) {
      const col = el('div', 'bt-loss-col');
      const hh = el('h3'); hh.textContent = S[side].full; hh.style.color = shade(S[side].color, 0.4); col.appendChild(hh);
      for (const u of b.units.filter(x => x.side === side)) {
        const row = el('div', 'bt-loss-row');
        const fate = u.out === 'dead' ? 'destroyed' : u.out === 'routed' ? 'routed' : u.out === 'fled' ? 'withdrew' : '';
        row.innerHTML = `<span></span><b></b>`;
        row.querySelector('span').textContent = unitName(u);
        row.querySelector('b').textContent = `${u.start} → ${u.out === 'dead' ? 0 : u.soldiers}${fate ? ' (' + fate + ')' : ''}`;
        col.appendChild(row);
      }
      ls.appendChild(col);
    }
    modal.appendChild(box);
    const btn = box.querySelector('.bt-continue');
    btn.focus();
    btn.addEventListener('click', () => { cleanup(); resolveDone(res); });
  }

  // ---------------------------------------------------------------- input
  function cellFromEvent(e) {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left - view.ox) / view.cs), y = Math.floor((e.clientY - r.top - view.oy) / view.cs);
    return x >= 0 && y >= 0 && x < W && y < H ? { x, y } : null;
  }
  canvas.addEventListener('pointermove', e => {
    const c = cellFromEvent(e);
    view.hover = c;
    if (view.mode === 'spell' && e.pointerType === 'mouse') view.spellAt = c;
    const u = c && unitAt(b, c.x, c.y);
    if (e.pointerType === 'mouse') showTip(u || (view.sel && null));
  });
  canvas.addEventListener('pointerleave', () => { view.hover = null; tip.hidden = true; });
  canvas.addEventListener('contextmenu', e => { e.preventDefault(); if (view.mode === 'spell') rotate(); else { view.sel = null; updateHud(); } });
  canvas.addEventListener('pointerdown', async e => {
    sfx.unlock();
    if (e.button === 2) return;
    const c = cellFromEvent(e);
    if (!c || view.busy || b.winner) return;
    const u = unitAt(b, c.x, c.y);
    if (isAI(b.side)) { showTip(u); return; }
    if (view.mode === 'spell') {
      // touch: first tap previews, second tap on the same square casts
      if (e.pointerType !== 'mouse' && (!view.spellAt || view.spellAt.x !== c.x || view.spellAt.y !== c.y)) { view.spellAt = c; return; }
      await act({ type: 'spell', unit: b.spiritUnit[b.side], side: b.side, target: c, dir: view.spellDir });
      return;
    }
    const sel = view.sel && getUnit(b, view.sel);
    if (sel && u && u.side !== sel.side && legalTargets(b, sel).includes(u.id)) { tip.hidden = true; await act({ type: 'attack', unit: sel.id, target: u.id }); return; }
    if (sel && !u && legalMoves(b, sel).some(m => m.x === c.x && m.y === c.y)) { await act({ type: 'move', unit: sel.id, to: c }); return; }
    if (u && u.side === b.side) { view.sel = (view.sel === u.id && e.pointerType === 'mouse') ? view.sel : u.id; sfx.play('click'); showTip(u); updateHud(); return; }
    showTip(u);
    if (!u) { view.sel = null; updateHud(); }
  });
  const rotate = () => { const i = DIR_NAMES.indexOf(view.spellDir); view.spellDir = DIR_NAMES[(i + 1) % DIR_NAMES.length]; };

  $('.bt-end').addEventListener('click', () => { sfx.unlock(); view.mode = 'idle'; view.sel = null; act({ type: 'endSide' }); });
  $('.bt-hold').addEventListener('click', () => { if (view.sel) { const id = view.sel; view.sel = null; act({ type: 'wait', unit: id }); } });
  $('.bt-auto').addEventListener('click', () => { view.auto = !view.auto; view.mode = 'idle'; updateHud(); schedule(); });
  $('.bt-speed').addEventListener('click', () => { prefs.speed = prefs.speed === 1 ? 2 : 1; savePrefs(prefs); updateHud(); });
  $('.bt-cut').addEventListener('click', () => { prefs.cutins = { full: 'short', short: 'off', off: 'full' }[prefs.cutins]; savePrefs(prefs); updateHud(); });
  $('.bt-sound').addEventListener('click', () => { prefs.sound = !prefs.sound; sfx.muted = !prefs.sound; savePrefs(prefs); updateHud(); });
  $('.bt-rotate').addEventListener('click', rotate);
  $('.bt-spirit').addEventListener('click', () => {
    if (!canCast(b, b.side) || isAI(b.side)) return;
    view.mode = view.mode === 'spell' ? 'idle' : 'spell';
    view.spellDir = b.side === 'attacker' ? 'right' : 'left';
    if (SPIRITS[b.spirit[b.side]].shape === 'wall') view.spellDir = 'down';
    view.spellAt = SPIRITS[b.spirit[b.side]].shape === 'targets' ? { x: OBJ.x, y: OBJ.y } : null;
    updateHud();
  });
  $('.bt-retreat').addEventListener('click', () => {
    if (b.winner || view.busy) return;
    modal.hidden = false;
    modal.innerHTML = '';
    const box = el('div', 'bt-result bt-confirm');
    box.innerHTML = `<h2>Sound the retreat?</h2><p>Your troops leave the field. The battle counts as lost.</p><div class="bt-row"><button class="bt-btn bt-danger bt-yes">Retreat</button><button class="bt-btn bt-no">Fight on</button></div>`;
    modal.appendChild(box);
    box.querySelector('.bt-no').addEventListener('click', () => { modal.hidden = true; });
    box.querySelector('.bt-yes').addEventListener('click', () => { modal.hidden = true; act({ type: 'retreat', side: playerSide }); });
  });
  const onKey = e => {
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    if (view.cutin && (e.key === ' ' || e.key === 'Escape' || e.key === 'Enter')) { view.cutin.skip = true; e.preventDefault(); return; }
    if (e.key === 'e' || e.key === 'E') $('.bt-end').click();
    else if (e.key === 'h' || e.key === 'H') $('.bt-hold').click();
    else if (e.key === 'r' || e.key === 'R') rotate();
    else if (e.key === 'Escape') { view.mode = 'idle'; view.sel = null; updateHud(); }
  };
  window.addEventListener('keydown', onKey);
  const ro = new ResizeObserver(() => layout());
  ro.observe(stage);

  // ---------------------------------------------------------------- render loop
  let last = performance.now();
  view.now = last;
  const forestCells = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (b.grid[y * W + x] === 'forest') forestCells.push({ x, y });
  let frameMs = 16.7;
  function frame(ts) {
    if (!view.alive) return;
    const real = Math.min(0.05, (ts - last) / 1000); last = ts;
    frameMs = frameMs * 0.95 + real * 1000 * 0.05;
    view.frameMs = frameMs;
    // virtual clock: hit-stop freezes, slow motion slows the board (not the cut-ins)
    const ts2 = performance.now();
    const scale = ts2 < view.hitStopUntil ? 0.04 : ts2 < view.slowUntil ? 0.35 : 1;
    const dt = real * scale;
    view.now += dt * 1000;
    const now = view.now;
    // tweens
    for (let i = view.tweens.length - 1; i >= 0; i--) {
      const tw = view.tweens[i];
      const k = clamp((now - tw.t0) / tw.dur, 0, 1);
      tw.fn(k);
      if (k >= 1) { view.tweens.splice(i, 1); tw.res(); }
    }
    // ambient: leaves drifting off the woods, snow puffs
    if (forestCells.length && Math.random() < dt * 1.2 && !view.reduced) {
      const c = forestCells[(Math.random() * forestCells.length) | 0], p = px(c.x, c.y);
      view.P.leaves(p.x, p.y - view.cs * 0.3, 1);
    }
    // while a clash scene covers the board, redraw the board only every third frame
    view.fc = (view.fc || 0) + 1;
    if (view.cutin && view.cutin.scene && view.fc % 3) { drawCutin(real); requestAnimationFrame(frame); return; }
    view.P.step(dt);
    g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    g.clearRect(0, 0, view.w, view.h);
    drawBackdrop();
    g.save();
    if (view.shake > 0.2) { g.translate((Math.random() - 0.5) * view.shake, (Math.random() - 0.5) * view.shake); view.shake *= Math.pow(0.015, real); } else view.shake = 0;
    drawFrame();
    drawTempWalls();
    drawOverlays();
    const spellK = view.spell ? clamp((now - view.spell.t0) / view.spell.dur, 0, 1) : 0;
    if (view.spell && view.spell.anim.id === 'gale') view.spell.anim.draw(g, spellK, now / 1000);   // the dark sky goes under the units
    const order = b.units.slice().sort((p, q) => (view.disp.get(p.id).y - view.disp.get(q.id).y));
    for (const u of order) drawUnit(u, view.disp.get(u.id));
    drawSpellFx();
    if (view.spell) { view.spell.anim.update(spellK, dt); if (view.spell.anim.id !== 'gale') view.spell.anim.draw(g, spellK, now / 1000); }
    drawProjectiles();
    drawParticles(dt);
    view.P.draw(g);
    drawFloats(dt);
    g.restore();
    // lighting pass by weather and season
    const light = b.weather === 'rain' ? 'rgba(30,45,80,0.16)' : b.weather === 'fog' ? 'rgba(150,160,155,0.1)' : b.weather === 'snow' ? 'rgba(235,242,255,0.07)' : b.season === 2 ? 'rgba(255,150,60,0.05)' : null;
    if (light) { g.save(); g.globalCompositeOperation = b.weather === 'snow' ? 'screen' : 'soft-light'; g.fillStyle = light; g.fillRect(0, 0, view.w, view.h); g.restore(); }
    drawWeather(dt);
    // screen-edge vignette pulse on big hits, white flashes from spells
    if (view.pulse > 0.01) {
      const vg = g.createRadialGradient(view.w / 2, view.h / 2, Math.min(view.w, view.h) * 0.3, view.w / 2, view.h / 2, Math.max(view.w, view.h) * 0.7);
      vg.addColorStop(0, `rgba(${view.pulseCol},0)`); vg.addColorStop(1, `rgba(${view.pulseCol},${view.pulse})`);
      g.fillStyle = vg; g.fillRect(0, 0, view.w, view.h);
      view.pulse *= Math.pow(0.02, real);
    }
    if (view.whiteout > 0.01) { g.fillStyle = `rgba(${view.whiteCol},${view.whiteout})`; g.fillRect(0, 0, view.w, view.h); view.whiteout *= Math.pow(0.004, real); }
    drawCutin(real);
    requestAnimationFrame(frame);
  }

  function cleanup() {
    view.alive = false;
    window.removeEventListener('keydown', onKey);
    ro.disconnect();
  }

  // ---------------------------------------------------------------- intro
  layout();
  if (opts.debug) opts.debug({ b, view, act, play, px });   // test hook (tests/out pages only)
  buildRosters();
  spiritIcon();
  updateHud();
  requestAnimationFrame(frame);
  if (!opts.state && !b.winner) await intro();
  if (b.winner) await finish(); else schedule();
  return done;

  async function intro() {
    sfx.play('horn');
    modal.hidden = false;
    modal.innerHTML = '';
    const box = el('div', 'bt-intro');
    const bgIm = artImg(BATTLE_MOMENT.intro);
    if (bgIm) box.style.backgroundImage = `linear-gradient(rgba(10,8,14,0.35), rgba(10,8,14,0.75)), url("${art(BATTLE_MOMENT.intro)}")`;
    const leader = side => {
      const us = b.units.filter(u => u.side === side);
      return us.find(isRuler) || us.filter(u => u.vassalId).sort((p, q) => q.soldiers - p.soldiers)[0] || us.find(u => !isSpirit(u)) || us[0];
    };
    const sideBlock = side => {
      const d = el('div', 'bt-intro-side bt-intro-' + side);
      const cv = document.createElement('canvas'); cv.className = 'bt-intro-crest'; crestCanvasBig(cv, side);
      d.appendChild(cv);
      const L = leader(side);
      if (L) { const pt = portraitThumb(L); pt.className = 'bt-intro-portrait'; d.appendChild(pt); }
      const nm = el('div', 'bt-intro-name'); nm.textContent = S[side].full; nm.style.color = shade(S[side].color, 0.45); d.appendChild(nm);
      const ld = el('div', 'bt-intro-leader'); ld.textContent = L ? unitName(L) : ''; d.appendChild(ld);
      const tot = b.units.filter(u => u.side === side).reduce((s, u) => s + u.soldiers, 0);
      const tt = el('div', 'bt-intro-total'); tt.textContent = `${tot} soldiers · ${b.units.filter(u => u.side === side).length} units`; d.appendChild(tt);
      if (b.spirit[side]) { const sp = el('div', 'bt-intro-spirit'); sp.textContent = `Spirit: ${SPIRITS[b.spirit[side]].name}`; sp.style.color = SPIRITS[b.spirit[side]].color; d.appendChild(sp); }
      return d;
    };
    const head = el('div', 'bt-intro-head');
    const WX = { rain: 'Rain', snow: 'Snow (all ground troops move 1 less)', fog: 'Fog (ranged attacks reach 1 less)' };
    head.innerHTML = `<div class="bt-intro-title"></div><div class="bt-intro-sub"></div>`;
    head.querySelector('.bt-intro-title').textContent = b.siege ? `Siege of ${province ? province.name : 'the keep'}` : `Battle for ${province ? province.name : 'the field'}`;
    head.querySelector('.bt-intro-sub').textContent = [TERRAIN[b.terrain] ? '' : '', `${b.terrain[0].toUpperCase()}${b.terrain.slice(1)}`, b.weather ? WX[b.weather] : 'Clear skies',
      `Attackers win by holding the keep for a round or routing the defenders within ${MAX_ROUNDS} rounds`].filter(Boolean).join(' · ');
    const row = el('div', 'bt-intro-row');
    row.appendChild(sideBlock('attacker'));
    const vs = el('div', 'bt-intro-vs'); vs.textContent = 'VS'; row.appendChild(vs);
    row.appendChild(sideBlock('defender'));
    const go = el('button', 'bt-btn bt-primary bt-intro-go'); go.textContent = 'To battle!';
    box.append(head, row, go);
    modal.appendChild(box);
    await new Promise(res => {
      const t = setTimeout(close, (playerSide ? 9000 : 2600) / speed());
      function close() { clearTimeout(t); modal.removeEventListener('pointerdown', close); res(); }
      go.addEventListener('click', close);
      modal.addEventListener('pointerdown', close);
    });
    box.classList.add('bt-intro-out');
    await wait(250);
    modal.hidden = true;
    // The summoned spirits arrive.
    for (const side of ['attacker', 'defender']) {
      const su = spiritOf(b, side);
      if (su && !su.out && b.round === 1 && b.side === 'attacker' && !b.spiritUsed[side]) await spiritCutin(side, su.type, true);
    }
    const L = leader('attacker');
    if (L) showBark(L, 'start');
  }

  function crestCanvasBig(cv, side) {
    const s = 96; cv.width = s * 2; cv.height = s * 2; cv.style.width = s + 'px'; cv.style.height = s + 'px';
    const cg = cv.getContext('2d'); cg.scale(2, 2);
    crestAt(cg, side, s / 2, s / 2, s * 0.95);
  }
}

function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
