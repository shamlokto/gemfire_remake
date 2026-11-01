// Random and story events. Original text. art: event scene slot.
// Random events are rolled per province each month in their seasons (chance per province).
// effect keys are applied by js/realm/economy.js (fields, market, food, gold, loyalty, dikes
// are relative changes; `floodable` events are reduced by dikes).

export const RANDOM_EVENTS = [
  { id: 'bumper', title: 'Bumper Harvest', art: 90, seasons: [2], chance: 0.10,
    text: 'The granaries of {province} overflow. The people sing in the lanes.',
    effect: { foodPct: 0.5, loyalty: 6 } },
  { id: 'famine', title: 'Blight and Famine', art: 91, seasons: [1, 2], chance: 0.04,
    text: 'Blight withers the crops of {province}. Hungry eyes turn to the castle.',
    effect: { foodPct: -0.4, loyalty: -8, fields: -6 } },
  { id: 'flood', title: 'The River Rises', art: 92, seasons: [0], chance: 0.07, floodable: true,
    text: 'Spring melt bursts the banks around {province}. Farms lie under brown water.',
    effect: { fields: -12, foodPct: -0.2, dikes: -10 } },
  { id: 'plague', title: 'Grey Plague', art: 93, seasons: [1, 3], chance: 0.03,
    text: 'Plague doctors walk the streets of {province}. The garrisons thin.',
    effect: { soldiersPct: -0.15, market: -8, loyalty: -4 } },
  { id: 'revolt', title: 'Peasant Revolt', art: 94, seasons: [0, 1, 2, 3], chance: 0, // triggered by low loyalty
    text: 'Torches gather at the gates of {province}. The people will not be ignored.',
    effect: { goldPct: -0.5, foodPct: -0.3, soldiersPct: -0.1 } },
  { id: 'blizzard', title: 'Blizzard', art: 98, seasons: [3], chance: 0.06,
    text: 'A white storm buries {province}. Nothing moves for weeks.',
    effect: { foodPct: -0.15, market: -4 } },
];

// Story beats shown once.
export const STORY = {
  prologue: { art: 99, title: 'The Lantern Falls',
    text: 'For three hundred years the High Lantern burned over Lanterncross, and the five spirits of Varenhold slept in its light. ' +
      'On the night of the long eclipse it shattered. Its shards fell to the great houses, and with them the spirits woke: ' +
      'bound, restless, and hungry for a master. Now every lord in Varenhold dreams of the crown the Lantern once guarded.' },
  betrayal: { art: 95, title: 'Betrayal',
    text: '{vassal} has turned their banner. They now serve {house}.' },
  marriage: { art: 96, title: 'A Marriage Pact',
    text: 'Bells ring in {capital}. {house} and {other} are bound by marriage: neither will march on the other for three years.' },
  siege: { art: 97, title: 'Siege',
    text: 'Fire arrows arc over the walls of {province}.' },
  victory: { art: 8, title: 'The Lantern Rekindled',
    text: '{house} holds Varenhold. The shards are set into a new lantern, and the spirits settle into its light.' },
  defeat: { art: 9, title: 'The Last Banner Falls',
    text: 'Your last province is lost. The house of {house} passes into song.' },
  ending: { art: 100, title: 'Peace of the Five',
    text: 'The five spirits circle the rekindled Lantern. For the first time in a generation, Varenhold sleeps without fear.' },
};
