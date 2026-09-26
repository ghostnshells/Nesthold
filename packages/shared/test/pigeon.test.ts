import { describe, expect, it } from 'vitest';
import { closestOnSegment, hawksAlongRoute, interceptChance, planPigeon, scrambleMessage, survivalChance } from '../src';
import type { HawkPost } from '../src';

const from = { x: 100, y: 100 };
const to = { x: 900, y: 100 };
const hawk = (playerId: string, x: number, y: number, level = 2, flockId: string | null = 'rivals'): HawkPost => ({ playerId, x, y, level, flockId });
const base = { senderId: 'me', recipientId: 'friend', senderFlockId: 'mine' };

describe('pigeon routes', () => {
  it('measures closest approach to the flight line', () => {
    expect(closestOnSegment(from, to, { x: 500, y: 180 })).toEqual({ t: 0.5, distance: 80 });
    expect(closestOnSegment(from, to, { x: 0, y: 100 }).t).toBe(0);
  });

  it('only counts hawks whose radius reaches the route', () => {
    const hawks = [
      hawk('near', 500, 200), // 100 away, lvl2 radius 120 -> in
      hawk('far', 500, 300), // 200 away -> out
      hawk('ally', 300, 110, 3, 'mine'), // same flock -> ignored
      hawk('friend', 880, 100), // the recipient -> ignored
      hawk('early', 150, 150, 1), // 50 away, lvl1 radius 90 -> in
    ];
    const route = hawksAlongRoute(from, to, hawks, { ...base, armor: 0 });
    expect(route.map((h) => h.playerId)).toEqual(['early', 'near']);
  });

  it('armour lowers the interception chance', () => {
    expect(interceptChance(2, 0)).toBeCloseTo(0.5);
    expect(interceptChance(2, 2)).toBeCloseTo(0.2);
    expect(interceptChance(1, 5)).toBe(0.05);
  });

  it('is deterministic per seed and reports where it was caught', () => {
    const hawks = [hawk('near', 500, 200, 3)];
    const opts = { ...base, loftLevel: 1, kind: 'standard' as const };
    const a = planPigeon(99, from, to, hawks, opts);
    expect(planPigeon(99, from, to, hawks, opts)).toEqual(a);
    expect(a.flightSeconds).toBe(100); // 800 units at 8/s
    let caught = 0;
    for (let seed = 0; seed < 2000; seed++) {
      const p = planPigeon(seed, from, to, hawks, opts);
      if (p.interceptedBy) {
        caught++;
        expect(p.interceptedBy).toBe('near');
        expect(p.interceptT).toBeCloseTo(0.5);
      }
    }
    expect(caught / 2000).toBeGreaterThan(0.58);
    expect(caught / 2000).toBeLessThan(0.72);
  });

  it('escorts force the hawk to win twice', () => {
    const hawks = [hawk('near', 500, 200, 3)];
    let std = 0;
    let esc = 0;
    for (let seed = 0; seed < 2000; seed++) {
      if (planPigeon(seed, from, to, hawks, { ...base, loftLevel: 1, kind: 'standard' }).interceptedBy) std++;
      if (planPigeon(seed, from, to, hawks, { ...base, loftLevel: 1, kind: 'escorted' }).interceptedBy) esc++;
    }
    expect(esc).toBeLessThan(std * 0.8);
    const route = hawksAlongRoute(from, to, hawks, { ...base, armor: 0 });
    expect(survivalChance(route, true)).toBeGreaterThan(survivalChance(route, false));
  });

  it('never intercepts a pigeon with no hawks en route', () => {
    for (let seed = 0; seed < 100; seed++) {
      expect(planPigeon(seed, from, to, [hawk('far', 500, 400)], { ...base, loftLevel: 1, kind: 'standard' }).interceptedBy).toBeNull();
    }
  });

  it('scrambles enciphered messages but keeps their shape', () => {
    const msg = 'Raid the Honkers at dawn!';
    const s = scrambleMessage(msg, 5);
    expect(s).toHaveLength(msg.length);
    expect(s).not.toBe(msg);
    expect(s.split(' ').map((w) => w.length)).toEqual(msg.split(' ').map((w) => w.length));
    expect(s.endsWith('!')).toBe(true);
  });
});
