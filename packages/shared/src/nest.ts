import { BUILDING_DEFS, MAX_LEVEL, atLevel, levelStats } from './data/buildings';
import { COMBAT_DUCK_DEFS, DUCK_DEFS, isCombatDuck } from './data/ducks';
import { GRID_SIZE } from './iso';
import type {
  Army,
  BuildingKind,
  DuckKind,
  EconomyDuckKind,
  NestState,
  PlacedBuilding,
  Resources,
} from './types';
import { COMBAT_DUCKS } from './types';

export class GameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameError';
  }
}

const HOUR_MS = 3_600_000;
export const MAX_BUILDERS = 4;
export const MAX_QUEUE = 20;

// ---------------------------------------------------------------- resources

export function emptyResources(): Resources {
  return { grain: 0, feathers: 0, pebbles: 0 };
}

export function canAfford(have: Resources, cost: Resources): boolean {
  return have.grain >= cost.grain && have.feathers >= cost.feathers && have.pebbles >= cost.pebbles;
}

function pay(nest: NestState, cost: Resources): void {
  if (!canAfford(nest.resources, cost)) throw new GameError('Not enough resources');
  nest.resources.grain -= cost.grain;
  nest.resources.feathers -= cost.feathers;
  nest.resources.pebbles -= cost.pebbles;
}

// ---------------------------------------------------------------- queries

export function coreLevel(nest: NestState): number {
  return nest.buildings.find((b) => b.kind === 'nestCore')?.level ?? 1;
}

export function countOf(nest: NestState, kind: BuildingKind): number {
  return nest.buildings.filter((b) => b.kind === kind).length;
}

export function maxCountOf(nest: NestState, kind: BuildingKind): number {
  return BUILDING_DEFS[kind].maxCount[Math.max(1, Math.min(MAX_LEVEL, coreLevel(nest))) - 1];
}

export function storageCapacity(nest: NestState): { grain: number; feathers: number } {
  let grain = 0;
  let feathers = 0;
  for (const b of nest.buildings) {
    const s = BUILDING_DEFS[b.kind].storage;
    if (!s || b.level < 1) continue;
    grain += atLevel(s.grain, b.level);
    feathers += atLevel(s.feathers, b.level);
  }
  return { grain, feathers };
}

export function housingCapacity(nest: NestState): number {
  let total = 0;
  for (const b of nest.buildings) {
    const h = BUILDING_DEFS[b.kind].hatchery;
    if (h && b.level >= 1) total += atLevel(h.housing, b.level);
  }
  return total;
}

export function armyHousing(army: Army): number {
  let total = 0;
  for (const kind of COMBAT_DUCKS) total += (army[kind] ?? 0) * COMBAT_DUCK_DEFS[kind].housing;
  return total;
}

export function housingUsed(nest: NestState): number {
  let total = armyHousing(nest.army);
  for (const item of nest.trainingQueue) {
    if (isCombatDuck(item.kind)) total += COMBAT_DUCK_DEFS[item.kind].housing;
  }
  return total;
}

export function hatcheryLevel(nest: NestState): number {
  return Math.max(0, ...nest.buildings.filter((b) => b.kind === 'hatchery').map((b) => b.level));
}

/** Hatchery level needed before a duck type can be hatched. */
export const DUCK_UNLOCK_LEVEL: Record<DuckKind, number> = {
  mallard: 1,
  teal: 1,
  sapper: 1,
  farmer: 1,
  molter: 1,
  builder: 1,
  merganser: 2,
  eider: 2,
  medic: 3,
};

export function economyDuckCap(nest: NestState, kind: EconomyDuckKind): number {
  if (kind === 'builder') return Math.min(MAX_BUILDERS, 1 + coreLevel(nest));
  if (kind === 'farmer') return countOf(nest, 'grainField');
  return countOf(nest, 'featherLoom');
}

export function busyBuilders(nest: NestState): number {
  return nest.buildings.filter((b) => b.upgradingTo != null).length;
}

export function isUnderConstruction(b: PlacedBuilding): boolean {
  return b.upgradingTo != null;
}

/** Producers of each kind are boosted in order, one economy duck per building. */
export function isBoosted(nest: NestState, building: PlacedBuilding): boolean {
  const p = BUILDING_DEFS[building.kind].producer;
  if (!p) return false;
  const same = nest.buildings.filter((b) => b.kind === building.kind && b.level >= 1);
  const idx = same.findIndex((b) => b.id === building.id);
  return idx >= 0 && idx < nest.economyDucks[p.boostedBy];
}

export function productionPerHour(nest: NestState, b: PlacedBuilding): number {
  const p = BUILDING_DEFS[b.kind].producer;
  if (!p || b.level < 1) return 0;
  return atLevel(p.perHour, b.level) * (isBoosted(nest, b) ? 1.5 : 1);
}

export function pendingProduction(nest: NestState, b: PlacedBuilding, now: number): number {
  const p = BUILDING_DEFS[b.kind].producer;
  if (!p || b.level < 1) return 0;
  const elapsed = Math.max(0, now - (b.lastCollectedAt ?? now));
  const made = (elapsed / HOUR_MS) * productionPerHour(nest, b);
  return Math.floor(Math.min(atLevel(p.capacity, b.level), made));
}

// ---------------------------------------------------------------- placement

export function buildOccupancy(buildings: readonly PlacedBuilding[], ignoreId?: string): Int32Array {
  const grid = new Int32Array(GRID_SIZE * GRID_SIZE);
  buildings.forEach((b, i) => {
    if (b.id === ignoreId) return;
    const size = BUILDING_DEFS[b.kind].size;
    for (let dy = 0; dy < size; dy++)
      for (let dx = 0; dx < size; dx++) grid[(b.y + dy) * GRID_SIZE + (b.x + dx)] = i + 1;
  });
  return grid;
}

export function canPlace(
  buildings: readonly PlacedBuilding[],
  kind: BuildingKind,
  x: number,
  y: number,
  ignoreId?: string,
): boolean {
  const size = BUILDING_DEFS[kind].size;
  if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
  if (x < 0 || y < 0 || x + size > GRID_SIZE || y + size > GRID_SIZE) return false;
  const grid = buildOccupancy(buildings, ignoreId);
  for (let dy = 0; dy < size; dy++)
    for (let dx = 0; dx < size; dx++) if (grid[(y + dy) * GRID_SIZE + (x + dx)] !== 0) return false;
  return true;
}

// ---------------------------------------------------------------- time

/** Advance timers: finish construction and hatching that completed by `now`. */
export function tickNest(nest: NestState, now: number): NestState {
  for (const b of nest.buildings) {
    if (b.upgradingTo != null && b.upgradeEndsAt != null && b.upgradeEndsAt <= now) {
      finishConstruction(b, b.upgradeEndsAt);
    }
  }
  const remaining = [];
  for (const item of nest.trainingQueue) {
    if (item.readyAt <= now) {
      if (isCombatDuck(item.kind)) nest.army[item.kind] = (nest.army[item.kind] ?? 0) + 1;
      else nest.economyDucks[item.kind] += 1;
    } else remaining.push(item);
  }
  nest.trainingQueue = remaining;
  return nest;
}

function finishConstruction(b: PlacedBuilding, at: number): void {
  b.level = b.upgradingTo!;
  b.upgradingTo = null;
  b.upgradeEndsAt = null;
  if (BUILDING_DEFS[b.kind].producer && b.lastCollectedAt == null) b.lastCollectedAt = at;
}

// ---------------------------------------------------------------- actions

function startConstruction(nest: NestState, b: PlacedBuilding, toLevel: number, now: number): void {
  const stats = levelStats(b.kind, toLevel);
  if (stats.buildSeconds > 0 && busyBuilders(nest) >= nest.economyDucks.builder) {
    throw new GameError('All Construction Ducks are busy');
  }
  pay(nest, stats.cost);
  b.upgradingTo = toLevel;
  b.upgradeEndsAt = now + stats.buildSeconds * 1000;
  if (stats.buildSeconds === 0) finishConstruction(b, now);
}

export function placeBuilding(nest: NestState, kind: BuildingKind, x: number, y: number, now: number): PlacedBuilding {
  if (!(kind in BUILDING_DEFS)) throw new GameError('Unknown building');
  if (countOf(nest, kind) >= maxCountOf(nest, kind)) throw new GameError('Upgrade your Nest Core to build more of these');
  if (!canPlace(nest.buildings, kind, x, y)) throw new GameError('That spot is taken');
  const b: PlacedBuilding = { id: `b${nest.nextId++}`, kind, level: 0, x, y };
  startConstruction(nest, b, 1, now);
  nest.buildings.push(b);
  return b;
}

export function moveBuilding(nest: NestState, id: string, x: number, y: number): PlacedBuilding {
  const b = findBuilding(nest, id);
  if (!canPlace(nest.buildings, b.kind, x, y, id)) throw new GameError('That spot is taken');
  b.x = x;
  b.y = y;
  return b;
}

export function upgradeBuilding(nest: NestState, id: string, now: number): PlacedBuilding {
  const b = findBuilding(nest, id);
  if (b.upgradingTo != null) throw new GameError('Already under construction');
  if (b.level >= MAX_LEVEL) throw new GameError('Already at max level');
  if (b.kind !== 'nestCore' && b.level + 1 > coreLevel(nest)) throw new GameError('Upgrade your Nest Core first');
  if (BUILDING_DEFS[b.kind].producer) collect(nest, id, now);
  startConstruction(nest, b, b.level + 1, now);
  return b;
}

/** Pebbles needed to finish a construction immediately. */
export function rushCost(b: PlacedBuilding, now: number): number {
  if (b.upgradeEndsAt == null) return 0;
  return Math.max(1, Math.ceil((b.upgradeEndsAt - now) / 60_000));
}

export function rushBuilding(nest: NestState, id: string, now: number): PlacedBuilding {
  const b = findBuilding(nest, id);
  if (b.upgradingTo == null) throw new GameError('Nothing to rush');
  pay(nest, { grain: 0, feathers: 0, pebbles: rushCost(b, now) });
  finishConstruction(b, now);
  return b;
}

export function collect(nest: NestState, id: string, now: number): number {
  const b = findBuilding(nest, id);
  const p = BUILDING_DEFS[b.kind].producer;
  if (!p) throw new GameError('Nothing to collect here');
  const amount = pendingProduction(nest, b, now);
  const cap = storageCapacity(nest)[p.resource];
  const take = Math.max(0, Math.min(amount, cap - nest.resources[p.resource]));
  nest.resources[p.resource] += take;
  const rate = productionPerHour(nest, b);
  // Anything that didn't fit stays in the building.
  b.lastCollectedAt = rate > 0 ? now - ((amount - take) / rate) * HOUR_MS : now;
  return take;
}

export function collectAll(nest: NestState, now: number): Resources {
  const got = emptyResources();
  for (const b of nest.buildings) {
    const p = BUILDING_DEFS[b.kind].producer;
    if (p && b.level >= 1) got[p.resource] += collect(nest, b.id, now);
  }
  return got;
}

export function trainDuck(nest: NestState, kind: DuckKind, now: number): void {
  const def = DUCK_DEFS[kind];
  if (!def) throw new GameError('Unknown duck');
  if (hatcheryLevel(nest) < DUCK_UNLOCK_LEVEL[kind]) throw new GameError(`Needs a level ${DUCK_UNLOCK_LEVEL[kind]} Hatchery`);
  if (nest.trainingQueue.length >= MAX_QUEUE) throw new GameError('Hatching queue is full');
  if (isCombatDuck(kind)) {
    if (housingUsed(nest) + COMBAT_DUCK_DEFS[kind].housing > housingCapacity(nest)) throw new GameError('Not enough room in your Hatcheries');
  } else {
    const queued = nest.trainingQueue.filter((i) => i.kind === kind).length;
    if (nest.economyDucks[kind] + queued >= economyDuckCap(nest, kind)) {
      throw new GameError(kind === 'builder' ? 'Upgrade your Nest Core for more Construction Ducks' : `Build another ${kind === 'farmer' ? 'Grain Field' : 'Feather Loom'} first`);
    }
  }
  pay(nest, def.cost);
  const last = nest.trainingQueue.length ? nest.trainingQueue[nest.trainingQueue.length - 1].readyAt : now;
  nest.trainingQueue.push({ kind, readyAt: Math.max(now, last) + def.trainSeconds * 1000 });
}

export function removeFromArmy(army: Army, used: Army): void {
  for (const kind of COMBAT_DUCKS) {
    if (used[kind]) army[kind] = Math.max(0, (army[kind] ?? 0) - used[kind]!);
  }
}

export function addToArmy(army: Army, extra: Army): void {
  for (const kind of COMBAT_DUCKS) {
    if (extra[kind]) army[kind] = (army[kind] ?? 0) + extra[kind]!;
  }
}

export function addResources(nest: NestState, gain: Resources, respectStorage = true): void {
  const cap = storageCapacity(nest);
  for (const k of ['grain', 'feathers'] as const) {
    const next = nest.resources[k] + gain[k];
    nest.resources[k] = respectStorage ? Math.max(0, Math.min(Math.max(cap[k], nest.resources[k]), next)) : Math.max(0, next);
  }
  nest.resources.pebbles = Math.max(0, nest.resources.pebbles + gain.pebbles);
}

export function findBuilding(nest: NestState, id: string): PlacedBuilding {
  const b = nest.buildings.find((x) => x.id === id);
  if (!b) throw new GameError('No such building');
  return b;
}

export function pigeonLoftLevel(nest: NestState): number {
  return Math.max(0, ...nest.buildings.filter((b) => b.kind === 'pigeonLoft').map((b) => b.level));
}

export function hawkPerchLevel(nest: NestState): number {
  return Math.max(0, ...nest.buildings.filter((b) => b.kind === 'hawkPerch').map((b) => b.level));
}

/** Buildings a raider will actually face (finished level >= 1). */
export function battleSnapshot(nest: NestState): PlacedBuilding[] {
  return nest.buildings
    .filter((b) => b.level >= 1)
    .map((b) => ({ id: b.id, kind: b.kind, level: b.level, x: b.x, y: b.y }));
}

// ---------------------------------------------------------------- starter

export function createStarterNest(now: number): NestState {
  const nest: NestState = {
    buildings: [],
    resources: { grain: 1500, feathers: 600, pebbles: 25 },
    army: { mallard: 10, teal: 2, merganser: 2, sapper: 1 },
    economyDucks: { farmer: 1, builder: 1, molter: 0 },
    trainingQueue: [],
    nextId: 1,
  };
  const add = (kind: BuildingKind, x: number, y: number) => {
    const b: PlacedBuilding = { id: `b${nest.nextId++}`, kind, level: 1, x, y };
    if (BUILDING_DEFS[kind].producer) b.lastCollectedAt = now;
    nest.buildings.push(b);
  };
  add('nestCore', 16, 16);
  add('grainField', 11, 16);
  add('granary', 21, 16);
  add('hatchery', 16, 21);
  add('birdshot', 17, 13);
  add('heron', 20, 21);
  add('pigeonLoft', 12, 21);
  add('feedScatterer', 15, 14);
  return nest;
}

export function armyTotal(army: Army): number {
  return COMBAT_DUCKS.reduce((n, k) => n + (army[k] ?? 0), 0);
}

export function isValidArmy(army: unknown): army is Army {
  if (!army || typeof army !== 'object') return false;
  for (const [k, v] of Object.entries(army)) {
    if (!isCombatDuck(k) || !Number.isInteger(v) || (v as number) < 0) return false;
  }
  return true;
}

