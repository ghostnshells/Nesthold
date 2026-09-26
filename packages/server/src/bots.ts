import { randomUUID } from 'node:crypto';
import { generateBotNest, hashSeed } from '@nesthold/shared';
import type { Army } from '@nesthold/shared';
import type { Db } from './db';
import { insertPlayer } from './db';
import type { Game } from './game';

interface BotSpec {
  name: string;
  core: 1 | 2 | 3;
  x: number;
  y: number;
  flock: 'Puddle Patrol' | 'The Honkers' | null;
  /** Unaffiliated bots don't keep hawks, so the map isn't a pigeon death-trap. */
  hawk: boolean;
}

export const BOTS: BotSpec[] = [
  { name: 'Captain Quackers', core: 2, x: 430, y: 470, flock: 'Puddle Patrol', hawk: true },
  { name: 'Dabbles', core: 1, x: 610, y: 420, flock: 'Puddle Patrol', hawk: false },
  { name: 'Sir Waddlesworth', core: 3, x: 560, y: 650, flock: 'Puddle Patrol', hawk: true },
  { name: 'Gooseberry', core: 2, x: 540, y: 520, flock: 'The Honkers', hawk: true },
  { name: 'Honk Norris', core: 3, x: 380, y: 610, flock: 'The Honkers', hawk: true },
  { name: 'Loose Goose', core: 1, x: 280, y: 300, flock: 'The Honkers', hawk: false },
  { name: 'Mudpuddle', core: 1, x: 720, y: 260, flock: null, hawk: false },
  { name: 'Old Drake', core: 2, x: 240, y: 720, flock: null, hawk: false },
  { name: 'Bill Board', core: 3, x: 800, y: 790, flock: null, hawk: false },
];

const REPLIES = [
  'Quack received! Meet at the pond at dawn.',
  "Honkers were circling near my loft. Watch your pigeons.",
  'I can spare a few Mallards for the next raid.',
  'Did you see Old Drake left his granary wide open?',
  'Remember: feed scatterers only fool a handful of us. Charge!',
  'Building another Hawk Perch. Nobody reads our mail.',
];

export function botArmy(core: number): Army {
  return { mallard: 6 * core, merganser: 2 * core, teal: core, sapper: core, eider: core > 1 ? 1 : 0 };
}

export function seedBots(db: Db, now: number): void {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM players WHERE is_bot = 1').get() as { n: number }).n;
  if (count > 0) return;
  const flockIds = new Map<string, string>();
  for (const spec of BOTS) {
    const id = `bot-${spec.name.toLowerCase().replace(/[^a-z]+/g, '-')}`;
    let flockId: string | null = null;
    if (spec.flock) {
      flockId = flockIds.get(spec.flock) ?? null;
      if (!flockId) {
        flockId = randomUUID();
        flockIds.set(spec.flock, flockId);
        db.prepare('INSERT INTO flocks (id, name, leader_id, created_at) VALUES (?, ?, ?, ?)').run(flockId, spec.flock, id, now);
      }
    }
    const nest = generateBotNest(hashSeed(spec.name), spec.core, now);
    if (!spec.hawk) nest.buildings = nest.buildings.filter((b) => b.kind !== 'hawkPerch');
    else if (!nest.buildings.some((b) => b.kind === 'hawkPerch')) nest.buildings.push({ id: `b${nest.nextId++}`, kind: 'hawkPerch', level: Math.max(1, spec.core), x: 1, y: 1 });
    if (!nest.buildings.some((b) => b.kind === 'pigeonLoft')) nest.buildings.push({ id: `b${nest.nextId++}`, kind: 'pigeonLoft', level: 1, x: 33, y: 1 });
    nest.army = botArmy(spec.core);
    insertPlayer(
      db,
      {
        id,
        token: randomUUID(),
        name: spec.name,
        nest,
        wx: spec.x,
        wy: spec.y,
        flockId,
        trophies: 40 * spec.core,
        shieldUntil: 0,
        isBot: true,
        updatedAt: now,
      },
      now,
    );
  }
}

/**
 * Periodic world upkeep: push pigeon arrivals/interceptions, let bot flock-mates reply to pigeons and
 * pledge to raids, and expire stale raids. Safe to call as often as you like.
 */
export function runScheduler(game: Game): void {
  const db = game.db;
  const now = game.now();
  type Row = Record<string, any>;

  // Pigeon notifications (bit 1 = arrival pushed, 2 = interception pushed, 4 = loss pushed).
  const due = db
    .prepare('SELECT * FROM pigeons WHERE pushed < 7 AND (arrive_at <= ? OR (intercept_at IS NOT NULL AND intercept_at <= ?))')
    .all(now, now) as Row[];
  for (const p of due) {
    let pushed = p.pushed as number;
    const arrived = (p.arrive_at as number) <= now;
    if (p.intercepted_by) {
      if (!(pushed & 2) && (p.intercept_at as number) <= now) {
        game.push(p.intercepted_by as string, { type: 'intercepted', pigeonId: p.id });
        pushed |= 2;
      }
      if (!(pushed & 4) && arrived) {
        game.push(p.from_id as string, { type: 'pigeonLost', pigeonId: p.id });
        pushed |= 4;
      }
      if (arrived) pushed |= 1;
    } else if (arrived) {
      game.push(p.to_id as string, { type: 'pigeon', pigeonId: p.id });
      pushed = 7;
    }
    db.prepare('UPDATE pigeons SET pushed = ? WHERE id = ?').run(pushed, p.id);
  }

  // Bots write back.
  const toBots = db
    .prepare(
      `SELECT pg.* FROM pigeons pg JOIN players pl ON pl.id = pg.to_id
       WHERE pl.is_bot = 1 AND pg.replied = 0 AND pg.intercepted_by IS NULL AND pg.arrive_at <= ?`,
    )
    .all(now) as Row[];
  for (const p of toBots) {
    db.prepare('UPDATE pigeons SET replied = 1 WHERE id = ?').run(p.id);
    try {
      const reply = REPLIES[Math.abs((p.id as string).charCodeAt(0) + (p.id as string).charCodeAt(1)) % REPLIES.length];
      const bot = game.player(p.to_id as string);
      bot.nest.resources.grain += 50; // bots never run out of pigeon money
      db.prepare('UPDATE players SET nest = ? WHERE id = ?').run(JSON.stringify(bot.nest), bot.id);
      game.sendPigeon(p.to_id as string, p.from_id as string, reply, 'standard');
    } catch {
      // Sender left the flock, or similar. Bots don't hold grudges.
    }
  }

  // Bot flock-mates pledge to raids a few seconds after they open.
  const raids = db.prepare(`SELECT * FROM raids WHERE status = 'pledging'`).all() as Row[];
  for (const r of raids) {
    if ((r.closes_at as number) <= now) {
      game.refundRaid(r.id as string);
      continue;
    }
    if (now - (r.created_at as number) < 3000) continue;
    const bots = db
      .prepare(
        `SELECT id, core_level FROM players WHERE flock_id = ? AND is_bot = 1
         AND id NOT IN (SELECT player_id FROM raid_pledges WHERE raid_id = ?)`,
      )
      .all(r.flock_id, r.id) as Row[];
    for (const b of bots) {
      const core = b.core_level as number;
      game.addPledge(r.id as string, b.id as string, { mallard: 3 * core, merganser: core, teal: core > 1 ? 1 : 0 });
    }
  }

  // Launched raids whose attack was never played: hand the ducks back.
  const stale = db
    .prepare(`SELECT r.id FROM raids r JOIN attacks a ON a.id = r.attack_id WHERE r.status = 'launched' AND a.status = 'open' AND a.expires_at < ?`)
    .all(now) as Row[];
  for (const r of stale) {
    db.prepare(`UPDATE attacks SET status = 'abandoned' WHERE id = (SELECT attack_id FROM raids WHERE id = ?)`).run(r.id);
    game.refundRaid(r.id as string);
  }
}
