// Procedural soldiers for the battle board and the animated clash scenes. Original designs.
//
// drawSoldier(g, type, x, y, s, pal, facing, pose)
//   (x, y) = feet, s = figure height (an infantryman; riders and beasts are drawn larger),
//   pal = palette(color, accent), facing = 1 (right) | -1 (left),
//   pose = { walk: phase in radians or null, act: 'idle'|'swing'|'thrust'|'draw'|'loose'|'block'
//            |'cast'|'fall'|'flee', k: 0..1 progress of the act, t: seconds (for idle motion),
//            run: bool (faster, leaning gait) }
// All drawing faces right; the caller's facing flips it.

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOut = t => 1 - Math.pow(1 - t, 3);

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function shade(hex, f) {
  const [r, g, b] = hexToRgb(hex);
  const m = c => Math.round(f >= 0 ? c + (255 - c) * f : c * (1 + f));
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

const palCache = new Map();
export function palette(color, accent) {
  const key = color + accent;
  let p = palCache.get(key);
  if (p) return p;
  const [r, g, b] = hexToRgb(color);
  const lum = (r + g + b) / 3;
  const base = lum < 70 ? shade(color, 0.3) : color;   // very dark banners read lighter on figures
  p = {
    col: base, colD: shade(base.startsWith('#') ? base : color, -0.35), colL: shade(color, 0.25), acc: accent,
    ink: '#1b1418', skin: '#e2b98f', skinD: '#b8875e', steel: '#c7ccd4', steelD: '#7d8590',
    leather: '#7a5434', leatherD: '#4e3420', wood: '#7b5530', woodD: '#4a311a', cloth: '#9b8a6a',
    raw: color,
  };
  // colD needs a hex input for shade(); compute from the original colour when base is rgb()
  if (!base.startsWith('#')) p.colD = shade(color, lum < 70 ? 0.05 : -0.35);
  palCache.set(key, p);
  return p;
}

// What each troop type carries.
const KIT = {
  footmen:  { helm: 'nasal', weapon: 'sword', shield: 'round', armour: 'mail' },
  pikes:    { helm: 'kettle', weapon: 'pike', shield: null, armour: 'mail' },
  archers:  { helm: 'hood', weapon: 'bow', shield: null, armour: 'leather', quiver: true },
  militia:  { helm: 'straw', weapon: 'fork', shield: null, armour: 'cloth' },
  bandits:  { helm: 'cowl', weapon: 'crossbow', shield: null, armour: 'leather', mask: true },
  druids:   { helm: 'leafhood', weapon: 'staff', shield: null, armour: 'robe' },
};
export const MOUNTED = new Set(['horse', 'knights', 'wolfriders', 'ghosts']);
export const RANGED = new Set(['archers', 'bandits', 'druids', 'siege']);

// Default attack act for a type.
export function attackAct(type) {
  if (type === 'pikes' || type === 'militia' || type === 'knights') return 'thrust';
  if (type === 'archers' || type === 'bandits') return 'draw';
  if (type === 'druids') return 'cast';
  if (type === 'siege') return 'loose';
  return 'swing';
}

// ------------------------------------------------------------------ primitives
function limb(g, x1, y1, x2, y2, w, col, ink) {
  g.lineCap = 'round';
  g.strokeStyle = ink; g.lineWidth = w + 1.6;
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  g.strokeStyle = col; g.lineWidth = w;
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
}
function leg2(g, hx, hy, ang, bend, len, w, col, ink, foot) {
  // thigh then shin; ang = swing angle from vertical (+ forward), bend = knee flex
  const kx = hx + Math.sin(ang) * len, ky = hy + Math.cos(ang) * len;
  const sa = ang - bend;
  const fx = kx + Math.sin(sa) * len, fy = ky + Math.cos(sa) * len;
  limb(g, hx, hy, kx, ky, w, col, ink);
  limb(g, kx, ky, fx, fy, w * 0.9, col, ink);
  if (foot) { g.fillStyle = foot; g.beginPath(); g.ellipse(fx + w * 0.4, fy, w * 0.75, w * 0.4, 0, 0, TAU); g.fill(); }
  return { kx, ky, fx, fy };
}

// Arm pose for an act: returns shoulder angle (from straight down, + forward/up) and weapon
// direction angle (canvas radians) for the front arm, plus extra offsets.
function armPose(weapon, act, k, t) {
  const breathe = Math.sin(t * 2.1) * 0.05;
  let th = 0.55 + breathe, wa = -1.25, push = 0, back = 0.2, glow = 0;
  if (weapon === 'pike' || weapon === 'fork') { th = 0.35; wa = -1.45 + breathe * 0.3; }
  if (weapon === 'bow') { th = 0.35; wa = -1.5; }
  if (weapon === 'crossbow') { th = 1.2; wa = -0.15; back = 0.9; }
  if (weapon === 'staff') { th = 0.4; wa = -1.5; }
  if (weapon === 'lance') { th = 1.3; wa = -0.12; }
  if (act === 'swing') {
    if (k < 0.45) { const e = ease(k / 0.45); th = lerp(0.55, 2.9, e); wa = lerp(-1.25, -2.6, e); }
    else if (k < 0.62) { const e = easeOut((k - 0.45) / 0.17); th = lerp(2.9, 1.0, e); wa = lerp(-2.6, 0.55, e); }
    else { const e = ease((k - 0.62) / 0.38); th = lerp(1.0, 0.55, e); wa = lerp(0.55, -1.25, e); }
  } else if (act === 'thrust') {
    th = 1.35; wa = -0.08;
    if (k < 0.35) push = -0.14 * ease(k / 0.35);
    else if (k < 0.52) push = lerp(-0.14, 0.26, easeOut((k - 0.35) / 0.17));
    else push = lerp(0.26, 0, ease((k - 0.52) / 0.48));
    back = 0.9;
  } else if (act === 'draw' || act === 'loose') {
    if (weapon === 'crossbow') { th = 1.45; wa = -0.12; back = 1.2; push = act === 'loose' && k > 0.5 ? -0.06 * (1 - (k - 0.5) * 2) : 0; }
    else { th = 1.5; wa = -0.45; back = act === 'draw' ? lerp(0.6, 1.9, ease(k)) : (k < 0.15 ? 1.9 : 0.8); }
  } else if (act === 'block') { th = 0.95; wa = -1.0; push = 0.04; }
  else if (act === 'cast') { const e = Math.sin(clamp(k, 0, 1) * Math.PI); th = lerp(0.4, 2.7, e); wa = lerp(-1.5, -1.65, e); glow = e; back = lerp(0.2, 2.4, e); }
  return { th, wa, push, back, glow };
}

// ------------------------------------------------------------------ infantry
function person(g, s, P, kit, pose, opts = {}) {
  const t = pose.t || 0, act = pose.act || 'idle', k = pose.k ?? 0;
  const walking = pose.walk != null;
  const ph = walking ? pose.walk : 0;
  const run = pose.run ? 1.35 : 1;
  const lw = Math.max(1.2, s * 0.075);
  const ink = P.ink;
  const bob = walking ? -Math.abs(Math.sin(ph)) * s * 0.035 * run : Math.sin(t * 2.1) * s * 0.008;
  const lean = (walking ? 0.06 * run : 0) + (act === 'swing' && k > 0.45 && k < 0.7 ? 0.12 : 0) + (act === 'thrust' && k > 0.35 && k < 0.6 ? 0.1 : 0);
  const hipY = -s * 0.46 + bob;
  const robe = kit.armour === 'robe';
  g.save();
  // ---- legs
  if (!opts.mounted) {
    const legCol = kit.armour === 'cloth' ? '#6a5a44' : kit.armour === 'leather' ? P.leatherD : '#3a3238';
    const swing = walking ? Math.sin(ph) * 0.55 * run : 0.12;
    const bendA = walking ? Math.max(0, Math.cos(ph)) * 0.7 : 0.05;
    const bendB = walking ? Math.max(0, -Math.cos(ph)) * 0.7 : 0.05;
    const L = s * 0.235;
    if (!robe) {
      leg2(g, -s * 0.02, hipY, -swing, -bendB, L, lw, shade(legCol.startsWith('#') ? legCol : '#3a3238', -0.25), ink, ink);
      leg2(g, s * 0.02, hipY, swing - (act === 'thrust' || act === 'swing' ? 0.25 : 0), -bendA, L, lw, legCol, ink, ink);
    } else {
      g.fillStyle = ink;
      for (const sx of [-1, 1]) { const off = walking ? Math.sin(ph) * s * 0.06 * sx : 0; g.beginPath(); g.ellipse(off + s * 0.03, -s * 0.01, s * 0.05, s * 0.025, 0, 0, TAU); g.fill(); }
    }
  }
  g.translate(0, hipY);
  g.rotate(lean);
  // ---- back arm (behind body)
  const ap = armPose(kit.weapon, act, k, t);
  const shX = s * 0.03, shY = -s * 0.3;
  const AL = s * 0.27;
  const sleeve = kit.armour === 'mail' ? P.steelD : kit.armour === 'leather' ? P.leather : kit.armour === 'robe' ? '#3f6a35' : '#8a7a5c';
  {
    const ba = walking && act === 'idle' ? -Math.sin(ph) * 0.5 : ap.back;
    const hx = shX - s * 0.04 + Math.sin(ba) * AL, hy = shY + Math.cos(ba) * AL;
    limb(g, shX - s * 0.04, shY, hx, hy, lw * 0.95, shade(sleeve.startsWith('#') ? sleeve : '#777777', -0.2), ink);
    if (kit.shield === 'round') {   // shield on the back arm, carried in front of the body (drawn later)
      opts._shield = { x: hx + s * 0.06, y: hy - s * 0.02 };
    }
    if (kit.weapon === 'bow' && (act === 'draw' || act === 'loose')) opts._string = { x: hx, y: hy };
  }
  // ---- torso
  const tw = s * 0.15, th2 = s * 0.34;
  g.lineJoin = 'round';
  if (robe) {
    g.fillStyle = '#3f6a35'; g.strokeStyle = ink; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(-tw * 1.1, s * 0.46 - bob); g.lineTo(-tw * 0.8, -th2 + s * 0.02); g.lineTo(tw * 0.8, -th2 + s * 0.02); g.lineTo(tw * 1.25, s * 0.46 - bob); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = P.col; g.fillRect(-tw * 0.9, -s * 0.02, tw * 1.9, s * 0.045);
  } else {
    // mail/leather undercoat
    g.fillStyle = kit.armour === 'mail' ? P.steelD : kit.armour === 'leather' ? P.leatherD : '#7a6a50';
    g.strokeStyle = ink; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(-tw, s * 0.04); g.lineTo(-tw * 0.85, -th2); g.lineTo(tw * 0.85, -th2); g.lineTo(tw, s * 0.04); g.closePath(); g.fill(); g.stroke();
    // tabard in house colours
    if (kit.armour !== 'cloth') {
      g.fillStyle = P.col;
      g.beginPath(); g.moveTo(-tw * 0.72, s * 0.09); g.lineTo(-tw * 0.62, -th2 + s * 0.03); g.lineTo(tw * 0.62, -th2 + s * 0.03); g.lineTo(tw * 0.78, s * 0.09); g.closePath(); g.fill();
      g.fillStyle = P.acc; g.fillRect(-tw * 0.08, -th2 + s * 0.04, tw * 0.16, th2 + s * 0.04);
    } else {
      g.fillStyle = '#a8946a'; g.beginPath(); g.moveTo(-tw * 0.9, s * 0.05); g.lineTo(-tw * 0.75, -th2 + s * 0.02); g.lineTo(tw * 0.75, -th2 + s * 0.02); g.lineTo(tw * 0.9, s * 0.05); g.closePath(); g.fill();
      g.fillStyle = P.col; g.fillRect(-tw * 0.85, -s * 0.03, tw * 1.7, s * 0.035);   // a sash in the house colour
    }
    g.fillStyle = P.leatherD; g.fillRect(-tw * 0.95, -s * 0.06, tw * 1.9, s * 0.035);   // belt
  }
  if (kit.quiver) { g.fillStyle = P.leather; g.save(); g.translate(-tw * 0.9, -th2 * 0.6); g.rotate(-0.4); g.fillRect(-s * 0.03, -s * 0.12, s * 0.06, s * 0.22); g.fillStyle = '#e8dcc0'; for (let i = 0; i < 3; i++) g.fillRect(-s * 0.025 + i * s * 0.02, -s * 0.17, s * 0.012, s * 0.06); g.restore(); }
  // ---- head
  const hy = -th2 - s * 0.1, hr = s * 0.085;
  g.fillStyle = P.skin; g.strokeStyle = ink; g.lineWidth = 1.1;
  g.beginPath(); g.arc(s * 0.01, hy, hr, 0, TAU); g.fill(); g.stroke();
  g.fillStyle = ink; g.beginPath(); g.arc(s * 0.045, hy - hr * 0.1, Math.max(0.8, hr * 0.14), 0, TAU); g.fill();
  drawHelm(g, kit.helm, s * 0.01, hy, hr, P, t, s);
  if (kit.mask) { g.fillStyle = '#2a2228'; g.fillRect(s * 0.0, hy + hr * 0.15, hr * 1.05, hr * 0.5); }
  // ---- shield (in front of the body)
  if (opts._shield) {
    const sx = act === 'block' ? s * 0.12 : opts._shield.x, sy = act === 'block' ? -s * 0.2 : opts._shield.y;
    g.save(); g.translate(sx, sy);
    g.fillStyle = P.col; g.strokeStyle = ink; g.lineWidth = 1.3;
    g.beginPath(); g.ellipse(0, 0, s * 0.11, s * 0.15, 0, 0, TAU); g.fill(); g.stroke();
    g.strokeStyle = P.acc; g.lineWidth = Math.max(1, s * 0.025);
    g.beginPath(); g.moveTo(0, -s * 0.13); g.lineTo(0, s * 0.13); g.moveTo(-s * 0.09, 0); g.lineTo(s * 0.09, 0); g.stroke();
    g.fillStyle = P.steel; g.beginPath(); g.arc(0, 0, s * 0.03, 0, TAU); g.fill();
    g.restore();
  }
  // ---- front arm and weapon
  const fx0 = shX + s * 0.03, fy0 = shY;
  const hx = fx0 + Math.sin(ap.th) * AL + ap.push * s, hy2 = fy0 + Math.cos(ap.th) * AL;
  drawWeapon(g, kit.weapon, hx, hy2, ap.wa, s, P, act, k, ap, opts);
  limb(g, fx0, fy0, hx, hy2, lw, sleeve.startsWith('#') ? sleeve : '#777777', ink);
  g.fillStyle = P.skin; g.beginPath(); g.arc(hx, hy2, lw * 0.6, 0, TAU); g.fill();
  if (kit.weapon === 'bow' && opts._string) {   // string pulled to the back hand
    const bx = hx + Math.cos(ap.wa) * s * 0.02, by = hy2 + Math.sin(ap.wa) * s * 0.02;
    const perp = ap.wa + Math.PI / 2, r = s * 0.24;
    g.strokeStyle = 'rgba(240,235,215,0.9)'; g.lineWidth = Math.max(0.6, s * 0.012);
    g.beginPath(); g.moveTo(bx + Math.cos(perp) * r, by + Math.sin(perp) * r);
    g.lineTo(opts._string.x, opts._string.y); g.lineTo(bx - Math.cos(perp) * r, by - Math.sin(perp) * r); g.stroke();
    if (act === 'draw') {   // nocked arrow
      g.strokeStyle = '#e8dcc0'; g.lineWidth = Math.max(0.8, s * 0.016);
      g.beginPath(); g.moveTo(opts._string.x, opts._string.y); g.lineTo(bx + Math.cos(ap.wa) * s * 0.08, by + Math.sin(ap.wa) * s * 0.08); g.stroke();
    }
  }
  g.restore();
  return { hand: { x: hx, y: hy2 + hipY } };
}

function drawHelm(g, helm, x, y, r, P, t, s) {
  g.strokeStyle = P.ink; g.lineWidth = 1.1;
  if (helm === 'nasal' || helm === 'helm') {
    g.fillStyle = P.steel; g.beginPath(); g.arc(x, y - r * 0.15, r * 1.08, Math.PI * 1.02, Math.PI * 1.98); g.closePath(); g.fill(); g.stroke();
    g.fillRect(x + r * 0.55, y - r * 0.4, r * 0.18, r * 0.75);
  } else if (helm === 'kettle') {
    g.fillStyle = P.steel; g.beginPath(); g.ellipse(x, y - r * 0.35, r * 1.5, r * 0.35, 0, 0, TAU); g.fill(); g.stroke();
    g.beginPath(); g.arc(x, y - r * 0.35, r * 0.95, Math.PI, 0); g.fill(); g.stroke();
  } else if (helm === 'hood' || helm === 'cowl' || helm === 'leafhood') {
    const c = helm === 'leafhood' ? '#2f5228' : helm === 'cowl' ? '#3a3036' : P.colD;
    g.fillStyle = c; g.beginPath(); g.arc(x - r * 0.1, y - r * 0.05, r * 1.18, Math.PI * 0.75, Math.PI * 2.05); g.lineTo(x - r * 1.2, y + r * 0.9); g.closePath(); g.fill(); g.stroke();
    if (helm === 'leafhood') { g.fillStyle = '#5c9a48'; for (let i = 0; i < 3; i++) { g.beginPath(); g.ellipse(x - r * 0.6 + i * r * 0.5, y - r * 1.1, r * 0.25, r * 0.12, -0.5 + i * 0.4, 0, TAU); g.fill(); } }
  } else if (helm === 'straw') {
    g.fillStyle = '#d8b864'; g.beginPath(); g.ellipse(x, y - r * 0.55, r * 1.7, r * 0.35, 0, 0, TAU); g.fill(); g.stroke();
    g.beginPath(); g.ellipse(x, y - r * 0.8, r * 0.85, r * 0.5, 0, Math.PI, 0); g.fill(); g.stroke();
  } else if (helm === 'plume') {
    g.fillStyle = P.steel; g.beginPath(); g.arc(x, y - r * 0.1, r * 1.12, Math.PI * 0.9, Math.PI * 2.1); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#1b1418'; g.fillRect(x + r * 0.1, y - r * 0.25, r * 1.0, r * 0.18);   // visor slit
    const wave = Math.sin(t * 6) * r * 0.3;
    g.fillStyle = P.col; g.beginPath(); g.moveTo(x, y - r * 1.1); g.quadraticCurveTo(x - r * 1.4, y - r * 2.0 + wave, x - r * 2.6, y - r * 0.9 + wave); g.quadraticCurveTo(x - r * 1.3, y - r * 1.2, x, y - r * 0.9); g.fill();
  }
}

function drawWeapon(g, w, hx, hy, wa, s, P, act, k, ap, opts) {
  const ink = P.ink;
  const dx = Math.cos(wa), dy = Math.sin(wa);
  g.lineCap = 'round';
  if (w === 'sword') {
    const L = s * 0.36;
    g.strokeStyle = ink; g.lineWidth = Math.max(2, s * 0.05);
    g.beginPath(); g.moveTo(hx - dx * s * 0.04, hy - dy * s * 0.04); g.lineTo(hx + dx * L, hy + dy * L); g.stroke();
    g.strokeStyle = '#e9edf2'; g.lineWidth = Math.max(1, s * 0.03);
    g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx + dx * L, hy + dy * L); g.stroke();
    g.strokeStyle = '#b08a3a'; g.lineWidth = Math.max(1.2, s * 0.03);   // crossguard
    g.beginPath(); g.moveTo(hx - dy * s * 0.05, hy + dx * s * 0.05); g.lineTo(hx + dy * s * 0.05, hy - dx * s * 0.05); g.stroke();
    if (act === 'swing' && k > 0.43 && k < 0.66) {   // swoosh arc
      g.save(); g.globalCompositeOperation = 'lighter';
      g.strokeStyle = 'rgba(255,245,220,0.55)'; g.lineWidth = Math.max(2, s * 0.06);
      g.beginPath(); g.arc(hx - dx * L * 0.2, hy - dy * L * 0.2, L * 1.05, wa - 1.4, wa); g.stroke(); g.restore();
    }
  } else if (w === 'pike' || w === 'fork' || w === 'lance') {
    const back = w === 'pike' ? s * 0.45 : s * 0.25, L = w === 'pike' ? s * 0.95 : w === 'lance' ? s * 1.0 : s * 0.55;
    g.strokeStyle = ink; g.lineWidth = Math.max(2, s * 0.045);
    g.beginPath(); g.moveTo(hx - dx * back, hy - dy * back); g.lineTo(hx + dx * L, hy + dy * L); g.stroke();
    g.strokeStyle = w === 'lance' ? P.colL : P.wood; g.lineWidth = Math.max(1, s * 0.028);
    g.beginPath(); g.moveTo(hx - dx * back, hy - dy * back); g.lineTo(hx + dx * L, hy + dy * L); g.stroke();
    const tx = hx + dx * L, ty = hy + dy * L;
    g.fillStyle = P.steel; g.strokeStyle = ink; g.lineWidth = 0.8;
    if (w === 'fork') {
      g.strokeStyle = P.steel; g.lineWidth = Math.max(1, s * 0.022);
      for (const o of [-1, 0, 1]) { g.beginPath(); g.moveTo(tx - dy * o * s * 0.04, ty + dx * o * s * 0.04); g.lineTo(tx + dx * s * 0.1 - dy * o * s * 0.04, ty + dy * s * 0.1 + dx * o * s * 0.04); g.stroke(); }
    } else {
      g.beginPath(); g.moveTo(tx + dx * s * 0.12, ty + dy * s * 0.12); g.lineTo(tx - dy * s * 0.035, ty + dx * s * 0.035); g.lineTo(tx + dy * s * 0.035, ty - dx * s * 0.035); g.closePath(); g.fill(); g.stroke();
      if (w === 'lance') { g.fillStyle = P.col; g.beginPath(); g.moveTo(tx - dx * s * 0.05, ty - dy * s * 0.05); g.lineTo(tx - dx * s * 0.2 - dy * s * 0.1, ty - dy * s * 0.2 + dx * s * 0.1); g.lineTo(tx - dx * s * 0.25, ty - dy * s * 0.25); g.fill(); }
    }
  } else if (w === 'bow') {
    const perp = wa + Math.PI / 2, r = s * 0.24;
    g.strokeStyle = ink; g.lineWidth = Math.max(2, s * 0.045);
    const bend = (act === 'draw' ? 0.6 + 0.4 * ease(k) : 0.6) * s * 0.12;
    const p1 = { x: hx + Math.cos(perp) * r, y: hy + Math.sin(perp) * r }, p2 = { x: hx - Math.cos(perp) * r, y: hy - Math.sin(perp) * r };
    const c = { x: hx + dx * bend * 1.6, y: hy + dy * bend * 1.6 };
    g.beginPath(); g.moveTo(p1.x, p1.y); g.quadraticCurveTo(c.x, c.y, p2.x, p2.y); g.stroke();
    g.strokeStyle = P.wood; g.lineWidth = Math.max(1, s * 0.028);
    g.beginPath(); g.moveTo(p1.x, p1.y); g.quadraticCurveTo(c.x, c.y, p2.x, p2.y); g.stroke();
    if (!(act === 'draw' || act === 'loose')) {
      g.strokeStyle = 'rgba(240,235,215,0.8)'; g.lineWidth = Math.max(0.6, s * 0.012);
      g.beginPath(); g.moveTo(p1.x, p1.y); g.lineTo(p2.x, p2.y); g.stroke();
    }
  } else if (w === 'crossbow') {
    g.strokeStyle = ink; g.lineWidth = Math.max(2, s * 0.05);
    g.beginPath(); g.moveTo(hx - dx * s * 0.12, hy - dy * s * 0.12); g.lineTo(hx + dx * s * 0.22, hy + dy * s * 0.22); g.stroke();
    g.strokeStyle = P.wood; g.lineWidth = Math.max(1, s * 0.032); g.stroke();
    const ex = hx + dx * s * 0.2, ey = hy + dy * s * 0.2;
    g.strokeStyle = P.steelD; g.lineWidth = Math.max(1, s * 0.025);
    g.beginPath(); g.moveTo(ex - dy * s * 0.12, ey + dx * s * 0.12); g.quadraticCurveTo(ex + dx * s * 0.04, ey + dy * s * 0.04, ex + dy * s * 0.12, ey - dx * s * 0.12); g.stroke();
  } else if (w === 'staff') {
    const L = s * 0.7;
    g.strokeStyle = ink; g.lineWidth = Math.max(2, s * 0.045);
    g.beginPath(); g.moveTo(hx - dx * s * 0.3, hy - dy * s * 0.3); g.lineTo(hx + dx * L * 0.6, hy + dy * L * 0.6); g.stroke();
    g.strokeStyle = P.wood; g.lineWidth = Math.max(1, s * 0.028); g.stroke();
    const tx = hx + dx * L * 0.6, ty = hy + dy * L * 0.6;
    g.save(); g.globalCompositeOperation = 'lighter';
    const r = s * (0.06 + 0.1 * ap.glow);
    const gr = g.createRadialGradient(tx, ty, 0, tx, ty, r * 3);
    gr.addColorStop(0, 'rgba(200,255,170,0.95)'); gr.addColorStop(0.4, 'rgba(110,230,90,0.5)'); gr.addColorStop(1, 'rgba(60,160,40,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(tx, ty, r * 3, 0, TAU); g.fill(); g.restore();
  }
}

// ------------------------------------------------------------------ beasts and riders
function horse(g, s, P, pose, o) {
  const walking = pose.walk != null, t = pose.t || 0;
  const ph = walking ? pose.walk * 1.15 : 0;
  const ink = P.ink, body = o.body, bodyD = shade(body, -0.35);
  const lw = Math.max(1.4, s * 0.075);
  const gallop = walking ? 1 : 0;
  const rise = walking ? Math.sin(ph * 2) * s * 0.03 : Math.sin(t * 1.8) * s * 0.005;
  const by = -s * 0.62 + rise;
  const L = s * 0.2;
  // far legs
  const legAt = (x, off, col) => {
    const a = gallop ? Math.sin(ph + off) * 0.7 : (off > 2 ? 0.08 : -0.05);
    const bend = gallop ? Math.max(0, Math.cos(ph + off)) * 0.9 : 0.05;
    leg2(g, x, by + s * 0.08, a, (x > 0 ? -1 : 1) * bend, L, lw, col, ink, ink);
  };
  legAt(-s * 0.22, 0.5, bodyD); legAt(s * 0.2, 3.6, bodyD);
  // tail
  g.strokeStyle = o.mane; g.lineWidth = lw * 1.4; g.lineCap = 'round';
  const tw = Math.sin(t * 5 + ph) * s * 0.05;
  g.beginPath(); g.moveTo(-s * 0.32, by - s * 0.03); g.quadraticCurveTo(-s * 0.48, by + s * 0.02 + tw, -s * 0.46, by + s * 0.2 + tw); g.stroke();
  // body
  g.fillStyle = body; g.strokeStyle = ink; g.lineWidth = 1.3;
  g.beginPath(); g.ellipse(0, by, s * 0.34, s * 0.14, 0, 0, TAU); g.fill(); g.stroke();
  // neck + head
  const nod = walking ? Math.sin(ph * 2) * 0.08 : Math.sin(t * 1.3) * 0.03;
  g.save(); g.translate(s * 0.24, by - s * 0.04); g.rotate(-0.15 + nod);
  g.beginPath(); g.moveTo(-s * 0.05, s * 0.05); g.lineTo(s * 0.06, -s * 0.24); g.lineTo(s * 0.13, -s * 0.27);
  g.lineTo(s * 0.27, -s * 0.15); g.lineTo(s * 0.24, -s * 0.1); g.lineTo(s * 0.12, -s * 0.13); g.lineTo(s * 0.1, s * 0.04); g.closePath();
  g.fill(); g.stroke();
  g.fillStyle = ink; g.beginPath(); g.arc(s * 0.13, -s * 0.2, Math.max(0.8, s * 0.014), 0, TAU); g.fill();
  g.fillStyle = o.mane; g.beginPath(); g.moveTo(-s * 0.04, 0); g.lineTo(s * 0.05, -s * 0.25); g.lineTo(s * 0.0, -s * 0.24); g.lineTo(-s * 0.09, -s * 0.02); g.fill();
  if (o.barded) { g.fillStyle = P.col; g.beginPath(); g.moveTo(s * 0.06, -s * 0.24); g.lineTo(s * 0.24, -s * 0.15); g.lineTo(s * 0.2, -s * 0.11); g.lineTo(s * 0.08, -s * 0.15); g.fill(); }
  g.restore();
  // near legs
  legAt(-s * 0.18, 2.1, body); legAt(s * 0.24, 5.2, body);
  // barding / saddle cloth
  if (o.barded) {
    g.fillStyle = P.col; g.strokeStyle = ink; g.lineWidth = 1;
    g.beginPath(); g.moveTo(-s * 0.34, by - s * 0.02); g.quadraticCurveTo(0, by - s * 0.2, s * 0.32, by - s * 0.04);
    g.lineTo(s * 0.3, by + s * 0.14); for (let i = 0; i <= 6; i++) g.lineTo(s * (0.3 - i * 0.107), by + s * (i % 2 ? 0.2 : 0.15)); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = P.acc; g.fillRect(-s * 0.3, by + s * 0.06, s * 0.6, s * 0.025);
  } else {
    g.fillStyle = P.col; g.strokeStyle = ink; g.lineWidth = 1;
    g.beginPath(); g.roundRect(-s * 0.1, by - s * 0.12, s * 0.2, s * 0.16, s * 0.02); g.fill(); g.stroke();
  }
  return { saddle: { x: s * 0.0, y: by - s * 0.12 } };
}

function wolf(g, s, P, pose) {
  const walking = pose.walk != null, t = pose.t || 0;
  const ph = walking ? pose.walk * 1.3 : 0;
  const ink = P.ink, body = '#8d9097', bodyD = '#5d6066';
  const lw = Math.max(1.4, s * 0.07);
  const by = -s * 0.42 + (walking ? Math.sin(ph * 2) * s * 0.04 : 0);
  const L = s * 0.14;
  const legAt = (x, off, col) => leg2(g, x, by + s * 0.06, walking ? Math.sin(ph + off) * 0.8 : 0, (x > 0 ? -1 : 1) * (walking ? Math.max(0, Math.cos(ph + off)) : 0.1), L, lw, col, ink, ink);
  legAt(-s * 0.2, 0.5, bodyD); legAt(s * 0.18, 3.6, bodyD);
  g.fillStyle = body; g.strokeStyle = ink; g.lineWidth = 1.2;
  g.beginPath(); g.ellipse(0, by, s * 0.3, s * 0.12, 0, 0, TAU); g.fill(); g.stroke();
  // bushy tail
  g.beginPath(); g.moveTo(-s * 0.27, by - s * 0.04); g.quadraticCurveTo(-s * 0.5, by - s * 0.14 + Math.sin(t * 4) * s * 0.04, -s * 0.52, by + s * 0.02); g.quadraticCurveTo(-s * 0.4, by + s * 0.02, -s * 0.27, by + s * 0.03); g.fill(); g.stroke();
  // head with snout and ears
  g.beginPath(); g.moveTo(s * 0.22, by - s * 0.06); g.lineTo(s * 0.32, by - s * 0.2); g.lineTo(s * 0.36, by - s * 0.3); g.lineTo(s * 0.4, by - s * 0.2);
  g.lineTo(s * 0.55, by - s * 0.14); g.lineTo(s * 0.53, by - s * 0.08); g.lineTo(s * 0.34, by + s * 0.02); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#ffd34a'; g.beginPath(); g.arc(s * 0.4, by - s * 0.16, Math.max(0.9, s * 0.018), 0, TAU); g.fill();
  legAt(-s * 0.16, 2.1, body); legAt(s * 0.22, 5.2, body);
  g.fillStyle = P.col; g.strokeStyle = ink; g.lineWidth = 1; g.beginPath(); g.roundRect(-s * 0.09, by - s * 0.11, s * 0.18, s * 0.12, s * 0.02); g.fill(); g.stroke();
  return { saddle: { x: 0, y: by - s * 0.1 } };
}

function rider(g, s, P, pose, saddle, kit) {
  g.save(); g.translate(saddle.x, saddle.y + s * 0.03);
  // a bent leg hanging over the flank
  limb(g, 0, -s * 0.0, s * 0.08, s * 0.12, Math.max(1.2, s * 0.065), P.steelD, P.ink);
  limb(g, s * 0.08, s * 0.12, s * 0.04, s * 0.24, Math.max(1.1, s * 0.06), P.steelD, P.ink);
  g.translate(0, s * 0.46 * 0.82);
  g.scale(0.82, 0.82);
  person(g, s, P, kit, { ...pose, walk: null }, { mounted: true });
  g.restore();
}

// ------------------------------------------------------------------ engines and monsters
function catapult(g, s, P, pose) {
  const ink = P.ink, t = pose.t || 0;
  const act = pose.act, k = pose.k ?? 0;
  let arm = -0.25;   // arm angle: cocked back low (negative), fires forward up
  if (act === 'loose') {
    if (k < 0.25) arm = lerp(-0.25, -0.45, ease(k / 0.25));
    else if (k < 0.4) arm = lerp(-0.45, 1.75, easeOut((k - 0.25) / 0.15));
    else arm = lerp(1.75, -0.25, ease((k - 0.4) / 0.6));
  }
  const W = s * 0.9;
  // crew (behind)
  const crewPose = { t, act: act === 'loose' && k < 0.3 ? 'block' : 'idle', k: 0, walk: pose.walk };
  g.save(); g.translate(-W * 0.62, 0); person(g, s * 0.75, P, KIT.militia, crewPose); g.restore();
  // frame
  g.strokeStyle = ink; g.lineWidth = Math.max(2, s * 0.08); g.lineCap = 'round';
  g.beginPath(); g.moveTo(-W * 0.45, -s * 0.18); g.lineTo(W * 0.45, -s * 0.18); g.stroke();
  g.strokeStyle = P.wood; g.lineWidth = Math.max(1.4, s * 0.055); g.stroke();
  for (const [a, b2] of [[[-W * 0.25, -s * 0.18], [0, -s * 0.62]], [[W * 0.25, -s * 0.18], [0, -s * 0.62]]]) {
    g.strokeStyle = ink; g.lineWidth = Math.max(2, s * 0.07); g.beginPath(); g.moveTo(...a); g.lineTo(...b2); g.stroke();
    g.strokeStyle = P.wood; g.lineWidth = Math.max(1.2, s * 0.045); g.stroke();
  }
  // arm
  g.save(); g.translate(0, -s * 0.5); g.rotate(-Math.PI + arm + 0.4);
  g.strokeStyle = ink; g.lineWidth = Math.max(2.4, s * 0.075); g.beginPath(); g.moveTo(-s * 0.12, 0); g.lineTo(s * 0.62, 0); g.stroke();
  g.strokeStyle = P.woodD; g.lineWidth = Math.max(1.4, s * 0.05); g.stroke();
  g.fillStyle = P.leatherD; g.beginPath(); g.arc(s * 0.62, 0, s * 0.07, 0, TAU); g.fill();
  if (!(act === 'loose' && k > 0.36 && k < 0.85)) { g.fillStyle = '#5c544c'; g.beginPath(); g.arc(s * 0.62, -s * 0.03, s * 0.06, 0, TAU); g.fill(); g.fillStyle = 'rgba(255,140,40,0.8)'; g.beginPath(); g.arc(s * 0.6, -s * 0.06, s * 0.03, 0, TAU); g.fill(); }
  g.fillStyle = '#4a4a4a'; g.fillRect(-s * 0.2, -s * 0.07, s * 0.12, s * 0.14);   // counterweight
  g.restore();
  // wheels
  for (const wx of [-W * 0.34, W * 0.34]) {
    const rot = (pose.walk || 0) * 0.6;
    g.fillStyle = P.woodD; g.strokeStyle = ink; g.lineWidth = 1.2;
    g.beginPath(); g.arc(wx, -s * 0.12, s * 0.12, 0, TAU); g.fill(); g.stroke();
    g.strokeStyle = P.wood; g.lineWidth = 1;
    for (let i = 0; i < 4; i++) { const a = rot + i * Math.PI / 4; g.beginPath(); g.moveTo(wx - Math.cos(a) * s * 0.1, -s * 0.12 - Math.sin(a) * s * 0.1); g.lineTo(wx + Math.cos(a) * s * 0.1, -s * 0.12 + Math.sin(a) * s * 0.1); g.stroke(); }
  }
  // house pennant on the frame
  g.fillStyle = P.col; g.beginPath(); g.moveTo(-W * 0.45, -s * 0.18); g.lineTo(-W * 0.45, -s * 0.5); g.lineTo(-W * 0.3 + Math.sin(t * 4) * s * 0.02, -s * 0.44); g.lineTo(-W * 0.45, -s * 0.38); g.fill();
}

function golem(g, s, P, pose) {
  const ink = P.ink, t = pose.t || 0, act = pose.act, k = pose.k ?? 0;
  const walking = pose.walk != null, ph = walking ? pose.walk * 0.7 : 0;
  const S = s * 1.45;
  const clay = '#9a7652', clayD = '#5e4430';
  const stomp = walking ? Math.abs(Math.sin(ph)) * S * 0.03 : 0;
  let punch = 0;
  if (act === 'swing' || act === 'thrust') punch = k < 0.4 ? -ease(k / 0.4) * 0.6 : k < 0.55 ? lerp(-0.6, 1.4, easeOut((k - 0.4) / 0.15)) : lerp(1.4, 0, ease((k - 0.55) / 0.45));
  g.fillStyle = clay; g.strokeStyle = ink; g.lineWidth = 1.5;
  for (const [x, o] of [[-0.12, 0], [0.1, Math.PI]]) { const lift = walking ? Math.max(0, Math.sin(ph + o)) * S * 0.05 : 0; g.fillStyle = clayD; g.beginPath(); g.roundRect(S * x - S * 0.06, -S * 0.3 - lift, S * 0.12, S * 0.3, S * 0.03); g.fill(); g.stroke(); }
  g.translate(0, -stomp);
  g.fillStyle = clay; g.beginPath(); g.roundRect(-S * 0.22, -S * 0.72, S * 0.44, S * 0.46, S * 0.08); g.fill(); g.stroke();
  // cracks with ember light
  g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = `rgba(255,170,60,${0.6 + 0.3 * Math.sin(t * 3)})`; g.lineWidth = Math.max(1, S * 0.012);
  g.beginPath(); g.moveTo(-S * 0.1, -S * 0.66); g.lineTo(-S * 0.03, -S * 0.52); g.lineTo(-S * 0.09, -S * 0.4); g.moveTo(S * 0.08, -S * 0.6); g.lineTo(S * 0.12, -S * 0.46); g.stroke(); g.restore();
  g.fillStyle = P.col; g.fillRect(-S * 0.2, -S * 0.5, S * 0.4, S * 0.05);   // a house sash
  // head
  g.fillStyle = clay; g.beginPath(); g.roundRect(-S * 0.1, -S * 0.88, S * 0.2, S * 0.17, S * 0.04); g.fill(); g.stroke();
  g.fillStyle = '#ffcf6a'; g.fillRect(S * 0.0, -S * 0.82, S * 0.04, S * 0.03); g.fillRect(S * 0.06, -S * 0.82, S * 0.03, S * 0.03);
  // arms
  const arm = (side, extra) => {
    g.save(); g.translate(side * S * 0.24, -S * 0.66); g.rotate(-0.15 * side + extra);
    g.fillStyle = side > 0 ? clay : clayD; g.beginPath(); g.roundRect(-S * 0.06, 0, S * 0.12, S * 0.36, S * 0.04); g.fill(); g.stroke();
    g.beginPath(); g.arc(0, S * 0.38, S * 0.075, 0, TAU); g.fill(); g.stroke(); g.restore();
  };
  arm(-1, walking ? Math.sin(ph) * 0.3 : 0);
  arm(1, -punch * 1.1 - (walking ? Math.sin(ph) * 0.3 : 0));
}

function wyvern(g, s, P, pose) {
  const ink = P.ink, t = pose.t || 0, act = pose.act, k = pose.k ?? 0;
  const S = s * 1.3;
  const flap = Math.sin(t * 7 + (pose.walk || 0)) ;
  let dive = 0;
  if (act === 'swing' || act === 'thrust') dive = Math.sin(clamp(k, 0, 1) * Math.PI);
  g.translate(dive * S * 0.25, -S * 0.55 + Math.sin(t * 3) * S * 0.04 + dive * S * 0.3);
  g.rotate(dive * 0.35);
  const green = '#3f7a52', greenD = '#26503a', mem = 'rgba(70,130,90,0.85)';
  // far wing
  g.fillStyle = greenD; g.strokeStyle = ink; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(-S * 0.05, -S * 0.05); g.lineTo(-S * 0.42, -S * (0.12 + flap * 0.2)); g.lineTo(-S * 0.1, -S * (0.2 + flap * 0.22)); g.closePath(); g.fill(); g.stroke();
  // tail
  g.strokeStyle = green; g.lineWidth = Math.max(2, S * 0.05);
  g.beginPath(); g.moveTo(-S * 0.25, 0); g.quadraticCurveTo(-S * 0.5, S * 0.05 + Math.sin(t * 4) * S * 0.05, -S * 0.62, -S * 0.08); g.stroke();
  g.fillStyle = green; g.beginPath(); g.moveTo(-S * 0.62, -S * 0.08); g.lineTo(-S * 0.7, -S * 0.15); g.lineTo(-S * 0.66, -S * 0.02); g.fill();
  // body
  g.fillStyle = green; g.strokeStyle = ink; g.lineWidth = 1.3;
  g.beginPath(); g.ellipse(0, 0, S * 0.27, S * 0.1, -0.08, 0, TAU); g.fill(); g.stroke();
  // neck and head
  g.beginPath(); g.moveTo(S * 0.18, -S * 0.04); g.quadraticCurveTo(S * 0.33, -S * 0.22, S * 0.42, -S * 0.2); g.lineTo(S * 0.56, -S * 0.14); g.lineTo(S * 0.42, -S * 0.1); g.quadraticCurveTo(S * 0.3, -S * 0.08, S * 0.22, S * 0.04); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#ffde5a'; g.beginPath(); g.arc(S * 0.44, -S * 0.17, Math.max(1, S * 0.014), 0, TAU); g.fill();
  // claws
  g.strokeStyle = ink; g.lineWidth = Math.max(1, S * 0.02);
  for (const x of [-0.06, 0.08]) { g.beginPath(); g.moveTo(S * x, S * 0.08); g.lineTo(S * (x + 0.04 + dive * 0.06), S * (0.18 + dive * 0.05)); g.stroke(); }
  // near wing with membrane
  g.fillStyle = mem; g.strokeStyle = ink;
  g.beginPath(); g.moveTo(-S * 0.02, -S * 0.06);
  g.lineTo(-S * 0.3, -S * (0.26 + flap * 0.26)); g.lineTo(-S * 0.62, -S * (0.18 + flap * 0.3)); g.lineTo(-S * 0.42, -S * (0.06 + flap * 0.12));
  g.lineTo(-S * 0.24, -S * (0.02 + flap * 0.06)); g.quadraticCurveTo(-S * 0.08, -S * 0.02, S * 0.08, -S * 0.04); g.closePath(); g.fill(); g.stroke();
  g.strokeStyle = 'rgba(20,40,28,0.6)'; g.lineWidth = 1;   // wing bones
  g.beginPath(); g.moveTo(-S * 0.02, -S * 0.06); g.lineTo(-S * 0.42, -S * (0.06 + flap * 0.12)); g.moveTo(-S * 0.3, -S * (0.26 + flap * 0.26)); g.lineTo(-S * 0.24, -S * (0.02 + flap * 0.06)); g.stroke();
  g.fillStyle = P.col; g.fillRect(-S * 0.06, -S * 0.1, S * 0.14, S * 0.04);
}

// ------------------------------------------------------------------ entry point
export function drawSoldier(g, type, x, y, s, P, facing, pose = {}) {
  const act = pose.act || 'idle', k = pose.k ?? 0;
  g.save();
  g.translate(x, y);
  if (act === 'fall') {   // topple backwards around the feet, sink and fade
    const e = easeOut(clamp(k * 1.6, 0, 1));
    g.translate(-facing * s * 0.12 * e, s * 0.05 * e);
    g.rotate(-facing * e * 1.45);
    g.globalAlpha *= clamp(1.6 - k * 1.6, 0, 1);
  }
  g.scale(facing, 1);
  const ghost = type === 'ghosts';
  if (ghost) { g.globalAlpha *= 0.78; g.shadowColor = '#bfe6ff'; g.shadowBlur = s * 0.25; }
  const flee = act === 'flee';
  const p2 = flee ? { ...pose, act: 'idle', run: true } : pose;
  switch (type) {
    case 'horse': case 'knights': case 'ghosts': {
      const o = type === 'knights' ? { body: '#5a4636', mane: '#241a14', barded: true }
        : type === 'ghosts' ? { body: '#cfe6f2', mane: '#9cc8e0', barded: false } : { body: '#8a5a36', mane: '#2e1e14', barded: false };
      const hp = ghost ? palette('#a9d8f0', '#e8f6ff') : P;
      const { saddle } = horse(g, s * 1.05, hp, p2, o);
      const kit = type === 'knights' ? { helm: 'plume', weapon: 'lance', armour: 'mail' }
        : type === 'ghosts' ? { helm: 'helm', weapon: 'sword', armour: 'mail', shield: 'round' } : { helm: 'nasal', weapon: 'sword', armour: 'leather' };
      rider(g, s, hp, { ...p2, act: act === 'thrust' && type !== 'knights' ? 'swing' : act === 'swing' && type === 'knights' ? 'thrust' : p2.act }, saddle, kit);
      break;
    }
    case 'wolfriders': {
      const { saddle } = wolf(g, s * 1.05, P, p2);
      rider(g, s * 0.9, P, p2, saddle, { helm: 'cowl', weapon: 'sword', armour: 'leather' });
      break;
    }
    case 'siege': catapult(g, s, P, p2); break;
    case 'golem': golem(g, s, P, p2); break;
    case 'wyvern': wyvern(g, s, P, p2); break;
    default: person(g, s, P, KIT[type] || KIT.footmen, p2);
  }
  g.restore();
}

// Where a figure's weapon/launch point roughly is (for arrows and spells), relative to feet.
export function launchPoint(type, s, facing) {
  if (type === 'siege') return { x: facing * s * 0.3, y: -s * 1.1 };
  if (MOUNTED.has(type)) return { x: facing * s * 0.35, y: -s * 1.05 };
  return { x: facing * s * 0.22, y: -s * 0.68 };
}

// Figures per unit by strength and type.
export function squadSize(type) {
  return { golem: 1, wyvern: 1, siege: 2, horse: 4, knights: 3, wolfriders: 4, ghosts: 3 }[type] || 6;
}
// Formation slots (cell units, x forward, y depth), front rank first.
const FORMS = {
  1: [[0, 0.08]],
  2: [[0.12, -0.02], [-0.16, 0.16]],
  3: [[0.18, -0.06], [-0.18, -0.06], [0, 0.18]],
  4: [[0.2, -0.1], [-0.16, -0.1], [0.2, 0.16], [-0.16, 0.16]],
  5: [[0.24, -0.1], [-0.02, -0.12], [-0.27, -0.08], [0.12, 0.17], [-0.16, 0.18]],
  6: [[0.26, -0.11], [0.0, -0.13], [-0.26, -0.11], [0.26, 0.16], [0.0, 0.14], [-0.26, 0.16]],
};
export function formation(n) { return FORMS[clamp(n, 1, 6)]; }
