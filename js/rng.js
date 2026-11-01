// Seeded RNG (mulberry32). State is a single uint32 kept in game state so saves replay exactly.
// Usage: const r = makeRng(state.rng); r.next(); ... state.rng = r.state;

export function makeRng(seed) {
  let s = seed >>> 0;
  const rng = {
    get state() { return s; },
    next() {                       // float in [0, 1)
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(lo, hi) { return lo + Math.floor(rng.next() * (hi - lo + 1)); },   // inclusive
    chance(p) { return rng.next() < p; },
    pick(arr) { return arr[Math.floor(rng.next() * arr.length)]; },
  };
  return rng;
}
