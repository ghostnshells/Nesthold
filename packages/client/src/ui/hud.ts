import { busyBuilders, storageCapacity } from '@nesthold/shared';
import { api } from '../api';
import { bus } from '../events';
import { goto } from '../nav';
import { store } from '../store';
import { attempt, duration, fmt, h, root, toast } from './dom';
import { onUnread, openFlock } from './flock';
import { openHatch, openLog, openProfile, openShop } from './panels';

/** Top resource bar and bottom action buttons, rebuilt whenever the mode or store changes. */
export function mountHud(): void {
  let mode: 'nest' | 'world' | 'battle' = 'nest';
  let placing: { active: boolean; valid: boolean } = { active: false, valid: false };
  let unread = 0;

  const top = h('div', { class: 'hud-top' });
  const bottom = h('div', { class: 'hud-bottom' });
  root().append(top, bottom);

  const chip = (icon: string, bg: string, value: string, cap?: string, onClick?: () => void) =>
    h('div', { class: 'chip', onClick }, h('span', { class: 'ico', style: `background:${bg}` }, icon), value, cap ? h('span', { class: 'cap' }, `/${cap}`) : null);

  const bigBtn = (emoji: string, label: string, onClick: () => void, cls = '', badge = 0) =>
    h('button', { class: `big-btn ${cls}`, onClick }, h('span', { class: 'emoji' }, emoji), label, badge ? h('span', { class: 'badge' }, String(badge)) : null);

  const collectAll = async () => {
    const res = await attempt(() => api.action({ type: 'collectAll' }));
    if (!res) return;
    const g = res.gained as { grain: number; feathers: number };
    store.setNest(res.nest, res.serverTime);
    toast(g.grain || g.feathers ? `Collected 🌾${fmt(g.grain)} 🪶${fmt(g.feathers)}` : 'Nothing ready yet');
  };

  const render = () => {
    if (!store.nest) return;
    top.style.display = bottom.style.display = mode === 'battle' ? 'none' : '';
    if (mode === 'battle') return;
    const nest = store.nest;
    const cap = storageCapacity(nest);
    const shield = store.shieldUntil - store.now();
    top.replaceChildren(
      ...([
      h('div', { class: 'chip name', onClick: openProfile }, `🏆 ${store.player.trophies}  ${store.player.name}`),
      chip('🌾', '#f2b632', fmt(nest.resources.grain), fmt(cap.grain)),
      chip('🪶', '#b9a8e0', fmt(nest.resources.feathers), fmt(cap.feathers)),
      chip('💎', '#7fd1e0', fmt(nest.resources.pebbles)),
      chip('👷', '#ffb703', `${busyBuilders(nest)}/${nest.economyDucks.builder}`, undefined, () => toast('Construction Ducks busy / total. Hatch more at the Hatchery.')),
      mode === 'nest' ? h('button', { class: 'btn small', onClick: collectAll }, '🌾 Collect all') : null,
      shield > 0 ? chip('🛡', '#7fd1e0', duration(shield / 1000)) : null,
      ] as Array<HTMLElement | null>).filter((x): x is HTMLElement => x !== null),
    );
    if (mode === 'nest' && placing.active) {
      bottom.replaceChildren(
        h('button', { class: 'big-btn', onClick: () => bus.emit('placement:cancel') }, h('span', { class: 'emoji' }, '✖'), 'Cancel'),
        h('button', { class: `big-btn ${placing.valid ? '' : 'attack'}`, disabled: !placing.valid, onClick: () => bus.emit('placement:confirm') }, h('span', { class: 'emoji' }, '✔'), placing.valid ? 'Place' : 'Blocked'),
      );
      return;
    }
    if (mode === 'nest') {
      bottom.replaceChildren(
        bigBtn('🛠', 'Build', () => openShop()),
        bigBtn('🥚', 'Hatch', () => openHatch()),
        bigBtn('⚔️', 'Raid', () => goto('world'), 'attack'),
        bigBtn('🦆', 'Flock', () => openFlock(unread ? 'pigeons' : 'members'), '', unread),
        bigBtn('📜', 'Log', () => openLog()),
      );
    } else {
      bottom.replaceChildren(
        bigBtn('🏠', 'Home', () => goto('nest')),
        bigBtn('🦆', 'Flock', () => openFlock(unread ? 'pigeons' : 'members'), '', unread),
        bigBtn('📜', 'Log', () => openLog()),
      );
    }
  };

  store.subscribe(render);
  bus.on('mode', (m: typeof mode) => {
    mode = m;
    placing = { active: false, valid: false };
    render();
  });
  bus.on('placement', (active: boolean, valid: boolean) => {
    placing = { active, valid };
    render();
  });
  onUnread((n) => {
    unread = n;
    render();
  });
  setInterval(() => {
    if (mode !== 'battle' && store.shieldUntil > store.now()) render();
  }, 1000);
  render();
}
