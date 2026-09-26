import type { Resources } from '@nesthold/shared';

type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, unknown> & { class?: string; style?: string };

/** Minimal hyperscript for DOM panels. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'style') el.setAttribute('style', String(v));
    else if (k in el) (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat(Infinity as 1) as Array<Exclude<Child, Child[]>>) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export const root = () => document.getElementById('ui')!;

let current: HTMLElement | null = null;
let onCloseCurrent: (() => void) | null = null;

/** Opens a bottom sheet (or centred dialog). Only one at a time. */
export function openSheet(title: Child, body: Child, opts: { center?: boolean; onClose?: () => void; closable?: boolean } = {}): HTMLElement {
  closeSheet();
  const sheet = h(
    'div',
    { class: 'sheet', onClick: (e: Event) => e.stopPropagation() },
    h('h2', null, title, opts.closable === false ? null : h('button', { class: 'close', onClick: () => closeSheet(), 'aria-label': 'Close' }, '✕')),
    body,
  );
  const backdrop = h(
    'div',
    {
      class: `backdrop${opts.center ? ' center' : ''}`,
      onClick: () => {
        if (opts.closable !== false) closeSheet();
      },
    },
    sheet,
  );
  root().append(backdrop);
  current = backdrop;
  onCloseCurrent = opts.onClose ?? null;
  return sheet;
}

export function closeSheet(): void {
  if (!current) return;
  current.remove();
  current = null;
  const fn = onCloseCurrent;
  onCloseCurrent = null;
  fn?.();
}

export function sheetOpen(): boolean {
  return current !== null;
}

let toastBox: HTMLElement | null = null;

export function toast(message: string, bad = false): void {
  if (!toastBox || !toastBox.isConnected) {
    toastBox = h('div', { class: 'toasts' });
    root().append(toastBox);
  }
  const t = h('div', { class: `toast${bad ? ' bad' : ''}` }, message);
  toastBox.append(t);
  setTimeout(() => t.remove(), 3300);
}

/** Runs an async action, turning errors into a red toast. */
export async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Something went wrong', true);
    return undefined;
  }
}

export const RES_ICON = { grain: '🌾', feathers: '🪶', pebbles: '💎' } as const;

export function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.floor(n / 1000)}k`;
  return String(Math.floor(n));
}

export function costText(cost: Resources): string {
  const parts: string[] = [];
  if (cost.grain) parts.push(`${RES_ICON.grain}${fmt(cost.grain)}`);
  if (cost.feathers) parts.push(`${RES_ICON.feathers}${fmt(cost.feathers)}`);
  if (cost.pebbles) parts.push(`${RES_ICON.pebbles}${fmt(cost.pebbles)}`);
  return parts.join(' ') || 'Free';
}

export function duration(seconds: number): string {
  seconds = Math.max(0, Math.ceil(seconds));
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const hr = Math.floor(m / 60);
  return `${hr}h ${m % 60}m`;
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function stars(n: number): HTMLElement {
  return h('span', { class: 'stars' }, [0, 1, 2].map((i) => h('span', { class: i < n ? '' : 'off' }, '⭐')));
}
