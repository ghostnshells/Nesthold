import Phaser from 'phaser';
import { Capacitor } from '@capacitor/core';
import { StatusBar } from '@capacitor/status-bar';
import { gridToScreen } from '@nesthold/shared';
import { api } from './api';
import { DPR } from './display';
import { bus } from './events';
import { goto, setGame } from './nav';
import { BattleScene } from './scenes/BattleScene';
import { BootScene } from './scenes/BootScene';
import { NestScene } from './scenes/NestScene';
import { WorldScene } from './scenes/WorldScene';
import { store } from './store';
import { closeSheet, h, root, toast } from './ui/dom';
import { bumpUnread } from './ui/flock';
import { mountHud } from './ui/hud';
import { openBuilding, openTarget } from './ui/panels';
import type { PublicPlayer } from './api';

const loading = h('div', { class: 'loading' }, h('div', null, h('div', { class: 'logo' }, '🦆 Nesthold'), h('div', null, 'Waddling to the pond…')));
root().append(loading);

if (Capacitor.isNativePlatform()) StatusBar.hide().catch(() => {});

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#5e9e5a',
  scale: { mode: Phaser.Scale.NONE, width: window.innerWidth * DPR, height: window.innerHeight * DPR, zoom: 1 / DPR },
  render: { antialias: true, roundPixels: false },
  input: { activePointers: 3 },
  scene: [BootScene, NestScene, WorldScene, BattleScene],
});
setGame(game);
window.addEventListener('resize', () => game.scale.resize(window.innerWidth * DPR, window.innerHeight * DPR));
// Test hook for the end-to-end smoke test.
(window as unknown as { __nesthold: object }).__nesthold = {
  bus,
  store,
  goto,
  game,
  /** CSS-pixel position of a grid tile's centre in the active scene. */
  gridToClient(x: number, y: number) {
    const cam = game.scene.getScenes(true)[0].cameras.main;
    const p = gridToScreen(x + 0.5, y + 0.5);
    return { x: ((p.sx - cam.worldView.x) * cam.zoom) / DPR, y: ((p.sy - cam.worldView.y) * cam.zoom) / DPR };
  },
};

async function start(): Promise<void> {
  try {
    const me = await api.init();
    store.setMe(me);
  } catch (err) {
    loading.replaceChildren(
      h(
        'div',
        null,
        h('div', { class: 'logo' }, '🦆💤'),
        h('div', null, "Can't reach the nest server."),
        h('div', { style: 'font-size:14px;font-weight:600;margin:8px 0 16px' }, err instanceof Error ? err.message : ''),
        h('button', { class: 'btn', onClick: () => location.reload() }, 'Try again'),
      ),
    );
    return;
  }
  loading.remove();
  mountHud();
  goto('nest');

  bus.on('select', (id: string) => openBuilding(id));
  bus.on('world:select', (p: PublicPlayer) => openTarget(p));

  api.on((msg) => {
    switch (msg.type) {
      case 'attacked':
        toast(`⚔️ ${msg.attacker} raided your nest! ${'⭐'.repeat(msg.stars as number) || 'No stars'}`, true);
        refresh();
        break;
      case 'pigeon':
        toast('🕊 A pigeon landed at your loft!');
        bumpUnread();
        break;
      case 'intercepted':
        toast('🦅 Your hawk snatched a rival pigeon!');
        bumpUnread();
        break;
      case 'pigeonLost':
        toast('🪶 One of your pigeons never arrived…', true);
        bumpUnread();
        break;
      case 'donation':
        toast(`🎁 ${msg.from} sent you ${msg.count} ${msg.kind}`);
        refresh();
        break;
      case 'raidOpened':
        toast(`📯 ${msg.leader} is rallying a raid on ${msg.target}! Open Flock → Raids to pledge.`);
        break;
      case 'raidResult':
        toast(`🦆 Flock raid over: ${'⭐'.repeat(msg.stars as number) || 'no stars'}`);
        refresh();
        break;
      case 'flockJoined':
        toast(`👋 ${msg.name} joined your flock`);
        break;
    }
  });
  setInterval(refresh, 20_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
}

async function refresh(): Promise<void> {
  try {
    store.setMe(await api.me());
  } catch {
    /* offline for a moment */
  }
}

game.events.once('art-ready', () => {
  closeSheet();
  start();
});
