import Phaser from 'phaser';
import { generateArt } from '../art';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create(): void {
    generateArt(this);
    this.game.events.emit('art-ready');
  }
}
