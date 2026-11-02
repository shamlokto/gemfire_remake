// Shared particle effects for the board and the clash scenes (time in seconds, positions in the
// caller's units). Techniques: cached soft blobs instead of per-frame gradients, multi-stage
// impacts (flash, burst, shockwave ring, embers, tumbling debris, rising smoke), a light budget.
//
//   const P = new Particles();  P.impact(x, y, opts);  P.step(dt);  P.draw(g, scale);

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function canvasOf(w, h) {
  return Object.assign(document.createElement('canvas'), { width: Math.max(1, w | 0), height: Math.max(1, h | 0) });
}

// A soft round blob of one colour, cached (64x64), drawn scaled.
const BLOBS = new Map();
export function blob(r, g, b, hard = false) {
  const key = (((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)) * 2 + (hard ? 1 : 0);
  let c = BLOBS.get(key);
  if (!c) {
    c = canvasOf(64, 64);
    const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    const col = `${(r >> 4) * 17},${(g >> 4) * 17},${(b >> 4) * 17}`;
    if (hard) { gr.addColorStop(0, `rgba(${col},1)`); gr.addColorStop(0.6, `rgba(${col},0.85)`); gr.addColorStop(1, `rgba(${col},0)`); }
    else { gr.addColorStop(0, `rgba(${col},1)`); gr.addColorStop(0.3, `rgba(${col},0.5)`); gr.addColorStop(1, `rgba(${col},0)`); }
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    BLOBS.set(key, c);
  }
  return c;
}
export function hexRgb(hex) {
  if (Array.isArray(hex)) return hex;
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(hex);
  if (m) return [+m[1], +m[2], +m[3]];
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export const reducedMotion = () => {
  try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

// Optional painted effect sprites (on black, drawn with 'screen' blending): explosion, smoke, dust,
// sparks, shockwave. Set by the battle view once the art is loaded; effects work without them.
let FX_IMG = {};
export function setFxImages(map) { FX_IMG = map || {}; }

export class Particles {
  constructor(opts = {}) {
    this.list = [];
    this.max = opts.max || 700;
    this.unit = opts.unit || 1;            // size of "one unit" (cell size on the board, 1 in scenes)
    this.reduced = reducedMotion();
    this.seed = opts.seed || 1234567;
  }
  rnd() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }
  add(p) { if (this.list.length < this.max) this.list.push(p); return p; }
  get count() { return this.list.length; }

  // ---- building blocks (sizes in units)
  flash(x, y, r, col = [255, 240, 210]) { this.add({ k: 'flash', x, y, r: r * this.unit, life: 0.12, max: 0.12, col: hexRgb(col) }); }
  ring(x, y, r, col = [255, 230, 190], speed = 3) { this.add({ k: 'ring', x, y, r: r * this.unit * 0.2, grow: speed * this.unit, life: 0.32, max: 0.32, col: hexRgb(col) }); }
  sparks(x, y, n, col = [255, 210, 140], v = 4, up = 1) {
    const c = hexRgb(col);
    for (let i = 0; i < (this.reduced ? Math.ceil(n / 3) : n); i++) {
      const a = this.rnd() * TAU, s = (0.4 + this.rnd()) * v * this.unit;
      this.add({ k: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - up * this.unit * 1.5, g: 9 * this.unit, drag: 0.9, life: 0.25 + this.rnd() * 0.35, max: 0.6, col: mix(c, [255, 255, 230], this.rnd() * 0.5), w: Math.max(1, this.unit * 0.04) });
    }
  }
  embers(x, y, n, col = [255, 140, 40], spread = 0.5) {
    const c = hexRgb(col);
    for (let i = 0; i < (this.reduced ? Math.ceil(n / 3) : n); i++) {
      this.add({ k: 'ember', x: x + (this.rnd() - 0.5) * spread * this.unit, y: y + (this.rnd() - 0.5) * spread * this.unit * 0.5,
        vx: (this.rnd() - 0.5) * this.unit * 0.8, vy: -(0.6 + this.rnd() * 1.6) * this.unit, g: -0.3 * this.unit, drag: 0.98,
        life: 0.7 + this.rnd() * 0.9, max: 1.6, col: mix(c, [255, 230, 150], this.rnd() * 0.6), r: (0.03 + this.rnd() * 0.04) * this.unit });
    }
  }
  fire(x, y, n, r = 0.25, col = [255, 120, 30]) {
    const c = hexRgb(col);
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * TAU, s = this.rnd() * 0.8 * this.unit;
      this.add({ k: 'fire', x: x + Math.cos(a) * r * 0.3 * this.unit, y: y + Math.sin(a) * r * 0.3 * this.unit, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.4 * this.unit,
        g: -0.6 * this.unit, drag: 0.92, r: (r * 0.5 + this.rnd() * r * 0.5) * this.unit, grow: r * 1.4 * this.unit, life: 0.35 + this.rnd() * 0.3, max: 0.65, col: mix(c, [255, 220, 140], this.rnd() * 0.5) });
    }
  }
  smoke(x, y, n, r = 0.3, shade = 70, delay = 0.08) {
    for (let i = 0; i < (this.reduced ? Math.ceil(n / 2) : n); i++) {
      this.add({ k: 'smoke', x: x + (this.rnd() - 0.5) * r * this.unit, y: y + (this.rnd() - 0.5) * r * 0.5 * this.unit,
        vx: (this.rnd() - 0.5) * 0.3 * this.unit, vy: -(0.25 + this.rnd() * 0.45) * this.unit, g: 0, drag: 0.985,
        r: (r * 0.5 + this.rnd() * r * 0.4) * this.unit, grow: r * 0.9 * this.unit, life: 1.0 + this.rnd() * 0.9, max: 1.9, shade: shade + (this.rnd() * 40 | 0), delay: delay * this.rnd() });
    }
  }
  dust(x, y, n, col = [175, 155, 120], r = 0.25) {
    const c = hexRgb(col);
    for (let i = 0; i < (this.reduced ? Math.ceil(n / 2) : n); i++) {
      this.add({ k: 'dust', x: x + (this.rnd() - 0.5) * r * 2 * this.unit, y, vx: (this.rnd() - 0.5) * 0.9 * this.unit, vy: -(0.1 + this.rnd() * 0.35) * this.unit,
        g: 0, drag: 0.95, r: r * (0.6 + this.rnd() * 0.6) * this.unit, grow: r * 1.2 * this.unit, life: 0.6 + this.rnd() * 0.5, max: 1.1, col: c, a: 0.45 });
    }
  }
  debris(x, y, n, col = [120, 100, 80], v = 3) {
    const c = hexRgb(col);
    for (let i = 0; i < (this.reduced ? Math.ceil(n / 3) : n); i++) {
      const a = -Math.PI / 2 + (this.rnd() - 0.5) * 2.4, s = (0.5 + this.rnd()) * v * this.unit;
      this.add({ k: 'debris', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 12 * this.unit, drag: 0.985, life: 0.7 + this.rnd() * 0.6, max: 1.3,
        col: mix(c, [60, 50, 40], this.rnd() * 0.5), r: (0.04 + this.rnd() * 0.06) * this.unit, rot: this.rnd() * 6, vr: (this.rnd() - 0.5) * 18, hot: this.rnd() < 0.3, floor: y + this.unit * (0.1 + this.rnd() * 0.3) });
    }
  }
  leaves(x, y, n, cols = [[110, 150, 50], [170, 140, 40], [90, 120, 40]]) {
    for (let i = 0; i < n; i++) {
      const c = cols[(this.rnd() * cols.length) | 0];
      this.add({ k: 'leaf', x: x + (this.rnd() - 0.5) * this.unit, y: y - this.rnd() * this.unit * 0.6, vx: (this.rnd() - 0.5) * this.unit * 1.5, vy: -this.rnd() * this.unit,
        g: 1.2 * this.unit, drag: 0.94, life: 1.2 + this.rnd(), max: 2.2, col: c, r: 0.05 * this.unit, rot: this.rnd() * 6, vr: (this.rnd() - 0.5) * 8 });
    }
  }
  snowPuff(x, y, n) { this.dust(x, y, n, [235, 242, 252], 0.22); }
  streak(x, y, vx, vy, col, life = 0.25, w = 1) { this.add({ k: 'spark', x, y, vx, vy, g: 0, drag: 1, life, max: life, col: hexRgb(col), w }); }

  // A painted effect sprite: grows, spins a little and fades.
  sprite(name, x, y, r, life = 0.6, grow = 1.2, alpha = 1) {
    const img = FX_IMG[name];
    if (!img) return null;
    return this.add({ k: 'img', img, x, y, r: r * this.unit, grow: grow * r * this.unit, rot: this.rnd() * TAU, vr: (this.rnd() - 0.5) * 1.2, life, max: life, alpha });
  }

  // ---- composite effects
  // A melee contact: sparks and a little flash; heavier with `power` (0..1).
  clash(x, y, power = 0.5, col = [255, 210, 140]) {
    this.flash(x, y, 0.35 + power * 0.4, mix(hexRgb(col), [255, 255, 255], 0.5));
    this.sparks(x, y, 8 + power * 18, col, 3 + power * 3);
    if (power > 0.3) this.sprite('sparks', x, y, 0.3 + power * 0.35, 0.35, 0.8, 0.85);
  }
  // A shot landing: small flash, sparks, dust.
  hit(x, y, col = [240, 225, 190]) {
    this.flash(x, y, 0.25, col);
    this.sparks(x, y, 6, col, 2.5);
    this.dust(x, y + 0.1 * this.unit, 2);
  }
  // Multi-stage explosion: flash, fireball, shockwave ring, sparks, embers, debris, smoke.
  explode(x, y, size = 1, col = [255, 140, 50]) {
    const c = hexRgb(col), hot = [255, 230, 175];
    this.flash(x, y, 1.1 * size, hot);
    this.ring(x, y, 1 * size, mix(c, [220, 235, 255], 0.5), 4.5 * size);
    this.fire(x, y, Math.round(6 * size), 0.35 * size, c);
    this.sparks(x, y, Math.round(18 * size), mix(c, hot, 0.5), 5 * size);
    this.debris(x, y, Math.round(8 * size), [110, 95, 80], 3.5 * size);
    this.embers(x, y, Math.round(10 * size), c, 0.8 * size);
    this.smoke(x, y - 0.1 * this.unit, Math.round(5 * size), 0.5 * size, 50, 0.15);
    this.sprite('explosion', x, y - 0.1 * this.unit, 0.75 * size, 0.55, 0.9);
    this.sprite('shockwave', x, y, 0.5 * size, 0.45, 3.2, 0.8);
    this.sprite('smoke', x, y - 0.25 * this.unit, 0.6 * size, 1.4, 0.7, 0.5);
  }
  // A unit destroyed / routed on the board: banner-coloured burst plus smoke and dust.
  unitBurst(x, y, col, dead = false) {
    const c = hexRgb(col);
    this.flash(x, y, dead ? 0.9 : 0.6, mix(c, [255, 255, 255], 0.5));
    this.ring(x, y, 0.8, mix(c, [255, 240, 200], 0.4), dead ? 4 : 3);
    this.sparks(x, y, dead ? 22 : 12, mix(c, [255, 230, 180], 0.4), 3.5);
    this.embers(x, y, dead ? 12 : 6, c, 0.6);
    this.smoke(x, y, dead ? 6 : 3, 0.45, 60);
    this.dust(x, y + 0.3 * this.unit, 5);
    if (dead) this.debris(x, y, 6, [100, 85, 70], 3);
    this.sprite('dust', x, y + 0.15 * this.unit, 0.6, 1.1, 0.9, 0.7);
    if (dead) this.sprite('shockwave', x, y, 0.35, 0.4, 3, 0.7);
  }

  step(dt) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      if (p.delay > 0) { p.delay -= dt; continue; }
      p.life -= dt;
      if (p.life <= 0) { L[i] = L[L.length - 1]; L.pop(); continue; }
      if (p.vx !== undefined) {
        const d = Math.pow(p.drag ?? 1, dt * 60);
        p.vx *= d; p.vy *= d; p.vy += (p.g || 0) * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
      }
      if (p.grow) p.r += p.grow * dt;
      if (p.vr) p.rot += p.vr * dt;
      if (p.k === 'debris' && p.y > p.floor) { p.y = p.floor; p.vy *= -0.3; p.vx *= 0.6; p.vr *= 0.5; }
    }
  }

  // Draw all particles; `sx, sy` map caller units to pixels (scene scale), default 1.
  draw(g, S = 1, ox = 0, oy = 0) {
    const L = this.list;
    if (!L.length) return;
    g.save();
    // smoke and dust first (normal blending), then additive light
    for (const p of L) {
      if (p.delay > 0) continue;
      const a = clamp(p.life / p.max, 0, 1);
      const X = ox + p.x * S, Y = oy + p.y * S;
      if (p.k === 'smoke') {
        const sh = p.shade; g.globalAlpha = 0.5 * a * Math.min(1, (p.max - p.life) * 6);
        const r = p.r * S; g.drawImage(blob(sh, sh, sh + 8), X - r, Y - r, r * 2, r * 2);
      } else if (p.k === 'dust') {
        g.globalAlpha = (p.a ?? 0.4) * a; const r = p.r * S; g.drawImage(blob(...p.col.map(v => v | 0)), X - r, Y - r, r * 2, r * 2);
      } else if (p.k === 'debris') {
        g.globalAlpha = Math.min(1, a * 2); g.save(); g.translate(X, Y); g.rotate(p.rot);
        g.fillStyle = p.hot && a > 0.5 ? 'rgb(255,150,60)' : `rgb(${p.col[0] | 0},${p.col[1] | 0},${p.col[2] | 0})`;
        const r = p.r * S; g.fillRect(-r, -r * 0.6, r * 2, r * 1.2); g.restore();
      } else if (p.k === 'leaf') {
        g.globalAlpha = Math.min(1, a * 2); g.save(); g.translate(X, Y); g.rotate(p.rot);
        g.fillStyle = `rgb(${p.col[0]},${p.col[1]},${p.col[2]})`; const r = p.r * S;
        g.beginPath(); g.ellipse(0, 0, r, r * 0.45, 0, 0, TAU); g.fill(); g.restore();
      }
    }
    // painted effect sprites (images on black) with screen blending
    g.globalCompositeOperation = 'screen';
    for (const p of L) {
      if (p.k !== 'img' || p.delay > 0) continue;
      const a = clamp(p.life / p.max, 0, 1);
      const X = ox + p.x * S, Y = oy + p.y * S, r = p.r * S;
      g.globalAlpha = (p.alpha ?? 1) * Math.min(1, a * 1.6) * Math.min(1, (p.max - p.life) * 12);
      g.save(); g.translate(X, Y); g.rotate(p.rot); g.drawImage(p.img, -r, -r, r * 2, r * 2); g.restore();
    }
    g.globalCompositeOperation = 'lighter';
    for (const p of L) {
      if (p.delay > 0) continue;
      const a = clamp(p.life / p.max, 0, 1);
      const X = ox + p.x * S, Y = oy + p.y * S;
      if (p.k === 'flash') {
        g.globalAlpha = a; const r = p.r * S * (1.3 - a * 0.3);
        g.drawImage(blob(...p.col.map(v => v | 0), true), X - r, Y - r, r * 2, r * 2);
      } else if (p.k === 'ring') {
        g.globalAlpha = a * 0.8; g.strokeStyle = `rgb(${p.col[0] | 0},${p.col[1] | 0},${p.col[2] | 0})`;
        g.lineWidth = Math.max(1, p.r * S * 0.12 * a); g.beginPath(); g.ellipse(X, Y, p.r * S, p.r * S * 0.45, 0, 0, TAU); g.stroke();
      } else if (p.k === 'spark') {
        g.globalAlpha = a; g.strokeStyle = `rgb(${p.col[0] | 0},${p.col[1] | 0},${p.col[2] | 0})`; g.lineWidth = (p.w || 1) * Math.max(1, S * 0.6);
        g.beginPath(); g.moveTo(X, Y); g.lineTo(X - p.vx * S * 0.035, Y - p.vy * S * 0.035); g.stroke();
      } else if (p.k === 'ember') {
        g.globalAlpha = a; const r = p.r * S * 3;
        g.drawImage(blob(...p.col.map(v => v | 0), true), X - r, Y - r, r * 2, r * 2);
      } else if (p.k === 'fire') {
        g.globalAlpha = a * 0.9; const r = p.r * S;
        g.drawImage(blob(...mix(p.col, [180, 40, 10], 1 - a).map(v => v | 0)), X - r, Y - r, r * 2, r * 2);
      }
    }
    g.restore();
  }
}
