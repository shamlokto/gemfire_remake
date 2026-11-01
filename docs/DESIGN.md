# Lanternfall: design and module contracts

An original fantasy grand-strategy game for the browser. Plain ES modules, no build step, no
dependencies at runtime. Served by `serve.py` (or GitHub Pages). All world content is original.

## Files
```
index.html                 the game (title -> house select -> realm <-> battle)
wiki.html, js/wiki.js      the wiki, generated live from js/data/* (houses, vassals, provinces,
                           troops, companies, spirits, events, rules, art gallery)
css/style.css              shared theme tokens (dark parchment-and-gold), used by game and wiki
js/main.js                 screen router, boot, save/load (localStorage, 3 slots + autosave)
js/rng.js                  seeded RNG (state.rng is a uint32)
js/data/*.js               static data (world, houses, vassals, units, spirits, events, art)
js/realm/state.js          newGame(houseId, seed) -> RealmState; helpers (owned provinces etc.)
js/realm/orders.js         listOrders(state, provinceId) / applyOrder(state, order) -> {ok, msg}
js/realm/economy.js        monthly tick: income, upkeep, harvest, events, revolts, loyalty
js/realm/diplomacy.js      truce / tribute / marriage / bribe
js/realm/ai.js             planHouseOrders(state, houseId, rng) -> order[]
js/realm/turn.js           endMonth(state, resolvePlayerBattle?) drives AI orders, battles, tick
js/battle/rules.js         createBattle(input, rng) / legalMoves / applyAction / result
js/battle/ai.js            chooseAction(battle, side, rng)
js/battle/auto.js          autoResolve(input, rng) -> BattleResult (runs rules+ai headless)
js/ui/*.js                 DOM/canvas views (mapview, panels, battleview, portraits, audio)
tools/process_art.py       turns the 100 uploaded images into art/NNN.webp + art/manifest.json
tools/make_placeholders.mjs writes art-placeholder/NNN.svg for every slot
tests/*.mjs                node tests (rules, AI-vs-AI campaigns, determinism)
```
**Rules modules (`js/realm/*`, `js/battle/rules.js|ai.js|auto.js`) never touch the DOM** and
must run in node, so tests can simulate whole campaigns headless.

## Realm rules
* One turn = one month; 12 months a year (names in `world.js`), seasons = month/3.
  Game starts in month 0 of year 412.
* Each month the player gives **one order per owned province** (provinces with no vassal can
  only Develop or Govern). Then every AI house orders, then marches resolve as battles
  (in house order, starting from a rotating index), then the economy ticks.
* Economy per province per month:
  `gold += market * 0.6 * (0.5 + loyalty/200)`;
  autumn harvest (month 6): `food += fields * 6 * (0.5 + loyalty/200)`;
  monthly food upkeep = sum over troops of `soldiers * upkeep / 100`, plus company wages in gold.
  Food < 0: lose 10% of soldiers, loyalty -10, food = 0. Gold < 0: companies desert, gold = 0.
  Loyalty drifts toward `40 + governor.charm/4`; loyalty < 20 risks a revolt event.
* Orders (`order.type`): `develop` {province, kind: fields|market|dikes} (costs 30 gold, gain
  `4 + vassal.wits/20`, max 100); `muster` {province, vassal, soldiers} (gold = soldiers/10 * cost,
  loyalty -2); `train` {province, vassal} (training += 10 + might/10, max 100); `hire`
  {province, company}; `dismiss` {province}; `march` {from, to, vassals[], company: bool, food}
  (to an adjacent province; an own province = transfer, foreign = attack);
  `supply` {from, to, food, gold} (adjacent own); `govern` {province, kind: feast|tax}
  (feast: 20 food -> loyalty +8; tax: +gold = market, loyalty -10); `diplomacy`
  {province, kind: truce|tribute|marriage|bribe, target, vassal?}; `spy` {province, target};
  `recruit` {province, captive} (try to win a captive vassal); `rest` (nothing).
* Vassal loyalty < 40 may defect when bribed or when their house loses battles. Rulers never.
* A battle: attacker vassals (max 5) plus optional company plus spirit if the house holds a
  shard and has not used that spirit this season. Defender: all vassals in the province plus its
  company plus spirit; free holds defend with militia. Attacker wins -> province changes owner,
  defender vassals who survive retreat to an adjacent own province, or are captured if none.
  A ruler captured -> that house's next-best vassal becomes ruler; a house with no provinces
  is eliminated (its vassals become captives of the conqueror).
* Shards sit in their province (`province.shard`). Taking the province takes the shard.
* Victory: own 18 provinces or all 5 shards. Defeat: no provinces.

## RealmState (JSON-serialisable; saved as-is)
```js
{
  version: 1, seed, rng,            // rng = uint32 state
  turn, year, month,                // turn counts from 0
  player: 'aldmere',
  houses: { [id]: { id, alive, ruler: vassalId, capital, spiritUsed: {[spiritId]: season-index} } },
  provinces: [ { id, owner: houseId|null, fields, market, dikes, loyalty, food, gold,
                 vassals: [vassalId], company: null | { type, soldiers },
                 militia, shard: spiritId|null, ordered: false } ],
  vassals: { [id]: { id, house, might, wits, charm, loyalty,
                     troop, soldiers, training, location: provinceId|null,
                     status: 'active'|'captive'|'exiled'|'dead', captor: houseId|null } },
  truces: { 'a|b': untilTurn }, marriages: [['a','b', untilTurn]],
  intel: { [houseId]: { [provinceId]: turnSeen } },
  log: [ { turn, text, kind, art? } ],      // newest last; UI shows recent ones
  pendingEvents: [ { art, title, text } ],  // shown by UI after a month, then cleared
  winner: null | houseId,
}
```
Static fields (names, titles, portraits) stay in `js/data/*` and are looked up by id.

## Battle contract
```js
BattleInput = {
  provinceId, terrain,               // terrain of the province (world.js)
  siege: bool,                       // true if the province has a keep (always for owned ones)
  attacker: { house, units: [UnitIn], spirit: spiritId|null },
  defender: { house|null, units: [UnitIn], spirit: spiritId|null },
}
UnitIn = { id, kind: 'vassal'|'company'|'militia', vassalId?, type, soldiers, training,
           might, wits }               // type = TROOPS key | COMPANIES key | 'militia'
BattleResult = {
  winner: 'attacker'|'defender', rounds,
  attacker: { units: [{ id, soldiers, fate: 'ok'|'routed'|'dead' }], spiritUsed: bool },
  defender: { units: [{ id, soldiers, fate }], spiritUsed: bool },
}
```
* Grid 16 x 12. The map is generated from the terrain type and a seed (forests, hills, river
  with a bridge, road); with `siege`, the defender has a keep (3x3 walls with a gate) on the
  right, the attacker deploys on the left columns.
* 15 rounds; each round each side moves all its units (attacker first). A unit can move then
  attack (melee adjacent or ranged within range; ranged cannot move and shoot in the same turn).
* Damage = `soldiers * atk * (1 + might/200) * (0.7 + training/333) * bonus * rand(0.85..1.15)
  / (def * terrainDef * 10)`, in soldiers killed. Melee defenders strike back at half.
  terrainDef: grass 1, road 1, forest 1.25, hills 1.3, village 1.2, wall 1.8, gate 1.4,
  water/marsh 0.8 (move cost 2); mountain impassable except flying.
* A unit under 15% of its starting soldiers routs (leaves the field). Attacker wins by occupying
  the keep's centre square for a full round or routing all defenders; defender wins otherwise.
* Spirits: each side's spirit casts once (data in `spirits.js`), as an action of the side.
* `createBattle(input, seed)` returns a JSON-serialisable BattleState, so a battle can be saved.

## UI
* Title (slot 1) -> house select (rulers 16-21, house cards) -> prologue event (99).
* Realm screen: canvas world map (slot 10, winter 11 in winter months), house-coloured province
  markers, army tokens, fog over provinces not seen; side panel for the selected province
  (stats, governor portrait, vassals, order buttons); top bar with date, season banner (4-7),
  totals; log drawer; events as modal cards with their scene art.
* Battle screen: canvas grid with terrain tiles (75-84), unit sprites tinted by house colour,
  portrait of each unit's vassal, spirit card and spell effect (85-89).
* Every image goes through `art(slot)` from `js/data/art.js`, which falls back to placeholders.
* Phone width works: panel becomes a bottom sheet.
