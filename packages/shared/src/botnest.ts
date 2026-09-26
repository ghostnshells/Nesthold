import { BUILDING_DEFS } from './data/buildings';
import { GRID_SIZE } from './iso';
import { buildOccupancy } from './nest';
import { Rng } from './rng';
import type { BuildingKind, NestState, PlacedBuilding } from './types';

const PLACE_ORDER: BuildingKind[] = [
  'catapult',
  'heron',
  'birdshot',
  'granary',
  'hatchery',
  'hawkPerch',
  'pigeonLoft',
  'grainField',
  'featherLoom',
  'matingHorn',
  'feedScatterer',
  'turtlePit',
];

/** Procedurally lays out a believable AI nest for single-player raiding. */
export function generateBotNest(seed: number, coreLevel: number, now: number): NestState {
  const rng = new Rng(seed);
  const lvl = () => Math.max(1, Math.min(coreLevel, coreLevel - (rng.next() < 0.3 ? 1 : 0)));
  const nest: NestState = {
    buildings: [],
    resources: {
      grain: 1500 * coreLevel + rng.int(0, 1500 * coreLevel),
      feathers: 500 * coreLevel + rng.int(0, 600 * coreLevel),
      pebbles: 0,
    },
    army: {},
    economyDucks: { farmer: 0, builder: 1, molter: 0 },
    trainingQueue: [],
    nextId: 1,
  };
  const push = (kind: BuildingKind, x: number, y: number, level: number) => {
    const b: PlacedBuilding = { id: `b${nest.nextId++}`, kind, level, x, y };
    if (BUILDING_DEFS[kind].producer) b.lastCollectedAt = now;
    nest.buildings.push(b);
  };

  const c = 16;
  push('nestCore', c, c, coreLevel);

  // Inner ring of reeds hugging the core, then a partial outer ring.
  let walls = BUILDING_DEFS.reedWall.maxCount[coreLevel - 1];
  const ring = (lo: number, hi: number) => {
    const tiles: Array<[number, number]> = [];
    for (let i = lo; i <= hi; i++) tiles.push([i, lo], [i, hi]);
    for (let i = lo + 1; i < hi; i++) tiles.push([lo, i], [hi, i]);
    return tiles;
  };
  for (const [x, y] of ring(c - 1, c + 4)) if (walls-- > 0) push('reedWall', x, y, lvl());
  if (walls > 0) {
    const outer = ring(c - 7, c + 10);
    // Leave deliberate gaps so ground ducks have something to find.
    const gapEvery = rng.int(6, 9);
    outer.forEach(([x, y], i) => {
      if (walls > 0 && i % gapEvery !== 0) {
        push('reedWall', x, y, lvl());
        walls--;
      }
    });
  }

  for (const kind of PLACE_ORDER) {
    const def = BUILDING_DEFS[kind];
    const count = def.maxCount[coreLevel - 1];
    for (let n = 0; n < count; n++) {
      const trap = def.category === 'trap';
      const spread = trap ? 8 : 9;
      for (let attempt = 0; attempt < 300; attempt++) {
        const x = c + 2 - spread + rng.int(0, spread * 2) - Math.floor(def.size / 2);
        const y = c + 2 - spread + rng.int(0, spread * 2) - Math.floor(def.size / 2);
        if (fitsWithMargin(nest.buildings, x, y, def.size, trap ? 0 : 1)) {
          push(kind, x, y, lvl());
          break;
        }
      }
    }
  }
  return nest;
}

function fitsWithMargin(buildings: PlacedBuilding[], x: number, y: number, size: number, margin: number): boolean {
  if (x - margin < 1 || y - margin < 1 || x + size + margin > GRID_SIZE - 1 || y + size + margin > GRID_SIZE - 1) return false;
  const grid = buildOccupancy(buildings);
  for (let dy = -margin; dy < size + margin; dy++)
    for (let dx = -margin; dx < size + margin; dx++) if (grid[(y + dy) * GRID_SIZE + x + dx]) return false;
  return true;
}
