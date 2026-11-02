// Large animated spirit creatures drawn procedurally (no art needed). Original designs.
// drawSpirit(g, id, x, y, s, t, opts) — (x, y) is the creature's centre, s its overall size.
// opts: { facing: 1|-1, run: 0..1 (gallop/glide amount), alpha, glow: 0..1 extra intensity }

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function rgba(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
const noise = (i, t) => Math.sin(i * 12.9898 + t * 3.1) * 0.5 + Math.sin(i * 4.1 + t * 5.3) * 0.3 + Math.sin(i * 1.7 - t * 1.9) * 0.2;

function aura(g, x, y, r, col, a) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, rgba(col, a)); gr.addColorStop(0.45, rgba(col, a * 0.35)); gr.addColorStop(1, rgba(col, 0));
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
}

// A licking flame tongue from (x, y) upwards, height h.
function flame(g, x, y, w, h, t, i, inner = '#fff3b0', outer = '#ff7a2f') {
  const sway = noise(i, t) * w * 0.6;
  const gr = g.createLinearGradient(x, y, x, y - h);
  gr.addColorStop(0, outer); gr.addColorStop(0.5, rgba('#ffb040', 0.9)); gr.addColorStop(1, rgba('#ffe080', 0));
  g.fillStyle = gr;
  g.beginPath(); g.moveTo(x - w / 2, y);
  g.quadraticCurveTo(x - w * 0.6 + sway * 0.3, y - h * 0.5, x + sway, y - h);
  g.quadraticCurveTo(x + w * 0.6 + sway * 0.3, y - h * 0.45, x + w / 2, y); g.closePath(); g.fill();
  g.fillStyle = rgba('#fff6c8', 0.75);
  g.beginPath(); g.moveTo(x - w * 0.2, y); g.quadraticCurveTo(x - w * 0.2 + sway * 0.2, y - h * 0.35, x + sway * 0.5, y - h * 0.55); g.quadraticCurveTo(x + w * 0.22, y - h * 0.3, x + w * 0.2, y); g.fill();
  void inner;
}

// ---------------------------------------------------------------- Ember Stag
function emberStag(g, s, t, run) {
  const ph = t * (run ? 9 : 2);
  const gal = run ? 1 : 0.15;
  const bodyY = -s * 0.05 + (run ? Math.sin(ph * 2) * s * 0.03 : Math.sin(t * 1.6) * s * 0.01);
  g.globalCompositeOperation = 'lighter';
  aura(g, 0, bodyY - s * 0.1, s * 0.75, '#ff6a20', 0.45);
  g.globalCompositeOperation = 'source-over';
  const fire = g.createLinearGradient(0, bodyY - s * 0.3, 0, bodyY + s * 0.2);
  fire.addColorStop(0, '#ffd27a'); fire.addColorStop(0.5, '#ff8a30'); fire.addColorStop(1, '#b8341a');
  // legs (far pair darker)
  const leg = (x, off, a) => {
    const sw = Math.sin(ph + off) * 0.55 * gal;
    const kx = x + Math.sin(sw) * s * 0.16, ky = bodyY + s * 0.1 + Math.cos(sw) * s * 0.16;
    const fx = kx + Math.sin(sw - 0.5 * gal * Math.max(0, Math.cos(ph + off))) * s * 0.17, fy = ky + s * 0.16;
    g.strokeStyle = a; g.lineWidth = s * 0.045; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, bodyY + s * 0.06); g.lineTo(kx, ky); g.lineTo(fx, fy); g.stroke();
    g.fillStyle = '#3a1408'; g.beginPath(); g.ellipse(fx, fy, s * 0.025, s * 0.018, 0, 0, TAU); g.fill();
  };
  leg(-s * 0.2, 0.6, '#9a2e14'); leg(s * 0.2, 3.7, '#9a2e14');
  // body
  g.fillStyle = fire; g.shadowColor = '#ff8a30'; g.shadowBlur = s * 0.12;
  g.beginPath(); g.ellipse(0, bodyY, s * 0.3, s * 0.13, -0.05, 0, TAU); g.fill();
  // neck and head
  g.beginPath(); g.moveTo(s * 0.18, bodyY - s * 0.06); g.quadraticCurveTo(s * 0.26, bodyY - s * 0.3, s * 0.32, bodyY - s * 0.34);
  g.lineTo(s * 0.47, bodyY - s * 0.28); g.lineTo(s * 0.45, bodyY - s * 0.23); g.lineTo(s * 0.33, bodyY - s * 0.22); g.quadraticCurveTo(s * 0.28, bodyY - s * 0.05, s * 0.26, bodyY + s * 0.04); g.closePath(); g.fill();
  g.shadowBlur = 0;
  leg(-s * 0.15, 2.2, '#e0562a'); leg(s * 0.25, 5.3, '#e0562a');
  // eye
  g.fillStyle = '#fffbe0'; g.beginPath(); g.arc(s * 0.37, bodyY - s * 0.3, s * 0.012, 0, TAU); g.fill();
  // antlers: branching lines of white-hot fire
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = '#ffe9a0'; g.lineCap = 'round'; g.shadowColor = '#ffb040'; g.shadowBlur = s * 0.08;
  const antler = (dir) => {
    const bx = s * 0.33, by = bodyY - s * 0.35;
    g.lineWidth = s * 0.02;
    g.beginPath(); g.moveTo(bx, by);
    const tip = { x: bx - s * 0.12 * dir - s * 0.05, y: by - s * 0.32 };
    g.quadraticCurveTo(bx - s * 0.02, by - s * 0.18, tip.x, tip.y); g.stroke();
    for (let i = 1; i <= 3; i++) {
      const k = i / 4;
      const px = bx + (tip.x - bx) * k - s * 0.01, py = by + (tip.y - by) * k;
      g.lineWidth = s * 0.014;
      g.beginPath(); g.moveTo(px, py); g.lineTo(px + s * (0.1 - i * 0.02) * (dir > 0 ? 1 : 0.6), py - s * 0.08); g.stroke();
    }
  };
  antler(1); antler(-0.4);
  g.shadowBlur = 0;
  // mane and back of flames
  for (let i = 0; i < 9; i++) {
    const x = -s * 0.25 + i * s * 0.065, base = bodyY - s * 0.11 + Math.abs(i - 6) * s * 0.004 - (i > 6 ? (i - 6) * s * 0.06 : 0);
    flame(g, x, base, s * 0.07, s * (0.12 + 0.07 * (0.5 + noise(i, t) * 0.5)), t * 1.4, i);
  }
  // tail flame
  flame(g, -s * 0.31, bodyY - s * 0.02, s * 0.08, s * 0.16, t * 1.6, 11);
  g.globalCompositeOperation = 'source-over';
}

// ---------------------------------------------------------------- Tide Serpent
function tideSerpent(g, s, t, run) {
  const N = 26;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const k = i / (N - 1);
    const x = (0.42 - k * 0.95) * s;
    const y = Math.sin(k * 7.5 - t * (2 + run * 2)) * s * 0.12 * (0.4 + k) - Math.sin(k * Math.PI) * s * 0.18 + k * s * 0.15;
    pts.push({ x, y, r: s * (0.085 * (1 - k * 0.75) + 0.012) });
  }
  g.globalCompositeOperation = 'lighter';
  aura(g, 0, -s * 0.05, s * 0.75, '#3fb6ff', 0.4);
  g.globalCompositeOperation = 'source-over';
  // body from tail to head so the head is on top
  for (let i = N - 1; i >= 0; i--) {
    const p = pts[i];
    const gr = g.createRadialGradient(p.x - p.r * 0.3, p.y - p.r * 0.4, p.r * 0.1, p.x, p.y, p.r);
    gr.addColorStop(0, '#d8f4ff'); gr.addColorStop(0.45, '#4cb8f0'); gr.addColorStop(1, '#13507e');
    g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, p.r, 0, TAU); g.fill();
    if (i % 3 === 1 && i > 2 && i < N - 3) {   // dorsal fins
      g.fillStyle = 'rgba(150,225,255,0.75)';
      g.beginPath(); g.moveTo(p.x - p.r * 0.6, p.y - p.r * 0.7); g.lineTo(p.x + p.r * 0.2, p.y - p.r * 2.0 - Math.sin(t * 4 + i) * p.r * 0.3); g.lineTo(p.x + p.r * 0.7, p.y - p.r * 0.6); g.fill();
    }
  }
  // head
  const h = pts[0];
  g.save(); g.translate(h.x, h.y); g.rotate(-0.25 + Math.sin(t * 2) * 0.08);
  const hg = g.createLinearGradient(0, -s * 0.08, 0, s * 0.08);
  hg.addColorStop(0, '#9be0ff'); hg.addColorStop(1, '#155a8a');
  g.fillStyle = hg;
  g.beginPath(); g.moveTo(-s * 0.06, -s * 0.07); g.quadraticCurveTo(s * 0.1, -s * 0.11, s * 0.2, -s * 0.03); g.lineTo(s * 0.21, s * 0.01);
  g.quadraticCurveTo(s * 0.1, s * 0.07, -s * 0.06, s * 0.07); g.closePath(); g.fill();
  // crest fins
  g.fillStyle = 'rgba(170,235,255,0.85)';
  for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(-s * 0.04 + i * s * 0.035, -s * 0.07); g.lineTo(-s * 0.1 + i * s * 0.03, -s * (0.2 + i * 0.02) - Math.sin(t * 5 + i) * s * 0.015); g.lineTo(s * 0.0 + i * s * 0.035, -s * 0.075); g.fill(); }
  // jaw and fangs
  g.strokeStyle = '#0b3554'; g.lineWidth = s * 0.008; g.beginPath(); g.moveTo(s * 0.03, s * 0.02); g.lineTo(s * 0.2, s * 0.0); g.stroke();
  g.fillStyle = '#ffffff'; for (const fx of [0.12, 0.16]) { g.beginPath(); g.moveTo(s * fx, s * 0.005); g.lineTo(s * (fx + 0.008), s * 0.03); g.lineTo(s * (fx + 0.016), s * 0.004); g.fill(); }
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = '#e8ffff'; g.shadowColor = '#7fe8ff'; g.shadowBlur = s * 0.06;
  g.beginPath(); g.ellipse(s * 0.08, -s * 0.035, s * 0.018, s * 0.011, -0.2, 0, TAU); g.fill();
  g.shadowBlur = 0; g.restore();
  // droplets
  for (let i = 0; i < 10; i++) {
    const k = (t * 0.7 + i / 10) % 1;
    const p = pts[(i * 3) % N];
    g.fillStyle = `rgba(200,240,255,${0.7 * (1 - k)})`;
    g.beginPath(); g.arc(p.x + Math.sin(i) * s * 0.03, p.y + k * s * 0.25, s * 0.01, 0, TAU); g.fill();
  }
  g.globalCompositeOperation = 'source-over';
}

// ---------------------------------------------------------------- Gale Owl
function galeOwl(g, s, t, run) {
  const flap = Math.sin(t * (run ? 9 : 3.5));
  g.globalCompositeOperation = 'lighter';
  aura(g, 0, 0, s * 0.8, '#bcd4ff', 0.35);
  g.globalCompositeOperation = 'source-over';
  const wing = (dir) => {
    g.save(); g.scale(dir, 1); g.rotate(-flap * 0.25);
    const layers = [[0.52, '#5a6a9a'], [0.42, '#8aa0d0'], [0.3, '#c8d8f4']];
    for (const [len, col] of layers) {
      g.fillStyle = col;
      for (let i = 0; i < 7; i++) {
        const a = -0.9 + i * 0.27;
        const L = s * len * (1 - Math.abs(i - 2) * 0.06);
        g.save(); g.translate(s * 0.08, -s * 0.05); g.rotate(a);
        g.beginPath(); g.ellipse(L * 0.5, 0, L * 0.5, s * 0.035, 0, 0, TAU); g.fill(); g.restore();
      }
    }
    g.restore();
  };
  wing(1); wing(-1);
  // body
  const bg = g.createLinearGradient(0, -s * 0.25, 0, s * 0.25);
  bg.addColorStop(0, '#e6eeff'); bg.addColorStop(1, '#6f82b4');
  g.fillStyle = bg; g.beginPath(); g.ellipse(0, s * 0.02, s * 0.14, s * 0.22, 0, 0, TAU); g.fill();
  // breast feathers
  g.strokeStyle = 'rgba(70,90,140,0.5)'; g.lineWidth = s * 0.006;
  for (let r = 0; r < 4; r++) for (let c = -1; c <= 1; c++) { g.beginPath(); g.arc(c * s * 0.045, s * (0.0 + r * 0.045), s * 0.02, 0.2, Math.PI - 0.2); g.stroke(); }
  // head and ear tufts
  g.fillStyle = '#d8e4ff'; g.beginPath(); g.ellipse(0, -s * 0.2, s * 0.12, s * 0.1, 0, 0, TAU); g.fill();
  g.beginPath(); g.moveTo(-s * 0.1, -s * 0.25); g.lineTo(-s * 0.13, -s * 0.36); g.lineTo(-s * 0.05, -s * 0.28); g.fill();
  g.beginPath(); g.moveTo(s * 0.1, -s * 0.25); g.lineTo(s * 0.13, -s * 0.36); g.lineTo(s * 0.05, -s * 0.28); g.fill();
  // eyes
  g.globalCompositeOperation = 'lighter';
  for (const ex of [-1, 1]) {
    aura(g, ex * s * 0.05, -s * 0.2, s * 0.06, '#ffe680', 0.9);
    g.fillStyle = '#fff6c0'; g.beginPath(); g.arc(ex * s * 0.05, -s * 0.2, s * 0.028, 0, TAU); g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#10142a'; for (const ex of [-1, 1]) { g.beginPath(); g.arc(ex * s * 0.05, -s * 0.2, s * 0.012, 0, TAU); g.fill(); }
  g.fillStyle = '#e0b040'; g.beginPath(); g.moveTo(-s * 0.015, -s * 0.17); g.lineTo(0, -s * 0.13); g.lineTo(s * 0.015, -s * 0.17); g.fill();
  // crackling lightning over the wings
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = 'rgba(230,240,255,0.9)'; g.lineWidth = s * 0.006; g.shadowColor = '#bcd4ff'; g.shadowBlur = s * 0.04;
  const seed = Math.floor(t * 12);
  for (let j = 0; j < 2; j++) {
    const dir = j ? 1 : -1;
    g.beginPath(); let x = dir * s * 0.12, y = -s * 0.05; g.moveTo(x, y);
    for (let i = 0; i < 6; i++) { x += dir * s * 0.06; y += (Math.sin(seed * 7.3 + i * 3.1 + j) ) * s * 0.035; g.lineTo(x, y); }
    g.stroke();
  }
  g.shadowBlur = 0; g.globalCompositeOperation = 'source-over';
}

// ---------------------------------------------------------------- Stone Warden
function stoneWarden(g, s, t, run) {
  const sway = Math.sin(t * 1.2) * 0.03 + run * Math.sin(t * 5) * 0.05;
  g.globalCompositeOperation = 'lighter';
  aura(g, 0, 0, s * 0.7, '#d0a060', 0.25);
  g.globalCompositeOperation = 'source-over';
  const rock = (x, y, w, h, seed, col = '#8a7a66') => {
    const gr = g.createLinearGradient(x, y - h, x, y + h);
    gr.addColorStop(0, '#b8a68c'); gr.addColorStop(1, '#4a3e32');
    g.fillStyle = gr; g.strokeStyle = '#2a221c'; g.lineWidth = s * 0.006;
    g.beginPath();
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * TAU + seed;
      const r = 0.85 + 0.15 * Math.sin(seed * 9 + i * 2.7);
      const px = x + Math.cos(a) * w * r, py = y + Math.sin(a) * h * r;
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.closePath(); g.fill(); g.stroke();
    void col;
  };
  g.save(); g.rotate(sway);
  // legs
  rock(-s * 0.12, s * 0.3, s * 0.08, s * 0.12, 1.1); rock(s * 0.12, s * 0.3, s * 0.08, s * 0.12, 2.2);
  // torso and shoulders
  rock(0, s * 0.02, s * 0.2, s * 0.2, 0.3);
  rock(-s * 0.2, -s * 0.12, s * 0.1, s * 0.09, 3.3); rock(s * 0.2, -s * 0.12, s * 0.1, s * 0.09, 4.4);
  // arms (fists swing)
  const fistA = Math.sin(t * 1.5) * s * 0.02;
  rock(-s * 0.3, s * 0.05 + fistA, s * 0.07, s * 0.12, 5.5); rock(s * 0.3, s * 0.05 - fistA, s * 0.07, s * 0.12, 6.6);
  rock(-s * 0.31, s * 0.2 + fistA, s * 0.08, s * 0.07, 7.7); rock(s * 0.31, s * 0.2 - fistA, s * 0.08, s * 0.07, 8.8);
  // head
  rock(0, -s * 0.24, s * 0.09, s * 0.075, 9.9);
  // moss
  g.fillStyle = 'rgba(90,140,60,0.75)';
  for (const [mx, my, mr] of [[-0.12, -0.08, 0.05], [0.08, -0.16, 0.04], [-0.2, -0.17, 0.035], [0.15, 0.12, 0.03]]) { g.beginPath(); g.ellipse(s * mx, s * my, s * mr, s * mr * 0.5, 0, Math.PI, 0); g.fill(); }
  // glowing runes and eyes
  g.globalCompositeOperation = 'lighter';
  const glow = 0.6 + 0.4 * Math.sin(t * 2.4);
  g.strokeStyle = `rgba(255,200,110,${glow})`; g.lineWidth = s * 0.012; g.shadowColor = '#ffb050'; g.shadowBlur = s * 0.05; g.lineCap = 'round';
  g.beginPath(); g.moveTo(-s * 0.06, -s * 0.06); g.lineTo(0, s * 0.04); g.lineTo(s * 0.06, -s * 0.06); g.moveTo(0, s * 0.04); g.lineTo(0, s * 0.13);
  g.moveTo(-s * 0.08, s * 0.08); g.lineTo(s * 0.08, s * 0.08); g.stroke();
  g.fillStyle = `rgba(255,220,140,${glow})`; g.fillRect(-s * 0.045, -s * 0.255, s * 0.03, s * 0.014); g.fillRect(s * 0.015, -s * 0.255, s * 0.03, s * 0.014);
  g.shadowBlur = 0; g.globalCompositeOperation = 'source-over';
  g.restore();
  // orbiting stones
  for (let i = 0; i < 5; i++) {
    const a = t * 0.8 + i * TAU / 5;
    const ox = Math.cos(a) * s * 0.42, oy = Math.sin(a) * s * 0.12 - s * 0.05;
    rock(ox, oy, s * 0.025, s * 0.02, i * 1.7);
  }
}

// ---------------------------------------------------------------- Dusk Moth
function duskMoth(g, s, t, run) {
  const flut = Math.sin(t * (run ? 14 : 6)) * 0.5 + 0.5;
  g.globalCompositeOperation = 'lighter';
  aura(g, 0, 0, s * 0.8, '#9a6bff', 0.4);
  g.globalCompositeOperation = 'source-over';
  const wing = (dir, upper) => {
    g.save(); g.scale(dir, 1);
    const sc = 0.65 + 0.35 * flut;
    g.scale(sc, 1);
    const w = upper ? s * 0.42 : s * 0.3, h = upper ? s * 0.3 : s * 0.22;
    const cy = upper ? -s * 0.08 : s * 0.12;
    const gr = g.createRadialGradient(w * 0.5, cy, 0, w * 0.5, cy, w);
    gr.addColorStop(0, '#d8b8ff'); gr.addColorStop(0.5, '#7a4ad0'); gr.addColorStop(1, '#2a1450');
    g.fillStyle = gr; g.strokeStyle = 'rgba(30,10,50,0.8)'; g.lineWidth = s * 0.006;
    g.beginPath(); g.moveTo(0, cy - h * 0.2);
    g.bezierCurveTo(w * 0.4, cy - h * (upper ? 1.3 : 0.4), w * 1.1, cy - h * (upper ? 0.9 : 0.1), w, cy + h * (upper ? 0.1 : 0.6));
    g.bezierCurveTo(w * 0.8, cy + h * (upper ? 0.6 : 1.1), w * 0.2, cy + h * 0.5, 0, cy + h * 0.2); g.closePath(); g.fill(); g.stroke();
    // eye spot
    const ex = w * (upper ? 0.62 : 0.55), ey = cy + (upper ? -h * 0.15 : h * 0.25), er = s * (upper ? 0.07 : 0.045);
    g.fillStyle = '#1a0a2e'; g.beginPath(); g.arc(ex, ey, er, 0, TAU); g.fill();
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = `rgba(255,210,120,${0.6 + 0.4 * Math.sin(t * 3 + dir)})`; g.beginPath(); g.arc(ex, ey, er * 0.55, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,230,0.9)'; g.beginPath(); g.arc(ex - er * 0.15, ey - er * 0.15, er * 0.2, 0, TAU); g.fill();
    g.globalCompositeOperation = 'source-over';
    // veins
    g.strokeStyle = 'rgba(40,15,70,0.5)';
    for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(0, cy); g.quadraticCurveTo(w * 0.5, cy - h * 0.3 + i * h * 0.25, w * 0.95, cy - h * 0.5 + i * h * 0.4); g.stroke(); }
    g.restore();
  };
  wing(1, false); wing(-1, false); wing(1, true); wing(-1, true);
  // furry body
  const bg = g.createLinearGradient(0, -s * 0.2, 0, s * 0.25);
  bg.addColorStop(0, '#5a3a8a'); bg.addColorStop(1, '#24123e');
  g.fillStyle = bg; g.beginPath(); g.ellipse(0, s * 0.04, s * 0.055, s * 0.2, 0, 0, TAU); g.fill();
  g.beginPath(); g.arc(0, -s * 0.17, s * 0.05, 0, TAU); g.fill();
  // feathery antennae
  g.strokeStyle = '#b89aff'; g.lineWidth = s * 0.006;
  for (const dir of [-1, 1]) {
    g.beginPath(); g.moveTo(dir * s * 0.02, -s * 0.2); g.quadraticCurveTo(dir * s * 0.08, -s * 0.34, dir * s * 0.14, -s * 0.33); g.stroke();
    for (let i = 1; i < 6; i++) { const k = i / 6; const ax = dir * s * (0.02 + 0.12 * k), ay = -s * (0.2 + 0.13 * Math.sin(k * 2)); g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax + dir * s * 0.015, ay - s * 0.025); g.stroke(); }
  }
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = '#ff9af0'; for (const dir of [-1, 1]) { g.beginPath(); g.arc(dir * s * 0.025, -s * 0.18, s * 0.012, 0, TAU); g.fill(); }
  // drifting dust
  for (let i = 0; i < 12; i++) {
    const k = (t * 0.25 + i / 12) % 1;
    g.fillStyle = `rgba(200,160,255,${0.6 * Math.sin(k * Math.PI)})`;
    g.beginPath(); g.arc(Math.sin(i * 2.1 + t) * s * 0.4, s * 0.2 + k * s * 0.3, s * 0.008, 0, TAU); g.fill();
  }
  g.globalCompositeOperation = 'source-over';
}

const DRAW = { ember: emberStag, tide: tideSerpent, gale: galeOwl, stone: stoneWarden, dusk: duskMoth };

export function drawSpirit(g, id, x, y, s, t, opts = {}) {
  const f = DRAW[id];
  if (!f) return;
  g.save();
  g.translate(x, y);
  g.scale(opts.facing || 1, 1);
  g.globalAlpha *= clamp(opts.alpha ?? 1, 0, 1);
  f(g, s, t, opts.run || 0);
  g.restore();
}
