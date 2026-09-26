import Phaser from 'phaser';
import { BUILDING_DEFS, GRID_SIZE, TILE_H, gridToScreen, screenToGrid } from '@nesthold/shared';
import type { BuildingKind } from '@nesthold/shared';
import { buildingKey, buildingOriginY } from './art';
import { DPR } from './display';
import { sheetOpen } from './ui/dom';

/** World-space position of grid coords (fractional OK). */
export function worldOf(x: number, y: number): { x: number; y: number } {
  const p = gridToScreen(x, y);
  return { x: p.sx, y: p.sy };
}

export function tileAt(worldX: number, worldY: number): { x: number; y: number } {
  const g = screenToGrid(worldX, worldY);
  return { x: Math.floor(g.x), y: Math.floor(g.y) };
}

/** Depth for anything standing at grid (x, y). Buildings use their centre. */
export function depthAt(x: number, y: number): number {
  return (x + y) * 10;
}

export function drawGround(scene: Phaser.Scene): Phaser.GameObjects.Container {
  const c = scene.add.container(0, 0).setDepth(-10000);
  // A skirt of darker grass beyond the playable grid.
  for (let y = -3; y < GRID_SIZE + 3; y++) {
    for (let x = -3; x < GRID_SIZE + 3; x++) {
      const inside = x >= 0 && y >= 0 && x < GRID_SIZE && y < GRID_SIZE;
      const p = worldOf(x, y);
      const key = inside ? `tile_${(x * 7 + y * 13) % 3}` : 'tile_edge';
      c.add(scene.add.image(p.x, p.y, key).setOrigin(0.5, 0));
    }
  }
  // Decorative pond and reeds outside the grid.
  const g = scene.add.graphics();
  const pond = worldOf(GRID_SIZE + 1.5, GRID_SIZE / 2);
  g.fillStyle(0x4aa3c7, 1).fillEllipse(pond.x, pond.y, 150, 70);
  g.fillStyle(0x7fc8e0, 1).fillEllipse(pond.x - 10, pond.y - 6, 100, 40);
  c.add(g);
  return c;
}

export function placeBuildingSprite(
  scene: Phaser.Scene,
  kind: BuildingKind,
  level: number,
  x: number,
  y: number,
  existing?: Phaser.GameObjects.Image,
): Phaser.GameObjects.Image {
  const key = buildingKey(kind, level);
  const p = worldOf(x, y);
  const size = BUILDING_DEFS[kind].size;
  const img = existing ?? scene.add.image(0, 0, key);
  img.setTexture(key);
  img.setOrigin(0.5, buildingOriginY(key));
  img.setPosition(p.x, p.y);
  img.setDepth(depthAt(x + size / 2, y + size / 2) + (kind === 'turtlePit' || kind === 'feedScatterer' ? -5 : 0));
  return img;
}

export interface ControlsHandlers {
  onTap?: (worldX: number, worldY: number, pointer: Phaser.Input.Pointer) => void;
  /** Return true to take over this drag (e.g. to move a ghost building instead of panning). */
  onDragStart?: (worldX: number, worldY: number) => boolean;
  onDrag?: (worldX: number, worldY: number) => void;
  onDragEnd?: () => void;
}

/** One-finger pan, two-finger pinch zoom, mouse-wheel zoom, and tap detection. */
export class CameraControls {
  private startX = 0;
  private startY = 0;
  private moved = false;
  private pinchDist = 0;
  private pinchZoom = 1;
  private pinching = false;
  private captured = false;
  private downOnCanvas = false;

  constructor(
    private scene: Phaser.Scene,
    private handlers: ControlsHandlers,
    private minZoom = 0.35,
    private maxZoom = 2,
  ) {
    this.minZoom *= DPR;
    this.maxZoom *= DPR;
    const input = scene.input;
    input.addPointer(1);
    const cam = scene.cameras.main;
    const halfW = (GRID_SIZE * 64) / 2 + 200;
    cam.setBounds(-halfW, -300, halfW * 2, GRID_SIZE * TILE_H + 600);

    input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (sheetOpen()) return;
      this.downOnCanvas = true;
      const pts = this.activePointers();
      if (pts.length >= 2) {
        this.pinching = true;
        this.pinchDist = Phaser.Math.Distance.Between(pts[0].x, pts[0].y, pts[1].x, pts[1].y);
        this.pinchZoom = cam.zoom;
        return;
      }
      this.startX = p.x;
      this.startY = p.y;
      this.moved = false;
      this.captured = false;
    });

    input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!p.isDown || !this.downOnCanvas) return;
      const pts = this.activePointers();
      if (this.pinching && pts.length >= 2) {
        const d = Phaser.Math.Distance.Between(pts[0].x, pts[0].y, pts[1].x, pts[1].y);
        this.zoomTo((this.pinchZoom * d) / Math.max(1, this.pinchDist));
        return;
      }
      if (this.pinching) return;
      if (!this.moved && Math.hypot(p.x - this.startX, p.y - this.startY) > 8) {
        this.moved = true;
        const w = cam.getWorldPoint(this.startX, this.startY);
        this.captured = !!this.handlers.onDragStart?.(w.x, w.y);
      }
      if (!this.moved) return;
      if (this.captured) {
        const w = cam.getWorldPoint(p.x, p.y);
        this.handlers.onDrag?.(w.x, w.y);
      } else {
        cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
        cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
      }
    });

    input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (!this.downOnCanvas) return;
      if (this.pinching) {
        if (this.activePointers().length === 0) this.pinching = false;
        this.downOnCanvas = this.activePointers().length > 0;
        return;
      }
      this.downOnCanvas = false;
      if (this.captured) this.handlers.onDragEnd?.();
      else if (!this.moved) {
        const w = cam.getWorldPoint(p.x, p.y);
        this.handlers.onTap?.(w.x, w.y, p);
      }
      this.captured = false;
    });

    input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.zoomTo(cam.zoom * (dy > 0 ? 0.9 : 1.1));
    });
  }

  private activePointers(): Phaser.Input.Pointer[] {
    return this.scene.input.manager.pointers.filter((p) => p.isDown);
  }

  zoomTo(z: number): void {
    this.scene.cameras.main.setZoom(Phaser.Math.Clamp(z, this.minZoom, this.maxZoom));
  }

  centerOnGrid(x: number, y: number): void {
    const p = worldOf(x, y);
    this.scene.cameras.main.centerOn(p.x, p.y);
  }

  /** Zoom so roughly `tiles` tiles span the screen width (in CSS pixels). */
  fit(tiles = 13): void {
    const cam = this.scene.cameras.main;
    this.zoomTo(cam.width / (tiles * 64));
  }
}
