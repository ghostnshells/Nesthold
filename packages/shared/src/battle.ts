/**
 * Deterministic battle simulation shared by client (live play / replays) and server (validation).
 *
 * Determinism rules: fixed 10 Hz tick, iteration in array order, only + - * / and Math.sqrt
 * (all IEEE correctly-rounded), seeded RNG. No trig, no Date, no Math.random.
 */
import {
  BUILDING_DEFS,
  DISTRACTION_IMMUNITY_TICKS,
  MAX_DISTRACTED_PER_TRIGGER,
  MAX_DISTRACTION_TICKS,
  atLevel,
  countsForDestruction,
  isDefense,
  isResourceBuilding,
  levelStats,
} from './data/buildings';
import type { DefenseStats, TrapStats } from './data/buildings';
import { COMBAT_DUCK_DEFS } from './data/ducks';
import type { CombatDuckDef } from './data/ducks';
import { GRID_SIZE } from './iso';
import { findPath } from './pathfinding';
import { Rng } from './rng';
import type { Army, BattleResult, BuildingKind, CombatDuckKind, DeployCommand, PlacedBuilding, Resources } from './types';
import { COMBAT_DUCKS } from './types';

export const TICKS_PER_SECOND = 10;
export const DT = 1 / TICKS_PER_SECOND;
export const BATTLE_TICKS = 180 * TICKS_PER_SECOND;
export const LOOT_FRACTION = 0.2;
const WALL_PATH_COST = 8;
const REPATH_COOLDOWN = 5;

/** Where distracted ducks gather around a lure (no trig, so hand-written offsets). */
const LURE_OFFSETS: ReadonlyArray<[number, number]> = [
  [0.7, 0],
  [-0.7, 0],
  [0, 0.7],
  [0, -0.7],
  [0.5, 0.5],
  [-0.5, -0.5],
];

export interface BattleSetup {
  seed: number;
  buildings: PlacedBuilding[];
  /** Defender's stored resources at the time of the attack. */
  defenderResources: Resources;
  army: Army;
  maxTicks?: number;
}

export interface SimBuilding {
  index: number;
  id: string;
  kind: BuildingKind;
  level: number;
  x: number;
  y: number;
  size: number;
  cx: number;
  cy: number;
  hp: number;
  maxHp: number;
  destroyed: boolean;
  counts: boolean;
  defense: DefenseStats | null;
  trap: TrapStats | null;
  cooldown: number;
  targetUnit: number;
  charges: number;
  trapCooldown: number;
  revealed: boolean;
  loot: Resources;
}

export interface SimUnit {
  id: number;
  kind: CombatDuckKind;
  def: CombatDuckDef;
  x: number;
  y: number;
  /** Position at the start of the tick (for render interpolation). */
  px: number;
  py: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  target: number;
  path: number[] | null;
  pathIdx: number;
  repathAt: number;
  cooldown: number;
  distractedUntil: number;
  distraction: 'feed' | 'horn' | null;
  immuneUntil: number;
  lureX: number;
  lureY: number;
  state: 'move' | 'attack' | 'distracted' | 'idle';
  /** Attack point for rendering. */
  aimX: number;
  aimY: number;
}

export type SimEvent =
  | { type: 'deploy'; unit: number }
  | { type: 'hit'; unit: number; building: number; x: number; y: number }
  | { type: 'shot'; building: number; unit: number; x: number; y: number; projectile: DefenseStats['projectile']; splash: number }
  | { type: 'destroyed'; building: number }
  | { type: 'trap'; building: number; effect: TrapStats['effect']; affected: number[] }
  | { type: 'boom'; unit: number; x: number; y: number; radius: number }
  | { type: 'heal'; unit: number; x: number; y: number; radius: number }
  | { type: 'death'; unit: number };

export class BattleSim {
  readonly buildings: SimBuilding[];
  readonly units: SimUnit[] = [];
  readonly remaining: Army;
  readonly deployed: Army = {};
  readonly maxTicks: number;
  tick = 0;
  events: SimEvent[] = [];
  loot: Resources = { grain: 0, feathers: 0, pebbles: 0 };
  coreDestroyed = false;
  surrendered = false;
  private readonly rng: Rng;
  private readonly cost: Float64Array;
  private readonly tileBuilding: Int32Array;
  private readonly deployBlocked: Uint8Array;
  private readonly countable: number;
  private destroyedCount = 0;
  private pending: DeployCommand[] = [];

  constructor(setup: BattleSetup) {
    this.rng = new Rng(setup.seed);
    this.maxTicks = setup.maxTicks ?? BATTLE_TICKS;
    this.remaining = { ...setup.army };
    this.buildings = setup.buildings
      .filter((b) => b.level >= 1)
      .map((b, index) => {
        const def = BUILDING_DEFS[b.kind];
        const hp = levelStats(b.kind, b.level).hp;
        return {
          index,
          id: b.id,
          kind: b.kind,
          level: b.level,
          x: b.x,
          y: b.y,
          size: def.size,
          cx: b.x + def.size / 2,
          cy: b.y + def.size / 2,
          hp,
          maxHp: hp,
          destroyed: false,
          counts: countsForDestruction(b.kind),
          defense: def.defense ?? null,
          trap: def.trap ?? null,
          cooldown: 0,
          targetUnit: -1,
          charges: def.trap ? atLevel(def.trap.charges, b.level) : 0,
          trapCooldown: 0,
          revealed: !def.trap,
          loot: { grain: 0, feathers: 0, pebbles: 0 },
        };
      });
    this.countable = this.buildings.filter((b) => b.counts).length;

    // Loot sits mostly in the Granaries and Nest Core, with a little in each producer.
    const LOOT_WEIGHT: Partial<Record<BuildingKind, number>> = { granary: 3, nestCore: 2, grainField: 1, featherLoom: 1 };
    const holders = this.buildings.filter((b) => LOOT_WEIGHT[b.kind]);
    const weight = (b: SimBuilding) => LOOT_WEIGHT[b.kind] ?? 0;
    const totalW = holders.reduce((n, b) => n + weight(b), 0);
    for (const res of ['grain', 'feathers'] as const) {
      const lootable = Math.floor(setup.defenderResources[res] * LOOT_FRACTION);
      let given = 0;
      for (const b of holders) {
        const share = Math.floor((lootable * weight(b)) / totalW);
        b.loot[res] = share;
        given += share;
      }
      if (holders.length) holders[0].loot[res] += lootable - given;
    }

    const n = GRID_SIZE * GRID_SIZE;
    this.cost = new Float64Array(n).fill(1);
    this.tileBuilding = new Int32Array(n).fill(-1);
    this.deployBlocked = new Uint8Array(n);
    for (const b of this.buildings) {
      const isWall = b.kind === 'reedWall';
      for (let dy = 0; dy < b.size; dy++)
        for (let dx = 0; dx < b.size; dx++) {
          const i = (b.y + dy) * GRID_SIZE + b.x + dx;
          this.tileBuilding[i] = b.index;
          if (!b.trap) this.cost[i] = isWall ? WALL_PATH_COST : Infinity;
        }
      if (b.trap) continue;
      for (let dy = -1; dy <= b.size; dy++)
        for (let dx = -1; dx <= b.size; dx++) {
          const tx = b.x + dx;
          const ty = b.y + dy;
          if (tx >= 0 && ty >= 0 && tx < GRID_SIZE && ty < GRID_SIZE) this.deployBlocked[ty * GRID_SIZE + tx] = 1;
        }
    }
  }

  // ------------------------------------------------------------ public API

  canDeployAt(x: number, y: number): boolean {
    if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
    if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) return false;
    return !this.deployBlocked[y * GRID_SIZE + x];
  }

  /** Queue a command; it is applied at the start of the next step. Returns false if invalid now. */
  queue(cmd: DeployCommand): boolean {
    if (this.isOver() || cmd.tick !== this.tick) return false;
    if (cmd.type === 'deploy') {
      const queued = this.pending.filter((p) => p.type === 'deploy' && p.kind === cmd.kind).length;
      if ((this.remaining[cmd.kind] ?? 0) - queued <= 0 || !this.canDeployAt(cmd.x, cmd.y)) return false;
    }
    this.pending.push(cmd);
    return true;
  }

  isOver(): boolean {
    if (this.surrendered || this.tick >= this.maxTicks) return true;
    if (this.countable > 0 && this.destroyedCount >= this.countable) return true;
    const anyDeployed = COMBAT_DUCKS.some((k) => (this.deployed[k] ?? 0) > 0);
    const anyLeft = COMBAT_DUCKS.some((k) => (this.remaining[k] ?? 0) > 0);
    return anyDeployed && !anyLeft && this.units.every((u) => u.dead);
  }

  destructionPct(): number {
    return this.countable ? Math.floor((this.destroyedCount * 100) / this.countable) : 100;
  }

  stars(): number {
    const pct = this.destructionPct();
    return (pct >= 50 ? 1 : 0) + (this.coreDestroyed ? 1 : 0) + (pct >= 100 ? 1 : 0);
  }

  result(): BattleResult {
    const survivors: Army = {};
    for (const u of this.units) if (!u.dead) survivors[u.kind] = (survivors[u.kind] ?? 0) + 1;
    return {
      stars: this.stars(),
      destructionPct: this.destructionPct(),
      coreDestroyed: this.coreDestroyed,
      loot: { ...this.loot },
      ticks: this.tick,
      deployed: { ...this.deployed },
      survivors,
    };
  }

  step(): void {
    if (this.isOver()) return;
    this.events = [];
    for (const cmd of this.pending) this.apply(cmd);
    this.pending = [];
    if (this.surrendered) return;
    for (const u of this.units) {
      u.px = u.x;
      u.py = u.y;
    }
    for (const u of this.units) if (!u.dead) this.updateUnit(u);
    for (const b of this.buildings) if (!b.destroyed && b.defense) this.updateDefense(b);
    for (const b of this.buildings) if (b.trap && b.charges > 0) this.updateTrap(b);
    this.tick++;
  }

  // ------------------------------------------------------------ commands

  private apply(cmd: DeployCommand): void {
    if (cmd.type === 'surrender') {
      this.surrendered = true;
      return;
    }
    if ((this.remaining[cmd.kind] ?? 0) <= 0 || !this.canDeployAt(cmd.x, cmd.y)) return;
    this.remaining[cmd.kind]! -= 1;
    this.deployed[cmd.kind] = (this.deployed[cmd.kind] ?? 0) + 1;
    const def = COMBAT_DUCK_DEFS[cmd.kind];
    const u: SimUnit = {
      id: this.units.length,
      kind: cmd.kind,
      def,
      x: cmd.x + 0.5,
      y: cmd.y + 0.5,
      px: cmd.x + 0.5,
      py: cmd.y + 0.5,
      hp: def.hp,
      maxHp: def.hp,
      dead: false,
      target: -1,
      path: null,
      pathIdx: 0,
      repathAt: 0,
      cooldown: 0,
      distractedUntil: -1,
      distraction: null,
      immuneUntil: -1,
      lureX: 0,
      lureY: 0,
      state: 'idle',
      aimX: 0,
      aimY: 0,
    };
    this.units.push(u);
    this.events.push({ type: 'deploy', unit: u.id });
  }

  // ------------------------------------------------------------ ducks

  private updateUnit(u: SimUnit): void {
    if (u.cooldown > 0) u.cooldown--;

    if (u.distraction) {
      if (this.tick >= u.distractedUntil) {
        u.distraction = null;
        u.immuneUntil = this.tick + DISTRACTION_IMMUNITY_TICKS;
        u.path = null;
      } else {
        u.state = 'distracted';
        this.moveStraight(u, u.lureX, u.lureY, 0.1);
        return;
      }
    }

    if (u.def.target === 'allies') {
      this.updateMedic(u);
      return;
    }

    if (u.target < 0 || this.buildings[u.target].destroyed) {
      u.target = this.chooseTarget(u);
      u.path = null;
      if (u.target < 0) {
        u.state = 'idle';
        return;
      }
    }
    const t = this.buildings[u.target];

    if (distToRect(u.x, u.y, t) <= u.def.range) {
      this.attack(u, t);
      return;
    }

    if (u.def.airborne) {
      const p = nearestPointOnRect(u.x, u.y, t);
      this.moveStraight(u, p.x, p.y, u.def.range * 0.9);
      u.state = 'move';
      return;
    }

    if (!u.path || u.pathIdx >= u.path.length) {
      if (this.tick < u.repathAt) {
        u.state = 'idle';
        return;
      }
      u.repathAt = this.tick + REPATH_COOLDOWN;
      u.path = this.planPath(u, t);
      u.pathIdx = 0;
      if (!u.path) {
        u.state = 'idle';
        return;
      }
    }

    const next = u.path[u.pathIdx];
    const wall = this.tileBuilding[next];
    if (wall >= 0 && this.buildings[wall].kind === 'reedWall' && !this.buildings[wall].destroyed) {
      const w = this.buildings[wall];
      if (distToRect(u.x, u.y, w) <= Math.max(u.def.range, 0.75)) {
        this.attack(u, w);
        return;
      }
    }
    const tx = (next % GRID_SIZE) + 0.5;
    const ty = Math.floor(next / GRID_SIZE) + 0.5;
    u.state = 'move';
    if (this.moveStraight(u, tx, ty, 0)) u.pathIdx++;
  }

  private updateMedic(u: SimUnit): void {
    let best: SimUnit | null = null;
    let bestD = Infinity;
    for (const o of this.units) {
      if (o.dead || o === u || o.def.target === 'allies') continue;
      const d = dist2(u.x, u.y, o.x, o.y);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    if (!best) {
      u.state = 'idle';
      return;
    }
    u.state = 'move';
    this.moveStraight(u, best.x, best.y, 1.2);
    if (u.cooldown === 0) {
      let healed = false;
      const r2 = u.def.range * u.def.range;
      for (const o of this.units) {
        if (o.dead || o === u || o.hp >= o.maxHp) continue;
        if (dist2(u.x, u.y, o.x, o.y) <= r2) {
          o.hp = Math.min(o.maxHp, o.hp + u.def.damage);
          healed = true;
        }
      }
      if (healed) {
        u.cooldown = u.def.cooldown;
        u.state = 'attack';
        this.events.push({ type: 'heal', unit: u.id, x: u.x, y: u.y, radius: u.def.range });
      }
    }
  }

  private chooseTarget(u: SimUnit): number {
    const pref = u.def.target;
    const filters: Array<(b: SimBuilding) => boolean> = [];
    if (pref === 'defense') filters.push((b) => isDefense(b.kind));
    if (pref === 'resource') filters.push((b) => isResourceBuilding(b.kind));
    if (pref === 'wall') filters.push((b) => b.kind === 'reedWall');
    filters.push((b) => b.counts);
    for (const f of filters) {
      let best = -1;
      let bestD = Infinity;
      for (const b of this.buildings) {
        if (b.destroyed || !f(b)) continue;
        const d = distToRect(u.x, u.y, b);
        if (d < bestD) {
          bestD = d;
          best = b.index;
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  private planPath(u: SimUnit, t: SimBuilding): number[] | null {
    const start = Math.floor(u.y) * GRID_SIZE + Math.floor(u.x);
    // Goal tiles must put the tile centre inside attack range, so arriving always means attacking.
    const reach = u.def.range;
    const isGoal = (idx: number) => {
      if (this.cost[idx] === Infinity) return false;
      const x = (idx % GRID_SIZE) + 0.5;
      const y = Math.floor(idx / GRID_SIZE) + 0.5;
      return distToRect(x, y, t) <= reach;
    };
    const path = findPath(GRID_SIZE, this.cost, start, isGoal, t.cx, t.cy);
    // Already at the goal tile but not quite in range: step onto the tile centre.
    if (path && path.length === 0) return [start];
    return path;
  }

  /** Moves toward (tx, ty); returns true once within `stopAt` (or reached). */
  private moveStraight(u: SimUnit, tx: number, ty: number, stopAt: number): boolean {
    const dx = tx - u.x;
    const dy = ty - u.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= stopAt + 1e-9) return true;
    const stepLen = u.def.speed * DT;
    const move = Math.min(stepLen, d - stopAt);
    const nx = u.x + (dx / d) * move;
    const ny = u.y + (dy / d) * move;
    if (!u.def.airborne && u.def.target !== 'allies') {
      // Ground ducks can't walk through intact buildings while they wander to a lure.
      const tile = Math.floor(ny) * GRID_SIZE + Math.floor(nx);
      const b = this.tileBuilding[tile];
      const cur = Math.floor(u.y) * GRID_SIZE + Math.floor(u.x);
      if (u.distraction && b >= 0 && tile !== cur && !this.buildings[b].destroyed && !this.buildings[b].trap) return true;
    }
    u.x = nx;
    u.y = ny;
    return move >= d - stopAt - 1e-9;
  }

  private attack(u: SimUnit, b: SimBuilding): void {
    u.state = 'attack';
    const p = nearestPointOnRect(u.x, u.y, b);
    u.aimX = p.x;
    u.aimY = p.y;
    if (u.cooldown > 0) return;
    u.cooldown = u.def.cooldown;
    if (u.def.kamikaze) {
      const r = u.def.splash;
      for (const o of this.buildings) {
        if (o.destroyed || o.trap || distToRect(u.x, u.y, o) > r) continue;
        this.damageBuilding(o, u.def.damage * (o.kind === 'reedWall' ? u.def.wallMultiplier : 1));
      }
      this.events.push({ type: 'boom', unit: u.id, x: u.x, y: u.y, radius: r });
      this.killUnit(u);
      return;
    }
    this.events.push({ type: 'hit', unit: u.id, building: b.index, x: p.x, y: p.y });
    const mult = b.kind === 'reedWall' ? u.def.wallMultiplier : 1;
    this.damageBuilding(b, u.def.damage * mult);
    if (u.def.splash > 0) {
      for (const o of this.buildings) {
        if (o === b || o.destroyed || o.trap || o.kind === 'reedWall') continue;
        if (distToRect(p.x, p.y, o) <= u.def.splash) this.damageBuilding(o, u.def.damage);
      }
    }
  }

  private damageBuilding(b: SimBuilding, amount: number): void {
    if (b.destroyed) return;
    b.hp -= amount;
    if (b.hp > 0) return;
    b.hp = 0;
    b.destroyed = true;
    this.events.push({ type: 'destroyed', building: b.index });
    if (!b.trap) {
      for (let dy = 0; dy < b.size; dy++)
        for (let dx = 0; dx < b.size; dx++) this.cost[(b.y + dy) * GRID_SIZE + b.x + dx] = 1;
      // Paths may now have shortcuts; let everyone replan.
      for (const u of this.units) if (b.kind === 'reedWall' && u.path) u.path = null;
    }
    if (b.counts) this.destroyedCount++;
    if (b.kind === 'nestCore') this.coreDestroyed = true;
    this.loot.grain += b.loot.grain;
    this.loot.feathers += b.loot.feathers;
  }

  private killUnit(u: SimUnit): void {
    if (u.dead) return;
    u.dead = true;
    u.hp = 0;
    this.events.push({ type: 'death', unit: u.id });
  }

  private damageUnit(u: SimUnit, amount: number): void {
    if (u.dead) return;
    u.hp -= amount;
    if (u.hp <= 0) this.killUnit(u);
  }

  // ------------------------------------------------------------ defenses

  private canHit(d: DefenseStats, u: SimUnit): boolean {
    if (u.dead) return false;
    if (d.targets === 'both') return true;
    return d.targets === 'air' ? u.def.airborne : !u.def.airborne;
  }

  private updateDefense(b: SimBuilding): void {
    const d = b.defense!;
    if (b.cooldown > 0) {
      b.cooldown--;
      return;
    }
    const range = atLevel(d.range, b.level);
    const r2 = range * range;
    let target = b.targetUnit >= 0 ? this.units[b.targetUnit] : null;
    if (!target || !this.canHit(d, target) || dist2(b.cx, b.cy, target.x, target.y) > r2) {
      target = null;
      let bestD = Infinity;
      for (const u of this.units) {
        if (!this.canHit(d, u)) continue;
        const dd = dist2(b.cx, b.cy, u.x, u.y);
        if (dd <= r2 && dd < bestD) {
          bestD = dd;
          target = u;
        }
      }
    }
    if (!target) {
      b.targetUnit = -1;
      return;
    }
    b.targetUnit = target.id;
    b.cooldown = d.cooldown;
    // +-10% spread so no two volleys look identical; seeded, so still deterministic.
    const dmg = atLevel(d.damage, b.level) * (0.9 + this.rng.next() * 0.2);
    const ix = target.x;
    const iy = target.y;
    this.events.push({ type: 'shot', building: b.index, unit: target.id, x: ix, y: iy, projectile: d.projectile, splash: d.splash });
    if (d.splash > 0) {
      const s2 = d.splash * d.splash;
      for (const u of this.units) if (this.canHit(d, u) && dist2(ix, iy, u.x, u.y) <= s2) this.damageUnit(u, dmg);
    } else {
      this.damageUnit(target, dmg);
    }
  }

  // ------------------------------------------------------------ traps & distractions

  private trapAffects(t: TrapStats, u: SimUnit): boolean {
    if (u.dead) return false;
    if (u.def.airborne && !t.affectsAir) return false;
    if (t.effect === 'damage') return true;
    if (u.distraction || this.tick < u.immuneUntil) return false;
    if (t.effect === 'horn' && u.def.disciplined) return false;
    return true;
  }

  private updateTrap(b: SimBuilding): void {
    const t = b.trap!;
    if (b.trapCooldown > 0) {
      b.trapCooldown--;
      return;
    }
    const trig2 = t.triggerRadius * t.triggerRadius;
    if (!this.units.some((u) => this.trapAffects(t, u) && dist2(b.cx, b.cy, u.x, u.y) <= trig2)) return;

    const eff2 = t.effectRadius * t.effectRadius;
    const candidates = this.units
      .filter((u) => this.trapAffects(t, u) && dist2(b.cx, b.cy, u.x, u.y) <= eff2)
      .map((u) => ({ u, d: dist2(b.cx, b.cy, u.x, u.y) }))
      .sort((a, c) => a.d - c.d || a.u.id - c.u.id);
    const cap = Math.min(atLevel(t.maxDucks, b.level), MAX_DISTRACTED_PER_TRIGGER);
    const chosen = candidates.slice(0, t.effect === 'damage' ? atLevel(t.maxDucks, b.level) : cap).map((c) => c.u);

    if (t.effect === 'damage') {
      const dmg = atLevel(t.damage, b.level);
      for (const u of chosen) this.damageUnit(u, dmg);
      b.destroyed = true;
    } else {
      const duration = Math.min(atLevel(t.durationTicks, b.level), MAX_DISTRACTION_TICKS);
      chosen.forEach((u, i) => {
        const [ox, oy] = LURE_OFFSETS[i % LURE_OFFSETS.length];
        u.distraction = t.effect as 'feed' | 'horn';
        u.distractedUntil = this.tick + duration;
        u.lureX = b.cx + ox;
        u.lureY = b.cy + oy;
        u.path = null;
      });
    }
    b.revealed = true;
    b.charges--;
    b.trapCooldown = 50;
    this.events.push({ type: 'trap', building: b.index, effect: t.effect, affected: chosen.map((u) => u.id) });
  }
}

// ------------------------------------------------------------ geometry helpers

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function nearestPointOnRect(px: number, py: number, b: { x: number; y: number; size: number }): { x: number; y: number } {
  return {
    x: Math.max(b.x, Math.min(b.x + b.size, px)),
    y: Math.max(b.y, Math.min(b.y + b.size, py)),
  };
}

export function distToRect(px: number, py: number, b: { x: number; y: number; size: number }): number {
  const p = nearestPointOnRect(px, py, b);
  return Math.sqrt(dist2(px, py, p.x, p.y));
}

/** Replay a full battle from its commands. Used by the server to validate an attack. */
export function simulateBattle(setup: BattleSetup, commands: readonly DeployCommand[]): BattleResult {
  const sim = new BattleSim(setup);
  const sorted = [...commands].sort((a, b) => a.tick - b.tick);
  let ci = 0;
  while (!sim.isOver()) {
    while (ci < sorted.length && sorted[ci].tick <= sim.tick) {
      const cmd = sorted[ci++];
      if (cmd.tick === sim.tick) sim.queue(cmd);
    }
    // Nothing left to do: skip ahead instead of stepping an empty battlefield.
    if (ci >= sorted.length && sim.units.every((u) => u.dead) && COMBAT_DUCKS.every((k) => !sim.remaining[k])) break;
    if (ci >= sorted.length && sim.units.length === 0) break;
    sim.step();
  }
  return sim.result();
}
