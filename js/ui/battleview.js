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
  spellCells, canCast, sideDone, statsOf, terrainAt, enemyOf, W, H, OBJ, TERRAIN, MAX_ROUNDS,
  moveRange, attackRange, expectedKills, DIR_NAMES,
} from '../battle/rules.js';
import { chooseAction } from '../battle/ai.js';
import { bark } from '../battle/barks.js';
import { sfx } from './sfx.js';
import {
  art, hasArt, TERRAIN_TILE, CLASH_CUTIN, SPIRIT_CUTIN, BATTLE_MOMENT, WEATHER_FX, BATTLE_FRAME,
  BATTLE_BACKDROP, CREST, houseTroopSprite,
} from '../data/art.js';
import { HOUSE_BY_ID } from '../data/houses.js';
import { VASSAL_BY_ID } from '../data/vassals.js';
import { SPIRITS } from '../data/spirits.js';
import { PROVINCES } from '../data/world.js';

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

// One soldier figure (or engine / beast), centre-bottom at (x, y), height s, facing 1/-1.
function drawFigure(g, type, x, y, s, col, acc, facing, t, ghostly = false) {
  g.save();
  g.translate(x, y); g.scale(facing, 1);
  if (ghostly || type === 'ghosts') g.globalAlpha *= 0.72;
  const skin = '#e6c39a', steel = '#c9ccd2', dark = '#2a2228', wood = '#6b4a2b';
  const lw = Math.max(1, s / 14);
  g.lineCap = 'round'; g.lineJoin = 'round';
  const stride = Math.sin(t * 6) * s * 0.03;
  const person = (bx, by, sc, weapon) => {
    // legs
    g.strokeStyle = dark; g.lineWidth = lw * sc;
    g.beginPath(); g.moveTo(bx - s * 0.06 * sc, by); g.lineTo(bx - s * 0.04 * sc + stride, by - s * 0.28 * sc);
    g.moveTo(bx + s * 0.06 * sc, by); g.lineTo(bx + s * 0.04 * sc - stride, by - s * 0.28 * sc); g.stroke();
    // body
    g.fillStyle = col; g.strokeStyle = dark; g.lineWidth = lw * 0.6 * sc;
    g.beginPath(); g.moveTo(bx - s * 0.13 * sc, by - s * 0.26 * sc); g.lineTo(bx - s * 0.1 * sc, by - s * 0.62 * sc);
    g.lineTo(bx + s * 0.1 * sc, by - s * 0.62 * sc); g.lineTo(bx + s * 0.13 * sc, by - s * 0.26 * sc); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = acc; g.fillRect(bx - s * 0.12 * sc, by - s * 0.34 * sc, s * 0.24 * sc, s * 0.05 * sc);
    // head + helmet
    g.fillStyle = skin; g.beginPath(); g.arc(bx, by - s * 0.73 * sc, s * 0.1 * sc, 0, 7); g.fill();
    g.fillStyle = weapon === 'hood' ? shade(col, -0.35) : steel;
    g.beginPath(); g.arc(bx, by - s * 0.76 * sc, s * 0.105 * sc, Math.PI, 0); g.fill();
    weaponOf(bx, by, sc, weapon);
  };
  const weaponOf = (bx, by, sc, w) => {
    g.lineWidth = lw * sc;
    if (w === 'sword') {
      g.strokeStyle = steel; g.beginPath(); g.moveTo(bx + s * 0.14 * sc, by - s * 0.45 * sc); g.lineTo(bx + s * 0.34 * sc, by - s * 0.78 * sc); g.stroke();
      g.fillStyle = shade(col, -0.2); g.strokeStyle = acc; g.lineWidth = lw * 0.6 * sc;
      g.beginPath(); g.ellipse(bx - s * 0.13 * sc, by - s * 0.45 * sc, s * 0.09 * sc, s * 0.14 * sc, 0, 0, 7); g.fill(); g.stroke();
    } else if (w === 'pike') {
      g.strokeStyle = wood; g.beginPath(); g.moveTo(bx - s * 0.1 * sc, by - s * 0.2 * sc); g.lineTo(bx + s * 0.55 * sc, by - s * 1.05 * sc); g.stroke();
      g.fillStyle = steel; g.beginPath(); g.moveTo(bx + s * 0.55 * sc, by - s * 1.05 * sc); g.lineTo(bx + s * 0.5 * sc, by - s * 0.93 * sc); g.lineTo(bx + s * 0.6 * sc, by - s * 0.95 * sc); g.fill();
    } else if (w === 'bow') {
      g.strokeStyle = wood; g.beginPath(); g.arc(bx + s * 0.16 * sc, by - s * 0.5 * sc, s * 0.22 * sc, -1.2, 1.2); g.stroke();
      g.strokeStyle = 'rgba(240,240,220,0.8)'; g.lineWidth = lw * 0.4 * sc; g.beginPath(); g.moveTo(bx + s * 0.23 * sc, by - s * 0.7 * sc); g.lineTo(bx + s * 0.23 * sc, by - s * 0.3 * sc); g.stroke();
    } else if (w === 'crossbow') {
      g.strokeStyle = wood; g.beginPath(); g.moveTo(bx, by - s * 0.5 * sc); g.lineTo(bx + s * 0.3 * sc, by - s * 0.52 * sc); g.stroke();
      g.strokeStyle = steel; g.beginPath(); g.moveTo(bx + s * 0.26 * sc, by - s * 0.62 * sc); g.lineTo(bx + s * 0.26 * sc, by - s * 0.42 * sc); g.stroke();
    } else if (w === 'staff') {
      g.strokeStyle = wood; g.beginPath(); g.moveTo(bx + s * 0.15 * sc, by); g.lineTo(bx + s * 0.18 * sc, by - s * 0.95 * sc); g.stroke();
      g.fillStyle = '#9dff8a'; g.shadowColor = '#9dff8a'; g.shadowBlur = s * 0.2; g.beginPath(); g.arc(bx + s * 0.18 * sc, by - s * 0.98 * sc, s * 0.06 * sc, 0, 7); g.fill(); g.shadowBlur = 0;
    } else if (w === 'fork') {
      g.strokeStyle = wood; g.beginPath(); g.moveTo(bx + s * 0.05 * sc, by - s * 0.1 * sc); g.lineTo(bx + s * 0.3 * sc, by - s * 0.9 * sc); g.stroke();
      g.strokeStyle = steel; g.lineWidth = lw * 0.5 * sc;
      for (const d of [-0.05, 0, 0.05]) { g.beginPath(); g.moveTo(bx + s * (0.3 + d) * sc, by - s * 0.9 * sc); g.lineTo(bx + s * (0.32 + d) * sc, by - s * 1.02 * sc); g.stroke(); }
    }
  };
  const beast = (bx, by, sc, body, barded, wolf = false) => {
    const gait = Math.sin(t * 8) * s * 0.05 * sc;
    g.strokeStyle = shade(body, -0.4); g.lineWidth = lw * sc;
    for (const [lx, ph] of [[-0.28, 1], [-0.16, -1], [0.18, -1], [0.3, 1]]) {
      g.beginPath(); g.moveTo(bx + s * lx * sc, by - s * 0.3 * sc); g.lineTo(bx + s * lx * sc + gait * ph, by); g.stroke();
    }
    g.fillStyle = body; g.beginPath(); g.ellipse(bx, by - s * 0.38 * sc, s * 0.36 * sc, s * 0.15 * sc, 0, 0, 7); g.fill();
    // neck + head
    g.beginPath(); g.moveTo(bx + s * 0.25 * sc, by - s * 0.45 * sc); g.lineTo(bx + s * 0.38 * sc, by - s * (wolf ? 0.55 : 0.7) * sc);
    g.lineTo(bx + s * (wolf ? 0.56 : 0.52) * sc, by - s * (wolf ? 0.5 : 0.62) * sc); g.lineTo(bx + s * 0.34 * sc, by - s * 0.36 * sc); g.fill();
    if (wolf) { g.beginPath(); g.moveTo(bx + s * 0.38 * sc, by - s * 0.56 * sc); g.lineTo(bx + s * 0.41 * sc, by - s * 0.66 * sc); g.lineTo(bx + s * 0.45 * sc, by - s * 0.55 * sc); g.fill(); }
    // tail
    g.strokeStyle = shade(body, -0.25); g.beginPath(); g.moveTo(bx - s * 0.35 * sc, by - s * 0.42 * sc); g.quadraticCurveTo(bx - s * 0.5 * sc, by - s * 0.35 * sc, bx - s * 0.46 * sc, by - s * 0.2 * sc); g.stroke();
    if (barded) { g.fillStyle = col; g.beginPath(); g.ellipse(bx, by - s * 0.33 * sc, s * 0.34 * sc, s * 0.1 * sc, 0, 0, Math.PI); g.fill(); g.fillStyle = acc; g.fillRect(bx - s * 0.3 * sc, by - s * 0.34 * sc, s * 0.6 * sc, s * 0.03 * sc); }
  };
  switch (type) {
    case 'footmen': person(0, 0, 1, 'sword'); break;
    case 'pikes': person(0, 0, 1, 'pike'); break;
    case 'archers': person(0, 0, 1, 'bow'); break;
    case 'bandits': person(0, 0, 1, 'crossbow'); g.fillStyle = shade(col, -0.35); g.beginPath(); g.arc(0, -s * 0.76, s * 0.11, Math.PI * 0.9, Math.PI * 2.1); g.fill(); break;
    case 'druids': {
      g.fillStyle = '#3f6a35'; g.beginPath(); g.moveTo(-s * 0.15, 0); g.lineTo(-s * 0.09, -s * 0.62); g.lineTo(s * 0.09, -s * 0.62); g.lineTo(s * 0.15, 0); g.fill();
      g.fillStyle = col; g.fillRect(-s * 0.1, -s * 0.36, s * 0.2, s * 0.05);
      g.fillStyle = skin; g.beginPath(); g.arc(0, -s * 0.72, s * 0.09, 0, 7); g.fill();
      g.fillStyle = '#2f5228'; g.beginPath(); g.arc(0, -s * 0.75, s * 0.11, Math.PI, 0); g.fill();
      weaponOf(0, 0, 1, 'staff'); break;
    }
    case 'militia': person(0, 0, 0.95, 'fork'); break;
    case 'horse': beast(0, 0, 1, '#7a5233', false); person(s * 0.02, -s * 0.36, 0.7, 'sword'); break;
    case 'knights': beast(0, 0, 1, '#5d4a3c', true); person(s * 0.02, -s * 0.38, 0.72, 'pike'); break;
    case 'wolfriders': beast(0, 0, 0.9, '#8d8f95', false, true); person(-s * 0.02, -s * 0.32, 0.65, 'sword'); break;
    case 'ghosts': {
      g.shadowColor = '#bfe6ff'; g.shadowBlur = s * 0.3;
      beast(0, 0, 1, '#cfe8f5', false); person(s * 0.02, -s * 0.36, 0.7, 'sword'); g.shadowBlur = 0; break;
    }
    case 'siege': {
      const sw = Math.sin(t * 1.5) * 0.15;
      g.fillStyle = wood; g.fillRect(-s * 0.4, -s * 0.3, s * 0.8, s * 0.1);
      g.strokeStyle = shade(wood, -0.3); g.lineWidth = lw * 1.2;
      g.beginPath(); g.moveTo(-s * 0.2, -s * 0.3); g.lineTo(0, -s * 0.65); g.lineTo(s * 0.2, -s * 0.3); g.stroke();
      g.save(); g.translate(0, -s * 0.6); g.rotate(-0.9 + sw); g.strokeStyle = wood; g.lineWidth = lw * 1.3;
      g.beginPath(); g.moveTo(-s * 0.15, 0); g.lineTo(s * 0.55, 0); g.stroke();
      g.fillStyle = '#555'; g.beginPath(); g.arc(s * 0.55, 0, s * 0.07, 0, 7); g.fill(); g.restore();
      g.fillStyle = '#3a2a1a'; for (const wx of [-0.3, 0.3]) { g.beginPath(); g.arc(s * wx, -s * 0.12, s * 0.12, 0, 7); g.fill(); g.fillStyle = shade(wood, 0.2); g.beginPath(); g.arc(s * wx, -s * 0.12, s * 0.04, 0, 7); g.fill(); g.fillStyle = '#3a2a1a'; }
      g.fillStyle = col; g.fillRect(-s * 0.38, -s * 0.32, s * 0.2, s * 0.06);
      break;
    }
    case 'golem': {
      const k = 1.5;
      g.fillStyle = '#8b6b4a'; g.strokeStyle = '#4a3420'; g.lineWidth = lw;
      g.fillRect(-s * 0.18 * k, -s * 0.3 * k, s * 0.12 * k, s * 0.3 * k); g.fillRect(s * 0.06 * k, -s * 0.3 * k, s * 0.12 * k, s * 0.3 * k);
      g.beginPath(); g.roundRect(-s * 0.25 * k, -s * 0.72 * k, s * 0.5 * k, s * 0.44 * k, s * 0.06); g.fill(); g.stroke();
      g.fillRect(-s * 0.36 * k, -s * 0.68 * k, s * 0.11 * k, s * 0.38 * k); g.fillRect(s * 0.25 * k, -s * 0.68 * k, s * 0.11 * k, s * 0.38 * k);
      g.beginPath(); g.roundRect(-s * 0.12 * k, -s * 0.88 * k, s * 0.24 * k, s * 0.18 * k, s * 0.04); g.fill(); g.stroke();
      g.fillStyle = '#ffcf6a'; g.shadowColor = '#ffb030'; g.shadowBlur = s * 0.25;
      g.fillRect(-s * 0.07 * k, -s * 0.82 * k, s * 0.04 * k, s * 0.03 * k); g.fillRect(s * 0.03 * k, -s * 0.82 * k, s * 0.04 * k, s * 0.03 * k);
      g.fillStyle = acc; g.fillRect(-s * 0.1 * k, -s * 0.55 * k, s * 0.2 * k, s * 0.05 * k); g.shadowBlur = 0;
      break;
    }
    case 'wyvern': {
      const flap = Math.sin(t * 7) * 0.5;
      const k = 1.3;
      g.translate(0, -s * 0.35 + Math.sin(t * 3) * s * 0.05);
      g.fillStyle = '#3f6a4a';
      for (const side of [1, -1]) {
        g.save(); g.scale(1, side === 1 ? 1 : 0.6); g.rotate(-flap * side * 0.3);
        g.beginPath(); g.moveTo(0, -s * 0.2 * k); g.lineTo(-s * 0.35 * k, -s * (0.7 + flap * 0.3) * k); g.lineTo(-s * 0.1 * k, -s * 0.35 * k); g.lineTo(s * 0.25 * k, -s * (0.65 + flap * 0.3) * k); g.closePath();
        g.globalAlpha *= side === 1 ? 1 : 0.7; g.fill(); g.restore();
      }
      g.fillStyle = '#4f8a5a'; g.beginPath(); g.ellipse(0, -s * 0.15 * k, s * 0.3 * k, s * 0.11 * k, 0, 0, 7); g.fill();
      g.beginPath(); g.moveTo(s * 0.2 * k, -s * 0.2 * k); g.quadraticCurveTo(s * 0.4 * k, -s * 0.45 * k, s * 0.5 * k, -s * 0.35 * k); g.lineTo(s * 0.32 * k, -s * 0.12 * k); g.fill();
      g.strokeStyle = '#4f8a5a'; g.lineWidth = lw; g.beginPath(); g.moveTo(-s * 0.28 * k, -s * 0.15 * k); g.quadraticCurveTo(-s * 0.5 * k, -s * 0.05 * k, -s * 0.55 * k, -s * 0.2 * k); g.stroke();
      g.fillStyle = col; g.fillRect(-s * 0.05 * k, -s * 0.28 * k, s * 0.12 * k, s * 0.05 * k);
      break;
    }
    default: person(0, 0, 1, 'sword');
  }
  g.restore();
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

// Silhouette of a spirit for summons without art.
function drawSpiritGlyph(g, id, x, y, s, t) {
  const sp = SPIRITS[id];
  g.save(); g.translate(x, y);
  g.shadowColor = sp.color; g.shadowBlur = s * 0.25;
  g.fillStyle = sp.color; g.strokeStyle = sp.color; g.lineCap = 'round'; g.lineWidth = s * 0.03;
  const breathe = 1 + Math.sin(t * 2) * 0.03;
  g.scale(breathe, breathe);
  if (id === 'ember') {
    g.beginPath(); g.ellipse(0, s * 0.1, s * 0.28, s * 0.14, 0, 0, 7); g.fill();
    g.beginPath(); g.moveTo(s * 0.2, s * 0.02); g.lineTo(s * 0.33, -s * 0.2); g.lineTo(s * 0.42, -s * 0.15); g.lineTo(s * 0.3, s * 0.1); g.fill();
    for (const side of [-1, 1]) { g.beginPath(); g.moveTo(s * 0.35, -s * 0.2); g.lineTo(s * (0.35 + side * 0.12), -s * 0.45); g.lineTo(s * (0.35 + side * 0.2), -s * 0.4); g.moveTo(s * (0.35 + side * 0.07), -s * 0.33); g.lineTo(s * (0.35 + side * 0.18), -s * 0.3); g.stroke(); }
    for (const lx of [-0.2, -0.1, 0.12, 0.22]) { g.beginPath(); g.moveTo(s * lx, s * 0.18); g.lineTo(s * lx, s * 0.42); g.stroke(); }
  } else if (id === 'tide') {
    g.lineWidth = s * 0.09; g.beginPath();
    for (let i = 0; i <= 40; i++) { const k = i / 40; const px = (k - 0.5) * s * 0.9; const py = Math.sin(k * 9 + t * 2) * s * 0.12 * (1 - k * 0.3) - k * s * 0.15; i ? g.lineTo(px, py) : g.moveTo(px, py); }
    g.stroke(); g.beginPath(); g.ellipse(s * 0.45, -s * 0.2, s * 0.09, s * 0.06, -0.4, 0, 7); g.fill();
  } else if (id === 'gale') {
    g.beginPath(); g.ellipse(0, 0, s * 0.18, s * 0.24, 0, 0, 7); g.fill();
    for (const side of [-1, 1]) { g.beginPath(); g.moveTo(side * s * 0.1, -s * 0.05); g.quadraticCurveTo(side * s * 0.45, -s * 0.35 + Math.sin(t * 5) * s * 0.05, side * s * 0.55, s * 0.05); g.quadraticCurveTo(side * s * 0.3, s * 0.05, side * s * 0.1, s * 0.12); g.fill(); }
    g.fillStyle = '#10142a'; g.shadowBlur = 0; for (const side of [-1, 1]) { g.beginPath(); g.arc(side * s * 0.07, -s * 0.08, s * 0.045, 0, 7); g.fill(); }
  } else if (id === 'stone') {
    g.beginPath(); g.roundRect(-s * 0.2, -s * 0.25, s * 0.4, s * 0.45, s * 0.05); g.fill();
    g.beginPath(); g.roundRect(-s * 0.1, -s * 0.42, s * 0.2, s * 0.16, s * 0.03); g.fill();
    g.fillRect(-s * 0.34, -s * 0.22, s * 0.12, s * 0.38); g.fillRect(s * 0.22, -s * 0.22, s * 0.12, s * 0.38);
    g.fillRect(-s * 0.16, s * 0.2, s * 0.12, s * 0.22); g.fillRect(s * 0.04, s * 0.2, s * 0.12, s * 0.22);
  } else if (id === 'dusk') {
    for (const side of [-1, 1]) {
      g.beginPath(); g.ellipse(side * s * 0.22, -s * 0.08, s * 0.24, s * 0.17, side * 0.4 + Math.sin(t * 4) * 0.1 * side, 0, 7); g.fill();
      g.beginPath(); g.ellipse(side * s * 0.16, s * 0.15, s * 0.14, s * 0.1, side * -0.3, 0, 7); g.fill();
    }
    g.fillStyle = '#1a1028'; g.shadowBlur = 0; for (const side of [-1, 1]) { g.beginPath(); g.arc(side * s * 0.25, -s * 0.1, s * 0.05, 0, 7); g.fill(); }
    g.fillStyle = shade(sp.color, -0.3); g.beginPath(); g.ellipse(0, 0, s * 0.05, s * 0.2, 0, 0, 7); g.fill();
  }
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
  // Dark banner colours (e.g. ravens) get a lighter figure colour so units read on the board.
  const figCol = side => { const [r, g, bb] = hexToRgb(S[side].color); return (r + g + bb) / 3 < 70 ? shade(S[side].color, 0.35) : S[side].color; };
  const province = PROVINCES[b.provinceId] || null;
  const vassalOf = u => (u.vassalId && VASSAL_BY_ID[u.vassalId]) || null;
  const unitName = u => vassalOf(u)?.name || (u.kind === 'company' ? statsOf(u.type).name : u.kind === 'militia' ? 'Militia' : statsOf(u.type).name);
  const isRuler = u => u.ruler || (u.vassalId && b.houses[u.side] && HOUSE_BY_ID[b.houses[u.side]]?.ruler === u.vassalId);
  const portraitSlot = u => vassalOf(u)?.portrait ?? null;
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
  for (const u of b.units) { want.add(CLASH_CUTIN[u.type]); want.add(portraitSlot(u)); const s = spriteSlot(u); if (s) want.add(s.slot); }
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
  };
  for (const u of b.units) view.disp.set(u.id, { x: u.x, y: u.y, alpha: u.out ? 0 : 1, flash: 0, phase: hash(u.x, u.y, 7) * 6.28, lunge: null });

  const speed = () => prefs.speed;
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
      const rise = clamp((view.now - (w.born || 0)) / 400, 0, 1);
      if (!w.born) w.born = view.now;
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

  function figureLayout(u) {
    const big = { golem: 1, wyvern: 1, siege: 2, horse: 3, knights: 3, wolfriders: 3, ghosts: 3 }[u.type] || 5;
    const n = clamp(Math.ceil(big * u.soldiers / u.start - 1e-9), 1, big);
    const P = {
      1: [[0, 0.1]], 2: [[-0.17, 0.02], [0.17, 0.16]], 3: [[-0.2, -0.04], [0.2, 0.0], [0, 0.2]],
      4: [[-0.2, -0.06], [0.2, -0.06], [-0.2, 0.18], [0.2, 0.18]], 5: [[-0.22, -0.08], [0.22, -0.08], [0, 0.04], [-0.22, 0.2], [0.22, 0.2]],
    };
    return P[n];
  }

  function drawUnit(u, d) {
    const { cs } = view;
    if (d.alpha <= 0.01) return;
    const base = { x: view.ox + (d.x + 0.5) * cs, y: view.oy + (d.y + 0.5) * cs };
    let lx = 0, ly = 0;
    if (d.lunge) { const k = Math.sin(Math.PI * d.lunge.p); lx = d.lunge.dx * k * cs * 0.3; ly = d.lunge.dy * k * cs * 0.3; }
    const cx = base.x + lx, cy = base.y + ly;
    const facing = u.side === 'attacker' ? 1 : -1;
    const col = figCol(u.side), acc = S[u.side].accent;
    const done = !u.out && u.side === b.side && (u.acted) && !isAI(u.side);
    g.save();
    g.globalAlpha = d.alpha * (done ? 0.7 : 1);
    // selection ring + shadow
    if (view.sel === u.id) {
      g.strokeStyle = `rgba(255,215,110,${0.7 + 0.3 * Math.sin(view.now / 140)})`; g.lineWidth = 2.5;
      g.beginPath(); g.ellipse(cx, cy + cs * 0.32, cs * 0.46, cs * 0.17, 0, 0, 7); g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(cx, cy + cs * 0.32, cs * 0.4, cs * 0.13, 0, 0, 7); g.fill();
    g.fillStyle = rgba(S[u.side].color, 0.55); g.beginPath(); g.ellipse(cx, cy + cs * 0.32, cs * 0.36, cs * 0.1, 0, 0, 7); g.fill();
    const sprite = spriteSlot(u);
    const im = sprite && artImg(sprite.slot);
    const figs = figureLayout(u).slice().sort((a, b2) => a[1] - b2[1]);
    const t = view.now / 1000;
    figs.forEach(([fx, fy], i) => {
      const bob = Math.sin(t * 2.2 + d.phase + i * 1.3) * cs * 0.025;
      const x = cx + fx * cs * facing, y = cy + fy * cs + cs * 0.22 + bob;
      if (im) {
        const src = sprite.tint ? tinted(im, S[u.side].color, sprite.slot) : im;
        const s = cs * (figs.length === 1 ? 1.0 : 0.7);
        g.save(); g.translate(x, y); g.scale(facing, 1); g.drawImage(src, -s / 2, -s * 0.92, s, s); g.restore();
      } else {
        const s = cs * (figs.length >= 4 ? 0.5 : figs.length === 3 ? 0.56 : 0.62);
        drawFigure(g, u.type, x, y, s, col, acc, facing, t + d.phase + i * 0.4);
      }
    });
    // banner on the lead
    const bx = cx - cs * 0.32 * facing, by = cy - cs * 0.42;
    g.strokeStyle = '#2a1d10'; g.lineWidth = Math.max(1.2, cs / 28);
    g.beginPath(); g.moveTo(bx, by + cs * 0.55); g.lineTo(bx, by); g.stroke();
    const wave = Math.sin(t * 4 + d.phase) * cs * 0.03;
    g.fillStyle = S[u.side].color; g.beginPath(); g.moveTo(bx, by); g.quadraticCurveTo(bx + cs * 0.12 * facing, by - wave, bx + cs * 0.24 * facing, by + cs * 0.04);
    g.lineTo(bx + cs * 0.2 * facing, by + cs * 0.12); g.quadraticCurveTo(bx + cs * 0.1 * facing, by + cs * 0.14 + wave, bx, by + cs * 0.16); g.fill();
    g.strokeStyle = acc; g.lineWidth = 1; g.stroke();
    if (isRuler(u)) { g.fillStyle = '#ffd66e'; g.font = `${Math.max(8, cs * 0.22)}px serif`; g.textAlign = 'center'; g.fillText('♛', bx + cs * 0.1 * facing, by - cs * 0.04); }
    // hit flash
    if (d.flash > 0) {
      g.globalCompositeOperation = 'lighter'; g.fillStyle = `rgba(255,240,220,${d.flash * 0.6})`;
      g.beginPath(); g.arc(cx, cy, cs * 0.45, 0, 7); g.fill(); g.globalCompositeOperation = 'source-over';
    }
    // strength bar + count
    const frac = u.soldiers / u.start;
    const bw = cs * 0.78, bh = Math.max(3, cs * 0.08), bxx = cx - bw / 2, byy = cy + cs * 0.42;
    g.fillStyle = 'rgba(0,0,0,0.65)'; g.fillRect(bxx - 1, byy - 1, bw + 2, bh + 2);
    g.fillStyle = frac > 0.6 ? '#7fcf6a' : frac > 0.35 ? '#e6c04a' : '#e0564a'; g.fillRect(bxx, byy, bw * clamp(frac, 0, 1), bh);
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(bxx + bw * 0.3, byy, 1, bh);   // rout line
    const fs = Math.max(9, Math.round(cs * 0.24));
    g.font = `700 ${fs}px Cinzel, Georgia, serif`; g.textAlign = 'center';
    const label = String(u.soldiers), tw = g.measureText(label).width + 6;
    const tx = cx + cs * 0.3 * facing, ty = cy - cs * 0.3;
    g.fillStyle = 'rgba(15,12,18,0.85)'; g.beginPath(); g.roundRect(tx - tw / 2, ty - fs * 0.8, tw, fs * 1.05, 3); g.fill();
    g.strokeStyle = rgba(S[u.side].color, 0.9); g.lineWidth = 1; g.stroke();
    g.fillStyle = '#f5ead0'; g.fillText(label, tx, ty);
    // status
    let sx = cx - cs * 0.38;
    if (u.slowed) { g.fillStyle = '#5ab4ff'; g.beginPath(); g.arc(sx, cy - cs * 0.38, cs * 0.07, 0, 7); g.fill(); sx += cs * 0.17; }
    if (u.confused) { g.strokeStyle = '#b48aff'; g.lineWidth = 1.5; g.beginPath(); g.arc(sx, cy - cs * 0.38, cs * 0.07, 0, 5); g.stroke(); }
    g.restore();
  }

  function drawProjectiles() {
    const now = view.now;
    view.projectiles = view.projectiles.filter(p => {
      const k = clamp((now - p.t0) / p.dur, 0, 1);
      const x = lerp(p.a.x, p.b.x, k), y = lerp(p.a.y, p.b.y, k) - Math.sin(Math.PI * k) * p.arc;
      const k2 = Math.min(1, k + 0.03);
      const x2 = lerp(p.a.x, p.b.x, k2), y2 = lerp(p.a.y, p.b.y, k2) - Math.sin(Math.PI * k2) * p.arc;
      const ang = Math.atan2(y2 - y, x2 - x);
      g.save(); g.translate(x, y); g.rotate(ang);
      if (p.kind === 'stone') {
        g.fillStyle = '#5a524a'; g.beginPath(); g.arc(0, 0, view.cs * 0.12, 0, 7); g.fill();
        g.fillStyle = 'rgba(255,140,50,0.4)'; g.beginPath(); g.arc(-view.cs * 0.1, 0, view.cs * 0.08, 0, 7); g.fill();
      } else {
        for (let i = 0; i < p.count; i++) {
          const oy = (i - (p.count - 1) / 2) * view.cs * 0.08, ox = -i * view.cs * 0.05;
          g.strokeStyle = '#e8dcc0'; g.lineWidth = 1.3; g.beginPath(); g.moveTo(ox - view.cs * 0.18, oy); g.lineTo(ox + view.cs * 0.08, oy); g.stroke();
          g.fillStyle = '#ccc'; g.beginPath(); g.moveTo(ox + view.cs * 0.12, oy); g.lineTo(ox + view.cs * 0.06, oy - 2); g.lineTo(ox + view.cs * 0.06, oy + 2); g.fill();
        }
      }
      g.restore();
      return k < 1;
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

  function cutinBackground(cg, slot, x, y, w, h, k, colA, colB, type) {
    const im = artImg(slot);
    if (im) {
      cg.save(); cg.beginPath(); cg.rect(x, y, w, h); cg.clip();
      drawCover(cg, im, x, y, w, h, 1.08 + 0.1 * k, 0.35 + 0.3 * k, 0.5);
      cg.restore();
      return;
    }
    cg.save(); cg.beginPath(); cg.rect(x, y, w, h); cg.clip();
    const grd = cg.createLinearGradient(x, y, x + w, y + h);
    grd.addColorStop(0, shade(colA, -0.45)); grd.addColorStop(0.5, '#1a1420'); grd.addColorStop(1, shade(colB, -0.45));
    cg.fillStyle = grd; cg.fillRect(x, y, w, h);
    // speed lines
    cg.strokeStyle = 'rgba(255,255,255,0.08)'; cg.lineWidth = 2;
    for (let i = 0; i < 30; i++) {
      const yy = y + h * hash(i, 1, 3), xx = x + ((hash(i, 2, 3) * w * 1.5 + k * w * 1.4 * (0.6 + hash(i, 4, 3))) % (w * 1.4)) - w * 0.2;
      cg.beginPath(); cg.moveTo(xx, yy); cg.lineTo(xx + w * 0.15, yy); cg.stroke();
    }
    // ground and charging silhouettes, panning
    cg.fillStyle = 'rgba(0,0,0,0.45)'; cg.fillRect(x, y + h * 0.78, w, h * 0.22);
    const pan = (k * 0.12) * w;
    for (let i = 0; i < 9; i++) {
      const fx = x + w * (0.08 + i * 0.1) - pan, fy = y + h * (0.82 + 0.06 * hash(i, 5, 5));
      cg.save(); cg.globalAlpha = 0.55; drawFigure(cg, type, fx, fy, h * (0.32 + 0.1 * hash(i, 6, 6)), '#15111a', '#2a2430', 1, view.now / 1000 + i); cg.restore();
    }
    cg.restore();
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
    else {   // company / militia: draw the troop as the card
      const grd = cg.createLinearGradient(x, y, x, y + h); grd.addColorStop(0, shade(S[side].color, -0.3)); grd.addColorStop(1, '#120e16');
      cg.fillStyle = grd; cg.fillRect(x, y, w, h);
      drawFigure(cg, u.type, x + w / 2, y + h * 0.88, h * 0.55, figCol(side), S[side].accent, flip ? -1 : 1, view.now / 1000);
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

  // A clash cut-in: attacker left, defender right (from the attacker's point of view).
  function clashCutin(att, def, hit, counter) {
    if (prefs.cutins === 'off') return Promise.resolve();
    const short = prefs.cutins === 'short';
    const dur = short ? 750 : (counter ? 1750 : 1300);
    const strikeAt = short ? 0.3 : (counter ? 0.3 : 0.4);
    const counterAt = 0.62;
    const aStart = att.soldiers + (counter ? counter.killed : 0), dStart = def.soldiers + hit.killed;
    let struck = false, countered = false;
    const parts = [];
    const sparks = (x, y, n, col) => { for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, v = 120 + Math.random() * 380; parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, life: 0.5 + Math.random() * 0.4, max: 0.9, size: 1.5 + Math.random() * 2.5, color: col, grav: 500 }); } };
    const dust = (x, y, n) => { for (let i = 0; i < n; i++) parts.push({ x: x + (Math.random() - 0.5) * 80, y, vx: (Math.random() - 0.5) * 60, vy: -20 - Math.random() * 40, life: 0.9, max: 0.9, size: 20 + Math.random() * 25, color: 'rgba(170,150,120,0.35)', puff: true }); };
    return showCutin(dur, (cg, W2, H2, k, dt) => {
      const bd = band(W2, H2, k, short ? 0.15 : 0.1, short ? 0.15 : 0.1);
      let shake = 0;
      if (k > strikeAt && k < strikeAt + 0.12) shake = (1 - (k - strikeAt) / 0.12) * 12;
      if (counter && k > counterAt && k < counterAt + 0.1) shake = Math.max(shake, (1 - (k - counterAt) / 0.1) * 7);
      const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;
      cg.save(); cg.translate(sx, sy);
      // dim the board
      cg.fillStyle = `rgba(5,4,8,${0.55 * bd.open})`; cg.fillRect(-20, -20, W2 + 40, H2 + 40);
      cutinBackground(cg, CLASH_CUTIN[att.type] ?? CLASH_CUTIN.footmen, 0, bd.y, W2, bd.h, k, S[att.side].color, S[def.side].color, att.type);
      // gold rules
      cg.fillStyle = '#d8b05a'; cg.fillRect(0, bd.y - 2, W2, 2); cg.fillRect(0, bd.y + bd.h, W2, 2);
      if (bd.open > 0.6) {
        const ph = bd.full * 0.62, pw = ph * 0.8;
        const slideA = k < 0.18 ? easeOut(k / 0.18) : 1, slideD = k < 0.22 ? easeOut(Math.max(0, k - 0.04) / 0.18) : 1;
        const ax = lerp(-pw, W2 * 0.05, slideA), dx = lerp(W2 + pw, W2 * 0.95 - pw, slideD);
        const py = bd.y + (bd.h - ph) / 2 - bd.full * 0.04;
        const aLunge = k > strikeAt - 0.08 && k < strikeAt + 0.1 ? Math.sin((k - strikeAt + 0.08) / 0.18 * Math.PI) * W2 * 0.03 : 0;
        const dLunge = counter && k > counterAt - 0.08 && k < counterAt + 0.1 ? -Math.sin((k - counterAt + 0.08) / 0.18 * Math.PI) * W2 * 0.03 : 0;
        portraitCard(cg, att, ax + aLunge, py, pw, ph, att.side, false);
        portraitCard(cg, def, dx + dLunge, py, pw, ph, def.side, true);
        const cs2 = ph * 0.38;
        crestAt(cg, att.side, ax + aLunge + cs2 * 0.1, py + cs2 * 0.05, cs2 * 0.8);
        crestAt(cg, def.side, dx + pw + dLunge - cs2 * 0.1, py + cs2 * 0.05, cs2 * 0.8);
        const fs = Math.max(12, bd.full * 0.07);
        text(cg, unitName(att), ax, py + ph + fs * 1.3, fs, '#f5ead0');
        text(cg, statsOf(att.type).name, ax, py + ph + fs * 2.35, fs * 0.7, '#cbb98e', 'left', 500);
        text(cg, unitName(def), dx + pw, py + ph + fs * 1.3, fs, '#f5ead0', 'right');
        text(cg, statsOf(def.type).name, dx + pw, py + ph + fs * 2.35, fs * 0.7, '#cbb98e', 'right', 500);
        // ticking counts
        const tickD = clamp((k - strikeAt) / 0.18, 0, 1), tickA = counter ? clamp((k - counterAt) / 0.18, 0, 1) : 0;
        const dNow = Math.round(lerp(dStart, def.soldiers, easeOut(tickD)));
        const aNow = Math.round(lerp(aStart, att.soldiers, easeOut(tickA)));
        const big = Math.max(18, bd.full * 0.13);
        text(cg, String(aNow), ax + pw + cs2 * 0.2 + aLunge, py + ph * 0.95, big, '#ffffff', 'left', 900);
        text(cg, String(dNow), dx - cs2 * 0.2 + dLunge, py + ph * 0.95, big, '#ffffff', 'right', 900);
        // strike
        const midX = W2 / 2, midY = bd.y + bd.h * 0.45;
        if (k >= strikeAt && !struck) { struck = true; if (hit.ranged) sfx.play('hit'); else clashSfx(att.type); sparks(midX + W2 * 0.12, midY, 50, '#ffd080'); sparks(midX + W2 * 0.12, midY, 25, '#ffffff'); dust(midX + W2 * 0.12, bd.y + bd.h * 0.85, 8); }
        if (counter && k >= counterAt && !countered) { countered = true; sfx.play('clash'); sparks(midX - W2 * 0.12, midY, 30, '#ffb070'); }
        if (k >= strikeAt) {
          const kk = clamp((k - strikeAt) / 0.5, 0, 1);
          text(cg, '-' + hit.killed, midX + W2 * 0.13, midY - easeOut(kk) * bd.full * 0.12, big * (1.25 - 0.25 * kk), '#ff6a50', 'center', 900);
          if (hit.rout) text(cg, def.out === 'dead' ? 'DESTROYED' : 'ROUTED', midX + W2 * 0.13, midY + big * 0.9, big * 0.55, '#ffd27a', 'center', 900);
        }
        if (counter && k >= counterAt) {
          const kk = clamp((k - counterAt) / 0.4, 0, 1);
          text(cg, '-' + counter.killed, midX - W2 * 0.13, midY - easeOut(kk) * bd.full * 0.12, big * (1.15 - 0.2 * kk), '#ff9a70', 'center', 900);
          text(cg, 'COUNTER', midX - W2 * 0.13, midY + big * 0.8, big * 0.45, '#ffd27a', 'center', 900);
        }
      }
      // particles
      cg.save(); cg.beginPath(); cg.rect(0, bd.y, W2, bd.h); cg.clip();
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]; p.life -= dt; if (p.life <= 0) { parts.splice(i, 1); continue; }
        p.vy += (p.grav || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        cg.globalAlpha = clamp(p.life / p.max, 0, 1);
        if (p.puff) { const gr = cg.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size); gr.addColorStop(0, p.color); gr.addColorStop(1, 'rgba(0,0,0,0)'); cg.fillStyle = gr; cg.beginPath(); cg.arc(p.x, p.y, p.size, 0, 7); cg.fill(); }
        else { cg.globalCompositeOperation = 'lighter'; cg.fillStyle = p.color; cg.beginPath(); cg.arc(p.x, p.y, p.size, 0, 7); cg.fill(); cg.globalCompositeOperation = 'source-over'; }
      }
      cg.restore();
      // hit flash
      if (k > strikeAt && k < strikeAt + 0.06) { cg.fillStyle = `rgba(255,250,235,${0.55 * (1 - (k - strikeAt) / 0.06)})`; cg.fillRect(0, bd.y, W2, bd.h); }
      if (counter && k > counterAt && k < counterAt + 0.05) { cg.fillStyle = `rgba(255,220,200,${0.35 * (1 - (k - counterAt) / 0.05)})`; cg.fillRect(0, bd.y, W2, bd.h); }
      cg.restore();
    });
  }

  function spiritCutin(side, spiritId) {
    const sp = SPIRITS[spiritId];
    sfx.play('spell'); sfx.play('wind');
    if (prefs.cutins === 'off') return Promise.resolve();
    const short = prefs.cutins === 'short';
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
      } else {
        cg.save(); cg.globalAlpha = appear;
        drawSpiritGlyph(cg, spiritId, W2 / 2, H2 * 0.45, Math.min(W2, H2) * 0.55 * (0.9 + 0.1 * k), view.now / 1000);
        cg.restore();
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
      text(cg, sp.spell, W2 / 2, H2 * 0.82 + fs * 1.0, fs * 0.6, sp.color, 'center', 700);
      text(cg, `called by ${S[side].full}`, W2 / 2, H2 * 0.82 + fs * 1.7, fs * 0.38, '#d9ccb0', 'center', 500, 'EB Garamond');
      cg.globalAlpha = 1;
    });
  }

  // Outcome moments: a banner strip with art, a title and a bark.
  function momentCutin(slot, title, sub, color = '#ffd27a') {
    if (prefs.cutins === 'off') { showBanner(title); return Promise.resolve(); }
    const short = prefs.cutins === 'short';
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
    else { cg.fillStyle = shade(S[u.side].color, -0.5); cg.fillRect(0, 0, 72, 90); drawFigure(cg, u.type, 36, 80, 50, figCol(u.side), S[u.side].accent, 1, 0); }
    return c;
  }
  const rosterEls = new Map();
  function buildRosters() {
    for (const side of ['attacker', 'defender']) {
      const box = root.querySelector(side === 'attacker' ? '.bt-roster-a' : '.bt-roster-d');
      box.innerHTML = '';
      for (const u of b.units.filter(x => x.side === side)) {
        const card = el('button', 'bt-card');
        card.appendChild(portraitThumb(u));
        const info = el('div', 'bt-card-info');
        info.innerHTML = `<div class="bt-card-name"></div><div class="bt-card-type"></div><div class="bt-card-bar"><i></i></div><div class="bt-card-status"></div>`;
        info.querySelector('.bt-card-name').textContent = (isRuler(u) ? '♛ ' : '') + unitName(u);
        info.querySelector('.bt-card-type').textContent = statsOf(u.type).name + (u.kind === 'company' ? ' (company)' : '');
        card.appendChild(info);
        card.addEventListener('click', () => { if (!u.out) { view.sel = u.id; view.mode = 'idle'; showTip(u); } });
        card.addEventListener('pointerenter', () => { if (!u.out) view.hover = { x: u.x, y: u.y }; });
        box.appendChild(card);
        rosterEls.set(u.id, card);
      }
    }
  }
  function updateHud() {
    for (const u of b.units) {
      const c = rosterEls.get(u.id);
      if (!c) continue;
      c.querySelector('.bt-card-bar i').style.width = (100 * u.soldiers / u.start) + '%';
      const st = u.out === 'dead' ? 'Destroyed' : u.out === 'routed' ? 'Routed' : u.out === 'fled' ? 'Withdrew' :
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
    spBtn.hidden = !mySp;
    if (mySp) {
      spBtn.querySelector('span').textContent = b.spiritUsed[playerSide] ? `${SPIRITS[mySp].name} (spent)` : `${SPIRITS[mySp].spell}`;
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
    else { cg.fillStyle = '#120e18'; cg.beginPath(); cg.arc(20, 20, 19, 0, 7); cg.fill(); drawSpiritGlyph(cg, mySp, 20, 21, 34, 0); }
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
    hd.querySelector('.bt-tip-sub2').textContent = v ? `${v.title} · Might ${u.might} · Wits ${u.wits}` : (u.kind === 'company' ? 'Hired company' : 'Local militia');
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
        const st = statsOf(u.type);
        if (['horse', 'knights', 'wolfriders'].includes(u.type)) sfx.play('hooves');
        const dist2 = Math.abs(e.to.x - e.from.x) + Math.abs(e.to.y - e.from.y);
        const from = { ...e.from };
        await tween(140 + dist2 * 70, k => { const kk = ease(k); d.x = lerp(from.x, e.to.x, kk); d.y = lerp(from.y, e.to.y, kk); if (Math.random() < 0.3) dustAt(d.x, d.y, 1); });
        d.x = e.to.x; d.y = e.to.y;
        void st;
      } else if (e.t === 'hit' && e.confused) {
        const t = getUnit(b, e.target), d = view.disp.get(t.id);
        d.flash = 1; sfx.play('hit');
        floatText(t.x, t.y, '-' + e.killed, '#c9a0ff');
        const src = getUnit(b, e.unit); floatText(src.x, src.y, 'Bewildered!', '#c9a0ff');
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
        // counter without preceding hit (should not happen) — show a number
        floatText(getUnit(b, e.target).x, getUnit(b, e.target).y, '-' + e.killed, '#ff9a70');
      } else if (e.t === 'rout') {
        await routUnit(getUnit(b, e.unit));
      } else if (e.t === 'spell') {
        await spellSequence(e);
      } else if (e.t === 'heal') {
        const u = getUnit(b, e.unit);
        floatText(u.x, u.y, '+' + e.amount, '#8dffa0');
        spawn(10, () => { const p = px(u.x, u.y); return { x: p.x + (Math.random() - 0.5) * view.cs * 0.6, y: p.y + view.cs * 0.2, vx: 0, vy: -40 - Math.random() * 30, life: 0.9, max: 0.9, size: 2.2, color: '#9dff9a', add: true }; });
      } else if (e.t === 'gate') {
        sfx.play('gate');
        const u = getUnit(b, e.unit);
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
  }

  function dustAt(cx, cy, n) {
    const p = px(cx, cy);
    spawn(n, () => ({ x: p.x + (Math.random() - 0.5) * view.cs * 0.5, y: p.y + view.cs * 0.35, vx: (Math.random() - 0.5) * 20, vy: -10 - Math.random() * 15, life: 0.6, max: 0.6, size: view.cs * 0.18, color: b.season === 3 ? 'rgba(240,245,255,0.45)' : 'rgba(170,150,110,0.4)', kind: 'puff' }));
  }

  async function attackSequence(att, def, hit, counter, routed, counterRouted) {
    const dA = view.disp.get(att.id), dD = view.disp.get(def.id);
    const ranged = hit.ranged;
    if (ranged) {
      const a = px(att.x, att.y), bb = px(def.x, def.y);
      const kind = att.type === 'siege' ? 'stone' : 'arrow';
      const dur = (kind === 'stone' ? 650 : 420) / speed();
      if (kind === 'stone') sfx.play('catapult'); else sfx.play('arrows');
      view.projectiles.push({ a: { x: a.x, y: a.y - view.cs * 0.3 }, b: bb, t0: view.now, dur, kind, arc: view.cs * (kind === 'stone' ? 2.4 : 1.1) + Math.abs(bb.x - a.x) * 0.15, count: kind === 'arrow' ? 3 : 1 });
      await wait(kind === 'stone' ? 650 : 420);
    } else {
      dA.lunge = { p: 0, dx: Math.sign(def.x - att.x), dy: Math.sign(def.y - att.y) };
      await tween(160, k => { dA.lunge.p = k * 0.5; });
    }
    // cut-in for the exchange (melee always; ranged only in Full mode)
    const showClash = prefs.cutins !== 'off' && (!ranged || prefs.cutins === 'full');
    if (showClash) {
      if (Math.random() < 0.35 || routed) showBark(att, 'attack');
      await clashCutin(att, def, hit, counter);
    } else if (!ranged) clashSfx(att.type);
    else sfx.play('hit');
    // board impact
    dD.flash = 1; view.shake = Math.max(view.shake, ranged ? 4 : 6);
    const pD = px(def.x, def.y);
    spawn(16, () => { const a = Math.random() * 6.28, v = 60 + Math.random() * 160; return { x: pD.x, y: pD.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: 0.5, max: 0.5, size: 2, color: ranged ? '#f0e0c0' : '#ffd080', grav: 300, add: true }; });
    dustAt(def.x, def.y, 4);
    floatText(def.x, def.y, '-' + hit.killed, '#ff6a50', true);
    if (counter) { dA.flash = 0.8; floatText(att.x, att.y, '-' + counter.killed, '#ff9a70'); }
    if (dA.lunge) { await tween(160, k => { dA.lunge.p = 0.5 + k * 0.5; }); dA.lunge = null; }
    await tween(220, k => { dD.flash = 1 - k; dA.flash = Math.min(dA.flash, 1 - k); });
    // last stand: a ruler's unit falls below 30%
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
    sfx.play('rout');
    floatText(u.x, u.y, u.out === 'dead' ? 'Destroyed!' : 'Routed!', '#ffd27a', true);
    showBark(u, 'rout');
    const anyLeft = liveUnits(b, u.side).length;
    if (prefs.cutins === 'full' && (isRuler(u) || u.start >= 150 || !anyLeft)) {
      await momentCutin(BATTLE_MOMENT.rout, u.out === 'dead' ? 'Destroyed' : 'Routed', `${unitName(u)} breaks and flees the field.`, '#ffc070');
    }
    const fx = u.side === 'attacker' ? -1 : 1;
    const sx = d.x;
    await tween(500, k => { d.alpha = 1 - k; d.x = sx + fx * k * 0.6; });
    d.alpha = 0;
    if (view.sel === u.id) view.sel = null;
  }

  async function spellSequence(e) {
    const sp = SPIRITS[e.spirit];
    await spiritCutin(e.side, e.spirit);
    showBanner(`${sp.name}: ${sp.spell}`, e.side);
    view.fx = { t0: view.now, dur: 1400 / speed(), cells: e.cells, spirit: e.spirit, bolts: e.spirit === 'gale' };
    view.shake = 8;
    // element particles
    for (const c of e.cells) {
      const p = px(c.x, c.y), cs = view.cs;
      if (e.spirit === 'ember') spawn(14, () => ({ x: p.x + (Math.random() - 0.5) * cs, y: p.y + cs * 0.3, vx: (Math.random() - 0.5) * 30, vy: -80 - Math.random() * 120, life: 1 + Math.random() * 0.6, max: 1.6, size: 2 + Math.random() * 2.5, color: Math.random() < 0.5 ? '#ffb040' : '#ff5a20', add: true }));
      else if (e.spirit === 'tide') spawn(12, () => { const a = -Math.PI / 2 + (Math.random() - 0.5) * 2; const v = 80 + Math.random() * 140; return { x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.9, max: 0.9, size: 2 + Math.random() * 2, color: '#a8dcff', grav: 400, add: true }; });
      else if (e.spirit === 'gale') { spawn(10, () => { const a = Math.random() * 6.28, v = 100 + Math.random() * 200; return { x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.4, max: 0.4, size: 2, color: '#e8f0ff', add: true }; }); }
      else if (e.spirit === 'stone') spawn(10, () => ({ x: p.x + (Math.random() - 0.5) * cs, y: p.y + cs * 0.3, vx: (Math.random() - 0.5) * 80, vy: -120 - Math.random() * 100, life: 0.9, max: 0.9, size: 3 + Math.random() * 4, color: '#8a7050', grav: 500, kind: 'rock' }));
      else if (e.spirit === 'dusk') spawn(5, () => ({ x: p.x + (Math.random() - 0.5) * cs, y: p.y + (Math.random() - 0.5) * cs, vx: (Math.random() - 0.5) * 20, vy: -10, life: 1.6, max: 1.6, size: cs * 0.5, color: 'rgba(150,100,255,0.45)', kind: 'puff' }));
    }
    if (e.spirit === 'gale') { sfx.play('hit'); sfx.play('gate', { delay: 0.1 }); }
    await wait(700);
    for (const h of e.hits) {
      const u = getUnit(b, h.unit);
      if (h.killed) floatText(u.x, u.y, '-' + h.killed, sp.color, true);
      else floatText(u.x, u.y, sp.spell, sp.color);
      view.disp.get(u.id).flash = 1;
    }
    await tween(400, k => { for (const h of e.hits) view.disp.get(h.unit).flash = 1 - k; });
    await wait(300);
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
      await act({ type: 'spell', side: b.side, target: c, dir: view.spellDir });
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
  function frame(ts) {
    if (!view.alive) return;
    const dt = Math.min(0.05, (ts - last) / 1000); last = ts;
    view.now = ts;
    // tweens
    for (let i = view.tweens.length - 1; i >= 0; i--) {
      const tw = view.tweens[i];
      const k = clamp((ts - tw.t0) / tw.dur, 0, 1);
      tw.fn(k);
      if (k >= 1) { view.tweens.splice(i, 1); tw.res(); }
    }
    g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    g.clearRect(0, 0, view.w, view.h);
    drawBackdrop();
    g.save();
    if (view.shake > 0.2) { g.translate((Math.random() - 0.5) * view.shake, (Math.random() - 0.5) * view.shake); view.shake *= Math.pow(0.02, dt); } else view.shake = 0;
    drawFrame();
    drawTempWalls();
    drawOverlays();
    const order = b.units.slice().sort((p, q) => (view.disp.get(p.id).y - view.disp.get(q.id).y));
    for (const u of order) drawUnit(u, view.disp.get(u.id));
    drawSpellFx();
    drawProjectiles();
    drawParticles(dt);
    drawFloats(dt);
    g.restore();
    drawWeather(dt);
    drawCutin(dt);
    requestAnimationFrame(frame);
  }

  function cleanup() {
    view.alive = false;
    window.removeEventListener('keydown', onKey);
    ro.disconnect();
  }

  // ---------------------------------------------------------------- intro
  layout();
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
      return us.find(isRuler) || us.filter(u => u.vassalId).sort((p, q) => q.soldiers - p.soldiers)[0] || us[0];
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
