// The tech tree: four branches of research. Original to Lanternfall.
// Each tech: id, branch, name, tier (0-4, sets its cost), requires (tech ids), text (shown in the
// UI and wiki), effect (read by js/realm/tech.js `techEffect`).
//
// Research: every month a house earns points from its markets (and from `study` orders), which go
// into its current research (house.tech.focus). Cost = TECH_COST[tier] * (1 + TECH_INFLATION *
// techs already known).

export const BRANCHES = {
  agriculture: { name: 'Agriculture', color: '#7fb34d', icon: '🌾', blurb: 'Feed more soldiers from the same land.' },
  commerce:    { name: 'Commerce',    color: '#d9a94a', icon: '⚖', blurb: 'Coin, trade and the sea.' },
  military:    { name: 'Military',    color: '#d9614a', icon: '⚔', blurb: 'Better drilled, better armed, better walled.' },
  arcana:      { name: 'Arcana',      color: '#9a6bff', icon: '✦', blurb: 'Deeper bonds with the Lantern spirits.' },
};
export const BRANCH_IDS = Object.keys(BRANCHES);

export const TECH_COST = [60, 105, 150, 200, 255];
export const TECH_INFLATION = 0.15;

const T = (id, branch, tier, name, requires, text, effect) => ({ id, branch, tier, name, requires, text, effect });

export const TECHS = [
  // Agriculture
  T('crop_rotation', 'agriculture', 0, 'Crop Rotation', [],
    'Fields rest in turn. Harvests yield 10% more.', { harvest: 0.10 }),
  T('irrigation', 'agriculture', 1, 'Irrigation Channels', ['crop_rotation'],
    'Developing fields gains +2 more, and floods strike half as often.', { fieldsGain: 2, floodChance: 0.5 }),
  T('granaries', 'agriculture', 1, 'Stone Granaries', ['crop_rotation'],
    'Troops eat 15% less from the stores, and famine and blizzards spoil half as much food.', { upkeep: -0.15, foodLoss: 0.5 }),
  T('terraces', 'agriculture', 2, 'Hill Terraces', ['irrigation'],
    'Hills and mountain provinces harvest 30% more.', { highHarvest: 0.3 }),
  T('seed_banks', 'agriculture', 3, 'Seed Banks', ['granaries', 'irrigation'],
    'Ruined fields recover: provinces below 60 fields regain 1 each month.', { fieldsRegrow: 1 }),
  // Commerce
  T('markets', 'commerce', 0, 'Market Squares', [],
    'Gold income +6%.', { gold: 0.06 }),
  T('guild_charters', 'commerce', 1, 'Guild Charters', ['markets'],
    'Developing markets gains +2 more, and companies cost 15% less to hire.', { marketGain: 2, hire: -0.15 }),
  T('harbour_fleets', 'commerce', 1, 'Harbour Fleets', ['markets'],
    'Troops landing by sea fight at full vigour: +12% attack when attacking across a sea lane.', { seaAttack: 0.12 }),
  T('caravans', 'commerce', 2, 'Caravan Roads', ['guild_charters'],
    'Trade between your provinces: +1 gold a month for each neighbouring province you own (at most +4).', { tradeGold: 1 }),
  T('mint', 'commerce', 3, 'Royal Mint', ['caravans'],
    'Gold income +8% more.', { gold: 0.08 }),
  // Military
  T('drill_yards', 'military', 0, 'Drill Yards', [],
    'Training gains +4 per drill.', { trainGain: 4 }),
  T('smithing', 'military', 1, 'Master Smiths', ['drill_yards'],
    'Better steel: your troop units attack 12% harder.', { troopAtk: 0.12 }),
  T('fortification', 'military', 1, 'Fortification', ['drill_yards'],
    'Stronger walls: your troops defend 8% better in your own provinces.', { homeDef: 0.08 }),
  T('siegecraft', 'military', 2, 'Siegecraft', ['smithing'],
    'Siege engines hit 25% harder and cost a quarter less to muster.', { siegeAtk: 0.25, siegeCost: -0.25 }),
  T('black_powder', 'military', 3, 'Black Powder', ['siegecraft', 'fortification'],
    'Unlocks the Arquebusier and Bombard Crew companies.', { unlock: ['arquebusiers', 'bombard'] }),
  // Arcana
  T('attunement', 'arcana', 0, 'Shard Attunement', [],
    'Your shards recharge 50% faster.', { recharge: 0.5 }),
  T('warding', 'arcana', 1, 'Warding Circles', ['attunement'],
    'Enemy spirits that fight you arrive weakened: 30% less essence.', { ward: 0.30 }),
  T('beast_taming', 'arcana', 1, 'Beast-Taming', ['attunement'],
    'Monster companies cost 30% less to hire and to pay.', { monsterCost: -0.30 }),
  T('lantern_lore', 'arcana', 2, 'Lantern Lore', ['warding'],
    'Your spirits gain 25% essence, and each summon leaves 20 charge in the shard.', { spiritEssence: 0.25, chargeRefund: 20 }),
];

export const TECH_BY_ID = Object.fromEntries(TECHS.map(t => [t.id, t]));
export const techsOf = branch => TECHS.filter(t => t.branch === branch);

// Research leanings of the AI houses (branch weights).
export const RESEARCH_LEANING = {
  aldmere:   { agriculture: 3, commerce: 2, military: 2, arcana: 1 },
  corvane:   { arcana: 3, military: 2, commerce: 1, agriculture: 1 },
  isolde:    { commerce: 3, arcana: 2, agriculture: 1, military: 1 },
  hrothgar:  { military: 3, agriculture: 2, arcana: 1, commerce: 1 },
  seraphine: { arcana: 3, agriculture: 2, military: 2, commerce: 1 },
  vey:       { agriculture: 3, arcana: 2, military: 1, commerce: 1 },
};
