import { DatabaseSync } from 'node:sqlite';
import type { NestState } from '@nesthold/shared';
import { coreLevel, hawkPerchLevel, pigeonLoftLevel } from '@nesthold/shared';

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      nest TEXT NOT NULL,
      wx REAL NOT NULL,
      wy REAL NOT NULL,
      flock_id TEXT,
      trophies INTEGER NOT NULL DEFAULT 0,
      shield_until INTEGER NOT NULL DEFAULT 0,
      is_bot INTEGER NOT NULL DEFAULT 0,
      core_level INTEGER NOT NULL DEFAULT 1,
      hawk_level INTEGER NOT NULL DEFAULT 0,
      loft_level INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS flocks (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      leader_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attacks (
      id TEXT PRIMARY KEY,
      attacker_id TEXT NOT NULL,
      defender_id TEXT NOT NULL,
      raid_id TEXT,
      seed INTEGER NOT NULL,
      buildings TEXT NOT NULL,
      defender_resources TEXT NOT NULL,
      army TEXT NOT NULL,
      status TEXT NOT NULL,
      commands TEXT,
      result TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pigeons (
      id TEXT PRIMARY KEY,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      body TEXT NOT NULL,
      kind TEXT NOT NULL,
      sent_at INTEGER NOT NULL,
      arrive_at INTEGER NOT NULL,
      intercepted_by TEXT,
      intercept_at INTEGER,
      seen_text TEXT,
      hawks INTEGER NOT NULL DEFAULT 0,
      pushed INTEGER NOT NULL DEFAULT 0,
      replied INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS raids (
      id TEXT PRIMARY KEY,
      flock_id TEXT NOT NULL,
      leader_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      status TEXT NOT NULL,
      attack_id TEXT,
      result TEXT,
      created_at INTEGER NOT NULL,
      closes_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS raid_pledges (
      raid_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      army TEXT NOT NULL,
      PRIMARY KEY (raid_id, player_id)
    );
    CREATE INDEX IF NOT EXISTS idx_pigeons_to ON pigeons(to_id);
    CREATE INDEX IF NOT EXISTS idx_pigeons_from ON pigeons(from_id);
    CREATE INDEX IF NOT EXISTS idx_attacks_players ON attacks(attacker_id, defender_id);
  `);
  return db;
}

export interface PlayerRow {
  id: string;
  token: string;
  name: string;
  nest: NestState;
  wx: number;
  wy: number;
  flockId: string | null;
  trophies: number;
  shieldUntil: number;
  isBot: boolean;
  coreLevel: number;
  hawkLevel: number;
  loftLevel: number;
  updatedAt: number;
}

type Raw = Record<string, any>;

export function toPlayer(r: Raw): PlayerRow {
  return {
    id: r.id as string,
    token: r.token as string,
    name: r.name as string,
    nest: JSON.parse(r.nest as string),
    wx: r.wx as number,
    wy: r.wy as number,
    flockId: (r.flock_id as string | null) ?? null,
    trophies: r.trophies as number,
    shieldUntil: r.shield_until as number,
    isBot: !!r.is_bot,
    coreLevel: r.core_level as number,
    hawkLevel: r.hawk_level as number,
    loftLevel: r.loft_level as number,
    updatedAt: r.updated_at as number,
  };
}

export function insertPlayer(db: Db, p: Omit<PlayerRow, 'coreLevel' | 'hawkLevel' | 'loftLevel'>, now: number): void {
  db.prepare(
    `INSERT INTO players (id, token, name, nest, wx, wy, flock_id, trophies, shield_until, is_bot, core_level, hawk_level, loft_level, updated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    p.id,
    p.token,
    p.name,
    JSON.stringify(p.nest),
    p.wx,
    p.wy,
    p.flockId,
    p.trophies,
    p.shieldUntil,
    p.isBot ? 1 : 0,
    coreLevel(p.nest),
    hawkPerchLevel(p.nest),
    pigeonLoftLevel(p.nest),
    p.updatedAt,
    now,
  );
}

export function saveNest(db: Db, id: string, nest: NestState, now: number): void {
  db.prepare(`UPDATE players SET nest = ?, core_level = ?, hawk_level = ?, loft_level = ?, updated_at = ? WHERE id = ?`).run(
    JSON.stringify(nest),
    coreLevel(nest),
    hawkPerchLevel(nest),
    pigeonLoftLevel(nest),
    now,
    id,
  );
}

