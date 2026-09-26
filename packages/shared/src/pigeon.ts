/**
 * Carrier pigeons: the only way flock-mates can message each other.
 * Pigeons fly in a straight line across the world map. Any rival nest with a Hawk Perch whose hunting
 * radius touches the flight path gets a (seeded) chance to snatch the pigeon and read the message.
 */
import { BUILDING_DEFS, atLevel } from './data/buildings';
import { Rng } from './rng';
import type { Resources } from './types';

export const WORLD_SIZE = 1000;
export type PigeonKind = 'standard' | 'escorted' | 'armored';

export const PIGEON_KINDS: Record<PigeonKind, { name: string; blurb: string; cost: Resources; extraArmor: number; escort: boolean }> = {
  standard: {
    name: 'Carrier Pigeon',
    blurb: 'Cheap and cheerful. Hawks love them.',
    cost: { grain: 20, feathers: 0, pebbles: 0 },
    extraArmor: 0,
    escort: false,
  },
  escorted: {
    name: 'Escorted Pigeon',
    blurb: 'Two burly pigeons fly wing. A hawk has to win twice to take the message.',
    cost: { grain: 20, feathers: 30, pebbles: 0 },
    extraArmor: 0,
    escort: true,
  },
  armored: {
    name: 'Armored Pigeon',
    blurb: 'Wears a tiny tin breastplate. Much harder to snatch.',
    cost: { grain: 20, feathers: 60, pebbles: 0 },
    extraArmor: 2,
    escort: false,
  },
};

export interface Point {
  x: number;
  y: number;
}

export interface HawkPost {
  playerId: string;
  flockId: string | null;
  x: number;
  y: number;
  level: number;
}

export interface RouteHawk extends HawkPost {
  /** 0..1 position along the route where the pigeon is closest to this hawk. */
  t: number;
  distance: number;
  chance: number;
}

export interface PigeonPlan {
  flightSeconds: number;
  hawks: RouteHawk[];
  interceptedBy: string | null;
  /** 0..1 along the route where it happened. */
  interceptT: number | null;
}

export function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Closest approach of segment a->b to point p; returns the param t (0..1) and the distance. */
export function closestOnSegment(a: Point, b: Point, p: Point): { t: number; distance: number } {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { t, distance: distance({ x: a.x + vx * t, y: a.y + vy * t }, p) };
}

export function pigeonSpeed(loftLevel: number): number {
  return atLevel(BUILDING_DEFS.pigeonLoft.loft!.speed, Math.max(1, loftLevel));
}

export function loftArmor(loftLevel: number): number {
  return loftLevel < 1 ? 0 : atLevel(BUILDING_DEFS.pigeonLoft.loft!.armor, loftLevel);
}

export function loftHasCipher(loftLevel: number): boolean {
  return loftLevel >= 1 && atLevel(BUILDING_DEFS.pigeonLoft.loft!.cipher, loftLevel);
}

export function hawkRadius(level: number): number {
  return atLevel(BUILDING_DEFS.hawkPerch.hawk!.radius, level);
}

/** Chance one hawk snatches one pigeon. Every point of armour knocks 15% off. */
export function interceptChance(hawkLevel: number, armor: number): number {
  const power = atLevel(BUILDING_DEFS.hawkPerch.hawk!.power, hawkLevel);
  return Math.max(0.05, Math.min(0.9, power - armor * 0.15));
}

/** Hawks that can reach the route, excluding the sender's flock and the two endpoints. Sorted along the route. */
export function hawksAlongRoute(
  from: Point,
  to: Point,
  hawks: readonly HawkPost[],
  opts: { senderId: string; recipientId: string; senderFlockId: string | null; armor: number },
): RouteHawk[] {
  const out: RouteHawk[] = [];
  for (const h of hawks) {
    if (h.level < 1 || h.playerId === opts.senderId || h.playerId === opts.recipientId) continue;
    if (opts.senderFlockId && h.flockId === opts.senderFlockId) continue;
    const c = closestOnSegment(from, to, h);
    if (c.distance <= hawkRadius(h.level)) out.push({ ...h, t: c.t, distance: c.distance, chance: interceptChance(h.level, opts.armor) });
  }
  return out.sort((a, b) => a.t - b.t || (a.playerId < b.playerId ? -1 : 1));
}

/** Probability the pigeon survives the whole route (for the "risk" preview). */
export function survivalChance(hawks: readonly RouteHawk[], escorted: boolean): number {
  return hawks.reduce((p, h) => p * (1 - (escorted ? h.chance * h.chance : h.chance)), 1);
}

export function planPigeon(
  seed: number,
  from: Point,
  to: Point,
  hawks: readonly HawkPost[],
  opts: { senderId: string; recipientId: string; senderFlockId: string | null; loftLevel: number; kind: PigeonKind },
): PigeonPlan {
  const kind = PIGEON_KINDS[opts.kind];
  const armor = loftArmor(opts.loftLevel) + kind.extraArmor;
  const route = hawksAlongRoute(from, to, hawks, { ...opts, armor });
  const rng = new Rng(seed);
  let interceptedBy: string | null = null;
  let interceptT: number | null = null;
  for (const h of route) {
    let caught = rng.next() < h.chance;
    // The escort gets a second roll: the hawk must win both.
    if (caught && kind.escort) caught = rng.next() < h.chance;
    if (caught) {
      interceptedBy = h.playerId;
      interceptT = h.t;
      break;
    }
  }
  return {
    flightSeconds: Math.max(3, distance(from, to) / pigeonSpeed(opts.loftLevel)),
    hawks: route,
    interceptedBy,
    interceptT,
  };
}

const CIPHER_ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

/** What a hawk-owner can read of an enciphered message: most letters scrambled, spaces and punctuation kept. */
export function scrambleMessage(text: string, seed: number): string {
  const rng = new Rng(seed);
  let out = '';
  for (const ch of text) {
    const lower = ch.toLowerCase();
    if (!CIPHER_ALPHABET.includes(lower)) {
      out += ch;
      continue;
    }
    if (rng.next() < 0.25) {
      out += ch;
      continue;
    }
    const sub = CIPHER_ALPHABET[Math.floor(rng.next() * 26)];
    out += ch === lower ? sub : sub.toUpperCase();
  }
  return out;
}
