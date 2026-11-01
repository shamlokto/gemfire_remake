// Headless battle: both sides played by the AI. Pure; used by the realm for AI-vs-AI battles.

import { createBattle, applyAction, result } from './rules.js';
import { chooseAction } from './ai.js';

export function runToEnd(b, maxSteps = 5000) {
  let steps = 0;
  while (!b.winner && steps++ < maxSteps) {
    const a = chooseAction(b, b.side);
    const r = applyAction(b, a);
    if (!r.ok) applyAction(b, a.unit ? { type: 'wait', unit: a.unit } : { type: 'endSide' });
  }
  if (!b.winner) applyAction(b, { type: 'retreat', side: 'attacker' });
  return b;
}

export function autoResolve(input, seed = 1) {
  const b = createBattle(input, seed);
  runToEnd(b);
  return result(b);
}
