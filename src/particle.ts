/**
 * Particle — a single floating dot used by the death effects.
 * Drawn as a small rect so it stays pixelated.
 */

import { Graphics } from 'pixi.js';

export class Particle {
  readonly gfx: Graphics;
  private readonly vx: number;
  private readonly vy: number;
  private life: number;
  private readonly maxLife: number;

  constructor(
    x: number, y: number,
    vx: number, vy: number,
    color: number,
    lifeMs: number,
    sizePx: number,
  ) {
    this.vx = vx;
    this.vy = vy;
    this.life = lifeMs;
    this.maxLife = lifeMs;
    this.gfx = new Graphics();
    this.gfx.beginFill(color);
    this.gfx.drawRect(-sizePx / 2, -sizePx / 2, sizePx, sizePx);
    this.gfx.endFill();
    this.gfx.position.set(x, y);
  }

  update(dt: number): void {
    const secs = dt / 1000;
    this.gfx.position.x += this.vx * secs;
    this.gfx.position.y += this.vy * secs;
    this.life -= dt;
    this.gfx.alpha = Math.max(0, this.life / this.maxLife);
  }

  isDead(): boolean { return this.life <= 0; }
  destroy(): void { this.gfx.destroy(); }
}
