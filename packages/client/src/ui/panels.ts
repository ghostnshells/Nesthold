import {
  BUILDING_DEFS,
  COMBAT_DUCKS,
  COMBAT_DUCK_DEFS,
  DUCK_DEFS,
  DUCK_UNLOCK_LEVEL,
  ECONOMY_DUCKS,
  MAX_LEVEL,
  PIGEON_KINDS,
  atLevel,
  canAfford,
  coreLevel,
  countOf,
  economyDuckCap,
  hatcheryLevel,
  housingCapacity,
  housingUsed,
  isBoosted,
  levelStats,
  maxCountOf,
  pendingProduction,
  productionPerHour,
  rushCost,
  storageCapacity,
} from '@nesthold/shared';
import type { BuildingCategory, BuildingKind, DuckKind, PigeonKind } from '@nesthold/shared';
import type { PublicPlayer } from '../api';
import { api } from '../api';
import { buildingKey, duckKey, iconUrl } from '../art';
import { bus } from '../events';
import { goto } from '../nav';
import { store } from '../store';
import { ago, attempt, closeSheet, costText, duration, fmt, h, openSheet, stars, toast } from './dom';
import { openFlock } from './flock';

// ------------------------------------------------------------------ building details

export function openBuilding(id: string): void {
  const b = store.nest.buildings.find((x) => x.id === id);
  if (!b) return;
  const def = BUILDING_DEFS[b.kind];
  const now = store.now();
  const lvl = Math.max(1, b.level);
  const stats: HTMLElement[] = [];
  const stat = (label: string, value: string) => stats.push(h('div', { class: 'stat' }, h('b', null, label), value));

  if (b.kind !== 'turtlePit' && b.kind !== 'feedScatterer' && b.kind !== 'matingHorn') stat('Hit points', fmt(levelStats(b.kind, lvl).hp));
  if (def.producer) {
    stat('Production', `${fmt(productionPerHour(store.nest, b))}/h ${def.producer.resource === 'grain' ? '🌾' : '🪶'}`);
    stat('Ready', `${fmt(pendingProduction(store.nest, b, now))} / ${fmt(atLevel(def.producer.capacity, lvl))}`);
    stat(def.producer.boostedBy === 'farmer' ? 'Farmer Duck' : 'Molting Duck', isBoosted(store.nest, b) ? '✅ +50% boost' : '— hatch one for +50%');
  }
  if (def.storage) stat('Stores', `🌾 ${fmt(atLevel(def.storage.grain, lvl))}  🪶 ${fmt(atLevel(def.storage.feathers, lvl))}`);
  if (def.hatchery) stat('Houses', `${atLevel(def.hatchery.housing, lvl)} duck space`);
  if (def.defense) {
    stat('Range', `${atLevel(def.defense.range, lvl)} tiles`);
    stat('Damage', `${atLevel(def.defense.damage, lvl)} per shot`);
    stat('Targets', def.defense.targets === 'air' ? '✈️ Air only' : def.defense.targets === 'ground' ? '🦶 Ground only' : 'Ground & air');
  }
  if (def.trap) {
    const t = def.trap;
    if (t.effect === 'damage') stat('Snap damage', String(atLevel(t.damage, lvl)));
    else {
      stat('Ducks affected', `up to ${atLevel(t.maxDucks, lvl)}`);
      stat('Lasts', `${atLevel(t.durationTicks, lvl) / 10}s`);
      if (t.effect === 'horn') stat('Immune', 'Eiders & Medics');
    }
    stat('Charges', `${atLevel(t.charges, lvl)} per raid`);
  }
  if (def.loft) {
    stat('Pigeon speed', `${atLevel(def.loft.speed, lvl)} leagues/s`);
    stat('Armour', `+${atLevel(def.loft.armor, lvl)}`);
    stat('Cipher', atLevel(def.loft.cipher, lvl) ? '🔐 Messages enciphered' : '— (level 3)');
  }
  if (def.hawk) {
    stat('Hunting radius', `${atLevel(def.hawk.radius, lvl)} leagues`);
    stat('Snatch chance', `${Math.round(atLevel(def.hawk.power, lvl) * 100)}%`);
  }

  const actions: HTMLElement[] = [];
  const act = async (fn: () => ReturnType<typeof api.action>, msg?: string) => {
    const res = await attempt(fn);
    if (!res) return;
    store.setNest(res.nest, res.serverTime);
    if (msg) toast(msg);
    openBuilding(id);
  };

  if (b.upgradingTo != null && b.upgradeEndsAt) {
    const left = (b.upgradeEndsAt - now) / 1000;
    actions.push(
      h('div', { class: 'stat', style: 'flex:1' }, h('b', null, b.level === 0 ? 'Under construction' : `Upgrading to level ${b.upgradingTo}`), `🔨 ${duration(left)} left`),
      h('button', { class: 'btn blue', onClick: () => act(() => api.action({ type: 'rush', id }), 'Done! The Construction Duck takes a bow.') }, `Finish now 💎${rushCost(b, now)}`),
    );
  } else if (b.level < MAX_LEVEL) {
    const next = levelStats(b.kind, b.level + 1);
    const blocked = b.kind !== 'nestCore' && b.level + 1 > coreLevel(store.nest);
    actions.push(
      h(
        'button',
        {
          class: 'btn green',
          disabled: blocked || !canAfford(store.nest.resources, next.cost),
          onClick: () => act(() => api.action({ type: 'upgrade', id }), 'Upgrade started 🔨'),
        },
        `Upgrade to Lv${b.level + 1} · ${costText(next.cost)} · ${duration(next.buildSeconds)}`,
      ),
    );
    if (blocked) actions.push(h('span', { class: 'muted' }, 'Needs a higher Nest Core'));
  } else actions.push(h('span', { class: 'muted' }, 'Max level'));

  if (def.producer && b.level >= 1) actions.push(h('button', { class: 'btn', onClick: () => act(() => api.action({ type: 'collect', id })) }, 'Collect'));
  if (def.hatchery && b.level >= 1)
    actions.push(
      h('button', { class: 'btn', onClick: () => openHatch() }, '🥚 Hatch ducks'),
    );
  if (b.kind === 'pigeonLoft' || b.kind === 'hawkPerch') actions.push(h('button', { class: 'btn', onClick: () => openFlock('pigeons') }, '🕊 Pigeon post'));
  actions.push(
    h(
      'button',
      {
        class: 'btn small',
        onClick: () => {
          closeSheet();
          bus.emit('move', id);
        },
      },
      '✥ Move',
    ),
  );

  openSheet(
    [h('img', { src: iconUrl(buildingKey(b.kind, lvl)), style: 'width:44px;height:44px;object-fit:contain' }), `${def.name}`, h('span', { class: 'tag' }, `Lv ${b.level}`)],
    [h('p', null, def.blurb), h('div', { class: 'stats' }, stats), h('div', { class: 'row wrap' }, actions)],
  );
}

// ------------------------------------------------------------------ shop

const SHOP_TABS: Array<{ id: string; label: string; cats: BuildingCategory[] }> = [
  { id: 'eco', label: '🌾 Nest', cats: ['resource', 'army', 'utility'] },
  { id: 'def', label: '🏹 Defense', cats: ['defense', 'wall'] },
  { id: 'trap', label: '🌽 Traps', cats: ['trap'] },
];

export function openShop(tab = 'eco'): void {
  const nest = store.nest;
  const tabs = h(
    'div',
    { class: 'tabs' },
    SHOP_TABS.map((t) => h('button', { class: t.id === tab ? 'on' : '', onClick: () => openShop(t.id) }, t.label)),
  );
  const cats = SHOP_TABS.find((t) => t.id === tab)!.cats;
  const kinds = (Object.keys(BUILDING_DEFS) as BuildingKind[]).filter((k) => cats.includes(BUILDING_DEFS[k].category));
  const cards = kinds.map((kind) => {
    const def = BUILDING_DEFS[kind];
    const have = countOf(nest, kind);
    const max = maxCountOf(nest, kind);
    const cost = def.levels[0].cost;
    const locked = have >= max;
    const afford = canAfford(nest.resources, cost);
    return h(
      'div',
      {
        class: `card${locked || !afford ? ' locked' : ''}`,
        onClick: () => {
          if (locked) return toast(max === 0 ? 'Unlocks at a higher Nest Core level' : `You have the most allowed (${max}) — upgrade your Nest Core`, true);
          if (!afford) return toast('Not enough resources', true);
          closeSheet();
          bus.emit('place', kind);
        },
      },
      h('span', { class: 'count' }, `${have}/${max}`),
      h('img', { src: iconUrl(buildingKey(kind, 1)) }),
      h('div', { class: 'title' }, def.name),
      h('div', { class: 'cost' }, costText(cost)),
      h('div', { class: 'muted' }, def.blurb),
    );
  });
  openSheet('🛠 Build', [tabs, h('div', { class: 'cards' }, cards)]);
}

// ------------------------------------------------------------------ hatchery

export function openHatch(): void {
  const nest = store.nest;
  const now = store.now();
  const used = housingUsed(nest);
  const cap = housingCapacity(nest);
  const hl = hatcheryLevel(nest);
  const train = async (kind: DuckKind) => {
    const res = await attempt(() => api.action({ type: 'train', kind }));
    if (!res) return;
    store.setNest(res.nest, res.serverTime);
    openHatch();
  };
  const duckCard = (kind: DuckKind, extra: string) => {
    const def = DUCK_DEFS[kind];
    const unlock = DUCK_UNLOCK_LEVEL[kind];
    const locked = hl < unlock;
    return h(
      'div',
      { class: `card${locked ? ' locked' : ''}`, onClick: () => (locked ? toast(`Needs a level ${unlock} Hatchery`, true) : train(kind)) },
      h('span', { class: 'count' }, extra),
      h('img', { src: iconUrl(duckKey(kind)) }),
      h('div', { class: 'title' }, def.name),
      h('div', { class: 'cost' }, costText(def.cost)),
      h('div', { class: 'muted' }, locked ? `🔒 Hatchery Lv${unlock}` : def.blurb),
    );
  };
  const queue = nest.trainingQueue.slice(0, 8).map((q) =>
    h('div', { class: 'item' }, h('img', { src: iconUrl(duckKey(q.kind)), style: 'width:28px;height:28px' }), h('div', { class: 'grow' }, DUCK_DEFS[q.kind].name), h('span', { class: 'muted' }, duration((q.readyAt - now) / 1000))),
  );
  openSheet('🥚 Hatchery', [
    h('p', null, `Duck space: ${used} / ${cap}`),
    h('div', { class: 'bar' }, h('div', { style: `width:${Math.min(100, (used / Math.max(1, cap)) * 100)}%` })),
    queue.length ? [h('h3', null, `Hatching (${nest.trainingQueue.length})`), h('div', { class: 'list' }, queue)] : null,
    h('h3', null, 'Raiding ducks'),
    h(
      'div',
      { class: 'cards' },
      COMBAT_DUCKS.map((k) => {
        const d = COMBAT_DUCK_DEFS[k];
        return duckCard(k, `×${nest.army[k] ?? 0} · ${d.housing}🏠`);
      }),
    ),
    h('h3', null, 'Nest ducks'),
    h(
      'div',
      { class: 'cards' },
      ECONOMY_DUCKS.map((k) => duckCard(k, `${nest.economyDucks[k]}/${economyDuckCap(nest, k)}`)),
    ),
  ]);
}

// ------------------------------------------------------------------ battle log

export async function openLog(): Promise<void> {
  const list = await attempt(() => api.battles());
  if (!list) return;
  const now = store.now();
  openSheet('📜 Battle log', [
    list.length ? null : h('p', { class: 'muted' }, 'No battles yet. Tap ⚔️ Raid to pick a target!'),
    h(
      'div',
      { class: 'list' },
      list.map((b) =>
        h(
          'div',
          { class: 'item' },
          h('span', { style: 'font-size:22px' }, b.asDefender ? '🛡' : b.raidId ? '🦆' : '⚔️'),
          h(
            'div',
            { class: 'grow' },
            h('div', null, b.asDefender ? `${b.attackerName} raided you` : `You${b.raidId ? ' & flock' : ''} raided ${b.defenderName}`),
            h('div', { class: 'sub' }, `${b.destructionPct}% · 🌾${fmt(b.loot.grain)} 🪶${fmt(b.loot.feathers)} · ${ago(now - b.createdAt)}`),
          ),
          stars(b.stars),
          h(
            'button',
            {
              class: 'btn small blue',
              onClick: async () => {
                const replay = await attempt(() => api.replay(b.id));
                if (!replay) return;
                closeSheet();
                goto('battle', { mode: 'replay', replay });
              },
            },
            '▶',
          ),
        ),
      ),
    ),
  ]);
}

// ------------------------------------------------------------------ world targets

export function openTarget(p: PublicPlayer): void {
  const me = store.player;
  const flockmate = !!me.flockId && p.flockId === me.flockId && !p.isMe;
  const actions: HTMLElement[] = [];
  if (p.isMe) actions.push(h('button', { class: 'btn', onClick: () => (closeSheet(), goto('nest')) }, '🏠 Go home'));
  else if (flockmate) {
    actions.push(h('button', { class: 'btn blue', onClick: () => openComposer(p) }, '🕊 Send pigeon'));
    actions.push(h('button', { class: 'btn', onClick: () => openDonate(p) }, '🎁 Donate ducks'));
  } else {
    actions.push(
      h(
        'button',
        {
          class: 'btn red',
          disabled: p.shielded,
          onClick: async () => {
            const setup = await attempt(() => api.startAttack(p.id));
            if (!setup) return;
            closeSheet();
            goto('battle', { mode: 'attack', setup });
          },
        },
        p.shielded ? '🛡 Shielded' : '⚔️ Attack!',
      ),
    );
    if (me.flockId)
      actions.push(
        h(
          'button',
          {
            class: 'btn',
            disabled: p.shielded,
            onClick: async () => {
              const raid = await attempt(() => api.openRaid(p.id));
              if (!raid) return;
              toast('Raid horn sounded! Flock-mates can pledge ducks for 10 minutes.');
              openFlock('raids');
            },
          },
          '🦆 Rally flock raid',
        ),
      );
  }
  openSheet(
    [h('img', { src: iconUrl(buildingKey('nestCore', p.coreLevel)), style: 'width:44px;height:44px;object-fit:contain' }), p.name, p.isBot ? h('span', { class: 'tag bot' }, 'bot') : null],
    [
      h(
        'div',
        { class: 'stats' },
        h('div', { class: 'stat' }, h('b', null, 'Nest Core'), `Level ${p.coreLevel}`),
        h('div', { class: 'stat' }, h('b', null, 'Trophies'), `🏆 ${p.trophies}`),
        h('div', { class: 'stat' }, h('b', null, 'Flock'), p.flockName ?? '—'),
        h('div', { class: 'stat' }, h('b', null, 'Hawk Perch'), p.hawkLevel ? `🦅 Level ${p.hawkLevel}` : 'None'),
      ),
      p.hawkLevel && !p.isMe && !flockmate ? h('p', { class: 'muted' }, 'Pigeons flying through the red circle may be snatched and read by this hawk.') : null,
      h('div', { class: 'row wrap' }, actions),
    ],
  );
}

export function openDonate(p: PublicPlayer): void {
  const army = store.nest.army;
  openSheet(`🎁 Donate to ${p.name}`, [
    h('p', { class: 'muted' }, 'Donated ducks move straight into their hatchery.'),
    h(
      'div',
      { class: 'cards' },
      COMBAT_DUCKS.filter((k) => (army[k] ?? 0) > 0).map((k) =>
        h(
          'div',
          {
            class: 'card',
            onClick: async () => {
              const res = await attempt(() => api.donate(p.id, k, 1));
              if (!res) return;
              store.setNest(res.nest);
              toast(`Sent a ${COMBAT_DUCK_DEFS[k].name} to ${p.name}`);
              openDonate(p);
            },
          },
          h('span', { class: 'count' }, `×${army[k]}`),
          h('img', { src: iconUrl(duckKey(k)) }),
          h('div', { class: 'title' }, COMBAT_DUCK_DEFS[k].name),
        ),
      ),
    ),
  ]);
}

// ------------------------------------------------------------------ pigeon composer

export function openComposer(to: { id: string; name: string }, kind: PigeonKind = 'standard', draft = ''): void {
  const text = h('textarea', { placeholder: `Coo to ${to.name}… (280 chars)`, maxLength: 280 }) as HTMLTextAreaElement;
  text.value = draft;
  const preview = h('div', { class: 'stats' }, h('div', { class: 'stat' }, 'Checking the skies…'));
  bus.emit('world:route', to.id);
  api
    .pigeonPreview(to.id, kind)
    .then((p) => {
      const pct = Math.round(p.survival * 100);
      preview.replaceChildren(
        h('div', { class: 'stat' }, h('b', null, 'Flight time'), `🕊 ${duration(p.flightSeconds)}`),
        h('div', { class: 'stat' }, h('b', null, 'Hawks on route'), p.hawks.length ? p.hawks.map((x) => `🦅 ${x.name} (${Math.round(x.chance * 100)}%)`).join(', ') : 'None spotted'),
        h('div', { class: 'stat', style: `color:${pct >= 80 ? '#1f6b1a' : pct >= 50 ? '#8a6100' : '#a02a15'}` }, h('b', null, 'Chance to arrive'), `${pct}%`),
        h('div', { class: 'stat' }, h('b', null, 'If snatched'), p.cipher ? '🔐 They read gibberish' : '📖 They read every word'),
      );
    })
    .catch((err) => preview.replaceChildren(h('div', { class: 'stat' }, err instanceof Error ? err.message : 'No route')));
  openSheet(
    `🕊 Pigeon to ${to.name}`,
    [
      h(
        'div',
        { class: 'cards' },
        (Object.keys(PIGEON_KINDS) as PigeonKind[]).map((k) =>
          h(
            'div',
            { class: 'card', style: k === kind ? 'border-color:#f2b632' : '', onClick: () => openComposer(to, k, text.value) },
            h('img', { src: iconUrl('pigeon'), style: 'width:40px;height:30px' }),
            h('div', { class: 'title' }, PIGEON_KINDS[k].name),
            h('div', { class: 'cost' }, costText(PIGEON_KINDS[k].cost)),
            h('div', { class: 'muted' }, PIGEON_KINDS[k].blurb),
          ),
        ),
      ),
      preview,
      text,
      h(
        'div',
        { class: 'row', style: 'margin-top:8px;justify-content:flex-end' },
        h(
          'button',
          {
            class: 'btn green',
            onClick: async () => {
              const res = await attempt(() => api.sendPigeon(to.id, text.value, kind));
              if (!res) return;
              store.setNest(res.nest);
              closeSheet();
              toast(res.hawksOnRoute ? `🕊 Pigeon away! ${res.hawksOnRoute} hawk${res.hawksOnRoute > 1 ? 's' : ''} lurk on the route…` : '🕊 Pigeon away!');
            },
          },
          'Send',
        ),
      ),
    ],
    { onClose: () => bus.emit('world:route', null) },
  );
}

// ------------------------------------------------------------------ profile

export function openProfile(): void {
  const input = h('input', { type: 'text', value: store.player.name, maxLength: 20 }) as HTMLInputElement;
  const cap = storageCapacity(store.nest);
  openSheet('🦆 Your nest', [
    h(
      'div',
      { class: 'stats' },
      h('div', { class: 'stat' }, h('b', null, 'Trophies'), `🏆 ${store.player.trophies}`),
      h('div', { class: 'stat' }, h('b', null, 'Flock'), store.player.flockName ?? '—'),
      h('div', { class: 'stat' }, h('b', null, 'Storage'), `🌾 ${fmt(cap.grain)} 🪶 ${fmt(cap.feathers)}`),
      h('div', { class: 'stat' }, h('b', null, 'Nest ducks'), `👷 ${store.nest.economyDucks.builder} · 👨‍🌾 ${store.nest.economyDucks.farmer} · 🪶 ${store.nest.economyDucks.molter}`),
    ),
    h('h3', null, 'Name'),
    h(
      'div',
      { class: 'row' },
      input,
      h(
        'button',
        {
          class: 'btn',
          onClick: async () => {
            const me = await attempt(() => api.rename(input.value));
            if (me) {
              store.setMe(me);
              toast('Name changed');
            }
          },
        },
        'Save',
      ),
    ),
    h('p', { class: 'muted', style: 'margin-top:12px' }, 'Nesthold — Clash of Clans meets Clusterduck. Build your nest, hatch ducks, raid rivals, and mind the hawks.'),
  ]);
}

