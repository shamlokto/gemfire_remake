// Province land view: an isometric, SimCity-like canvas drawing of a province's land grid,
// drawn procedurally (no art needed). See docs/LAND.md.
//
//   const view = openLandView(container, land, { province, house, ctx, onBuild, readOnly });
//   view.update(land, ctx); view.setMonth(m); view.destroy();
//
// province: PROVINCES entry (name); house: { color, name } or null; ctx: { month, gold, mods };
// onBuild({ x, y, kind }) -> { ok, msg } lets the caller apply the build (pay gold, use the
// province's order). Without onBuild the view applies build()/demolish()/repair() itself.
import {
  T, B, R, TERRAIN, RESOURCE, BUILDING, BUILD_KEYS, PROJECT, provinceYield, listBuildable, build,
  demolish, repair, neighbours4, neighbours8,
} from '../land/land.js';
import { art, hasArt, LAND_BUILDING, LAND_RESOURCE, LAND_PANORAMA, LAND_SKY } from '../data/art.js';

// ---------------------------------------------------------------- painted art (optional)
// Isometric sprites for buildings and resources, a panorama and a sky behind the board. Every
// piece is optional: without it the procedural drawing below is used.
const IMG = new Map();
function artImage(slot, onload) {
  if (!slot || !hasArt(slot)) return null;
  let rec = IMG.get(slot);
  if (!rec) {
    rec = { img: new Image(), ready: false, bbox: null, snow: null };
    rec.img.onload = () => { rec.ready = true; rec.bbox = alphaBox(rec.img); onload && onload(); };
    rec.img.src = art(slot);
    IMG.set(slot, rec);
  }
  return rec.ready ? rec : null;
}
// Bounding box of the opaque pixels of a cut-out sprite (so its diamond can sit on a board tile).
function alphaBox(img) {
  try {
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
    for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) {
      if (d[(y * c.width + x) * 4 + 3] > 60) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    return x1 > x0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: c.width, h: c.height };
  } catch { return { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight }; }
}
// Winter variant: the sprite dusted with snow (cached once).
function snowy(rec) {
  if (rec.snow) return rec.snow;
  const c = document.createElement('canvas'); c.width = rec.img.naturalWidth; c.height = rec.img.naturalHeight;
  const g = c.getContext('2d'); g.drawImage(rec.img, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  const gr = g.createLinearGradient(0, 0, 0, c.height);
  gr.addColorStop(0, 'rgba(240,246,250,0.55)'); gr.addColorStop(1, 'rgba(225,235,242,0.35)');
  g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
  rec.snow = c;
  return c;
}
const spriteFor = (key, res, terr) => {
  if (key === 'orchard' && res === 4) return LAND_BUILDING.vineyard;          // R.VINES
  if (key === 'mine' && !res && terr === 7) return LAND_BUILDING.quarry;        // bare rock: a quarry
  if (key === 'fishery' && terr === 0 && hasArt(LAND_BUILDING.harbour)) return LAND_BUILDING.harbour;
  return LAND_BUILDING[key];
};
const RES_KEY = ['', 'ore', 'salt', 'pearls', '', 'ruins', 'grove', 'springs'];

const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'];
const seasonOf = m => Math.floor(((m ?? 4) % 12) / 3);
const hash = (a, b, c = 0) => { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const mix = (a, b, t) => {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
};
const shade = (c, k) => (k >= 0 ? mix(c, '#ffffff', k) : mix(c, '#000000', -k));

// Ground colours per terrain by season [spring, summer, autumn, winter].
const GROUND = {
  [T.WATER]: ['#2f6fa3', '#2c74ad', '#2b6597', '#3b5d7d'],
  [T.RIVER]: ['#4b93c4', '#4a9bd0', '#4685b5', '#7da6c4'],
  [T.FERTILE]: ['#5c7a2e', '#5f7f2c', '#6b6a2c', '#e8eef2'],
  [T.PLAIN]: ['#86a64a', '#93ad4c', '#a39a4a', '#eef2f5'],
  [T.POOR]: ['#a8a165', '#b5a768', '#ad9358', '#e9ecee'],
  [T.FOREST]: ['#3f6b35', '#3c6a31', '#5d5a2c', '#dfe7ea'],
  [T.HILLS]: ['#7c8a4a', '#86904c', '#8f7f45', '#e6ebee'],
  [T.ROCK]: ['#8b8b88', '#929290', '#8a8580', '#d9dee2'],
  [T.MARSH]: ['#5f7b55', '#5a7a4f', '#6d6d45', '#c9d4d8'],
};
const LIFT = { [T.HILLS]: 0.35, [T.ROCK]: 0.6 };
const BUILDING_ICON = { farm: '🌾', orchard: '🍎', pasture: '🐎', lumber: '🪵', mine: '⛏', fishery: '⛵', market: '⚖', houses: '🏠', granary: '🛢', mill: '🌀', temple: '⛪', barracks: '⚔', walls: '🧱', clear: '🪓', drain: '💧', excavate: '🏺' };

export function openLandView(container, land, opts = {}) {
  let L = land, ctx = { month: 4, ...(opts.ctx || {}) };
  const houseColor = (opts.house && opts.house.color) || '#8a7a5a';
  const readOnly = !!opts.readOnly;

  container.classList.add('lv-root');
  container.innerHTML = `
    <div class="lv-hud">
      <div class="lv-title"><b class="lv-name"></b><span class="lv-season"></span></div>
      <div class="lv-stats"></div>
      <div class="lv-tools">
        <button class="lv-btn lv-heat" title="Show soil fertility">Fertility</button>
      </div>
    </div>
    <div class="lv-stage"><canvas class="lv-canvas"></canvas><div class="lv-tip" hidden></div><div class="lv-moment" hidden></div></div>
    <div class="lv-palette" hidden></div>`;
  const $ = s => container.querySelector(s);
  const canvas = $('.lv-canvas'), stage = $('.lv-stage'), tip = $('.lv-tip'), palette = $('.lv-palette');
  const g = canvas.getContext('2d');
  let dpr = 1, cw = 0, ch = 0, tw = 64, th = 32, ox = 0, oy = 0;
  let hover = -1, sel = -1, heat = false, alive = true, raf = 0, t0 = performance.now();
  let agents = [], smoke = [], lastT = 0, px = 0, py = 0, artTick = 0;
  const terrainKey = (opts.province && opts.province.terrain) || 'plains';
  const onArt = () => { artTick++; groundCache = null; if (!palette.hidden && sel >= 0) openPalette(sel); };

  $('.lv-name').textContent = (opts.province && opts.province.name) || 'Province';
  $('.lv-heat').addEventListener('click', () => { heat = !heat; $('.lv-heat').classList.toggle('on', heat); });

  // ---------------------------------------------------------------- layout
  function layout() {
    const r = stage.getBoundingClientRect();
    cw = Math.max(200, r.width); ch = Math.max(160, r.height);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
    // fit the diamond (w + h tiles across, (w + h) / 2 tall) with margin for buildings
    tw = Math.min((cw - 16) / ((L.w + L.h) / 2), (ch - 40) / ((L.w + L.h) / 4 + 0.9));
    tw = Math.max(18, Math.floor(tw)); th = tw / 2;
    ox = cw / 2 - ((L.w - L.h) / 2) * (tw / 2);
    oy = (ch - (L.w + L.h) / 2 * th) / 2 + th * 0.9;
    groundCache = null;
  }
  const iso = (x, y) => [ox + (x - y) * tw / 2, oy + (x + y) * th / 2];
  const center = i => { const x = i % L.w, y = (i / L.w) | 0; const [sx, sy] = iso(x + 0.5, y + 0.5); return [sx, sy - (LIFT[L.t[i]] || 0) * th]; };
  function pick(mx, my) {
    // test from front to back so raised tiles win
    for (let s = L.w + L.h - 2; s >= 0; s--) for (let x = Math.min(L.w - 1, s); x >= 0 && s - x < L.h; x--) {
      const y = s - x, i = y * L.w + x;
      const [cx, cy] = center(i);
      const dx = Math.abs(mx - cx) / (tw / 2), dy = Math.abs(my - cy) / (th / 2);
      if (dx + dy <= 1) return i;
    }
    return -1;
  }

  // ---------------------------------------------------------------- ground (cached)
  let groundCache = null, groundKey = '';
  function diamond(c, cx, cy, w = tw, h = th) {
    c.beginPath(); c.moveTo(cx, cy - h / 2); c.lineTo(cx + w / 2, cy); c.lineTo(cx, cy + h / 2); c.lineTo(cx - w / 2, cy); c.closePath();
  }
  function backdropReady() {
    return !!(artImage(LAND_PANORAMA[terrainKey], onArt) || artImage(LAND_SKY[seasonOf(ctx.month)], onArt));
  }
  const cover = (img, x, y, w, h, fx = 0.5, fy = 0.5) => {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const k = Math.max(w / iw, h / ih), dw = iw * k, dh = ih * k;
    g.drawImage(img, x + (w - dw) * fx, y + (h - dh) * fy, dw, dh);
  };
  // Painted backdrop: the season's sky behind, the province's terrain panorama in front, both with
  // a gentle parallax that follows the pointer, then a dark vignette so the board stays readable.
  function drawBackdrop(t) {
    const season = seasonOf(ctx.month);
    const sky = artImage(LAND_SKY[season], onArt), pano = artImage(LAND_PANORAMA[terrainKey], onArt);
    if (!sky && !pano) return false;
    g.save();
    g.fillStyle = '#0d1110'; g.fillRect(0, 0, cw, ch);
    const drift = Math.sin(t * 0.05) * 6;
    if (sky) { g.globalAlpha = 1; cover(sky.img, -20 + px * -8 + drift, -20 + py * -5, cw + 40, ch * 0.75 + 40, 0.5, 0.3); }
    if (pano) {
      g.globalAlpha = sky ? 0.92 : 1;
      const top = sky ? ch * 0.18 : 0;
      cover(pano.img, -30 + px * -16, top - 10 + py * -8, cw + 60, ch - top + 20, 0.5, 0.6);
      if (sky) {   // blend the panorama's top edge into the sky
        const fade = g.createLinearGradient(0, top - 10, 0, top + ch * 0.18);
        g.globalAlpha = 1;
        fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
      }
    }
    g.globalAlpha = 1;
    if (season === 3) { g.fillStyle = 'rgba(210,225,240,0.18)'; g.fillRect(0, 0, cw, ch); }
    const v = g.createRadialGradient(cw / 2, ch * 0.55, Math.min(cw, ch) * 0.25, cw / 2, ch * 0.55, Math.max(cw, ch) * 0.75);
    v.addColorStop(0, 'rgba(8,10,8,0.15)'); v.addColorStop(1, 'rgba(8,10,8,0.78)');
    g.fillStyle = v; g.fillRect(0, 0, cw, ch);
    g.restore();
    return true;
  }
  // Draw a painted iso sprite so its diamond sits on the board tile at (cx, cy).
  function drawSprite(rec, cx, cy, season, scale = 1.04) {
    const b = rec.bbox, src = season === 3 ? snowy(rec) : rec.img;
    const k = (tw * scale) / b.w;
    const dw = (rec.img.naturalWidth) * k, dh = (rec.img.naturalHeight) * k;
    const bottom = cy + th / 2 + th * 0.06;                // the sprite's lowest opaque row on the tile's front vertex
    const dx = cx - (b.x + b.w / 2) * k, dy = bottom - (b.y + b.h) * k;
    g.drawImage(src, dx, dy, dw, dh);
    return { top: dy + b.y * k, k };
  }

  function drawGround() {
    const season = seasonOf(ctx.month);
    const key = `${season}|${cw}|${ch}|${L.t.join('')}|${L.r.join('')}|${artTick}`;
    if (groundCache && groundKey === key) return groundCache;
    const cv = document.createElement('canvas'); cv.width = canvas.width; cv.height = canvas.height;
    const c = cv.getContext('2d'); c.scale(dpr, dpr);
    // backdrop: sky-to-ground vignette (only when no painted backdrop is drawn behind the board)
    if (!backdropReady()) {
      const bg = c.createRadialGradient(cw / 2, ch / 2, 10, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
      bg.addColorStop(0, season === 3 ? '#26313b' : '#1d2a22'); bg.addColorStop(1, '#0d1110');
      c.fillStyle = bg; c.fillRect(0, 0, cw, ch);
    } else {
      // soft shadow under the board
      const [ax, ay] = iso(0, L.h), [bx, by] = iso(L.w, L.h);
      const sh = c.createRadialGradient(bx, by, 10, bx, by, Math.max(cw, ch) * 0.6);
      sh.addColorStop(0, 'rgba(0,0,0,0.45)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = sh; c.fillRect(0, 0, cw, ch);
      void ax; void ay;
    }
    // slab sides of the whole board
    const [ax, ay] = iso(0, L.h), [bx, by] = iso(L.w, L.h), [ex, ey] = iso(L.w, 0);
    c.fillStyle = '#3b2c1e'; c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.lineTo(bx, by + th * 0.7); c.lineTo(ax, ay + th * 0.7); c.fill();
    c.fillStyle = '#2b2016'; c.beginPath(); c.moveTo(bx, by); c.lineTo(ex, ey); c.lineTo(ex, ey + th * 0.7); c.lineTo(bx, by + th * 0.7); c.fill();
    for (let s = 0; s < L.w + L.h - 1; s++) for (let x = 0; x <= s; x++) {
      const y = s - x; if (x >= L.w || y >= L.h) continue;
      const i = y * L.w + x, t = L.t[i];
      const [cx, cy] = center(i);
      const lift = (LIFT[t] || 0) * th;
      let col = GROUND[t][season];
      const jitter = hash(x, y, 1) * 0.12 - 0.06;
      col = shade(col, jitter);
      // raised tiles: side faces
      if (lift > 0) {
        c.fillStyle = shade(col, -0.35);
        c.beginPath(); c.moveTo(cx - tw / 2, cy); c.lineTo(cx, cy + th / 2); c.lineTo(cx, cy + th / 2 + lift); c.lineTo(cx - tw / 2, cy + lift); c.fill();
        c.fillStyle = shade(col, -0.5);
        c.beginPath(); c.moveTo(cx + tw / 2, cy); c.lineTo(cx, cy + th / 2); c.lineTo(cx, cy + th / 2 + lift); c.lineTo(cx + tw / 2, cy + lift); c.fill();
      }
      diamond(c, cx, cy); c.fillStyle = col; c.fill();
      // texture speckles
      const n = t === T.WATER || t === T.RIVER ? 0 : 7;
      for (let k = 0; k < n; k++) {
        const u = hash(x, y, k + 10) - 0.5, v = hash(x, y, k + 30) - 0.5;
        if (Math.abs(u) + Math.abs(v) > 0.46) continue;
        c.fillStyle = shade(col, hash(x, y, k + 50) > 0.5 ? 0.12 : -0.14);
        c.fillRect(cx + u * tw, cy + v * th, Math.max(1, tw / 32), Math.max(1, tw / 40));
      }
      if (t === T.MARSH) for (let k = 0; k < 3; k++) {
        const u = hash(x, y, k + 70) - 0.5, v = hash(x, y, k + 90) - 0.5;
        if (Math.abs(u) + Math.abs(v) > 0.38) continue;
        c.fillStyle = season === 3 ? '#b8c8d2' : '#4d6f6a';
        c.beginPath(); c.ellipse(cx + u * tw, cy + v * th, tw * 0.09, th * 0.07, 0, 0, Math.PI * 2); c.fill();
      }
      if (t === T.ROCK) {
        c.fillStyle = shade(col, -0.2);
        c.beginPath(); c.moveTo(cx - tw * 0.18, cy + th * 0.05); c.lineTo(cx - tw * 0.02, cy - th * 0.35); c.lineTo(cx + tw * 0.16, cy + th * 0.06); c.fill();
        c.fillStyle = season === 3 ? '#fff' : shade(col, 0.25);
        c.beginPath(); c.moveTo(cx - tw * 0.07, cy - th * 0.18); c.lineTo(cx - tw * 0.02, cy - th * 0.35); c.lineTo(cx + tw * 0.04, cy - th * 0.18); c.fill();
      }
      // shoreline foam where land meets water
      if (t !== T.WATER && t !== T.RIVER) {
        c.strokeStyle = 'rgba(255,255,255,0.0)';
      }
      c.strokeStyle = 'rgba(0,0,0,0.10)'; c.lineWidth = 1; diamond(c, cx, cy); c.stroke();
    }
    groundCache = cv; groundKey = key;
    return cv;
  }

  // ---------------------------------------------------------------- objects
  function box(cx, cy, w, d, h, wall, roof, gable = true) {
    // an isometric box with its base centred at (cx, cy); w along x, d along y (in tile fractions)
    const hw = w * tw / 2, hd = d * tw / 2;
    const p = (u, v, z = 0) => [cx + (u - v) * 0.5, cy + (u + v) * 0.25 - z];
    const A = p(-hw, -hd), Bp = p(hw, -hd), C = p(hw, hd), D = p(-hw, hd);
    g.fillStyle = shade(wall, -0.18);
    g.beginPath(); g.moveTo(...D); g.lineTo(...C); g.lineTo(C[0], C[1] - h); g.lineTo(D[0], D[1] - h); g.fill();
    g.fillStyle = shade(wall, -0.36);
    g.beginPath(); g.moveTo(...C); g.lineTo(...Bp); g.lineTo(Bp[0], Bp[1] - h); g.lineTo(C[0], C[1] - h); g.fill();
    if (gable) {
      const rh = Math.min(hw, hd) * 0.9;
      const mA = [(A[0] + D[0]) / 2, (A[1] + D[1]) / 2 - h - rh], mB = [(Bp[0] + C[0]) / 2, (Bp[1] + C[1]) / 2 - h - rh];
      g.fillStyle = shade(roof, -0.1);
      g.beginPath(); g.moveTo(D[0], D[1] - h); g.lineTo(C[0], C[1] - h); g.lineTo(...mB); g.lineTo(...mA); g.fill();
      g.fillStyle = shade(roof, -0.32);
      g.beginPath(); g.moveTo(C[0], C[1] - h); g.lineTo(Bp[0], Bp[1] - h); g.lineTo(...mB); g.fill();
      g.fillStyle = shade(roof, 0.08);
      g.beginPath(); g.moveTo(A[0], A[1] - h); g.lineTo(Bp[0], Bp[1] - h); g.lineTo(...mB); g.lineTo(...mA); g.fill();
      return { top: Math.min(mA[1], mB[1]), chimney: [mB[0] - tw * 0.04, mB[1] + rh * 0.4] };
    }
    g.fillStyle = roof;
    g.beginPath(); g.moveTo(A[0], A[1] - h); g.lineTo(Bp[0], Bp[1] - h); g.lineTo(C[0], C[1] - h); g.lineTo(D[0], D[1] - h); g.fill();
    return { top: A[1] - h, chimney: [cx, cy - h] };
  }
  function tree(x, y, s, col, t, season, kind = 'pine') {
    const sway = Math.sin(t * 1.6 + x * 0.05 + y * 0.03) * s * 0.06;
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.beginPath(); g.ellipse(x, y, s * 0.5, s * 0.22, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#5a3d22'; g.fillRect(x - s * 0.06, y - s * 0.5, s * 0.12, s * 0.5);
    const leaf = season === 3 ? '#e9f0f2' : season === 2 && kind !== 'pine' ? '#c8782c' : col;
    if (kind === 'pine') {
      for (let k = 0; k < 3; k++) {
        g.fillStyle = shade(leaf, -0.1 + k * 0.08);
        g.beginPath(); g.moveTo(x + sway * (k + 1) - s * (0.5 - k * 0.12), y - s * (0.35 + k * 0.38));
        g.lineTo(x + sway * (k + 1.6), y - s * (1.0 + k * 0.38)); g.lineTo(x + sway * (k + 1) + s * (0.5 - k * 0.12), y - s * (0.35 + k * 0.38)); g.fill();
      }
    } else {
      g.fillStyle = shade(leaf, -0.12); g.beginPath(); g.arc(x + sway, y - s * 0.75, s * 0.45, 0, Math.PI * 2); g.fill();
      g.fillStyle = shade(leaf, 0.08); g.beginPath(); g.arc(x + sway - s * 0.12, y - s * 0.85, s * 0.28, 0, Math.PI * 2); g.fill();
    }
  }
  function puff(x, y, dark) { smoke.push({ x, y, vx: (Math.random() - 0.3) * 4, vy: -8 - Math.random() * 6, life: 0, max: 2.4 + Math.random(), dark }); }

  function drawTileObjects(i, t, season, dt) {
    const x = i % L.w, y = (i / L.w) | 0;
    const [cx, cy] = center(i);
    const terr = L.t[i], b = L.b[i], res = L.r[i];
    const building = L.c[i] > 0, damaged = !!L.d[i];
    // water animation
    if (terr === T.WATER || terr === T.RIVER) {
      g.save(); diamond(g, cx, cy); g.clip();
      g.strokeStyle = season === 3 ? 'rgba(220,235,245,0.35)' : 'rgba(255,255,255,0.28)'; g.lineWidth = Math.max(1, tw / 40);
      for (let k = 0; k < 3; k++) {
        const ph = (t * (terr === T.RIVER ? 0.9 : 0.4) + hash(x, y, k) * 3 + k * 0.33) % 1;
        const yy = cy - th / 2 + ph * th, xx = cx + (hash(x, y, k + 5) - 0.5) * tw * 0.5;
        g.beginPath(); g.moveTo(xx - tw * 0.12, yy); g.quadraticCurveTo(xx, yy - th * 0.06, xx + tw * 0.12, yy); g.stroke();
      }
      g.restore();
      // foam on shores
      for (const j of neighbours4(L, i)) {
        if (L.t[j] === T.WATER || L.t[j] === T.RIVER || LIFT[L.t[j]]) continue;
        const [jx, jy] = center(j);
        const mx = (cx + jx) / 2, my = (cy + jy) / 2;
        g.strokeStyle = `rgba(255,255,255,${0.25 + 0.15 * Math.sin(t * 2 + i)})`; g.lineWidth = Math.max(1, tw / 30);
        g.beginPath(); g.moveTo(mx - (jy - cy) * 0.45, my + (jx - cx) * 0.22); g.lineTo(mx + (jy - cy) * 0.45, my - (jx - cx) * 0.22); g.stroke();
      }
    }
    // forest
    if (terr === T.FOREST && b !== B.LUMBER) {
      for (let k = 0; k < 4; k++) {
        const u = hash(x, y, k + 100) - 0.5, v = hash(x, y, k + 120) - 0.5;
        if (Math.abs(u) + Math.abs(v) > 0.42) continue;
        tree(cx + u * tw * 0.8, cy + v * th * 0.8 + th * 0.1, tw * 0.22, '#2f5a2a', t, season, hash(x, y, k + 140) > 0.35 ? 'pine' : 'round');
      }
    }
    // grass tufts and wildflowers on open soil, mounds on bare hills, stones on poor soil
    if (!b && (terr === T.PLAIN || terr === T.FERTILE || terr === T.POOR) && season !== 3) {
      for (let k = 0; k < 6; k++) {
        const u = hash(x, y, k + 500) - 0.5, v = hash(x, y, k + 520) - 0.5;
        if (Math.abs(u) + Math.abs(v) > 0.42) continue;
        const bx = cx + u * tw, by = cy + v * th, sw = Math.sin(t * 1.8 + k + i) * 0.8;
        g.strokeStyle = shade(GROUND[terr][season], -0.25); g.lineWidth = 1;
        g.beginPath(); g.moveTo(bx - 1.5, by); g.lineTo(bx - 2 + sw, by - th * 0.12); g.moveTo(bx, by); g.lineTo(bx + sw, by - th * 0.16); g.moveTo(bx + 1.5, by); g.lineTo(bx + 2 + sw, by - th * 0.11); g.stroke();
        if (season < 2 && hash(x, y, k + 540) > 0.72) { g.fillStyle = ['#f3e36a', '#f0f0f0', '#d887d0', '#e86a5a'][k % 4]; g.fillRect(bx + sw - 1, by - th * 0.17, 2, 2); }
      }
      if (terr === T.POOR) for (let k = 0; k < 2; k++) { const u = hash(x, y, k + 560) - 0.5, v = hash(x, y, k + 570) - 0.5; g.fillStyle = '#8f8a78'; g.beginPath(); g.ellipse(cx + u * tw * 0.7, cy + v * th * 0.7, tw * 0.035, th * 0.04, 0, 0, Math.PI * 2); g.fill(); }
    }
    if (!b && terr === T.HILLS && !L.r[i]) {
      const base = GROUND[terr][season];
      for (let k = 0; k < 2; k++) {
        const u = (hash(x, y, k + 600) - 0.5) * 0.5, v = (hash(x, y, k + 610) - 0.5) * 0.5;
        const mx = cx + u * tw, my = cy + v * th + th * 0.08;
        g.fillStyle = shade(base, -0.12); g.beginPath(); g.ellipse(mx, my, tw * 0.17, th * 0.2, 0, Math.PI, 0); g.fill();
        g.fillStyle = shade(base, 0.1); g.beginPath(); g.ellipse(mx - tw * 0.04, my - th * 0.05, tw * 0.08, th * 0.1, 0, Math.PI, 0); g.fill();
      }
    }
    if (terr === T.MARSH && season !== 3) {   // reeds
      g.strokeStyle = '#3d5a2c'; g.lineWidth = 1;
      for (let k = 0; k < 5; k++) {
        const u = hash(x, y, k + 160) - 0.5, v = hash(x, y, k + 180) - 0.5;
        if (Math.abs(u) + Math.abs(v) > 0.4) continue;
        const bx = cx + u * tw, by = cy + v * th, sw = Math.sin(t * 2 + k) * 1.5;
        g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + sw, by - th * 0.35); g.stroke();
      }
    }
    // resource markers
    const resArt = res && !b ? artImage(LAND_RESOURCE[RES_KEY[res]], onArt) : null;
    if (resArt) {
      drawSprite(resArt, cx, cy, season, 1.0);
      if (res === R.SPRINGS && Math.random() < 0.06) smoke.push({ x: cx, y: cy - th * 0.3, vx: 0, vy: -10, life: 0, max: 1.6, steam: true });
      if (res === R.ORE && (t * 2) % 3 < 0.12) { g.fillStyle = '#fff'; g.fillRect(cx - 1, cy - th * 0.4, 2, 2); }
    } else if (res) drawResource(res, cx, cy, t, season, x, y);
    if (b) drawBuilding(b, i, cx, cy, t, season, building, damaged, res);
    if (building) scaffold(cx, cy, L.c[i]);
    const pr = L.p.find(p => p.i === i);
    if (pr) {
      scaffold(cx, cy, pr.left);
      g.font = `${Math.round(tw * 0.28)}px serif`; g.textAlign = 'center';
      g.fillText(BUILDING_ICON[pr.kind] || '•', cx, cy - th * 0.35);
    }
    if (damaged) {
      if (Math.random() < dt * 3) puff(cx + (Math.random() - 0.5) * tw * 0.3, cy - th * 0.3, true);
      g.fillStyle = `rgba(255,${120 + 60 * Math.sin(t * 9 + i)},40,0.85)`;
      g.beginPath(); g.arc(cx + Math.sin(t * 5 + i) * tw * 0.05, cy - th * 0.15, Math.max(1.5, tw * 0.035), 0, Math.PI * 2); g.fill();
    }
  }

  function drawResource(res, cx, cy, t, season, x, y) {
    const s = tw;
    switch (res) {
      case R.ORE:
        for (let k = 0; k < 3; k++) {
          const px = cx + (k - 1) * s * 0.12, py = cy + (k % 2) * s * 0.04 + s * 0.05;
          g.fillStyle = ['#b07cff', '#e3c25a', '#8fd0ff'][k];
          g.beginPath(); g.moveTo(px, py - s * 0.12); g.lineTo(px + s * 0.04, py); g.lineTo(px - s * 0.04, py); g.fill();
          if ((t * 2 + k) % 3 < 0.15) { g.fillStyle = '#fff'; g.fillRect(px - 1, py - s * 0.13, 2, 2); }
        }
        break;
      case R.SALT:
        g.fillStyle = 'rgba(250,250,245,0.8)';
        for (let k = 0; k < 4; k++) { g.beginPath(); g.ellipse(cx + (hash(x, y, k + 200) - 0.5) * s * 0.5, cy + (hash(x, y, k + 210) - 0.5) * s * 0.2, s * 0.1, s * 0.04, 0, 0, Math.PI * 2); g.fill(); }
        break;
      case R.PEARLS:
        for (let k = 0; k < 3; k++) {
          const a = 0.4 + 0.6 * Math.abs(Math.sin(t * 2.2 + k * 2));
          g.fillStyle = `rgba(255,250,235,${a})`; g.beginPath(); g.arc(cx + (k - 1) * s * 0.12, cy + ((k * 7) % 3 - 1) * s * 0.05, s * 0.025, 0, Math.PI * 2); g.fill();
        }
        break;
      case R.VINES:
        g.strokeStyle = season === 3 ? '#8a7a6a' : '#4f6b2a'; g.lineWidth = Math.max(1, s / 30);
        for (let k = -1; k <= 1; k++) { g.beginPath(); g.moveTo(cx - s * 0.2, cy + k * s * 0.08); g.lineTo(cx + s * 0.2, cy + k * s * 0.08 - s * 0.05); g.stroke(); }
        break;
      case R.RUINS:
        g.fillStyle = '#cfc6b0';
        g.fillRect(cx - s * 0.18, cy - s * 0.22, s * 0.06, s * 0.22); g.fillRect(cx + s * 0.1, cy - s * 0.14, s * 0.06, s * 0.14);
        g.fillStyle = '#b5ab92'; g.fillRect(cx - s * 0.06, cy - s * 0.02, s * 0.14, s * 0.05);
        break;
      case R.GROVE: {
        const glow = 0.25 + 0.15 * Math.sin(t * 1.5);
        g.fillStyle = `rgba(180,255,170,${glow})`; g.beginPath(); g.ellipse(cx, cy - s * 0.2, s * 0.35, s * 0.25, 0, 0, Math.PI * 2); g.fill();
        tree(cx, cy + s * 0.08, s * 0.38, '#3f8f45', t, season, 'round');
        break;
      }
      case R.SPRINGS:
        g.fillStyle = '#7fc8d8'; g.beginPath(); g.ellipse(cx, cy, s * 0.14, s * 0.06, 0, 0, Math.PI * 2); g.fill();
        if (Math.random() < 0.06) smoke.push({ x: cx, y: cy - 2, vx: 0, vy: -10, life: 0, max: 1.6, steam: true });
        break;
    }
  }

  function scaffold(cx, cy, left) {
    g.strokeStyle = '#c9a26a'; g.lineWidth = Math.max(1, tw / 40);
    const h = th * 0.9, w = tw * 0.28;
    for (const dx of [-w, 0, w]) { g.beginPath(); g.moveTo(cx + dx, cy + th * 0.1); g.lineTo(cx + dx, cy - h); g.stroke(); }
    for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(cx - w, cy - k * h / 3); g.lineTo(cx + w, cy - (k + 0.7) * h / 3); g.stroke(); }
    g.fillStyle = '#ffe2a8'; g.font = `bold ${Math.round(tw * 0.18)}px sans-serif`; g.textAlign = 'center';
    g.fillText(`${left}m`, cx, cy - h - 2);
  }

  function drawBuilding(b, i, cx, cy, t, season, building, damaged, res) {
    const roof = houseColor, stone = '#d8cdb5', wood = '#8a6440';
    const dim = building ? 0.45 : 1;
    const x = i % L.w, y = (i / L.w) | 0;
    if (b !== B.FARM) {
      const key = BUILDING[b].key;
      const rec = artImage(damaged && hasArt(LAND_BUILDING.ruin) ? LAND_BUILDING.ruin : spriteFor(key, res, L.t[i]), onArt);
      if (rec) {
        g.globalAlpha = dim;
        const sc = b === B.KEEP ? 1.18 : b === B.WALLS ? 0.98 : b === B.HOUSES || b === B.MARKET ? 1.08 : 1.02;
        const r = drawSprite(rec, cx, cy, season, sc);
        g.globalAlpha = 1;
        // living touches on top of the painting
        if (!building && !damaged) {
          if ((b === B.HOUSES || b === B.KEEP || b === B.BARRACKS) && Math.random() < 0.02 + (season === 3 ? 0.03 : 0)) puff(cx + (hash(x, y, 9) - 0.5) * tw * 0.3, r.top + th * 0.3, false);
          if (b === B.KEEP || b === B.BARRACKS || b === B.TEMPLE) flag(cx + tw * 0.18, Math.max(r.top + th * 0.15, cy - th * 1.6), t, roof);
        }
        return;
      }
    }
    g.globalAlpha = dim;
    switch (b) {
      case B.FARM: {
        // crop rows by season
        g.save(); diamond(g, cx, cy, tw * 0.92, th * 0.92); g.clip();
        const base = season === 3 ? '#e3e7e9' : '#6b4a2b';
        g.fillStyle = base; diamond(g, cx, cy, tw * 0.92, th * 0.92); g.fill();
        const crop = [['#9fd25b', 0.35], ['#6fae3c', 0.75], ['#e2b84a', 0.85], ['#c9c2b0', 0.15]][season];
        g.strokeStyle = crop[0]; g.lineWidth = Math.max(1.5, tw / 16);
        for (let k = -4; k <= 4; k++) {
          const sx = cx + k * tw * 0.1, sy = cy + k * th * 0.1;
          g.beginPath(); g.moveTo(sx - tw * 0.4, sy - th * 0.4 + th * 0.4); g.lineTo(sx + tw * 0.4 - tw * 0.4, sy - th * 0.4); g.stroke();
          if (season === 1 || season === 2) {   // tall stalks sway
            g.strokeStyle = shade(crop[0], 0.15); g.lineWidth = 1;
            const sw = Math.sin(t * 2 + k + i) * 1.5;
            for (let q = 0; q < 3; q++) { const u = sx - tw * 0.3 + q * tw * 0.1, v = sy - th * 0.1 - q * th * 0.1 + th * 0.2; g.beginPath(); g.moveTo(u, v); g.lineTo(u + sw, v - th * crop[1] * 0.4); g.stroke(); }
            g.strokeStyle = crop[0]; g.lineWidth = Math.max(1.5, tw / 16);
          }
        }
        g.restore();
        if (season === 2 && hash(x, y, 300) > 0.5) {   // hay stack at harvest
          g.fillStyle = '#d9a83c'; g.beginPath(); g.ellipse(cx + tw * 0.15, cy, tw * 0.07, th * 0.12, 0, 0, Math.PI * 2); g.fill();
        }
        break;
      }
      case B.ORCHARD:
        for (let k = 0; k < 4; k++) {
          const u = (k % 2 - 0.5) * 0.4, v = ((k >> 1) - 0.5) * 0.4;
          const [px, py] = [cx + (u - v) * tw * 0.5, cy + (u + v) * th * 0.5 + th * 0.1];
          if (res === R.VINES) { g.fillStyle = season === 3 ? '#998' : '#5d7d33'; g.fillRect(px - tw * 0.1, py - th * 0.3, tw * 0.2, th * 0.25); if (season === 2) { g.fillStyle = '#6b2f7a'; g.fillRect(px - 2, py - th * 0.2, 3, 3); } }
          else {
            tree(px, py, tw * 0.2, '#4c8a39', t, season, 'round');
            if (season === 1 || season === 2) { g.fillStyle = season === 1 ? '#f5f0e6' : '#d8382c'; g.fillRect(px - 2, py - tw * 0.17, 2.5, 2.5); }
          }
        }
        break;
      case B.PASTURE: {
        g.strokeStyle = '#7a5a36'; g.lineWidth = Math.max(1, tw / 40); diamond(g, cx, cy, tw * 0.85, th * 0.85); g.stroke();
        for (let k = 0; k < 2; k++) {
          const a = t * 0.3 + k * 3 + i;
          const hx = cx + Math.cos(a) * tw * 0.18, hy = cy + Math.sin(a) * th * 0.18;
          g.fillStyle = k ? '#6b4527' : '#3d2a1a';
          g.beginPath(); g.ellipse(hx, hy - th * 0.12, tw * 0.07, th * 0.08, 0, 0, Math.PI * 2); g.fill();
          g.fillRect(hx + (Math.cos(a) > 0 ? tw * 0.05 : -tw * 0.08), hy - th * 0.22, tw * 0.03, th * 0.1);
        }
        break;
      }
      case B.LUMBER:
        tree(cx - tw * 0.2, cy - th * 0.05, tw * 0.22, '#2f5a2a', t, season);
        g.fillStyle = wood; for (let k = 0; k < 3; k++) g.fillRect(cx + tw * (0.0 + k * 0.03), cy - th * (0.05 + k * 0.08), tw * 0.22, th * 0.08);
        box(cx + tw * 0.12, cy + th * 0.12, 0.18, 0.18, th * 0.25, '#9b7a50', '#6b4a2e');
        break;
      case B.MINE:
        g.fillStyle = '#4a4038'; g.beginPath(); g.arc(cx, cy, tw * 0.13, Math.PI, 0); g.fill();
        g.fillStyle = '#1b1612'; g.beginPath(); g.arc(cx, cy, tw * 0.08, Math.PI, 0); g.fill();
        g.strokeStyle = wood; g.lineWidth = Math.max(1, tw / 30); g.strokeRect(cx - tw * 0.1, cy - tw * 0.12, tw * 0.2, tw * 0.12);
        { const k = (t * 0.25 + i * 0.1) % 1; const mx = cx + (k - 0.5) * tw * 0.5, my = cy + th * 0.15 + (k - 0.5) * th * 0.2; g.fillStyle = '#6a4a2a'; g.fillRect(mx - 3, my - 3, 6, 3); g.fillStyle = '#9a9aa0'; g.fillRect(mx - 2, my - 5, 4, 2); }
        break;
      case B.FISHERY: {
        g.fillStyle = wood;
        const bob = Math.sin(t * 2 + i) * th * 0.04;
        g.beginPath(); g.moveTo(cx - tw * 0.15, cy + bob); g.lineTo(cx + tw * 0.15, cy + bob); g.lineTo(cx + tw * 0.1, cy + th * 0.1 + bob); g.lineTo(cx - tw * 0.1, cy + th * 0.1 + bob); g.fill();
        g.strokeStyle = '#3a2a1a'; g.lineWidth = 1; g.beginPath(); g.moveTo(cx, cy + bob); g.lineTo(cx, cy - th * 0.55 + bob); g.stroke();
        g.fillStyle = '#efe7d6'; g.beginPath(); g.moveTo(cx, cy - th * 0.5 + bob); g.lineTo(cx + tw * 0.12, cy - th * 0.1 + bob); g.lineTo(cx, cy - th * 0.08 + bob); g.fill();
        g.fillStyle = roof; g.fillRect(cx, cy - th * 0.58 + bob, tw * 0.06, th * 0.06);
        break;
      }
      case B.MARKET:
        for (let k = 0; k < 2; k++) {
          const px = cx + (k ? tw * 0.14 : -tw * 0.14), py = cy + (k ? -th * 0.02 : th * 0.06);
          box(px, py, 0.2, 0.2, th * 0.25, '#b08a5a', '#ddd', false);
          for (let s = 0; s < 4; s++) { g.fillStyle = s % 2 ? '#f3efe6' : roof; g.fillRect(px - tw * 0.1 + s * tw * 0.05, py - th * 0.34, tw * 0.05, th * 0.08); }
        }
        g.fillStyle = '#e6c25a'; g.beginPath(); g.arc(cx, cy + th * 0.15, tw * 0.03, 0, Math.PI * 2); g.fill();
        break;
      case B.HOUSES: {
        const spots = [[-0.16, 0.02], [0.14, -0.04], [0.02, 0.16]];
        const count = 2 + (hash(x, y, 400) > 0.5 ? 1 : 0);
        for (let k = 0; k < count; k++) {
          const [u, v] = spots[k];
          const r = box(cx + u * tw, cy + v * th, 0.18, 0.15, th * 0.28, '#e9dcc0', roof);
          if (!building && !damaged && season !== 1 && Math.random() < 0.02) puff(r.chimney[0], r.chimney[1], false);
          if (!building && !damaged && season === 3 && Math.random() < 0.03) puff(r.chimney[0], r.chimney[1], false);
          if (!building && (t + k) % 6 > 3) { g.fillStyle = 'rgba(255,214,120,0.9)'; g.fillRect(cx + u * tw - tw * 0.03, cy + v * th - th * 0.12, tw * 0.025, th * 0.06); }
        }
        break;
      }
      case B.GRANARY:
        g.fillStyle = '#c9a874'; g.fillRect(cx - tw * 0.1, cy - th * 0.6, tw * 0.2, th * 0.6);
        g.fillStyle = shade('#c9a874', -0.2); g.fillRect(cx, cy - th * 0.6, tw * 0.1, th * 0.6);
        g.fillStyle = roof; g.beginPath(); g.moveTo(cx - tw * 0.13, cy - th * 0.6); g.lineTo(cx, cy - th * 1.0); g.lineTo(cx + tw * 0.13, cy - th * 0.6); g.fill();
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(cx, cy, tw * 0.12, th * 0.08, 0, 0, Math.PI * 2); g.fill();
        break;
      case B.MILL: {
        g.fillStyle = '#e8dcc2'; g.beginPath(); g.moveTo(cx - tw * 0.09, cy); g.lineTo(cx - tw * 0.06, cy - th * 0.9); g.lineTo(cx + tw * 0.06, cy - th * 0.9); g.lineTo(cx + tw * 0.09, cy); g.fill();
        g.fillStyle = shade('#e8dcc2', -0.2); g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx, cy - th * 0.9); g.lineTo(cx + tw * 0.06, cy - th * 0.9); g.lineTo(cx + tw * 0.09, cy); g.fill();
        g.fillStyle = roof; g.beginPath(); g.moveTo(cx - tw * 0.08, cy - th * 0.9); g.lineTo(cx, cy - th * 1.15); g.lineTo(cx + tw * 0.08, cy - th * 0.9); g.fill();
        const hubX = cx, hubY = cy - th * 0.8, spin = building || damaged ? 0 : t * 1.4 + i;
        g.strokeStyle = '#5a4128'; g.lineWidth = Math.max(1, tw / 36);
        for (let k = 0; k < 4; k++) {
          const a = spin + k * Math.PI / 2, ex = hubX + Math.cos(a) * tw * 0.26, ey = hubY + Math.sin(a) * th * 0.5;
          g.beginPath(); g.moveTo(hubX, hubY); g.lineTo(ex, ey); g.stroke();
          g.fillStyle = 'rgba(240,232,210,0.9)';
          const nx = hubX + Math.cos(a + 0.25) * tw * 0.24, ny = hubY + Math.sin(a + 0.25) * th * 0.46;
          g.beginPath(); g.moveTo(hubX + Math.cos(a) * tw * 0.08, hubY + Math.sin(a) * th * 0.16); g.lineTo(ex, ey); g.lineTo(nx, ny); g.fill();
        }
        break;
      }
      case B.TEMPLE: {
        box(cx, cy + th * 0.04, 0.42, 0.3, th * 0.45, '#efe8d8', '#efe8d8', false);
        for (let k = 0; k < 4; k++) { g.fillStyle = '#fff8e8'; g.fillRect(cx - tw * 0.17 + k * tw * 0.1, cy - th * 0.32, tw * 0.03, th * 0.4); }
        const glow = 0.5 + 0.5 * Math.sin(t * 1.3 + i);
        g.fillStyle = '#e6c25a'; g.beginPath(); g.arc(cx, cy - th * 0.62, tw * 0.1, Math.PI, 0); g.fill();
        g.fillStyle = `rgba(255,230,140,${0.2 + glow * 0.25})`; g.beginPath(); g.arc(cx, cy - th * 0.75, tw * 0.16, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#e6c25a'; g.fillRect(cx - 1, cy - th * 0.95, 2, th * 0.25);
        break;
      }
      case B.BARRACKS: {
        box(cx, cy + th * 0.05, 0.5, 0.22, th * 0.3, '#a89a84', '#6b5b4b');
        flag(cx + tw * 0.2, cy - th * 0.4, t, roof);
        // drilling soldiers
        for (let k = 0; k < 3; k++) { const sx = cx - tw * 0.15 + k * tw * 0.12, sy = cy + th * 0.28 + Math.sin(t * 4 + k) * 1; g.fillStyle = roof; g.fillRect(sx, sy - th * 0.14, tw * 0.03, th * 0.12); g.fillStyle = '#ddd'; g.fillRect(sx + tw * 0.03, sy - th * 0.2, 1, th * 0.12); }
        break;
      }
      case B.WALLS: {
        const near = neighbours8(L, i).filter(j => L.b[j] === B.WALLS || L.b[j] === B.KEEP);
        g.strokeStyle = '#9d9283'; g.lineWidth = Math.max(3, tw / 9); g.lineCap = 'round';
        for (const j of near) { const [jx, jy] = center(j); g.beginPath(); g.moveTo(cx, cy - th * 0.2); g.lineTo((cx + jx) / 2, (cy + jy) / 2 - th * 0.2); g.stroke(); }
        g.lineCap = 'butt';
        box(cx, cy, 0.22, 0.22, th * 0.55, '#b3a896', '#8e8474', false);
        g.fillStyle = '#8e8474'; for (let k = 0; k < 3; k++) g.fillRect(cx - tw * 0.1 + k * tw * 0.08, cy - th * 0.7, tw * 0.04, th * 0.08);
        break;
      }
      case B.KEEP: {
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(cx, cy + th * 0.1, tw * 0.38, th * 0.3, 0, 0, Math.PI * 2); g.fill();
        box(cx, cy + th * 0.05, 0.56, 0.5, th * 0.5, stone, '#a69b86', false);
        const r = box(cx, cy - th * 0.05, 0.26, 0.26, th * 1.25, '#e2d8c2', roof);
        for (const [u, v] of [[-0.26, 0], [0.26, 0], [0, 0.22]]) box(cx + u * tw, cy + v * th, 0.12, 0.12, th * 0.8, '#d6cbb3', roof);
        flag(cx, r.top - 2, t, roof);
        break;
      }
    }
    g.globalAlpha = 1;
    if (damaged) { g.fillStyle = 'rgba(20,10,5,0.35)'; diamond(g, cx, cy, tw * 0.8, th * 0.8); g.fill(); }
  }
  function flag(x, y, t, col) {
    g.strokeStyle = '#3a2a1a'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - th * 0.6); g.stroke();
    const w = tw * 0.16, h = th * 0.2;
    g.fillStyle = col; g.beginPath(); g.moveTo(x, y - th * 0.6);
    for (let k = 0; k <= 6; k++) { const u = k / 6; g.lineTo(x + u * w, y - th * 0.6 + Math.sin(t * 5 - u * 4) * 2 * u); }
    for (let k = 6; k >= 0; k--) { const u = k / 6; g.lineTo(x + u * w, y - th * 0.6 + h + Math.sin(t * 5 - u * 4) * 2 * u); }
    g.fill();
  }

  // ---------------------------------------------------------------- villagers and carts
  function workTiles() { return L.b.map((b, i) => (b && b !== B.HOUSES && b !== B.WALLS && !L.c[i] && !L.d[i] ? i : -1)).filter(i => i >= 0); }
  function homeTiles() { return L.b.map((b, i) => (b === B.HOUSES || b === B.KEEP) && !L.c[i] ? i : -1).filter(i => i >= 0); }
  function resetAgents() {
    const y = provinceYield(L, ctx);
    const n = Math.max(2, Math.min(16, Math.round(y.pop / 70)));
    const homes = homeTiles(), works = workTiles();
    agents = [];
    if (!homes.length || !works.length) return;
    for (let k = 0; k < n; k++) {
      const from = homes[k % homes.length];
      agents.push({ from, to: works[(k * 7) % works.length], u: Math.random(), speed: 0.12 + Math.random() * 0.1, cart: k % 5 === 4, col: ['#c84', '#48c', '#a5c', '#c55', '#5a5'][k % 5] });
    }
  }
  function stepAgents(dt) {
    const homes = homeTiles(), works = workTiles();
    for (const a of agents) {
      a.u += dt * a.speed * (a.cart ? 0.6 : 1);
      if (a.u >= 1) {
        a.u = 0; a.from = a.to;
        const goHome = !homes.includes(a.from) ? true : false;
        const pool = goHome ? homes : works;
        if (pool.length) a.to = pool[Math.floor(Math.random() * pool.length)];
      }
    }
  }
  function drawAgents(t) {
    for (const a of agents) {
      const [x1, y1] = center(a.from), [x2, y2] = center(a.to);
      const e = a.u < 0.5 ? 2 * a.u * a.u : 1 - Math.pow(-2 * a.u + 2, 2) / 2;
      const x = x1 + (x2 - x1) * e, y = y1 + (y2 - y1) * e + th * 0.18;
      if (a.cart) {
        g.fillStyle = '#6a4a2a'; g.fillRect(x - tw * 0.06, y - th * 0.12, tw * 0.12, th * 0.08);
        g.fillStyle = '#d9b44a'; g.fillRect(x - tw * 0.05, y - th * 0.17, tw * 0.1, th * 0.05);
        g.fillStyle = '#222'; g.beginPath(); g.arc(x - tw * 0.04, y - th * 0.03, 1.6, 0, Math.PI * 2); g.arc(x + tw * 0.04, y - th * 0.03, 1.6, 0, Math.PI * 2); g.fill();
      } else {
        const step = Math.sin(t * 10 + x) * 1;
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(x, y, 2.5, 1.2, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = a.col; g.fillRect(x - 1.5, y - 6 + Math.abs(step) * 0.5, 3, 5);
        g.fillStyle = '#f0c8a0'; g.beginPath(); g.arc(x, y - 7.5 + Math.abs(step) * 0.5, 1.6, 0, Math.PI * 2); g.fill();
      }
    }
  }

  // ---------------------------------------------------------------- frame
  function frame(now) {
    if (!alive) return;
    const t = (now - t0) / 1000, dt = Math.min(0.05, t - lastT); lastT = t;
    const season = seasonOf(ctx.month);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBackdrop(t);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(drawGround(), 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (heat) drawHeat();
    // objects back to front
    for (let s = 0; s < L.w + L.h - 1; s++) for (let x = 0; x <= s; x++) {
      const y = s - x; if (x >= L.w || y >= L.h) continue;
      drawTileObjects(y * L.w + x, t, season, dt);
    }
    stepAgents(dt); drawAgents(t);
    // smoke / steam
    for (const p of smoke) {
      p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx += 3 * dt;
      const a = Math.max(0, 1 - p.life / p.max), r = 2 + p.life * 3;
      g.fillStyle = p.steam ? `rgba(240,248,255,${a * 0.4})` : p.dark ? `rgba(40,30,25,${a * 0.6})` : `rgba(220,220,220,${a * 0.45})`;
      g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
    }
    smoke = smoke.filter(p => p.life < p.max).slice(-160);
    // snowfall in winter, falling leaves in autumn
    if (season === 3 || season === 2) {
      for (let k = 0; k < 40; k++) {
        const px = (hash(k, 1, 7) * cw + t * (season === 3 ? 6 : 14) * (hash(k, 2, 7) + 0.5)) % cw;
        const py = (hash(k, 3, 7) * ch + t * (season === 3 ? 18 : 22) * (hash(k, 4, 7) + 0.5)) % ch;
        g.fillStyle = season === 3 ? 'rgba(255,255,255,0.75)' : 'rgba(200,120,40,0.7)';
        g.fillRect(px + Math.sin(t + k) * 3, py, season === 3 ? 2 : 3, 2);
      }
    }
    // hover and selection outlines
    for (const [i, col] of [[hover, 'rgba(255,240,200,0.9)'], [sel, '#ffd34d']]) {
      if (i < 0) continue;
      const [cx, cy] = center(i);
      g.strokeStyle = col; g.lineWidth = 2; diamond(g, cx, cy); g.stroke();
    }
    raf = requestAnimationFrame(frame);
  }
  function drawHeat() {
    for (let i = 0; i < L.t.length; i++) {
      const soil = TERRAIN[L.t[i]].soil;
      const irrigated = neighbours4(L, i).some(j => L.t[j] === T.RIVER || (L.t[j] === T.WATER && L.lake));
      const v = soil * (irrigated ? 1.25 : 1);
      if (!soil) continue;
      const [cx, cy] = center(i);
      const k = Math.min(1, v / 2.25);
      g.fillStyle = `rgba(${Math.round(255 * (1 - k))},${Math.round(80 + 175 * k)},60,0.45)`;
      diamond(g, cx, cy); g.fill();
    }
  }

  // ---------------------------------------------------------------- HUD and palette
  const fmt = n => (Math.round(n * 10) / 10).toString();
  function renderHud() {
    const y = provinceYield(L, ctx);
    $('.lv-season').textContent = ` · ${SEASON_NAMES[seasonOf(ctx.month)]}`;
    const net = y.food - y.foodUpkeep;
    // ctx.realm (from the game): show yields in the realm's terms (treasury gold, soldiers per muster).
    const R = ctx.realm;
    $('.lv-stats').innerHTML = [
      ['Harvest', `${y.food}`, R ? 'each autumn' : `${net >= 0 ? '+' : ''}${net} after the people eat`],
      ['Gold', `${fmt(R ? y.gold * R.goldMul : y.gold)}/mo`, ''],
      ['People', `${y.pop}`, `labour ${Math.round(y.labour * 100)}%`],
      R ? ['Muster', `${Math.max(30, Math.floor(y.musterCap / 30) * 10)}`, 'per order'] : ['Muster cap', `${y.musterCap}`, ''],
      ['Loyalty', `${y.loyaltyMod >= 0 ? '+' : ''}${y.loyaltyMod}`, ''],
      ['Defence', `+${Math.round(y.defense * 100)}%`, ''],
    ].map(([k, v, s]) => `<span class="lv-stat"><i>${k}</i><b>${v}</b>${s ? `<em>${s}</em>` : ''}</span>`).join('');
    resetAgents();
  }
  function tileInfo(i) {
    const terr = TERRAIN[L.t[i]], res = RESOURCE[L.r[i]], b = BUILDING[L.b[i]];
    let s = `<b>${terr.name}</b>`;
    if (L.r[i]) s += ` · <span class="lv-res">${res.name}</span>`;
    if (L.b[i]) s += `<br>${b.name}${L.c[i] ? ` (building, ${L.c[i]} mo)` : ''}${L.d[i] ? ' <span class="lv-bad">damaged</span>' : ''}`;
    const pr = L.p.find(p => p.i === i);
    if (pr) s += `<br>${PROJECT[pr.kind].name}: ${pr.left} mo left`;
    if (terr.soil && !L.b[i]) s += `<br><span class="lv-dim">Farm here: ${Math.round(9 * terr.soil)} food${neighbours4(L, i).some(j => L.t[j] === T.RIVER || (L.t[j] === T.WATER && L.lake)) ? ' (+25% irrigated)' : ''}</span>`;
    if (L.r[i]) s += `<br><span class="lv-dim">${res.text}</span>`;
    return s;
  }
  function openPalette(i) {
    sel = i;
    const x = i % L.w, y = (i / L.w) | 0;
    const opts2 = readOnly ? [] : listBuildable(L, x, y, ctx);
    const b = L.b[i];
    const sign = v => (v > 0 ? '+' : '') + v;
    const gm = ctx.realm ? ctx.realm.goldMul : 1;
    const prev = p => p ? [p.food && `${sign(p.food)} food`, p.gold && `${sign(Math.round(p.gold * gm * 10) / 10)} gold`, p.pop && `${sign(p.pop)} people`, p.loyalty && `${sign(p.loyalty)} loyalty`, p.defense && `${sign(Math.round(p.defense * 100))}% def`].filter(Boolean).join(' · ') : '';
    let html = `<div class="lv-pal-head"><div>${tileInfo(i)}</div><button class="lv-btn lv-close" aria-label="Close">✕</button></div>`;
    if (!readOnly && b && b !== B.KEEP) {
      html += `<div class="lv-pal-row">`;
      if (L.d[i]) html += `<button class="lv-btn" data-act="repair">Repair (${Math.round(BUILDING[b].cost * 0.5)} gold)</button>`;
      html += `<button class="lv-btn lv-warn" data-act="demolish">Demolish</button></div>`;
    }
    const good = opts2.filter(o => o.ok), bad = opts2.filter(o => !o.ok && !o.project);
    if (good.length) {
      const terr = L.t[i];
      html += `<div class="lv-pal-grid">` + good.map(o => {
        const slot = o.project ? null : spriteFor(o.kind, L.r[i], terr);
        const pic = slot && hasArt(slot) ? `<img class="lv-card-img" src="${art(slot)}" alt="">` : `<span class="lv-ico">${BUILDING_ICON[o.kind] || '•'}</span>`;
        return `<button class="lv-opt lv-card" data-kind="${o.kind}">
        <span class="lv-card-pic">${pic}</span><span class="lv-opt-name">${o.name}</span>
        <span class="lv-opt-cost">${ctx.free ? `<s>${o.cost}</s> free` : `${o.cost} gold`} · ${o.time} mo</span>
        <span class="lv-opt-prev">${prev(o.preview) || (o.project ? o.text : '')}</span></button>`;
      }).join('') + `</div>`;
    } else if (!readOnly && !b) html += `<p class="lv-dim">Nothing can be built here.</p>`;
    if (bad.length && !b) html += `<details class="lv-why"><summary>Not here (${bad.length})</summary>${bad.map(o => `<div>${o.name}: ${o.why}</div>`).join('')}</details>`;
    palette.innerHTML = html; palette.hidden = false;
    palette.querySelector('.lv-close').onclick = () => { palette.hidden = true; sel = -1; };
    palette.querySelectorAll('[data-kind]').forEach(el => el.onclick = () => act({ x, y, kind: el.dataset.kind }));
    palette.querySelectorAll('[data-act]').forEach(el => el.onclick = () => act({ x, y, kind: el.dataset.act }));
  }
  function act(order) {
    let r;
    if (opts.onBuild) r = opts.onBuild(order);
    else if (order.kind === 'demolish') r = demolish(L, order.x, order.y);
    else if (order.kind === 'repair') r = repair(L, order.x, order.y, ctx);
    else r = build(L, order.x, order.y, order.kind, ctx);
    if (r && r.ok && !opts.onBuild && r.cost && ctx.gold != null) ctx.gold -= r.cost;
    flash(r ? r.msg : '');
    groundCache = null; renderHud();
    if (sel >= 0) openPalette(sel);
  }
  let flashTimer = 0;
  function flash(msg) {
    if (!msg) return;
    let el = container.querySelector('.lv-flash');
    if (!el) { el = document.createElement('div'); el.className = 'lv-flash'; stage.appendChild(el); }
    el.textContent = msg; el.hidden = false; clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }

  // ---------------------------------------------------------------- input
  function pos(e) { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  canvas.addEventListener('pointermove', e => {
    const [mx, my] = pos(e);
    px = (mx / cw - 0.5) * 2; py = (my / ch - 0.5) * 2;
    hover = pick(mx, my);
    if (hover >= 0 && e.pointerType === 'mouse') {
      tip.innerHTML = tileInfo(hover); tip.hidden = false;
      const tx = Math.min(cw - 230, mx + 14), ty = Math.max(4, my - 10);
      tip.style.left = tx + 'px'; tip.style.top = ty + 'px';
    } else tip.hidden = true;
  });
  canvas.addEventListener('pointerleave', () => { hover = -1; tip.hidden = true; });
  canvas.addEventListener('click', e => { const [mx, my] = pos(e); const i = pick(mx, my); if (i >= 0) openPalette(i); });
  const ro = new ResizeObserver(() => layout());
  ro.observe(stage);

  layout(); renderHud();
  raf = requestAnimationFrame(frame);

  // A painted banner across the top of the board (harvest, a raid, a project...): { slot, title, text }.
  let momentTimer = 0;
  function showMoment(m) {
    const el = container.querySelector('.lv-moment');
    if (!m || !el) return;
    const pic = m.slot && hasArt(m.slot) ? `style="background-image:url(${art(m.slot)})"` : '';
    el.innerHTML = `<div class="lv-moment-pic" ${pic}></div><div class="lv-moment-txt"><b>${m.title || ''}</b><span>${m.text || ''}</span></div><button class="lv-btn lv-moment-x" aria-label="Dismiss">✕</button>`;
    el.hidden = false; el.classList.remove('out');
    el.querySelector('.lv-moment-x').onclick = () => { el.hidden = true; };
    clearTimeout(momentTimer);
    momentTimer = setTimeout(() => { el.classList.add('out'); setTimeout(() => { el.hidden = true; }, 600); }, m.ms || 5500);
  }
  if (opts.moment) setTimeout(() => showMoment(opts.moment), 250);

  return {
    showMoment,
    update(newLand, newCtx) { if (newLand) L = newLand; if (newCtx) ctx = { ...ctx, ...newCtx }; groundCache = null; renderHud(); if (sel >= 0 && !palette.hidden) openPalette(sel); },
    setMonth(m) { ctx.month = m; groundCache = null; renderHud(); },
    get land() { return L; },
    destroy() { alive = false; cancelAnimationFrame(raf); ro.disconnect(); container.innerHTML = ''; container.classList.remove('lv-root'); },
  };
}
