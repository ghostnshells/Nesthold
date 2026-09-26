import { COMBAT_DUCKS, COMBAT_DUCK_DEFS, armyHousing } from '@nesthold/shared';
import type { Army, CombatDuckKind } from '@nesthold/shared';
import type { Flock, Raid } from '../api';
import { api } from '../api';
import { duckKey, iconUrl } from '../art';
import { goto } from '../nav';
import { store } from '../store';
import { ago, attempt, closeSheet, duration, fmt, h, openSheet, stars, toast } from './dom';
import { openComposer, openDonate } from './panels';

type Tab = 'members' | 'pigeons' | 'raids';
let unread = 0;
const unreadSubs = new Set<(n: number) => void>();

export function bumpUnread(): void {
  unread++;
  unreadSubs.forEach((fn) => fn(unread));
}

export function onUnread(fn: (n: number) => void): void {
  unreadSubs.add(fn);
}

export async function openFlock(tab: Tab = 'members', pigeonTab: 'inbox' | 'sent' | 'intercepted' = 'inbox'): Promise<void> {
  const flock = await attempt(() => api.flock());
  if (flock === undefined) return;
  if (!flock) return openNoFlock();
  const tabs = h(
    'div',
    { class: 'tabs' },
    (
      [
        ['members', '🦆 Flock'],
        ['pigeons', `🕊 Pigeons${unread ? ` (${unread})` : ''}`],
        ['raids', '⚔️ Raids'],
      ] as Array<[Tab, string]>
    ).map(([id, label]) => h('button', { class: id === tab ? 'on' : '', onClick: () => openFlock(id) }, label)),
  );
  const body = h('div', null, h('p', { class: 'muted' }, 'Loading…'));
  openSheet([`🦆 ${flock.name}`, h('span', { class: 'tag' }, `${flock.members.length}/10`)], [tabs, body]);
  if (tab === 'members') body.replaceChildren(members(flock));
  if (tab === 'pigeons') {
    unread = 0;
    unreadSubs.forEach((fn) => fn(0));
    body.replaceChildren(await pigeons(pigeonTab));
  }
  if (tab === 'raids') body.replaceChildren(await raids());
}

async function openNoFlock(): Promise<void> {
  const list = (await attempt(() => api.flocks())) ?? [];
  const name = h('input', { type: 'text', placeholder: 'Flock name', maxLength: 24 }) as HTMLInputElement;
  openSheet('🦆 Join a flock', [
    h('p', null, 'Flocks share ducks, raid together, and talk by carrier pigeon. Rival hawks may snatch your pigeons!'),
    h(
      'div',
      { class: 'list' },
      list.map((f) =>
        h(
          'div',
          { class: 'item' },
          h('div', { class: 'grow' }, h('div', null, h('b', null, f.name)), h('div', { class: 'sub' }, `${f.members}/10 members · 🏆 ${f.trophies}`)),
          h(
            'button',
            {
              class: 'btn small green',
              disabled: f.members >= 10,
              onClick: async () => {
                const res = await attempt(() => api.joinFlock(f.id));
                if (!res) return;
                await refreshMe();
                toast(`Welcome to ${f.name}!`);
                openFlock();
              },
            },
            'Join',
          ),
        ),
      ),
    ),
    h('h3', null, 'Start your own'),
    h(
      'div',
      { class: 'row' },
      name,
      h(
        'button',
        {
          class: 'btn',
          onClick: async () => {
            const res = await attempt(() => api.createFlock(name.value));
            if (!res) return;
            await refreshMe();
            openFlock();
          },
        },
        'Create',
      ),
    ),
  ]);
}

async function refreshMe(): Promise<void> {
  const me = await attempt(() => api.me());
  if (me) store.setMe(me);
}

function members(flock: Flock): HTMLElement {
  const me = store.player.id;
  return h(
    'div',
    null,
    h(
      'div',
      { class: 'list' },
      flock.members.map((m) =>
        h(
          'div',
          { class: 'item' },
          h(
            'div',
            { class: 'grow' },
            h('div', null, h('b', null, m.name), ' ', m.isLeader ? h('span', { class: 'tag' }, 'leader') : null, ' ', m.isBot ? h('span', { class: 'tag bot' }, 'bot') : null),
            h('div', { class: 'sub' }, `🏆 ${m.trophies} · Lv${m.coreLevel} · 🥚 ${m.housing}/${m.capacity}${m.hawkLevel ? ` · 🦅${m.hawkLevel}` : ''}`),
          ),
          m.id === me
            ? h('span', { class: 'muted' }, 'you')
            : [
                h('button', { class: 'btn small blue', onClick: () => openComposer(m) }, '🕊'),
                h('button', { class: 'btn small', onClick: () => openDonate(m) }, '🎁'),
              ],
        ),
      ),
    ),
    h(
      'div',
      { class: 'row', style: 'margin-top:12px;justify-content:space-between' },
      h('span', { class: 'muted' }, 'Tip: open the map to see rival hawk territory before sending pigeons.'),
      h(
        'button',
        {
          class: 'btn small red',
          onClick: async () => {
            if (!confirm(`Leave ${flock.name}?`)) return;
            await attempt(() => api.leaveFlock());
            await refreshMe();
            closeSheet();
          },
        },
        'Leave',
      ),
    ),
  );
}

async function pigeons(sub: 'inbox' | 'sent' | 'intercepted'): Promise<HTMLElement> {
  const inbox = await attempt(() => api.inbox());
  if (!inbox) return h('div');
  const now = inbox.serverTime;
  const subtabs = h(
    'div',
    { class: 'tabs' },
    (
      [
        ['inbox', `📥 Inbox (${inbox.received.length})`],
        ['sent', `📤 Sent`],
        ['intercepted', `🦅 Snatched (${inbox.intercepted.length})`],
      ] as const
    ).map(([id, label]) => h('button', { class: id === sub ? 'on' : '', onClick: () => openFlock('pigeons', id) }, label)),
  );
  let list: HTMLElement[] = [];
  if (sub === 'inbox') {
    list = inbox.received.map((m) =>
      h(
        'div',
        { class: 'item', style: 'align-items:flex-start' },
        h('span', { style: 'font-size:22px' }, '🕊'),
        h('div', { class: 'grow' }, h('div', null, h('b', null, m.from), ' ', h('span', { class: 'sub' }, ago(now - m.at))), h('div', { style: 'user-select:text' }, m.text)),
        h('button', { class: 'btn small blue', onClick: () => openComposer({ id: m.fromId, name: m.from }) }, 'Reply'),
      ),
    );
    if (!list.length) list.push(h('p', { class: 'muted' }, 'No pigeons yet. Send one to a flock-mate!'));
  }
  if (sub === 'sent') {
    list = inbox.sent.map((m) =>
      h(
        'div',
        { class: 'item', style: 'align-items:flex-start' },
        h('div', { class: 'grow' }, h('div', null, 'To ', h('b', null, m.to), ' · ', h('span', { class: 'sub' }, `${m.kind} pigeon`)), h('div', { class: 'sub' }, `“${m.text}”`)),
        m.status === 'flying'
          ? h('span', { class: 'tag fly' }, `✈ ${duration((m.arriveAt - now) / 1000)}`)
          : m.status === 'delivered'
            ? h('span', { class: 'tag ok' }, 'delivered')
            : h('span', { class: 'tag lost' }, 'lost 🦅'),
      ),
    );
    if (!list.length) list.push(h('p', { class: 'muted' }, 'Nothing sent yet.'));
  }
  if (sub === 'intercepted') {
    list = inbox.intercepted.map((m) =>
      h(
        'div',
        { class: 'item', style: 'align-items:flex-start' },
        h('span', { style: 'font-size:22px' }, '🦅'),
        h(
          'div',
          { class: 'grow' },
          h('div', null, h('b', null, m.from), ' → ', h('b', null, m.to), ' ', h('span', { class: 'sub' }, ago(now - m.at))),
          h('div', { style: `font-family:${m.scrambled ? 'monospace' : 'inherit'}` }, `“${m.text}”`),
          m.scrambled ? h('div', { class: 'sub' }, '🔐 Enciphered: only a few letters survived.') : null,
        ),
      ),
    );
    if (!list.length) list.push(h('p', { class: 'muted' }, 'Build a Hawk Perch (Nest Core Lv2) to snatch rival pigeons flying near your nest.'));
  }
  return h('div', null, subtabs, h('div', { class: 'list' }, list));
}

async function raids(): Promise<HTMLElement> {
  const list = (await attempt(() => api.raids())) ?? [];
  const active = list.find((r) => r.status === 'pledging' || r.status === 'launched');
  const past = list.filter((r) => r !== active).slice(0, 5);
  return h(
    'div',
    null,
    active ? raidCard(active) : h('p', null, 'No raid is gathering. Tap ⚔️ Raid, pick a rival nest, and choose ', h('b', null, 'Rally flock raid'), '.'),
    past.length ? h('h3', null, 'Recent raids') : null,
    h(
      'div',
      { class: 'list' },
      past.map((r) =>
        h(
          'div',
          { class: 'item' },
          h('div', { class: 'grow' }, h('div', null, `${r.leaderName} → ${r.targetName}`), h('div', { class: 'sub' }, r.status === 'expired' ? 'Expired: ducks returned' : r.result ? `${r.result.destructionPct}% · 🌾${fmt(r.result.loot.grain)} 🪶${fmt(r.result.loot.feathers)}` : r.status)),
          r.result ? stars(r.result.stars) : null,
        ),
      ),
    ),
  );
}

function raidCard(raid: Raid): HTMLElement {
  const now = store.now();
  const mine = raid.pledges.find((p) => p.playerId === store.player.id);
  const pooledHousing = armyHousing(raid.pooled);
  const pick: Army = {};
  const pledgeRows = COMBAT_DUCKS.filter((k) => (store.nest.army[k] ?? 0) > 0).map((k) => stepper(k, store.nest.army[k] ?? 0, pick));
  return h(
    'div',
    null,
    h('h3', null, `🎯 ${raid.leaderName}'s raid on ${raid.targetName}`),
    h(
      'div',
      { class: 'stats' },
      h('div', { class: 'stat' }, h('b', null, 'Status'), raid.status === 'pledging' ? `Gathering · ${duration((raid.closesAt - now) / 1000)} left` : 'Launched!'),
      h('div', { class: 'stat' }, h('b', null, 'Pooled'), `${pooledHousing}/120 duck space`),
    ),
    h(
      'div',
      { class: 'list' },
      raid.pledges.map((p) =>
        h(
          'div',
          { class: 'item' },
          h('div', { class: 'grow' }, h('b', null, p.name), h('div', { class: 'sub' }, armyText(p.army))),
          h('span', { class: 'muted' }, `${p.housing}🏠`),
        ),
      ),
    ),
    raid.status === 'pledging'
      ? [
          h('h3', null, mine ? 'Pledge more ducks' : 'Pledge your ducks'),
          pledgeRows.length ? h('div', { class: 'list' }, pledgeRows) : h('p', { class: 'muted' }, 'You have no ducks to pledge. Hatch some first!'),
          h(
            'div',
            { class: 'row wrap', style: 'margin-top:8px' },
            pledgeRows.length
              ? h(
                  'button',
                  {
                    class: 'btn green',
                    onClick: async () => {
                      const res = await attempt(() => api.pledge(raid.id, pick));
                      if (!res) return;
                      await refreshMe();
                      toast('Ducks pledged! 🦆');
                      openFlock('raids');
                    },
                  },
                  'Pledge',
                )
              : null,
            raid.leaderId === store.player.id
              ? h(
                  'button',
                  {
                    class: 'btn red',
                    onClick: async () => {
                      const setup = await attempt(() => api.launchRaid(raid.id));
                      if (!setup) return;
                      closeSheet();
                      goto('battle', { mode: 'attack', setup });
                    },
                  },
                  '⚔️ Launch raid',
                )
              : h('span', { class: 'muted' }, `${raid.leaderName} will lead the attack.`),
          ),
        ]
      : null,
  );
}

function stepper(kind: CombatDuckKind, max: number, pick: Army): HTMLElement {
  const value = h('b', { style: 'min-width:24px;text-align:center' }, '0');
  const set = (n: number) => {
    pick[kind] = Math.max(0, Math.min(max, n));
    value.textContent = String(pick[kind]);
  };
  return h(
    'div',
    { class: 'item' },
    h('img', { src: iconUrl(duckKey(kind)), style: 'width:28px;height:28px' }),
    h('div', { class: 'grow' }, COMBAT_DUCK_DEFS[kind].name, h('div', { class: 'sub' }, `you have ${max}`)),
    h(
      'div',
      { class: 'stepper' },
      h('button', { onClick: () => set((pick[kind] ?? 0) - 1) }, '−'),
      value,
      h('button', { onClick: () => set((pick[kind] ?? 0) + 1) }, '+'),
      h('button', { onClick: () => set(max) }, 'All'),
    ),
  );
}

function armyText(army: Army): string {
  return COMBAT_DUCKS.filter((k) => army[k])
    .map((k) => `${army[k]}× ${COMBAT_DUCK_DEFS[k].name.split(' ')[0]}`)
    .join(', ');
}
