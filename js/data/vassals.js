// Rulers and vassals. Original characters.
// Stats 1-100: might (battle attack/defence), wits (spying, spells, tactics), charm (diplomacy,
// loyalty of the governed province), loyalty (to their house; rulers are always 100).
// troop/soldiers: the unit this vassal leads at the start; at: starting province.
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
  // Corvane (capital 2 Ravenscar, also 3 Greywatch)
  V('corvane_0', 'corvane', 'Queen Morwen Corvane', 'Raven Queen',      55, 85, 60, 100, 'horse',   200, 2, 17),
  V('corvane_1', 'corvane', 'The Masked Rook',    'Spymaster',          45, 92, 40, 68, 'archers', 130, 2, 27),
  V('corvane_2', 'corvane', 'Brannoc the Axe',    'Axeman',             88, 30, 35, 74, 'footmen', 240, 3, 28),
  V('corvane_3', 'corvane', 'Ysolt Rime',         'Frost-Witch',        38, 86, 50, 72, 'archers', 120, 2, 29),
  V('corvane_4', 'corvane', 'Caius Corvane',      'Heir',               60, 62, 66, 88, 'horse',   160, 3, 30),
  V('corvane_5', 'corvane', 'Ulf One-Eye',        'Marshal',            80, 55, 40, 70, 'horse',   200, 3, 31),
  // Isolde (capital 21 Gullhaven, also 22 Pearlcoast)
  V('isolde_0',  'isolde',  'Prince Lucan Isolde', 'Merchant Prince',   45, 80, 88, 100, 'footmen', 180, 21, 18),
  V('isolde_1',  'isolde',  'Admiral Sera Vance', 'Privateer Admiral',  74, 62, 58, 70, 'archers', 180, 21, 32),
  V('isolde_2',  'isolde',  'Count Ottavio',      'Diplomat',           28, 72, 94, 78, 'footmen', 110, 22, 33),
  V('isolde_3',  'isolde',  'Mira Quell',         'Alchemist',          35, 90, 55, 74, 'siege',   90,  21, 34),
  V('isolde_4',  'isolde',  'Captain Dunmore',    'Harbour Guard',      70, 48, 50, 82, 'pikes',   200, 22, 35),
  V('isolde_5',  'isolde',  'Jory Swift',         'Gambler Duelist',    76, 60, 70, 55, 'horse',   140, 22, 36),
  // Hrothgar (capital 11 Bramblefell, also 6 Highcairn)
  V('hrothgar_0','hrothgar','Chief Bram Hrothgar', 'Clan Chief',        86, 50, 64, 100, 'footmen', 260, 11, 19),
  V('hrothgar_1','hrothgar','Sigrun Shieldwall',  'Shieldmaiden',       80, 46, 56, 86, 'pikes',   220, 11, 37),
  V('hrothgar_2','hrothgar','Aelric Moss',        'Hill Druid',         32, 84, 66, 80, 'archers', 120, 6, 38),
  V('hrothgar_3','hrothgar','Gorm Boarhelm',      'Berserker',          94, 22, 30, 72, 'footmen', 240, 6, 39),
  V('hrothgar_4','hrothgar','Granny Hild',        'Elder Chieftain',    30, 78, 80, 95, 'pikes',   140, 11, 40),
  V('hrothgar_5','hrothgar','Kestrel Vane',       'Horse-Tamer',        68, 52, 62, 76, 'horse',   160, 6, 41),
  // Seraphine (capital 19 Sunspire, also 20 Goldvale)
  V('seraphine_0','seraphine','High Mother Aurelie', 'High Priestess',  40, 82, 90, 100, 'pikes',   180, 19, 20),
  V('seraphine_1','seraphine','Ser Gideon Vale',  'Templar Paladin',    84, 50, 62, 92, 'knights', 160, 19, 42),
  V('seraphine_2','seraphine','The Blind Oracle', 'Oracle',             20, 95, 70, 88, 'archers', 100, 19, 43),
  V('seraphine_3','seraphine','Sister Amabel',    'Healer',             30, 70, 84, 94, 'footmen', 140, 20, 44),
  V('seraphine_4','seraphine','Inquisitor Thane', 'Inquisitor',         72, 66, 38, 80, 'knights', 160, 20, 45),
  V('seraphine_5','seraphine','Pilgrim Rowan',    'Pilgrim Knight',     70, 54, 68, 84, 'horse',   150, 20, 46),
  // Vey (capital 17 Reedwater, also 16 Mirefen)
  V('vey_0',     'vey',     'Warden Talia Vey',   'Marsh Warden',       64, 74, 76, 100, 'archers', 200, 17, 21),
  V('vey_1',     'vey',     'Fenn Hollowreed',    'Swamp Ranger',       70, 64, 50, 80, 'archers', 180, 17, 47),
  V('vey_2',     'vey',     'Nettle',             'Herbalist',          24, 82, 72, 84, 'footmen', 110, 16, 48),
  V('vey_3',     'vey',     'Elder Osk',          'Stilt-Village Elder',30, 70, 86, 90, 'pikes',   140, 16, 49),
  V('vey_4',     'vey',     'Big Gudrun',         'Eel-Fisher',         86, 28, 44, 74, 'footmen', 230, 17, 50),
  V('vey_5',     'vey',     'Silk',               'Smuggler',           58, 76, 60, 58, 'horse',   140, 16, 51),
];

// Wanderers: free characters with no house, roaming the free holds (house null). They can be
// invited by diplomacy ("Invite a wanderer") from a province in or next to theirs, and may offer
// their service to whoever conquers the province they are in. Each brings a small band.
// prompt: the portrait prompt (docs/SHOTLIST-EXTRA.md, slots 235-264).
const W = (id, name, title, might, wits, charm, troop, soldiers, at, portrait, prompt) =>
  ({ id, house: null, name, title, might, wits, charm, loyalty: 60, troop, soldiers, at, portrait, prompt, wanderer: true });

export const WANDERERS = [
  W('w_orla',    'Orla Fenmarch',     'Hedge Knight',        72, 48, 58, 'knights', 120, 0,  235, 'a weathered hedge knight with a dented helm under her arm, frost in her braids'),
  W('w_tamsin',  'Tamsin Greaves',    'Exiled Captain',      74, 55, 46, 'footmen', 160, 0,  236, 'a grim exiled captain in a patched grey cloak, scar across the lip'),
  W('w_bors',    'Bors Ashcombe',     'Lighthouse Keeper',   48, 62, 70, 'archers', 110, 1,  237, 'an old lighthouse keeper with a lantern and a fisherman\'s jumper, kind eyes'),
  W('w_ilse',    'Ilse Varrow',       'Sea-Witch',           30, 88, 60, 'archers', 90,  1,  238, 'a sea-witch with shells woven in her silver hair, glowing blue tattoos'),
  W('w_dunstan', 'Dunstan Coldwater', 'Ice Fisher',          66, 40, 52, 'pikes',   150, 4,  239, 'a broad ice fisher in furs holding a long harpoon, breath steaming'),
  W('w_mira',    'Mira of the Pass',  'Mountain Guide',      58, 70, 64, 'archers', 120, 5,  240, 'a lean mountain guide with a climbing axe and goggles pushed up, wind-burned cheeks'),
  W('w_gareth',  'Gareth Ironhand',   'Smith-Lord',          80, 52, 44, 'footmen', 170, 5,  241, 'a soot-stained smith-lord with an iron prosthetic hand and leather apron'),
  W('w_wren',    'Wren Thistle',      'Outlaw Archer',       64, 66, 60, 'archers', 140, 7,  242, 'a young outlaw archer in a green hood with a fletched arrow behind her ear'),
  W('w_hollis',  'Brother Hollis',    'Wandering Monk',      40, 74, 86, 'footmen', 100, 7,  243, 'a gentle wandering monk with a shaved head, prayer beads and a walking staff'),
  W('w_cassia',  'Cassia Saltwind',   'Caravan Mistress',    36, 72, 84, 'horse',   110, 10, 244, 'a shrewd caravan mistress in layered silks with a ledger and a jewelled dagger'),
  W('w_roderick','Roderick Vane',     'Disgraced Knight',    82, 44, 38, 'knights', 140, 10, 245, 'a disgraced knight with a broken spur and a torn tabard, proud jaw'),
  W('w_elowen',  'Elowen Rook',       'Forest Warden',       60, 68, 66, 'archers', 130, 12, 246, 'a forest warden with oak-leaf pauldrons and a falcon on her shoulder'),
  W('w_quill',   'Master Quill',      'Royal Cartographer',  22, 92, 70, 'archers', 80,  12, 247, 'an elderly royal cartographer with spectacles, ink-stained fingers and rolled maps'),
  W('w_hale',    'Sister Hale',       'Keeper of the Lantern', 34, 84, 82, 'pikes', 110, 13, 248, 'a lantern-keeper nun in pale robes holding a cracked glass lantern'),
  W('w_alaric',  'Alaric Dawnmere',   'Pretender Prince',    56, 64, 80, 'knights', 150, 13, 249, 'a handsome young pretender prince with a thin circlet and a too-large cloak'),
  W('w_bram',    'Old Bram Miller',   'Miller\'s Champion',  70, 36, 62, 'footmen', 180, 14, 250, 'a burly old miller with flour on his forearms and a great two-handed flail'),
  W('w_sorrel',  'Sorrel Quickfoot',  'Courier',             50, 70, 68, 'horse',   120, 14, 251, 'a wiry courier in a riding coat with message tubes on a bandolier'),
  W('w_joss',    'Joss Amberly',      'Free Company Sergeant', 76, 50, 50, 'pikes', 170, 15, 252, 'a gruff free-company sergeant with a halberd and a mismatched breastplate'),
  W('w_lys',     'Lys Goldenreed',    'Harvest Priestess',   28, 76, 88, 'footmen', 100, 15, 253, 'a harvest priestess crowned with wheat, sun-browned, warm smile'),
  W('w_nyx',     'Nyx Hollowbrook',   'Bog Seer',            26, 90, 54, 'archers', 90,  18, 254, 'a bog seer with mud-streaked robes, a staff of twisted roots and pale green eyes'),
  W('w_corwin',  'Corwin Reedhollow', 'Eel Baron',           62, 58, 56, 'footmen', 150, 18, 255, 'a self-styled eel baron in a fur-trimmed coat over waders, gold tooth'),
  W('w_tobiah',  'Tobiah Sund',       'Pearl Merchant',      30, 78, 80, 'horse',   100, 23, 256, 'a pearl merchant with a string of pearls, a velvet cap and a sly look'),
  W('w_maren',   'Captain Maren Blythe', 'Corsair',          74, 62, 58, 'archers', 140, 23, 257, 'a corsair captain with a tricorn hat, salt-stained coat and a cutlass'),
  W('w_hugo',    'Hugo Westbrand',    'Causeway Warden',     70, 54, 52, 'pikes',   160, 24, 258, 'a causeway warden in a rain cloak with a lantern pole and a heavy pike'),
  W('w_greta',   'Greta Stonecairn',  'Clan Outcast',        84, 40, 42, 'footmen', 170, 24, 259, 'a towering clan outcast with braided red hair, a hammer and a broken torc'),
  W('w_fennick', 'Fennick the Fox',   'Thief-Lord',          46, 82, 70, 'horse',   110, 25, 260, 'a smiling thief-lord in a fox-fur collar, many rings, one gold earring'),
  W('w_aurek',   'Aurek Cliffborn',   'Eagle Rider',         68, 60, 54, 'horse',   120, 25, 261, 'a cliff-dweller eagle rider in feathered leathers with a long spear'),
  W('w_solenne', 'Solenne Brightwater', 'Island Physician',  24, 80, 84, 'footmen', 90,  26, 262, 'an island physician with a satchel of herbs, rolled sleeves and calm eyes'),
  W('w_vulcan',  'Ember Vask',        'Volcano Hermit',      58, 86, 40, 'archers', 100, 27, 263, 'a volcano hermit with ash-grey skin, glowing ember eyes and a basalt staff'),
  W('w_isa',     'Isa Cinderfall',    'Firebrand',           78, 56, 60, 'knights', 130, 27, 264, 'a fiery young firebrand knight with scorched armour and a burning brand'),
];

// Heirs: one per house, who come of age `years` after the game begins and appear at the house's
// capital with a unit. If the house has fallen, they become wanderers there instead.
const H = (id, house, name, title, might, wits, charm, troop, soldiers, years, portrait, prompt) =>
  ({ id, house, name, title, might, wits, charm, loyalty: 90, troop, soldiers, years, portrait, prompt, heir: true });

export const HEIRS = [
  H('heir_aldmere',   'aldmere',   'Rowan Aldmere',   'Heir of the River', 64, 66, 74, 'knights', 160, 4, 265, 'a young heir of a river house, silver-blond, blue doublet with an otter brooch'),
  H('heir_corvane',   'corvane',   'Sable Corvane',   'Raven Princess',    58, 82, 56, 'horse',   150, 5, 266, 'a pale raven princess with black feathers in her hair and a cold, clever gaze'),
  H('heir_isolde',    'isolde',    'Marco Isolde',    'Merchant Heir',     52, 70, 84, 'archers', 140, 3, 267, 'a charming merchant heir in teal silk with a compass pendant'),
  H('heir_hrothgar',  'hrothgar',  'Brynja Hrothgar', 'Clan Heir',         82, 46, 58, 'footmen', 200, 4, 268, 'a fierce young clan heir with red braids, fur cloak and a bronze torc'),
  H('heir_seraphine', 'seraphine', 'Aurel of Seraphine', 'Acolyte-Knight', 70, 68, 76, 'knights', 150, 6, 269, 'a radiant acolyte-knight in white and gold armour with a sun emblem'),
  H('heir_vey',       'vey',       'Reed Vey',        'Marsh Heir',        60, 72, 70, 'archers', 150, 5, 270, 'a lanky marsh heir with a reed crown, green leathers and a longbow'),
];

export const ALL_CHARACTERS = [...VASSALS, ...WANDERERS, ...HEIRS];
export const VASSAL_BY_ID = Object.fromEntries(ALL_CHARACTERS.map(v => [v.id, v]));
