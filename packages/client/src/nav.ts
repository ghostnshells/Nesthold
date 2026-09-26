import type Phaser from 'phaser';
import type { BattleData } from './scenes/BattleScene';

let game: Phaser.Game | null = null;

export function setGame(g: Phaser.Game): void {
  game = g;
}

/** Switch to another top-level scene (only one runs at a time). */
export function goto(key: 'nest' | 'world'): void;
export function goto(key: 'battle', data: BattleData): void;
export function goto(key: string, data?: object): void {
  if (!game) return;
  const active = game.scene.getScenes(true)[0];
  if (active) active.scene.start(key, data);
  else game.scene.start(key, data);
}

export function activeSceneKey(): string | null {
  return game?.scene.getScenes(true)[0]?.scene.key ?? null;
}
