// Rulers and vassals. Original characters.
// Stats 1-100: might (battle attack/defence), wits (spying, spells, tactics), charm (diplomacy,
// loyalty of the governed province), loyalty (to their house; rulers are always 100).
// troop: starting troop type; soldiers: starting soldiers; at: starting province.
// portrait: art slot (docs/SHOTLIST.md: rulers 16-21, vassals 22-51).

const V = (id, house, name, title, might, wits, charm, loyalty, troop, soldiers, at, portrait) =>
  ({ id, house, name, title, might, wits, charm, loyalty, troop, soldiers, at, portrait });

export const VASSALS = [
  // Aldmere (capital 8 Aldford, also 9 Kingsrest)
  V('aldmere_0', 'aldmere', 'Lord Edric Aldmere', 'River Lord',        62, 70, 78, 100, 'knights', 220, 8, 16),
  V('aldmere_1', 'aldmere', 'Ser Halden Brook',   'Knight of the Ford', 78, 45, 52, 82, 'knights', 180, 8, 22),
  V('aldmere_2', 'aldmere', 'Wynn Calloway',      'Tactician',          40, 88, 60, 76, 'archers', 150, 9, 23),
  V('aldmere_3', 'aldmere', 'Maren Ashby',        'Archer Captain',     66, 58, 55, 80, 'archers', 170, 9, 24),
  V('aldmere_4', 'aldmere', 'Tobin Ferrow',       'Ferryman General',   72, 50, 48, 70, 'footmen', 200, 8, 25),
  V('aldmere_5', 'aldmere', 'Old Pell',           'Steward',            25, 75, 82, 90, 'footmen', 100, 9, 26),
  // Corvane (capital 1 Ravenscar, also 2 Greywatch)
  V('corvane_0', 'corvane', 'Queen Morwen Corvane', 'Raven Queen',      55, 85, 60, 100, 'horse',   200, 1, 17),
  V('corvane_1', 'corvane', 'The Masked Rook',    'Spymaster',          45, 92, 40, 68, 'archers', 130, 1, 27),
  V('corvane_2', 'corvane', 'Brannoc the Axe',    'Axeman',             88, 30, 35, 74, 'footmen', 240, 2, 28),
  V('corvane_3', 'corvane', 'Ysolt Rime',         'Frost-Witch',        38, 86, 50, 72, 'archers', 120, 1, 29),
  V('corvane_4', 'corvane', 'Caius Corvane',      'Heir',               60, 62, 66, 88, 'horse',   160, 2, 30),
  V('corvane_5', 'corvane', 'Ulf One-Eye',        'Marshal',            80, 55, 40, 70, 'horse',   200, 2, 31),
  // Isolde (capital 11 Gullhaven, also 17 Pearlcoast)
  V('isolde_0',  'isolde',  'Prince Lucan Isolde', 'Merchant Prince',   45, 80, 88, 100, 'footmen', 180, 11, 18),
  V('isolde_1',  'isolde',  'Admiral Sera Vance', 'Privateer Admiral',  74, 62, 58, 70, 'archers', 180, 11, 32),
  V('isolde_2',  'isolde',  'Count Ottavio',      'Diplomat',           28, 72, 94, 78, 'footmen', 110, 17, 33),
  V('isolde_3',  'isolde',  'Mira Quell',         'Alchemist',          35, 90, 55, 74, 'siege',   90,  11, 34),
  V('isolde_4',  'isolde',  'Captain Dunmore',    'Harbour Guard',      70, 48, 50, 82, 'pikes',   200, 17, 35),
  V('isolde_5',  'isolde',  'Jory Swift',         'Gambler Duelist',    76, 60, 70, 55, 'horse',   140, 17, 36),
  // Hrothgar (capital 12 Bramblefell, also 6 Highcairn)
  V('hrothgar_0','hrothgar','Chief Bram Hrothgar', 'Clan Chief',        86, 50, 64, 100, 'footmen', 260, 12, 19),
  V('hrothgar_1','hrothgar','Sigrun Shieldwall',  'Shieldmaiden',       80, 46, 56, 86, 'pikes',   220, 12, 37),
  V('hrothgar_2','hrothgar','Aelric Moss',        'Hill Druid',         32, 84, 66, 80, 'archers', 120, 6, 38),
  V('hrothgar_3','hrothgar','Gorm Boarhelm',      'Berserker',          94, 22, 30, 72, 'footmen', 240, 6, 39),
  V('hrothgar_4','hrothgar','Granny Hild',        'Elder Chieftain',    30, 78, 80, 95, 'pikes',   140, 12, 40),
  V('hrothgar_5','hrothgar','Kestrel Vane',       'Horse-Tamer',        68, 52, 62, 76, 'horse',   160, 6, 41),
  // Seraphine (capital 21 Sunspire, also 22 Goldvale)
  V('seraphine_0','seraphine','High Mother Aurelie', 'High Priestess',  40, 82, 90, 100, 'pikes',   180, 21, 20),
  V('seraphine_1','seraphine','Ser Gideon Vale',  'Templar Paladin',    84, 50, 62, 92, 'knights', 160, 21, 42),
  V('seraphine_2','seraphine','The Blind Oracle', 'Oracle',             20, 95, 70, 88, 'archers', 100, 21, 43),
  V('seraphine_3','seraphine','Sister Amabel',    'Healer',             30, 70, 84, 94, 'footmen', 140, 22, 44),
  V('seraphine_4','seraphine','Inquisitor Thane', 'Inquisitor',         72, 66, 38, 80, 'knights', 160, 22, 45),
  V('seraphine_5','seraphine','Pilgrim Rowan',    'Pilgrim Knight',     70, 54, 68, 84, 'horse',   150, 22, 46),
  // Vey (capital 19 Reedwater, also 18 Mirefen)
  V('vey_0',     'vey',     'Warden Talia Vey',   'Marsh Warden',       64, 74, 76, 100, 'archers', 200, 19, 21),
  V('vey_1',     'vey',     'Fenn Hollowreed',    'Swamp Ranger',       70, 64, 50, 80, 'archers', 180, 19, 47),
  V('vey_2',     'vey',     'Nettle',             'Herbalist',          24, 82, 72, 84, 'footmen', 110, 18, 48),
  V('vey_3',     'vey',     'Elder Osk',          'Stilt-Village Elder',30, 70, 86, 90, 'pikes',   140, 18, 49),
  V('vey_4',     'vey',     'Big Gudrun',         'Eel-Fisher',         86, 28, 44, 74, 'footmen', 230, 19, 50),
  V('vey_5',     'vey',     'Silk',               'Smuggler',           58, 76, 60, 58, 'horse',   140, 18, 51),
];

export const VASSAL_BY_ID = Object.fromEntries(VASSALS.map(v => [v.id, v]));
