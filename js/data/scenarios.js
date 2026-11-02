// Scenarios: different starting moments of the struggle for Varenhold. Original to Lanternfall.
//   owners:   { house: [province ids] }  replaces the house's starting lands (capital first stays)
//   garrison: units (leaderless) added to every province a house gains beyond its usual two
//   scale:    multiplier on every starting unit's soldiers
//   goldMult: { house: x } multiplier on a house's starting gold and food
//   techs:    { house: [tech ids] } already researched
//   truces / marriages: [[a, b, months]]
//   charge:   starting charge of every shard (0-100)
// art: scene slot shown on the scenario card.

export const SCENARIOS = [
  {
    id: 'eclipse', name: 'The Night of the Eclipse', year: 412, art: 99,
    blurb: 'The Lantern has just shattered. Six houses hold two provinces each; half the realm is free holds waiting to be taken.',
    difficulty: 'Balanced',
  },
  {
    id: 'raven', name: 'The Raven Rises', year: 416, art: 186,
    blurb: 'Four years on, House Corvane has swallowed the north: seven provinces under the raven banner. The other houses are poor and scattered. Stand together, or fall one by one.',
    difficulty: 'Hard (easy as Corvane)',
    owners: { corvane: [2, 3, 0, 1, 4, 5, 7] },
    garrison: [['footmen', 150], ['archers', 120]],
    goldMult: { aldmere: 0.6, isolde: 0.6, hrothgar: 0.6, seraphine: 0.6, vey: 0.6 },
    techs: { corvane: ['drill_yards', 'attunement'] },
  },
  {
    id: 'crowns', name: 'Two Crowns', year: 418, art: 96,
    blurb: 'Weddings have split the realm in two: the Northern Compact (Corvane, Aldmere, Hrothgar) and the Southern League (Seraphine, Isolde, Vey). The pacts hold for three years. Then the crowns collide.',
    difficulty: 'Medium',
    owners: {
      corvane: [2, 3, 0, 1], aldmere: [8, 9, 4, 13], hrothgar: [11, 6, 24, 12],
      seraphine: [19, 20, 14, 26], isolde: [21, 22, 23, 10], vey: [17, 16, 18],
    },
    garrison: [['footmen', 140], ['pikes', 120]],
    marriages: [['corvane', 'aldmere', 36], ['aldmere', 'hrothgar', 36], ['corvane', 'hrothgar', 36],
      ['seraphine', 'isolde', 36], ['isolde', 'vey', 36], ['seraphine', 'vey', 36]],
    techs: { aldmere: ['crop_rotation'], isolde: ['markets'], seraphine: ['attunement'], corvane: ['drill_yards'] },
  },
  {
    id: 'lastshard', name: 'The Last Shard', year: 431, art: 222,
    blurb: 'Nineteen years of war. Three great powers (Corvane in the north, Seraphine in the south and Isolde\'s fleets in the east and west) divide the realm. Aldmere, Hrothgar and Vey cling to their homelands with veteran armies. No free holds remain.',
    difficulty: 'Hard',
    owners: {
      corvane: [2, 3, 0, 1, 4, 5, 7, 12], seraphine: [19, 20, 13, 14, 15, 18, 26, 27],
      isolde: [21, 22, 23, 10, 24, 25],
    },
    garrison: [['footmen', 200], ['archers', 160]],
    scale: 1.4,
    techs: {
      corvane: ['drill_yards', 'smithing', 'attunement', 'warding'],
      seraphine: ['attunement', 'warding', 'crop_rotation', 'granaries', 'drill_yards'],
      isolde: ['markets', 'guild_charters', 'harbour_fleets', 'caravans', 'crop_rotation'],
      aldmere: ['crop_rotation', 'drill_yards'], hrothgar: ['drill_yards', 'fortification'], vey: ['crop_rotation', 'attunement'],
    },
    charge: 60,
  },
];

export const SCENARIO_BY_ID = Object.fromEntries(SCENARIOS.map(s => [s.id, s]));
