// Spirit spells on the battle board, each a short animated sequence (original designs):
//   Ember Stag   charges along the line, each square bursting into flame as it passes
//   Tide Serpent rises in the middle of the area, then a wave sweeps across it
//   Gale Owl     sweeps over a darkening sky and calls three forked lightning bolts
//   Stone Warden rises, slams the ground, and the wall erupts square by square
//   Dusk Moth    descends into a swirl of moths and violet mist
//
//   const A = new SpellAnim(evt, env); each frame: A.update(k, dt); A.draw(g, k)
//   A.dur (ms), A.hitK(cell) -> k at which damage shows on that square
// env = { px(cx, cy) -> {x, y}, cs, P (Particles in pixels, unit = cs), shake(v), whiteout(a, rgb), sfx(name), board: {x, y, w, h} }

import { drawSpirit } from './spirit-art.js';
import { blob } from './fx.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOut = t => 1 - Math.pow(1 - t, 3);

export class SpellAnim {
  constructor(e, env) {
    this.e = e; this.env = env; this.id = e.spirit;
    this.cells = e.cells.slice();
    this.fired = new Set();
    this.dur = { ember: 2100, tide: 2300, gale: 2400, stone: 2000, dusk: 2300 }[this.id] || 2000;
    const P = this.cells.map(c => env.px(c.x, c.y));
    this.pts = P;
    this.cx = P.reduce((s, p) => s + p.x, 0) / Math.max(1, P.length);
    this.cy = P.reduce((s, p) => s + p.y, 0) / Math.max(1, P.length);
    if (this.id === 'ember') {
      // order the line from the caster outward
      const c0 = e.casterAt ? env.px(e.casterAt.x, e.casterAt.y) : P[0];
      const idx = this.cells.map((c, i) => i).sort((a, b) => Math.hypot(P[a].x - c0.x, P[a].y - c0.y) - Math.hypot(P[b].x - c0.x, P[b].y - c0.y));
      this.cells = idx.map(i => this.cells[i]); this.pts = idx.map(i => P[i]);
      this.start = c0;
    }
    if (this.id === 'tide') {
      const xs = this.pts.map(p => p.x);
      this.x0 = Math.min(...xs) - env.cs * 0.6; this.x1 = Math.max(...xs) + env.cs * 0.6;
    }
    this.moths = [];
    if (this.id === 'dusk') for (let i = 0; i < 44; i++) this.moths.push({ a: Math.random() * 6.28, r: Math.random(), sp: 0.6 + Math.random() * 1.4, ph: Math.random() * 6.28 });
  }

  // When damage appears on a square (0..1 of the sequence).
  hitK(cell) {
    const i = this.cells.findIndex(c => c.x === cell.x && c.y === cell.y);
    if (this.id === 'ember') return 0.18 + 0.55 * (Math.max(0, i) / Math.max(1, this.cells.length - 1));
    if (this.id === 'tide') { const p = this.env.px(cell.x, cell.y); return 0.42 + 0.3 * clamp((p.x - this.x0) / (this.x1 - this.x0), 0, 1); }
    if (this.id === 'gale') return [0.36, 0.52, 0.68][Math.max(0, i) % 3];
    if (this.id === 'dusk') return 0.45;
    return 0.4;
  }

  once(key, fn) { if (!this.fired.has(key)) { this.fired.add(key); fn(); } }

  update(k, dt) {
    const { P, cs, shake, whiteout, sfx } = this.env;
    if (this.id === 'ember') {
      this.cells.forEach((c, i) => {
        const hk = this.hitK(c), p = this.pts[i];
        if (k >= hk) this.once('ign' + i, () => { P.fire(p.x, p.y + cs * 0.2, 6, 0.4); P.flash(p.x, p.y, 0.8, [255, 170, 80]); P.embers(p.x, p.y, 8, [255, 130, 40], 0.8); shake(3); if (i % 2 === 0) sfx('spell'); });
        if (k >= hk && k < 0.95 && Math.random() < dt * 14) { P.fire(p.x + (Math.random() - 0.5) * cs * 0.6, p.y + cs * 0.25, 1, 0.3); if (Math.random() < 0.3) P.embers(p.x, p.y, 1, [255, 150, 60], 0.6); }
        if (k >= hk + 0.1 && Math.random() < dt * 3) P.smoke(p.x, p.y - cs * 0.2, 1, 0.5, 50, 0);
      });
    } else if (this.id === 'tide') {
      if (k > 0.08) this.once('rise', () => { sfx('spell'); P.sparks(this.cx, this.cy, 24, [170, 225, 255], 4, 2); });
      if (k > 0.4 && k < 0.75) {
        const fx = this.x0 + (this.x1 - this.x0) * (k - 0.4) / 0.35;
        for (const p of this.pts) if (Math.abs(p.x - fx) < cs * 0.5 && Math.random() < dt * 30) P.sparks(fx, p.y + cs * 0.1, 3, [200, 240, 255], 3, 2);
        if (Math.random() < dt * 8) shake(2);
      }
      if (k > 0.42) this.once('wave', () => sfx('hit'));
    } else if (this.id === 'gale') {
      [0.36, 0.52, 0.68].forEach((hk, i) => {
        const p = this.pts[i]; if (!p) return;
        if (k >= hk) this.once('bolt' + i, () => {
          whiteout(0.55, [225, 235, 255]); shake(9); P.explode(p.x, p.y, 0.8, [190, 210, 255]); P.sparks(p.x, p.y, 20, [230, 240, 255], 5);
          sfx('hit'); sfx('gate');
        });
      });
    } else if (this.id === 'stone') {
      if (k >= 0.36) this.once('slam', () => {
        shake(12); whiteout(0.2, [255, 230, 190]); sfx('gate'); sfx('hit');
        P.ring(this.cx, this.cy + cs * 0.3, 2, [230, 200, 150], 7); P.debris(this.cx, this.cy, 18, [130, 110, 85], 5); P.dust(this.cx, this.cy + cs * 0.3, 10, [160, 140, 110], 0.5);
      });
      this.cells.forEach((c, i) => {
        const at = 0.4 + i * 0.07, p = this.pts[i];
        if (k >= at) this.once('rock' + i, () => { P.debris(p.x, p.y + cs * 0.2, 8, [140, 118, 90], 3.5); P.dust(p.x, p.y + cs * 0.3, 4, [160, 140, 110], 0.4); shake(4); });
      });
    } else if (this.id === 'dusk') {
      if (k > 0.1) this.once('arrive', () => sfx('spell'));
      if (k > 0.25 && k < 0.85 && Math.random() < dt * 10) {
        const p = this.pts[(Math.random() * this.pts.length) | 0];
        P.smoke(p.x, p.y, 1, 0.9, 120, 0);
      }
    }
  }

  // Wall squares rise one after another (battleview reads this for Bulwark).
  wallRiseAt(i) { return 0.4 + i * 0.07; }

  draw(g, k, t) {
    const { cs, board } = this.env;
    const id = this.id;
    if (id === 'ember') {
      // scorched glow under burning squares
      this.cells.forEach((c, i) => {
        const hk = this.hitK(c), p = this.pts[i];
        if (k < hk) return;
        const a = clamp((k - hk) / 0.05, 0, 1) * clamp((1 - k) / 0.2, 0, 1);
        g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.7 * a;
        const r = cs * 0.8; g.drawImage(blob(255, 110, 30), p.x - r, p.y - r * 0.7, r * 2, r * 1.4); g.restore();
        drawFlames(g, p.x, p.y + cs * 0.35, cs, t * 1.3 + i, a);
      });
      // the stag runs the line
      const u = clamp((k - 0.08) / 0.7, 0, 1);
      if (k < 0.85) {
        const pts = [this.start, ...this.pts];
        const seg = u * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(seg)), f = seg - i;
        const a = pts[i], b = pts[i + 1] || a;
        const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f;
        const al = k < 0.1 ? k / 0.1 : k > 0.75 ? (0.85 - k) / 0.1 : 1;
        drawSpirit(g, 'ember', x, y - cs * 0.55, cs * 2.4, t, { facing: b.x >= a.x ? 1 : -1, run: 1, alpha: al });
      }
    } else if (id === 'tide') {
      // serpent rises at the centre, then dives as the wave goes
      const rise = k < 0.35 ? easeOut(k / 0.35) : 1 - clamp((k - 0.5) / 0.2, 0, 1);
      if (rise > 0.01) {
        g.save(); g.beginPath(); g.rect(board.x - cs * 4, board.y - cs * 6, board.w + cs * 8, this.cy + cs * 0.4 - board.y + cs * 6); g.clip();
        drawSpirit(g, 'tide', this.cx, this.cy + cs * 1.6 - rise * cs * 2.4, cs * 3.4, t, { alpha: rise });
        g.restore();
        g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.5 * rise;
        g.drawImage(blob(60, 170, 255), this.cx - cs * 1.4, this.cy - cs * 0.3, cs * 2.8, cs * 1.0); g.restore();
      }
      // water over the area, the wave front sweeping across
      if (k > 0.38) {
        const fx = this.x0 + (this.x1 - this.x0) * clamp((k - 0.4) / 0.35, 0, 1);
        const fade = clamp((1 - k) / 0.25, 0, 1);
        for (const p of this.pts) {
          if (p.x - cs / 2 > fx) continue;
          g.fillStyle = `rgba(40,130,210,${0.45 * fade})`; g.fillRect(p.x - cs / 2, p.y - cs / 2, cs, cs);
          g.strokeStyle = `rgba(200,240,255,${0.35 * fade})`; g.lineWidth = 1;
          for (let j = 0; j < 2; j++) { const yy = p.y - cs * 0.2 + j * cs * 0.3 + Math.sin(t * 4 + p.x * 0.05 + j) * cs * 0.05; g.beginPath(); g.moveTo(p.x - cs * 0.4, yy); g.quadraticCurveTo(p.x, yy - cs * 0.08, p.x + cs * 0.4, yy); g.stroke(); }
        }
        if (k < 0.78) {   // the crest
          const top = Math.min(...this.pts.map(p => p.y)) - cs * 0.9, bot = Math.max(...this.pts.map(p => p.y)) + cs * 0.5;
          const gr = g.createLinearGradient(fx - cs, 0, fx + cs * 0.3, 0);
          gr.addColorStop(0, 'rgba(30,110,190,0)'); gr.addColorStop(0.7, 'rgba(60,160,230,0.75)'); gr.addColorStop(1, 'rgba(230,250,255,0.95)');
          g.fillStyle = gr;
          g.beginPath(); g.moveTo(fx - cs, bot);
          for (let yy = bot; yy >= top; yy -= cs * 0.25) g.lineTo(fx + Math.sin(yy * 0.08 + t * 6) * cs * 0.12, yy);
          g.quadraticCurveTo(fx + cs * 0.5, top - cs * 0.2, fx - cs * 0.1, top + cs * 0.3); g.lineTo(fx - cs, top + cs * 0.3); g.closePath(); g.fill();
        }
      }
    } else if (id === 'gale') {
      const dark = k < 0.2 ? k / 0.2 : k > 0.85 ? (1 - k) / 0.15 : 1;
      g.fillStyle = `rgba(10,14,30,${0.42 * dark})`; g.fillRect(board.x - cs * 3, board.y - cs * 3, board.w + cs * 6, board.h + cs * 6);
      // the owl sweeps across the top
      const u = clamp(k / 0.75, 0, 1);
      const ox = board.x - cs * 2 + (board.w + cs * 4) * ease(u), oy = board.y + cs * 1.6 + Math.sin(u * Math.PI) * cs * 0.8;
      if (k < 0.8) drawSpirit(g, 'gale', ox, oy, cs * 3, t, { run: 1, alpha: dark });
      [0.36, 0.52, 0.68].forEach((hk, i) => {
        const p = this.pts[i]; if (!p || k < hk || k > hk + 0.1) return;
        const a = 1 - (k - hk) / 0.1;
        drawBolt(g, ox, oy + cs * 0.4, p.x, p.y, cs, a, i * 7 + Math.floor(t * 30));
      });
      // scorch marks
      [0.36, 0.52, 0.68].forEach((hk, i) => {
        const p = this.pts[i]; if (!p || k < hk) return;
        g.save(); g.globalAlpha = 0.5 * clamp((1 - k) / 0.3, 0, 1); g.drawImage(blob(10, 10, 20), p.x - cs * 0.5, p.y - cs * 0.15, cs, cs * 0.5); g.restore();
      });
    } else if (id === 'stone') {
      const rise = k < 0.3 ? easeOut(k / 0.3) : k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
      const slam = k > 0.3 && k < 0.42 ? Math.sin((k - 0.3) / 0.12 * Math.PI) : 0;
      if (rise > 0.01) drawSpirit(g, 'stone', this.cx, this.cy - cs * 1.2 - slam * cs * 0.4 + (1 - rise) * cs, cs * 2.8, t, { alpha: rise });
      // cracks spreading from the slam
      if (k > 0.36) {
        const a = clamp((1 - k) / 0.3, 0, 1), L = cs * 2.5 * easeOut(clamp((k - 0.36) / 0.15, 0, 1));
        g.save(); g.strokeStyle = `rgba(255,190,110,${0.7 * a})`; g.lineWidth = 2; g.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 6; i++) { const ang = i * 1.05 + 0.3; g.beginPath(); g.moveTo(this.cx, this.cy + cs * 0.3); g.lineTo(this.cx + Math.cos(ang) * L * 0.5 + Math.sin(i * 3) * cs * 0.2, this.cy + cs * 0.3 + Math.sin(ang) * L * 0.25); g.lineTo(this.cx + Math.cos(ang) * L, this.cy + cs * 0.3 + Math.sin(ang) * L * 0.45); g.stroke(); }
        g.restore();
      }
    } else if (id === 'dusk') {
      const come = k < 0.3 ? easeOut(k / 0.3) : k > 0.85 ? 1 - (k - 0.85) / 0.15 : 1;
      g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.45 * come;
      for (const p of this.pts) g.drawImage(blob(140, 90, 255), p.x - cs * 0.8, p.y - cs * 0.8, cs * 1.6, cs * 1.6);
      g.restore();
      drawSpirit(g, 'dusk', this.cx, this.cy - cs * 2.4 + (1 - come) * -cs * 2, cs * 2.8, t, { alpha: come });
      // the swarm
      const R = cs * 2.4;
      g.save();
      for (const m of this.moths) {
        const sw = clamp((k - 0.2) / 0.15, 0, 1) * come;
        if (sw <= 0) continue;
        const a = m.a + t * m.sp;
        const rr = R * (0.3 + 0.7 * m.r) * (0.8 + 0.2 * Math.sin(t * 2 + m.ph));
        const x = this.cx + Math.cos(a) * rr, y = this.cy + Math.sin(a * 1.3) * rr * 0.55 - cs * 0.2;
        const fl = Math.abs(Math.sin(t * 22 + m.ph));
        g.globalAlpha = sw;
        g.fillStyle = m.r > 0.5 ? '#c8a8ff' : '#8a5ae0';
        const s = cs * 0.09;
        g.beginPath(); g.ellipse(x - s * fl, y, s * fl + 0.5, s * 0.7, -0.4, 0, 6.28); g.ellipse(x + s * fl, y, s * fl + 0.5, s * 0.7, 0.4, 0, 6.28); g.fill();
      }
      g.restore();
    }
  }
}

function drawFlames(g, x, y, cs, t, a) {
  if (a <= 0.02) return;
  g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = a;
  for (let i = 0; i < 4; i++) {
    const fx = x + (i - 1.5) * cs * 0.2, h = cs * (0.45 + 0.25 * Math.abs(Math.sin(t * 5 + i * 1.7)));
    const sway = Math.sin(t * 7 + i * 2.3) * cs * 0.07;
    const gr = g.createLinearGradient(fx, y, fx, y - h);
    gr.addColorStop(0, 'rgba(255,90,20,0.9)'); gr.addColorStop(0.5, 'rgba(255,170,60,0.75)'); gr.addColorStop(1, 'rgba(255,230,140,0)');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(fx - cs * 0.12, y); g.quadraticCurveTo(fx - cs * 0.14 + sway, y - h * 0.5, fx + sway * 1.5, y - h); g.quadraticCurveTo(fx + cs * 0.14 + sway, y - h * 0.45, fx + cs * 0.12, y); g.fill();
  }
  g.restore();
}

function drawBolt(g, x0, y0, x1, y1, cs, a, seed) {
  g.save(); g.globalCompositeOperation = 'lighter';
  const pts = [[x0, y0]];
  const n = 9;
  for (let i = 1; i < n; i++) {
    const k = i / n;
    const j = Math.sin(seed * 12.9 + i * 78.2) * cs * 0.5 * (1 - Math.abs(0.5 - k));
    pts.push([x0 + (x1 - x0) * k + j, y0 + (y1 - y0) * k + Math.cos(seed + i) * cs * 0.1]);
  }
  pts.push([x1, y1]);
  for (const [w, col] of [[cs * 0.22, `rgba(130,160,255,${0.35 * a})`], [cs * 0.08, `rgba(200,220,255,${0.8 * a})`], [cs * 0.03, `rgba(255,255,255,${a})`]]) {
    g.strokeStyle = col; g.lineWidth = w; g.lineJoin = 'round';
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
  }
  // a fork
  const m = pts[4];
  g.strokeStyle = `rgba(220,230,255,${0.7 * a})`; g.lineWidth = cs * 0.03;
  g.beginPath(); g.moveTo(m[0], m[1]); g.lineTo(m[0] + cs * 0.6, m[1] + cs * 0.5); g.lineTo(m[0] + cs * 0.5, m[1] + cs * 1.0); g.stroke();
  g.globalAlpha = a; g.drawImage(blob(200, 220, 255), x1 - cs, y1 - cs * 0.6, cs * 2, cs * 1.2);
  g.restore();
}
