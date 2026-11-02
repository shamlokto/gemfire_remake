// Varenhold: 28 provinces. A mainland, a marsh peninsula reached through a single province, and
// islands joined to the mainland by single sea lanes, so the map has real chokepoints and dead ends.
// Coordinates are in map space (1000 x 750), matching the world map image (slot 010).
// Everything here is original to Lanternfall.

export const MAP_W = 1000;
export const MAP_H = 750;

// terrain: plains | forest | hills | mountain | marsh | coast
// region: used for map drawing (each region is one landmass).
export const PROVINCES = [
  // Frost Isles (north-west), reached from Ravenscar by sea
  { id: 0,  name: 'Frosthelm',    x: 140, y: 70,  terrain: 'mountain', region: 'frost' },
  { id: 1,  name: 'Skerry',       x: 285, y: 55,  terrain: 'coast',    region: 'frost' },
  // Mainland, north row
  { id: 2,  name: 'Ravenscar',    x: 335, y: 160, terrain: 'hills',    region: 'main' },
  { id: 3,  name: 'Greywatch',    x: 480, y: 145, terrain: 'forest',   region: 'main' },
  { id: 4,  name: 'Coldmere',     x: 625, y: 155, terrain: 'plains',   region: 'main' },
  { id: 5,  name: 'Ironpeak',     x: 765, y: 140, terrain: 'mountain', region: 'main' },
  // Mainland, middle row
  { id: 6,  name: 'Highcairn',    x: 250, y: 285, terrain: 'hills',    region: 'main' },
  { id: 7,  name: 'Thornwood',    x: 390, y: 275, terrain: 'forest',   region: 'main' },
  { id: 8,  name: 'Aldford',      x: 530, y: 285, terrain: 'plains',   region: 'main' },
  { id: 9,  name: 'Kingsrest',    x: 670, y: 280, terrain: 'plains',   region: 'main' },
  { id: 10, name: 'Saltmarch',    x: 795, y: 300, terrain: 'hills',    region: 'main' },
  // Mainland, south row
  { id: 11, name: 'Bramblefell',  x: 265, y: 415, terrain: 'hills',    region: 'main' },
  { id: 12, name: 'Oakhollow',    x: 400, y: 425, terrain: 'forest',   region: 'main' },
  { id: 13, name: 'Lanterncross', x: 540, y: 410, terrain: 'plains',   region: 'main' },
  { id: 14, name: 'Millbrook',    x: 665, y: 425, terrain: 'plains',   region: 'main' },
  { id: 15, name: 'Amberfield',   x: 785, y: 435, terrain: 'plains',   region: 'main' },
  // Vey marsh peninsula: only Fenwick touches the mainland (through Lanterncross)
  { id: 16, name: 'Mirefen',      x: 215, y: 680, terrain: 'marsh',    region: 'main' },
  { id: 17, name: 'Reedwater',    x: 330, y: 615, terrain: 'marsh',    region: 'main' },
  { id: 18, name: 'Fenwick',      x: 440, y: 540, terrain: 'marsh',    region: 'main' },
  // Southern hills
  { id: 19, name: 'Sunspire',     x: 610, y: 560, terrain: 'hills',    region: 'main' },
  { id: 20, name: 'Goldvale',     x: 745, y: 565, terrain: 'plains',   region: 'main' },
  // Isle of Gulls (east), reached from Saltmarch by sea
  { id: 21, name: 'Gullhaven',    x: 920, y: 250, terrain: 'coast',    region: 'gulls' },
  { id: 22, name: 'Pearlcoast',   x: 935, y: 390, terrain: 'coast',    region: 'gulls' },
  { id: 23, name: 'Tidesend',     x: 905, y: 525, terrain: 'coast',    region: 'gulls' },
  // Westreach (west isle), reached from Highcairn over a causeway
  { id: 24, name: 'Westreach',    x: 85,  y: 330, terrain: 'hills',    region: 'west' },
  { id: 25, name: 'Cairnholm',    x: 70,  y: 480, terrain: 'mountain', region: 'west' },
  // Sunder Isles (south-east), reached from Goldvale by sea
  { id: 26, name: 'Sunderisle',   x: 820, y: 690, terrain: 'coast',    region: 'sunder' },
  { id: 27, name: 'Emberrock',    x: 950, y: 685, terrain: 'mountain', region: 'sunder' },
];

// Land borders.
const LAND = [
  [0, 1],
  [2, 3], [3, 4], [4, 5],
  [2, 6], [2, 7], [3, 7], [4, 9], [5, 10],
  [6, 7], [7, 8], [8, 9], [9, 10],
  [6, 11], [7, 12], [8, 13], [9, 14], [10, 15],
  [11, 12], [12, 13], [13, 14], [14, 15],
  [13, 18], [18, 17], [17, 16],
  [13, 19], [14, 19], [15, 20], [19, 20],
  [21, 22], [22, 23],
  [24, 25],
  [26, 27],
];
// Sea lanes and the causeway: the only ways onto the islands. Drawn as dotted sea routes.
export const SEA_LANES = [[1, 2], [10, 21], [6, 24], [20, 26]];

function buildAdjacency() {
  const adj = PROVINCES.map(() => new Set());
  for (const [a, b] of [...LAND, ...SEA_LANES]) { adj[a].add(b); adj[b].add(a); }
  return adj.map(s => [...s].sort((a, b) => a - b));
}

export const ADJACENCY = buildAdjacency();

export function neighbours(id) { return ADJACENCY[id]; }
export function isAdjacent(a, b) { return ADJACENCY[a].includes(b); }
export function isSeaLane(a, b) { return SEA_LANES.some(([x, y]) => (x === a && y === b) || (x === b && y === a)); }

// Starting baseline for every province (houses override their own).
export const PROVINCE_DEFAULTS = {
  fields: 30, market: 25, dikes: 20, loyalty: 55, food: 120, gold: 80,
};

// Free holds (unowned provinces) defend with 1-3 leaderless militia units totalling this many.
export const NEUTRAL_MILITIA = { min: 60, max: 140 };

export const VICTORY_PROVINCES = 20;

export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
export const MONTHS = ['Thaw', 'Seedtide', 'Bloom', 'Highsun', 'Haymonth', 'Goldmonth',
  'Harvest', 'Leaffall', 'Frostwake', 'Deepwinter', 'Longnight', 'Icebreak'];
export function seasonOf(month) { return Math.floor(month / 3); }
export const START_YEAR = 412;
