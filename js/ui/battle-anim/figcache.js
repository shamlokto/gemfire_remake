// Remastered figures: each procedural figure is drawn once at a higher internal resolution with
// simple lighting (warm key from the top, cool shade below) and a rim light in its house colour
// along the edges facing away from the key, then cached by (type, colours, pose frame, size,
// facing) and blitted. Poses are quantised so the cache stays small.
import { drawSoldier } from './figures.js';
import { canvasOf } from './fx.js';

const UP = 2;                         // internal resolution multiplier
const MAX = 900;
const cache = new Map();

const q = (v, n) => Math.round(v * n) / n;
const TAU = Math.PI * 2;

function poseKey(pose) {
  const walk = pose.walk == null ? 'n' : q(((pose.walk % TAU) + TAU) % TAU / TAU, 12);
  const k = q(pose.k ?? 0, 24);
  const t = q(((pose.t || 0) % 3) / 3, 6);
  return `${pose.act || 'idle'}:${k}:${walk}:${t}:${pose.run ? 1 : 0}:${pose.v || 0}`;
}

// Returns { c: canvas, ax, ay, sc } — draw with g.drawImage(c, x - ax / sc, y - ay / sc, c.width / sc, c.height / sc)
export function figure(type, P, s, facing, pose, rim = null) {
  const sz = Math.max(8, Math.round(s));
  const key = `${type}|${P.raw}|${P.acc}|${sz}|${facing}|${poseKey(pose)}|${rim || ''}`;
  let e = cache.get(key);
  if (e) { cache.delete(key); cache.set(key, e); return e; }
  const S = sz * UP;
  const w = Math.ceil(S * 2.6), h = Math.ceil(S * 2.1);
  const ax = w / 2, ay = h * 0.8;
  const a = canvasOf(w, h), g = a.getContext('2d');
  const qp = { ...pose, walk: pose.walk == null ? null : q(((pose.walk % TAU) + TAU) % TAU / TAU, 12) * TAU, k: q(pose.k ?? 0, 24), t: q(((pose.t || 0) % 3), 2) };
  drawSoldier(g, type, ax, ay, S, P, facing, qp);
  // lighting: warm key from the top, cool shade towards the feet
  g.globalCompositeOperation = 'source-atop';
  const lg = g.createLinearGradient(0, ay - S * 1.2, 0, ay);
  lg.addColorStop(0, 'rgba(255,240,215,0.22)'); lg.addColorStop(0.55, 'rgba(255,240,215,0)'); lg.addColorStop(1, 'rgba(20,24,48,0.32)');
  g.fillStyle = lg; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
  // rim light: the silhouette minus itself shifted toward the key, tinted in the house colour
  const r = canvasOf(w, h), rg = r.getContext('2d');
  rg.drawImage(a, 0, 0);
  rg.globalCompositeOperation = 'source-in';
  rg.fillStyle = rim || P.colL || '#ffffff'; rg.fillRect(0, 0, w, h);
  rg.globalCompositeOperation = 'destination-out';
  const d = Math.max(1.5, S * 0.035);
  rg.drawImage(a, -facing * d, d * 0.8);
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = 0.75;
  g.drawImage(r, 0, 0);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  e = { c: a, ax, ay, sc: UP };
  cache.set(key, e);
  if (cache.size > MAX) cache.delete(cache.keys().next().value);
  return e;
}

export function blitFigure(g, type, P, x, y, s, facing, pose, rim, alpha = 1) {
  const e = figure(type, P, s, facing, pose, rim);
  const W = e.c.width / e.sc, H = e.c.height / e.sc;
  if (alpha < 1) { const a0 = g.globalAlpha; g.globalAlpha = a0 * alpha; g.drawImage(e.c, x - e.ax / e.sc, y - e.ay / e.sc, W, H); g.globalAlpha = a0; }
  else g.drawImage(e.c, x - e.ax / e.sc, y - e.ay / e.sc, W, H);
}
