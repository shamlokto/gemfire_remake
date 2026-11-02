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
// Optional traits: requires (a tech id), monster (Beast-Taming makes it cheaper), terrainBonus
// ({terrain: attack multiplier} in battles fought in such a province), loyaltyHit (loyalty lost in
// the province when hired), note (UI/wiki).
export const COMPANIES = {
  wolfriders: { name: 'Wolfriders',    atk: 14, def: 8,  move: 6, range: 1, size: 120, hire: 120, wage: 12, sprite: 57,
                monster: true },
  golem:      { name: 'Clay Golem',    atk: 18, def: 20, move: 2, range: 1, size: 60,  hire: 180, wage: 15, sprite: 58,
                bonusVs: { wall: 2 } },
  wyvern:     { name: 'Wyvern',        atk: 17, def: 10, move: 7, range: 1, size: 40,  hire: 220, wage: 20, sprite: 59,
                flying: true, monster: true },
  ghosts:     { name: 'Ghost Knights', atk: 13, def: 15, move: 4, range: 1, size: 80,  hire: 160, wage: 14, sprite: 60,
                ignoresTerrain: true },
  bandits:    { name: 'Bandits',       atk: 9,  def: 7,  move: 4, range: 3, size: 150, hire: 70,  wage: 7,  sprite: 61 },
  druids:     { name: 'Druids',        atk: 7,  def: 8,  move: 3, range: 3, size: 50,  hire: 140, wage: 12, sprite: 62,
                heals: 0.08 },
  // Added with the tech tree
  sellswords:  { name: 'Sellswords',     atk: 11, def: 10, move: 3, range: 1, size: 140, hire: 90,  wage: 9,  sprite: 63,
                 note: 'Cheap veteran foot. No questions asked.' },
  trolls:      { name: 'Cave Trolls',    atk: 16, def: 16, move: 3, range: 1, size: 70,  hire: 170, wage: 15, sprite: 58,
                 monster: true, note: 'Hulking, thick-hided brutes.' },
  harpies:     { name: 'Harpies',        atk: 12, def: 8,  move: 7, range: 1, size: 70,  hire: 130, wage: 12, sprite: 59,
                 flying: true, monster: true, note: 'Shrieking flyers that strike anywhere.' },
  lizardfolk:  { name: 'Lizardfolk',     atk: 12, def: 11, move: 4, range: 1, size: 110, hire: 120, wage: 11, sprite: 57,
                 monster: true, terrainBonus: { marsh: 1.35 }, note: 'Deadly in the marshes (+35% attack there).' },
  skeletons:   { name: 'Skeleton Legion', atk: 10, def: 12, move: 3, range: 1, size: 160, hire: 210, wage: 0, sprite: 60,
                 loyaltyHit: 6, note: 'Never paid, never hungry. The people fear them (loyalty -6 when raised).' },
  giants:      { name: 'Hill Giants',    atk: 21, def: 18, move: 3, range: 1, size: 45,  hire: 230, wage: 20, sprite: 58,
                 monster: true, bonusVs: { wall: 2 }, note: 'Tear down walls with their hands.' },
  arquebusiers: { name: 'Arquebusiers',  atk: 14, def: 7,  move: 3, range: 3, size: 120, hire: 200, wage: 16, sprite: 66,
                 requires: 'black_powder', note: 'Thunder and smoke. Needs Black Powder.' },
  bombard:     { name: 'Bombard Crew',   atk: 22, def: 5,  move: 1, range: 5, size: 40,  hire: 240, wage: 18, sprite: 70,
                 requires: 'black_powder', bonusVs: { wall: 3 }, note: 'Iron cannon that crack keeps. Needs Black Powder.' },
};
export const COMPANY_TYPES = Object.keys(COMPANIES);

export const MILITIA = { name: 'Militia', atk: 6, def: 8, move: 3, range: 1, sprite: 74 };

export const MAX_SOLDIERS = 500;      // per vassal unit
export const MAX_VASSALS_PER_PROVINCE = 5;
export const MAX_UNITS_PER_PROVINCE = 8;
export const MAX_UNITS_PER_ARMY = 4;   // plus the 5th slot (company or spirit)
export const ROUT_LED = 0.30, ROUT_LEADERLESS = 0.40;
