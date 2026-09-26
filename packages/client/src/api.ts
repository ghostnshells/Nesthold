import { Preferences } from '@capacitor/preferences';
import type { Army, BattleResult, DeployCommand, DuckKind, BuildingKind, NestState, PigeonKind, PlacedBuilding, Resources } from '@nesthold/shared';

/** Set VITE_API_URL (e.g. https://nest.example.com) for the iOS build; web dev uses the Vite proxy. */
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const TOKEN_KEY = 'nesthold.token';

export interface PublicPlayer {
  id: string;
  name: string;
  wx: number;
  wy: number;
  flockId: string | null;
  flockName: string | null;
  trophies: number;
  coreLevel: number;
  hawkLevel: number;
  loftLevel: number;
  isBot: boolean;
  shielded: boolean;
  isMe?: boolean;
}

export interface MeResponse {
  player: PublicPlayer;
  nest: NestState;
  serverTime: number;
  shieldUntil: number;
}

export interface AttackSetup {
  attackId: string;
  seed: number;
  buildings: PlacedBuilding[];
  defenderResources: Resources;
  army: Army;
  defenderName: string;
  raidId: string | null;
}

export interface ReplayData extends Omit<AttackSetup, 'raidId'> {
  commands: DeployCommand[];
  result: BattleResult;
  attackerName: string;
}

export interface BattleSummary {
  id: string;
  attackerName: string;
  defenderName: string;
  asDefender: boolean;
  raidId: string | null;
  stars: number;
  destructionPct: number;
  loot: Resources;
  createdAt: number;
}

export interface FlockMember extends PublicPlayer {
  housing: number;
  capacity: number;
  isLeader: boolean;
}

export interface Flock {
  id: string;
  name: string;
  leaderId: string;
  members: FlockMember[];
}

export interface Raid {
  id: string;
  leaderId: string;
  leaderName: string;
  targetId: string;
  targetName: string;
  status: 'pledging' | 'launched' | 'done' | 'expired';
  closesAt: number;
  attackId: string | null;
  result: BattleResult | null;
  pledges: Array<{ playerId: string; name: string; army: Army; housing: number }>;
  pooled: Army;
}

export interface Inbox {
  received: Array<{ id: string; from: string; fromId: string; text: string; kind: PigeonKind; at: number }>;
  sent: Array<{ id: string; toId: string; to: string; text: string; kind: PigeonKind; sentAt: number; arriveAt: number; status: 'flying' | 'delivered' | 'lost'; hawks: number }>;
  intercepted: Array<{ id: string; from: string; to: string; text: string; at: number; scrambled: boolean }>;
  serverTime: number;
}

export interface PigeonPreview {
  flightSeconds: number;
  survival: number;
  hawks: Array<{ name: string; level: number; chance: number }>;
  cost: Resources;
  cipher: boolean;
}

export type NestAction =
  | { type: 'place'; kind: BuildingKind; x: number; y: number }
  | { type: 'move'; id: string; x: number; y: number }
  | { type: 'upgrade'; id: string }
  | { type: 'rush'; id: string }
  | { type: 'collect'; id: string }
  | { type: 'collectAll' }
  | { type: 'train'; kind: DuckKind };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Listener = (msg: { type: string; [k: string]: unknown }) => void;

class Api {
  private token: string | null = null;
  private listeners = new Set<Listener>();
  private ws: WebSocket | null = null;

  async init(): Promise<MeResponse> {
    this.token = (await Preferences.get({ key: TOKEN_KEY })).value;
    if (this.token) {
      try {
        const me = await this.me();
        this.connect();
        return me;
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 401)) throw err;
      }
    }
    const res = await this.req<MeResponse & { token: string }>('POST', '/auth/guest', {});
    this.token = res.token;
    await Preferences.set({ key: TOKEN_KEY, value: res.token });
    this.connect();
    return res;
  }

  private async req<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
    return data as T;
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private connect(): void {
    if (!this.token) return;
    const origin = BASE || location.origin;
    const url = `${origin.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(this.token)}`;
    try {
      this.ws = new WebSocket(url);
    } catch {
      return;
    }
    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string);
        this.listeners.forEach((fn) => fn(msg));
      } catch {
        /* ignore */
      }
    };
    this.ws.onclose = () => setTimeout(() => this.connect(), 3000);
  }

  me = () => this.req<MeResponse>('GET', '/me');
  rename = (name: string) => this.req<MeResponse>('POST', '/me/name', { name });
  action = (a: NestAction) => this.req<{ nest: NestState; gained?: Resources | number; serverTime: number }>('POST', '/nest/action', a);
  world = () => this.req<PublicPlayer[]>('GET', '/world');

  startAttack = (targetId: string) => this.req<AttackSetup>('POST', '/attack/start', { targetId });
  submitAttack = (attackId: string, commands: DeployCommand[], claimed: BattleResult) =>
    this.req<{ result: BattleResult; mismatch: boolean; trophyGain: number; pebbleBonus: number; nest: NestState }>('POST', '/attack/submit', {
      attackId,
      commands,
      claimed,
    });
  battles = () => this.req<BattleSummary[]>('GET', '/battles');
  replay = (id: string) => this.req<ReplayData>('GET', `/battles/${id}`);

  flocks = () => this.req<Array<{ id: string; name: string; members: number; trophies: number }>>('GET', '/flocks');
  flock = () => this.req<Flock | null>('GET', '/flock');
  createFlock = (name: string) => this.req<Flock>('POST', '/flock/create', { name });
  joinFlock = (flockId: string) => this.req<Flock>('POST', '/flock/join', { flockId });
  leaveFlock = () => this.req<null>('POST', '/flock/leave', {});
  donate = (to: string, kind: string, count: number) => this.req<{ nest: NestState }>('POST', '/flock/donate', { to, kind, count });

  raids = () => this.req<Raid[]>('GET', '/raids');
  openRaid = (targetId: string) => this.req<Raid>('POST', '/raid/open', { targetId });
  pledge = (raidId: string, army: Army) => this.req<Raid>('POST', '/raid/pledge', { raidId, army });
  launchRaid = (raidId: string) => this.req<AttackSetup>('POST', '/raid/launch', { raidId });

  pigeonPreview = (to: string, kind: PigeonKind) => this.req<PigeonPreview>('POST', '/pigeon/preview', { to, kind });
  sendPigeon = (to: string, text: string, kind: PigeonKind) => this.req<{ id: string; arriveAt: number; hawksOnRoute: number; nest: NestState }>('POST', '/pigeon/send', { to, text, kind });
  inbox = () => this.req<Inbox>('GET', '/pigeon/inbox');
}

export const api = new Api();
