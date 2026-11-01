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
export const SPIRIT_IDS = Object.keys(SPIRITS);
