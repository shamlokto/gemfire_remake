// Battle sound effects synthesised with WebAudio (no sample files). Original sounds.
// sfx.play(name, { volume }) — names: clash, arrows, hooves, catapult, spell, horn, rout, hit,
// gate, win, lose, click, wind. sfx.setVolume(0..1); sfx.muted = true to silence.

let ctx = null, master = null, noiseBuf = null;
let volume = 0.6;

function ensure() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; }
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

function env(g, t, a, peak, dcy, end = 0.0001) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(end, t + a + dcy);
}

function noise(t, dur, { type = 'bandpass', freq = 1000, q = 1, peak = 0.5, attack = 0.005, sweep = null } = {}) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
  const g = ctx.createGain(); env(g, t, attack, peak, dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5); src.stop(t + dur + attack + 0.05);
}

function tone(t, dur, { type = 'sine', freq = 440, to = null, peak = 0.3, attack = 0.01 } = {}) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain(); env(g, t, attack, peak, dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + attack + 0.05);
}

const SOUNDS = {
  clash(t) {           // metal on metal: bright noise bursts plus a ringing partial
    for (let i = 0; i < 3; i++) {
      const s = t + i * 0.09 + Math.random() * 0.03;
      noise(s, 0.12, { freq: 3200 + Math.random() * 1500, q: 6, peak: 0.45 });
      tone(s, 0.25, { type: 'triangle', freq: 1800 + Math.random() * 900, peak: 0.08 });
    }
    noise(t, 0.25, { type: 'lowpass', freq: 400, peak: 0.3 });
  },
  hit(t) { noise(t, 0.12, { type: 'lowpass', freq: 600, peak: 0.5 }); tone(t, 0.12, { freq: 120, to: 60, peak: 0.3 }); },
  arrows(t) {          // a volley: many short whistles
    for (let i = 0; i < 7; i++) {
      const s = t + i * 0.04 + Math.random() * 0.05;
      noise(s, 0.25, { freq: 2500, sweep: 900, q: 8, peak: 0.12 });
    }
    noise(t + 0.45, 0.15, { type: 'lowpass', freq: 700, peak: 0.25 });
  },
  hooves(t) {
    for (let i = 0; i < 8; i++) {
      const s = t + i * 0.11 + (i % 2) * 0.03;
      noise(s, 0.06, { type: 'lowpass', freq: 300, peak: 0.45 });
      tone(s, 0.06, { freq: 90, to: 50, peak: 0.2 });
    }
  },
  catapult(t) {
    noise(t, 0.3, { freq: 200, sweep: 80, q: 2, peak: 0.4 });                 // creak/thump
    noise(t + 0.15, 0.8, { freq: 1200, sweep: 300, q: 1.5, peak: 0.12 });      // whoosh
    tone(t + 0.9, 0.5, { freq: 80, to: 30, peak: 0.6 });                      // impact
    noise(t + 0.9, 0.6, { type: 'lowpass', freq: 500, peak: 0.5 });
  },
  spell(t) {
    for (let i = 0; i < 4; i++) tone(t + i * 0.07, 1.4, { type: 'sine', freq: 220 * (1 + i * 0.5), to: 660 * (1 + i * 0.25), peak: 0.07, attack: 0.3 });
    noise(t, 1.6, { freq: 600, sweep: 4000, q: 1, peak: 0.12, attack: 0.4 });
  },
  horn(t) {            // battle horn: two detuned saws through a lowpass
    for (const det of [0, 4]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(146.8 + det, t); o.frequency.setValueAtTime(196 + det, t + 0.5);
      o.frequency.linearRampToValueAtTime(196 + det, t + 1.6);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.12);
      g.gain.setValueAtTime(0.18, t + 1.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
      o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + 2);
    }
  },
  rout(t) { tone(t, 0.9, { type: 'sawtooth', freq: 300, to: 90, peak: 0.08 }); noise(t, 1, { type: 'lowpass', freq: 800, sweep: 200, peak: 0.2 }); },
  gate(t) { tone(t, 0.9, { freq: 70, to: 35, peak: 0.7 }); noise(t, 1.2, { type: 'lowpass', freq: 900, sweep: 150, peak: 0.6 }); },
  win(t) { [262, 330, 392, 523].forEach((f, i) => tone(t + i * 0.14, 0.7, { type: 'triangle', freq: f, peak: 0.15 })); },
  lose(t) { [392, 349, 311, 262].forEach((f, i) => tone(t + i * 0.2, 0.8, { type: 'triangle', freq: f, peak: 0.12 })); },
  click(t) { tone(t, 0.05, { type: 'square', freq: 900, peak: 0.04 }); },
  wind(t) { noise(t, 2.5, { freq: 500, sweep: 900, q: 0.7, peak: 0.08, attack: 0.8 }); },
};

export const sfx = {
  muted: false,
  play(name, { delay = 0 } = {}) {
    if (this.muted || !SOUNDS[name]) return;
    try { if (!ensure()) return; SOUNDS[name](ctx.currentTime + delay + 0.01); } catch { /* audio unavailable */ }
  },
  setVolume(v) { volume = v; if (master) master.gain.value = v; },
  unlock() { try { ensure(); } catch { /* ignore */ } },
};
