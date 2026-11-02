// Isometric 3D battle board, in the style of the land view: raised diamond tiles with side faces,
// textured tops (painted ISO_TERRAIN tiles when installed, procedural otherwise), tall props
// (trees, peaks, ruins, houses, walls, gate, keep, palisade, tents) drawn depth-sorted with the
// units, animated water / ice / lava, and screen -> tile picking through elevation.
//
//   const iso = new IsoBoard({ grid, elev, W, H, season, artImg, ISO_TERRAIN, ISO_PROP, defColor });
//   iso.fit(w, h, zoom, panX, panY)         // computes a (half tile width), ox, oy
//   iso.pt(x, y)                            // screen point of cell (x, y) centre (fractional ok)
//   iso.buildStatic(dpr)                    // ground slab on an offscreen canvas
//   iso.drawStatic(g); iso.drawAnimated(g, t)
//   iso.props()                             // [{ x, y, key, draw(g, t) }] for depth sorting
//   iso.pick(px, py)                        // { x, y } or null
//   iso.diamond(g, x, y, inset)             // path of a tile top

const hash = (x, y, s = 0) => { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const BASE = 0.7;          // slab thickness below elevation 0, in elevation steps
export const ZK = 0.42;    // one elevation step = ZK * a pixels

// Top colours per terrain and season (0 spring .. 3 winter).
const TOP = {
  grass:    ['#5d8a3c', '#6a8a3a', '#7d7a3a', '#e6edf1'],
  farmland: ['#7a6a3c', '#a8923f', '#b08a3a', '#e3e9ec'],
  road:     ['#9b8459', '#a08a5e', '#9a7f55', '#c9c4bb'],
  forest:   ['#3f6a2f', '#476d2e', '#6a5a2c', '#dfe7ea'],
  hills:    ['#78833f', '#82843f', '#8a7440', '#e8eef1'],
  cliffs:   ['#7d7a6c', '#857f6e', '#827562', '#dfe5e9'],
  mountain: ['#6f6b67', '#77716a', '#776c62', '#e9eef2'],
  village:  ['#6a7a40', '#76803e', '#80703c', '#e3e9ec'],
  water:    ['#2f6593', '#2c6390', '#2c5a82', '#3a6a8a'],
  bridge:   ['#2f6593', '#2c6390', '#2c5a82', '#3a6a8a'],
  ice:      ['#bfe0ef', '#bfe0ef', '#bfe0ef', '#cfeaf5'],
  marsh:    ['#4f6440', '#55663f', '#5f5e3a', '#c9d3d2'],
  sand:     ['#d9c48c', '#e0c98e', '#d6bd86', '#e8e4da'],
  snow:     ['#eef3f6', '#eef3f6', '#eef3f6', '#f2f6f8'],
  ruins:    ['#6f7a4c', '#7a7f4a', '#7f7248', '#dde3e6'],
  lava:     ['#3a1a10', '#3a1a10', '#3a1a10', '#3a1a10'],
  ash:      ['#4a4440', '#4f4843', '#4f4640', '#8a8682'],
  wall:     ['#8a8376', '#8a8376', '#857d70', '#c9c8c4'],
  gate:     ['#8a8376', '#8a8376', '#857d70', '#c9c8c4'],
  keep:     ['#958c7e', '#958c7e', '#8f8678', '#cfcdc8'],
  palisade: ['#6a7a40', '#76803e', '#80703c', '#e3e9ec'],
  tents:    ['#6a7a40', '#76803e', '#80703c', '#e3e9ec'],
};
const SIDE = { water: '#1d3f5e', bridge: '#1d3f5e', ice: '#7fa6b8', lava: '#2a120a', sand: '#9c8355', snow: '#b9c3c9', ash: '#38322e' };
// Terrains drawn as flat textures (clipped to the top); the others also get a prop.
const FLAT = new Set(['grass', 'farmland', 'road', 'water', 'ice', 'marsh', 'sand', 'snow', 'lava', 'ash', 'bridge']);
// Painted tile used as the top texture for a terrain (ISO_TERRAIN keys).
const TEX = { grass: 'grass', farmland: 'farmland', road: 'road', water: 'water', ice: 'ice', marsh: 'marsh', sand: 'sand',
  snow: 'snow', lava: 'lava', hills: 'hills', cliffs: 'hills', bridge: 'water', village: 'grass', palisade: 'grass', tents: 'grass', ruins: 'grass' };
// Painted sprites used as tall props (ISO_TERRAIN or ISO_PROP keys).
const PROP_ART = { forest: ['t', 'forest'], mountain: ['t', 'mountain'], ruins: ['t', 'ruins'], bridge: ['t', 'bridge'],
  wall: ['p', 'wall'], gate: ['p', 'gate'], keep: ['p', 'keep'], palisade: ['p', 'palisade'], tents: ['p', 'tents'] };

const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16); let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; } else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
};

// Opaque bounding box of an image (cached per image).
const bboxCache = new WeakMap();
function opaqueBox(img) {
  if (bboxCache.has(img)) return bboxCache.get(img);
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  let box = { x: 0, y: 0, w, h };
  try {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const cg = c.getContext('2d'); cg.drawImage(img, 0, 0);
    const d = cg.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (d[(y * w + x) * 4 + 3] > 40) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 > x0 && y1 > y0) box = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  } catch { /* tainted canvas: use the whole image */ }
  bboxCache.set(img, box);
  return box;
}
export { opaqueBox };

export class IsoBoard {
  constructor(o) {
    Object.assign(this, o);
    this.a = 20; this.ox = 0; this.oy = 0; this.static = null;
    this.maxZ = Math.max(0, ...this.elev);
  }

  get zh() { return this.a * ZK; }
  zAt(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H ? this.elev[y * this.W + x] : 0; }
  tAt(x, y) { return this.grid[y * this.W + x]; }

  // Smooth elevation at a fractional cell position (bilinear over neighbouring cells).
  zF(x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
    const c = (i, j) => this.zAt(Math.min(this.W - 1, Math.max(0, i)), Math.min(this.H - 1, Math.max(0, j)));
    if (tx < 1e-3 && ty < 1e-3) return c(x0, y0);
    return (c(x0, y0) * (1 - tx) + c(x0 + 1, y0) * tx) * (1 - ty) + (c(x0, y0 + 1) * (1 - tx) + c(x0 + 1, y0 + 1) * tx) * ty;
  }

  fit(w, h, zoom = 1, panX = 0, panY = 0) {
    const { W, H } = this;
    const head = 2.2;   // room above the board for peaks, walls and unit sprites (in a units)
    const aW = (w * 0.96) / (W + H);
    const aH = (h * 0.94) / ((W + H) / 2 + (this.maxZ + BASE) * ZK + head);
    this.a = Math.max(6, Math.min(aW, aH)) * zoom;
    const a = this.a;
    this.ox = w / 2 - ((W - H) / 2) * a + panX;
    const top = -head * a - this.maxZ * this.zh, bot = (W + H) / 2 * a + BASE * this.zh;
    this.oy = (h - (bot - top)) / 2 - top + panY;
  }

  // Screen point of the centre of cell (x, y) on its top surface (z overrides the elevation).
  pt(x, y, z = null) {
    const a = this.a, gx = x + 0.5, gy = y + 0.5;
    const zz = z == null ? this.zF(x, y) : z;
    return { x: this.ox + (gx - gy) * a, y: this.oy + (gx + gy) * a / 2 - zz * this.zh };
  }
  // Board bounds on screen (for spells that sweep the whole field).
  bounds() {
    const a = this.a, { W, H } = this;
    return { x: this.ox - H * a, y: this.oy - this.maxZ * this.zh - a, w: (W + H) * a, h: (W + H) / 2 * a + this.maxZ * this.zh + a };
  }

  diamond(g, x, y, inset = 0) {
    const p = this.pt(x, y, this.zAt(x, y)), a = this.a * (1 - inset), hh = a / 2;
    g.beginPath(); g.moveTo(p.x, p.y - hh); g.lineTo(p.x + a, p.y); g.lineTo(p.x, p.y + hh); g.lineTo(p.x - a, p.y); g.closePath();
  }

  // ---------------------------------------------------------------- static slab
  buildStatic(dpr = 1, w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr));
    const g = c.getContext('2d'); g.scale(dpr, dpr);
    const { W, H } = this;
    // soft shadow under the slab
    const b = this.bounds();
    g.save(); g.fillStyle = 'rgba(0,0,0,0.45)'; g.filter = 'blur(14px)';
    g.beginPath();
    const P = (x, y) => this.pt(x - 0.5, y - 0.5, -BASE - 0.4);
    const c0 = P(0, 0), c1 = P(W, 0), c2 = P(W, H), c3 = P(0, H);
    g.moveTo(c0.x, c0.y + this.a * 0.3); g.lineTo(c1.x + this.a * 0.3, c1.y + this.a * 0.3); g.lineTo(c2.x, c2.y + this.a * 0.5); g.lineTo(c3.x - this.a * 0.3, c3.y + this.a * 0.3); g.fill();
    g.restore();
    void b;
    // tiles back to front
    const order = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) order.push([x, y]);
    order.sort((p, q) => (p[0] + p[1]) - (q[0] + q[1]) || p[0] - q[0]);
    for (const [x, y] of order) this.drawTile(g, x, y);
    this.static = c;
    this.staticW = w; this.staticH = h;
  }

  drawTile(g, x, y) {
    const t = this.tAt(x, y), z = this.zAt(x, y), a = this.a, hh = a / 2, s = this.season ?? 1;
    const p = this.pt(x, y, z);
    const drop = (z + BASE) * this.zh;
    const top = (TOP[t] || TOP.grass)[s] || '#666';
    const side = SIDE[t] || shade(top, -0.45);
    // left and right faces down to the base
    g.fillStyle = shade(side, -0.05);
    g.beginPath(); g.moveTo(p.x - a, p.y); g.lineTo(p.x, p.y + hh); g.lineTo(p.x, p.y + hh + drop); g.lineTo(p.x - a, p.y + drop); g.closePath(); g.fill();
    g.fillStyle = shade(side, -0.25);
    g.beginPath(); g.moveTo(p.x + a, p.y); g.lineTo(p.x, p.y + hh); g.lineTo(p.x, p.y + hh + drop); g.lineTo(p.x + a, p.y + drop); g.closePath(); g.fill();
    // strata lines on tall columns
    if (z >= 1) {
      g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 1;
      for (let k = 1; k <= z; k++) {
        const yy = p.y + k * this.zh;
        g.beginPath(); g.moveTo(p.x - a, yy); g.lineTo(p.x, yy + hh); g.lineTo(p.x + a, yy); g.stroke();
      }
    }
    // top
    g.save();
    this.diamond(g, x, y); g.clip();
    g.fillStyle = top; g.fillRect(p.x - a, p.y - hh, a * 2, a);
    const texKey = TEX[t];
    const img = texKey && this.ISO_TERRAIN && this.artImg(this.ISO_TERRAIN[texKey]);
    if (img && t !== 'ice' || (img && t === 'ice')) {
      const bb = opaqueBox(img);
      const k = (a * 2) / bb.w;
      // map the painted tile's top face (its upper part) onto ours
      g.globalAlpha = s === 3 && t !== 'snow' && t !== 'water' && t !== 'ice' ? 0.55 : 0.92;
      g.drawImage(img, bb.x, bb.y, bb.w, bb.w / 2, p.x - a, p.y - hh, a * 2, a);
      g.globalAlpha = 1;
      void k;
    } else this.texture(g, t, p, x, y, s);
    if (s === 3 && !['water', 'ice', 'snow', 'lava', 'bridge', 'sand'].includes(t)) { g.fillStyle = 'rgba(240,245,250,0.32)'; g.fillRect(p.x - a, p.y - hh, a * 2, a); }
    if (s === 2) { g.fillStyle = 'rgba(200,120,30,0.07)'; g.fillRect(p.x - a, p.y - hh, a * 2, a); }
    // light from the upper left
    const lg = g.createLinearGradient(p.x - a, p.y - hh, p.x + a, p.y + hh);
    lg.addColorStop(0, 'rgba(255,255,240,0.10)'); lg.addColorStop(1, 'rgba(0,0,0,0.12)');
    g.fillStyle = lg; g.fillRect(p.x - a, p.y - hh, a * 2, a);
    g.restore();
    // rim
    g.strokeStyle = 'rgba(0,0,0,0.16)'; g.lineWidth = 1; this.diamond(g, x, y); g.stroke();
    if (t === 'bridge') this.bridgeDeck(g, x, y, p);
  }

  // Procedural texture on a tile top (already clipped to the diamond).
  texture(g, t, p, x, y, s) {
    const a = this.a, r = i => hash(x, y, i);
    for (let i = 0; i < 9; i++) {
      g.fillStyle = r(i) > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
      g.fillRect(p.x + (r(i + 20) - 0.5) * a * 1.6, p.y + (r(i + 40) - 0.5) * a * 0.8, a * 0.1, a * 0.05);
    }
    switch (t) {
      case 'farmland': {
        g.strokeStyle = s === 3 ? 'rgba(150,160,170,0.4)' : 'rgba(80,55,25,0.45)'; g.lineWidth = Math.max(1, a / 14);
        for (let k = -3; k <= 3; k++) { g.beginPath(); g.moveTo(p.x - a + k * a * 0.3, p.y - a * 0.5); g.lineTo(p.x + k * a * 0.3 + a * 0.3, p.y + a * 0.6); g.stroke(); }
        break;
      }
      case 'road': {
        g.fillStyle = 'rgba(70,50,25,0.28)';
        g.beginPath(); g.ellipse(p.x, p.y, a * 0.75, a * 0.2, 0.46, 0, 7); g.fill();
        break;
      }
      case 'marsh':
        for (let i = 0; i < 3; i++) { g.fillStyle = 'rgba(50,90,110,0.6)'; g.beginPath(); g.ellipse(p.x + (r(i + 110) - 0.5) * a, p.y + (r(i + 120) - 0.5) * a * 0.45, a * 0.2, a * 0.08, 0, 0, 7); g.fill(); }
        break;
      case 'sand':
        g.strokeStyle = 'rgba(160,130,80,0.35)'; g.lineWidth = 1;
        for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(p.x - a * 0.7, p.y + (i - 1) * a * 0.18); g.quadraticCurveTo(p.x, p.y + (i - 1) * a * 0.18 - a * 0.08, p.x + a * 0.7, p.y + (i - 1) * a * 0.18); g.stroke(); }
        break;
      case 'ash':
        for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(20,18,16,0.35)'; g.beginPath(); g.arc(p.x + (r(i + 60) - 0.5) * a * 1.4, p.y + (r(i + 70) - 0.5) * a * 0.6, a * 0.05, 0, 7); g.fill(); }
        break;
      case 'ice':
        g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1;
        for (let i = 0; i < 3; i++) { const sx = p.x + (r(i + 80) - 0.5) * a; g.beginPath(); g.moveTo(sx, p.y - a * 0.2); g.lineTo(sx + a * 0.2, p.y); g.lineTo(sx + a * 0.1, p.y + a * 0.2); g.stroke(); }
        break;
      case 'water':
        g.strokeStyle = 'rgba(190,225,255,0.3)'; g.lineWidth = 1;
        for (let i = 0; i < 3; i++) { const wy = p.y + (i - 1) * a * 0.2; g.beginPath(); g.moveTo(p.x - a * 0.4, wy); g.quadraticCurveTo(p.x - a * 0.1, wy - a * 0.08, p.x + a * 0.2, wy); g.stroke(); }
        break;
      case 'lava':
        g.fillStyle = 'rgba(255,90,20,0.55)';
        g.beginPath(); g.moveTo(p.x - a * 0.8, p.y); g.quadraticCurveTo(p.x - a * 0.2, p.y - a * 0.25, p.x + a * 0.8, p.y + a * 0.05); g.lineTo(p.x + a * 0.6, p.y + a * 0.15); g.quadraticCurveTo(p.x - a * 0.2, p.y - a * 0.05, p.x - a * 0.7, p.y + a * 0.12); g.fill();
        break;
    }
  }

  bridgeDeck(g, x, y, p) {
    const a = this.a, horiz = this.tAt(Math.max(0, x - 1), y) !== 'water' || this.tAt(Math.min(this.W - 1, x + 1), y) !== 'water';
    g.save();
    // the deck runs along x (screen down-right) for an east-west road, along y otherwise
    const ux = horiz ? { x: a, y: a / 2 } : { x: -a, y: a / 2 }, vx = horiz ? { x: -a, y: a / 2 } : { x: a, y: a / 2 };
    const wv = 0.32;
    g.fillStyle = '#7a5532';
    g.beginPath();
    g.moveTo(p.x - ux.x * 0.5 - vx.x * wv, p.y - ux.y * 0.5 - vx.y * wv - 3);
    g.lineTo(p.x + ux.x * 0.5 - vx.x * wv, p.y + ux.y * 0.5 - vx.y * wv - 3);
    g.lineTo(p.x + ux.x * 0.5 + vx.x * wv, p.y + ux.y * 0.5 + vx.y * wv - 3);
    g.lineTo(p.x - ux.x * 0.5 + vx.x * wv, p.y - ux.y * 0.5 + vx.y * wv - 3);
    g.closePath(); g.fill();
    g.strokeStyle = '#4e331c'; g.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      const k = -0.5 + i / 6;
      g.beginPath(); g.moveTo(p.x + ux.x * k - vx.x * wv, p.y + ux.y * k - vx.y * wv - 3); g.lineTo(p.x + ux.x * k + vx.x * wv, p.y + ux.y * k + vx.y * wv - 3); g.stroke();
    }
    g.restore();
  }

  drawStatic(g) {
    if (this.static) g.drawImage(this.static, 0, 0, this.staticW, this.staticH);
  }

  // Animated surfaces: water shimmer, ice glint, lava glow.
  drawAnimated(g, t) {
    const a = this.a;
    for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) {
      const k = this.tAt(x, y);
      if (k !== 'water' && k !== 'lava' && k !== 'ice') continue;
      const p = this.pt(x, y, this.zAt(x, y));
      g.save(); this.diamond(g, x, y); g.clip();
      if (k === 'water') {
        const ph = t * 1.6 + hash(x, y, 5) * 6.28;
        g.strokeStyle = `rgba(210,235,255,${0.18 + 0.12 * Math.sin(ph)})`; g.lineWidth = 1.2;
        for (let i = 0; i < 2; i++) { const off = ((t * 0.25 + i * 0.5 + hash(x, y, 9)) % 1) - 0.5; g.beginPath(); g.moveTo(p.x - a * 0.6 + off * a, p.y + off * a * 0.4); g.quadraticCurveTo(p.x + off * a, p.y + off * a * 0.4 - a * 0.07, p.x + a * 0.5 + off * a, p.y + off * a * 0.4); g.stroke(); }
      } else if (k === 'lava') {
        const glow = 0.35 + 0.25 * Math.sin(t * 2.2 + hash(x, y, 3) * 6.28);
        g.fillStyle = `rgba(255,120,30,${glow})`; g.fillRect(p.x - a, p.y - a / 2, a * 2, a);
        g.fillStyle = `rgba(255,220,120,${glow * 0.5})`; g.beginPath(); g.ellipse(p.x + Math.sin(t + x) * a * 0.2, p.y, a * 0.3, a * 0.1, 0, 0, 7); g.fill();
      } else {
        const gx = ((t * 0.12 + hash(x, y, 4)) % 1.4) - 0.2;
        g.fillStyle = 'rgba(255,255,255,0.28)'; g.beginPath(); g.moveTo(p.x - a + gx * a * 2, p.y - a / 2); g.lineTo(p.x - a + gx * a * 2 + a * 0.2, p.y - a / 2); g.lineTo(p.x - a + gx * a * 2 - a * 0.3, p.y + a / 2); g.lineTo(p.x - a + gx * a * 2 - a * 0.5, p.y + a / 2); g.fill();
      }
      g.restore();
    }
  }

  // Tall props, each with its tile for depth sorting.
  props() {
    const out = [];
    for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) {
      const t = this.tAt(x, y);
      if (FLAT.has(t) && t !== 'bridge') continue;
      if (t === 'hills' || t === 'bridge') continue;
      out.push({ x, y, t, draw: (g, now) => this.drawProp(g, x, y, t, now) });
    }
    return out;
  }

  drawProp(g, x, y, t, now) {
    const a = this.a, s = this.season ?? 1, p = this.pt(x, y, this.zAt(x, y)), r = i => hash(x, y, i);
    const pa = PROP_ART[t];
    const img = pa && this.artImg(pa[0] === 't' ? this.ISO_TERRAIN?.[pa[1]] : this.ISO_PROP?.[pa[1]]);
    if (img && t !== 'ruins') {
      const bb = opaqueBox(img);
      const k = (a * 2) / bb.w * (t === 'keep' ? 1.05 : 1);
      const dw = bb.w * k, dh = bb.h * k;
      // the painted tile's base diamond centre (bbox bottom - quarter width) sits on our tile centre
      const ax = p.x - dw / 2, ay = p.y + a * 0.5 - dh + (t === 'forest' || t === 'mountain' ? a * 0.0 : 0);
      g.drawImage(img, bb.x, bb.y, bb.w, bb.h, ax, ay, dw, dh);
      if (s === 3 && t !== 'keep' && t !== 'gate' && t !== 'wall') { g.save(); g.globalAlpha = 0.25; g.globalCompositeOperation = 'lighter'; g.drawImage(img, bb.x, bb.y, bb.w, bb.h, ax, ay, dw, dh); g.restore(); }
      if (t === 'keep') this.banner(g, p.x, ay + dh * 0.05, now);
      return;
    }
    switch (t) {
      case 'forest': {
        for (let i = 0; i < 3; i++) {
          const tx = p.x + (r(i + 1) - 0.5) * a * 1.1, ty = p.y + (r(i + 7) - 0.5) * a * 0.5;
          const hgt = a * (0.75 + r(i + 3) * 0.35), sway = Math.sin(now * 1.3 + i + x) * a * 0.03;
          g.fillStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); g.ellipse(tx + a * 0.1, ty + a * 0.05, a * 0.24, a * 0.09, 0, 0, 7); g.fill();
          g.fillStyle = '#4a3220'; g.fillRect(tx - a * 0.03, ty - hgt * 0.35, a * 0.06, hgt * 0.38);
          const leaf = s === 2 ? '#a3652a' : s === 3 ? '#e8eef0' : '#2f5d27';
          g.fillStyle = leaf;
          g.beginPath(); g.moveTo(tx + sway, ty - hgt); g.lineTo(tx + a * 0.26, ty - hgt * 0.25); g.lineTo(tx - a * 0.26, ty - hgt * 0.25); g.fill();
          g.fillStyle = s === 3 ? '#cdd6db' : shade(leaf, -0.2);
          g.beginPath(); g.moveTo(tx + sway, ty - hgt); g.lineTo(tx + a * 0.26, ty - hgt * 0.25); g.lineTo(tx + a * 0.02, ty - hgt * 0.32); g.fill();
        }
        break;
      }
      case 'mountain': {
        const hgt = a * 1.3;
        g.fillStyle = '#5a5551'; g.beginPath(); g.moveTo(p.x - a * 0.85, p.y + a * 0.1); g.lineTo(p.x - a * 0.05, p.y - hgt); g.lineTo(p.x + a * 0.85, p.y + a * 0.1); g.fill();
        g.fillStyle = '#7f7974'; g.beginPath(); g.moveTo(p.x - a * 0.05, p.y - hgt); g.lineTo(p.x + a * 0.85, p.y + a * 0.1); g.lineTo(p.x + a * 0.1, p.y + a * 0.25); g.fill();
        g.fillStyle = '#eef2f5'; g.beginPath(); g.moveTo(p.x - a * 0.05, p.y - hgt); g.lineTo(p.x - a * 0.3, p.y - hgt * 0.6); g.lineTo(p.x, p.y - hgt * 0.68); g.lineTo(p.x + a * 0.2, p.y - hgt * 0.58); g.fill();
        break;
      }
      case 'cliffs': {
        g.fillStyle = 'rgba(0,0,0,0.18)';
        for (let i = 0; i < 3; i++) { g.fillRect(p.x + (r(i + 30) - 0.5) * a, p.y + (r(i + 31) - 0.6) * a * 0.4, a * 0.25, a * 0.06); }
        g.fillStyle = s === 3 ? '#f3f6f8' : '#9a9384';
        g.beginPath(); g.moveTo(p.x - a * 0.4, p.y); g.lineTo(p.x - a * 0.2, p.y - a * 0.35); g.lineTo(p.x + a * 0.05, p.y - a * 0.1); g.lineTo(p.x + a * 0.3, p.y - a * 0.4); g.lineTo(p.x + a * 0.5, p.y); g.fill();
        break;
      }
      case 'ruins': {
        if (img) {   // the painted ruin, smaller, as a scatter of pillars
          const bb = opaqueBox(img), k = (a * 1.6) / bb.w;
          g.drawImage(img, bb.x, bb.y, bb.w, bb.h, p.x - bb.w * k / 2, p.y + a * 0.4 - bb.h * k, bb.w * k, bb.h * k);
          break;
        }
        for (let i = 0; i < 3; i++) {
          const tx = p.x + (r(i + 50) - 0.5) * a, ty = p.y + (r(i + 51) - 0.5) * a * 0.4, hgt = a * (0.35 + r(i + 52) * 0.6);
          g.fillStyle = '#b8b0a0'; g.fillRect(tx - a * 0.08, ty - hgt, a * 0.16, hgt);
          g.fillStyle = '#8a8274'; g.fillRect(tx, ty - hgt, a * 0.08, hgt);
          g.fillStyle = '#cfc7b6'; g.fillRect(tx - a * 0.11, ty - hgt - a * 0.05, a * 0.22, a * 0.06);
        }
        break;
      }
      case 'village': {
        for (let i = 0; i < 2; i++) {
          const hx = p.x + (i ? a * 0.35 : -a * 0.3), hy = p.y + (i ? a * 0.05 : -a * 0.05);
          this.box(g, hx, hy, a * 0.3, a * 0.28, '#c8b48a', s === 3 ? '#eef2f4' : '#9a5a32');
        }
        break;
      }
      case 'tents': {
        for (let i = 0; i < 2; i++) {
          const hx = p.x + (i ? a * 0.32 : -a * 0.28), hy = p.y + (i ? a * 0.08 : -a * 0.06), w2 = a * 0.32;
          g.fillStyle = i ? '#d9cdb0' : '#c8bb98';
          g.beginPath(); g.moveTo(hx - w2, hy); g.lineTo(hx, hy - a * 0.5); g.lineTo(hx + w2, hy); g.closePath(); g.fill();
          g.fillStyle = 'rgba(0,0,0,0.2)'; g.beginPath(); g.moveTo(hx, hy - a * 0.5); g.lineTo(hx + w2, hy); g.lineTo(hx + a * 0.05, hy); g.fill();
          g.fillStyle = this.defColor || '#a33'; g.fillRect(hx - 1, hy - a * 0.65, a * 0.18, a * 0.08);
        }
        break;
      }
      case 'palisade': {
        g.fillStyle = '#6b4a2a';
        for (let i = -3; i <= 3; i++) {
          const sx = p.x + i * a * 0.22, sy = p.y - i * a * 0.11;
          g.beginPath(); g.moveTo(sx - a * 0.06, sy); g.lineTo(sx - a * 0.06, sy - a * 0.42); g.lineTo(sx, sy - a * 0.52); g.lineTo(sx + a * 0.06, sy - a * 0.42); g.lineTo(sx + a * 0.06, sy); g.fill();
        }
        break;
      }
      case 'wall': case 'gate': {
        this.box(g, p.x, p.y + a * 0.25, a * 0.95, a * 0.75, '#8d8578', null, t === 'gate');
        break;
      }
      case 'keep': {
        this.box(g, p.x, p.y + a * 0.25, a * 0.8, a * 1.6, '#9a9284', null, false);
        this.banner(g, p.x, p.y - a * 1.4, now);
        break;
      }
    }
  }

  // A simple isometric block: half-width w (in a units of the diamond), height h.
  box(g, cx, cy, w, h, wallCol, roofCol, gate = false) {
    const hw = w, hh = w / 2;
    g.fillStyle = shade(wallCol, -0.1);
    g.beginPath(); g.moveTo(cx - hw, cy - hh); g.lineTo(cx, cy); g.lineTo(cx, cy - h); g.lineTo(cx - hw, cy - hh - h); g.fill();
    g.fillStyle = shade(wallCol, -0.32);
    g.beginPath(); g.moveTo(cx + hw, cy - hh); g.lineTo(cx, cy); g.lineTo(cx, cy - h); g.lineTo(cx + hw, cy - hh - h); g.fill();
    if (roofCol) {
      g.fillStyle = roofCol;
      g.beginPath(); g.moveTo(cx - hw * 1.1, cy - hh - h); g.lineTo(cx, cy - h - hh * 2.6); g.lineTo(cx + hw * 1.1, cy - hh - h); g.lineTo(cx, cy - h + hh * 0.2); g.fill();
    } else {
      g.fillStyle = shade(wallCol, 0.12);
      g.beginPath(); g.moveTo(cx, cy - h - hh * 2); g.lineTo(cx + hw, cy - hh - h); g.lineTo(cx, cy - h); g.lineTo(cx - hw, cy - hh - h); g.fill();
      // crenellations
      g.fillStyle = shade(wallCol, -0.2);
      for (let i = 0; i < 4; i++) { const k = i / 3; g.fillRect(cx - hw + k * hw - 2, cy - hh - h - hh * 0.0 + k * hh - h * 0.12 - 2, 4, h * 0.12); }
    }
    if (gate) { g.fillStyle = '#3a2614'; g.beginPath(); g.moveTo(cx - hw * 0.65, cy - hh * 0.3); g.lineTo(cx - hw * 0.65, cy - hh * 0.3 - h * 0.55); g.quadraticCurveTo(cx - hw * 0.45, cy - h * 0.85, cx - hw * 0.2, cy - hh * 0.1 - h * 0.55); g.lineTo(cx - hw * 0.2, cy - hh * 0.1); g.fill(); }
  }

  banner(g, x, y, now) {
    const a = this.a;
    g.strokeStyle = '#3a2a1a'; g.lineWidth = Math.max(1.5, a / 14);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - a * 0.6); g.stroke();
    const wave = Math.sin(now * 3) * a * 0.04;
    g.fillStyle = this.defColor || '#a33';
    g.beginPath(); g.moveTo(x, y - a * 0.6); g.quadraticCurveTo(x + a * 0.2, y - a * 0.62 + wave, x + a * 0.42, y - a * 0.5 + wave); g.lineTo(x, y - a * 0.36); g.fill();
  }

  // ---------------------------------------------------------------- picking
  // The front-most tile whose silhouette (top diamond plus its column down to the base) contains
  // the point; the top diamond wins over a column face behind it.
  pick(sx, sy) {
    const a = this.a, hh = a / 2;
    let best = null, bk = -Infinity;
    for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) {
      const p = this.pt(x, y, this.zAt(x, y));
      const dx = Math.abs(sx - p.x) / a, dy = (sy - p.y) / hh;
      let hit = false;
      if (dx + Math.abs(dy) <= 1) hit = true;   // top diamond
      else if (dx <= 1 && dy > 0) {             // column face below the top
        const drop = (this.zAt(x, y) + BASE) * this.zh / hh;
        if (dy <= 1 - dx + drop) hit = true;
      }
      if (!hit) continue;
      const key = (x + y) * 2 + (dx + Math.abs(dy) <= 1 ? 1 : 0);
      if (key > bk) { bk = key; best = { x, y }; }
    }
    return best;
  }
}
