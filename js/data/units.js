// Troop types (led by vassals), companies (hired) and militia. Original numbers.
//
// Battle stats: atk, def, move (squares per round), range (1 = melee), hp is per-soldier
// toughness used by the battle damage formula. cost: gold per 10 soldiers mustered.
// upkeep: food per 100 soldiers per month. sprite: art slot number (docs/SHOTLIST.md).

export const TROOPS = {
  footmen: { name: 'Footmen',  atk: 10, def: 10, move: 3, range: 1, cost: 4, upkeep: 4, sprite: 63,
             note: 'Steady all-rounders.' },
  pikes:   { name: 'Pikes',    atk: 9,  def: 13, move: 2, range: 1, cost: 4, upkeep: 4, sprite: 64,
             bonusVs: { horse: 1.6 }, note: 'Wall of spears: crushes cavalry.' },
  archers: { name: 'Archers',  atk: 8,  def: 7,  move: 3, range: 4, cost: 5, upkeep: 4, sprite: 65,
             note: 'Shoot from four squares away.' },
  horse:   { name: 'Horse',    atk: 13, def: 8,  move: 5, range: 1, cost: 7, upkeep: 6, sprite: 67,
             bonusVs: { archers: 1.5, siege: 1.5 }, note: 'Fast; ride down archers and engines.' },
  knights: { name: 'Knights',  atk: 15, def: 13, move: 4, range: 1, cost: 10, upkeep: 7, sprite: 68,
             note: 'Heavy horse. Expensive, strong.' },
  siege:   { name: 'Siege',    atk: 16, def: 5,  move: 1, range: 5, cost: 9, upkeep: 5, sprite: 70,
             bonusVs: { wall: 3 }, note: 'Slow catapults; batter keeps and gates.' },
};
export const TROOP_TYPES = Object.keys(TROOPS);

// Companies: hired for gold in a province, one per province at most, fight alongside its vassals.
// size is fixed; hire = gold once; wage = gold per month (unpaid companies desert).
export const COMPANIES = {
  wolfriders: { name: 'Wolfriders',    atk: 14, def: 8,  move: 6, range: 1, size: 120, hire: 120, wage: 12, sprite: 57 },
  golem:      { name: 'Clay Golem',    atk: 18, def: 20, move: 2, range: 1, size: 60,  hire: 180, wage: 15, sprite: 58,
                bonusVs: { wall: 2 } },
  wyvern:     { name: 'Wyvern',        atk: 17, def: 10, move: 7, range: 1, size: 40,  hire: 220, wage: 20, sprite: 59,
                flying: true },
  ghosts:     { name: 'Ghost Knights', atk: 13, def: 15, move: 4, range: 1, size: 80,  hire: 160, wage: 14, sprite: 60,
                ignoresTerrain: true },
  bandits:    { name: 'Bandits',       atk: 9,  def: 7,  move: 4, range: 3, size: 150, hire: 70,  wage: 7,  sprite: 61 },
  druids:     { name: 'Druids',        atk: 7,  def: 8,  move: 3, range: 3, size: 50,  hire: 140, wage: 12, sprite: 62,
                heals: 0.08 },
};
export const COMPANY_TYPES = Object.keys(COMPANIES);

export const MILITIA = { name: 'Militia', atk: 6, def: 8, move: 3, range: 1, sprite: 74 };

export const MAX_SOLDIERS = 500;      // per vassal unit
export const MAX_VASSALS_PER_PROVINCE = 5;
