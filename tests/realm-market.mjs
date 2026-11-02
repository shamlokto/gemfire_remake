// Grain market: seasonal prices, trading needs a market, spread, caps, AI trade. node tests/realm-market.mjs
import assert from 'node:assert';
import { newGame } from '../js/realm/state.js';
import { quote, trade, marketTick, tradeCap, initMarket, SEASON_FACTOR, BASE_PRICE } from '../js/realm/market.js';
import { applyOrder, listOrders } from '../js/realm/orders.js';
import { makeRng } from '../js/rng.js';
import { B } from '../js/land/land.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ok ', name); } catch (e) { fail++; console.log('  FAIL', name, '\n      ', e.message); } };

t('prices follow the seasons over many years', () => {
  const s = newGame('aldmere', 3); initMarket(s);
  const rng = makeRng(9), sum = Array(12).fill(0), n = Array(12).fill(0);
  for (let k = 0; k < 12 * 40; k++) { marketTick(s, rng); s.month = (s.month + 1) % 12; s.turn++; sum[s.month] += s.market.price; n[s.month]++; }
  const avg = sum.map((x, i) => x / n[i]);
  assert.ok(avg[2] > avg[6] * 1.4, `spring ${avg[2].toFixed(1)} vs harvest ${avg[6].toFixed(1)}`);
  assert.ok(Math.abs(avg.reduce((a, b) => a + b) / 12 - BASE_PRICE * SEASON_FACTOR.reduce((a, b) => a + b) / 12) < 4);
});
t('trading needs a working market; buy and sell with a spread', () => {
  const s = newGame('aldmere', 3);
  const pid = s.provinces.findIndex(p => p.owner === 'aldmere' && tradeCap(s, p.id) > 0);
  assert.ok(pid >= 0, 'an Aldmere province with a market');
  const pr = s.provinces[pid]; pr.gold = 1000; pr.food = 1000;
  const q = quote(s);
  const r1 = trade(s, pid, 100); assert.ok(r1.ok, r1.msg); assert.strictEqual(pr.food, 1100);
  const r2 = trade(s, pid, -100); assert.ok(r2.ok, r2.msg);
  assert.ok(pr.gold < 1000, 'round trip loses money to the spread');
  assert.ok(q.buy > q.sell);
  const noMarket = s.provinces.find(p => p.owner === 'aldmere' && !tradeCap(s, p.id));
  if (noMarket) assert.ok(!trade(s, noMarket.id, 50).ok);
});
t('monthly cap per market; trading is a free action', () => {
  const s = newGame('aldmere', 3);
  const pid = s.provinces.findIndex(p => p.owner === 'aldmere' && tradeCap(s, p.id) > 0);
  const pr = s.provinces[pid]; pr.gold = 100000; pr.food = 100000;
  const cap = tradeCap(s, pid);
  assert.ok(applyOrder(s, { type: 'trade', province: pid, food: cap }).ok);
  assert.ok(!applyOrder(s, { type: 'trade', province: pid, food: 10 }).ok, 'cap reached');
  assert.ok(!pr.ordered, 'trade does not use the order');
  assert.ok(listOrders(s, pid).some(o => o.type === 'trade'));
});
t('heavy buying raises next month\'s price', () => {
  const a = newGame('aldmere', 3), b = newGame('aldmere', 3);
  initMarket(a); initMarket(b); a.market.volume = 3000;
  marketTick(a, makeRng(1)); marketTick(b, makeRng(1));
  assert.ok(a.market.price > b.market.price);
});
console.log(`realm-market: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
