import { describe, expect, it } from 'vitest';
import {
  BattleSim,
  MAX_DISTRACTED_PER_TRIGGER,
  MAX_DISTRACTION_TICKS,
  generateBotNest,
  simulateBattle,
} from '../src';
import type { Army, BattleSetup, CombatDuckKind, BuildingKind, DeployCommand, PlacedBuilding } from '../src';

const T0 = 1_700_000_000_000;
let nextId = 1;
const B = (kind: BuildingKind, x: number, y: number, level = 1): PlacedBuilding => ({ id: `t${nextId++}`, kind, level, x, y });
const res = { grain: 10_000, feathers: 5_000, pebbles: 0 };

function deployWave(kind: CombatDuckKind, count: number, x: number, y: number, tick = 0): DeployCommand[] {
  return Array.from({ length: count }, (_, i) => ({ tick: tick + i, type: 'deploy' as const, kind, x, y }));
}

/** Runs a sim to completion (or maxTicks), collecting every event. */
function run(setup: BattleSetup, commands: DeployCommand[]) {
  const sim = new BattleSim(setup);
  const events: Array<{ tick: number; e: BattleSim['events'][number] }> = [];
  const sorted = [...commands].sort((a, b) => a.tick - b.tick);
  let ci = 0;
  while (!sim.isOver()) {
    while (ci < sorted.length && sorted[ci].tick === sim.tick) sim.queue(sorted[ci++]);
    sim.step();
    for (const e of sim.events) events.push({ tick: sim.tick - 1, e });
    if (ci >= sorted.length && sim.units.every((u) => u.dead) && sim.units.length) break;
  }
  return { sim, events };
}

describe('battle simulation', () => {
  const botArmy: Army = { mallard: 20, eider: 2, teal: 6, merganser: 6, sapper: 4, medic: 1 };
  const script: DeployCommand[] = [
    ...deployWave('sapper', 4, 2, 17, 0),
    ...deployWave('eider', 2, 2, 18, 5),
    ...deployWave('mallard', 20, 2, 16, 10),
    ...deployWave('merganser', 6, 17, 2, 40),
    ...deployWave('teal', 6, 33, 33, 60),
    { tick: 80, type: 'deploy', kind: 'medic', x: 2, y: 16 },
  ];

  it('is deterministic for the same seed and commands', () => {
    const nest = generateBotNest(42, 2, T0);
    const setup: BattleSetup = { seed: 7, buildings: nest.buildings, defenderResources: nest.resources, army: botArmy };
    const a = simulateBattle(setup, script);
    const b = simulateBattle(setup, script);
    expect(a).toEqual(b);
    expect(a.deployed).toEqual(botArmy);
    expect(a.destructionPct).toBeGreaterThan(0);
  });

  it('live stepping (client) matches server replay', () => {
    const nest = generateBotNest(9, 3, T0);
    const setup: BattleSetup = { seed: 1234, buildings: nest.buildings, defenderResources: nest.resources, army: botArmy };
    const live = run(setup, script).sim;
    const replay = simulateBattle(setup, script);
    const liveResult = live.result();
    expect({ ...liveResult, ticks: 0 }).toEqual({ ...replay, ticks: 0 });
  });

  it('ignores deploys on blocked tiles or beyond the army', () => {
    const sim = new BattleSim({ seed: 1, buildings: [B('nestCore', 16, 16)], defenderResources: res, army: { mallard: 1 } });
    expect(sim.canDeployAt(15, 15)).toBe(false);
    expect(sim.queue({ tick: 0, type: 'deploy', kind: 'mallard', x: 15, y: 15 })).toBe(false);
    expect(sim.queue({ tick: 0, type: 'deploy', kind: 'mallard', x: 2, y: 2 })).toBe(true);
    expect(sim.queue({ tick: 0, type: 'deploy', kind: 'mallard', x: 3, y: 2 })).toBe(false);
    expect(sim.queue({ tick: 0, type: 'deploy', kind: 'teal', x: 3, y: 2 })).toBe(false);
  });

  it('awards stars and loot for wiping out an undefended nest', () => {
    const buildings = [B('nestCore', 16, 16), B('granary', 10, 10)];
    const r = simulateBattle({ seed: 1, buildings, defenderResources: res, army: { mallard: 12 } }, deployWave('mallard', 12, 5, 5));
    expect(r.stars).toBe(3);
    expect(r.destructionPct).toBe(100);
    expect(r.loot.grain).toBe(res.grain * 0.2);
    expect(r.loot.feathers).toBe(res.feathers * 0.2);
  });

  it('ends when surrendering', () => {
    const r = simulateBattle(
      { seed: 1, buildings: [B('nestCore', 16, 16)], defenderResources: res, army: { mallard: 1 } },
      [{ tick: 3, type: 'surrender' }],
    );
    expect(r.ticks).toBe(3);
    expect(r.stars).toBe(0);
  });
});

describe('distractions', () => {
  it('feed scatterer distracts at most a handful of ducks for a few seconds', () => {
    const buildings = [B('nestCore', 30, 30), B('feedScatterer', 10, 10, 3)];
    const { sim, events } = run(
      { seed: 3, buildings, defenderResources: res, army: { mallard: 12 }, maxTicks: 400 },
      deployWave('mallard', 12, 8, 8).map((c) => ({ ...c, tick: 0 })),
    );
    const traps = events.filter((x) => x.e.type === 'trap');
    expect(traps.length).toBeGreaterThan(0);
    for (const t of traps) {
      if (t.e.type !== 'trap') continue;
      expect(t.e.affected.length).toBeLessThanOrEqual(4);
      expect(t.e.affected.length).toBeLessThanOrEqual(MAX_DISTRACTED_PER_TRIGGER);
    }
    // Level 3 feed has 2 charges; no more than 2 triggers ever.
    expect(traps.length).toBeLessThanOrEqual(2);
    expect(sim.units.every((u) => u.distraction === null || u.distractedUntil - sim.tick <= MAX_DISTRACTION_TICKS)).toBe(true);
  });

  it('distraction wears off within the duration cap', () => {
    const buildings = [B('nestCore', 30, 30), B('feedScatterer', 10, 10, 1)];
    const sim = new BattleSim({ seed: 3, buildings, defenderResources: res, army: { mallard: 6 } });
    for (let i = 0; i < 6; i++) sim.queue({ tick: 0, type: 'deploy', kind: 'mallard', x: 8, y: 8 });
    const distractedTicks = new Map<number, number>();
    for (let t = 0; t < 200; t++) {
      if (t > 0) for (const u of sim.units) if (u.distraction) distractedTicks.set(u.id, (distractedTicks.get(u.id) ?? 0) + 1);
      sim.step();
    }
    expect(distractedTicks.size).toBeGreaterThan(0);
    expect(distractedTicks.size).toBeLessThanOrEqual(3);
    for (const n of distractedTicks.values()) expect(n).toBeLessThanOrEqual(30);
  });

  it('mating horn ignores disciplined ducks (Eider, Medic)', () => {
    const buildings = [B('nestCore', 30, 30), B('matingHorn', 12, 12, 2)];
    const sim = new BattleSim({ seed: 3, buildings, defenderResources: res, army: { eider: 3, medic: 1, mallard: 2 } });
    for (const kind of ['eider', 'eider', 'eider', 'medic', 'mallard', 'mallard'] as const) {
      sim.queue({ tick: 0, type: 'deploy', kind, x: 9, y: 9 });
    }
    const affected = new Set<number>();
    for (let t = 0; t < 100; t++) {
      sim.step();
      for (const e of sim.events) if (e.type === 'trap') e.affected.forEach((id) => affected.add(id));
    }
    const kinds = [...affected].map((id) => sim.units[id].kind);
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds.every((k) => k === 'mallard')).toBe(true);
  });

  it('distracted ducks stop attacking', () => {
    const buildings = [B('nestCore', 30, 30), B('grainField', 11, 8), B('feedScatterer', 10, 10, 1)];
    const sim = new BattleSim({ seed: 3, buildings, defenderResources: res, army: { mallard: 1 } });
    sim.queue({ tick: 0, type: 'deploy', kind: 'mallard', x: 9, y: 7 });
    let distractedTicks = 0;
    for (let t = 0; t < 120; t++) {
      sim.step();
      const u = sim.units[0];
      if (u.distraction) {
        distractedTicks++;
        expect(sim.events.some((e) => e.type === 'hit')).toBe(false);
      }
    }
    expect(distractedTicks).toBeGreaterThan(0);
  });
});

describe('pathing and targeting', () => {
  it('walks around a wall line with a gap instead of breaking it', () => {
    const walls = Array.from({ length: 14 }, (_, i) => B('reedWall', 12, 10 + i)).filter((_, i) => i !== 12);
    const core = B('nestCore', 18, 14);
    const buildings = [core, ...walls];
    const { events, sim } = run({ seed: 1, buildings, defenderResources: res, army: { mallard: 1 } }, [
      { tick: 0, type: 'deploy', kind: 'mallard', x: 6, y: 15 },
    ]);
    const hits = events.filter((x) => x.e.type === 'hit').map((x) => (x.e as { building: number }).building);
    const coreIdx = sim.buildings.findIndex((b) => b.id === core.id);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h === coreIdx)).toBe(true);
  });

  it('breaks through when fully walled in', () => {
    const ring: PlacedBuilding[] = [];
    for (let i = 14; i <= 21; i++) ring.push(B('reedWall', i, 14), B('reedWall', i, 21));
    for (let i = 15; i < 21; i++) ring.push(B('reedWall', 14, i), B('reedWall', 21, i));
    const buildings = [B('nestCore', 16, 16), ...ring];
    const r = simulateBattle({ seed: 1, buildings, defenderResources: res, army: { mallard: 10 } }, deployWave('mallard', 10, 5, 17));
    expect(r.coreDestroyed).toBe(true);
  });

  it('sappers blow up walls and die', () => {
    const buildings = [B('nestCore', 30, 30), B('reedWall', 10, 10)];
    const { sim, events } = run({ seed: 1, buildings, defenderResources: res, army: { sapper: 1 }, maxTicks: 200 }, [
      { tick: 0, type: 'deploy', kind: 'sapper', x: 5, y: 10 },
    ]);
    expect(events.some((x) => x.e.type === 'boom')).toBe(true);
    expect(sim.buildings.find((b) => b.kind === 'reedWall')!.destroyed).toBe(true);
    expect(sim.units[0].dead).toBe(true);
  });

  it('birdshot ignores airborne teals; the air-defense catapult hits them', () => {
    const shotAt = (defense: BuildingKind) => {
      const buildings = [B('nestCore', 16, 16), B(defense, 12, 16)];
      const { sim, events } = run({ seed: 1, buildings, defenderResources: res, army: { teal: 3 }, maxTicks: 300 }, deployWave('teal', 3, 5, 17));
      return events.filter((x) => x.e.type === 'shot' && sim.buildings[(x.e as { building: number }).building].kind === defense).length;
    };
    expect(shotAt('birdshot')).toBe(0);
    expect(shotAt('catapult')).toBeGreaterThan(0);
  });

  it('eiders go for defenses first', () => {
    const buildings = [B('nestCore', 8, 8), B('heron', 25, 25)];
    const sim = new BattleSim({ seed: 1, buildings, defenderResources: res, army: { eider: 1 } });
    sim.queue({ tick: 0, type: 'deploy', kind: 'eider', x: 5, y: 5 });
    sim.step();
    sim.step();
    expect(sim.buildings[sim.units[0].target].kind).toBe('heron');
  });

  it('medics heal damaged ducks', () => {
    const buildings = [B('nestCore', 16, 16), B('heron', 22, 16)];
    const { events } = run({ seed: 1, buildings, defenderResources: res, army: { mallard: 5, medic: 1 }, maxTicks: 600 }, [
      ...deployWave('mallard', 5, 10, 17),
      { tick: 6, type: 'deploy', kind: 'medic', x: 10, y: 17 },
    ]);
    expect(events.some((x) => x.e.type === 'heal')).toBe(true);
  });
});
