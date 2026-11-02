// Renderer for the clash scene (choreo.js). The choreography decides what is where; this draws
// it cinematically:
//   * a painted backdrop (the troop's clash painting when installed, else a procedural sky and
//     hills in the terrain's and season's colours) set back with depth-of-field blur, light
//     shafts, colour grading per weather/terrain, letterbox bars and a HUD per side
//   * remastered figures (figcache.js) with motion blur on fast moves
//   * weapons as light: arrows and bolts with faint trails, muzzle flashes and smoke for powder
//     units, burning stones with a trail and a ground shadow
//   * multi-stage impacts (fx.js); big hits punch the camera in and shake it (not with reduced
//     motion)
//
//   const R = new ClashRenderer(scene, opts);  after each scene.step(): R.update();
//   R.render(cg, W, H, alpha, open)            alpha: 0..1 between the last two steps

import { SW, SH } from './choreo.js';
import { palette, MOUNTED, POWDER, FLYING, HUGE } from './figures.js';
import { blitFigure } from './figcache.js';
import { drawSpirit } from './spirit-art.js';
import { Particles, canvasOf, blob, hexRgb, mix, reducedMotion } from './fx.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOut = t => 1 - Math.pow(1 - t, 3);
const SPIRIT_COL = { ember: '#ff7a2f', tide: '#3fb6ff', gale: '#d6e4ff', stone: '#c8a060', dusk: '#9a6bff' };

const SKY = {   // [top, horizon] by season, then weather overrides
  0: ['#5b7fae', '#d9c9a8'], 1: ['#3f78c0', '#f0d9a0'], 2: ['#6a4e6a', '#f0a860'], 3: ['#7a8aa0', '#e4e8ee'],
  rain: ['#38485a', '#8a9098'], snow: ['#8e9cb0', '#eef1f6'], fog: ['#7c8880', '#c4c8c0'],
};
const GROUND = {
  plains: ['#5f7f3a', '#3b5626'], forest: ['#3f6a30', '#24401c'], hills: ['#7a7a44', '#4a4c2a'], mountain: ['#77746a', '#4a4842'],
  marsh: ['#4f6a48', '#2c3f30'], coast: ['#a89a6a', '#6a6448'],
};
const GRADE = { rain: 'rgba(40,60,100,0.22)', snow: 'rgba(220,235,255,0.12)', fog: 'rgba(170,180,175,0.2)', 2: 'rgba(240,140,50,0.10)', 3: 'rgba(200,220,255,0.10)', 0: 'rgba(255,230,200,0.05)', 1: 'rgba(255,220,150,0.06)' };

export class ClashRenderer {
  constructor(scene, opts) {
    this.sc = scene;
    this.o = opts;
    this.P = new Particles({ unit: 22, max: 900, seed: (scene.cfg.seed || 7) * 31 });
    this.reduced = reducedMotion();
    this.shake = 0; this.punch = null; this.whiteout = 0; this.flashCol = [255, 250, 235];
    this.pending = [];     // delayed effects { f, e }
    this.pops = [];        // floating numbers / labels
    this.bg = null; this.bgKey = '';
    this.pal = { attacker: palette(opts.colours.attacker.color, opts.colours.attacker.accent), defender: palette(opts.colours.defender.color, opts.colours.defender.accent) };
    this.rim = { attacker: mix(hexRgb(opts.colours.attacker.color), [255, 255, 255], 0.45), defender: mix(hexRgb(opts.colours.defender.color), [255, 255, 255], 0.45) };
    this.rimCss = { attacker: `rgb(${this.rim.attacker.map(v => v | 0)})`, defender: `rgb(${this.rim.defender.map(v => v | 0)})` };
    this.sfx = opts.sfx || (() => {});
    this.trails = new Map();
  }

  // ---------------------------------------------------------------- events -> effects
  update() {
    const sc = this.sc, P = this.P, f = sc.f;
    for (const e of sc.drain()) {
      if (e.at && e.at > f) { this.pending.push({ f: e.at, e: { ...e, at: 0 } }); continue; }
      this.apply(e);
    }
    for (let i = this.pending.length - 1; i >= 0; i--) if (this.pending[i].f <= f) { this.apply(this.pending[i].e); this.pending.splice(i, 1); }
    // burning stones trail fire and smoke
    for (const sh of sc.shots) {
      const p = sc.shotAt(sh, f);
      if (!p.live || p.k >= 1) continue;
      if (sh.kind === 'stone') { P.fire(p.x, p.y, 1, 0.22); if (f % 2 === 0) P.smoke(p.x, p.y, 1, 0.3, 50, 0); }
      if (sh.kind === 'ball' && f % 2 === 0) P.smoke(p.x, p.y, 1, 0.2, 90, 0);
    }
    P.step(1 / 60);
    this.shake *= 0.86; if (this.shake < 0.2) this.shake = 0;
    this.whiteout *= 0.84;
    if (this.punch) { this.punch.t++; if (this.punch.t > 40) this.punch = null; }
    for (const p of this.pops) p.t++;
    this.pops = this.pops.filter(p => p.t < p.life);
  }

  hitStop() {}

  apply(e) {
    const P = this.P, sc = this.sc, red = this.reduced;
    switch (e.k) {
      case 'sfx': if (!e.quiet || Math.random() < 0.5) this.sfx(e.name); break;
      case 'dust': P.dust(e.x, e.y, e.n || 1, this.o.season === 3 ? [235, 242, 252] : [175, 155, 120], 0.35); break;
      case 'step': if (this.o.season === 3) P.snowPuff(e.x, e.y, 1); break;
      case 'clash':
        P.clash(e.x, e.y, e.power, e.side === 'attacker' ? [255, 215, 150] : [255, 190, 150]);
        if (e.heavy) { P.dust(e.x, e.y + 14, 6, [170, 150, 115], 0.45); P.ring(e.x, e.y + 12, 0.8, [230, 210, 170], 3); P.debris(e.x, e.y + 10, 5, [120, 100, 80], 3); }
        if (!red) { this.shake = Math.min(e.heavy ? 12 : 8, this.shake + (e.heavy ? 5 : 1.5 * e.power)); if (e.heavy && !this.punch) this.punch = { x: e.x, y: e.y, t: 0, amt: 0.05 }; }
        break;
      case 'charge':
        P.clash(e.x, e.y, 1, [255, 220, 160]); P.dust(e.x, e.y + 8, 8, [175, 155, 120], 0.5); P.ring(e.x, e.y + 6, 1, [255, 230, 190], 3);
        if (!red) { this.shake = Math.min(10, this.shake + 6); this.punch = { x: e.x, y: e.y, t: 0, amt: 0.06 }; }
        this.sfx('hit');
        break;
      case 'spiritHit': {
        const col = hexRgb(SPIRIT_COL[e.spirit] || '#ffffff');
        P.explode(e.x, e.y, 1.3, col); this.flashCol = mix(col, [255, 255, 255], 0.6); this.whiteout = Math.min(0.5, this.whiteout + 0.35);
        if (e.spirit === 'tide') P.sparks(e.x, e.y, 30, [170, 225, 255], 6, 2);
        if (e.spirit === 'stone') P.debris(e.x, e.y, 16, [130, 110, 85], 5);
        if (e.spirit === 'dusk') P.smoke(e.x, e.y, 8, 0.9, 110);
        if (e.spirit === 'gale') this.bolt = { x: e.x, y: e.y, t: 0 };
        if (!red) { this.shake = Math.min(12, this.shake + 8); this.punch = { x: e.x, y: e.y, t: 0, amt: 0.08 }; }
        this.sfx('spell');
        break;
      }
      case 'muzzle':
        P.flash(e.x, e.y, e.big ? 1.2 : 0.45, [255, 220, 150]); P.smoke(e.x, e.y, e.big ? 6 : 2, e.big ? 0.7 : 0.35, 150, 0);
        P.sparks(e.x, e.y, e.big ? 10 : 3, [255, 200, 120], 3, 0);
        if (e.big && !red) this.shake = Math.min(9, this.shake + 4);
        break;
      case 'explode':
        P.explode(e.x, e.y, e.size || 1.2);
        if (!red) { this.shake = Math.min(14, this.shake + 9); this.punch = { x: e.x, y: e.y, t: 0, amt: 0.09 }; this.whiteout = Math.min(0.3, this.whiteout + 0.18); this.flashCol = [255, 235, 200]; }
        break;
      case 'land':
        if (e.kind === 'thorn') P.sparks(e.x, e.y, 5, [150, 255, 120], 2);
        else P.hit(e.x, e.y, e.kind === 'bullet' ? [255, 230, 170] : [230, 215, 180]);
        break;
      case 'fall': {
        const col = e.spirit ? hexRgb(SPIRIT_COL[e.spirit]) : [200, 60, 40];
        if (e.spirit) P.explode(e.x, e.y - 40, 1, col);
        else { P.sparks(e.x, e.y - 18, 5, [255, 120, 90], 2); P.dust(e.x, e.y, 2); }
        if (this.o.terrain === 'forest' && Math.random() < 0.4) P.leaves(e.x, e.y - 30, 3);
        break;
      }
      case 'rout': this.pops.push({ text: 'ROUTED', side: e.side, t: 0, life: 70, big: true }); this.sfx('rout'); break;
      case 'wipe': this.pops.push({ text: 'DESTROYED', side: e.side, t: 0, life: 70, big: true }); break;
    }
  }

  // ---------------------------------------------------------------- backdrop (cached, blurred)
  backdrop(w, h) {
    const key = `${w | 0}x${h | 0}`;
    if (this.bg && this.bgKey === key) return this.bg;
    const c = canvasOf(w * 1.08, h), g = c.getContext('2d');
    const W = c.width, H = c.height;
    const wx = this.o.weather, se = this.o.season ?? 1;
    const [top, hor] = SKY[wx] || SKY[se] || SKY[1];
    const im = this.o.art;
    if (im) {
      const s = Math.max(W / im.width, H / im.height);
      g.drawImage(im, (W - im.width * s) / 2, (H - im.height * s) * 0.4, im.width * s, im.height * s);
    } else {
      const sky = g.createLinearGradient(0, 0, 0, H * 0.75);
      sky.addColorStop(0, top); sky.addColorStop(1, hor);
      g.fillStyle = sky; g.fillRect(0, 0, W, H);
      // sun glow
      const sun = g.createRadialGradient(W * 0.72, H * 0.28, 0, W * 0.72, H * 0.28, H * 0.6);
      sun.addColorStop(0, 'rgba(255,240,200,0.55)'); sun.addColorStop(1, 'rgba(255,240,200,0)');
      g.fillStyle = sun; g.fillRect(0, 0, W, H);
      // clouds
      g.fillStyle = 'rgba(255,255,255,0.18)';
      for (let i = 0; i < 9; i++) { const x = (i * 173) % W, y = H * (0.1 + 0.08 * (i % 3)); g.beginPath(); g.ellipse(x, y, W * 0.12, H * 0.04, 0, 0, 7); g.fill(); }
      // far mountains / hills, two layers
      const ground = GROUND[this.o.terrain] || GROUND.plains;
      const layer = (yb, amp, col, seed) => {
        g.fillStyle = col; g.beginPath(); g.moveTo(0, H);
        for (let x = 0; x <= W; x += W / 40) g.lineTo(x, yb - amp * (0.5 + 0.5 * Math.sin(x * 0.011 + seed) * Math.sin(x * 0.004 + seed * 2)));
        g.lineTo(W, H); g.fill();
      };
      const mt = this.o.terrain === 'mountain' || this.o.terrain === 'hills';
      layer(H * 0.6, H * (mt ? 0.32 : 0.14), mix(hexRgb(hor), [70, 80, 110], 0.45).map(v => v | 0).reduce((s, v, i) => s + (i ? ',' : '') + v, 'rgb(') + ')', 1);
      layer(H * 0.7, H * (mt ? 0.18 : 0.09), ground[1], 4);
      if (this.o.terrain === 'forest') { g.fillStyle = '#1f3a1a'; for (let x = 0; x < W; x += 9) { const hh = H * (0.08 + 0.05 * Math.abs(Math.sin(x * 0.7))); g.beginPath(); g.moveTo(x, H * 0.72); g.lineTo(x + 6, H * 0.72 - hh); g.lineTo(x + 12, H * 0.72); g.fill(); } }
      if (this.o.terrain === 'coast') { g.fillStyle = 'rgba(60,110,150,0.8)'; g.fillRect(0, H * 0.64, W, H * 0.05); }
    }
    // depth of field: blur the whole backdrop
    const b = canvasOf(W, H), bg = b.getContext('2d');
    bg.filter = im ? 'blur(3px) saturate(0.9) brightness(0.8)' : 'blur(2px)';
    bg.drawImage(c, 0, 0);
    bg.filter = 'none';
    // fade the lower part into the ground colour so figures stand out
    const ground = GROUND[this.o.terrain] || GROUND.plains;
    const fade = bg.createLinearGradient(0, H * 0.55, 0, H);
    fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, ground[1]);
    bg.fillStyle = fade; bg.fillRect(0, 0, W, H);
    this.bg = b; this.bgKey = key;
    return b;
  }

  // Static layers per size: light shafts, ground strip with tufts, grade + vignette.
  layers(W2, bandH, S, ox, oyRel) {
    const key = `${W2 | 0}x${bandH | 0}`;
    if (this.L && this.Lkey === key) return this.L;
    const mk = () => { const c = canvasOf(W2, bandH); return [c, c.getContext('2d')]; };
    const [shafts, sg] = mk(), [ground, gg] = mk(), [grade, rg] = mk();
    const shaftCol = this.o.weather === 'rain' ? '160,180,220' : this.o.season === 2 ? '255,190,120' : '255,235,190';
    for (let i = 0; i < 4; i++) {
      const x = W2 * (0.15 + i * 0.25);
      const gr = sg.createLinearGradient(x, 0, x - bandH * 0.4, bandH);
      gr.addColorStop(0, `rgba(${shaftCol},${this.o.weather === 'fog' ? 0.04 : 0.08})`); gr.addColorStop(1, `rgba(${shaftCol},0)`);
      sg.fillStyle = gr; sg.beginPath(); sg.moveTo(x, 0); sg.lineTo(x + W2 * 0.06, 0); sg.lineTo(x - bandH * 0.35, bandH); sg.lineTo(x - bandH * 0.5, bandH); sg.fill();
    }
    const gr0 = GROUND[this.o.terrain] || GROUND.plains, snow = this.o.season === 3;
    const gy = oyRel + 138 * S;
    const ggr = gg.createLinearGradient(0, gy, 0, oyRel + SH * S + 10);
    ggr.addColorStop(0, 'rgba(0,0,0,0)'); ggr.addColorStop(0.25, snow ? '#dfe6ee' : gr0[0]); ggr.addColorStop(1, snow ? '#a8b4c2' : gr0[1]);
    gg.fillStyle = ggr; gg.fillRect(0, gy, W2, bandH - gy);
    gg.fillStyle = snow ? 'rgba(255,255,255,0.5)' : 'rgba(20,40,10,0.45)';
    for (let i = 0; i < 90; i++) {
      const x = ((i * 97.3) % SW) * S + ox - SW * S * 0.1 + ((i * 37) % 3) * S * 40, y = oyRel + (150 + (i * 13) % 45) * S;
      gg.fillRect(x, y, Math.max(1, S * 1.2), Math.max(1, S * (2 + (i % 3))));
    }
    if (this.o.terrain === 'marsh') { gg.fillStyle = 'rgba(60,90,90,0.35)'; for (let i = 0; i < 8; i++) { gg.beginPath(); gg.ellipse(((i * 131) % W2), oyRel + (160 + (i * 17) % 30) * S, 40 * S * 0.4, 6 * S * 0.4, 0, 0, 7); gg.fill(); } }
    rg.globalCompositeOperation = 'source-over';
    const tint = GRADE[this.o.weather] || GRADE[this.o.season];
    if (tint) { rg.fillStyle = tint; rg.fillRect(0, 0, W2, bandH); }
    const vg = rg.createRadialGradient(W2 / 2, bandH / 2, bandH * 0.3, W2 / 2, bandH / 2, Math.max(W2, bandH) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.5)');
    rg.fillStyle = vg; rg.fillRect(0, 0, W2, bandH);
    this.L = { shafts, ground, grade }; this.Lkey = key;
    return this.L;
  }

  // ---------------------------------------------------------------- frame
  render(cg, W2, H2, alpha, open) {
    const sc = this.sc, f = sc.f + alpha, t = f / 60;
    const bandH = Math.min(H2 * 0.78, W2 * (W2 < 600 ? 0.95 : 0.66)), bandY = (H2 - bandH) / 2;
    const h = bandH * open, y0 = H2 / 2 - h / 2;
    cg.save();
    cg.fillStyle = `rgba(4,3,8,${0.6 * open})`; cg.fillRect(0, 0, W2, H2);
    cg.beginPath(); cg.rect(0, y0, W2, h); cg.clip();
    const bar = bandH * 0.13;
    const S = Math.min((bandH - bar * 2) / SH * 1.18, W2 / (SW * 0.86));
    const ox = W2 / 2 - SW / 2 * S, oy = bandY + bar + (bandH - bar * 2) - SH * S * 0.98;
    // camera
    let zoom = 1, fx = W2 / 2, fy = H2 / 2;
    if (this.punch && !this.reduced) {
      const u = (this.punch.t + alpha) / 40, e = u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85;
      zoom = 1 + (this.punch.amt || 0.07) * Math.pow(Math.max(0, e), 1.5);
      fx = ox + this.punch.x * S; fy = oy + this.punch.y * S;
    }
    const sx = this.shake ? (Math.random() - 0.5) * this.shake : 0, sy = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    cg.translate(sx + fx, sy + fy); cg.scale(zoom, zoom); cg.translate(-fx, -fy);
    // backdrop with a slow pan
    const bg = this.backdrop(W2, bandH);
    cg.drawImage(bg, -((f * 0.25) % (bg.width - W2 + 1)) * 0.3 - bg.width * 0.02, bandY, bg.width, bandH);
    // light shafts (baked, drifting) and the in-focus ground strip (baked)
    const L = this.layers(W2, bandH, S, ox, oy - bandY);
    cg.save(); cg.globalCompositeOperation = 'lighter';
    cg.drawImage(L.shafts, Math.sin(t * 0.3) * W2 * 0.02, bandY);
    cg.restore();
    cg.drawImage(L.ground, 0, bandY);
    // shadows
    const actors = sc.actors.slice().sort((p, q) => p.y - q.y);
    for (const a of actors) {
      const x = ox + (a.px + (a.x - a.px) * alpha) * S, y = oy + a.y * S;
      const al = a.dead ? clamp(1 - (f - a.deadF) / 50, 0, 1) : 1;
      if (al <= 0 || (a.flee && (x < -60 || x > W2 + 60))) continue;
      const r = (a.type === 'spirit' ? 34 : HUGE.has(a.type) ? 26 : MOUNTED.has(a.type) || a.type === 'siege' || (a.type === 'bombards' || a.type === 'bombard') ? 22 : 12) * S;
      const fly = FLYING.has(a.type) || (a.type === 'spirit' && (a.spirit === 'gale' || a.spirit === 'dusk'));
      cg.globalAlpha = 0.35 * al * (fly ? 0.5 : 1);
      cg.drawImage(blob(0, 0, 0), x - r, y - r * 0.32, r * 2, r * 0.64);
    }
    cg.globalAlpha = 1;
    // figures (back to front), motion blur on fast moves
    for (const a of actors) {
      const ax = a.px + (a.x - a.px) * alpha;
      const x = ox + ax * S, y = oy + a.y * S;
      if (a.flee && (x < -80 || x > W2 + 80)) continue;
      const pose = sc.pose(a, alpha);
      const v = a.x - a.px;
      if (a.type === 'spirit') {
        const al = a.dead ? clamp(1 - (f - a.deadF) / 40, 0, 1) : 1;
        if (al <= 0) continue;
        const lift = (a.spirit === 'gale' || a.spirit === 'dusk' ? 0.75 : a.spirit === 'tide' ? 0.3 : 0.42) * a.s;
        drawSpirit(cg, a.spirit, x, y - lift * S, a.s * S, t, { facing: a.facing, run: a.moving ? 1 : 0, alpha: al });
        continue;
      }
      const s = a.s * S;
      if (Math.abs(v) > 3 && !this.reduced) {
        for (let i = 2; i >= 1; i--) blitFigure(cg, a.type, this.pal[a.side], x - v * S * i * 1.3, y, s, a.facing, pose, this.rimCss[a.side], 0.18 / i);
      }
      blitFigure(cg, a.type, this.pal[a.side], x, y, s, a.facing, pose, this.rimCss[a.side]);
    }
    // shots: arrows with faint trails, bullets as streaks, stones and balls with shadows
    for (const sh of sc.shots) {
      const p = sc.shotAt(sh, f);
      if (!p.live) continue;
      const q = sc.shotAt(sh, f - 1.5);
      const X = ox + p.x * S, Y = oy + p.y * S, QX = ox + q.x * S, QY = oy + q.y * S;
      const ang = Math.atan2(Y - QY, X - QX);
      if (sh.kind === 'stone' || sh.kind === 'ball') {
        cg.globalAlpha = 0.3; const r = 10 * S; cg.drawImage(blob(0, 0, 0), ox + (sh.x0 + (sh.x1 - sh.x0) * p.k) * S - r, oy + sh.y1 * S - r * 0.3 + 6 * S, r * 2, r * 0.6); cg.globalAlpha = 1;
        cg.fillStyle = sh.kind === 'stone' ? '#5c544c' : '#1e2024'; cg.beginPath(); cg.arc(X, Y, (sh.kind === 'stone' ? 4.2 : 3) * S, 0, 7); cg.fill();
        if (sh.kind === 'stone') { cg.save(); cg.globalCompositeOperation = 'lighter'; const r2 = 9 * S; cg.drawImage(blob(255, 140, 40), X - r2, Y - r2, r2 * 2, r2 * 2); cg.restore(); }
      } else if (sh.kind === 'bullet') {
        cg.save(); cg.globalCompositeOperation = 'lighter'; cg.strokeStyle = 'rgba(255,230,170,0.9)'; cg.lineWidth = Math.max(1, S * 1.2);
        cg.beginPath(); cg.moveTo(X, Y); cg.lineTo(X - Math.cos(ang) * 14 * S, Y - Math.sin(ang) * 14 * S); cg.stroke(); cg.restore();
      } else {
        cg.save();
        cg.strokeStyle = 'rgba(255,255,240,0.18)'; cg.lineWidth = Math.max(1, S * 1.4);
        cg.beginPath(); cg.moveTo(QX - Math.cos(ang) * 10 * S, QY - Math.sin(ang) * 10 * S); cg.lineTo(X, Y); cg.stroke();
        cg.translate(X, Y); cg.rotate(ang);
        const L = (sh.kind === 'bolt' ? 7 : 10) * S;
        cg.strokeStyle = sh.kind === 'thorn' ? '#7ad060' : '#e8dcc0'; cg.lineWidth = Math.max(1, S * 0.8);
        cg.beginPath(); cg.moveTo(-L, 0); cg.lineTo(0, 0); cg.stroke();
        cg.fillStyle = sh.kind === 'thorn' ? '#b0ff90' : '#c8ccd2'; cg.beginPath(); cg.moveTo(2.2 * S, 0); cg.lineTo(-0.6 * S, -1.3 * S); cg.lineTo(-0.6 * S, 1.3 * S); cg.fill();
        if (sh.kind === 'arrow') { cg.fillStyle = '#d04040'; cg.fillRect(-L, -1 * S, 2 * S, 2 * S); }
        cg.restore();
      }
    }
    // a gale bolt from the sky
    if (this.bolt) {
      this.bolt.t += 1; const b = this.bolt;
      if (b.t < 14) {
        cg.save(); cg.globalCompositeOperation = 'lighter'; cg.strokeStyle = 'rgba(230,240,255,0.95)'; cg.lineWidth = 3 * S; cg.shadowColor = '#bcd4ff'; cg.shadowBlur = 20;
        cg.beginPath(); let x = ox + b.x * S, y = bandY; cg.moveTo(x, y);
        while (y < oy + b.y * S) { y += 14 * S; x += (Math.sin(y * 7.1 + b.t) * 10) * S; cg.lineTo(x, y); }
        cg.stroke(); cg.restore();
      } else this.bolt = null;
    }
    // particles
    this.P.draw(cg, S, ox, oy);
    // colour grading and vignette (baked)
    cg.drawImage(L.grade, 0, bandY);
    if (this.whiteout > 0.01) { cg.fillStyle = `rgba(${this.flashCol.map(v => v | 0)},${this.whiteout})`; cg.fillRect(0, bandY, W2, bandH); }
    cg.restore();
    // letterbox bars, HUD (outside the camera)
    this.hud(cg, W2, H2, y0, h, bar * open, alpha);
  }

  hud(cg, W2, H2, y0, h, bar, alpha) {
    if (bar < 4) return;
    const o = this.o, sc = this.sc;
    cg.save();
    cg.fillStyle = '#07060a'; cg.fillRect(0, y0, W2, bar); cg.fillRect(0, y0 + h - bar, W2, bar);
    cg.fillStyle = '#d8b05a'; cg.fillRect(0, y0 + bar, W2, 1.5); cg.fillRect(0, y0 + h - bar - 1.5, W2, 1.5);
    const c = sc.counts(alpha);
    const fs = Math.max(10, Math.min(bar * 0.36, W2 / 48));
    const pw = bar * (W2 < 600 ? 1.25 : 1.7), ph = pw * 1.15;
    const side = (s, left) => {
      const info = o.names[s];
      const px = left ? 12 : W2 - 12 - pw;
      const py = y0 + h - bar - ph * 0.62;
      o.drawPortrait(cg, s, px, py, pw, ph, !left);
      const narrow = W2 < 600;
      if (!narrow) o.drawCrest(cg, s, left ? px + pw + bar * 0.45 : px - bar * 0.45, y0 + bar * 0.5, bar * 0.7);
      const tx = narrow ? (left ? 10 : W2 - 10) : left ? px + pw + bar * 0.95 : px - bar * 0.95, al = left ? 'left' : 'right';
      txt(cg, narrow ? info.house.replace(/^(House|Clan|Order of|Vey) /, '') : info.house, tx, y0 + bar * 0.42, fs * 0.82, info.col, al, 700);
      if (!narrow) txt(cg, info.title, tx, y0 + bar * 0.82, fs * 0.72, '#e8dcc0', al, 500, 'EB Garamond');
      const n = s === 'attacker' ? c.att : c.def;
      const nx = left ? px + pw + 10 : px - 10;
      txt(cg, String(n), nx, y0 + h - bar * 0.3, fs * 1.55, '#ffffff', al, 900);
      const nw = cg.measureText(String(n)).width;
      txt(cg, 'soldiers', left ? nx + nw + 6 : nx - nw - 6, y0 + h - bar * 0.3, fs * 0.62, '#cbb98e', al, 500, 'EB Garamond');
    };
    side('attacker', true); side('defender', false);
    // centre: what is happening (on narrow screens it goes under the top bar instead)
    if (W2 >= 760) txt(cg, o.caption || '', W2 / 2, y0 + bar * 0.62, fs * 0.9, '#f5ead0', 'center', 700);
    else txt(cg, o.caption || '', W2 / 2, y0 + bar + fs * 1.3, fs * 0.85, '#f5ead0', 'center', 700);
    cg.restore();
    // kill numbers and labels over the scene
    const mid = W2 / 2;
    if (c.dKilledShown && c.hit.killed) {
      const k = clamp((sc.f - (sc.tl.firstHit ?? sc.tl.contact) - 8) / 40, 0, 1);
      txt(cg, '-' + c.hit.killed, mid + W2 * 0.16, y0 + h * 0.42 - easeOut(k) * h * 0.08, Math.max(18, h * 0.1) * (1.2 - 0.2 * k), '#ff6a50', 'center', 900);
    }
    if (c.aKilledShown && c.counter?.killed) {
      const k = clamp((sc.f - sc.tl.counterStart - 8) / 40, 0, 1);
      txt(cg, '-' + c.counter.killed, mid - W2 * 0.16, y0 + h * 0.42 - easeOut(k) * h * 0.08, Math.max(16, h * 0.085) * (1.15 - 0.2 * k), '#ff9a70', 'center', 900);
      txt(cg, 'COUNTER', mid - W2 * 0.16, y0 + h * 0.5, Math.max(10, h * 0.04), '#ffd27a', 'center', 900);
    }
    for (const p of this.pops) {
      const k = p.t / p.life, a = k < 0.15 ? k / 0.15 : k > 0.8 ? (1 - k) / 0.2 : 1;
      cg.globalAlpha = a;
      txt(cg, p.text, p.side === 'defender' ? mid + W2 * 0.18 : mid - W2 * 0.18, y0 + h * 0.58, Math.max(14, h * 0.065) * (1 + 0.15 * (1 - Math.min(1, k * 5))), '#ffd27a', 'center', 900);
      cg.globalAlpha = 1;
    }
  }
}

export function txt(cg, str, x, y, size, color, align = 'left', weight = 700, font = 'Cinzel') {
  cg.font = `${weight} ${Math.round(size)}px ${font}, Georgia, serif`; cg.textAlign = align; cg.textBaseline = 'alphabetic';
  cg.lineWidth = Math.max(2, size / 7); cg.strokeStyle = 'rgba(0,0,0,0.8)'; cg.strokeText(str, x, y);
  cg.fillStyle = color; cg.fillText(str, x, y);
}
