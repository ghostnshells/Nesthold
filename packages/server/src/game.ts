import { randomUUID } from 'node:crypto';
import {
  COMBAT_DUCKS,
  COMBAT_DUCK_DEFS,
  GameError,
  Rng,
  PIGEON_KINDS,
  addResources,
  addToArmy,
  armyHousing,
  armyTotal,
  battleSnapshot,
  canAfford,
  collect,
  collectAll,
  createStarterNest,
  hashSeed,
  hawksAlongRoute,
  housingCapacity,
  housingUsed,
  isCombatDuck,
  isValidArmy,
  loftArmor,
  loftHasCipher,
  moveBuilding,
  placeBuilding,
  planPigeon,
  removeFromArmy,
  rushBuilding,
  scrambleMessage,
  simulateBattle,
  survivalChance,
  tickNest,
  trainDuck,
  upgradeBuilding,
} from '@nesthold/shared';
import type {
  Army,
  BattleResult,
  BuildingKind,
  DeployCommand,
  DuckKind,
  HawkPost,
  PigeonKind,
  PlacedBuilding,
  Resources,
} from '@nesthold/shared';
import type { Db, PlayerRow } from './db';
import { insertPlayer, saveNest, toPlayer } from './db';

export const SHIELD_MS = 10 * 60_000;
export const ATTACK_TTL_MS = 5 * 60_000;
export const RAID_WINDOW_MS = 10 * 60_000;
export const MAX_FLOCK = 10;
export const MAX_RAID_HOUSING = 120;
export const MAX_COMMANDS = 600;

export class NotFound extends Error {}

export type NestAction =
  | { type: 'place'; kind: BuildingKind; x: number; y: number }
  | { type: 'move'; id: string; x: number; y: number }
  | { type: 'upgrade'; id: string }
  | { type: 'rush'; id: string }
  | { type: 'collect'; id: string }
  | { type: 'collectAll' }
  | { type: 'train'; kind: DuckKind };

export interface Push {
  (playerId: string, message: Record<string, unknown>): void;
}

export interface AttackSetupView {
  attackId: string;
  seed: number;
  buildings: PlacedBuilding[];
  defenderResources: Resources;
  army: Army;
  defenderName: string;
  raidId: string | null;
}

type Raw = Record<string, any>;

export class Game {
  constructor(
    readonly db: Db,
    readonly now: () => number = Date.now,
    public push: Push = () => {},
  ) {}

  // ------------------------------------------------------------ players

  player(id: string): PlayerRow {
    const r = this.db.prepare('SELECT * FROM players WHERE id = ?').get(id) as Raw | undefined;
    if (!r) throw new NotFound('No such player');
    const p = toPlayer(r);
    tickNest(p.nest, this.now());
    if (p.isBot) this.refillBot(p);
    return p;
  }

  playerByToken(token: string): PlayerRow | null {
    const r = this.db.prepare('SELECT id FROM players WHERE token = ?').get(token) as Raw | undefined;
    return r ? this.player(r.id as string) : null;
  }

  private save(p: PlayerRow): void {
    saveNest(this.db, p.id, p.nest, this.now());
  }

  /** Bots slowly regain what raiders took, so they stay worth attacking. */
  private refillBot(p: PlayerRow): void {
    const minutes = (this.now() - p.updatedAt) / 60_000;
    if (minutes <= 0) return;
    const base = { grain: 2000 * p.coreLevel, feathers: 700 * p.coreLevel };
    for (const k of ['grain', 'feathers'] as const) {
      if (p.nest.resources[k] < base[k]) p.nest.resources[k] = Math.min(base[k], Math.floor(p.nest.resources[k] + base[k] * 0.1 * minutes));
    }
  }

  createGuest(name?: string): { token: string; player: PlayerRow } {
    const now = this.now();
    const id = randomUUID();
    const token = randomUUID();
    const rnd = hashSeed(id);
    const spot = this.freeWorldSpot(rnd);
    const clean = (name ?? '').replace(/[^\p{L}\p{N} _'-]/gu, '').trim().slice(0, 20);
    insertPlayer(
      this.db,
      {
        id,
        token,
        name: clean || `Duckling${rnd % 10000}`,
        nest: createStarterNest(now),
        wx: spot.x,
        wy: spot.y,
        flockId: null,
        trophies: 0,
        shieldUntil: 0,
        isBot: false,
        updatedAt: now,
      },
      now,
    );
    return { token, player: this.player(id) };
  }

  /** Somewhere near the middle of the map that isn't on top of another nest. */
  private freeWorldSpot(seed: number): { x: number; y: number } {
    const taken = this.db.prepare('SELECT wx, wy FROM players').all() as Raw[];
    const rng = new Rng(seed);
    let best = { x: 500, y: 500 };
    let bestGap = -1;
    for (let i = 0; i < 40; i++) {
      const spread = 170 + i * 8;
      const c = { x: Math.round(500 + (rng.next() * 2 - 1) * spread), y: Math.round(500 + (rng.next() * 2 - 1) * spread) };
      const gap = Math.min(Infinity, ...taken.map((t) => Math.hypot(t.wx - c.x, t.wy - c.y)));
      if (gap >= 90) return c;
      if (gap > bestGap) {
        bestGap = gap;
        best = c;
      }
    }
    return best;
  }

  publicPlayer(p: PlayerRow) {
    return {
      id: p.id,
      name: p.name,
      wx: p.wx,
      wy: p.wy,
      flockId: p.flockId,
      flockName: p.flockId ? this.flockName(p.flockId) : null,
      trophies: p.trophies,
      coreLevel: p.coreLevel,
      hawkLevel: p.hawkLevel,
      loftLevel: p.loftLevel,
      isBot: p.isBot,
      shielded: p.shieldUntil > this.now(),
    };
  }

  me(id: string) {
    const p = this.player(id);
    this.save(p);
    return { player: this.publicPlayer(p), nest: p.nest, serverTime: this.now(), shieldUntil: p.shieldUntil };
  }

  rename(id: string, name: string) {
    const clean = name.replace(/[^\p{L}\p{N} _'-]/gu, '').trim().slice(0, 20);
    if (clean.length < 2) throw new GameError('Pick a longer name');
    this.db.prepare('UPDATE players SET name = ? WHERE id = ?').run(clean, id);
    return this.me(id);
  }

  nestAction(id: string, action: NestAction) {
    const p = this.player(id);
    const now = this.now();
    const nest = p.nest;
    let gained: Resources | number | undefined;
    switch (action?.type) {
      case 'place':
        placeBuilding(nest, action.kind, action.x, action.y, now);
        break;
      case 'move':
        moveBuilding(nest, String(action.id), action.x, action.y);
        break;
      case 'upgrade':
        upgradeBuilding(nest, String(action.id), now);
        break;
      case 'rush':
        rushBuilding(nest, String(action.id), now);
        break;
      case 'collect':
        gained = collect(nest, String(action.id), now);
        break;
      case 'collectAll':
        gained = collectAll(nest, now);
        break;
      case 'train':
        trainDuck(nest, action.kind, now);
        break;
      default:
        throw new GameError('Unknown action');
    }
    this.save(p);
    return { nest, gained, serverTime: now };
  }

  // ------------------------------------------------------------ world

  world(viewerId: string) {
    const rows = this.db.prepare('SELECT * FROM players ORDER BY trophies DESC LIMIT 200').all() as Raw[];
    return rows.map((r) => {
      const p = toPlayer(r);
      return { ...this.publicPlayer(p), isMe: p.id === viewerId };
    });
  }

  private hawkPosts(): HawkPost[] {
    const rows = this.db.prepare('SELECT id, flock_id, wx, wy, hawk_level FROM players WHERE hawk_level > 0').all() as Raw[];
    return rows.map((r) => ({
      playerId: r.id as string,
      flockId: (r.flock_id as string | null) ?? null,
      x: r.wx as number,
      y: r.wy as number,
      level: r.hawk_level as number,
    }));
  }

  // ------------------------------------------------------------ attacks

  startAttack(attackerId: string, targetId: string): AttackSetupView {
    const attacker = this.player(attackerId);
    const army = { ...attacker.nest.army };
    if (armyTotal(army) === 0) throw new GameError('Hatch some ducks before you attack');
    return this.createAttack(attacker, targetId, army, null);
  }

  private createAttack(attacker: PlayerRow, targetId: string, army: Army, raidId: string | null): AttackSetupView {
    if (targetId === attacker.id) throw new GameError("You can't raid your own nest");
    const target = this.player(targetId);
    if (attacker.flockId && target.flockId === attacker.flockId) throw new GameError("That's a flock-mate!");
    const now = this.now();
    if (target.shieldUntil > now) throw new GameError('That nest is shielded after a recent raid');
    // One open solo attack at a time.
    if (!raidId) {
      this.db.prepare(`UPDATE attacks SET status = 'abandoned' WHERE attacker_id = ? AND status = 'open' AND raid_id IS NULL`).run(attacker.id);
    }
    const id = randomUUID();
    const seed = hashSeed(id);
    const buildings = battleSnapshot(target.nest);
    const defenderResources = { ...target.nest.resources, pebbles: 0 };
    this.db
      .prepare(
        `INSERT INTO attacks (id, attacker_id, defender_id, raid_id, seed, buildings, defender_resources, army, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      )
      .run(id, attacker.id, target.id, raidId, seed, JSON.stringify(buildings), JSON.stringify(defenderResources), JSON.stringify(army), now, now + ATTACK_TTL_MS);
    return { attackId: id, seed, buildings, defenderResources, army, defenderName: target.name, raidId };
  }

  submitAttack(attackerId: string, attackId: string, commands: unknown, claimed?: Partial<BattleResult>) {
    const row = this.db.prepare('SELECT * FROM attacks WHERE id = ?').get(attackId) as Raw | undefined;
    if (!row || row.attacker_id !== attackerId) throw new NotFound('No such attack');
    if (row.status !== 'open') throw new GameError('This attack is already over');
    const now = this.now();
    if ((row.expires_at as number) < now) throw new GameError('This attack timed out');
    const cmds = parseCommands(commands);
    const army = JSON.parse(row.army as string) as Army;
    const result = simulateBattle(
      {
        seed: row.seed as number,
        buildings: JSON.parse(row.buildings as string),
        defenderResources: JSON.parse(row.defender_resources as string),
        army,
      },
      cmds,
    );
    const mismatch =
      !!claimed &&
      (claimed.stars !== result.stars ||
        claimed.destructionPct !== result.destructionPct ||
        claimed.loot?.grain !== result.loot.grain ||
        claimed.loot?.feathers !== result.loot.feathers);

    const raidId = (row.raid_id as string | null) ?? null;
    const attacker = this.player(attackerId);
    const defender = this.player(row.defender_id as string);
    const pebbleBonus = result.stars === 3 ? 2 : 0;

    if (raidId) {
      this.splitRaidLoot(raidId, result, pebbleBonus);
    } else {
      removeFromArmy(attacker.nest.army, result.deployed);
      addResources(attacker.nest, { ...result.loot, pebbles: pebbleBonus });
      this.save(attacker);
    }

    defender.nest.resources.grain = Math.max(0, defender.nest.resources.grain - result.loot.grain);
    defender.nest.resources.feathers = Math.max(0, defender.nest.resources.feathers - result.loot.feathers);
    this.save(defender);
    const trophyGain = result.stars * 10 - (result.stars === 0 ? 5 : 0);
    this.db.prepare('UPDATE players SET trophies = MAX(0, trophies + ?) WHERE id = ?').run(trophyGain, attacker.id);
    this.db.prepare('UPDATE players SET trophies = MAX(0, trophies - ?) WHERE id = ?').run(result.stars * 8, defender.id);
    if (!defender.isBot && result.destructionPct > 0) {
      this.db.prepare('UPDATE players SET shield_until = ? WHERE id = ?').run(now + SHIELD_MS, defender.id);
    }
    this.db
      .prepare(`UPDATE attacks SET status = 'done', commands = ?, result = ? WHERE id = ?`)
      .run(JSON.stringify(cmds), JSON.stringify(result), attackId);
    if (raidId) this.db.prepare(`UPDATE raids SET status = 'done', result = ? WHERE id = ?`).run(JSON.stringify(result), raidId);

    this.push(defender.id, { type: 'attacked', attackId, attacker: attacker.name, stars: result.stars, loot: result.loot });
    return { result, mismatch, trophyGain, pebbleBonus, nest: this.player(attackerId).nest };
  }

  battles(playerId: string) {
    const rows = this.db
      .prepare(
        `SELECT a.*, pa.name AS attacker_name, pd.name AS defender_name FROM attacks a
         JOIN players pa ON pa.id = a.attacker_id JOIN players pd ON pd.id = a.defender_id
         WHERE a.status = 'done' AND (a.attacker_id = ? OR a.defender_id = ?
           OR a.raid_id IN (SELECT raid_id FROM raid_pledges WHERE player_id = ?))
         ORDER BY a.created_at DESC LIMIT 30`,
      )
      .all(playerId, playerId, playerId) as Raw[];
    return rows.map((r) => {
      const result = JSON.parse(r.result as string) as BattleResult;
      return {
        id: r.id as string,
        attackerName: r.attacker_name as string,
        defenderName: r.defender_name as string,
        asDefender: r.defender_id === playerId,
        raidId: (r.raid_id as string | null) ?? null,
        stars: result.stars,
        destructionPct: result.destructionPct,
        loot: result.loot,
        createdAt: r.created_at as number,
      };
    });
  }

  replay(playerId: string, attackId: string) {
    const r = this.db.prepare('SELECT * FROM attacks WHERE id = ?').get(attackId) as Raw | undefined;
    if (!r || r.status !== 'done') throw new NotFound('No such battle');
    const pledged = r.raid_id && this.db.prepare('SELECT 1 FROM raid_pledges WHERE raid_id = ? AND player_id = ?').get(r.raid_id, playerId);
    if (r.attacker_id !== playerId && r.defender_id !== playerId && !pledged) throw new NotFound('No such battle');
    return {
      attackId,
      seed: r.seed as number,
      buildings: JSON.parse(r.buildings as string),
      defenderResources: JSON.parse(r.defender_resources as string),
      army: JSON.parse(r.army as string),
      commands: JSON.parse(r.commands as string),
      result: JSON.parse(r.result as string),
      defenderName: this.player(r.defender_id as string).name,
      attackerName: this.player(r.attacker_id as string).name,
    };
  }

  // ------------------------------------------------------------ flocks

  private flockName(id: string): string | null {
    const r = this.db.prepare('SELECT name FROM flocks WHERE id = ?').get(id) as Raw | undefined;
    return (r?.name as string) ?? null;
  }

  flocks() {
    const rows = this.db
      .prepare(
        `SELECT f.id, f.name, f.leader_id, COUNT(p.id) AS members, COALESCE(SUM(p.trophies), 0) AS trophies
         FROM flocks f LEFT JOIN players p ON p.flock_id = f.id GROUP BY f.id ORDER BY trophies DESC`,
      )
      .all() as Raw[];
    return rows.map((r) => ({ id: r.id as string, name: r.name as string, members: r.members as number, trophies: r.trophies as number }));
  }

  myFlock(playerId: string) {
    const me = this.player(playerId);
    if (!me.flockId) return null;
    const f = this.db.prepare('SELECT * FROM flocks WHERE id = ?').get(me.flockId) as Raw;
    const members = (this.db.prepare('SELECT * FROM players WHERE flock_id = ? ORDER BY trophies DESC').all(me.flockId) as Raw[]).map((r) => {
      const p = toPlayer(r);
      return { ...this.publicPlayer(p), housing: housingUsed(p.nest), capacity: housingCapacity(p.nest), isLeader: p.id === f.leader_id };
    });
    return { id: f.id as string, name: f.name as string, leaderId: f.leader_id as string, members };
  }

  createFlock(playerId: string, name: string) {
    const me = this.player(playerId);
    if (me.flockId) throw new GameError('Leave your flock first');
    const clean = String(name ?? '').replace(/[^\p{L}\p{N} _'-]/gu, '').trim().slice(0, 24);
    if (clean.length < 3) throw new GameError('Flock names need at least 3 letters');
    if (this.db.prepare('SELECT 1 FROM flocks WHERE name = ?').get(clean)) throw new GameError('That name is taken');
    const id = randomUUID();
    this.db.prepare('INSERT INTO flocks (id, name, leader_id, created_at) VALUES (?, ?, ?, ?)').run(id, clean, playerId, this.now());
    this.db.prepare('UPDATE players SET flock_id = ? WHERE id = ?').run(id, playerId);
    return this.myFlock(playerId);
  }

  joinFlock(playerId: string, flockId: string) {
    const me = this.player(playerId);
    if (me.flockId) throw new GameError('Leave your flock first');
    if (!this.db.prepare('SELECT 1 FROM flocks WHERE id = ?').get(flockId)) throw new NotFound('No such flock');
    const n = (this.db.prepare('SELECT COUNT(*) AS n FROM players WHERE flock_id = ?').get(flockId) as Raw).n as number;
    if (n >= MAX_FLOCK) throw new GameError('That flock is full');
    this.db.prepare('UPDATE players SET flock_id = ? WHERE id = ?').run(flockId, playerId);
    this.pushFlock(flockId, { type: 'flockJoined', name: me.name }, playerId);
    return this.myFlock(playerId);
  }

  leaveFlock(playerId: string) {
    const me = this.player(playerId);
    if (!me.flockId) throw new GameError("You're not in a flock");
    this.db.prepare('UPDATE players SET flock_id = NULL WHERE id = ?').run(playerId);
    const f = this.db.prepare('SELECT leader_id FROM flocks WHERE id = ?').get(me.flockId) as Raw;
    const next = this.db.prepare('SELECT id FROM players WHERE flock_id = ? ORDER BY trophies DESC LIMIT 1').get(me.flockId) as Raw | undefined;
    if (!next) this.db.prepare('DELETE FROM flocks WHERE id = ?').run(me.flockId);
    else if (f.leader_id === playerId) this.db.prepare('UPDATE flocks SET leader_id = ? WHERE id = ?').run(next.id, me.flockId);
    return null;
  }

  donate(playerId: string, toId: string, kind: string, count: number) {
    const me = this.player(playerId);
    const to = this.player(toId);
    if (!me.flockId || me.flockId !== to.flockId || me.id === to.id) throw new GameError('You can only donate to flock-mates');
    if (!isCombatDuck(kind)) throw new GameError('Only combat ducks can be donated');
    if (!Number.isInteger(count) || count < 1 || count > 50) throw new GameError('Bad count');
    if ((me.nest.army[kind] ?? 0) < count) throw new GameError("You don't have that many");
    const room = housingCapacity(to.nest) - housingUsed(to.nest);
    if (room < COMBAT_DUCK_DEFS[kind].housing * count) throw new GameError(`${to.name}'s hatcheries are full`);
    removeFromArmy(me.nest.army, { [kind]: count });
    addToArmy(to.nest.army, { [kind]: count });
    this.save(me);
    this.save(to);
    this.push(to.id, { type: 'donation', from: me.name, kind, count });
    return { nest: me.nest };
  }

  private flockMemberIds(flockId: string): string[] {
    return (this.db.prepare('SELECT id FROM players WHERE flock_id = ?').all(flockId) as Raw[]).map((r) => r.id as string);
  }

  private pushFlock(flockId: string, msg: Record<string, unknown>, except?: string) {
    for (const id of this.flockMemberIds(flockId)) if (id !== except) this.push(id, msg);
  }

  // ------------------------------------------------------------ flock raids

  openRaid(playerId: string, targetId: string) {
    const me = this.player(playerId);
    if (!me.flockId) throw new GameError('Join a flock to raid together');
    const target = this.player(targetId);
    if (target.flockId === me.flockId) throw new GameError("That's a flock-mate!");
    const busy = this.db.prepare(`SELECT 1 FROM raids WHERE flock_id = ? AND status = 'pledging'`).get(me.flockId);
    if (busy) throw new GameError('Your flock already has a raid gathering');
    const id = randomUUID();
    const now = this.now();
    this.db
      .prepare(`INSERT INTO raids (id, flock_id, leader_id, target_id, status, created_at, closes_at) VALUES (?, ?, ?, ?, 'pledging', ?, ?)`)
      .run(id, me.flockId, playerId, targetId, now, now + RAID_WINDOW_MS);
    this.pushFlock(me.flockId, { type: 'raidOpened', raidId: id, leader: me.name, target: target.name }, playerId);
    return this.raid(playerId, id);
  }

  pledge(playerId: string, raidId: string, army: unknown) {
    const me = this.player(playerId);
    const raid = this.raidRow(raidId);
    if (raid.flock_id !== me.flockId) throw new NotFound('No such raid');
    if (raid.status !== 'pledging') throw new GameError('Pledging has closed');
    if (!isValidArmy(army) || armyTotal(army) === 0) throw new GameError('Pledge at least one duck');
    for (const k of COMBAT_DUCKS) if ((army[k] ?? 0) > (me.nest.army[k] ?? 0)) throw new GameError("You don't have those ducks");
    if (armyHousing(this.pooledArmy(raidId)) + armyHousing(army) > MAX_RAID_HOUSING) throw new GameError(`Raids are capped at ${MAX_RAID_HOUSING} housing`);
    removeFromArmy(me.nest.army, army);
    this.save(me);
    this.addPledge(raidId, playerId, army);
    this.pushFlock(me.flockId!, { type: 'raidPledge', raidId, name: me.name }, playerId);
    return this.raid(playerId, raidId);
  }

  addPledge(raidId: string, playerId: string, army: Army) {
    const existing = this.db.prepare('SELECT army FROM raid_pledges WHERE raid_id = ? AND player_id = ?').get(raidId, playerId) as Raw | undefined;
    const total: Army = existing ? JSON.parse(existing.army as string) : {};
    addToArmy(total, army);
    this.db
      .prepare('INSERT INTO raid_pledges (raid_id, player_id, army) VALUES (?, ?, ?) ON CONFLICT(raid_id, player_id) DO UPDATE SET army = excluded.army')
      .run(raidId, playerId, JSON.stringify(total));
  }

  private raidRow(raidId: string): Raw {
    const r = this.db.prepare('SELECT * FROM raids WHERE id = ?').get(raidId) as Raw | undefined;
    if (!r) throw new NotFound('No such raid');
    return r;
  }

  private pledges(raidId: string): Array<{ playerId: string; army: Army }> {
    return (this.db.prepare('SELECT * FROM raid_pledges WHERE raid_id = ? ORDER BY player_id').all(raidId) as Raw[]).map((r) => ({
      playerId: r.player_id as string,
      army: JSON.parse(r.army as string),
    }));
  }

  private pooledArmy(raidId: string): Army {
    const pool: Army = {};
    for (const p of this.pledges(raidId)) addToArmy(pool, p.army);
    return pool;
  }

  raid(playerId: string, raidId: string) {
    const r = this.raidRow(raidId);
    const me = this.player(playerId);
    if (r.flock_id !== me.flockId && !this.db.prepare('SELECT 1 FROM raid_pledges WHERE raid_id = ? AND player_id = ?').get(raidId, playerId)) {
      throw new NotFound('No such raid');
    }
    return {
      id: raidId,
      leaderId: r.leader_id as string,
      leaderName: this.player(r.leader_id as string).name,
      targetId: r.target_id as string,
      targetName: this.player(r.target_id as string).name,
      status: r.status as string,
      closesAt: r.closes_at as number,
      attackId: (r.attack_id as string | null) ?? null,
      result: r.result ? (JSON.parse(r.result as string) as BattleResult) : null,
      pledges: this.pledges(raidId).map((p) => ({ ...p, name: this.player(p.playerId).name, housing: armyHousing(p.army) })),
      pooled: this.pooledArmy(raidId),
    };
  }

  raids(playerId: string) {
    const me = this.player(playerId);
    if (!me.flockId) return [];
    const rows = this.db.prepare('SELECT id FROM raids WHERE flock_id = ? ORDER BY created_at DESC LIMIT 10').all(me.flockId) as Raw[];
    return rows.map((r) => this.raid(playerId, r.id as string));
  }

  launchRaid(playerId: string, raidId: string): AttackSetupView {
    const r = this.raidRow(raidId);
    if (r.leader_id !== playerId) throw new GameError('Only the raid leader can launch');
    if (r.status !== 'pledging') throw new GameError('This raid already launched');
    const pool = this.pooledArmy(raidId);
    if (armyTotal(pool) === 0) throw new GameError('Nobody has pledged any ducks yet');
    const view = this.createAttack(this.player(playerId), r.target_id as string, pool, raidId);
    this.db.prepare(`UPDATE raids SET status = 'launched', attack_id = ? WHERE id = ?`).run(view.attackId, raidId);
    this.pushFlock(r.flock_id as string, { type: 'raidLaunched', raidId }, playerId);
    return view;
  }

  /** Loot is split by how much housing each member pledged. */
  private splitRaidLoot(raidId: string, result: BattleResult, pebbleBonus: number) {
    const pledges = this.pledges(raidId);
    const total = pledges.reduce((n, p) => n + armyHousing(p.army), 0) || 1;
    let gGiven = 0;
    let fGiven = 0;
    pledges.forEach((pl, i) => {
      const last = i === pledges.length - 1;
      const w = armyHousing(pl.army) / total;
      const grain = last ? result.loot.grain - gGiven : Math.floor(result.loot.grain * w);
      const feathers = last ? result.loot.feathers - fGiven : Math.floor(result.loot.feathers * w);
      gGiven += grain;
      fGiven += feathers;
      const p = this.player(pl.playerId);
      addResources(p.nest, { grain, feathers, pebbles: pebbleBonus });
      this.save(p);
      this.push(p.id, { type: 'raidResult', raidId, stars: result.stars, share: { grain, feathers } });
    });
  }

  /** Give pledged ducks back if a raid never happens. */
  refundRaid(raidId: string) {
    for (const pl of this.pledges(raidId)) {
      const p = this.player(pl.playerId);
      addToArmy(p.nest.army, pl.army);
      this.save(p);
    }
    this.db.prepare(`UPDATE raids SET status = 'expired' WHERE id = ?`).run(raidId);
  }

  // ------------------------------------------------------------ pigeons

  private pigeonEndpoints(fromId: string, toId: string) {
    const from = this.player(fromId);
    const to = this.player(toId);
    if (!from.flockId || from.flockId !== to.flockId || from.id === to.id) throw new GameError('Pigeons only fly between flock-mates');
    if (from.loftLevel < 1) throw new GameError('Build a Pigeon Loft first');
    return { from, to };
  }

  pigeonPreview(fromId: string, toId: string, kind: PigeonKind) {
    if (!(kind in PIGEON_KINDS)) throw new GameError('Unknown pigeon');
    const { from, to } = this.pigeonEndpoints(fromId, toId);
    const armor = loftArmor(from.loftLevel) + PIGEON_KINDS[kind].extraArmor;
    const route = hawksAlongRoute({ x: from.wx, y: from.wy }, { x: to.wx, y: to.wy }, this.hawkPosts(), {
      senderId: from.id,
      recipientId: to.id,
      senderFlockId: from.flockId,
      armor,
    });
    const plan = planPigeon(0, { x: from.wx, y: from.wy }, { x: to.wx, y: to.wy }, [], {
      senderId: from.id,
      recipientId: to.id,
      senderFlockId: from.flockId,
      loftLevel: from.loftLevel,
      kind,
    });
    return {
      flightSeconds: Math.round(plan.flightSeconds),
      survival: survivalChance(route, PIGEON_KINDS[kind].escort),
      hawks: route.map((h) => ({ name: this.player(h.playerId).name, level: h.level, chance: h.chance })),
      cost: PIGEON_KINDS[kind].cost,
      cipher: loftHasCipher(from.loftLevel),
    };
  }

  sendPigeon(fromId: string, toId: string, text: string, kind: PigeonKind = 'standard') {
    if (!(kind in PIGEON_KINDS)) throw new GameError('Unknown pigeon');
    const body = String(text ?? '').trim().slice(0, 280);
    if (!body) throw new GameError('Write something first');
    const { from, to } = this.pigeonEndpoints(fromId, toId);
    const cost = PIGEON_KINDS[kind].cost;
    if (!canAfford(from.nest.resources, cost)) throw new GameError('Not enough resources for that pigeon');
    from.nest.resources.grain -= cost.grain;
    from.nest.resources.feathers -= cost.feathers;
    this.save(from);
    const id = randomUUID();
    const now = this.now();
    const seed = hashSeed(id);
    const plan = planPigeon(seed, { x: from.wx, y: from.wy }, { x: to.wx, y: to.wy }, this.hawkPosts(), {
      senderId: from.id,
      recipientId: to.id,
      senderFlockId: from.flockId,
      loftLevel: from.loftLevel,
      kind,
    });
    const arriveAt = now + Math.round(plan.flightSeconds * 1000);
    const interceptAt = plan.interceptedBy ? now + Math.round(plan.flightSeconds * plan.interceptT! * 1000) : null;
    const seen = plan.interceptedBy ? (loftHasCipher(from.loftLevel) ? scrambleMessage(body, seed) : body) : null;
    this.db
      .prepare(
        `INSERT INTO pigeons (id, from_id, to_id, body, kind, sent_at, arrive_at, intercepted_by, intercept_at, seen_text, hawks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, from.id, to.id, body, kind, now, arriveAt, plan.interceptedBy, interceptAt, seen, plan.hawks.length);
    return { id, arriveAt, hawksOnRoute: plan.hawks.length, nest: from.nest };
  }

  inbox(playerId: string) {
    const now = this.now();
    const name = (id: string) => (this.db.prepare('SELECT name FROM players WHERE id = ?').get(id) as Raw | undefined)?.name as string;
    const received = (
      this.db
        .prepare('SELECT * FROM pigeons WHERE to_id = ? AND intercepted_by IS NULL AND arrive_at <= ? ORDER BY arrive_at DESC LIMIT 50')
        .all(playerId, now) as Raw[]
    ).map((r) => ({ id: r.id, from: name(r.from_id as string), fromId: r.from_id, text: r.body, kind: r.kind, at: r.arrive_at }));
    const sent = (this.db.prepare('SELECT * FROM pigeons WHERE from_id = ? ORDER BY sent_at DESC LIMIT 50').all(playerId) as Raw[]).map((r) => {
      const landed = (r.arrive_at as number) <= now;
      const status = !landed ? 'flying' : r.intercepted_by ? 'lost' : 'delivered';
      return {
        id: r.id,
        toId: r.to_id,
        to: name(r.to_id as string),
        text: r.body,
        kind: r.kind,
        sentAt: r.sent_at,
        arriveAt: r.arrive_at,
        status,
        hawks: r.hawks,
      };
    });
    const intercepted = (
      this.db
        .prepare('SELECT * FROM pigeons WHERE intercepted_by = ? AND intercept_at <= ? ORDER BY intercept_at DESC LIMIT 50')
        .all(playerId, now) as Raw[]
    ).map((r) => ({ id: r.id, from: name(r.from_id as string), to: name(r.to_id as string), text: r.seen_text, at: r.intercept_at, scrambled: r.seen_text !== r.body }));
    return { received, sent, intercepted, serverTime: now };
  }
}

function parseCommands(input: unknown): DeployCommand[] {
  if (!Array.isArray(input) || input.length > MAX_COMMANDS) throw new GameError('Bad battle commands');
  return input.map((c) => {
    if (!c || typeof c !== 'object') throw new GameError('Bad battle command');
    const o = c as Record<string, unknown>;
    if (!Number.isInteger(o.tick) || (o.tick as number) < 0) throw new GameError('Bad battle command');
    if (o.type === 'surrender') return { tick: o.tick as number, type: 'surrender' };
    if (o.type !== 'deploy' || typeof o.kind !== 'string' || !isCombatDuck(o.kind) || !Number.isInteger(o.x) || !Number.isInteger(o.y)) {
      throw new GameError('Bad battle command');
    }
    return { tick: o.tick as number, type: 'deploy', kind: o.kind, x: o.x as number, y: o.y as number };
  });
}

