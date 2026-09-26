import type { CombatDuckKind, DuckKind, EconomyDuckKind, Resources } from '../types';

export type TargetPreference = 'any' | 'defense' | 'resource' | 'wall' | 'allies';

export interface DuckDef {
  kind: DuckKind;
  name: string;
  role: 'economy' | 'combat';
  blurb: string;
  cost: Resources;
  trainSeconds: number;
  /** Render colours: body, head, accent (hat/bandana/etc.). */
  colors: { body: number; head: number; accent: number };
}

export interface CombatDuckDef extends DuckDef {
  kind: CombatDuckKind;
  role: 'combat';
  hp: number;
  /** Damage per hit (heal per pulse for medics). */
  damage: number;
  /** Tiles. */
  range: number;
  /** Ticks between hits. */
  cooldown: number;
  /** Tiles per second. */
  speed: number;
  housing: number;
  airborne: boolean;
  target: TargetPreference;
  /** Splash radius in tiles (0 = single target). */
  splash: number;
  /** Disciplined ducks ignore the Fake Mating-Call Horn (they still love feed). */
  disciplined: boolean;
  /** Damage multiplier against walls. */
  wallMultiplier: number;
  /** Sappers blow themselves up on their first hit. */
  kamikaze: boolean;
}

export interface EconomyDuckDef extends DuckDef {
  kind: EconomyDuckKind;
  role: 'economy';
}

const r = (grain: number, feathers = 0, pebbles = 0): Resources => ({ grain, feathers, pebbles });

export const COMBAT_DUCK_DEFS: Record<CombatDuckKind, CombatDuckDef> = {
  mallard: {
    kind: 'mallard',
    name: 'Mallard Brawler',
    role: 'combat',
    blurb: 'Cheap, scrappy melee duck. Waddles at whatever is closest.',
    cost: r(25),
    trainSeconds: 4,
    colors: { body: 0x8d6e4b, head: 0x1f7a3a, accent: 0xf2c14e },
    hp: 110,
    damage: 18,
    range: 0.8,
    cooldown: 10,
    speed: 1.6,
    housing: 1,
    airborne: false,
    target: 'any',
    splash: 0,
    disciplined: false,
    wallMultiplier: 1,
    kamikaze: false,
  },
  eider: {
    kind: 'eider',
    name: 'Eider Tank',
    role: 'combat',
    blurb: 'Down-armoured bruiser that marches straight for defenses. Disciplined: ignores mating calls.',
    cost: r(150, 30),
    trainSeconds: 20,
    colors: { body: 0xeeeeee, head: 0x222222, accent: 0x7fb069 },
    hp: 480,
    damage: 14,
    range: 0.8,
    cooldown: 10,
    speed: 1.1,
    housing: 5,
    airborne: false,
    target: 'defense',
    splash: 0,
    disciplined: true,
    wallMultiplier: 1,
    kamikaze: false,
  },
  teal: {
    kind: 'teal',
    name: 'Teal Scout',
    role: 'combat',
    blurb: 'Fast flyer that raids resource buildings. Only catapults and herons can hit it.',
    cost: r(60, 10),
    trainSeconds: 8,
    colors: { body: 0x9aa7a0, head: 0x7a3b1d, accent: 0x1fa39a },
    hp: 70,
    damage: 14,
    range: 1.2,
    cooldown: 8,
    speed: 2.4,
    housing: 2,
    airborne: true,
    target: 'resource',
    splash: 0,
    disciplined: false,
    wallMultiplier: 1,
    kamikaze: false,
  },
  merganser: {
    kind: 'merganser',
    name: 'Merganser Egg-Lobber',
    role: 'combat',
    blurb: 'Lobs rotten eggs over walls from range. Splash damage.',
    cost: r(70, 15),
    trainSeconds: 8,
    colors: { body: 0x5b6770, head: 0xa0401e, accent: 0xfff3c4 },
    hp: 60,
    damage: 24,
    range: 3.5,
    cooldown: 14,
    speed: 1.3,
    housing: 2,
    airborne: false,
    target: 'any',
    splash: 1.2,
    disciplined: false,
    wallMultiplier: 1,
    kamikaze: false,
  },
  sapper: {
    kind: 'sapper',
    name: 'Sapper Scoter',
    role: 'combat',
    blurb: 'Carries a bread-bomb straight into the nearest reed wall. One use.',
    cost: r(80, 10),
    trainSeconds: 8,
    colors: { body: 0x1c1c1c, head: 0x1c1c1c, accent: 0xff7b00 },
    hp: 45,
    damage: 40,
    range: 0.7,
    cooldown: 1,
    speed: 2.0,
    housing: 2,
    airborne: false,
    target: 'wall',
    splash: 1.6,
    disciplined: false,
    wallMultiplier: 12,
    kamikaze: true,
  },
  medic: {
    kind: 'medic',
    name: 'Wood Duck Medic',
    role: 'combat',
    blurb: 'Follows the flock and heals nearby ducks. Disciplined: ignores mating calls.',
    cost: r(200, 50),
    trainSeconds: 25,
    colors: { body: 0x6b3f2a, head: 0x2e6b3f, accent: 0xe63946 },
    hp: 140,
    damage: 22,
    range: 2.5,
    cooldown: 10,
    speed: 1.4,
    housing: 6,
    airborne: false,
    target: 'allies',
    splash: 0,
    disciplined: true,
    wallMultiplier: 1,
    kamikaze: false,
  },
};

export const ECONOMY_DUCK_DEFS: Record<EconomyDuckKind, EconomyDuckDef> = {
  farmer: {
    kind: 'farmer',
    name: 'Farmer Duck',
    role: 'economy',
    blurb: 'Tends a Grain Field: +50% grain output for each field that has a farmer.',
    cost: r(300, 50),
    trainSeconds: 15,
    colors: { body: 0xf4d35e, head: 0xf4d35e, accent: 0xc97c28 },
  },
  builder: {
    kind: 'builder',
    name: 'Construction Duck',
    role: 'economy',
    blurb: 'Wears a hard hat. Each one lets you build or upgrade one more building at a time.',
    cost: r(800, 200),
    trainSeconds: 30,
    colors: { body: 0xf6f6f6, head: 0xf6f6f6, accent: 0xffb703 },
  },
  molter: {
    kind: 'molter',
    name: 'Molting Duck',
    role: 'economy',
    blurb: 'Sheds feathers for the Feather Loom: +50% feather output for each loom that has one.',
    cost: r(250, 80),
    trainSeconds: 15,
    colors: { body: 0xd9c5b2, head: 0xa98467, accent: 0xffffff },
  },
};

export const DUCK_DEFS: Record<DuckKind, DuckDef> = { ...COMBAT_DUCK_DEFS, ...ECONOMY_DUCK_DEFS };

export function isCombatDuck(kind: string): kind is CombatDuckKind {
  return kind in COMBAT_DUCK_DEFS;
}
