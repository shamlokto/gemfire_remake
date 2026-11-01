// Audio facade: music (js/ui/music.js + tracks.js) and synthesized sound effects.
// Audio starts only after the first user gesture (browsers require it); calls made before
// that are remembered and applied on unlock.
//
//   playMusic('battle_attack')        crossfade to a looping track (or replay-safe if same)
//   playSting('summon')               one-shot over the music (music ducks while it plays)
//   stopMusic()
//   sfx('click' | 'hover' | 'chime' | 'coin' | 'march' | 'battle' | 'hit' | 'arrow' |
//       'spell' | 'error' | 'victory' | 'page')
//   setMusicVolume(0..1), setSfxVolume(0..1), setMuted(bool), getAudioSettings()
//   musicForSeason(month) -> track id

import { TRACKS, SEASON_TRACK } from './tracks.js';
import { MusicPlayer, makeNoise } from './music.js';

const KEY = 'lanternfall.audio';
const settings = { music: 0.6, sfx: 0.7, muted: false };
try { Object.assign(settings, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* storage blocked */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ } };

let ctx = null, master, musicBus, sfxBus, player, noise;
let wanted = null;            // track id requested before unlock
let unlocked = false;

function build() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
  master = ctx.createGain();
  master.connect(comp).connect(ctx.destination);
  musicBus = ctx.createGain(); musicBus.connect(master);
  sfxBus = ctx.createGain(); sfxBus.connect(master);
  noise = makeNoise(ctx, 1);
  player = new MusicPlayer(ctx, musicBus);
  applyVolumes();
  return true;
}

function applyVolumes() {
  if (!ctx) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(settings.muted ? 0 : 1, t, 0.05);
  musicBus.gain.setTargetAtTime(settings.music * settings.music * 0.9, t, 0.05);
  sfxBus.gain.setTargetAtTime(settings.sfx * settings.sfx, t, 0.05);
}

export function unlockAudio() {
  if (unlocked) return;
  if (!ctx && !build()) return;
  unlocked = true;
  if (ctx.state === 'suspended') ctx.resume();
  if (wanted) { const w = wanted; wanted = null; playMusic(w); }
}

// Install the first-gesture listener once.
export function initAudio() {
  const go = () => { unlockAudio(); window.removeEventListener('pointerdown', go, true); window.removeEventListener('keydown', go, true); };
  window.addEventListener('pointerdown', go, true);
  window.addEventListener('keydown', go, true);
}

let currentName = null;
export function playMusic(name, { fade = 1.8 } = {}) {
  if (!TRACKS[name]) { console.warn('no track', name); return; }
  if (!unlocked) { wanted = name; return; }
  if (currentName === name && player.current && !player.current.done) return;
  currentName = name;
  const h = player.play(name, TRACKS, { fade, onEnd: () => { if (currentName === name) currentName = null; } });
  player.setCurrent(h, fade);
}

export function stopMusic(fade = 1.2) {
  wanted = null;
  currentName = null;
  if (player && player.current) { player.fadeOut(player.current, fade); player.current = null; }
}

export function currentMusic() { return currentName || wanted; }

// One-shot sting over the music, ducking it meanwhile.
export function playSting(name) {
  if (!TRACKS[name] || !unlocked) return;
  const comp = player.comp(name, TRACKS);
  const secs = comp.length * 60 / comp.bpm;
  const cur = player.current;
  if (cur && !cur.done) {
    const g = cur.gain.gain, t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.0001, g.value), t);
    g.linearRampToValueAtTime(0.25 * cur.volume, t + 0.15);
    g.setValueAtTime(0.25 * cur.volume, t + secs);
    g.linearRampToValueAtTime(cur.volume, t + secs + 1.2);
  }
  const h = player.play(name, TRACKS, { fade: 0.02 });
  player.stings = (player.stings || []).concat(h);
}

export function musicForSeason(month) { return SEASON_TRACK[Math.floor(month / 3) % 4]; }

export function setMusicVolume(v) { settings.music = clamp01(v); applyVolumes(); save(); }
export function setSfxVolume(v) { settings.sfx = clamp01(v); applyVolumes(); save(); }
export function setMuted(m) { settings.muted = !!m; applyVolumes(); save(); }
export function getAudioSettings() { return { ...settings }; }
const clamp01 = v => Math.max(0, Math.min(1, Number(v) || 0));

// ------------------------------------------------------------------ sound effects
function tone(type, f0, f1, t, dur, vol, dest = sfxBus) {
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.05);
}
function burst(t, dur, vol, type, freq, q = 1) {
  const n = ctx.createBufferSource(); n.buffer = noise;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(f).connect(g).connect(sfxBus); n.start(t, Math.random() * 0.5); n.stop(t + dur + 0.05);
}

const SFX = {
  click: t => { tone('triangle', 880, 660, t, 0.06, 0.12); },
  hover: t => { tone('sine', 1320, 1320, t, 0.03, 0.03); },
  page: t => { burst(t, 0.12, 0.08, 'bandpass', 3000, 0.6); },
  error: t => { tone('square', 220, 180, t, 0.12, 0.06); tone('square', 180, 150, t + 0.1, 0.16, 0.06); },
  coin: t => { tone('square', 1568, 1568, t, 0.06, 0.05); tone('square', 2093, 2093, t + 0.06, 0.2, 0.05); },
  chime: t => { [784, 988, 1175, 1568].forEach((f, i) => tone('sine', f, f, t + i * 0.09, 1.2, 0.08)); },
  march: t => { for (let i = 0; i < 4; i++) burst(t + i * 0.16, 0.08, 0.18, 'lowpass', 300); },
  battle: t => { tone('sawtooth', 110, 55, t, 0.6, 0.12); burst(t, 0.5, 0.2, 'lowpass', 400); [392, 523, 659].forEach((f, i) => tone('sawtooth', f, f, t + 0.1 + i * 0.12, 0.4, 0.05)); },
  hit: t => { burst(t, 0.15, 0.3, 'bandpass', 1200, 0.8); tone('triangle', 160, 70, t, 0.12, 0.15); },
  arrow: t => { burst(t, 0.25, 0.12, 'highpass', 3000); tone('sine', 1800, 500, t, 0.25, 0.03); },
  spell: t => { for (let i = 0; i < 6; i++) tone('sine', 600 + i * 220, 1200 + i * 300, t + i * 0.05, 0.6, 0.04); burst(t, 1, 0.08, 'bandpass', 5000, 2); },
  victory: t => { [523, 659, 784, 1047].forEach((f, i) => tone('square', f, f, t + i * 0.12, 0.5, 0.06)); },
};

export function sfx(name) {
  if (!unlocked || !ctx || !SFX[name]) return;
  SFX[name](ctx.currentTime + 0.01);
}
