/** Grid A* with octile movement. Deterministic: ties are broken by insertion order. */

export const SQRT2 = Math.SQRT2;

interface HeapNode {
  idx: number;
  f: number;
  order: number;
}

class MinHeap {
  private items: HeapNode[] = [];

  get size(): number {
    return this.items.length;
  }

  push(n: HeapNode): void {
    const a = this.items;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }

  pop(): HeapNode {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && less(a[l], a[m])) m = l;
        if (r < a.length && less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

function less(a: HeapNode, b: HeapNode): boolean {
  return a.f < b.f || (a.f === b.f && a.order < b.order);
}

/**
 * @param cost per-tile entry cost; Infinity = impassable.
 * @param isGoal returns true for tiles that satisfy the search.
 * @param hx,hy heuristic target point (tile coords).
 * @returns tile indices from the first step to the goal (start excluded), [] if already at goal, null if unreachable.
 */
export function findPath(
  size: number,
  cost: ArrayLike<number>,
  start: number,
  isGoal: (idx: number) => boolean,
  hx: number,
  hy: number,
  maxExpanded = 4000,
): number[] | null {
  if (isGoal(start)) return [];
  const n = size * size;
  const g = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new MinHeap();
  let order = 0;
  const h = (idx: number) => {
    const dx = Math.abs((idx % size) + 0.5 - hx);
    const dy = Math.abs(Math.floor(idx / size) + 0.5 - hy);
    return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
  };
  g[start] = 0;
  heap.push({ idx: start, f: h(start), order: order++ });
  let expanded = 0;
  while (heap.size) {
    const { idx } = heap.pop();
    if (closed[idx]) continue;
    closed[idx] = 1;
    if (idx !== start && isGoal(idx)) {
      const path: number[] = [];
      for (let c = idx; c !== start; c = came[c]) path.push(c);
      return path.reverse();
    }
    if (++expanded > maxExpanded) break;
    const x = idx % size;
    const y = (idx - x) / size;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const ni = ny * size + nx;
        const c = cost[ni];
        if (c === Infinity || closed[ni]) continue;
        let step = c;
        if (dx && dy) {
          // No cutting corners past blocked tiles.
          if (cost[y * size + nx] === Infinity || cost[ny * size + x] === Infinity) continue;
          step = c * SQRT2;
        }
        const ng = g[idx] + step;
        if (ng < g[ni]) {
          g[ni] = ng;
          came[ni] = idx;
          heap.push({ idx: ni, f: ng + h(ni), order: order++ });
        }
      }
    }
  }
  return null;
}
