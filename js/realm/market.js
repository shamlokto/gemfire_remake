// The grain market: food and gold can be traded in any province with a working Market building.
// Pure (no DOM); mutates state.
//
// state.market = { price, history: [{ turn, month, price }], volume, news: string|null }
//   price    mid price in gold per 100 food
//   volume   net food bought (+) or sold (-) by every house this month; it moves next month's price
//
// The price follows the seasons (dear in the lean months before the harvest, cheap right after it),
// with a random walk, occasional scares and gluts, and a little pressure from what the houses trade.
// Buying costs more than selling pays (the merchants' cut), so there is no free money in it.
//
// Trading is a free action (does not use the province's order). Each working Market building lets
// a province trade up to TRADE_PER_MARKET food a month (buying and selling together).

import { landOf } from './landhooks.js';
import { B } from '../land/land.js';
import { addLog, isPlayerControlled, betaTopUp } from './state.js';
import { MONTHS } from '../data/world.js';

export const BASE_PRICE = 20;          // gold per 100 food, on average over the year
export const SPREAD = 0.12;            // buy at mid +12%, sell at mid -12%
export const TRADE_PER_MARKET = 300;   // food per working market per month
export const PRICE_MIN = 6, PRICE_MAX = 60;
// Season factor by month (Thaw .. Icebreak): the lean spring before the harvest is dearest,
// the Harvest month cheapest; winter climbs again as stores run down.
export const SEASON_FACTOR = [1.25, 1.32, 1.35, 1.22, 1.12, 1.02, 0.7, 0.78, 0.9, 1.0, 1.1, 1.18];

export function initMarket(state) {
  if (state.market) return state.market;
  const p = Math.round(BASE_PRICE * SEASON_FACTOR[state.month || 0] * 10) / 10;
  state.market = { price: p, history: [{ turn: state.turn || 0, month: state.month || 0, price: p }], volume: 0, news: null };
  return state.market;
}

export function quote(state) {
  const m = initMarket(state);
  return {
    mid: m.price,
    buy: Math.round(m.price * (1 + SPREAD) * 10) / 10,    // gold you pay per 100 food
    sell: Math.round(m.price * (1 - SPREAD) * 10) / 10,   // gold you get per 100 food
    news: m.news,
  };
}

// Monthly price move (call once per month, before the month advances is fine).
export function marketTick(state, rng) {
  const m = initMarket(state);
  const next = (state.month + 1) % 12;
  let target = BASE_PRICE * SEASON_FACTOR[next];
  m.news = null;
  const r = rng.next();
  if (r < 0.06) { target *= 1.35; m.news = 'Rumours of blight: grain merchants raise their prices.'; }
  else if (r < 0.12) { target *= 0.72; m.news = 'A glut of grain floods the markets.'; }
  // Pull halfway to the seasonal target, then a random step of up to ±12%, then trade pressure.
  let p = m.price * 0.5 + target * 0.5;
  p *= 0.88 + rng.next() * 0.24;
  p *= 1 + Math.max(-0.25, Math.min(0.25, m.volume / 4000));
  m.price = Math.round(Math.max(PRICE_MIN, Math.min(PRICE_MAX, p)) * 10) / 10;
  m.volume = 0;
  m.history.push({ turn: state.turn + 1, month: next, price: m.price });
  if (m.history.length > 36) m.history.splice(0, m.history.length - 36);
  for (const pr of state.provinces) pr.traded = 0;
  if (m.news) addLog(state, `${MONTHS[next]}: ${m.news}`, 'info');
}

export function marketCount(state, pid) {
  const land = landOf(state, pid);
  if (!land) return 0;
  let n = 0;
  for (let i = 0; i < land.b.length; i++) if (land.b[i] === B.MARKET && !land.c[i] && !land.d[i]) n++;
  return n;
}
export function tradeCap(state, pid) {
  return marketCount(state, pid) * TRADE_PER_MARKET;
}
export function tradeRoom(state, pid) {
  return Math.max(0, tradeCap(state, pid) - (state.provinces[pid].traded || 0));
}

// Trade in province pid. food > 0 buys that much food; food < 0 sells it. Amounts round to 10.
// Returns { ok, msg, food, gold }.
export function trade(state, pid, food) {
  const pr = state.provinces[pid];
  if (!pr || !pr.owner) return { ok: false, msg: 'Not your province.' };
  food = Math.round((food || 0) / 10) * 10;
  if (!food) return { ok: false, msg: 'Choose an amount.' };
  const cap = tradeCap(state, pid);
  if (!cap) return { ok: false, msg: 'This province needs a working Market to trade.' };
  const room = tradeRoom(state, pid);
  if (Math.abs(food) > room) return { ok: false, msg: room ? `The markets here can handle ${room} more food this month.` : 'The merchants here are done for the month.' };
  const q = quote(state);
  let gold;
  if (food > 0) {
    gold = Math.ceil(food * q.buy / 100);
    if (gold > pr.gold) return { ok: false, msg: `Needs ${gold} gold.` };
    pr.gold -= gold; pr.food += food;
  } else {
    if (-food > pr.food) return { ok: false, msg: `Only ${pr.food} food in the stores.` };
    gold = Math.floor(-food * q.sell / 100);
    pr.food += food; pr.gold += gold;
  }
  pr.traded = (pr.traded || 0) + Math.abs(food);
  state.market.volume += food;
  betaTopUp(state);
  const msg = food > 0 ? `Bought ${food} food for ${gold} gold.` : `Sold ${-food} food for ${gold} gold.`;
  if (isPlayerControlled(state, pr.owner)) addLog(state, `${msg}`, 'trade');
  return { ok: true, msg, food, gold: food > 0 ? -gold : gold };
}

// AI: sell surplus when grain is dear (and before winter spoils it), buy when short.
export function aiTrade(state, house, needFood) {
  const q = quote(state);
  for (const pr of state.provinces) {
    if (pr.owner !== house) continue;
    const room = tradeRoom(state, pr.id);
    if (!room) continue;
    const need = needFood(pr);                  // food this province should keep
    if (pr.food < need && pr.gold > 120) {
      const want = Math.min(room, need - pr.food, Math.floor((pr.gold - 100) / q.buy * 100));
      if (want >= 50) trade(state, pr.id, want);
    } else {
      const surplus = pr.food - need * 1.5;
      const dear = q.mid >= BASE_PRICE * 1.1 || state.month === 8;   // dear grain, or winter is coming
      if (surplus >= 100 && dear) trade(state, pr.id, -Math.min(room, surplus));
    }
  }
}
