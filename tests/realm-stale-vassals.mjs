// Reproduce: a province holding stale vassal ids (captured previous owners) must still accept marchers.
import { newGame } from '../js/realm/state.js';
import { applyOrder, marchOptions } from '../js/realm/orders.js';
const s = newGame('seraphine', 4);
// Seraphine owns Goldvale (20); give her Sunderisle (26) too, stuffed with five stale names.
const sund = s.provinces[26]; sund.owner = 'seraphine'; sund.militia = [];
const ghosts = ['corvane_1', 'corvane_2', 'corvane_3', 'corvane_4', 'corvane_5'];
for (const id of ghosts) { s.vassals[id].status = 'captive'; s.vassals[id].location = null; }
sund.vassals = [...ghosts];
const mo = marchOptions(s, 20);
const v = mo.vassals[0];
const r = applyOrder(s, { type: 'march', from: 20, to: 26, units: mo.units.slice(0, 2).map(u => u.uid), vassals: v ? [v.id] : [], fifth: null, food: 0 });
const ok = r.ok && !s.provinces[26].vassals.some(id => ghosts.includes(id));
console.log(`realm-stale-vassals: ${ok ? 1 : 0}/1 passed`, ok ? '' : r.msg);
process.exit(ok ? 0 : 1);
