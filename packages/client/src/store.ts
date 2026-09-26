import { tickNest } from '@nesthold/shared';
import type { NestState } from '@nesthold/shared';
import type { MeResponse, PublicPlayer } from './api';

type Fn = () => void;

/** Tiny global store for the signed-in player's nest. */
class Store {
  player!: PublicPlayer;
  nest!: NestState;
  shieldUntil = 0;
  private offset = 0;
  private subs = new Set<Fn>();

  /** Server clock estimate; all game timers are server-authoritative. */
  now(): number {
    return Date.now() + this.offset;
  }

  setMe(me: MeResponse): void {
    this.player = me.player;
    this.shieldUntil = me.shieldUntil;
    this.setNest(me.nest, me.serverTime);
  }

  setNest(nest: NestState, serverTime?: number): void {
    if (serverTime) this.offset = serverTime - Date.now();
    this.nest = nest;
    this.emit();
  }

  /** Advance local timers between server syncs so construction and hatching tick visibly. */
  tick(): void {
    if (!this.nest) return;
    const before = JSON.stringify([this.nest.trainingQueue.length, this.nest.buildings.map((b) => b.level)]);
    tickNest(this.nest, this.now());
    const after = JSON.stringify([this.nest.trainingQueue.length, this.nest.buildings.map((b) => b.level)]);
    if (before !== after) this.emit();
  }

  subscribe(fn: Fn): Fn {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  emit(): void {
    this.subs.forEach((fn) => fn());
  }
}

export const store = new Store();
