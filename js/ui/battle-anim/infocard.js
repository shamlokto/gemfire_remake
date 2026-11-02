// Pre-fight info screen shown before a clash (skippable): both sides' unit, leader, soldiers,
// training, terrain and the expected outcome, sliding in from either side.
import { txt } from './clashfx.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOut = t => 1 - Math.pow(1 - t, 3);

// d = { sides: { attacker: { house, col, unit, leader, title, soldiers, training, terrain, def }, defender: {...} },
//       expected: { kill, counter }, caption, drawPortrait(cg, side, x, y, w, h, flip), drawCrest(cg, side, x, y, s) }
export function drawInfoCard(cg, W2, H2, k, d) {
  const open = k < 0.12 ? easeOut(k / 0.12) : k > 0.9 ? easeOut((1 - k) / 0.1) : 1;
  cg.fillStyle = `rgba(4,3,8,${0.62 * open})`; cg.fillRect(0, 0, W2, H2);
  const pw = Math.min(W2 * 0.94, 760), ph = Math.min(H2 * 0.7, pw * 0.56);
  const x0 = (W2 - pw) / 2, y0 = (H2 - ph) / 2;
  cg.save();
  cg.globalAlpha = open;
  const gr = cg.createLinearGradient(0, y0, 0, y0 + ph);
  gr.addColorStop(0, 'rgba(34,26,38,0.96)'); gr.addColorStop(1, 'rgba(16,12,20,0.96)');
  cg.fillStyle = gr; cg.beginPath(); cg.roundRect(x0, y0, pw, ph, 10); cg.fill();
  cg.strokeStyle = '#d8b05a'; cg.lineWidth = 1.5; cg.stroke();
  const fs = Math.max(11, ph * 0.05);
  txt(cg, d.caption, W2 / 2, y0 + fs * 1.8, fs * 1.3, '#f3d38a', 'center', 900);
  const col = (side, left) => {
    const s = d.sides[side];
    const slide = easeOut(clamp((k - (left ? 0.04 : 0.08)) / 0.16, 0, 1));
    const cx = left ? x0 + pw * 0.25 - (1 - slide) * pw * 0.3 : x0 + pw * 0.75 + (1 - slide) * pw * 0.3;
    const pw2 = ph * 0.3, ph2 = pw2 * 1.2;
    const py = y0 + fs * 3;
    d.drawPortrait(cg, side, cx - pw2 / 2, py, pw2, ph2, !left);
    d.drawCrest(cg, side, cx + (left ? -1 : 1) * (pw2 * 0.5 + fs * 1.6), py + fs * 1.2, fs * 2.4);
    let y = py + ph2 + fs * 1.6;
    txt(cg, s.house, cx, y, fs * 0.95, s.col, 'center', 700); y += fs * 1.25;
    txt(cg, s.unit, cx, y, fs * 1.05, '#f5ead0', 'center', 700); y += fs * 1.15;
    txt(cg, s.leader, cx, y, fs * 0.8, s.noLeader ? '#a89a80' : '#e0d2b4', 'center', 500, 'EB Garamond'); y += fs * 1.35;
    const row = (label, val) => {
      txt(cg, label, cx - pw * 0.12, y, fs * 0.72, '#b8a888', 'left', 500, 'EB Garamond');
      txt(cg, String(val), cx + pw * 0.12, y, fs * 0.82, '#ffffff', 'right', 700); y += fs * 1.05;
    };
    row('Soldiers', s.soldiers); row('Training', s.training); row('Terrain', s.terrain);
  };
  col('attacker', true); col('defender', false);
  const vk = clamp((k - 0.12) / 0.12, 0, 1);
  txt(cg, 'VS', W2 / 2, y0 + ph * 0.45, fs * (2.6 - vk * 0.6), `rgba(243,211,138,${vk})`, 'center', 900);
  if (d.expected) {
    const ek = clamp((k - 0.22) / 0.12, 0, 1);
    cg.globalAlpha = open * ek;
    const e = d.expected;
    const line = e.ranged ? `Expected: about ${e.kill} fall` : `Expected: about ${e.kill} fall, ${e.counter} in return`;
    txt(cg, line, W2 / 2, y0 + ph - fs * 1.1, fs * 0.85, '#f0e2c0', 'center', 500, 'EB Garamond');
  }
  cg.restore();
}
