import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MeeseeksState } from '../../src/types';

// happy-dom doesn't ship a canvas implementation, and Pixi v7's `Text`
// constructor reaches for a 2d context. We don't render anything in these
// tests — we only need the class to wire up children/state — so we stub
// the bits of pixi.js the sprite touches.
vi.mock('pixi.js', () => {
  class Point {
    x = 0;
    y = 0;
    set(x: number, y: number) {
      this.x = x;
      this.y = y;
    }
  }
  class DisplayObject {
    alpha = 1;
    position = new Point();
    scale = new Point();
    parent: Container | null = null;
    destroyed = false;
    constructor() {
      this.scale.set(1, 1);
    }
    destroy() {
      this.destroyed = true;
    }
  }
  class Container extends DisplayObject {
    children: DisplayObject[] = [];
    addChild<T extends DisplayObject>(c: T): T {
      this.children.push(c);
      c.parent = this;
      return c;
    }
    removeChild<T extends DisplayObject>(c: T): T {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
      return c;
    }
    override destroy(_opts?: { children?: boolean }) {
      if (_opts?.children) {
        for (const c of this.children) c.destroy();
      }
      super.destroy();
    }
  }
  class Graphics extends DisplayObject {
    tint = 0xffffff;
    beginFill() {
      return this;
    }
    drawRect() {
      return this;
    }
    endFill() {
      return this;
    }
  }
  class Text extends DisplayObject {
    text: string;
    anchor = new Point();
    style: unknown;
    constructor(text: string, style?: unknown) {
      super();
      this.text = text;
      this.style = style;
    }
  }
  return { Container, Graphics, Text };
});

// Imported after the mock so the sprite picks up our stub.
import { MeeseeksSprite, SPRITE_TUNING } from '../../src/sprite';

function model(overrides: Partial<MeeseeksState> = {}): MeeseeksState {
  return {
    id: 'm1',
    health: 1,
    isFreakingOut: false,
    name: 'Test Meeseeks',
    task: null,
    blocks: 0,
    role: 'unknown',
    ...overrides,
  };
}

interface MockText {
  text?: string;
  alpha: number;
  destroyed: boolean;
}

function findNameText(s: MeeseeksSprite): MockText | null {
  // The body Graphics is also a child; the name Text is the one that owns
  // a `text` property, which we exposed in the mock. Return the live ref
  // so callers can observe state mutations across update/destroy calls.
  const c = s.container as unknown as { children: MockText[] };
  return c.children.find((ch) => typeof ch.text === 'string') ?? null;
}

describe('MeeseeksSprite name label', () => {
  let basePos: { x: number; y: number };
  beforeEach(() => {
    basePos = { x: 100, y: 100 };
  });

  it('creates a name label when model.name is truthy', () => {
    const s = new MeeseeksSprite(model({ name: 'Rick' }), basePos);
    const t = findNameText(s);
    expect(t).not.toBeNull();
    expect(t!.alpha).toBe(1);
    expect(t!.destroyed).toBe(false);
  });

  it('does not create a name label when model.name is null', () => {
    const s = new MeeseeksSprite(model({ name: null }), basePos);
    expect(findNameText(s)).toBeNull();
  });

  it('label persists at full alpha after a long simulated lifetime', () => {
    const s = new MeeseeksSprite(model({ name: 'Persistent' }), basePos);

    // Run birth to completion, then 5 seconds of idle frames at ~60Hz.
    const dt = 16.67;
    const totalMs = SPRITE_TUNING.BIRTH_MS + 5_000;
    let elapsed = 0;
    let time = 0;
    while (elapsed < totalMs) {
      s.update(dt, time);
      elapsed += dt;
      time += dt;
    }

    const t = findNameText(s);
    expect(t).not.toBeNull();
    expect(t!.alpha).toBe(1);
    expect(t!.destroyed).toBe(false);
  });

  it('label is destroyed together with the sprite container on destroy()', () => {
    const s = new MeeseeksSprite(model({ name: 'Doomed' }), basePos);
    const before = findNameText(s);
    expect(before).not.toBeNull();

    s.destroy();

    expect(before!.destroyed).toBe(true);
  });

  it('label survives the full death animation as a container child', () => {
    const s = new MeeseeksSprite(model({ name: 'Dying' }), basePos);

    // Finish birth.
    let time = 0;
    for (let i = 0; i < 60; i++) {
      s.update(16.67, time);
      time += 16.67;
    }

    s.startDeath('happy');
    while (!s.isFinishedDying()) {
      s.update(50, time);
      time += 50;
    }

    // Label is still parented to the container — the renderer reaps the
    // whole container after death, taking the label with it.
    const t = findNameText(s);
    expect(t).not.toBeNull();
    expect(t!.destroyed).toBe(false);
  });
});
