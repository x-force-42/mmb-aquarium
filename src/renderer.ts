/**
 * Renderer — owns a Pixi Application and reflects a World on screen.
 *
 * Doesn't know about transports or messages — only listens to the typed
 * events the World emits. Safe to swap with a stub in tests, and the
 * World/transport stack runs fine without any renderer at all.
 */

import { Application, BaseTexture, Container, Graphics, SCALE_MODES } from 'pixi.js';
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

// Block-pile tuning: 8×8 blocks pile up to the right of each Meeseeks.
const BLOCK_SIZE = 8;
const BLOCK_HALF = BLOCK_SIZE / 2;
const BLOCK_OFFSET_X = 28; // distance from sprite center to pile center
const BLOCK_BASE_Y_FROM_CENTER = 30 - BLOCK_HALF; // sprite half-height (30) - half block
const BLOCK_STACK_STEP = 9; // vertical pitch per block index
const BLOCK_JITTER_X = 4; // ±4 px lateral jitter
const BLOCK_JITTER_Y = 2; // ±2 px vertical jitter
const BLOCK_GRAVITY = 1200; // px/s²

interface BlockDrop {
  readonly gfx: Graphics;
  readonly targetX: number;
  readonly targetY: number;
  curY: number;
  vy: number;
}

interface BlockPile {
  /** Count of blocks already settled — drives the next finalY. */
  settled: number;
  /** Blocks currently falling toward their resting spot. */
  dropping: BlockDrop[];
  /** Settled-block graphics, retained so we can dispose them on Meeseeks death. */
  settledGfx: Graphics[];
}

export interface RendererOptions {
  width?: number;
  height?: number;
}

export class Renderer {
  readonly app: Application;
  private readonly blockLayer: Container;
  private readonly spriteLayer: Container;
  private readonly particleLayer: Container;
  private readonly sprites = new Map<string, MeeseeksSprite>();
  private readonly blockPiles = new Map<string, BlockPile>();
  private particles: Particle[] = [];
  private time = 0;

  constructor(container: HTMLElement, opts: RendererOptions = {}) {
    // Pixel-art ready: nearest-neighbor for every texture by default.
    BaseTexture.defaultOptions.scaleMode = SCALE_MODES.NEAREST;

    this.app = new Application({
      width: opts.width ?? CANVAS_W,
      height: opts.height ?? CANVAS_H,
      backgroundAlpha: 0, // CSS gradient lives on the parent div
      antialias: false, // crisp edges
      resolution: 1, // keep 1:1 so CSS `image-rendering: pixelated` works
      autoDensity: false,
    });
    container.appendChild(this.app.view as unknown as HTMLCanvasElement);

    // Layer order matters: blocks under sprites under particles.
    this.blockLayer = new Container();
    this.spriteLayer = new Container();
    this.particleLayer = new Container();
    this.app.stage.addChild(this.blockLayer);
    this.app.stage.addChild(this.spriteLayer);
    this.app.stage.addChild(this.particleLayer);

    this.app.ticker.add(() => this.tick(this.app.ticker.deltaMS));
  }

  /** Subscribe to a World. Renderer is single-bind by design. */
  bind(world: World): void {
    world.on('onBorn', (m) => this.handleBorn(m));
    world.on('onStateChange', (m) => this.handleStateChange(m));
    world.on('onDiedHappy', (m) => this.handleDeath(m, 'happy'));
    world.on('onDiedDefeated', (m) => this.handleDeath(m, 'defeated'));
    world.on('onFreakingOut', (m) => this.handleFreakingOut(m));
    world.on('onRecovered', (m) => this.handleRecovered(m));
    world.on('onBlockAdded', (m) => this.handleBlockAdded(m));
  }

  // Test-only inspection hooks (kept narrow so e2e can probe state).
  spriteCount(): number {
    return this.sprites.size;
  }
  hasSprite(id: string): boolean {
    return this.sprites.has(id);
  }

  /**
   * Horizontal pan in [-1, 1] based on the sprite's screen-x center.
   * Returns 0 if the sprite isn't in the scene (caller can treat as center).
   * Generic geometry — the audio layer happens to be the first consumer.
   */
  spritePanX(id: string): number {
    const sprite = this.sprites.get(id);
    if (!sprite) return 0;
    const half = this.app.screen.width / 2;
    if (half <= 0) return 0;
    const n = (sprite.basePos.x - half) / half;
    if (n < -1) return -1;
    if (n > 1) return 1;
    return n;
  }

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
    this.removeBlocks(m.id);
  }

  private handleBlockAdded(m: MeeseeksState): void {
    const sprite = this.sprites.get(m.id);
    if (!sprite) return;

    let pile = this.blockPiles.get(m.id);
    if (!pile) {
      pile = { settled: 0, dropping: [], settledGfx: [] };
      this.blockPiles.set(m.id, pile);
    }

    const bx = sprite.basePos.x;
    const by = sprite.basePos.y;
    const jitterX = Math.random() * (BLOCK_JITTER_X * 2) - BLOCK_JITTER_X;
    const jitterY = Math.random() * (BLOCK_JITTER_Y * 2) - BLOCK_JITTER_Y;
    const targetX = bx + BLOCK_OFFSET_X + jitterX;
    const targetY = by + BLOCK_BASE_Y_FROM_CENTER - pile.settled * BLOCK_STACK_STEP + jitterY;

    const gfx = new Graphics();
    const color = Math.floor(Math.random() * 0xffffff);
    gfx.beginFill(color);
    gfx.drawRect(-BLOCK_HALF, -BLOCK_HALF, BLOCK_SIZE, BLOCK_SIZE);
    gfx.endFill();
    gfx.position.set(targetX, by);
    this.blockLayer.addChild(gfx);

    pile.dropping.push({ gfx, targetX, targetY, curY: by, vy: 0 });
  }

  private removeBlocks(id: string): void {
    const pile = this.blockPiles.get(id);
    if (!pile) return;
    for (const drop of pile.dropping) {
      this.blockLayer.removeChild(drop.gfx);
      drop.gfx.destroy();
    }
    for (const gfx of pile.settledGfx) {
      this.blockLayer.removeChild(gfx);
      gfx.destroy();
    }
    this.blockPiles.delete(id);
  }

  // -------- Per-frame tick --------

  private tick(dt: number): void {
    this.time += dt;

    this.tickBlocks(dt);

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

  private tickBlocks(dt: number): void {
    const dtSec = dt / 1000;
    for (const pile of this.blockPiles.values()) {
      if (pile.dropping.length === 0) continue;
      let write = 0;
      for (const drop of pile.dropping) {
        drop.vy += BLOCK_GRAVITY * dtSec;
        drop.curY += drop.vy * dtSec;
        if (drop.curY >= drop.targetY) {
          drop.gfx.position.set(drop.targetX, drop.targetY);
          pile.settledGfx.push(drop.gfx);
          pile.settled += 1;
        } else {
          drop.gfx.position.set(drop.targetX, drop.curY);
          pile.dropping[write++] = drop;
        }
      }
      pile.dropping.length = write;
    }
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
