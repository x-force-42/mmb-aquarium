/**
 * Renderer — owns a Pixi Application and reflects a World on screen.
 *
 * Doesn't know about transports or messages — only listens to the typed
 * events the World emits. Safe to swap with a stub in tests, and the
 * World/transport stack runs fine without any renderer at all.
 */

import { Application, BaseTexture, Container, SCALE_MODES } from 'pixi.js';
import { COLOR_DEFEATED, COLOR_HAPPY } from './colors';
import { MeeseeksSprite, SPRITE_TUNING, type DeathKind, type SpritePosition } from './sprite';
import { Particle } from './particle';
import type { MeeseeksState } from './types';
import type { World } from './world';

const CANVAS_W = 1024;
const CANVAS_H = 640;

const SPAWN_MARGIN = 80;
const SPAWN_MIN_DIST = 70;
const SPAWN_MAX_TRIES = 30;

export interface RendererOptions {
  width?: number;
  height?: number;
}

export class Renderer {
  readonly app: Application;
  private readonly spriteLayer: Container;
  private readonly particleLayer: Container;
  private readonly sprites = new Map<string, MeeseeksSprite>();
  private particles: Particle[] = [];
  private time = 0;

  constructor(container: HTMLElement, opts: RendererOptions = {}) {
    // Pixel-art ready: nearest-neighbor for every texture by default.
    BaseTexture.defaultOptions.scaleMode = SCALE_MODES.NEAREST;

    this.app = new Application({
      width: opts.width ?? CANVAS_W,
      height: opts.height ?? CANVAS_H,
      backgroundAlpha: 0,    // CSS gradient lives on the parent div
      antialias: false,      // crisp edges
      resolution: 1,         // keep 1:1 so CSS `image-rendering: pixelated` works
      autoDensity: false,
    });
    container.appendChild(this.app.view as unknown as HTMLCanvasElement);

    this.spriteLayer = new Container();
    this.particleLayer = new Container();
    this.app.stage.addChild(this.spriteLayer);
    this.app.stage.addChild(this.particleLayer);

    this.app.ticker.add(() => this.tick(this.app.ticker.deltaMS));
  }

  /** Subscribe to a World. Renderer is single-bind by design. */
  bind(world: World): void {
    world.on('onBorn',         (m) => this.handleBorn(m));
    world.on('onStateChange',  (m) => this.handleStateChange(m));
    world.on('onDiedHappy',    (m) => this.handleDeath(m, 'happy'));
    world.on('onDiedDefeated', (m) => this.handleDeath(m, 'defeated'));
    world.on('onFreakingOut',  (m) => this.handleFreakingOut(m));
    world.on('onRecovered',    (m) => this.handleRecovered(m));
  }

  // Test-only inspection hooks (kept narrow so e2e can probe state).
  spriteCount(): number { return this.sprites.size; }
  hasSprite(id: string): boolean { return this.sprites.has(id); }

  destroy(): void {
    this.app.destroy(true, { children: true });
  }

  // -------- World event handlers --------

  private handleBorn(m: MeeseeksState): void {
    if (this.sprites.has(m.id)) return; // ignore duplicate (e.g. snapshot replay)
    const pos = this.findSpawnPosition();
    const sprite = new MeeseeksSprite(m, pos);
    this.spriteLayer.addChild(sprite.container);
    this.sprites.set(m.id, sprite);
  }

  private handleStateChange(m: MeeseeksState): void {
    this.sprites.get(m.id)?.onStateChange(m);
  }

  private handleFreakingOut(m: MeeseeksState): void {
    this.sprites.get(m.id)?.onFreakingOut();
  }

  private handleRecovered(m: MeeseeksState): void {
    this.sprites.get(m.id)?.onRecovered();
  }

  private handleDeath(m: MeeseeksState, kind: DeathKind): void {
    const sprite = this.sprites.get(m.id);
    if (!sprite) return;
    sprite.startDeath(kind);
    this.emitDeathParticles(sprite.container.position.x, sprite.container.position.y, kind);
  }

  // -------- Per-frame tick --------

  private tick(dt: number): void {
    this.time += dt;

    for (const s of this.sprites.values()) {
      s.update(dt, this.time);
    }
    for (const [id, s] of Array.from(this.sprites.entries())) {
      if (s.isFinishedDying()) {
        this.sprites.delete(id);
        this.spriteLayer.removeChild(s.container);
        s.destroy();
      }
    }

    for (const p of this.particles) {
      p.update(dt);
    }
    // In-place compaction: keep live particles, destroy & drop dead ones.
    let write = 0;
    for (const p of this.particles) {
      if (p.isDead()) {
        this.particleLayer.removeChild(p.gfx);
        p.destroy();
      } else {
        this.particles[write++] = p;
      }
    }
    this.particles.length = write;
  }

  // -------- Helpers --------

  private emitDeathParticles(cx: number, cy: number, kind: DeathKind): void {
    if (kind === 'happy') {
      for (let i = 0; i < 10; i++) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.6;
        const speed = 40 + Math.random() * 60;
        const p = new Particle(
          cx + (Math.random() - 0.5) * SPRITE_TUNING.M_W,
          cy + (Math.random() - 0.5) * SPRITE_TUNING.M_H,
          Math.cos(angle) * speed,
          Math.sin(angle) * speed,
          COLOR_HAPPY,
          900 + Math.random() * 400,
          3,
        );
        this.particles.push(p);
        this.particleLayer.addChild(p.gfx);
      }
    } else {
      const p = new Particle(cx, cy + SPRITE_TUNING.M_H / 4, 0, 50, COLOR_DEFEATED, 1200, 2);
      this.particles.push(p);
      this.particleLayer.addChild(p.gfx);
    }
  }

  private findSpawnPosition(): SpritePosition {
    const minX = SPAWN_MARGIN + SPRITE_TUNING.M_W / 2;
    const maxX = CANVAS_W - SPAWN_MARGIN - SPRITE_TUNING.M_W / 2;
    const minY = SPAWN_MARGIN + SPRITE_TUNING.M_H / 2;
    const maxY = CANVAS_H - SPAWN_MARGIN - SPRITE_TUNING.M_H / 2;

    let candidate: SpritePosition = { x: minX, y: minY };
    for (let attempt = 0; attempt < SPAWN_MAX_TRIES; attempt++) {
      candidate = {
        x: Math.floor(minX + Math.random() * (maxX - minX)),
        y: Math.floor(minY + Math.random() * (maxY - minY)),
      };
      let ok = true;
      for (const s of this.sprites.values()) {
        if (s.deathState) continue; // dying sprites don't reserve space
        const dx = candidate.x - s.basePos.x;
        const dy = candidate.y - s.basePos.y;
        if (dx * dx + dy * dy < SPAWN_MIN_DIST * SPAWN_MIN_DIST) {
          ok = false;
          break;
        }
      }
      if (ok) return candidate;
    }
    return candidate; // accept the last one when we run out of tries
  }
}
