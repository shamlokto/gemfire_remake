// Returns the real autoResolve if js/battle/auto.js loads, else the stub. Set STUB=1 to force the stub.
export async function getAutoResolve() {
  if (!process.env.STUB) {
    try {
      const m = await import('../js/battle/auto.js');
      if (typeof m.autoResolve === 'function') return { autoResolve: m.autoResolve, real: true };
    } catch (e) { console.warn('battle/auto.js not usable, using stub:', e.message); }
  }
  const m = await import('./_stub-auto.mjs');
  return { autoResolve: m.autoResolve, real: false };
}
