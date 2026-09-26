import { describe, expect, it } from 'vitest';
import {
  BUILDING_DEFS,
  GameError,
  canPlace,
  collect,
  createStarterNest,
  generateBotNest,
  housingCapacity,
  placeBuilding,
  rushBuilding,
  storageCapacity,
  tickNest,
  trainDuck,
  upgradeBuilding,
} from '../src';
import type { NestState } from '../src';

const T0 = 1_700_000_000_000;

function assertNoOverlaps(nest: NestState) {
  for (const b of nest.buildings) {
    const others = nest.buildings.filter((o) => o !== b);
    expect(canPlace(others, b.kind, b.x, b.y), `${b.kind}@${b.x},${b.y}`).toBe(true);
  }
}

describe('starter nest', () => {
  it('has a valid, non-overlapping layout', () => {
    assertNoOverlaps(createStarterNest(T0));
  });
});

describe('construction', () => {
  it('uses a builder, finishes on time, and respects builder count', () => {
    const nest = createStarterNest(T0);
    const grainBefore = nest.resources.grain;
    const field = placeBuilding(nest, 'grainField', 5, 5, T0);
    expect(field.level).toBe(0);
    expect(nest.resources.grain).toBe(grainBefore - BUILDING_DEFS.grainField.levels[0].cost.grain);
    // Only one Construction Duck: a second timed build must wait.
    expect(() => upgradeBuilding(nest, nest.buildings[0].id, T0)).toThrow(GameError);
    tickNest(nest, T0 + 9_999);
    expect(field.level).toBe(0);
    tickNest(nest, T0 + 10_000);
    expect(field.level).toBe(1);
    expect(field.upgradingTo).toBeNull();
  });

  it('builds walls instantly without a builder', () => {
    const nest = createStarterNest(T0);
    placeBuilding(nest, 'grainField', 5, 5, T0);
    const wall = placeBuilding(nest, 'reedWall', 2, 2, T0);
    expect(wall.level).toBe(1);
  });

  it('rejects overlapping placement and over-limit counts', () => {
    const nest = createStarterNest(T0);
    expect(() => placeBuilding(nest, 'grainField', 16, 16, T0)).toThrow(/taken/);
    expect(() => placeBuilding(nest, 'hawkPerch', 2, 2, T0)).toThrow(/Nest Core/);
  });

  it('lets pebbles rush a build', () => {
    const nest = createStarterNest(T0);
    const f = placeBuilding(nest, 'grainField', 5, 5, T0);
    rushBuilding(nest, f.id, T0 + 1000);
    expect(f.level).toBe(1);
    expect(nest.resources.pebbles).toBe(24);
  });

  it('caps building level at the Nest Core level', () => {
    const nest = createStarterNest(T0);
    const granary = nest.buildings.find((b) => b.kind === 'granary')!;
    expect(() => upgradeBuilding(nest, granary.id, T0)).toThrow(/Nest Core first/);
  });
});

describe('production', () => {
  it('collects grain, with the farmer boost, capped by storage', () => {
    const nest = createStarterNest(T0);
    const field = nest.buildings.find((b) => b.kind === 'grainField')!;
    const before = nest.resources.grain;
    // 30 minutes at 600/h * 1.5 (farmer) = 450
    const got = collect(nest, field.id, T0 + 30 * 60_000);
    expect(got).toBe(450);
    expect(nest.resources.grain).toBe(before + 450);

    nest.resources.grain = storageCapacity(nest).grain - 100;
    const got2 = collect(nest, field.id, T0 + 90 * 60_000);
    expect(got2).toBe(100);
  });
});

describe('hatching', () => {
  it('queues ducks sequentially and respects housing', () => {
    const nest = createStarterNest(T0);
    nest.army = {};
    nest.resources.grain = 5000;
    trainDuck(nest, 'mallard', T0);
    trainDuck(nest, 'mallard', T0);
    expect(nest.trainingQueue.map((q) => q.readyAt - T0)).toEqual([4000, 8000]);
    tickNest(nest, T0 + 4000);
    expect(nest.army.mallard).toBe(1);
    for (let i = nest.trainingQueue.length + 1; i < housingCapacity(nest); i++) trainDuck(nest, 'mallard', T0);
    expect(() => trainDuck(nest, 'mallard', T0)).toThrow(/room/);
  });

  it('locks advanced ducks behind hatchery level', () => {
    const nest = createStarterNest(T0);
    expect(() => trainDuck(nest, 'medic', T0)).toThrow(/level 3 Hatchery/);
  });

  it('caps farmers by grain fields', () => {
    const nest = createStarterNest(T0);
    nest.resources.grain = 5000;
    expect(() => trainDuck(nest, 'farmer', T0)).toThrow(/Grain Field/);
  });
});

describe('bot nests', () => {
  for (const level of [1, 2, 3]) {
    it(`generates a valid level ${level} nest`, () => {
      for (let seed = 1; seed <= 20; seed++) {
        const nest = generateBotNest(seed, level, T0);
        assertNoOverlaps(nest);
        for (const kind of Object.keys(BUILDING_DEFS) as Array<keyof typeof BUILDING_DEFS>) {
          const n = nest.buildings.filter((b) => b.kind === kind).length;
          expect(n).toBeLessThanOrEqual(BUILDING_DEFS[kind].maxCount[level - 1]);
        }
        expect(nest.buildings.every((b) => b.level >= 1 && b.level <= level)).toBe(true);
      }
    });
  }
});
