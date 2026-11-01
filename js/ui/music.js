// WebAudio sequencer + small orchestra of synth instruments for js/ui/tracks.js.
// compileTrack() is pure (runs in node for tests); the player needs a browser AudioContext.

const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function pitchToMidi(p) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(p);
  if (!m) throw new Error('bad pitch ' + p);
  return 12 * (Number(m[3]) + 1) + NOTE_INDEX[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
const midiToFreq = m => 440 * Math.pow(2, (m - 69) / 12);

const QUALITY = {
  '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11],
  sus4: [0, 5, 7], sus2: [0, 2, 7], dim: [0, 3, 6], aug: [0, 4, 8], add9: [0, 4, 7, 14], m7b5: [0, 3, 6, 10],
};

export function parseChord(sym) {
  const m = /^([A-G])(#|b)?([a-z0-9]*)(?:\/([A-G](?:#|b)?))?$/.exec(sym);
  if (!m || !(m[3] in QUALITY)) throw new Error('bad chord ' + sym);
  const root = (NOTE_INDEX[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  let bass = root;
  if (m[4]) bass = (NOTE_INDEX[m[4][0]] + (m[4][1] === '#' ? 1 : m[4][1] === 'b' ? -1 : 0) + 12) % 12;
  return { root, bass, ivals: QUALITY[m[3]] };
}

// Expand "(a b)*3" groups, strip bar lines, return [token, beats] pairs.
export function tokenize(str) {
  let s = str.replace(/\|/g, ' ');
  const re = /\(([^()]*)\)\*(\d+)/;
  let m;
  while ((m = re.exec(s))) s = s.slice(0, m.index) + Array(Number(m[2])).fill(m[1]).join(' ') + s.slice(m.index + m[0].length);
  return s.trim().split(/\s+/).filter(Boolean).map(t => {
    const i = t.lastIndexOf(':');
    if (i < 0) throw new Error('token without duration: ' + t);
    const d = Number(t.slice(i + 1));
    if (!(d > 0)) throw new Error('bad duration: ' + t);
    return [t.slice(0, i), d];
  });
}

const sum = arr => arr.reduce((a, [, d]) => a + d, 0);

// Chord tones as midi numbers near a base octave.
function chordNotes(ch, oct, spread = 1) {
  const base = 12 * (oct + 1) + ch.root;
  const out = [];
  for (let o = 0; o < spread; o++) for (const iv of ch.ivals) out.push(base + iv + 12 * o);
  return out;
}

function genStyle(style, chords, oct, beatsPerBar) {
  const ev = [];
  let t = 0;
  for (const [ch, dur] of chords) {
    const add = (at, len, midis, vel = 1) => { if (at < dur - 1e-6) ev.push({ t: t + at, d: Math.min(len, dur - at), m: midis, v: vel }); };
    const bassMidi = 12 * ((oct ?? 2) + 1) + ch.bass;
    switch (style) {
      case 'pad': add(0, dur, chordNotes(ch, oct ?? 3).map((m, i) => (i === 0 ? m + 12 : m)), 1); break;
      case 'arp4': case 'arp8': case 'arp16': case 'arp3': {
        const step = { arp4: 1, arp8: 0.5, arp16: 0.25, arp3: 1 / 3 }[style];
        const up = chordNotes(ch, oct ?? 4, 2);
        const seq = up.concat(up.slice(1, -1).reverse());
        let i = 0;
        for (let a = 0; a < dur - 1e-6; a += step) add(a, step * 1.8, [seq[i++ % seq.length]], i % 4 === 1 ? 1 : 0.8);
        break;
      }
      case 'stab8': case 'stab4': {
        const step = style === 'stab8' ? 0.5 : 1;
        const n = chordNotes(ch, oct ?? 4);
        let i = 0;
        for (let a = 0; a < dur - 1e-6; a += step, i++) add(a, step * 0.45, n, i % 2 ? 0.65 : 1);
        break;
      }
      case 'waltz': {
        const n = chordNotes(ch, (oct ?? 2) + 1);
        for (let a = 0; a < dur - 1e-6; a += 3) { add(a, 1, [bassMidi]); add(a + 1, 0.8, n, 0.6); add(a + 2, 0.8, n, 0.6); }
        break;
      }
      case 'bass': for (let a = 0; a < dur - 1e-6; a += 2) add(a, 1.9, [bassMidi]); break;
      case 'bass4': for (let a = 0; a < dur - 1e-6; a += 1) add(a, 0.9, [bassMidi], a % 2 ? 0.75 : 1); break;
      case 'bass8': {
        let i = 0;
        for (let a = 0; a < dur - 1e-6; a += 0.5, i++) add(a, 0.4, [bassMidi + (i % 4 === 3 ? 12 : 0)], i % 2 ? 0.7 : 1);
        break;
      }
      case 'rootfifth': {
        const fifth = bassMidi + (ch.ivals.includes(6) ? 6 : 7);
        for (let a = 0; a < dur - 1e-6; a += 2) add(a, 1.8, [(a / 2) % 2 ? fifth - 12 : bassMidi]);
        break;
      }
      case 'timp': {
        const r = 12 * ((oct ?? 2) + 1) + ch.root;
        const lo = r > 43 ? r - 12 : r;
        add(0, 1, [lo], 1);
        if (dur >= 4) add(2, 1, [lo - 5], 0.6);
        break;
      }
      default: throw new Error('unknown style ' + style);
    }
    t += dur;
  }
  // Rolls on the last bar of every 8 bars for timp.
  if (style === 'timp') {
    const total = t, bar = beatsPerBar;
    for (let b = 8 * bar; b <= total + 1e-6; b += 8 * bar) {
      const start = b - bar;
      for (let i = 0; i < ev.length; i++) if (ev[i].t >= start - 1e-6 && ev[i].t < b - 1e-6) { ev.splice(i, 1); i--; }
      const ch = chordsAt(chords, start);
      const r = 12 * ((oct ?? 2) + 1) + ch.root;
      const lo = r > 43 ? r - 12 : r;
      for (let a = 0; a < bar; a += 0.125) ev.push({ t: start + a, d: 0.2, m: [lo], v: 0.35 + 0.65 * (a / bar) });
    }
  }
  return ev;
}

function chordsAt(chords, at) {
  let t = 0;
  for (const [ch, d] of chords) { if (at < t + d - 1e-6) return ch; t += d; }
  return chords[chords.length - 1][0];
}

// Compile a track into { length (beats), bpm, loop, parts: [{ inst, vol, events: [{t,d,m:[midi],v}] }] }.
// Throws with a precise message if any part's length differs from the chords.
export function compileTrack(track, name = '?') {
  const chordToks = tokenize(track.chords);
  const chords = chordToks.map(([sym, d]) => [parseChord(sym), d]);
  const length = sum(chordToks);
  const parts = track.voices.map((v, i) => {
    let events;
    if (v.notes) {
      const toks = tokenize(v.notes);
      const len = sum(toks);
      if (Math.abs(len - length) > 0.02) throw new Error(`${name} voice ${i} (${v.inst}): ${len} beats, chords have ${length}`);
      events = [];
      let t = 0;
      for (const [p, d] of toks) {
        if (p !== 'r') {
          if (p === 'x' || p === 'X') events.push({ t, d, m: [60], v: p === 'X' ? 1 : 0.6 });
          else events.push({ t, d, m: p.split('+').map(pitchToMidi), v: 1 });
        }
        t += d;
      }
    } else {
      events = genStyle(v.style, chords, v.oct, track.beats || 4);
    }
    return { inst: v.inst, vol: v.vol ?? 0.3, events: events.sort((a, b) => a.t - b.t) };
  });
  return { name, length, bpm: track.bpm, loop: track.loop !== false, parts };
}

// ======================================================================== player (browser)

export class MusicPlayer {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.out = out;               // music bus (GainNode)
    this.current = null;          // { name, comp, gain, start, nextIdx[], loopN }
    this.compiled = {};
    this.noise = makeNoise(ctx);
    this.pulse = makePulseWave(ctx, 0.25);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx, 2.4, 2.2);
    this.wet = ctx.createGain(); this.wet.gain.value = 0.28;
    this.reverb.connect(this.wet).connect(out);
    this.timer = setInterval(() => this.tick(), 30);
  }

  comp(name, tracks) {
    if (!this.compiled[name]) this.compiled[name] = compileTrack(tracks[name], name);
    return this.compiled[name];
  }

  // Start a track (crossfading from the current one). Returns the play handle.
  play(name, tracks, { fade = 1.6, volume = 1, onEnd } = {}) {
    const ctx = this.ctx;
    const comp = this.comp(name, tracks);
    const gain = ctx.createGain();
    gain.connect(this.out);
    gain.connect(this.reverb);
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + Math.max(0.05, fade));
    const h = { name, comp, gain, start: now + 0.08, idx: comp.parts.map(() => 0), loopN: 0, done: false, onEnd, volume };
    return h;
  }

  setCurrent(h, fade = 1.6) {
    if (this.current) this.fadeOut(this.current, fade);
    this.current = h;
  }

  fadeOut(h, fade = 1.2) {
    const now = this.ctx.currentTime;
    const g = h.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(0.0001, g.value), now);
    g.exponentialRampToValueAtTime(0.0001, now + fade);
    h.done = true;
    setTimeout(() => { try { h.gain.disconnect(); } catch { /* gone */ } }, (fade + 0.5) * 1000);
  }

  tick() {
    const hs = [this.current, ...(this.stings || [])].filter(Boolean);
    for (const h of hs) this.schedule(h);
    if (this.stings) this.stings = this.stings.filter(h => !h.finished);
  }

  schedule(h) {
    if (h.done || h.finished) return;
    const ctx = this.ctx;
    const spb = 60 / h.comp.bpm;
    const ahead = ctx.currentTime + 0.25;
    const L = h.comp.length;
    for (;;) {
      let progressed = false;
      const base = h.start + h.loopN * L * spb;
      let allDone = true;
      h.comp.parts.forEach((p, i) => {
        while (h.idx[i] < p.events.length) {
          const e = p.events[h.idx[i]];
          const at = base + e.t * spb;
          if (at > ahead) { allDone = false; return; }
          if (at >= ctx.currentTime - 0.05) this.note(p.inst, at, e.d * spb, e.m, e.v * p.vol, h.gain);
          h.idx[i]++;
          progressed = true;
        }
      });
      const loopEnd = base + L * spb;
      if (allDone && h.comp.parts.every((p, i) => h.idx[i] >= p.events.length)) {
        if (h.comp.loop) {
          if (loopEnd - ahead < 0.25) { h.loopN++; h.idx = h.comp.parts.map(() => 0); continue; }
        } else if (!h.finished && ctx.currentTime > loopEnd + 2.5) {
          h.finished = true;
          if (h.onEnd) h.onEnd();
          setTimeout(() => { try { h.gain.disconnect(); } catch { /* gone */ } }, 500);
        }
      }
      if (!progressed) break;
    }
  }

  // ------------------------------------------------------------- instruments
  note(inst, t, dur, midis, vel, dest) {
    const fn = INSTRUMENTS[inst] || INSTRUMENTS.lead;
    for (const m of midis) fn(this, t, dur, m, vel / Math.sqrt(midis.length * 0.8 + 0.2), dest);
  }
}

function env(g, t, a, peak, d, sus, rel, end) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.setTargetAtTime(peak * sus, t + a, d);
  g.gain.setValueAtTime(peak * sus, Math.max(t + a, end));
  g.gain.setTargetAtTime(0.0001, Math.max(t + a, end), rel / 3);
}

function osc(P, type, freq, t, stop, detune = 0) {
  const o = P.ctx.createOscillator();
  if (type === 'pulse') o.setPeriodicWave(P.pulse); else o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.detune.value = detune;
  o.start(t);
  o.stop(stop);
  return o;
}

function vibrato(P, o, t, depth, rate = 5.5, delay = 0.25) {
  const lfo = P.ctx.createOscillator();
  const lg = P.ctx.createGain();
  lfo.frequency.value = rate;
  lg.gain.setValueAtTime(0, t);
  lg.gain.linearRampToValueAtTime(depth, t + delay + 0.3);
  lfo.connect(lg).connect(o.detune);
  lfo.start(t);
  return lfo;
}

const INSTRUMENTS = {
  // warm square/pulse lead with delayed vibrato
  lead(P, t, dur, m, vel, dest) {
    const ctx = P.ctx, f = midiToFreq(m), end = t + dur, stop = end + 0.4;
    const o = osc(P, 'pulse', f, t, stop);
    const lfo = vibrato(P, o, t, 14, 5.6, 0.2); lfo.stop(stop);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; lp.Q.value = 0.5;
    const g = ctx.createGain();
    env(g, t, 0.015, 0.22 * vel, 0.25, 0.75, 0.12, end - 0.02);
    o.connect(lp).connect(g).connect(dest);
  },
  // bright brass: saw through a filter envelope
  brass(P, t, dur, m, vel, dest) {
    const ctx = P.ctx, f = midiToFreq(m), end = t + dur, stop = end + 0.5;
    const o1 = osc(P, 'sawtooth', f, t, stop, -6), o2 = osc(P, 'sawtooth', f, t, stop, 6);
    const lfo = vibrato(P, o1, t, 10, 5.2, 0.35); lfo.stop(stop);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(f * 1.5, t);
    lp.frequency.linearRampToValueAtTime(Math.min(6000, f * 7), t + 0.06);
    lp.frequency.setTargetAtTime(f * 3.5, t + 0.08, 0.3);
    const g = ctx.createGain();
    env(g, t, 0.04, 0.16 * vel, 0.3, 0.8, 0.15, end - 0.03);
    o1.connect(lp); o2.connect(lp); lp.connect(g).connect(dest);
  },
  // soft horn: triangle + filtered square
  horn(P, t, dur, m, vel, dest) {
    const ctx = P.ctx, f = midiToFreq(m), end = t + dur, stop = end + 0.6;
    const o1 = osc(P, 'triangle', f, t, stop), o2 = osc(P, 'square', f, t, stop, 4);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(2200, f * 4); lp.Q.value = 0.3;
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    const g = ctx.createGain();
    env(g, t, 0.08, 0.2 * vel, 0.4, 0.85, 0.25, end - 0.03);
    o1.connect(lp); o2.connect(g2).connect(lp); lp.connect(g).connect(dest);
  },
  flute(P, t, dur, m, vel, dest) {
    const ctx = P.ctx, f = midiToFreq(m), end = t + dur, stop = end + 0.5;
    const o = osc(P, 'triangle', f, t, stop);
    const lfo = vibrato(P, o, t, 12, 5, 0.3); lfo.stop(stop);
    const breath = ctx.createBufferSource(); breath.buffer = P.noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2; bp.Q.value = 6;
    const bg = ctx.createGain(); bg.gain.setValueAtTime(0.03 * vel, t); bg.gain.setTargetAtTime(0.008 * vel, t + 0.05, 0.1);
    breath.connect(bp).connect(bg).connect(dest); breath.start(t); breath.stop(stop);
    const g = ctx.createGain();
    env(g, t, 0.06, 0.3 * vel, 0.3, 0.8, 0.18, end - 0.03);
    o.connect(g).connect(dest);
  },
  bell(P, t, dur, m, vel, dest) {
    const ctx = P.ctx, f = midiToFreq(m), stop = t + Math.max(dur, 2.5);
    for (const [ratio, amp, dec] of [[1, 0.25, 1.4], [2.76, 0.08, 0.5], [5.4, 0.04, 0.25], [2, 0.06, 0.9]]) {
      const o = osc(P, 'sine', f * ratio, t, stop);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(amp * vel, t + 0.005);
      g.gain.setTargetAtTime(0.0001, t + 0.01, dec);
      o.connect(g).connect(dest);
    }
  },
  // string section: detuned saws through a lowpass, bowed attack
  strings(P, t, dur, m, vel, dest) {
    const ctx = P.ctx, f = midiToFreq(m), end = t + dur, short = dur < 0.3, stop = end + (short ? 0.2 : 0.8);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = short ? 2400 : 1800; lp.Q.value = 0.4;
    const g = ctx.createGain();
    if (short) env(g, t, 0.008, 0.1 * vel, 0.08, 0.5, 0.06, end);
    else env(g, t, 0.18, 0.09 * vel, 0.5, 0.9, 0.5, end);
    for (const d of [-9, 0, 8]) { const o = osc(P, 'sawtooth', f, t, stop, d); o.connect(lp); }
    lp.connect(g).connect(dest);
  },
  pad(P, t, dur, m, vel, dest) {
    const ctx = P.ctx, f = midiToFreq(m), end = t + dur, stop = end + 1.2;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.6;
    lp.frequency.setValueAtTime(700, t); lp.frequency.linearRampToValueAtTime(1300, t + Math.min(dur, 2));
    const g = ctx.createGain();
    env(g, t, Math.min(0.5, dur * 0.3), 0.06 * vel, 0.8, 0.9, 0.9, end);
    for (const d of [-12, 11]) { const o = osc(P, 'sawtooth', f, t, stop, d); o.connect(lp); }
    lp.connect(g).connect(dest);
  },
  harp(P, t, dur, m, vel, dest) {
    const ctx = P.ctx, f = midiToFreq(m), stop = t + 1.6;
    const o = osc(P, 'triangle', f, t, stop), o2 = osc(P, 'sine', f * 2, t, stop);
    const g = ctx.createGain(), g2 = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.22 * vel, t + 0.004); g.gain.setTargetAtTime(0.0001, t + 0.01, 0.35);
    g2.gain.setValueAtTime(0.06 * vel, t); g2.gain.setTargetAtTime(0.0001, t, 0.08);
    o.connect(g).connect(dest); o2.connect(g2).connect(dest);
  },
  bass(P, t, dur, m, vel, dest) {
    const ctx = P.ctx, f = midiToFreq(m), end = t + dur, stop = end + 0.3;
    const o = osc(P, 'triangle', f, t, stop), o2 = osc(P, 'square', f, t, stop);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t); lp.frequency.setTargetAtTime(300, t, 0.08);
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    const g = ctx.createGain();
    env(g, t, 0.006, 0.42 * vel, 0.25, 0.65, 0.08, end - 0.02);
    o.connect(lp); o2.connect(g2).connect(lp); lp.connect(g).connect(dest);
  },
  cello(P, t, dur, m, vel, dest) {
    const ctx = P.ctx, f = midiToFreq(m), end = t + dur, stop = end + 0.6;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.7;
    const g = ctx.createGain();
    env(g, t, dur < 0.5 ? 0.01 : 0.07, 0.2 * vel, 0.3, 0.8, 0.2, end - 0.02);
    for (const d of [-5, 5]) { const o = osc(P, 'sawtooth', f, t, stop, d); o.connect(lp); }
    lp.connect(g).connect(dest);
  },
  timp(P, t, dur, m, vel, dest) {
    const ctx = P.ctx, f = midiToFreq(m), stop = t + 1.8;
    const o = osc(P, 'sine', f * 1.5, t, stop);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.7 * vel, t + 0.005); g.gain.setTargetAtTime(0.0001, t + 0.01, 0.4);
    o.connect(g).connect(dest);
    const n = ctx.createBufferSource(); n.buffer = P.noise;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.3 * vel, t); ng.gain.setTargetAtTime(0.0001, t, 0.05);
    n.connect(lp).connect(ng).connect(dest); n.start(t); n.stop(t + 0.4);
  },
  snare(P, t, dur, m, vel, dest) {
    const ctx = P.ctx;
    const n = ctx.createBufferSource(); n.buffer = P.noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.5 * vel, t); g.gain.setTargetAtTime(0.0001, t, 0.06);
    n.connect(bp).connect(g).connect(dest); n.start(t, Math.random()); n.stop(t + 0.3);
    const o = osc(P, 'triangle', 190, t, t + 0.12);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.25 * vel, t); og.gain.setTargetAtTime(0.0001, t, 0.03);
    o.connect(og).connect(dest);
  },
  kick(P, t, dur, m, vel, dest) {
    const ctx = P.ctx;
    const o = osc(P, 'sine', 120, t, t + 0.4);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.8 * vel, t); g.gain.setTargetAtTime(0.0001, t + 0.02, 0.09);
    o.connect(g).connect(dest);
  },
  cymbal(P, t, dur, m, vel, dest) {
    const ctx = P.ctx;
    const n = ctx.createBufferSource(); n.buffer = P.noise; n.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.25 * vel, t + 0.01); g.gain.setTargetAtTime(0.0001, t + 0.02, 0.9);
    n.connect(hp).connect(g).connect(dest); n.start(t); n.stop(t + 4);
  },
};
export const INSTRUMENT_NAMES = Object.keys(INSTRUMENTS);

export function makeNoise(ctx, seconds = 2) {
  const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function makePulseWave(ctx, duty) {
  const n = 40, re = new Float32Array(n), im = new Float32Array(n);
  for (let k = 1; k < n; k++) im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty) * 0.9;
  return ctx.createPeriodicWave(re, im);
}

function makeImpulse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return b;
}
