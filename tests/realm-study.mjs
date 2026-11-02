// Study: a free action, at most three a month per house. node tests/realm-study.mjs
import assert from 'node:assert';
import { newGame } from '../js/realm/state.js';
import { applyOrder, resetOrders, STUDY_PER_MONTH } from '../js/realm/orders.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ok ', name); } catch (e) { fail++; console.log('  FAIL', name, '\n      ', e.message); } };
t('study does not use the province order and is capped per month', () => {
  const s = newGame('aldmere', 2);
  for (let k = 0; k < STUDY_PER_MONTH; k++) assert.ok(applyOrder(s, { province: 8, type: 'study' }).ok, 'study ' + k);
  assert.ok(!s.provinces[8].ordered, 'the province can still act');
  assert.ok(!applyOrder(s, { province: 9, type: 'study' }).ok, 'fourth study refused');
  assert.ok(applyOrder(s, { province: 8, type: 'rest' }).ok, 'normal order still available');
  resetOrders(s);
  assert.ok(applyOrder(s, { province: 9, type: 'study' }).ok, 'cap resets next month');
});
console.log(`realm-study: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
