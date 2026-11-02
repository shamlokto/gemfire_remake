// The Dawnwyrm: player only, needs loved provinces, cooldown, stripped from results. node tests/realm-dragon.mjs
import assert from 'node:assert';
import { newGame } from '../js/realm/state.js';
import { maybeDawnwyrm, stripDragon, dragonChance, DRAGON_COOLDOWN } from '../js/realm/dragon.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ok ', name); } catch (e) { fail++; console.log('  FAIL', name, '\n      ', e.message); } };
const input = (atk, def) => ({ attacker: { house: atk, units: [] }, defender: { house: def, units: [] } });

t('chance grows with loyalty, zero below 80', () => {
  assert.strictEqual(dragonChance(69), 0);
  assert.ok(dragonChance(90) > dragonChance(80));
  assert.ok(dragonChance(100) <= 0.5 && dragonChance(80) >= 0.2);
});
t('helps only the player, never a computer house', () => {
  let came = 0, aiCame = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const s = newGame('aldmere', seed);
    for (const p of s.provinces) p.loyalty = 100;
    const i1 = input('aldmere', 'corvane');
    if (maybeDawnwyrm(s, { from: 8, to: 7 }, i1)) came++;
    const s2 = newGame('aldmere', seed);
    for (const p of s2.provinces) p.loyalty = 100;
    const i2 = input('corvane', 'vey');
    if (maybeDawnwyrm(s2, { from: 2, to: 17 }, i2)) aiCame++;
    assert.ok(!i2.attacker.units.length && !i2.defender.units.length);
  }
  assert.ok(came > 30 && came < 70, `came ${came}/100`);
  assert.strictEqual(aiCame, 0);
});
t('low loyalty: never comes; cooldown of a year', () => {
  const s = newGame('aldmere', 5);
  for (const p of s.provinces) p.loyalty = 60;
  for (let k = 0; k < 50; k++) assert.ok(!maybeDawnwyrm(s, { from: 8, to: 7 }, input('aldmere', 'corvane')));
  for (const p of s.provinces) p.loyalty = 100;
  s.dragonTurn = s.turn;
  for (let k = 0; k < 50; k++) assert.ok(!maybeDawnwyrm(s, { from: 8, to: 7 }, input('aldmere', 'corvane')));
  s.turn += DRAGON_COOLDOWN;
  let ok = false;
  for (let k = 0; k < 200 && !ok; k++) ok = maybeDawnwyrm(s, { from: 8, to: 7 }, input('aldmere', 'corvane'));
  assert.ok(ok);
});
t('the dragon is stripped from results', () => {
  const r = stripDragon({ attacker: { units: [{ id: 'dawnwyrm' }, { id: 'u1' }] }, defender: { units: [] } });
  assert.deepStrictEqual(r.attacker.units.map(u => u.id), ['u1']);
});
console.log(`realm-dragon: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
