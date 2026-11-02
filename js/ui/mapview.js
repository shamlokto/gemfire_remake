// Canvas world map: background per season, roads, province markers, armies, shards, marches,
// fog of war. Pan with drag, zoom with wheel or pinch. Map space is 1000 x 750 (world.js).
import { PROVINCES, MAP_W, MAP_H, seasonOf } from '../data/world.js';
import { HOUSE_BY_ID } from '../data/houses.js';
import { SPIRITS } from '../data/spirits.js';
import { art, hasArt, SEASON_MAP, CREST } from '../data/art.js';
import { landShapes, LAND_EDGES, SEA_LANES, LAND_PALETTE, RADIUS } from './landshape.js';
import { canSee } from '../realm/state.js';
import { landQuality } from '../realm/landhooks.js';

const imgCache = new Map();
function img(slot) {
  if (!hasArt(slot)) return null;          // placeholders are not drawn: the map paints itself
  const src = art(slot);
  let im = imgCache.get(src);
  if (!im) { im = new Image(); im.decoding = 'async'; im.src = src; imgCache.set(src, im); }
  return im.complete && im.naturalWidth ? im : null;
}

const TERRAIN_ICON = { plains: '', forest: '🌲', hills: '⛰', mountain: '🏔', marsh: '🌾', coast: '⚓' };

export class MapView {
  constructor(wrap, { onSelect, onHover } = {}) {
    this.wrap = wrap;
    this.canvas = document.createElement('canvas');
    wrap.append(this.canvas);
    this.tip = document.createElement('div');
    this.tip.className = 'map-tip';
    this.tip.hidden = true;
    wrap.append(this.tip);
    this.ctx = this.canvas.getContext('2d');
    this.onSelect = onSelect; this.onHover = onHover;
    this.state = null; this.selected = null; this.hover = null; this.highlights = null;
    this.view = { s: 1, x: 0, y: 0 };
    this.fitted = false;
    this.pointers = new Map();
    this.active = true;
    this.bind();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(wrap);
    this.resize();
    const loop = t => { this.t = t; if (this.active) this.draw(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  setState(state) { this.state = state; }
  select(pid) { this.selected = pid; }
  setHighlights(ids) { this.highlights = ids ? new Set(ids) : null; }

  resize() {
    const r = this.wrap.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * dpr); this.canvas.height = Math.round(this.h * dpr);
    this.dpr = dpr;
    if (!this.fitted && r.width > 10) { this.fit(); this.fitted = true; }
    this.clampView();
  }

  fit() {
    // Phones: the bottom sheet covers part of the map, so fit into the visible top area.
    const phone = this.w < 820;
    const visH = phone ? this.h * 0.56 : this.h;
    const s = phone ? Math.max(this.w / MAP_W, visH / MAP_H) : Math.min(this.w / MAP_W, visH / MAP_H) * 0.98;
    this.view = { s, x: (this.w - MAP_W * s) / 2, y: (visH - MAP_H * s) / 2 };
  }

  minScale() { return Math.min(this.w / MAP_W, this.h / MAP_H) * 0.6; }
  clampView() {
    const v = this.view;
    v.s = Math.max(this.minScale(), Math.min(4, v.s));
    const mw = MAP_W * v.s, mh = MAP_H * v.s, m = 80;
    v.x = Math.min(this.w - m, Math.max(m - mw, v.x));
    v.y = Math.min(this.h - m, Math.max(m - mh, v.y));
  }

  zoomAt(px, py, k) {
    const v = this.view;
    const mx = (px - v.x) / v.s, my = (py - v.y) / v.s;
    v.s *= k;
    this.clampView();
    v.x = px - mx * v.s; v.y = py - my * v.s;
    this.clampView();
  }
  zoom(k) { this.zoomAt(this.w / 2, this.h / 2, k); }

  centerOn(pid) {
    const p = PROVINCES[pid], v = this.view;
    const visH = this.w < 820 ? this.h * 0.5 : this.h;
    v.x = this.w / 2 - p.x * v.s; v.y = visH / 2 - p.y * v.s;
    this.clampView();
  }

  toMap(px, py) { return [(px - this.view.x) / this.view.s, (py - this.view.y) / this.view.s]; }

  hit(px, py) {
    const [mx, my] = this.toMap(px, py);
    let best = null, bd = 60 * 60;
    for (const p of PROVINCES) {
      const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
      if (d < bd) { bd = d; best = p.id; }
    }
    return best;
  }

  bind() {
    const c = this.canvas;
    let downAt = null, moved = false, pinch = null;
    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (this.pointers.size === 1) { downAt = { x: e.offsetX, y: e.offsetY, vx: this.view.x, vy: this.view.y }; moved = false; }
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: this.view.s };
        moved = true;
      }
    });
    c.addEventListener('pointermove', e => {
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (this.pointers.size === 2 && pinch) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        this.zoomAt(cx, cy, (pinch.s * d / pinch.d) / this.view.s);
        return;
      }
      if (this.pointers.size === 1 && downAt) {
        const dx = e.offsetX - downAt.x, dy = e.offsetY - downAt.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) { moved = true; this.wrap.classList.add('dragging'); }
        if (moved) { this.view.x = downAt.vx + dx; this.view.y = downAt.vy + dy; this.clampView(); }
        return;
      }
      if (e.pointerType === 'mouse') {
        const pid = this.hit(e.offsetX, e.offsetY);
        this.setHover(pid, e.offsetX, e.offsetY);
      }
    });
    const up = e => {
      const wasSingle = this.pointers.size === 1;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) pinch = null;
      this.wrap.classList.remove('dragging');
      if (wasSingle && downAt && !moved && e.type === 'pointerup') {
        const pid = this.hit(e.offsetX, e.offsetY);
        if (pid != null && this.onSelect) this.onSelect(pid);
      }
      if (!this.pointers.size) downAt = null;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => this.setHover(null));
    c.addEventListener('wheel', e => {
      e.preventDefault();
      this.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
  }

  setHover(pid, x, y) {
    this.hover = pid;
    if (pid == null || !this.state) { this.tip.hidden = true; return; }
    const st = this.state, pr = st.provinces[pid], P = PROVINCES[pid];
    const seen = canSee(st, st.player, pid);
    const owner = pr.owner ? HOUSE_BY_ID[pr.owner].name : 'Free hold';
    const units = pr.units || [], nv = pr.vassals.length;
    const sol = units.reduce((a, u) => a + (u.soldiers || 0), 0);
    const garrison = units.length
      ? ` · ${units.length} unit${units.length > 1 ? 's' : ''} (${sol})${nv ? `, ${nv} vassal${nv > 1 ? 's' : ''}` : ''}`
      : nv ? ` · ${nv} vassal${nv > 1 ? 's' : ''}` : pr.owner ? ' · ungarrisoned' : ` · militia ${Array.isArray(pr.militia) ? pr.militia.reduce((a, n) => a + n, 0) : (pr.militia ?? '')}`;
    const exits = (PROVINCES[pid] && NEIGH[pid].length === 1) ? ' · dead end' : '';
    this.tip.innerHTML = `<b>${P.name}</b> · ${owner}<br><span style="color:var(--muted)">${P.terrain}${exits}` +
      (seen ? garrison : ' · unseen') +
      (pr.shard && seen ? ` · ${SPIRITS[pr.shard].name} shard` : '') +
      (seen && landQuality(st, pid) ? `<br><span class="land-quality q-${landQuality(st, pid)}" style="margin:3px 0 0">${landQuality(st, pid)} land</span>` : '') + '</span>';
    this.tip.hidden = false;
    const tw = this.tip.offsetWidth;
    this.tip.style.left = Math.min(x, this.w - tw - 24) + 'px';
    this.tip.style.top = y + 'px';
    if (this.onHover) this.onHover(pid);
  }

  // ------------------------------------------------------------------ drawing
  draw() {
    const { ctx, dpr, view: v } = this;
    const st = this.state;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0a0810';
    ctx.fillRect(0, 0, this.w, this.h);
    if (!st) return;
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.scale(v.s, v.s);

    // Background: painted map art if installed, else procedural islands
    const season = seasonOf(st.month);
    const bg = img(SEASON_MAP[season]) || img(10);
    if (bg) {
      ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 30;
      ctx.drawImage(bg, 0, 0, MAP_W, MAP_H);
      ctx.shadowBlur = 0;
    } else {
      ctx.drawImage(landCanvas(season), 0, 0, MAP_W, MAP_H);
    }
    // Frame
    ctx.strokeStyle = 'rgba(216,176,90,0.6)'; ctx.lineWidth = 3 / v.s + 1;
    ctx.strokeRect(0, 0, MAP_W, MAP_H);

    const player = st.player;
    const seen = PROVINCES.map(p => canSee(st, player, p.id));

    // Territory wash: soft owner-coloured glow under each province (clipped to its disc size)
    for (const p of PROVINCES) {
      const pr = st.provinces[p.id];
      if (!pr.owner || !seen[p.id]) continue;
      const col = HOUSE_BY_ID[pr.owner].color, R = RADIUS[p.id] + 6;
      const g = ctx.createRadialGradient(p.x, p.y, 8, p.x, p.y, R);
      g.addColorStop(0, hexA(col, 0.42)); g.addColorStop(1, hexA(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.fill();
    }

    // Sea lanes and the causeway: the only ways onto the islands
    for (const [a, b] of SEA_LANES) {
      const A = PROVINCES[a], B = PROVINCES[b];
      if (A.name === 'Westreach' || B.name === 'Westreach') causeway(ctx, A, B);
      else seaLane(ctx, A, B, (this.t || 0) / 60);
    }

    // Roads (land borders)
    ctx.lineCap = 'round';
    for (const [a, b] of LAND_EDGES) {
      const p = PROVINCES[a], q = PROVINCES[b];
      ctx.strokeStyle = 'rgba(40,24,10,0.55)'; ctx.lineWidth = 5;
      ctx.setLineDash([]);
      line(ctx, p, q);
      ctx.strokeStyle = 'rgba(240,220,170,0.8)'; ctx.lineWidth = 2;
      ctx.setLineDash([7, 6]);
      line(ctx, p, q);
    }
    ctx.setLineDash([]);

    // Fog
    const fog = img(12);
    for (const p of PROVINCES) {
      if (seen[p.id]) continue;
      ctx.save();
      ctx.beginPath(); ctx.arc(p.x, p.y, RADIUS[p.id] + 6, 0, Math.PI * 2); ctx.clip();
      if (fog) { ctx.globalAlpha = 0.85; ctx.drawImage(fog, p.x - 110 + (p.id * 37) % 60, p.y - 110, 220, 220); }
      else { ctx.fillStyle = 'rgba(40,44,56,0.8)'; ctx.fill(); }
      ctx.restore();
    }

    // Marches (player's queued attacks)
    const pulse = (Math.sin((this.t || 0) / 300) + 1) / 2;
    for (const m of st.marches || []) {
      if (m.house !== player) continue;
      arrow(ctx, PROVINCES[m.from], PROVINCES[m.to], HOUSE_BY_ID[m.house].color, (this.t || 0) / 40);
    }

    // Markers
    const castle = img(13), army = img(14);
    for (const p of PROVINCES) {
      const pr = st.provinces[p.id];
      const col = pr.owner ? HOUSE_BY_ID[pr.owner].color : '#8a8070';
      const isSel = this.selected === p.id, isHov = this.hover === p.id;
      const hl = this.highlights && this.highlights.has(p.id);
      const r = 20;
      if (hl) {
        ctx.strokeStyle = `rgba(255,220,120,${0.5 + pulse * 0.5})`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 12 + pulse * 3, 0, Math.PI * 2); ctx.stroke();
      }
      if (isSel) {
        ctx.strokeStyle = '#f3d58a'; ctx.lineWidth = 3;
        ctx.shadowColor = '#f3d58a'; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 7 + pulse * 2, 0, Math.PI * 2); ctx.stroke();
        ctx.shadowBlur = 0;
      }
      // base disc
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath(); ctx.ellipse(p.x, p.y + r * 0.75, r * 1.1, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = seen[p.id] ? col : '#4a4650';
      ctx.strokeStyle = isHov ? '#fff' : '#e8d29a'; ctx.lineWidth = isHov ? 2.5 : 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      const crest = pr.owner && seen[p.id] ? img(CREST[pr.owner]) : null;
      if (crest) ctx.drawImage(crest, p.x - r * 0.8, p.y - r * 0.8, r * 1.6, r * 1.6);
      else if (castle) ctx.drawImage(castle, p.x - r, p.y - r * 1.15, r * 2, r * 2);
      // capital crown
      if (pr.owner && st.houses[pr.owner].capital === p.id) {
        ctx.fillStyle = '#f3d58a'; ctx.font = 'bold 14px Georgia'; ctx.textAlign = 'center';
        ctx.fillText('♛', p.x, p.y - r - 3);
      }
      // army: number of troop units garrisoned
      const nv = (pr.units || []).length;
      if (nv && seen[p.id]) {
        const ax = p.x + r * 1.05, ay = p.y - r * 0.6;
        if (army) ctx.drawImage(army, ax - 13, ay - 15, 26, 26);
        ctx.fillStyle = '#1a1410'; ctx.beginPath(); ctx.arc(ax + 9, ay + 8, 7.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 10px Georgia'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(nv), ax + 9, ay + 8.5);
        ctx.textBaseline = 'alphabetic';
      }
      // shard
      if (pr.shard && seen[p.id]) {
        const sc = SPIRITS[pr.shard].color, sx = p.x - r * 1.1, sy = p.y - r * 0.55;
        ctx.save();
        ctx.shadowColor = sc; ctx.shadowBlur = 10 + pulse * 8;
        ctx.fillStyle = sc;
        diamond(ctx, sx, sy, 6, 9);
        ctx.restore();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; diamondStroke(ctx, sx, sy, 6, 9);
      }
      // name
      ctx.font = `600 ${Math.max(11, 13)}px "Cinzel", Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(20,12,4,0.85)';
      ctx.strokeText(p.name, p.x, p.y + r + 16);
      ctx.fillStyle = seen[p.id] ? '#f6ead0' : '#a9a3b0';
      ctx.fillText(p.name, p.x, p.y + r + 16);
    }
    ctx.restore();
  }

  destroy() { this.ro.disconnect(); this.active = false; }
}

const NEIGH = PROVINCES.map(p => LAND_EDGES.concat(SEA_LANES).filter(e => e.includes(p.id)).map(e => e[0] === p.id ? e[1] : e[0]));

// ---------------------------------------------------------------- procedural land
const landCache = new Map();
function landCanvas(season) {
  if (landCache.has(season)) return landCache.get(season);
  const K = 2, c = document.createElement('canvas');
  c.width = MAP_W * K; c.height = MAP_H * K;
  const g = c.getContext('2d');
  g.scale(K, K);
  paintLand(g, season);
  landCache.set(season, c);
  return c;
}

export function paintLand(g, season) {
  const pal = LAND_PALETTE[season] || LAND_PALETTE[1];
  // sea
  const sea = g.createLinearGradient(0, 0, MAP_W, MAP_H);
  sea.addColorStop(0, pal.sea[0]); sea.addColorStop(1, pal.sea[1]);
  g.fillStyle = sea; g.fillRect(0, 0, MAP_W, MAP_H);
  let r = seeded(7);
  g.strokeStyle = 'rgba(255,255,255,0.10)'; g.lineWidth = 1.2;
  for (let i = 0; i < 260; i++) {
    const x = r() * MAP_W, y = r() * MAP_H, w = 8 + r() * 14;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + w / 2, y - 3, x + w, y); g.stroke();
  }
  const { circles, polys } = landShapes();
  const paint = (grow, color) => {
    g.fillStyle = color; g.strokeStyle = color; g.lineJoin = 'round'; g.lineWidth = grow * 2;
    for (const c of circles) { g.beginPath(); g.arc(c.x, c.y, c.r + grow, 0, Math.PI * 2); g.fill(); }
    for (const p of polys) {
      g.beginPath(); p.pts.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.closePath();
      g.fill(); if (grow > 0) g.stroke();
    }
  };
  // shallows, coastline, beach, land
  paint(16, 'rgba(160,210,220,0.18)');
  paint(9, 'rgba(160,210,220,0.22)');
  paint(5, pal.coast);
  paint(3, pal.beach);
  paint(0, pal.land);
  // terrain colour and marks per province
  const TC = { plains: null, forest: '#4d6b36', hills: '#9a7c4c', mountain: '#7c7468', marsh: '#5e7d62', coast: null };
  for (const p of PROVINCES) {
    const R = RADIUS[p.id];
    const tc = season === 3 ? (p.terrain === 'forest' ? '#6f8a6c' : null) : TC[p.terrain];
    if (tc) {
      const gr = g.createRadialGradient(p.x, p.y, 4, p.x, p.y, R * 0.95);
      gr.addColorStop(0, hexA(tc, 0.55)); gr.addColorStop(1, hexA(tc, 0));
      g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, R, 0, Math.PI * 2); g.fill();
    }
    r = seeded(500 + p.id);
    const spot = () => { const a = r() * Math.PI * 2, d = R * (0.35 + r() * 0.5); return [p.x + Math.cos(a) * d, p.y + Math.sin(a) * d]; };
    if (p.terrain === 'mountain' || p.terrain === 'hills') {
      const n = p.terrain === 'mountain' ? 7 : 4;
      for (let i = 0; i < n; i++) {
        const [x, y] = spot(), s = p.terrain === 'mountain' ? 10 + r() * 6 : 7 + r() * 4;
        g.fillStyle = season === 3 ? '#9aa6b0' : '#5e5446';
        g.beginPath(); g.moveTo(x - s, y + s * 0.6); g.lineTo(x, y - s); g.lineTo(x + s, y + s * 0.6); g.closePath(); g.fill();
        g.fillStyle = '#f4f6f8';
        g.beginPath(); g.moveTo(x - s * 0.35, y - s * 0.3); g.lineTo(x, y - s); g.lineTo(x + s * 0.35, y - s * 0.3); g.closePath(); g.fill();
      }
    } else if (p.terrain === 'forest') {
      for (let i = 0; i < 12; i++) {
        const [x, y] = spot();
        g.fillStyle = season === 2 ? ['#a8502a', '#c07a2a', '#7a4a20'][i % 3] : season === 3 ? '#4a6a52' : '#2f4a24';
        g.beginPath(); g.arc(x, y, 5 + r() * 3, 0, Math.PI * 2); g.fill();
      }
    } else if (p.terrain === 'marsh') {
      g.strokeStyle = 'rgba(40,70,50,0.7)'; g.lineWidth = 1.4;
      for (let i = 0; i < 14; i++) { const [x, y] = spot(); g.beginPath(); g.moveTo(x, y); g.lineTo(x - 2, y - 8); g.moveTo(x, y); g.lineTo(x + 3, y - 7); g.stroke(); }
      g.fillStyle = 'rgba(60,110,120,0.45)';
      for (let i = 0; i < 4; i++) { const [x, y] = spot(); g.beginPath(); g.ellipse(x, y, 9, 4, 0, 0, Math.PI * 2); g.fill(); }
    } else if (p.terrain === 'plains') {
      g.strokeStyle = season === 3 ? 'rgba(150,160,170,0.4)' : 'rgba(120,100,40,0.35)'; g.lineWidth = 1;
      for (let i = 0; i < 6; i++) { const [x, y] = spot(); for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(x - 7, y + k * 3); g.lineTo(x + 7, y + k * 3); g.stroke(); } }
    }
  }
  // paper grain and vignette
  r = seeded(99);
  g.fillStyle = 'rgba(60,40,20,0.05)';
  for (let i = 0; i < 1600; i++) g.fillRect(r() * MAP_W, r() * MAP_H, 1.5, 1.5);
  const vg = g.createRadialGradient(MAP_W / 2, MAP_H / 2, MAP_H * 0.45, MAP_W / 2, MAP_H / 2, MAP_W * 0.7);
  vg.addColorStop(0, 'rgba(20,10,0,0)'); vg.addColorStop(1, 'rgba(20,10,0,0.45)');
  g.fillStyle = vg; g.fillRect(0, 0, MAP_W, MAP_H);
}

function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function seaLane(ctx, a, b, phase) {
  const mx = (a.x + b.x) / 2 + (a.y - b.y) * 0.18, my = (a.y + b.y) / 2 + (b.x - a.x) * 0.18;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(10,30,50,0.5)'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(mx, my, b.x, b.y); ctx.stroke();
  ctx.strokeStyle = 'rgba(230,245,255,0.95)'; ctx.lineWidth = 2.4; ctx.setLineDash([2, 7]); ctx.lineDashOffset = -phase;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(mx, my, b.x, b.y); ctx.stroke();
  ctx.setLineDash([]);
  // little ship at the midpoint of the curve
  const sx = (a.x + 2 * mx + b.x) / 4, sy = (a.y + 2 * my + b.y) / 4;
  ctx.translate(sx, sy);
  ctx.fillStyle = '#5a3a1e'; ctx.strokeStyle = '#f3e3b5'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-9, 2); ctx.lineTo(9, 2); ctx.lineTo(6, 7); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#f6efd8';
  ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(0, 1); ctx.lineTo(8, 0); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-1, -9); ctx.lineTo(-1, 1); ctx.lineTo(-7, 0); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function causeway(ctx, a, b) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x), len = Math.hypot(b.x - a.x, b.y - a.y);
  ctx.save();
  ctx.translate(a.x, a.y); ctx.rotate(ang);
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, -6, len, 14);
  ctx.fillStyle = '#9a9184'; ctx.fillRect(0, -7, len, 12);
  ctx.fillStyle = '#7a7266';
  for (let x = 4; x < len; x += 12) ctx.fillRect(x, -7, 2, 12);
  ctx.strokeStyle = '#d8cfbf'; ctx.lineWidth = 1; ctx.strokeRect(0, -7, len, 12);
  ctx.restore();
}

function line(ctx, a, b) {
  ctx.beginPath(); ctx.moveTo(a.x, a.y);
  const mx = (a.x + b.x) / 2 + (a.y - b.y) * 0.06, my = (a.y + b.y) / 2 + (b.x - a.x) * 0.06;
  ctx.quadraticCurveTo(mx, my, b.x, b.y); ctx.stroke();
}

function arrow(ctx, a, b, col, phase) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const sx = a.x + Math.cos(ang) * 26, sy = a.y + Math.sin(ang) * 26;
  const ex = b.x - Math.cos(ang) * 30, ey = b.y - Math.sin(ang) * 30;
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.strokeStyle = col; ctx.lineWidth = 5; ctx.setLineDash([12, 8]); ctx.lineDashOffset = -phase;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = col; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(ex + Math.cos(ang) * 10, ey + Math.sin(ang) * 10);
  ctx.lineTo(ex + Math.cos(ang + 2.5) * 14, ey + Math.sin(ang + 2.5) * 14);
  ctx.lineTo(ex + Math.cos(ang - 2.5) * 14, ey + Math.sin(ang - 2.5) * 14);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}

function diamond(ctx, x, y, w, h) { ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x + w, y); ctx.lineTo(x, y + h); ctx.lineTo(x - w, y); ctx.closePath(); ctx.fill(); }
function diamondStroke(ctx, x, y, w, h) { ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x + w, y); ctx.lineTo(x, y + h); ctx.lineTo(x - w, y); ctx.closePath(); ctx.stroke(); }

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
