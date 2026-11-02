// The six ruling houses of Varenhold. Original to Lanternfall.
// color: banner colour (also used to tint troop sprites). shard: spirit bound to the house's
// Lantern Shard, kept in its capital (taking the capital takes the shard).

export const HOUSES = [
  {
    id: 'aldmere', name: 'House Aldmere', short: 'Aldmere', color: '#3b6fd1', accent: '#c9d8ff',
    motto: 'The river remembers.', ruler: 'aldmere_0', capital: 8, provinces: [8, 9],
    shard: 'tide', blurb: 'Old river lords of the central plains: rich fields, steady troops.',
  },
  {
    id: 'corvane', name: 'House Corvane', short: 'Corvane', color: '#3a3346', accent: '#b9a7d9',
    motto: 'We see all from the high crag.', ruler: 'corvane_0', capital: 2, provinces: [2, 3],
    shard: 'dusk', blurb: 'Northern ravens: poor land, cunning vassals, strong spies.',
  },
  {
    id: 'isolde', name: 'House Isolde', short: 'Isolde', color: '#178f8a', accent: '#a9efe8',
    motto: 'Every tide brings coin.', ruler: 'isolde_0', capital: 21, provinces: [21, 22],
    shard: 'gale', blurb: 'Merchant coast: deep coffers, fine companies for hire.',
  },
  {
    id: 'hrothgar', name: 'Clan Hrothgar', short: 'Hrothgar', color: '#8a5a2b', accent: '#f0c890',
    motto: 'Stone does not kneel.', ruler: 'hrothgar_0', capital: 11, provinces: [11, 6],
    shard: 'stone', blurb: 'Highland clans: hardy fighters, few farms.',
  },
  {
    id: 'seraphine', name: 'Order of Seraphine', short: 'Seraphine', color: '#d8b84a',
    accent: '#fff4c8', motto: 'Light before the dark.', ruler: 'seraphine_0', capital: 19,
    provinces: [19, 20], shard: 'ember', blurb: 'Temple order of the south: loyal people, zealous knights.',
  },
  {
    id: 'vey', name: 'Vey Marsh League', short: 'Vey', color: '#4f8f3a', accent: '#cdeeb0',
    motto: 'The reeds bend; they do not break.', ruler: 'vey_0', capital: 17, provinces: [17, 16],
    shard: null, blurb: 'Marsh folk with no shard of their own: they must win one.',
  },
];

export const HOUSE_BY_ID = Object.fromEntries(HOUSES.map(h => [h.id, h]));

// Starting province bonuses per house, applied on top of PROVINCE_DEFAULTS.
export const HOUSE_START = {
  aldmere:   { fields: 45, market: 30, food: 220, gold: 120, loyalty: 65 },
  corvane:   { fields: 35, market: 25, food: 180, gold: 110, loyalty: 60 },
  isolde:    { fields: 30, market: 50, food: 150, gold: 220, loyalty: 60 },
  hrothgar:  { fields: 25, market: 20, food: 160, gold: 90,  loyalty: 70 },
  seraphine: { fields: 35, market: 30, food: 180, gold: 120, loyalty: 80 },
  vey:       { fields: 35, market: 25, food: 170, gold: 100, loyalty: 70 },
};
