import Phaser from 'phaser';

/**
 * App-wide event bus between Phaser scenes and DOM UI.
 * - 'place' (kind) / 'move' (id): start placement mode in the nest
 * - 'placement' (active: boolean, valid: boolean): placement state for the HUD
 * - 'placement:confirm' / 'placement:cancel'
 * - 'select' (buildingId): a building was tapped
 * - 'mode' ('nest' | 'world' | 'battle'): the active scene changed
 * - 'world:select' (playerId): a nest was tapped on the world map
 */
export const bus = new Phaser.Events.EventEmitter();
