import Phaser from 'phaser';
import { TEXT_RES } from '../display';
import { WORLD_SIZE, hawkRadius } from '@nesthold/shared';
import type { Inbox, PublicPlayer } from '../api';
import { api } from '../api';
import { buildingKey } from '../art';
import { bus } from '../events';
import { CameraControls } from '../isoview';
import { store } from '../store';

const SCALE = 1.4;

/** Top-down map of every nest, the hawks that guard the skies, and pigeons in flight. */
export class WorldScene extends Phaser.Scene {
  players: PublicPlayer[] = [];
  private layer!: Phaser.GameObjects.Container;
  private routeGfx!: Phaser.GameObjects.Graphics;
  private pigeons: Array<{ img: Phaser.GameObjects.Image; from: PublicPlayer; to: PublicPlayer; sentAt: number; arriveAt: number }> = [];
  private offRoute: (() => void) | null = null;

  constructor() {
    super('world');
  }

  create(): void {
    bus.emit('mode', 'world');
    const size = WORLD_SIZE * SCALE;
    this.cameras.main.setBackgroundColor('#6cb865');
    const bg = this.add.graphics();
    const rng = new Phaser.Math.RandomDataGenerator(['nesthold']);
    bg.fillStyle(0x76c26f, 1).fillRect(0, 0, size, size);
    for (let i = 0; i < 26; i++) {
      const x = rng.between(0, size);
      const y = rng.between(0, size);
      const w = rng.between(60, 220);
      bg.fillStyle(0x3f8fb3, 1).fillEllipse(x, y, w, w * 0.55);
      bg.fillStyle(0x6cc0de, 1).fillEllipse(x - 6, y - 4, w * 0.75, w * 0.38);
    }
    for (let i = 0; i < 140; i++) bg.fillStyle(0x5aa653, 1).fillCircle(rng.between(0, size), rng.between(0, size), rng.between(4, 12));
    bg.lineStyle(6, 0x4e2f18, 0.8).strokeRect(0, 0, size, size);

    this.layer = this.add.container(0, 0);
    this.routeGfx = this.add.graphics().setDepth(50);

    const controls = new CameraControls(this, { onTap: (wx, wy) => this.tap(wx, wy) }, 0.35, 2.2);
    const cam = this.cameras.main;
    cam.setBounds(-200, -200, size + 400, size + 400);
    controls.zoomTo(Math.min(cam.width, cam.height) / 520);
    cam.centerOn(store.player.wx * SCALE, store.player.wy * SCALE);

    const onRoute = (toId: string | null) => this.drawRoute(toId);
    bus.on('world:route', onRoute);
    this.offRoute = () => bus.off('world:route', onRoute);
    this.events.once('shutdown', () => {
      this.offRoute?.();
      this.pigeons = [];
    });

    this.refresh();
    this.time.addEvent({ delay: 8000, loop: true, callback: () => this.refresh() });
  }

  async refresh(): Promise<void> {
    try {
      const [players, inbox] = await Promise.all([api.world(), api.inbox()]);
      if (!this.sys.isActive()) return;
      this.players = players;
      this.draw();
      this.drawPigeons(inbox);
    } catch {
      /* offline: keep the last map */
    }
  }

  private draw(): void {
    this.layer.removeAll(true);
    const me = this.players.find((p) => p.isMe);
    const myFlock = me?.flockId ?? null;
    // Rival hawk territory first so nests draw over it.
    for (const p of this.players) {
      if (p.hawkLevel < 1 || p.isMe || (myFlock && p.flockId === myFlock)) continue;
      const r = hawkRadius(p.hawkLevel) * SCALE;
      const c = this.add.circle(p.wx * SCALE, p.wy * SCALE, r, 0xd62828, 0.1).setStrokeStyle(2, 0xd62828, 0.5);
      this.layer.add(c);
      this.layer.add(this.add.text(p.wx * SCALE, p.wy * SCALE - r + 12, '🦅', { fontSize: '18px', resolution: TEXT_RES }).setOrigin(0.5));
    }
    for (const p of this.players) {
      const x = p.wx * SCALE;
      const y = p.wy * SCALE;
      const ring = p.isMe ? 0xffcf3f : myFlock && p.flockId === myFlock ? 0x4caf50 : 0xffffff;
      this.layer.add(this.add.ellipse(x, y + 4, 92, 46, 0x000000, 0.15));
      this.layer.add(this.add.ellipse(x, y, 88, 44, 0xd8c690, 1).setStrokeStyle(4, ring, 1));
      this.layer.add(this.add.image(x, y - 8, buildingKey('nestCore', p.coreLevel)).setScale(0.36));
      if (p.shielded) this.layer.add(this.add.circle(x, y - 10, 46, 0x7fd1e0, 0.25).setStrokeStyle(2, 0x7fd1e0, 0.9));
      const label = `${p.isMe ? '⭐ ' : ''}${p.name}${p.isBot ? ' 🤖' : ''}`;
      this.layer.add(
        this.add
          .text(x, y + 30, label, { fontFamily: 'Trebuchet MS', resolution: TEXT_RES, fontSize: '15px', fontStyle: 'bold', color: '#fff', stroke: '#3a2a1a', strokeThickness: 4 })
          .setOrigin(0.5, 0),
      );
      this.layer.add(
        this.add
          .text(x, y + 49, `🏆${p.trophies}  Lv${p.coreLevel}${p.flockName ? `  · ${p.flockName}` : ''}`, {
            fontFamily: 'Trebuchet MS', resolution: TEXT_RES,
            fontSize: '12px',
            color: '#fff',
            stroke: '#3a2a1a',
            strokeThickness: 3,
          })
          .setOrigin(0.5, 0),
      );
    }
  }

  private drawPigeons(inbox: Inbox): void {
    this.pigeons.forEach((p) => p.img.destroy());
    this.pigeons = [];
    const me = this.players.find((p) => p.isMe);
    if (!me) return;
    for (const s of inbox.sent) {
      if (s.status !== 'flying') continue;
      const to = this.players.find((p) => p.id === s.toId);
      if (!to) continue;
      const img = this.add.image(0, 0, 'pigeon').setDepth(60).setScale(1.2);
      if (to.wx < me.wx) img.setFlipX(true);
      this.pigeons.push({ img, from: me, to, sentAt: s.sentAt, arriveAt: s.arriveAt });
    }
  }

  override update(): void {
    const now = store.now();
    for (const p of this.pigeons) {
      const k = Phaser.Math.Clamp((now - p.sentAt) / (p.arriveAt - p.sentAt), 0, 1);
      p.img.setPosition((p.from.wx + (p.to.wx - p.from.wx) * k) * SCALE, (p.from.wy + (p.to.wy - p.from.wy) * k) * SCALE - 20 + Math.sin(now / 120) * 3);
      p.img.setVisible(k < 1);
    }
  }

  private drawRoute(toId: string | null): void {
    const g = this.routeGfx.clear();
    if (!toId) return;
    const me = this.players.find((p) => p.isMe);
    const to = this.players.find((p) => p.id === toId);
    if (!me || !to) return;
    const x0 = me.wx * SCALE;
    const y0 = me.wy * SCALE;
    const x1 = to.wx * SCALE;
    const y1 = to.wy * SCALE;
    const len = Math.hypot(x1 - x0, y1 - y0);
    g.lineStyle(4, 0xffffff, 0.9);
    for (let d = 0; d < len; d += 22) {
      const a = d / len;
      const b = Math.min(1, (d + 12) / len);
      g.lineBetween(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a, x0 + (x1 - x0) * b, y0 + (y1 - y0) * b);
    }
    this.cameras.main.pan((x0 + x1) / 2, (y0 + y1) / 2, 400, 'Sine.inOut');
  }

  private tap(wx: number, wy: number): void {
    let best: PublicPlayer | null = null;
    let bestD = 60;
    for (const p of this.players) {
      const d = Math.hypot(p.wx * SCALE - wx, p.wy * SCALE - wy);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best) bus.emit('world:select', best);
  }
}
