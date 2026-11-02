// The five Lantern spirits. A house holding a spirit's shard can call it into one battle per
// season, if a vassal is present at that battle. Each spirit casts its spell once per battle.
// Original to Lanternfall. art: portrait slot; fx: spell effect slot.

export const SPIRITS = {
  ember: { name: 'Ember Stag',   element: 'fire',   art: 52, fx: 85, color: '#ff7a2f',
           spell: 'Wildfire', shape: 'line', length: 6, power: 0.30,
           text: 'Burns a line of six squares: each unit in it loses 30% of its soldiers.' },
  tide:  { name: 'Tide Serpent', element: 'water',  art: 53, fx: 86, color: '#3fb6ff',
           spell: 'Flood', shape: 'area', radius: 2, power: 0.12, slow: 2,
           text: 'Floods a 5x5 area: units lose 12% and cannot move for two rounds.' },
  gale:  { name: 'Gale Owl',     element: 'storm',  art: 54, fx: 87, color: '#d6e4ff',
           spell: 'Thunderhead', shape: 'targets', count: 3, power: 0.22,
           text: 'Lightning strikes the three largest enemy units for 22% each.' },
  stone: { name: 'Stone Warden', element: 'earth',  art: 55, fx: 88, color: '#b08d57',
           spell: 'Bulwark', shape: 'wall', length: 5, duration: 4,
           text: 'Raises a five-square stone wall for four rounds. Friendly units next to it defend +50%.' },
  dusk:  { name: 'Dusk Moth',    element: 'shadow', art: 56, fx: 89, color: '#9a6bff',
           spell: 'Bewilder', shape: 'area', radius: 2, confuse: 2,
           text: 'Enemy units in a 5x5 area are confused for two rounds: they stand still or strike their own side.' },
};
// A summoned spirit takes an army's 5th slot and fights on the board as a unit. `soldiers` is its
// essence: it is banished (routs) like any unit. It casts its spell once per battle.
export const SPIRIT_UNIT = {
  ember: { atk: 20, def: 14, move: 5, range: 1, soldiers: 120 },
  tide:  { atk: 15, def: 18, move: 4, range: 2, soldiers: 140 },
  gale:  { atk: 16, def: 12, move: 7, range: 3, soldiers: 100, flying: true },
  stone: { atk: 18, def: 24, move: 2, range: 1, soldiers: 160 },
  dusk:  { atk: 14, def: 14, move: 6, range: 2, soldiers: 110, flying: true },
};
export const SPIRIT_IDS = Object.keys(SPIRITS);
