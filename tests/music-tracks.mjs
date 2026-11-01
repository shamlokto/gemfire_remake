// Checks every soundtrack part fills its track exactly and every chord/pitch parses.
import { TRACKS } from '../js/ui/tracks.js';
import { compileTrack, INSTRUMENT_NAMES } from '../js/ui/music.js';
let bad = 0;
for (const [name, t] of Object.entries(TRACKS)) {
  try {
    const c = compileTrack(t, name);
    for (const p of c.parts) if (!INSTRUMENT_NAMES.includes(p.inst)) throw new Error(`${name}: unknown instrument ${p.inst}`);
    const secs = c.length * 60 / c.bpm;
    console.log(`${name.padEnd(14)} ${String(c.length).padStart(4)} beats  ${secs.toFixed(1)} s  ${c.parts.reduce((a, p) => a + p.events.length, 0)} notes`);
  } catch (e) { bad++; console.error('FAIL', e.message); }
}
if (bad) { console.error(bad + ' track(s) failed'); process.exit(1); }
console.log('music: all tracks OK');
