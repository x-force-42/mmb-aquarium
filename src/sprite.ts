/**
 * MeeseeksSprite — the visual half of one Meeseeks.
 *
 * Owns its own Pixi container, body Graphics, and (optional) name Text.
 * The renderer drives lifecycle via `update(dt, time)` once per frame and
 * via the small event hooks (`onStateChange`, `onFreakingOut`, `onRecovered`,
 * `startDeath`).
 *
 * Body color is driven by `tint` on a white-filled rect so we never have
 * to redraw geometry when state changes — that's both cheaper and simpler.
 */

import { Container, Graphics, Text } from 'pixi.js';
import { healthColor, lerpColor } from './colors';
import { getActivePalette } from './theme';
import type { Palette } from './theme';
import type { MeeseeksState } from './types';

const M_W = 40;
const M_H = 60;

const BIRTH_MS = 500;
const DEATH_MS = 1500;
const FREAK_RAMP_MS = 300;

const TREMOR_HEALTH_TH = 0.3;
const BOB_AMPLITUDE_PX = 4;
const BOB_FREQ_HZ = 0.6;

export type DeathKind = 'happy' | 'defeated';
export interface SpritePosition {
  readonly x: number;
  readonly y: number;
}

export const SPRITE_TUNING = {
  M_W,
  M_H,
  BIRTH_MS,
  DEATH_MS,
} as const;

export class MeeseeksSprite {
  readonly id: string;
  readonly basePos: SpritePosition;
  readonly container: Container;

  health: number;
  isFreakingOut: boolean;
  deathState: DeathKind | null = null;

  private readonly role: MeeseeksState['role'];
  private readonly body: Graphics;
  private nameText: Text | null;
  private readonly phaseOffset: number;

  // Animation timers (ms).
  private birthMs = BIRTH_MS;
  private deathMs = 0;
  private freakIntensity: number;
  private readonly birthOffsetY = 8;

  constructor(model: MeeseeksState, basePos: SpritePosition) {
    this.id = model.id;
    this.basePos = basePos;
    this.health = model.health;
    this.isFreakingOut = model.isFreakingOut;
    this.role = model.role;
    this.freakIntensity = model.isFreakingOut ? 1 : 0;
    this.phaseOffset = Math.random() * Math.PI * 2;

    this.container = new Container();
    this.container.position.set(basePos.x, basePos.y);

    // White-filled body so `tint` directly drives the displayed color.
    const palette = getActivePalette();
    this.body = new Graphics();
    this.body.beginFill(palette.spriteBase);
    this.body.drawRect(-M_W / 2, -M_H / 2, M_W, M_H);
    this.body.endFill();
    this.body.tint = this.baseColor(palette);
    this.container.addChild(this.body);

    if (model.name) {
      this.nameText = new Text(model.name, {
        fontFamily: 'monospace',
        fontSize: 12,
        fill: palette.spriteName,
        align: 'center',
      });
      this.nameText.anchor.set(0.5, 1);
      this.nameText.position.set(0, -M_H / 2 - 6);
      this.container.addChild(this.nameText);
    } else {
      this.nameText = null;
    }

    // Birth starts invisible+tiny+below; `update` eases it in.
    this.container.alpha = 0;
    this.container.scale.set(0.4);
  }

  /** Called once per frame by the renderer. `dt` and `time` are both in ms. */
  update(dt: number, time: number): void {
    if (this.deathState) {
      this.applyDeath(dt);
      return;
    }
    if (this.birthMs > 0) {
      this.applyBirth(dt);
      return;
    }
    this.applyIdle(dt, time);
  }

  // -------- World event hooks --------
  onStateChange(m: MeeseeksState): void {
    this.health = m.health;
  }
  onFreakingOut(): void {
    this.isFreakingOut = true;
  }
  onRecovered(): void {
    this.isFreakingOut = false;
  }

  startDeath(kind: DeathKind): void {
    this.deathState = kind;
    this.deathMs = 0;
  }

  isFinishedDying(): boolean {
    return this.deathState !== null && this.deathMs >= DEATH_MS;
  }

  refreshPalette(): void {
    const palette = getActivePalette();
    if (this.nameText) {
      this.nameText.style.fill = palette.spriteName;
    }
    if (!this.deathState && this.birthMs <= 0) {
      this.body.tint = this.baseColor(palette);
    }
  }

  /** Base color before freak/death modulation: planners are yellow, others follow health. */
  private baseColor(palette: Palette): number {
    return this.role === 'planner' ? palette.plannerTint : healthColor(this.health, palette);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }

  // -------- Animation phases --------

  private applyDeath(dt: number): void {
    this.deathMs += dt;
    const t = Math.min(1, this.deathMs / DEATH_MS);
    const palette = getActivePalette();
    const base = this.baseColor(palette);
    if (this.deathState === 'happy') {
      this.body.tint = lerpColor(base, palette.happy, t);
      this.container.scale.set(1 + 0.25 * t); // gentle pop
    } else {
      this.body.tint = lerpColor(base, palette.defeated, t);
    }
    this.container.alpha = 1 - t;
  }

  private applyBirth(dt: number): void {
    this.birthMs = Math.max(0, this.birthMs - dt);
    const t = 1 - this.birthMs / BIRTH_MS; // 0 -> 1
    const eased = 1 - Math.pow(1 - t, 3); // cubic-out
    this.container.alpha = eased;
    this.container.scale.set(0.4 + 0.6 * eased);
    const offset = this.birthOffsetY * (1 - eased);
    this.container.position.set(this.basePos.x, this.basePos.y + offset);
  }

  private applyIdle(dt: number, time: number): void {
    // Idempotent: birth animation ends here.
    this.container.alpha = 1;
    this.container.scale.set(1);

    // Ease freak intensity toward target (smooths recovery).
    const target = this.isFreakingOut ? 1 : 0;
    if (this.freakIntensity !== target) {
      const step = dt / FREAK_RAMP_MS;
      this.freakIntensity =
        this.freakIntensity < target
          ? Math.min(target, this.freakIntensity + step)
          : Math.max(target, this.freakIntensity - step);
    }

    // Color = base (health or plannerTint) + freak pulse on top.
    const palette = getActivePalette();
    const base = this.baseColor(palette);
    let tint = base;
    if (this.freakIntensity > 0) {
      const pulse = (Math.sin(time * 0.016) + 1) * 0.5; // ~2.5 Hz
      tint = lerpColor(base, palette.freak, pulse * this.freakIntensity);
    }
    this.body.tint = tint;

    // Position: bob + low-health tremor + freak shake.
    const bob =
      Math.sin(time * 0.001 * BOB_FREQ_HZ * Math.PI * 2 + this.phaseOffset) * BOB_AMPLITUDE_PX;
    let jitterX = 0;
    let jitterY = 0;
    if (this.health < TREMOR_HEALTH_TH) {
      const amt = (TREMOR_HEALTH_TH - this.health) / TREMOR_HEALTH_TH;
      jitterX += (Math.random() - 0.5) * 2 * amt;
      jitterY += (Math.random() - 0.5) * 2 * amt;
    }
    if (this.freakIntensity > 0) {
      jitterX += (Math.random() - 0.5) * 6 * this.freakIntensity;
      jitterY += (Math.random() - 0.5) * 6 * this.freakIntensity;
    }
    this.container.position.set(this.basePos.x + jitterX, this.basePos.y + bob + jitterY);
  }
}
