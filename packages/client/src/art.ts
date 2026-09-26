/**
 * All game art is generated procedurally at boot (no image assets): isometric blocks for buildings,
 * little ducks for every kind, and a handful of effect sprites.
 */
import Phaser from 'phaser';
import { BUILDING_DEFS, BUILDING_KINDS, DUCK_DEFS, TILE_H, TILE_W } from '@nesthold/shared';
import type { BuildingKind, DuckKind } from '@nesthold/shared';

type G = Phaser.GameObjects.Graphics;
type P = { x: number; y: number };

/** Vertical origin (0..1) per building texture so the footprint's top corner lands on the anchor point. */
const origins = new Map<string, number>();
const iconCache = new Map<string, string>();
let textures: Phaser.Textures.TextureManager | null = null;

export function buildingKey(kind: BuildingKind, level: number): string {
  return `bld_${kind}_${Math.max(1, Math.min(3, level))}`;
}

export function buildingOriginY(key: string): number {
  return origins.get(key) ?? 0.5;
}

/** Base sprite scale for the 2x duck textures. */
export const DUCK_SCALE = 0.5;

export function duckKey(kind: DuckKind): string {
  return `duck_${kind}`;
}

/** Data URL of a generated texture, for use in DOM panels. */
export function iconUrl(key: string): string {
  let url = iconCache.get(key);
  if (!url && textures) {
    url = textures.getBase64(key) as string;
    iconCache.set(key, url);
  }
  return url ?? '';
}

export function shade(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * f));
  const b = Math.min(255, Math.round((color & 255) * f));
  return (r << 16) | (g << 8) | b;
}

function poly(g: G, color: number, pts: P[], alpha = 1): void {
  g.fillStyle(color, alpha);
  g.fillPoints(pts as Phaser.Types.Math.Vector2Like[], true);
}

/** Isometric footprint helper centred at (cx, cy) with half-width hw and half-height hh. */
class Iso {
  constructor(
    readonly cx: number,
    readonly cy: number,
    readonly hw: number,
    readonly hh: number,
  ) {}

  top(s: number, lift = 0): P {
    return { x: this.cx, y: this.cy - this.hh * s - lift };
  }
  right(s: number, lift = 0): P {
    return { x: this.cx + this.hw * s, y: this.cy - lift };
  }
  bottom(s: number, lift = 0): P {
    return { x: this.cx, y: this.cy + this.hh * s - lift };
  }
  left(s: number, lift = 0): P {
    return { x: this.cx - this.hw * s, y: this.cy - lift };
  }
  diamond(s: number, lift = 0): P[] {
    return [this.top(s, lift), this.right(s, lift), this.bottom(s, lift), this.left(s, lift)];
  }

  block(g: G, s: number, h: number, top: number, side: number, base = 0): void {
    poly(g, shade(side, 1), [this.left(s, base), this.bottom(s, base), this.bottom(s, base + h), this.left(s, base + h)]);
    poly(g, shade(side, 0.78), [this.bottom(s, base), this.right(s, base), this.right(s, base + h), this.bottom(s, base + h)]);
    poly(g, top, this.diamond(s, base + h));
  }

  /** Stripe around the block at height `at` (level trim). */
  band(g: G, s: number, at: number, thick: number, color: number): void {
    poly(g, color, [this.left(s, at), this.bottom(s, at), this.bottom(s, at + thick), this.left(s, at + thick)]);
    poly(g, shade(color, 0.8), [this.bottom(s, at), this.right(s, at), this.right(s, at + thick), this.bottom(s, at + thick)]);
  }

  pyramid(g: G, s: number, base: number, height: number, color: number): void {
    const apex = { x: this.cx, y: this.cy - base - height };
    poly(g, shade(color, 1.05), [this.left(s, base), this.bottom(s, base), apex]);
    poly(g, shade(color, 0.8), [this.bottom(s, base), this.right(s, base), apex]);
    poly(g, shade(color, 1.2), [this.left(s, base), this.top(s, base), apex]);
    poly(g, shade(color, 0.95), [this.top(s, base), this.right(s, base), apex]);
  }
}

// ------------------------------------------------------------------ buildings

const HEADROOM: Record<BuildingKind, number> = {
  nestCore: 84,
  grainField: 26,
  featherLoom: 62,
  granary: 84,
  hatchery: 86,
  reedWall: 34,
  pigeonLoft: 88,
  hawkPerch: 84,
  catapult: 78,
  birdshot: 50,
  heron: 96,
  turtlePit: 14,
  feedScatterer: 30,
  matingHorn: 46,
};

function drawBuilding(g: G, kind: BuildingKind, level: number, iso: Iso): void {
  const def = BUILDING_DEFS[kind];
  const c = def.colors;
  const hm = 1 + (level - 1) * 0.14;
  const trim = level === 3 ? 0xffd23f : level === 2 ? 0xffffff : 0;
  const pad = () => poly(g, 0xd8c690, iso.diamond(0.94));
  const { cx, cy } = iso;

  switch (kind) {
    case 'nestCore': {
      pad();
      const h = 22 * hm;
      iso.block(g, 0.72, h, c.top, c.side);
      if (trim) iso.band(g, 0.72, h * 0.45, 4, trim);
      const ny = cy - h - 8;
      g.fillStyle(0x5e3f22, 1).fillEllipse(cx, ny + 4, iso.hw * 1.05, iso.hh * 1.25);
      g.fillStyle(0x8f6538, 1).fillEllipse(cx, ny, iso.hw * 0.95, iso.hh * 1.05);
      g.fillStyle(0x6b4a2a, 1).fillEllipse(cx, ny + 1, iso.hw * 0.7, iso.hh * 0.72);
      g.lineStyle(2, 0xb48a52, 1);
      for (let i = -3; i <= 3; i++) g.lineBetween(cx + i * 14 - 12, ny - 12 + Math.abs(i) * 2, cx + i * 14 + 12, ny + 14 - Math.abs(i) * 2);
      const eggs = 2 + level;
      for (let i = 0; i < eggs; i++) {
        const ex = cx - 20 + (i * 40) / Math.max(1, eggs - 1);
        g.fillStyle(0xfff7e6, 1).fillEllipse(ex, ny - 2 + (i % 2) * 5, 13, 16);
        g.fillStyle(0xe8dcc0, 1).fillEllipse(ex + 2, ny + 1 + (i % 2) * 5, 5, 6);
      }
      g.lineStyle(3, 0x4e2f18, 1).lineBetween(cx + iso.hw * 0.5, ny, cx + iso.hw * 0.5, ny - 48);
      poly(g, level === 3 ? 0xffd23f : level === 2 ? 0x4aa3c7 : 0xf1faee, [
        { x: cx + iso.hw * 0.5, y: ny - 48 },
        { x: cx + iso.hw * 0.5 + 24, y: ny - 41 },
        { x: cx + iso.hw * 0.5, y: ny - 34 },
      ]);
      break;
    }
    case 'grainField': {
      poly(g, 0x6b4423, iso.diamond(0.95));
      iso.block(g, 0.9, 4, 0x8b5a2b, 0x5a3a1c);
      const rows = 6 + level * 2;
      for (let r = 1; r < rows; r++) {
        const t = r / rows;
        const a = { x: iso.left(0.9, 4).x + (iso.top(0.9, 4).x - iso.left(0.9, 4).x) * t, y: iso.left(0.9, 4).y + (iso.top(0.9, 4).y - iso.left(0.9, 4).y) * t };
        const b = { x: iso.bottom(0.9, 4).x + (iso.right(0.9, 4).x - iso.bottom(0.9, 4).x) * t, y: iso.bottom(0.9, 4).y + (iso.right(0.9, 4).y - iso.bottom(0.9, 4).y) * t };
        for (let k = 1; k < 9; k++) {
          const x = a.x + ((b.x - a.x) * k) / 9;
          const y = a.y + ((b.y - a.y) * k) / 9;
          g.lineStyle(2, 0x6a994e, 1).lineBetween(x, y, x, y - 9);
          g.fillStyle(level === 3 ? 0xffd166 : c.top, 1).fillEllipse(x, y - 11, 4, 7);
        }
      }
      break;
    }
    case 'featherLoom': {
      pad();
      const h = 20 * hm;
      iso.block(g, 0.7, h, c.top, c.side);
      if (trim) iso.band(g, 0.7, h * 0.5, 4, trim);
      g.lineStyle(4, 0x7a4e2d, 1).strokeCircle(cx + 8, cy - h - 24, 17);
      g.lineStyle(2, 0x7a4e2d, 1);
      g.lineBetween(cx + 8 - 17, cy - h - 24, cx + 8 + 17, cy - h - 24);
      g.lineBetween(cx + 8, cy - h - 41, cx + 8, cy - h - 7);
      g.lineBetween(cx + 8, cy - h - 7, cx + 8, cy - h);
      for (let i = 0; i < 5 + level; i++) g.fillStyle(0xffffff, 1).fillCircle(cx - 24 + (i % 4) * 7, cy - h - 4 - Math.floor(i / 4) * 7, 6);
      g.fillStyle(c.accent, 1).fillCircle(cx - 14, cy - h - 12, 4);
      break;
    }
    case 'granary': {
      pad();
      const h = 32 * hm;
      iso.block(g, 0.72, h, c.top, c.side);
      g.lineStyle(1, shade(c.side, 0.7), 0.6);
      for (let i = 1; i < 5; i++) {
        const l = iso.left(0.72, (h * i) / 5);
        const b = iso.bottom(0.72, (h * i) / 5);
        g.lineBetween(l.x, l.y, b.x, b.y);
      }
      if (trim) iso.band(g, 0.72, h - 5, 5, trim);
      iso.pyramid(g, 0.8, h, 30 * hm, 0x9b2c2c);
      const d0 = iso.left(0.72, 0);
      const d1 = iso.bottom(0.72, 0);
      const mx = (d0.x + d1.x) / 2;
      const my = (d0.y + d1.y) / 2;
      poly(g, 0x3b2410, [
        { x: mx - 9, y: my - 4 },
        { x: mx + 9, y: my + 5 },
        { x: mx + 9, y: my - 17 },
        { x: mx - 9, y: my - 26 },
      ]);
      g.fillStyle(0xf2e8cf, 1).fillEllipse(cx + 22, cy + 6, 14, 16);
      g.fillStyle(0xe9c46a, 1).fillEllipse(cx + 22, cy - 1, 10, 5);
      break;
    }
    case 'hatchery': {
      pad();
      const h = 14 * hm;
      iso.block(g, 0.74, h, c.top, c.side);
      if (trim) iso.band(g, 0.74, h * 0.4, 4, trim);
      const ey = cy - h - 28;
      g.fillStyle(0x000000, 0.12).fillEllipse(cx + 4, cy - h + 2, 56, 16);
      g.fillStyle(0xfffaf0, 1).fillEllipse(cx, ey, 50, 62);
      g.fillStyle(0xf3e3bb, 1).fillEllipse(cx + 9, ey + 6, 26, 42);
      g.fillStyle(0xc9a66b, 1);
      for (const [dx, dy] of [
        [-10, -12],
        [8, -20],
        [12, 6],
        [-6, 12],
        [-14, 0],
      ])
        g.fillCircle(cx + dx, ey + dy, 2.5);
      g.lineStyle(2, 0x6b705c, 1);
      g.strokePoints(
        [
          { x: cx - 24, y: ey - 2 },
          { x: cx - 14, y: ey - 8 },
          { x: cx - 6, y: ey },
          { x: cx + 4, y: ey - 9 },
          { x: cx + 12, y: ey - 1 },
          { x: cx + 24, y: ey - 7 },
        ],
        false,
      );
      break;
    }
    case 'reedWall': {
      const h = 12 * hm;
      iso.block(g, 0.82, h, c.top, c.side);
      if (trim) iso.band(g, 0.82, h - 3, 3, trim);
      for (let i = 0; i < 5; i++) {
        const x = cx - 12 + i * 6;
        const y = cy - h + (i % 2) * 3;
        g.lineStyle(2, 0x386641, 1).lineBetween(x, y, x + (i % 2 ? 1 : -1), y - 16);
        g.fillStyle(0x7a4e2d, 1).fillEllipse(x + (i % 2 ? 1 : -1), y - 17, 4, 8);
      }
      break;
    }
    case 'pigeonLoft': {
      pad();
      const h = 44 * hm;
      iso.block(g, 0.6, h, c.top, c.side);
      if (trim) iso.band(g, 0.6, h - 6, 5, trim);
      for (const lift of [h * 0.35, h * 0.72]) {
        const p = iso.left(0.3, lift);
        g.fillStyle(0x3b2e4a, 1).fillEllipse(p.x + 6, p.y + 10, 8, 11);
        const q = iso.right(0.3, lift);
        g.fillStyle(0x2a2036, 1).fillEllipse(q.x - 6, q.y + 10, 8, 11);
      }
      iso.pyramid(g, 0.7, h, 22, 0x5c4d7d);
      g.fillStyle(0x9aa0a6, 1).fillEllipse(cx, cy - h - 24, 12, 9);
      g.fillStyle(0x7d8288, 1).fillCircle(cx + 5, cy - h - 29, 4);
      g.fillStyle(0xf28c28, 1).fillTriangle(cx + 8, cy - h - 30, cx + 12, cy - h - 29, cx + 8, cy - h - 28);
      break;
    }
    case 'hawkPerch': {
      pad();
      iso.block(g, 0.4, 8, 0x8d6e63, 0x5d4037);
      const px = cx;
      const top = cy - 8 - 52 * hm;
      g.fillStyle(0x5d4037, 1).fillRect(px - 3, top, 6, 52 * hm);
      g.fillStyle(0x6d4c41, 1).fillRect(px - 16, top + 4, 32, 5);
      // Hawk
      g.fillStyle(0x6d4c41, 1).fillEllipse(px + 2, top - 8, 18, 22);
      g.fillStyle(0x4e342e, 1).fillEllipse(px - 4, top - 6, 10, 18);
      g.fillStyle(0xefebe9, 1).fillCircle(px + 5, top - 20, 7);
      g.fillStyle(0x3e2723, 1).fillCircle(px + 6, top - 21, 1.8);
      g.fillStyle(c.accent, 1).fillTriangle(px + 10, top - 22, px + 16, top - 18, px + 10, top - 17);
      g.fillStyle(c.accent, 1).fillRect(px - 2, top + 2, 3, 3).fillRect(px + 4, top + 2, 3, 3);
      if (trim) g.fillStyle(trim, 1).fillRect(px - 8, top - 30, 16, 4);
      break;
    }
    case 'catapult': {
      pad();
      const h = 12 * hm;
      iso.block(g, 0.66, h, c.top, c.side);
      if (trim) iso.band(g, 0.66, h - 3, 3, trim);
      const by = cy - h;
      g.fillStyle(0x6d4c41, 1).fillRect(cx - 18, by - 30, 6, 30).fillRect(cx + 12, by - 30, 6, 30);
      g.fillStyle(0x5d4037, 1).fillRect(cx - 18, by - 32, 36, 5);
      g.lineStyle(5, 0x8d6e63, 1).lineBetween(cx - 20, by - 8, cx + 20, by - 52);
      g.fillStyle(0x5d4037, 1).fillEllipse(cx + 22, by - 54, 16, 9);
      g.fillStyle(0x9e9e9e, 1).fillCircle(cx + 22, by - 60, 8);
      g.fillStyle(0xbdbdbd, 1).fillCircle(cx + 20, by - 62, 3);
      g.lineStyle(2, 0x3e2723, 1).lineBetween(cx - 12, by - 14, cx - 26, by - 44);
      poly(g, c.accent, [
        { x: cx - 26, y: by - 44 },
        { x: cx - 10, y: by - 40 },
        { x: cx - 26, y: by - 36 },
      ]);
      break;
    }
    case 'birdshot': {
      pad();
      const h = 14 * hm;
      iso.block(g, 0.66, h, c.top, c.side);
      if (trim) iso.band(g, 0.66, h - 3, 3, trim);
      const by = cy - h;
      g.fillStyle(0x343a40, 1).fillEllipse(cx, by - 4, 30, 16);
      g.lineStyle(9, 0x212529, 1).lineBetween(cx - 2, by - 6, cx + 20, by - 26);
      g.lineStyle(3, c.accent, 1).lineBetween(cx + 8, by - 12, cx + 11, by - 15);
      g.fillStyle(0x111111, 1).fillCircle(cx + 21, by - 27, 4);
      g.fillStyle(0xadb5bd, 1);
      for (let i = 0; i < 4; i++) g.fillCircle(cx - 18 + i * 3, by + 2 - (i % 2) * 2, 1.6);
      break;
    }
    case 'heron': {
      pad();
      const plat = 34 * hm;
      g.lineStyle(3, 0x5d4037, 1);
      for (const p of [iso.left(0.5), iso.right(0.5), iso.bottom(0.5), iso.top(0.5)]) {
        g.lineBetween(p.x, p.y, cx + (p.x - cx) * 0.6, p.y - plat + (cy - p.y) * 0.4);
      }
      iso.block(g, 0.55, 5, 0x8d6e63, 0x5d4037, plat - 5);
      if (trim) iso.band(g, 0.55, plat - 5, 3, trim);
      const hy = cy - plat - 2;
      g.lineStyle(2, 0xf28c28, 1).lineBetween(cx - 2, hy, cx - 2, hy - 8).lineBetween(cx + 3, hy, cx + 3, hy - 8);
      g.fillStyle(c.top, 1).fillEllipse(cx, hy - 16, 22, 16);
      g.fillStyle(c.side, 1).fillEllipse(cx - 4, hy - 16, 14, 10);
      g.lineStyle(4, 0xeceff1, 1).lineBetween(cx + 6, hy - 20, cx + 10, hy - 38);
      g.fillStyle(0xffffff, 1).fillCircle(cx + 10, hy - 40, 5);
      g.fillStyle(0x263238, 1).fillCircle(cx + 11, hy - 41, 1.5);
      g.lineStyle(2, 0x263238, 1).lineBetween(cx + 8, hy - 44, cx + 1, hy - 46);
      poly(g, 0xfbc02d, [
        { x: cx + 14, y: hy - 42 },
        { x: cx + 30, y: hy - 39 },
        { x: cx + 14, y: hy - 38 },
      ]);
      break;
    }
    case 'turtlePit': {
      g.fillStyle(0x5d4037, 1).fillEllipse(cx, cy, iso.hw * 1.6, iso.hh * 1.5);
      g.fillStyle(0x4e342e, 1).fillEllipse(cx, cy + 1, iso.hw * 1.2, iso.hh * 1.0);
      g.fillStyle(0x606c38, 1).fillEllipse(cx, cy - 3, 22, 13);
      g.lineStyle(1, 0x283618, 1).strokeEllipse(cx, cy - 3, 12, 7);
      g.fillStyle(0x99582a, 1).fillCircle(cx + 12, cy - 2, 3.5);
      break;
    }
    case 'feedScatterer': {
      g.fillStyle(0xffd166, 1);
      for (let i = 0; i < 18; i++) g.fillCircle(cx - 14 + ((i * 7) % 28), cy - 2 + ((i * 5) % 9) - 3, 1.8);
      iso.block(g, 0.4, 12 * hm, c.side, shade(c.side, 1.1));
      g.fillStyle(0xf9c74f, 1).fillEllipse(cx, cy - 14 * hm, 12, 7);
      g.fillStyle(0xffe066, 1).fillCircle(cx - 2, cy - 16 * hm, 2).fillCircle(cx + 3, cy - 15 * hm, 2);
      if (trim) g.fillStyle(trim, 1).fillRect(cx - 5, cy - 6 * hm, 10, 2);
      break;
    }
    case 'matingHorn': {
      g.fillStyle(0x4e342e, 1).fillRect(cx - 2, cy - 24, 4, 24);
      poly(g, c.top, [
        { x: cx - 4, y: cy - 28 },
        { x: cx + 18, y: cy - 38 },
        { x: cx + 18, y: cy - 16 },
      ]);
      g.fillStyle(c.accent, 1).fillEllipse(cx + 18, cy - 27, 6, 22);
      g.lineStyle(2, 0xffffff, 0.8);
      g.beginPath().arc(cx + 22, cy - 27, 8, -0.8, 0.8).strokePath();
      g.beginPath().arc(cx + 22, cy - 27, 14, -0.7, 0.7).strokePath();
      if (trim) g.fillStyle(trim, 1).fillCircle(cx - 4, cy - 28, 3);
      break;
    }
  }
}

function makeBuildingTextures(scene: Phaser.Scene): void {
  for (const kind of BUILDING_KINDS) {
    const size = BUILDING_DEFS[kind].size;
    const w = size * TILE_W;
    const d = size * TILE_H;
    const head = HEADROOM[kind];
    for (let level = 1; level <= 3; level++) {
      const g = scene.make.graphics({}, false);
      drawBuilding(g, kind, level, new Iso(w / 2, head + d / 2, w / 2, d / 2));
      const key = buildingKey(kind, level);
      g.generateTexture(key, w, head + d);
      g.destroy();
      origins.set(key, head / (head + d));
    }
    // Rubble and scaffolding share the footprint size.
    if (!scene.textures.exists(`rubble_${size}`)) {
      const g = scene.make.graphics({}, false);
      const iso = new Iso(w / 2, 20 + d / 2, w / 2, d / 2);
      poly(g, 0x7d6b55, iso.diamond(0.8));
      for (let i = 0; i < 10 * size; i++) {
        const t = (i * 37) % 100;
        const x = iso.cx + (((i * 53) % 100) / 100 - 0.5) * iso.hw * 1.1;
        const y = iso.cy + ((t / 100) - 0.5) * iso.hh * 0.9;
        g.fillStyle(i % 3 ? 0x5d4e3c : 0x9e8c74, 1).fillEllipse(x, y - 3, 8 + (i % 4) * 2, 5 + (i % 3) * 2);
      }
      g.generateTexture(`rubble_${size}`, w, 20 + d);
      g.destroy();
      origins.set(`rubble_${size}`, 20 / (20 + d));

      const s = scene.make.graphics({}, false);
      const iso2 = new Iso(w / 2, 50 + d / 2, w / 2, d / 2);
      s.lineStyle(3, 0xa0703a, 1);
      for (const p of [iso2.left(0.8), iso2.right(0.8), iso2.bottom(0.8), iso2.top(0.8)]) s.lineBetween(p.x, p.y, p.x, p.y - 44);
      s.lineStyle(2, 0xc08a4a, 1);
      for (const lift of [18, 38]) {
        const pts = iso2.diamond(0.8, lift);
        s.strokePoints(pts as Phaser.Types.Math.Vector2Like[], true);
      }
      s.fillStyle(0xffc300, 1).fillRect(iso2.cx - 14, iso2.cy + iso2.hh * 0.8 - 12, 28, 8);
      s.fillStyle(0x222222, 1);
      for (let i = 0; i < 4; i++) s.fillTriangle(iso2.cx - 14 + i * 7, iso2.cy + iso2.hh * 0.8 - 4, iso2.cx - 10 + i * 7, iso2.cy + iso2.hh * 0.8 - 12, iso2.cx - 7 + i * 7, iso2.cy + iso2.hh * 0.8 - 12);
      s.generateTexture(`scaffold_${size}`, w, 50 + d);
      s.destroy();
      origins.set(`scaffold_${size}`, 50 / (50 + d));
    }
  }
  // What an attacker sees of an unsprung trap: a suspicious patch of mud.
  const g = scene.make.graphics({}, false);
  const iso = new Iso(TILE_W / 2, 14 + TILE_H / 2, TILE_W / 2, TILE_H / 2);
  g.fillStyle(0x6f8f4a, 0.6).fillEllipse(iso.cx, iso.cy, 30, 12);
  g.generateTexture('trap_hidden', TILE_W, 14 + TILE_H);
  g.destroy();
  origins.set('trap_hidden', 14 / (14 + TILE_H));
}

// ------------------------------------------------------------------ ducks

function drawDuck(g: G, kind: DuckKind): void {
  const c = DUCK_DEFS[kind].colors;
  const flying = kind === 'teal';
  const body = c.body;
  // feet
  if (!flying) {
    g.lineStyle(2, 0xf28c28, 1).lineBetween(13, 26, 12, 30).lineBetween(18, 26, 19, 30);
  }
  // tail
  poly(g, shade(body, 0.85), [
    { x: 5, y: 17 },
    { x: 1, y: 13 },
    { x: 8, y: 20 },
  ]);
  g.fillStyle(body, 1).fillEllipse(15, 21, 22, 13);
  g.fillStyle(shade(body, 0.8), 1).fillEllipse(13, 21, 12, 7);
  if (flying) {
    poly(g, shade(body, 0.9), [
      { x: 10, y: 18 },
      { x: 4, y: 5 },
      { x: 18, y: 17 },
    ]);
    poly(g, c.accent, [
      { x: 9, y: 16 },
      { x: 7, y: 11 },
      { x: 13, y: 16 },
    ]);
  }
  g.fillStyle(c.head, 1).fillCircle(22, 12, 6);
  g.fillStyle(0x111111, 1).fillCircle(24, 11, 1.4);
  g.fillStyle(0xffffff, 1).fillCircle(24.5, 10.5, 0.5);
  poly(g, 0xf28c28, [
    { x: 27, y: 11 },
    { x: 32, y: 13 },
    { x: 27, y: 15 },
  ]);

  switch (kind) {
    case 'mallard':
      g.lineStyle(2, 0xffffff, 1).lineBetween(18, 17, 23, 18);
      g.fillStyle(c.accent, 1).fillRect(16.5, 7, 11, 3);
      g.fillStyle(c.accent, 1).fillTriangle(16.5, 7, 13, 5, 14, 10);
      break;
    case 'eider':
      g.fillStyle(c.accent, 1).fillEllipse(21, 8, 14, 7);
      g.fillStyle(shade(c.accent, 0.7), 1).fillRect(15, 9, 14, 2);
      break;
    case 'teal':
      g.fillStyle(c.accent, 1).fillEllipse(21, 12, 8, 4);
      break;
    case 'merganser':
      poly(g, c.head, [
        { x: 16, y: 10 },
        { x: 12, y: 6 },
        { x: 18, y: 7 },
        { x: 15, y: 3 },
        { x: 21, y: 6 },
      ]);
      g.fillStyle(c.accent, 1).fillEllipse(30, 17, 6, 7);
      break;
    case 'sapper':
      g.fillStyle(0xc68642, 1).fillEllipse(10, 13, 12, 8);
      g.fillStyle(0xe0a96d, 1).fillEllipse(10, 12, 9, 4);
      g.lineStyle(1.5, 0x222222, 1).lineBetween(6, 11, 3, 6);
      g.fillStyle(c.accent, 1).fillCircle(3, 5, 2.4);
      g.fillStyle(0xffff66, 1).fillCircle(3, 5, 1);
      break;
    case 'medic':
      g.fillStyle(0xffffff, 1).fillEllipse(21, 7, 11, 6);
      g.fillStyle(c.accent, 1).fillRect(20, 4.5, 2, 5).fillRect(18.5, 6, 5, 2);
      break;
    case 'farmer':
      g.fillStyle(0xe9c46a, 1).fillEllipse(22, 7, 18, 4);
      g.fillStyle(0xd4a73a, 1).fillEllipse(22, 5, 9, 6);
      g.fillStyle(c.accent, 1).fillRect(17.5, 6, 9, 1.5);
      break;
    case 'builder':
      g.fillStyle(c.accent, 1).fillEllipse(22, 7, 13, 8);
      g.fillStyle(shade(c.accent, 0.8), 1).fillRect(15, 8, 15, 2);
      g.fillStyle(0x4e342e, 1).fillRect(5, 20, 8, 2);
      g.fillStyle(0x9e9e9e, 1).fillRect(3, 18, 4, 5);
      break;
    case 'molter':
      g.fillStyle(0xffffff, 1).fillCircle(6, 10, 2).fillCircle(9, 6, 1.5).fillCircle(28, 22, 2);
      break;
  }
}

function makeDuckTextures(scene: Phaser.Scene): void {
  // Drawn at 2x so ducks stay sharp when zoomed in; sprites use DUCK_SCALE.
  for (const kind of Object.keys(DUCK_DEFS) as DuckKind[]) {
    const g = scene.make.graphics({}, false);
    g.scaleCanvas(2, 2);
    drawDuck(g, kind);
    g.generateTexture(duckKey(kind), 68, 64);
    g.destroy();
  }
  // World-map critters
  const p = scene.make.graphics({}, false);
  p.fillStyle(0x9aa0a6, 1).fillEllipse(12, 12, 18, 10);
  p.fillStyle(0x7d8288, 1).fillTriangle(8, 10, 14, 1, 16, 11);
  p.fillStyle(0x6d7278, 1).fillCircle(20, 9, 4.5);
  p.fillStyle(0xf28c28, 1).fillTriangle(24, 8, 28, 9.5, 24, 11);
  p.fillStyle(0xf1faee, 1).fillRect(9, 13, 6, 4);
  p.generateTexture('pigeon', 30, 22);
  p.destroy();
}

// ------------------------------------------------------------------ tiles & fx

function makeTiles(scene: Phaser.Scene): void {
  const diamond = (key: string, fill: number, alpha: number, stroke?: number, detail = false) => {
    const g = scene.make.graphics({}, false);
    const iso = new Iso(TILE_W / 2, TILE_H / 2, TILE_W / 2, TILE_H / 2);
    poly(g, fill, iso.diamond(1), alpha);
    if (detail) {
      g.fillStyle(shade(fill, 1.12), 1);
      for (let i = 0; i < 3; i++) g.fillEllipse(18 + ((i * 17) % 30), 10 + ((i * 7) % 12), 5, 2);
    }
    if (stroke !== undefined) {
      g.lineStyle(1, stroke, 0.35);
      g.strokePoints(iso.diamond(1) as Phaser.Types.Math.Vector2Like[], true);
    }
    g.generateTexture(key, TILE_W, TILE_H);
    g.destroy();
  };
  diamond('tile_0', 0x7cc576, 1, 0x5fa85a, true);
  diamond('tile_1', 0x84cc7c, 1, 0x5fa85a, true);
  diamond('tile_2', 0x76bd70, 1, 0x5fa85a, false);
  diamond('tile_edge', 0x5e9e5a, 1, 0x4a8a46);
  diamond('tile_ok', 0x6cff6c, 0.45, 0x2e7d32);
  diamond('tile_bad', 0xff5a4a, 0.45, 0xb71c1c);
  diamond('tile_nodeploy', 0xff3b2f, 0.14);

  const fx = (key: string, w: number, h: number, draw: (g: G) => void) => {
    const g = scene.make.graphics({}, false);
    draw(g);
    g.generateTexture(key, w, h);
    g.destroy();
  };
  fx('shadow', 24, 10, (g) => g.fillStyle(0x000000, 0.25).fillEllipse(12, 5, 22, 8));
  fx('fx_boulder', 16, 16, (g) => g.fillStyle(0x8d8d8d, 1).fillCircle(8, 8, 7).fillStyle(0xbdbdbd, 1).fillCircle(6, 6, 2.5));
  fx('fx_pellet', 6, 6, (g) => g.fillStyle(0x222222, 1).fillCircle(3, 3, 2.5));
  fx('fx_beak', 14, 6, (g) => g.fillStyle(0xfbc02d, 1).fillTriangle(0, 0, 14, 3, 0, 6));
  fx('fx_egg', 10, 12, (g) => g.fillStyle(0xfff3c4, 1).fillEllipse(5, 6, 9, 11).fillStyle(0x9ccc65, 1).fillCircle(4, 5, 1.5));
  fx('fx_seed', 6, 6, (g) => g.fillStyle(0xffd166, 1).fillEllipse(3, 3, 5, 6));
  fx('fx_heart', 16, 14, (g) => {
    g.fillStyle(0xff5d8f, 1).fillCircle(4.5, 4.5, 4.5).fillCircle(11.5, 4.5, 4.5);
    g.fillTriangle(0.3, 6, 15.7, 6, 8, 14);
  });
  fx('fx_ring', 64, 64, (g) => g.lineStyle(4, 0xffffff, 1).strokeCircle(32, 32, 28));
  fx('fx_spark', 12, 12, (g) => {
    g.fillStyle(0xffe066, 1).fillTriangle(6, 0, 8, 6, 4, 6).fillTriangle(6, 12, 8, 6, 4, 6);
    g.fillTriangle(0, 6, 6, 4, 6, 8).fillTriangle(12, 6, 6, 4, 6, 8);
  });
  fx('fx_feather', 10, 14, (g) => g.fillStyle(0xffffff, 1).fillEllipse(5, 7, 5, 13).lineStyle(1, 0xcccccc, 1).lineBetween(5, 1, 5, 14));
  fx('fx_plus', 12, 12, (g) => g.fillStyle(0x66ff88, 1).fillRect(4, 0, 4, 12).fillRect(0, 4, 12, 4));
  fx('fx_smoke', 24, 24, (g) => g.fillStyle(0x777777, 0.7).fillCircle(12, 12, 11));
}

export function generateArt(scene: Phaser.Scene): void {
  textures = scene.textures;
  makeTiles(scene);
  makeBuildingTextures(scene);
  makeDuckTextures(scene);
}
