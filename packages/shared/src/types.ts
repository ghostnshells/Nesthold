export type ResourceKind = 'grain' | 'feathers' | 'pebbles';
export type Resources = Record<ResourceKind, number>;

export const COMBAT_DUCKS = ['mallard', 'eider', 'teal', 'merganser', 'sapper', 'medic'] as const;
export const ECONOMY_DUCKS = ['farmer', 'builder', 'molter'] as const;
export type CombatDuckKind = (typeof COMBAT_DUCKS)[number];
export type EconomyDuckKind = (typeof ECONOMY_DUCKS)[number];
export type DuckKind = CombatDuckKind | EconomyDuckKind;

export const BUILDING_KINDS = [
  'nestCore',
  'grainField',
  'featherLoom',
  'granary',
  'hatchery',
  'reedWall',
  'pigeonLoft',
  'hawkPerch',
  'catapult',
  'birdshot',
  'heron',
  'turtlePit',
  'feedScatterer',
  'matingHorn',
] as const;
export type BuildingKind = (typeof BUILDING_KINDS)[number];

export type Army = Partial<Record<CombatDuckKind, number>>;

export interface PlacedBuilding {
  id: string;
  kind: BuildingKind;
  /** Finished level. 0 means "still under first construction". */
  level: number;
  /** Top-left tile of the footprint. */
  x: number;
  y: number;
  /** Level being built/upgraded to, if any. */
  upgradingTo?: number | null;
  /** Epoch ms when the current construction finishes. */
  upgradeEndsAt?: number | null;
  /** Producers only: epoch ms of last collection. */
  lastCollectedAt?: number;
}

export interface TrainingItem {
  kind: DuckKind;
  readyAt: number;
}

export interface NestState {
  buildings: PlacedBuilding[];
  resources: Resources;
  army: Army;
  economyDucks: Record<EconomyDuckKind, number>;
  trainingQueue: TrainingItem[];
  nextId: number;
}

export type DeployCommand =
  | { tick: number; type: 'deploy'; kind: CombatDuckKind; x: number; y: number }
  | { tick: number; type: 'surrender' };

export interface BattleResult {
  stars: number;
  destructionPct: number;
  coreDestroyed: boolean;
  loot: Resources;
  ticks: number;
  deployed: Army;
  survivors: Army;
}
