// Varenhold: 24 provinces on a 6x4 layout. Coordinates are in map space (1000 x 750),
// matching the world map image (slot 010). Everything here is original to Lanternfall.

export const MAP_W = 1000;
export const MAP_H = 750;

// terrain: plains | forest | hills | mountain | marsh | coast
export const PROVINCES = [
  { id: 0,  name: 'Frosthelm',    x: 95,  y: 105, terrain: 'mountain' },
  { id: 1,  name: 'Ravenscar',    x: 255, y: 90,  terrain: 'hills' },
  { id: 2,  name: 'Greywatch',    x: 420, y: 115, terrain: 'forest' },
  { id: 3,  name: 'Coldmere',     x: 585, y: 95,  terrain: 'plains' },
  { id: 4,  name: 'Ironpeak',     x: 745, y: 110, terrain: 'mountain' },
  { id: 5,  name: 'Skerry',       x: 905, y: 100, terrain: 'coast' },
  { id: 6,  name: 'Highcairn',    x: 110, y: 270, terrain: 'hills' },
  { id: 7,  name: 'Thornwood',    x: 270, y: 285, terrain: 'forest' },
  { id: 8,  name: 'Aldford',      x: 435, y: 265, terrain: 'plains' },
  { id: 9,  name: 'Kingsrest',    x: 595, y: 285, terrain: 'plains' },
  { id: 10, name: 'Saltmarch',    x: 755, y: 270, terrain: 'hills' },
  { id: 11, name: 'Gullhaven',    x: 910, y: 285, terrain: 'coast' },
  { id: 12, name: 'Bramblefell',  x: 95,  y: 450, terrain: 'hills' },
  { id: 13, name: 'Oakhollow',    x: 260, y: 465, terrain: 'forest' },
  { id: 14, name: 'Lanterncross', x: 430, y: 445, terrain: 'plains' },
  { id: 15, name: 'Millbrook',    x: 590, y: 460, terrain: 'plains' },
  { id: 16, name: 'Amberfield',   x: 750, y: 445, terrain: 'plains' },
  { id: 17, name: 'Pearlcoast',   x: 905, y: 465, terrain: 'coast' },
  { id: 18, name: 'Mirefen',      x: 110, y: 630, terrain: 'marsh' },
  { id: 19, name: 'Reedwater',    x: 270, y: 645, terrain: 'marsh' },
  { id: 20, name: 'Fenwick',      x: 430, y: 625, terrain: 'marsh' },
  { id: 21, name: 'Sunspire',     x: 595, y: 640, terrain: 'hills' },
  { id: 22, name: 'Goldvale',     x: 755, y: 625, terrain: 'plains' },
  { id: 23, name: 'Tidesend',     x: 905, y: 640, terrain: 'coast' },
];

// Orthogonal neighbours on the 6x4 grid, plus a few diagonal roads.
const EXTRA_ROADS = [[1, 8], [8, 15], [14, 21], [10, 17], [13, 18], [3, 10]];

function buildAdjacency() {
  const adj = PROVINCES.map(() => new Set());
  const link = (a, b) => { adj[a].add(b); adj[b].add(a); };
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 6; c++) {
      const id = r * 6 + c;
      if (c < 5) link(id, id + 1);
      if (r < 3) link(id, id + 6);
    }
  }
  for (const [a, b] of EXTRA_ROADS) link(a, b);
  return adj.map(s => [...s].sort((a, b) => a - b));
}

export const ADJACENCY = buildAdjacency();

export function neighbours(id) { return ADJACENCY[id]; }
export function isAdjacent(a, b) { return ADJACENCY[a].includes(b); }

// Starting baseline for every province (houses override their own).
export const PROVINCE_DEFAULTS = {
  fields: 30, market: 25, dikes: 20, loyalty: 55, food: 120, gold: 80,
};

// Free holds (unowned provinces) defend with militia of this size.
export const NEUTRAL_MILITIA = { min: 60, max: 140 };

export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
export const MONTHS = ['Thaw', 'Seedtide', 'Bloom', 'Highsun', 'Haymonth', 'Goldmonth',
  'Harvest', 'Leaffall', 'Frostwake', 'Deepwinter', 'Longnight', 'Icebreak'];
export function seasonOf(month) { return Math.floor(month / 3); }
export const START_YEAR = 412;
