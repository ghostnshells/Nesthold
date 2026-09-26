/** Isometric projection helpers (2:1 diamond tiles). */
export const GRID_SIZE = 36;
export const TILE_W = 64;
export const TILE_H = 32;

/** Grid coords (can be fractional) -> screen offset of the tile's top corner. */
export function gridToScreen(x: number, y: number): { sx: number; sy: number } {
  return { sx: ((x - y) * TILE_W) / 2, sy: ((x + y) * TILE_H) / 2 };
}

/** Screen offset -> fractional grid coords. */
export function screenToGrid(sx: number, sy: number): { x: number; y: number } {
  const a = sx / (TILE_W / 2);
  const b = sy / (TILE_H / 2);
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/** Painter's-algorithm depth for something whose footprint's far corner is at (x, y). */
export function isoDepth(x: number, y: number): number {
  return x + y;
}
