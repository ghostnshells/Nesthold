import type { BuildingKind, EconomyDuckKind, Resources } from '../types';

export type BuildingCategory = 'core' | 'resource' | 'army' | 'utility' | 'defense' | 'trap' | 'wall';
export const MAX_LEVEL = 3;

export interface LevelStats {
  cost: Resources;
  buildSeconds: number;
  hp: number;
}

export interface DefenseStats {
  range: number[];
  damage: number[];
  /** Ticks between shots. */
  cooldown: number;
  splash: number;
  targets: 'ground' | 'air' | 'both';
  /** Visual flavour for the renderer. */
  projectile: 'boulder' | 'pellets' | 'beak';
}

export interface TrapStats {
  effect: 'damage' | 'feed' | 'horn';
  /** A duck within this many tiles of the trap centre springs it. */
  triggerRadius: number;
  /** Ducks within this radius can be affected. */
  effectRadius: number;
  /** Hard cap on how many ducks one trigger can affect ("a handful"). */
  maxDucks: number[];
  /** How long a distraction lasts, in ticks ("a few seconds"). */
  durationTicks: number[];
  damage: number[];
  charges: number[];
  affectsAir: boolean;
}

export interface BuildingDef {
  kind: BuildingKind;
  name: string;
  blurb: string;
  size: number;
  category: BuildingCategory;
  levels: LevelStats[];
  /** Max number you may own, indexed by Nest Core level - 1. */
  maxCount: [number, number, number];
  colors: { top: number; side: number; accent: number };
  producer?: { resource: 'grain' | 'feathers'; perHour: number[]; capacity: number[]; boostedBy: EconomyDuckKind };
  storage?: { grain: number[]; feathers: number[] };
  hatchery?: { housing: number[] };
  defense?: DefenseStats;
  trap?: TrapStats;
  loft?: { speed: number[]; armor: number[]; cipher: boolean[] };
  hawk?: { radius: number[]; power: number[] };
}

const r = (grain: number, feathers = 0, pebbles = 0): Resources => ({ grain, feathers, pebbles });
const L = (cost: Resources, buildSeconds: number, hp: number): LevelStats => ({ cost, buildSeconds, hp });

export const BUILDING_DEFS: Record<BuildingKind, BuildingDef> = {
  nestCore: {
    kind: 'nestCore',
    name: 'Nest Core',
    blurb: 'The heart of your nest. Its level caps everything else. Lose it and you lose a star.',
    size: 4,
    category: 'core',
    levels: [L(r(0), 0, 1800), L(r(3000, 1000), 120, 2600), L(r(9000, 3000), 300, 3600)],
    maxCount: [1, 1, 1],
    colors: { top: 0xc9a66b, side: 0x8a6a3a, accent: 0xf2e8cf },
    storage: { grain: [2000, 4000, 8000], feathers: [1000, 2000, 4000] },
  },
  grainField: {
    kind: 'grainField',
    name: 'Grain Field',
    blurb: 'Grows grain. Assign a Farmer Duck for +50% output.',
    size: 3,
    category: 'resource',
    levels: [L(r(150), 10, 400), L(r(600, 100), 60, 550), L(r(1800, 400), 180, 750)],
    maxCount: [2, 3, 4],
    colors: { top: 0xe9c46a, side: 0x8f6a2f, accent: 0x6a994e },
    producer: { resource: 'grain', perHour: [600, 1000, 1500], capacity: [500, 1200, 2500], boostedBy: 'farmer' },
  },
  featherLoom: {
    kind: 'featherLoom',
    name: 'Feather Loom',
    blurb: 'Spins shed feathers into usable fluff. A Molting Duck adds +50%.',
    size: 3,
    category: 'resource',
    levels: [L(r(300), 15, 400), L(r(900, 150), 60, 550), L(r(2500, 500), 180, 750)],
    maxCount: [1, 2, 3],
    colors: { top: 0xf1faee, side: 0xa8b5c0, accent: 0xe07a5f },
    producer: { resource: 'feathers', perHour: [240, 420, 640], capacity: [200, 500, 1000], boostedBy: 'molter' },
  },
  granary: {
    kind: 'granary',
    name: 'Granary',
    blurb: 'Stores grain and feathers. Raiders love it.',
    size: 3,
    category: 'resource',
    levels: [L(r(300), 15, 700), L(r(1200, 200), 60, 950), L(r(3500, 700), 180, 1300)],
    maxCount: [1, 2, 2],
    colors: { top: 0xb5651d, side: 0x7a3e10, accent: 0xfefae0 },
    storage: { grain: [3000, 6000, 12000], feathers: [1500, 3000, 6000] },
  },
  hatchery: {
    kind: 'hatchery',
    name: 'Hatchery',
    blurb: 'Hatches ducks and houses your attacking flock.',
    size: 3,
    category: 'army',
    levels: [L(r(200), 10, 600), L(r(1000, 200), 60, 800), L(r(3000, 600), 180, 1050)],
    maxCount: [1, 1, 2],
    colors: { top: 0xffe8d6, side: 0xcb997e, accent: 0x6b705c },
    hatchery: { housing: [20, 30, 45] },
  },
  reedWall: {
    kind: 'reedWall',
    name: 'Reed Wall',
    blurb: 'Bundled bulrushes. Slows ground ducks down; Sappers hate them.',
    size: 1,
    category: 'wall',
    levels: [L(r(50), 0, 300), L(r(200), 0, 600), L(r(600, 50), 0, 1000)],
    maxCount: [25, 50, 75],
    colors: { top: 0x6a994e, side: 0x386641, accent: 0xa7c957 },
  },
  pigeonLoft: {
    kind: 'pigeonLoft',
    name: 'Pigeon Loft',
    blurb: 'Sends carrier pigeons to your flock. Higher levels fly faster, wear armour, and use ciphers.',
    size: 2,
    category: 'utility',
    levels: [L(r(250), 10, 400), L(r(1000, 200), 60, 550), L(r(3000, 800), 180, 750)],
    maxCount: [1, 1, 1],
    colors: { top: 0xcdb4db, side: 0x7b6d8d, accent: 0xffffff },
    loft: { speed: [8, 12, 16], armor: [0, 1, 1], cipher: [false, false, true] },
  },
  hawkPerch: {
    kind: 'hawkPerch',
    name: 'Hawk Perch',
    blurb: 'A trained hawk that snatches rival carrier pigeons flying within range of your nest.',
    size: 2,
    category: 'utility',
    levels: [L(r(800, 200), 30, 500), L(r(2000, 500), 90, 700), L(r(5000, 1200), 240, 950)],
    maxCount: [0, 1, 1],
    colors: { top: 0x6d4c41, side: 0x3e2723, accent: 0xffb300 },
    hawk: { radius: [90, 120, 150], power: [0.35, 0.5, 0.65] },
  },
  catapult: {
    kind: 'catapult',
    name: 'Air-Defense Catapult',
    blurb: 'Flings boulders at airborne ducks. Cannot hit anything on the ground.',
    size: 3,
    category: 'defense',
    levels: [L(r(1000, 200), 30, 700), L(r(2500, 500), 90, 900), L(r(6000, 1200), 240, 1150)],
    maxCount: [0, 1, 2],
    colors: { top: 0x8d99ae, side: 0x4a4e69, accent: 0xd90429 },
    defense: { range: [7, 7.5, 8], damage: [60, 80, 105], cooldown: 20, splash: 1.5, targets: 'air', projectile: 'boulder' },
  },
  birdshot: {
    kind: 'birdshot',
    name: 'Birdshot Blaster',
    blurb: 'Short-range spray of pellets that peppers groups of ground ducks.',
    size: 2,
    category: 'defense',
    levels: [L(r(300), 15, 500), L(r(1200, 200), 60, 650), L(r(3500, 700), 180, 850)],
    maxCount: [1, 2, 2],
    colors: { top: 0x495057, side: 0x212529, accent: 0xffba08 },
    defense: { range: [4, 4.5, 5], damage: [22, 30, 40], cooldown: 8, splash: 1.2, targets: 'ground', projectile: 'pellets' },
  },
  heron: {
    kind: 'heron',
    name: 'Heron Watchtower',
    blurb: 'A patient heron on stilts. Long range, single target, hits ground and air.',
    size: 2,
    category: 'defense',
    levels: [L(r(500, 100), 20, 450), L(r(1500, 300), 60, 600), L(r(4000, 900), 180, 800)],
    maxCount: [1, 1, 2],
    colors: { top: 0x90a4ae, side: 0x546e7a, accent: 0xffffff },
    defense: { range: [8, 8.5, 9], damage: [45, 60, 80], cooldown: 12, splash: 0, targets: 'both', projectile: 'beak' },
  },
  turtlePit: {
    kind: 'turtlePit',
    name: 'Snapping Turtle Pit',
    blurb: 'Hidden in the mud. Snaps at the first ground duck that steps on it.',
    size: 1,
    category: 'trap',
    levels: [L(r(200), 0, 1), L(r(800), 0, 1), L(r(2000, 300), 0, 1)],
    maxCount: [1, 2, 3],
    colors: { top: 0x606c38, side: 0x283618, accent: 0x99582a },
    trap: {
      effect: 'damage',
      triggerRadius: 0.9,
      effectRadius: 1.5,
      maxDucks: [4, 5, 6],
      durationTicks: [0, 0, 0],
      damage: [120, 170, 230],
      charges: [1, 1, 1],
      affectsAir: false,
    },
  },
  feedScatterer: {
    kind: 'feedScatterer',
    name: 'Feed Scatterer',
    blurb: 'Bursts out a pile of corn. Up to 4 nearby ducks stop to snack for a few seconds.',
    size: 1,
    category: 'trap',
    levels: [L(r(250), 0, 1), L(r(900, 100), 0, 1), L(r(2200, 400), 0, 1)],
    maxCount: [1, 2, 2],
    colors: { top: 0xf9c74f, side: 0x9c6644, accent: 0xffe066 },
    trap: {
      effect: 'feed',
      triggerRadius: 3,
      effectRadius: 4,
      maxDucks: [3, 4, 4],
      durationTicks: [30, 35, 40],
      damage: [0, 0, 0],
      charges: [1, 1, 2],
      affectsAir: true,
    },
  },
  matingHorn: {
    kind: 'matingHorn',
    name: 'Fake Mating-Call Horn',
    blurb: 'Blares a very convincing quack. Up to 5 undisciplined ducks rush toward it for a few seconds.',
    size: 1,
    category: 'trap',
    levels: [L(r(600, 150), 0, 1), L(r(1500, 350), 0, 1), L(r(3500, 800), 0, 1)],
    maxCount: [0, 1, 2],
    colors: { top: 0xe76f51, side: 0x9d0208, accent: 0xffd166 },
    trap: {
      effect: 'horn',
      triggerRadius: 5,
      effectRadius: 6,
      maxDucks: [4, 5, 5],
      durationTicks: [20, 25, 30],
      damage: [0, 0, 0],
      charges: [1, 1, 2],
      affectsAir: true,
    },
  },
};

/** Game-wide ceilings on distractions: a handful of ducks, a few seconds. */
export const MAX_DISTRACTED_PER_TRIGGER = 5;
export const MAX_DISTRACTION_TICKS = 40;
/** After a distraction wears off a duck is wise to tricks for this many ticks. */
export const DISTRACTION_IMMUNITY_TICKS = 30;

export function levelStats(kind: BuildingKind, level: number): LevelStats {
  const def = BUILDING_DEFS[kind];
  return def.levels[Math.max(0, Math.min(def.levels.length, level) - 1)];
}

/** Index helper: per-level arrays are 0-based on level 1. */
export function atLevel<T>(values: readonly T[], level: number): T {
  return values[Math.max(0, Math.min(values.length, level) - 1)];
}

export function isDefense(kind: BuildingKind): boolean {
  return BUILDING_DEFS[kind].category === 'defense';
}

export function isResourceBuilding(kind: BuildingKind): boolean {
  const c = BUILDING_DEFS[kind].category;
  return c === 'resource' || c === 'core';
}

/** Counts toward destruction % (walls and hidden traps don't, like Clash of Clans). */
export function countsForDestruction(kind: BuildingKind): boolean {
  const c = BUILDING_DEFS[kind].category;
  return c !== 'wall' && c !== 'trap';
}
