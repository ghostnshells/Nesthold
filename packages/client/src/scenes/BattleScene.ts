import Phaser from 'phaser';
import { TEXT_RES } from '../display';
import {
  BATTLE_TICKS,
  BattleSim,
  COMBAT_DUCKS,
  COMBAT_DUCK_DEFS,
  GRID_SIZE,
  TICKS_PER_SECOND,
} from '@nesthold/shared';
import type { BattleResult, CombatDuckKind, DeployCommand, SimBuilding, SimEvent } from '@nesthold/shared';
import type { AttackSetup, ReplayData } from '../api';
import { api } from '../api';
import { DUCK_SCALE, buildingOriginY, duckKey, iconUrl } from '../art';
import { bus } from '../events';
import { CameraControls, depthAt, drawGround, placeBuildingSprite, tileAt, worldOf } from '../isoview';
import { store } from '../store';
import { attempt, closeSheet, fmt, h, openSheet, root, stars, toast } from '../ui/dom';

export type BattleData = { mode: 'attack'; setup: AttackSetup } | { mode: 'replay'; replay: ReplayData };

const TICK_MS = 1000 / TICKS_PER_SECOND;

interface UnitView {
  img: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  icon: Phaser.GameObjects.Image | null;
  iconKind: string | null;
  lastSx: number;
}

export class BattleScene extends Phaser.Scene {
  private bd!: BattleData;
  private sim!: BattleSim;
  private commands: DeployCommand[] = [];
  private replayCmds: DeployCommand[] = [];
  private replayIdx = 0;
  private running = false;
  private finished = false;
  private acc = 0;
  private speed = 1;
  private selected: CombatDuckKind | null = null;
  private bSprites: Array<Phaser.GameObjects.Image | null> = [];
  private units = new Map<number, UnitView>();
  private bars!: Phaser.GameObjects.Graphics;
  private noDeploy!: Phaser.GameObjects.Container;
  private hud!: HTMLElement;
  private hudRefs!: { stars: HTMLElement; pct: HTMLElement; grain: HTMLElement; feathers: HTMLElement; time: HTMLElement; slots: HTMLElement };
  private holdTimer: Phaser.Time.TimerEvent | null = null;

  constructor() {
    super('battle');
  }

  init(data: BattleData): void {
    this.bd = data;
    this.commands = [];
    this.replayIdx = 0;
    this.running = false;
    this.finished = false;
    this.acc = 0;
    this.speed = 1;
    this.selected = null;
    this.units = new Map();
    this.bSprites = [];
  }

  create(): void {
    bus.emit('mode', 'battle');
    const setup = this.bd.mode === 'attack' ? this.bd.setup : this.bd.replay;
    this.sim = new BattleSim({ seed: setup.seed, buildings: setup.buildings, defenderResources: setup.defenderResources, army: setup.army });
    if (this.bd.mode === 'replay') {
      this.replayCmds = [...this.bd.replay.commands].sort((a, b) => a.tick - b.tick);
      this.running = true;
    }

    drawGround(this);
    this.noDeploy = this.add.container(0, 0).setDepth(-9000);
    for (let y = 0; y < GRID_SIZE; y++)
      for (let x = 0; x < GRID_SIZE; x++) {
        if (this.sim.canDeployAt(x, y)) continue;
        const p = worldOf(x, y);
        this.noDeploy.add(this.add.image(p.x, p.y, 'tile_nodeploy').setOrigin(0.5, 0));
      }
    this.noDeploy.setVisible(this.bd.mode === 'attack');

    for (const b of this.sim.buildings) {
      // Traps stay hidden until they spring.
      this.bSprites.push(b.trap ? null : placeBuildingSprite(this, b.kind, b.level, b.x, b.y));
    }
    this.bars = this.add.graphics().setDepth(200000);

    const controls = new CameraControls(this, { onTap: (wx, wy) => this.tryDeploy(wx, wy) });
    controls.fit(17);
    controls.centerOnGrid(GRID_SIZE / 2 + 1, GRID_SIZE / 2 + 1);
    this.setupHoldToDeploy();

    this.buildHud();
    this.events.once('shutdown', () => {
      this.hud?.remove();
      this.holdTimer?.remove();
    });
    if (this.bd.mode === 'attack') this.banner(`Raid on ${this.bd.setup.defenderName}!`, 'Pick a duck, tap outside the red zone');
    else this.banner(`Replay: ${this.bd.replay.attackerName} vs ${this.bd.replay.defenderName}`);
  }

  // ------------------------------------------------------------ loop

  override update(_time: number, delta: number): void {
    if (this.running && !this.finished) {
      this.acc += delta * this.speed;
      let steps = 0;
      while (this.acc >= TICK_MS && steps < 20) {
        this.acc -= TICK_MS;
        steps++;
        if (this.bd.mode === 'replay') {
          while (this.replayIdx < this.replayCmds.length && this.replayCmds[this.replayIdx].tick === this.sim.tick) this.sim.queue(this.replayCmds[this.replayIdx++]);
          if (this.replayIdx < this.replayCmds.length && this.replayCmds[this.replayIdx].tick < this.sim.tick) this.replayIdx++;
        }
        this.sim.step();
        for (const e of this.sim.events) this.onEvent(e);
        if (this.sim.isOver() || (this.bd.mode === 'replay' && this.replayIdx >= this.replayCmds.length && this.sim.units.every((u) => u.dead))) {
          this.finish();
          break;
        }
      }
    }
    this.renderUnits();
    this.renderBars();
    this.updateHud();
  }

  private renderUnits(): void {
    const alpha = this.running && !this.finished ? Math.min(1, this.acc / TICK_MS) : 1;
    const t = this.time.now;
    for (const u of this.sim.units) {
      const v = this.units.get(u.id);
      if (!v || u.dead) continue;
      const gx = u.px + (u.x - u.px) * alpha;
      const gy = u.py + (u.y - u.py) * alpha;
      const p = worldOf(gx, gy);
      const lift = u.def.airborne ? 20 + Math.sin(t / 160 + u.id) * 3 : 0;
      const bob = u.state === 'move' ? Math.abs(Math.sin(t / 90 + u.id)) * 2.5 : 0;
      v.shadow.setPosition(p.x, p.y).setDepth(depthAt(gx, gy) - 1);
      v.img.setPosition(p.x, p.y - lift - bob).setDepth(depthAt(gx, gy));
      // Face travel direction or the thing being attacked.
      let dir = p.x - v.lastSx;
      if (u.state === 'attack') dir = worldOf(u.aimX, u.aimY).x - p.x;
      if (Math.abs(dir) > 0.05) v.img.setFlipX(dir < 0);
      v.lastSx = p.x;
      v.img.setAngle(u.state === 'attack' ? Math.sin(t / 60 + u.id) * 8 : 0);

      const want = u.distraction ? (u.distraction === 'feed' ? 'fx_seed' : 'fx_heart') : null;
      if (want !== v.iconKind) {
        v.icon?.destroy();
        v.icon = want ? this.add.image(0, 0, want).setScale(want === 'fx_seed' ? 2 : 1) : null;
        v.iconKind = want;
      }
      v.icon?.setPosition(p.x, p.y - lift - 48 + Math.sin(t / 150) * 2).setDepth(200001);
    }
  }

  private renderBars(): void {
    const g = this.bars.clear();
    for (const b of this.sim.buildings) {
      if (b.destroyed || b.trap || b.hp >= b.maxHp) continue;
      const p = worldOf(b.cx, b.cy);
      const w = 16 + b.size * 8;
      const y = p.y - 26 - b.size * 10;
      g.fillStyle(0x000000, 0.6).fillRect(p.x - w / 2 - 1, y - 1, w + 2, 6);
      g.fillStyle(0xe5533d, 1).fillRect(p.x - w / 2, y, (w * b.hp) / b.maxHp, 4);
    }
    for (const u of this.sim.units) {
      if (u.dead || u.hp >= u.maxHp) continue;
      const v = this.units.get(u.id);
      if (!v) continue;
      g.fillStyle(0x000000, 0.6).fillRect(v.img.x - 13, v.img.y - 44, 26, 5);
      g.fillStyle(0x66dd55, 1).fillRect(v.img.x - 12, v.img.y - 43, (24 * u.hp) / u.maxHp, 3);
    }
  }

  // ------------------------------------------------------------ deployment

  private setupHoldToDeploy(): void {
    let downAt: { x: number; y: number } | null = null;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.bd.mode !== 'attack') return;
      downAt = { x: p.x, y: p.y };
      this.holdTimer?.remove();
      this.holdTimer = this.time.addEvent({
        delay: 380,
        callback: () => {
          if (!downAt || !p.isDown || Math.hypot(p.x - downAt.x, p.y - downAt.y) > 8) return;
          // Long-press: keep deploying at this spot.
          this.holdTimer = this.time.addEvent({
            delay: 130,
            loop: true,
            callback: () => {
              if (!p.isDown) {
                this.holdTimer?.remove();
                return;
              }
              const w = this.cameras.main.getWorldPoint(p.x, p.y);
              this.tryDeploy(w.x, w.y, true);
            },
          });
        },
      });
    });
    this.input.on('pointerup', () => {
      downAt = null;
      this.holdTimer?.remove();
    });
  }

  /** Ducks left to deploy, counting ones queued for the next tick. */
  private remaining(kind: CombatDuckKind): number {
    const queued = this.commands.filter((c) => c.type === 'deploy' && c.kind === kind && c.tick === this.sim.tick).length;
    return Math.max(0, (this.sim.remaining[kind] ?? 0) - queued);
  }

  private tryDeploy(wx: number, wy: number, quiet = false): void {
    if (this.bd.mode !== 'attack' || this.finished) return;
    if (!this.selected || this.remaining(this.selected) <= 0) {
      if (!quiet) toast('Pick a duck from the bar below first');
      return;
    }
    const t = tileAt(wx, wy);
    const cmd: DeployCommand = { tick: this.sim.tick, type: 'deploy', kind: this.selected, x: t.x, y: t.y };
    if (!this.sim.queue(cmd)) {
      if (!this.sim.canDeployAt(t.x, t.y)) {
        this.noDeploy.setAlpha(1);
        this.tweens.add({ targets: this.noDeploy, alpha: 0.6, duration: 500 });
        if (!quiet) toast("Can't deploy that close to the nest", true);
      }
      return;
    }
    this.commands.push(cmd);
    if (!this.running) {
      this.running = true;
      this.acc = TICK_MS; // deploy right away
    }
  }

  // ------------------------------------------------------------ events → effects

  private onEvent(e: SimEvent): void {
    switch (e.type) {
      case 'deploy': {
        const u = this.sim.units[e.unit];
        const p = worldOf(u.x, u.y);
        const scale = (u.kind === 'eider' ? 1.3 : 1) * 1.4;
        const img = this.add.image(p.x, p.y, duckKey(u.kind)).setOrigin(0.5, 0.9).setScale(scale * DUCK_SCALE);
        const shadow = this.add.image(p.x, p.y, 'shadow').setScale(scale);
        this.units.set(u.id, { img, shadow, icon: null, iconKind: null, lastSx: p.x });
        this.puff(p.x, p.y, 0xffffff, 3);
        break;
      }
      case 'hit': {
        const u = this.sim.units[e.unit];
        const b = this.sim.buildings[e.building];
        const from = this.units.get(u.id)?.img;
        const to = worldOf(e.x, e.y);
        if (u.kind === 'merganser' && from) this.projectile('fx_egg', from.x, from.y - 16, to.x, to.y - 12, 380, true, () => this.splat(to.x, to.y - 12, 0xfff3c4));
        else this.spark(to.x, to.y - 12);
        this.shake(b);
        break;
      }
      case 'shot': {
        const b = this.sim.buildings[e.building];
        const src = worldOf(b.cx, b.cy);
        const to = worldOf(e.x, e.y);
        const u = this.sim.units[e.unit];
        const lift = u.def.airborne ? 20 : 8;
        const sy = src.y - 24 - b.size * 8;
        if (e.projectile === 'boulder') this.projectile('fx_boulder', src.x, sy, to.x, to.y - lift, 450, true, () => this.ring(to.x, to.y - lift, e.splash, 0xbdbdbd));
        else if (e.projectile === 'pellets') {
          for (let i = 0; i < 4; i++) this.projectile('fx_pellet', src.x, sy, to.x + (i - 1.5) * 7, to.y - lift + ((i * 5) % 7) - 3, 160, false);
          this.time.delayedCall(160, () => this.ring(to.x, to.y - lift, e.splash, 0x333333));
        } else this.projectile('fx_beak', src.x, sy - 16, to.x, to.y - lift, 220, false, () => this.spark(to.x, to.y - lift));
        break;
      }
      case 'destroyed': {
        const b = this.sim.buildings[e.building];
        const spr = this.bSprites[e.building];
        const p = worldOf(b.cx, b.cy);
        if (b.trap) {
          // A turtle pit that snapped stays visible, a spent trap fades.
          if (spr) this.tweens.add({ targets: spr, alpha: 0.4, duration: 800 });
          break;
        }
        if (spr) {
          const key = `rubble_${b.size}`;
          spr.setTexture(key).setOrigin(0.5, buildingOriginY(key));
        }
        this.puff(p.x, p.y, 0x9e9e9e, 8);
        this.feathers(p.x, p.y - 20, 6);
        if (b.loot.grain || b.loot.feathers) this.floatText(p.x, p.y - 50, `+${fmt(b.loot.grain)}🌾 +${fmt(b.loot.feathers)}🪶`, '#ffe066');
        if (b.kind === 'nestCore') this.banner('Nest Core destroyed! ⭐');
        break;
      }
      case 'trap': {
        const b = this.sim.buildings[e.building];
        const p = worldOf(b.cx, b.cy);
        if (!this.bSprites[e.building]) {
          const spr = placeBuildingSprite(this, b.kind, b.level, b.x, b.y);
          spr.setScale(0.2);
          this.tweens.add({ targets: spr, scale: 1, duration: 250, ease: 'Back.out' });
          this.bSprites[e.building] = spr;
        }
        if (e.effect === 'feed') {
          for (let i = 0; i < 18; i++) {
            const s = this.add.image(p.x, p.y - 10, 'fx_seed').setDepth(150000);
            this.tweens.add({ targets: s, x: p.x + Phaser.Math.Between(-60, 60), y: p.y + Phaser.Math.Between(-20, 30), duration: 500, ease: 'Quad.out' });
            this.tweens.add({ targets: s, alpha: 0, delay: 2500, duration: 800, onComplete: () => s.destroy() });
          }
          this.floatText(p.x, p.y - 40, `🌽 Feed! ${e.affected.length} distracted`, '#fff');
        } else if (e.effect === 'horn') {
          for (let i = 0; i < 3; i++) this.time.delayedCall(i * 250, () => this.ring(p.x, p.y - 20, 6, 0xff5d8f));
          this.floatText(p.x, p.y - 44, `📯 Mating call! ${e.affected.length} lured`, '#ffd6e5');
        } else {
          this.spark(p.x, p.y);
          this.floatText(p.x, p.y - 30, '🐢 SNAP!', '#fff');
        }
        break;
      }
      case 'boom': {
        const p = worldOf(e.x, e.y);
        const flash = this.add.image(p.x, p.y - 8, 'fx_spark').setScale(1).setDepth(150000);
        this.tweens.add({ targets: flash, scale: 6, alpha: 0, duration: 350, onComplete: () => flash.destroy() });
        this.puff(p.x, p.y, 0x5d4037, 8);
        this.cameras.main.shake(120, 0.004);
        break;
      }
      case 'heal': {
        const v = this.units.get(e.unit);
        if (!v) break;
        this.ring(v.img.x, v.img.y - 6, e.radius, 0x66ff88);
        for (let i = 0; i < 3; i++) this.floatImg('fx_plus', v.img.x + Phaser.Math.Between(-20, 20), v.img.y - 10);
        break;
      }
      case 'death': {
        const v = this.units.get(e.unit);
        if (!v) break;
        this.feathers(v.img.x, v.img.y - 8, 4);
        v.shadow.destroy();
        v.icon?.destroy();
        this.tweens.add({ targets: v.img, alpha: 0, y: v.img.y - 30, angle: 180, duration: 500, onComplete: () => v.img.destroy() });
        this.units.delete(e.unit);
        break;
      }
    }
  }

  private projectile(key: string, x0: number, y0: number, x1: number, y1: number, ms: number, arc: boolean, done?: () => void): void {
    const img = this.add.image(x0, y0, key).setDepth(160000);
    img.setRotation(Math.atan2(y1 - y0, x1 - x0));
    const peak = arc ? Math.min(90, Math.hypot(x1 - x0, y1 - y0) * 0.35) : 0;
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: ms,
      onUpdate: (tw) => {
        const k = tw.getValue() ?? 0;
        img.setPosition(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k - Math.sin(k * Math.PI) * peak);
        if (arc) img.rotation += 0.2;
      },
      onComplete: () => {
        img.destroy();
        done?.();
      },
    });
  }

  private ring(x: number, y: number, radiusTiles: number, color: number): void {
    const r = this.add.image(x, y, 'fx_ring').setTint(color).setScale(0.1, 0.05).setDepth(150000);
    const s = Math.max(0.4, radiusTiles) * 1.1;
    this.tweens.add({ targets: r, scaleX: s, scaleY: s / 2, alpha: 0, duration: 450, onComplete: () => r.destroy() });
  }

  private spark(x: number, y: number): void {
    const s = this.add.image(x, y, 'fx_spark').setDepth(150000);
    this.tweens.add({ targets: s, scale: 2, alpha: 0, angle: 90, duration: 220, onComplete: () => s.destroy() });
  }

  private splat(x: number, y: number, color: number): void {
    const s = this.add.circle(x, y, 5, color).setDepth(150000);
    this.tweens.add({ targets: s, scale: 3, alpha: 0, duration: 300, onComplete: () => s.destroy() });
  }

  private puff(x: number, y: number, tint: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const s = this.add.image(x, y - 10, 'fx_smoke').setTint(tint).setScale(0.5).setDepth(150000);
      this.tweens.add({
        targets: s,
        x: x + Phaser.Math.Between(-30, 30),
        y: y - Phaser.Math.Between(10, 50),
        scale: 1.4,
        alpha: 0,
        duration: Phaser.Math.Between(400, 800),
        onComplete: () => s.destroy(),
      });
    }
  }

  private feathers(x: number, y: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const f = this.add.image(x, y, 'fx_feather').setDepth(150001);
      this.tweens.add({
        targets: f,
        x: x + Phaser.Math.Between(-35, 35),
        y: y + Phaser.Math.Between(-40, 10),
        angle: Phaser.Math.Between(-180, 180),
        alpha: 0,
        duration: Phaser.Math.Between(700, 1200),
        onComplete: () => f.destroy(),
      });
    }
  }

  private floatText(x: number, y: number, text: string, color: string): void {
    const t = this.add
      .text(x, y, text, { fontFamily: 'Trebuchet MS', resolution: TEXT_RES, fontSize: '15px', fontStyle: 'bold', color, stroke: '#3a2a1a', strokeThickness: 4 })
      .setOrigin(0.5)
      .setDepth(200002);
    this.tweens.add({ targets: t, y: y - 36, alpha: 0, delay: 600, duration: 900, onComplete: () => t.destroy() });
  }

  private floatImg(key: string, x: number, y: number): void {
    const t = this.add.image(x, y, key).setDepth(200002);
    this.tweens.add({ targets: t, y: y - 26, alpha: 0, duration: 700, onComplete: () => t.destroy() });
  }

  private shake(b: SimBuilding): void {
    const spr = this.bSprites[b.index];
    if (!spr || this.tweens.isTweening(spr)) return;
    const x = spr.x;
    this.tweens.add({ targets: spr, x: x + 2, yoyo: true, duration: 40, onComplete: () => spr.setX(x) });
  }

  private banner(text: string, sub?: string): void {
    const el = h('div', { class: 'center-banner' }, text, sub ? h('div', { style: 'font-size:15px;margin-top:6px' }, sub) : null);
    root().append(el);
    setTimeout(() => el.remove(), 2200);
  }

  // ------------------------------------------------------------ HUD

  private buildHud(): void {
    const refs = {
      stars: h('span'),
      pct: h('b'),
      grain: h('b'),
      feathers: h('b'),
      time: h('b'),
      slots: h('div', { class: 'deploy-bar' }),
    };
    const isReplay = this.bd.mode === 'replay';
    const top = h(
      'div',
      { class: 'battle-top' },
      h('div', { class: 'chip', style: 'flex-direction:column;align-items:flex-start;padding:6px 10px;gap:2px' }, refs.stars, h('span', null, 'Destroyed ', refs.pct)),
      h('div', { class: 'chip', style: 'flex-direction:column;align-items:flex-start;padding:6px 10px;gap:2px' }, h('span', null, '🌾 ', refs.grain), h('span', null, '🪶 ', refs.feathers)),
      h('div', { class: 'spacer' }),
      h('div', { class: 'chip', style: 'font-size:18px' }, '⏱ ', refs.time),
      isReplay
        ? h('button', { class: 'btn blue small', onClick: (e: Event) => ((e.target as HTMLElement).textContent = `${this.cycleSpeed()}×`) }, '1×')
        : h('button', { class: 'btn red small', onClick: () => this.endBattle() }, this.bd.mode === 'attack' && this.bd.setup.raidId ? 'End raid' : 'End'),
      isReplay ? h('button', { class: 'btn small', onClick: () => this.goHome() }, 'Home') : null,
    );
    this.hud = h('div', null, top, isReplay ? null : refs.slots);
    root().append(this.hud);
    this.hudRefs = refs;
    if (!isReplay) this.buildSlots();
  }

  private buildSlots(): void {
    const bar = this.hudRefs.slots;
    bar.innerHTML = '';
    for (const kind of COMBAT_DUCKS) {
      if (!(this.sim.remaining[kind] ?? 0) && !(this.sim.deployed[kind] ?? 0)) continue;
      const count = h('span');
      const slot = h(
        'div',
        {
          class: 'deploy-slot',
          'data-kind': kind,
          onClick: () => {
            this.selected = kind;
            bar.querySelectorAll('.deploy-slot').forEach((s) => s.classList.toggle('on', (s as HTMLElement).dataset.kind === kind));
          },
        },
        h('img', { src: iconUrl(duckKey(kind)), alt: COMBAT_DUCK_DEFS[kind].name }),
        count,
      );
      (slot as HTMLElement & { _count?: HTMLElement })._count = count;
      bar.append(slot);
    }
    const first = bar.querySelector('.deploy-slot') as HTMLElement | null;
    first?.click();
  }

  private updateHud(): void {
    const r = this.hudRefs;
    if (!r) return;
    const sim = this.sim;
    r.stars.replaceChildren(stars(sim.stars()));
    r.pct.textContent = `${sim.destructionPct()}%`;
    r.grain.textContent = fmt(sim.loot.grain);
    r.feathers.textContent = fmt(sim.loot.feathers);
    const left = Math.max(0, (BATTLE_TICKS - sim.tick) / TICKS_PER_SECOND);
    r.time.textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    r.slots.querySelectorAll('.deploy-slot').forEach((el) => {
      const slot = el as HTMLElement & { _count?: HTMLElement };
      const n = this.remaining(slot.dataset.kind as CombatDuckKind);
      if (slot._count) slot._count.textContent = `×${n}`;
      slot.classList.toggle('empty', n === 0);
    });
    if (this.bd.mode === 'attack' && COMBAT_DUCKS.every((k) => !(sim.remaining[k] ?? 0))) this.noDeploy.setVisible(false);
  }

  private cycleSpeed(): number {
    this.speed = this.speed >= 4 ? 1 : this.speed * 2;
    return this.speed;
  }

  // ------------------------------------------------------------ ending

  private endBattle(): void {
    if (this.finished) return;
    if (!this.running) {
      // Nothing deployed: just walk away (the server never charges for an unplayed attack).
      this.submit();
      return;
    }
    const cmd: DeployCommand = { tick: this.sim.tick, type: 'surrender' };
    if (this.sim.queue(cmd)) this.commands.push(cmd);
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.running = false;
    if (this.bd.mode === 'attack') this.submit();
    else this.showResult(this.sim.result(), null);
  }

  private async submit(): Promise<void> {
    this.finished = true;
    if (this.bd.mode !== 'attack') return;
    const setup = this.bd.setup;
    const claimed = this.sim.result();
    const res = await attempt(() => api.submitAttack(setup.attackId, this.commands, claimed));
    if (!res) {
      this.showResult(claimed, null);
      return;
    }
    store.setNest(res.nest);
    this.showResult(res.result, { trophies: res.trophyGain, pebbles: res.pebbleBonus, raid: !!setup.raidId });
  }

  private showResult(result: BattleResult, extra: { trophies: number; pebbles: number; raid: boolean } | null): void {
    const win = result.stars > 0;
    const lost = COMBAT_DUCKS.reduce((n, k) => n + (result.deployed[k] ?? 0), 0);
    openSheet(
      [win ? '🏆 Victory!' : '🪶 Defeat'],
      [
        h('div', { style: 'text-align:center;font-size:34px;margin:6px 0' }, stars(result.stars)),
        h(
          'div',
          { class: 'stats' },
          h('div', { class: 'stat' }, h('b', null, 'Destroyed'), `${result.destructionPct}%`),
          h('div', { class: 'stat' }, h('b', null, 'Loot'), `🌾 ${fmt(result.loot.grain)}  🪶 ${fmt(result.loot.feathers)}`),
          extra ? h('div', { class: 'stat' }, h('b', null, 'Trophies'), `${extra.trophies >= 0 ? '+' : ''}${extra.trophies} 🏆`) : null,
          h('div', { class: 'stat' }, h('b', null, 'Ducks used'), String(lost)),
          extra?.pebbles ? h('div', { class: 'stat' }, h('b', null, 'Bonus'), `💎 +${extra.pebbles}`) : null,
        ),
        extra?.raid ? h('p', { class: 'muted' }, 'Flock raid loot is split between everyone who pledged, by how many ducks they sent.') : null,
        h(
          'div',
          { class: 'row', style: 'justify-content:center;margin-top:10px' },
          this.bd.mode === 'replay' ? h('button', { class: 'btn blue', onClick: () => this.scene.restart(this.bd) }, 'Watch again') : null,
          h('button', { class: 'btn green', onClick: () => this.goHome() }, 'Return home'),
        ),
      ],
      { center: true, closable: false },
    );
  }

  private async goHome(): Promise<void> {
    closeSheet();
    const me = await attempt(() => api.me());
    if (me) store.setMe(me);
    this.scene.start('nest');
  }
}
