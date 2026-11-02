# Province land (SimCity-style development)

Every province has a small land grid (12 x 9 tiles) of soil, forest, hills, rock, marsh, sea and
rivers, with a few special resources. What a province yields comes from what is **built on its
land**, so good land matters: the river plains (Amberfield, Kingsrest, Lanterncross, Goldvale,
Millbrook, Aldford, Coldmere) can grow to about 1,000-1,200 food a harvest, while the barren
isles and peaks (Emberrock, Frosthelm, Cairnholm, Ironpeak, Oakhollow) top out near 150, but
have ore, springs and other gold.

Files: `js/land/land.js` (rules, yields, building, AI helper), `js/land/landgen.js` (generation),
`js/ui/landview.js` + `css/land.css` (the isometric view), `tests/land-rules.mjs`.
All rules modules are pure (no DOM) and run in node.

## Land state

```js
land = { v: 1, pid, w: 12, h: 9, quality, lake?,
         t: [terrain],  r: [resource],  b: [building],    // small ints, i = y * w + x
         c: [months of construction left], d: [damaged 0/1],
         p: [{ i, kind: 'clear'|'drain'|'excavate', left }] }
```
JSON-serialisable (~600 bytes as JSON); store one per province, e.g. `state.land[pid]`.

* Terrain `T`: WATER, RIVER, FERTILE, PLAIN, POOR, FOREST, HILLS, ROCK, MARSH (`TERRAIN[t].soil` is
  the farm multiplier: fertile 1.8, plain 1.1, poor 0.55).
* Resources `R`: ORE, SALT, PEARLS, VINES, RUINS, GROVE, SPRINGS (`RESOURCE[r].text`).
* Buildings `B`: FARM, ORCHARD, PASTURE, LUMBER, MINE, FISHERY, MARKET, HOUSES, GRANARY, MILL,
  TEMPLE, BARRACKS, WALLS, KEEP (`BUILDING[b]`: name, allowed terrain, cost, months, labour, text).

## API (`js/land/land.js`, `js/land/landgen.js`)

| Function | Returns |
|---|---|
| `generateLand(pid, seed, { start: { fields, market } \| false })` | a land; starting farms/houses/market placed to roughly match the old abstract `fields`/`market` (default 30/25) |
| `generateAllLand(seed, { start: pid => ({fields, market}) })` | array of 28 lands |
| `provinceYield(land, ctx)` | `{ food, foodUpkeep, gold, pop, labour, musterCap, loyaltyMod, defense, storage, winterSpoilage, trainingBonus, horseDiscount, buildDiscount, siegeDiscount, flags }` |
| `legacyStats(yield)` | `{ fields, market }` in the old economy's terms (harvest = fields x 10, gold = market x 0.6) |
| `listBuildable(land, x, y, ctx)` | options `[{ kind, name, cost, time, text, ok, why, preview: {food, gold, pop, loyalty, defense, labour}, project? }]` |
| `canBuild(land, i, kind)` | reason string or null |
| `build(land, x, y, kind, ctx)` | `{ ok, cost, msg }`; starts construction (also accepts project kinds and `'repair'`); checks `ctx.gold` if given, **the caller deducts the gold** |
| `repair(land, x, y, ctx)`, `demolish(land, x, y)`, `startProject(land, x, y, kind, ctx)` | `{ ok, cost?, msg }` |
| `monthTick(land, rng)` | advances construction and projects; `{ done: [{i, what}], gold }` (timber from clearing, treasure from ruins) |
| `damage(land, intensity, rng)` | war damage, intensity 0..1; `{ damaged, razed }` |
| `loot(land, rng)` | `{ gold, loyalty: -25 }`; damages markets, houses, granaries, temples |
| `suggestBuild(land, ctx, goal)` | best affordable build for `'food'\|'gold'\|'army'\|'loyalty'\|'balanced'`: `{ x, y, kind, cost, score, preview }` or null |
| `potential(land)` | `{ food, gold }` upper bound, for rating provinces |

`ctx` (all optional): `{ gold, month, mods: { food, farm, gold, pop, loyalty, defense, cost } }`.
`mods` is how techs plug in (e.g. crop rotation `farm: 1.15`, guild charters `gold: 1.1`,
fortification `defense: 0.1`, lumber/cheaper builds `cost: 0.9`).

## Rules in brief

* **Farms**: 9 food x soil; +25% next to a river or lake (irrigation); +20% next to a working mill.
* **Labour**: buildings need people (farm 25, mine 25, ...). Houses give 50 people, the keep 40.
  Short of hands, *all* output drops in proportion (`labour` < 1). Developing land means building
  houses too.
* **People** eat `pop x 0.25` food a harvest (`foodUpkeep`), pay `0.012` gold a month each, and
  set the muster cap (`100 + pop x 1.2`).
* **Markets**: 2 gold + 1 per neighbouring houses (up to 5); beyond three markets, half yield.
* **Mines** 2-3 gold (+5 on ore, +4 on salt); **fisheries** 12 food at sea (harbour), 7 on a
  river, +5 gold on pearls; **orchards** 9 food + 1.5 gold (+4 gold as a vineyard on a vine slope);
  **pastures** 4 food and 10% cheaper horse/knight musters each (up to 30%); **lumber camps** 1.5 gold
  and 5% cheaper buildings each (up to 20%).
* **Granaries** store 200 food each and cut winter spoilage from 20% to 5% (two granaries).
* **Temples** +4 loyalty (+5 on a sacred grove, +2 on springs or ruins); overcrowding (more people
  than the land feeds) costs up to 10 loyalty.
* **Barracks** +5 training a month for units in the province (two at most); **walls** within two
  tiles of the keep +5% defence each; the keep gives +10%; cap +50%.
* **Projects**: clear forest (30 gold, 2 months, gives 20 gold of timber) -> plain or poor soil;
  drain marsh (60, 3) -> fertile next to water, plain otherwise; excavate ruins (40, 2) ->
  80-200 gold once.
* Construction takes 1-3 months; nothing works while building or damaged.

## Integration notes (for the realm)

1. **State**: add `state.land = generateAllLand(state.seed, { start: pid => HOUSE_START-derived
   {fields, market} })` in `newGame`; scenario starts can pre-build more.
2. **Economy**: replace the abstract numbers. Monthly gold `+= provinceYield(land).gold`; at the
   harvest `food += yield.food - yield.foodUpkeep` (or keep the old loyalty factor on top:
   `x (0.5 + loyalty/200)`); in winter apply `yield.winterSpoilage` to stored food above
   `yield.storage`; loyalty drifts toward its target `+ yield.loyaltyMod`; muster limited by
   `yield.musterCap` soldiers in the province; train adds `yield.trainingBonus`; horse/knight muster
   cost `x (1 - yield.horseDiscount)`; siege engines `x (1 - yield.siegeDiscount)`. If a quick
   bridge is wanted first: set `province.fields/market` from `legacyStats(yield)` each month.
3. **Orders**: the old `develop` order becomes `build {province, x, y, kind}` (one build or project
   per province per month; costs `result.cost` gold from the province). `monthTick(land, rng)` for
   every province in the economy tick; add `result.gold` to the province.
4. **Battle**: defender bonus `yield.defense` -> multiply defenders' `def` (via `defBonus` in
   `UnitIn` if the battle rules support it). After a province changes hands call
   `damage(land, intensity, rng)` with intensity ~ `soldiers lost / soldiers fighting` (sieges
   higher), and offer **loot** to the conqueror (gold now, loyalty -25).
5. **AI**: each month, for each province, `suggestBuild(land, { gold: province.gold - reserve },
   goal)` with goal from the house's situation (`'food'` if food is short, `'army'` on a
   frontier, `'gold'` otherwise); apply with `build`.
6. **UI**: a "Land" button on the province panel opens
   `openLandView(el, land, { province, house: HOUSE_BY_ID[owner], ctx: { month, gold }, onBuild, readOnly: !owned })`.
   `onBuild({x, y, kind})` should run the realm order and return `{ ok, msg }`; then call
   `view.update(land, { gold })`. For spying on enemy land use `readOnly: true`.
7. **Wiki**: list soils, resources and buildings from `TERRAIN`, `RESOURCE`, `BUILDING`, `PROJECT`
   and `Y`, and rate provinces with `potential(generateLand(pid, 1))`.
