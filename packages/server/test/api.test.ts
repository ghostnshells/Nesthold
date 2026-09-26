import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { BattleSim, simulateBattle } from '@nesthold/shared';
import type { Army, DeployCommand, PlacedBuilding } from '@nesthold/shared';
import { createApp } from '../src/app';
import { runScheduler, seedBots } from '../src/bots';
import { openDb } from '../src/db';
import { Game } from '../src/game';

const T0 = 1_750_000_000_000;
let clock = T0;
let game: Game;
let app: ReturnType<typeof createApp>;
let pushes: Array<{ to: string; msg: Record<string, unknown> }>;

beforeEach(() => {
  clock = T0;
  const db = openDb(':memory:');
  game = new Game(db, () => clock);
  pushes = [];
  game.push = (to, msg) => pushes.push({ to, msg });
  seedBots(db, clock);
  app = createApp(game);
});

async function guest(name = 'Tester') {
  const res = await request(app).post('/api/auth/guest').send({ name }).expect(200);
  const token = res.body.token as string;
  const get = (path: string) => request(app).get(`/api${path}`).set('Authorization', `Bearer ${token}`);
  const post = (path: string, body: object = {}) => request(app).post(`/api${path}`).set('Authorization', `Bearer ${token}`).send(body);
  return { token, id: res.body.player.id as string, body: res.body, get, post };
}

/** A simple attack plan: every duck deployed on the first free tile along the west edge. */
function planAttack(buildings: PlacedBuilding[], army: Army): DeployCommand[] {
  const sim = new BattleSim({ seed: 0, buildings, defenderResources: { grain: 0, feathers: 0, pebbles: 0 }, army });
  let spot = { x: 0, y: 0 };
  for (let y = 18; y < 36; y++) if (sim.canDeployAt(0, y)) {
    spot = { x: 0, y };
    break;
  }
  const cmds: DeployCommand[] = [];
  let tick = 0;
  for (const [kind, n] of Object.entries(army)) for (let i = 0; i < (n ?? 0); i++) cmds.push({ tick: tick++, type: 'deploy', kind: kind as any, ...spot });
  return cmds;
}

describe('auth and nest', () => {
  it('creates a guest with a starter nest', async () => {
    const g = await guest('Quackie');
    expect(g.body.player.name).toBe('Quackie');
    expect(g.body.nest.buildings.some((b: PlacedBuilding) => b.kind === 'nestCore')).toBe(true);
    const me = await g.get('/me').expect(200);
    expect(me.body.player.id).toBe(g.id);
  });

  it('rejects requests without a token', async () => {
    await request(app).get('/api/me').expect(401);
  });

  it('builds, waits, and collects with server-side timers', async () => {
    const g = await guest();
    const placed = await g.post('/nest/action', { type: 'place', kind: 'grainField', x: 4, y: 4 }).expect(200);
    const field = placed.body.nest.buildings.find((b: PlacedBuilding) => b.x === 4 && b.y === 4);
    expect(field.level).toBe(0);
    await g.post('/nest/action', { type: 'place', kind: 'grainField', x: 16, y: 16 }).expect(400);
    clock += 10_000;
    const me = await g.get('/me');
    expect(me.body.nest.buildings.find((b: PlacedBuilding) => b.id === field.id).level).toBe(1);
    clock += 3_600_000;
    const col = await g.post('/nest/action', { type: 'collectAll' }).expect(200);
    expect(col.body.gained.grain).toBeGreaterThan(0);
  });
});

describe('attacks', () => {
  it('replays the battle server-side and ignores a tampered loot claim', async () => {
    const g = await guest();
    const world = await g.get('/world').expect(200);
    const target = world.body.find((p: { name: string }) => p.name === 'Mudpuddle');
    const start = await g.post('/attack/start', { targetId: target.id }).expect(200);
    const cmds = planAttack(start.body.buildings, start.body.army);
    const expected = simulateBattle(
      { seed: start.body.seed, buildings: start.body.buildings, defenderResources: start.body.defenderResources, army: start.body.army },
      cmds,
    );
    const before = (await g.get('/me')).body.nest.resources;
    const res = await g
      .post('/attack/submit', { attackId: start.body.attackId, commands: cmds, claimed: { stars: 3, destructionPct: 100, loot: { grain: 999999, feathers: 999999 } } })
      .expect(200);
    expect(res.body.result).toEqual(expected);
    expect(res.body.mismatch).toBe(true);
    expect(res.body.nest.resources.grain).toBeLessThanOrEqual(before.grain + expected.loot.grain);
    expect(res.body.nest.resources.grain).toBeLessThan(999999);
    // Every deployed duck is spent.
    expect(res.body.nest.army.mallard ?? 0).toBe(0);
    // Can't submit twice.
    await g.post('/attack/submit', { attackId: start.body.attackId, commands: cmds }).expect(400);

    const battles = await g.get('/battles').expect(200);
    expect(battles.body[0].id).toBe(start.body.attackId);
    const replay = await g.get(`/battles/${start.body.attackId}`).expect(200);
    expect(replay.body.commands).toEqual(cmds);
  });

  it('rejects malformed commands', async () => {
    const g = await guest();
    const world = await g.get('/world');
    const target = world.body.find((p: { name: string }) => p.name === 'Dabbles');
    const start = await g.post('/attack/start', { targetId: target.id }).expect(200);
    await g.post('/attack/submit', { attackId: start.body.attackId, commands: [{ tick: 0, type: 'deploy', kind: 'dragon', x: 0, y: 0 }] }).expect(400);
  });

  it('shields a human defender and moves loot between players', async () => {
    const a = await guest('Attacker');
    const d = await guest('Defender');
    const start = await a.post('/attack/start', { targetId: d.id }).expect(200);
    const res = await a.post('/attack/submit', { attackId: start.body.attackId, commands: planAttack(start.body.buildings, start.body.army) }).expect(200);
    expect(res.body.result.destructionPct).toBeGreaterThan(0);
    const dMe = await d.get('/me');
    expect(dMe.body.player.shielded).toBe(true);
    expect(dMe.body.nest.resources.grain).toBe(d.body.nest.resources.grain - res.body.result.loot.grain);
    expect(pushes.some((p) => p.to === d.id && p.msg.type === 'attacked')).toBe(true);
    await a.post('/attack/start', { targetId: d.id }).expect(400);
    const log = await d.get('/battles');
    expect(log.body[0].asDefender).toBe(true);
  });
});

describe('flocks, donations and raids', () => {
  it('donates ducks to a flock-mate', async () => {
    const a = await guest('A');
    const b = await guest('B');
    const flock = await a.post('/flock/create', { name: 'Mighty Ducks' }).expect(200);
    await b.post('/flock/join', { flockId: flock.body.id }).expect(200);
    // Starter hatcheries are full; make room in B's.
    const bNest = (await b.get('/me')).body.nest;
    bNest.army = { mallard: 2 };
    game.db.prepare('UPDATE players SET nest = ? WHERE id = ?').run(JSON.stringify(bNest), b.id);
    const bMe = await b.get('/me');
    expect(bMe.body.player.flockName).toBe('Mighty Ducks');
    await a.post('/flock/donate', { to: b.id, kind: 'teal', count: 1 }).expect(200);
    const after = await b.get('/me');
    expect(after.body.nest.army.teal).toBe(1);
    expect((await a.get('/me')).body.nest.army.teal).toBe(1);
  });

  it('runs a flock raid with bot pledges and splits the loot', async () => {
    const a = await guest('Raider');
    const flocks = await a.get('/flocks');
    const patrol = flocks.body.find((f: { name: string }) => f.name === 'Puddle Patrol');
    await a.post('/flock/join', { flockId: patrol.id }).expect(200);
    const world = await a.get('/world');
    const target = world.body.find((p: { name: string }) => p.name === 'Mudpuddle');
    const raid = await a.post('/raid/open', { targetId: target.id }).expect(200);
    await a.post('/raid/pledge', { raidId: raid.body.id, army: { mallard: 5 } }).expect(200);
    await a.post('/raid/pledge', { raidId: raid.body.id, army: { mallard: 99 } }).expect(400);
    clock += 4000;
    runScheduler(game);
    const raids = await a.get('/raids');
    expect(raids.body[0].pledges.length).toBe(4); // me + 3 bots
    const launch = await a.post('/raid/launch', { raidId: raid.body.id }).expect(200);
    expect(launch.body.army.mallard).toBeGreaterThan(5);
    const res = await a.post('/attack/submit', { attackId: launch.body.attackId, commands: planAttack(launch.body.buildings, launch.body.army) }).expect(200);
    const final = (await a.get('/raids')).body[0];
    expect(final.status).toBe('done');
    const shares = pushes.filter((p) => p.msg.type === 'raidResult').map((p) => p.msg.share as { grain: number });
    expect(shares.reduce((n, s) => n + s.grain, 0)).toBe(res.body.result.loot.grain);
    // Ducks pledged by me were already spent; the rest of my army is intact.
    expect(res.body.nest.army.mallard).toBe(5);
  });

  it('refunds pledges when a raid window closes', async () => {
    const a = await guest('Planner');
    const patrol = (await a.get('/flocks')).body.find((f: { name: string }) => f.name === 'Puddle Patrol');
    await a.post('/flock/join', { flockId: patrol.id });
    const target = (await a.get('/world')).body.find((p: { name: string }) => p.name === 'Old Drake');
    const raid = await a.post('/raid/open', { targetId: target.id }).expect(200);
    await a.post('/raid/pledge', { raidId: raid.body.id, army: { mallard: 4 } }).expect(200);
    expect((await a.get('/me')).body.nest.army.mallard).toBe(6);
    clock += 11 * 60_000;
    runScheduler(game);
    expect((await a.get('/me')).body.nest.army.mallard).toBe(10);
    expect((await a.get('/raids')).body[0].status).toBe('expired');
  });
});

describe('carrier pigeons', () => {
  async function flockPair() {
    const a = await guest('Sender');
    const b = await guest('Receiver');
    const flock = await a.post('/flock/create', { name: 'Pond Posse' });
    await b.post('/flock/join', { flockId: flock.body.id });
    game.db.prepare('UPDATE players SET wx = 100, wy = 100 WHERE id = ?').run(a.id);
    game.db.prepare('UPDATE players SET wx = 900, wy = 100 WHERE id = ?').run(b.id);
    // Park every bot hawk far away from the route.
    game.db.prepare('UPDATE players SET wy = 900 WHERE is_bot = 1').run();
    return { a, b };
  }

  it('only flies between flock-mates', async () => {
    const a = await guest('Loner');
    const b = await guest('Stranger');
    await a.post('/pigeon/send', { to: b.id, text: 'hi' }).expect(400);
  });

  it('delivers when no hawks are on the route', async () => {
    const { a, b } = await flockPair();
    const preview = await a.post('/pigeon/preview', { to: b.id, kind: 'standard' }).expect(200);
    expect(preview.body.hawks).toEqual([]);
    expect(preview.body.survival).toBe(1);
    const sent = await a.post('/pigeon/send', { to: b.id, text: 'Raid at dawn' }).expect(200);
    expect(sent.body.arriveAt - clock).toBe(100_000);
    expect((await b.get('/pigeon/inbox')).body.received).toEqual([]);
    expect((await a.get('/pigeon/inbox')).body.sent[0].status).toBe('flying');
    clock += 100_000;
    runScheduler(game);
    const inbox = await b.get('/pigeon/inbox');
    expect(inbox.body.received[0].text).toBe('Raid at dawn');
    expect((await a.get('/pigeon/inbox')).body.sent[0].status).toBe('delivered');
    expect(pushes.some((p) => p.to === b.id && p.msg.type === 'pigeon')).toBe(true);
  });

  it('rival hawks along the route intercept and read messages', async () => {
    const { a, b } = await flockPair();
    const hawk = await guest('Hawkeye');
    // Give the rival a max-level hawk perch right under the flight path.
    const nest = (await hawk.get('/me')).body.nest;
    nest.buildings.push({ id: 'hp', kind: 'hawkPerch', level: 3, x: 2, y: 2 });
    game.db.prepare('UPDATE players SET nest = ?, hawk_level = 3, wx = 500, wy = 150 WHERE id = ?').run(JSON.stringify(nest), hawk.id);

    const preview = await a.post('/pigeon/preview', { to: b.id, kind: 'standard' }).expect(200);
    expect(preview.body.hawks.map((h: { name: string }) => h.name)).toEqual(['Hawkeye']);
    const armored = await a.post('/pigeon/preview', { to: b.id, kind: 'armored' }).expect(200);
    expect(armored.body.survival).toBeGreaterThan(preview.body.survival);

    // Top the sender up so they can afford a flurry of pigeons.
    const aNest = (await a.get('/me')).body.nest;
    aNest.resources.grain = 1500;
    game.db.prepare('UPDATE players SET nest = ? WHERE id = ?').run(JSON.stringify(aNest), a.id);
    for (let i = 0; i < 30; i++) await a.post('/pigeon/send', { to: b.id, text: `secret ${i}` }).expect(200);
    clock += 50_000; // halfway: interceptions have happened, nothing has landed
    runScheduler(game);
    const caught = (await hawk.get('/pigeon/inbox')).body.intercepted;
    expect(caught.length).toBeGreaterThan(5);
    expect(caught[0].text).toMatch(/^secret \d+$/);
    expect(caught[0].scrambled).toBe(false);
    expect(pushes.filter((p) => p.to === hawk.id && p.msg.type === 'intercepted').length).toBe(caught.length);

    clock += 60_000;
    runScheduler(game);
    const received = (await b.get('/pigeon/inbox')).body.received;
    const sent = (await a.get('/pigeon/inbox')).body.sent;
    expect(received.length + caught.length).toBe(30);
    expect(sent.filter((s: { status: string }) => s.status === 'lost').length).toBe(caught.length);
    expect(pushes.filter((p) => p.to === a.id && p.msg.type === 'pigeonLost').length).toBe(caught.length);
  });

  it('bot flock-mates write back', async () => {
    const a = await guest('Pen Pal');
    const patrol = (await a.get('/flocks')).body.find((f: { name: string }) => f.name === 'Puddle Patrol');
    await a.post('/flock/join', { flockId: patrol.id });
    const captain = (await a.get('/world')).body.find((p: { name: string }) => p.name === 'Captain Quackers');
    // Keep the rival Honkers' hawks out of this test.
    game.db.prepare(`UPDATE players SET hawk_level = 0 WHERE flock_id != ?`).run(patrol.id);
    await a.post('/pigeon/send', { to: captain.id, text: 'Hello captain!' }).expect(200);
    clock += 5 * 60_000;
    runScheduler(game);
    clock += 5 * 60_000;
    runScheduler(game);
    const inbox = (await a.get('/pigeon/inbox')).body;
    expect(inbox.received.length).toBe(1);
    expect(inbox.received[0].from).toBe('Captain Quackers');
  });
});
