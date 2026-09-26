import Phaser from 'phaser';
import { TEXT_RES } from '../display';
import {
  BUILDING_DEFS,
  COMBAT_DUCKS,
  GRID_SIZE,
  atLevel,
  canPlace,
  pendingProduction,
} from '@nesthold/shared';
import type { BuildingKind, CombatDuckKind, PlacedBuilding } from '@nesthold/shared';
import { api } from '../api';
import { DUCK_SCALE, buildingOriginY, duckKey } from '../art';
import { bus } from '../events';
import { CameraControls, depthAt, drawGround, placeBuildingSprite, tileAt, worldOf } from '../isoview';
import { store } from '../store';
import { attempt, duration, fmt, toast } from '../ui/dom';

interface View {
  img: Phaser.GameObjects.Image;
  scaffold?: Phaser.GameObjects.Image;
  timer?: Phaser.GameObjects.Text;
  bubble?: Phaser.GameObjects.Container;
  key: string;
}

interface Placement {
  kind: BuildingKind;
  moveId: string | null;
  x: number;
  y: number;
  ghost: Phaser.GameObjects.Image;
  tiles: Phaser.GameObjects.Image[];
}

export class NestScene extends Phaser.Scene {
  private views = new Map<string, View>();
  private controls!: CameraControls;
  private placement: Placement | null = null;
  private critters: Phaser.GameObjects.Image[] = [];
  private critterSig = '';
  private unsub: Array<() => void> = [];
  private alive = false;

  constructor() {
    super('nest');
  }

  create(): void {
    this.alive = true;
    drawGround(this);
    this.controls = new CameraControls(this, {
      onTap: (wx, wy) => this.handleTap(wx, wy),
      onDragStart: (wx, wy) => this.grabGhost(wx, wy),
      onDrag: (wx, wy) => this.dragGhost(wx, wy),
    });
    this.controls.fit();
    this.controls.centerOnGrid(GRID_SIZE / 2 + 1, GRID_SIZE / 2 + 1);

    this.sync();
    this.unsub.push(store.subscribe(() => this.sync()));
    const onPlace = (kind: BuildingKind) => this.startPlacement(kind, null);
    const onMove = (id: string) => {
      const b = store.nest.buildings.find((x) => x.id === id);
      if (b) this.startPlacement(b.kind, b);
    };
    const onConfirm = () => this.confirmPlacement();
    const onCancel = () => this.endPlacement();
    bus.on('place', onPlace);
    bus.on('move', onMove);
    bus.on('placement:confirm', onConfirm);
    bus.on('placement:cancel', onCancel);
    this.unsub.push(() => {
      bus.off('place', onPlace);
      bus.off('move', onMove);
      bus.off('placement:confirm', onConfirm);
      bus.off('placement:cancel', onCancel);
    });
    this.time.addEvent({ delay: 500, loop: true, callback: () => this.refreshOverlays() });
    this.events.once('shutdown', () => {
      this.alive = false;
      this.unsub.forEach((fn) => fn());
      this.unsub = [];
      this.views.clear();
      this.critters = [];
      this.critterSig = '';
      this.placement = null;
    });
    bus.emit('mode', 'nest');
  }

  // ------------------------------------------------------------ rendering

  private sync(): void {
    if (!this.alive) return;
    const seen = new Set<string>();
    for (const b of store.nest.buildings) {
      seen.add(b.id);
      const level = b.level || b.upgradingTo || 1;
      const key = `${b.kind}:${level}:${b.x}:${b.y}:${b.upgradingTo ?? ''}`;
      let v = this.views.get(b.id);
      if (v && v.key === key) continue;
      const img = placeBuildingSprite(this, b.kind, level, b.x, b.y, v?.img);
      img.setAlpha(b.level === 0 ? 0.55 : 1);
      if (!v) v = { img, key };
      v.key = key;
      v.scaffold?.destroy();
      v.scaffold = undefined;
      if (b.upgradingTo != null) {
        const size = BUILDING_DEFS[b.kind].size;
        const sk = `scaffold_${size}`;
        const p = worldOf(b.x, b.y);
        v.scaffold = this.add.image(p.x, p.y, sk).setOrigin(0.5, buildingOriginY(sk)).setDepth(img.depth + 1);
      }
      this.views.set(b.id, v);
    }
    for (const [id, v] of this.views) {
      if (seen.has(id)) continue;
      v.img.destroy();
      v.scaffold?.destroy();
      v.timer?.destroy();
      v.bubble?.destroy();
      this.views.delete(id);
    }
    this.refreshOverlays();
    this.syncCritters();
  }

  private refreshOverlays(): void {
    if (!this.alive) return;
    store.tick();
    const now = store.now();
    for (const b of store.nest.buildings) {
      const v = this.views.get(b.id);
      if (!v) continue;
      const size = BUILDING_DEFS[b.kind].size;
      const top = worldOf(b.x + size / 2, b.y + size / 2);
      // Construction countdown
      if (b.upgradingTo != null && b.upgradeEndsAt) {
        const label = `🔨 ${duration((b.upgradeEndsAt - now) / 1000)}`;
        if (!v.timer) {
          v.timer = this.add
            .text(top.x, top.y - 40 - size * 8, label, { fontFamily: 'Trebuchet MS', resolution: TEXT_RES, fontSize: '14px', color: '#fff', backgroundColor: '#4e2f18cc', padding: { x: 6, y: 3 } })
            .setOrigin(0.5)
            .setDepth(100000);
        } else v.timer.setText(label);
      } else if (v.timer) {
        v.timer.destroy();
        v.timer = undefined;
      }
      // Collect bubble
      const p = BUILDING_DEFS[b.kind].producer;
      const pending = p ? pendingProduction(store.nest, b, now) : 0;
      const show = p && b.level >= 1 && pending >= Math.max(10, atLevel(p.capacity, b.level) * 0.05);
      if (show && !v.bubble) {
        const bg = this.add.circle(0, 0, 17, 0xffffff, 0.95).setStrokeStyle(3, 0x4e2f18);
        const ico = this.add.text(0, 0, p!.resource === 'grain' ? '🌾' : '🪶', { fontSize: '18px', resolution: TEXT_RES }).setOrigin(0.5);
        v.bubble = this.add.container(top.x, top.y - 46, [bg, ico]).setDepth(100001);
        this.tweens.add({ targets: v.bubble, y: top.y - 52, yoyo: true, repeat: -1, duration: 700, ease: 'Sine.inOut' });
      } else if (!show && v.bubble) {
        v.bubble.destroy();
        v.bubble = undefined;
      }
    }
  }

  /** Ducks milling about: the army near the hatchery, farmers in the fields, builders at work. */
  private syncCritters(): void {
    const nest = store.nest;
    const sig = JSON.stringify([nest.army, nest.economyDucks, nest.buildings.map((b) => [b.id, b.x, b.y, b.upgradingTo])]);
    if (sig === this.critterSig) return;
    this.critterSig = sig;
    this.critters.forEach((c) => c.destroy());
    this.critters = [];
    const spawn = (kind: string, gx: number, gy: number, wander: number) => {
      const p = worldOf(gx, gy);
      const img = this.add.image(p.x, p.y, duckKey(kind as CombatDuckKind)).setOrigin(0.5, 0.9).setScale(DUCK_SCALE * 1.2).setDepth(depthAt(gx, gy));
      this.critters.push(img);
      const hop = () => {
        if (!img.active) return;
        const nx = gx + Phaser.Math.FloatBetween(-wander, wander);
        const ny = gy + Phaser.Math.FloatBetween(-wander, wander);
        const q = worldOf(nx, ny);
        img.setFlipX(q.x < img.x);
        this.tweens.add({
          targets: img,
          x: q.x,
          y: q.y,
          duration: Phaser.Math.Between(900, 1800),
          ease: 'Sine.inOut',
          onUpdate: () => img.setDepth(depthAt(nx, ny)),
          onComplete: () => this.time.delayedCall(Phaser.Math.Between(400, 2500), hop),
        });
      };
      this.time.delayedCall(Phaser.Math.Between(0, 1500), hop);
    };
    const hatch = nest.buildings.find((b) => b.kind === 'hatchery' && b.level >= 1);
    if (hatch) {
      let n = 0;
      for (const k of COMBAT_DUCKS) for (let i = 0; i < Math.min(nest.army[k] ?? 0, 4) && n < 14; i++, n++) spawn(k, hatch.x + 1.5 + ((n % 4) - 1.5), hatch.y + 3.6 + Math.floor(n / 4) * 0.6, 0.6);
    }
    nest.buildings
      .filter((b) => b.kind === 'grainField' && b.level >= 1)
      .slice(0, nest.economyDucks.farmer)
      .forEach((b) => spawn('farmer', b.x + 1.5, b.y + 1.5, 0.9));
    nest.buildings
      .filter((b) => b.kind === 'featherLoom' && b.level >= 1)
      .slice(0, nest.economyDucks.molter)
      .forEach((b) => spawn('molter', b.x + 3.3, b.y + 1.5, 0.4));
    const sites = nest.buildings.filter((b) => b.upgradingTo != null);
    for (let i = 0; i < nest.economyDucks.builder; i++) {
      const site = sites[i];
      if (site) spawn('builder', site.x + BUILDING_DEFS[site.kind].size + 0.4, site.y + BUILDING_DEFS[site.kind].size / 2, 0.3);
      else spawn('builder', 20.5 + i, 15.2, 0.5);
    }
  }

  // ------------------------------------------------------------ input

  private handleTap(wx: number, wy: number): void {
    if (this.placement) {
      const t = tileAt(wx, wy);
      const size = BUILDING_DEFS[this.placement.kind].size;
      this.moveGhost(t.x - Math.floor(size / 2), t.y - Math.floor(size / 2));
      return;
    }
    // Bubbles first: they float above buildings.
    for (const b of store.nest.buildings) {
      const v = this.views.get(b.id);
      if (v?.bubble && Phaser.Math.Distance.Between(wx, wy, v.bubble.x, v.bubble.y) < 26) {
        this.collect(b);
        return;
      }
    }
    const t = tileAt(wx, wy);
    const hit = this.buildingAt(t.x, t.y);
    if (!hit) return;
    const v = this.views.get(hit.id);
    if (v?.bubble) {
      this.collect(hit);
      return;
    }
    if (v) this.tweens.add({ targets: v.img, scaleX: 1.06, scaleY: 1.06, yoyo: true, duration: 90 });
    bus.emit('select', hit.id);
  }

  private buildingAt(x: number, y: number): PlacedBuilding | null {
    // Later buildings draw on top, so search back to front.
    for (let i = store.nest.buildings.length - 1; i >= 0; i--) {
      const b = store.nest.buildings[i];
      const s = BUILDING_DEFS[b.kind].size;
      if (x >= b.x && y >= b.y && x < b.x + s && y < b.y + s) return b;
    }
    return null;
  }

  private async collect(b: PlacedBuilding): Promise<void> {
    const res = await attempt(() => api.action({ type: 'collect', id: b.id }));
    if (!res) return;
    const amount = res.gained as number;
    const p = BUILDING_DEFS[b.kind].producer!;
    const v = this.views.get(b.id);
    if (v?.bubble) {
      const txt = this.add
        .text(v.bubble.x, v.bubble.y, `+${fmt(amount)}`, { fontFamily: 'Trebuchet MS', resolution: TEXT_RES, fontSize: '18px', color: '#fff', stroke: '#4e2f18', strokeThickness: 4 })
        .setOrigin(0.5)
        .setDepth(100002);
      this.tweens.add({ targets: txt, y: txt.y - 40, alpha: 0, duration: 900, onComplete: () => txt.destroy() });
    }
    if (amount === 0) toast(`Your ${p.resource} storage is full`, true);
    store.setNest(res.nest, res.serverTime);
  }

  // ------------------------------------------------------------ placement

  private startPlacement(kind: BuildingKind, moving: PlacedBuilding | null): void {
    this.endPlacement();
    const size = BUILDING_DEFS[kind].size;
    let x: number;
    let y: number;
    if (moving) {
      x = moving.x;
      y = moving.y;
      this.views.get(moving.id)?.img.setAlpha(0.25);
    } else {
      // Start at the screen centre, nudged to the nearest free spot if possible.
      const cam = this.cameras.main;
      const c = tileAt(cam.midPoint.x, cam.midPoint.y);
      x = c.x - Math.floor(size / 2);
      y = c.y - Math.floor(size / 2);
      search: for (let r = 0; r < 12; r++)
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++)
            if (canPlace(store.nest.buildings, kind, x + dx, y + dy)) {
              x += dx;
              y += dy;
              break search;
            }
    }
    const tiles: Phaser.GameObjects.Image[] = [];
    for (let i = 0; i < size * size; i++) tiles.push(this.add.image(0, 0, 'tile_ok').setOrigin(0.5, 0).setDepth(99990));
    const ghost = placeBuildingSprite(this, kind, moving?.level || 1, x, y).setAlpha(0.8);
    ghost.setDepth(99995);
    this.placement = { kind, moveId: moving?.id ?? null, x, y, ghost, tiles };
    this.moveGhost(x, y);
  }

  private moveGhost(x: number, y: number): void {
    const pl = this.placement;
    if (!pl) return;
    const size = BUILDING_DEFS[pl.kind].size;
    pl.x = Phaser.Math.Clamp(x, 0, GRID_SIZE - size);
    pl.y = Phaser.Math.Clamp(y, 0, GRID_SIZE - size);
    placeBuildingSprite(this, pl.kind, 1, pl.x, pl.y, pl.ghost).setDepth(99995);
    const ok = canPlace(store.nest.buildings, pl.kind, pl.x, pl.y, pl.moveId ?? undefined);
    pl.tiles.forEach((t, i) => {
      const p = worldOf(pl.x + (i % size), pl.y + Math.floor(i / size));
      t.setPosition(p.x, p.y).setTexture(ok ? 'tile_ok' : 'tile_bad');
    });
    bus.emit('placement', true, ok);
  }

  private grabGhost(wx: number, wy: number): boolean {
    const pl = this.placement;
    if (!pl) return false;
    const t = tileAt(wx, wy);
    const size = BUILDING_DEFS[pl.kind].size;
    return t.x >= pl.x - 1 && t.y >= pl.y - 1 && t.x <= pl.x + size && t.y <= pl.y + size;
  }

  private dragGhost(wx: number, wy: number): void {
    const pl = this.placement;
    if (!pl) return;
    const t = tileAt(wx, wy);
    const size = BUILDING_DEFS[pl.kind].size;
    const nx = t.x - Math.floor(size / 2);
    const ny = t.y - Math.floor(size / 2);
    if (nx !== pl.x || ny !== pl.y) this.moveGhost(nx, ny);
  }

  private async confirmPlacement(): Promise<void> {
    const pl = this.placement;
    if (!pl) return;
    const action = pl.moveId ? { type: 'move' as const, id: pl.moveId, x: pl.x, y: pl.y } : { type: 'place' as const, kind: pl.kind, x: pl.x, y: pl.y };
    const res = await attempt(() => api.action(action));
    if (!res) return;
    const wasMove = !!pl.moveId;
    this.endPlacement();
    store.setNest(res.nest, res.serverTime);
    if (!wasMove) toast(`${BUILDING_DEFS[pl.kind].name} placed!`);
  }

  private endPlacement(): void {
    const pl = this.placement;
    if (!pl) return;
    pl.ghost.destroy();
    pl.tiles.forEach((t) => t.destroy());
    if (pl.moveId) this.views.get(pl.moveId)?.img.setAlpha(1);
    this.placement = null;
    bus.emit('placement', false, false);
  }
}
