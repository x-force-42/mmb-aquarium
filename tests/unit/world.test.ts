import { describe, it, expect, vi, beforeEach } from 'vitest';
import { World } from '../../src/world';
import type { WorldEvents } from '../../src/types';

/**
 * Spy on every World event so tests can assert on the full event tape.
 * Returns an object with the mocks plus a `dispose` to detach them.
 */
function attachSpies(w: World): {
  spies: { [K in keyof WorldEvents]: ReturnType<typeof vi.fn> };
  dispose: () => void;
} {
  const names: Array<keyof WorldEvents> = [
    'onBorn',
    'onStateChange',
    'onDiedHappy',
    'onDiedDefeated',
    'onFreakingOut',
    'onRecovered',
    'onBlockAdded',
  ];
  const spies = {} as { [K in keyof WorldEvents]: ReturnType<typeof vi.fn> };
  const offs: Array<() => void> = [];
  for (const name of names) {
    const fn = vi.fn();
    spies[name] = fn;
    offs.push(w.on(name, fn as WorldEvents[typeof name]));
  }
  return { spies, dispose: () => offs.forEach((o) => o()) };
}

describe('World', () => {
  let world: World;
  beforeEach(() => {
    world = new World();
  });

  describe('born', () => {
    it('creates a Meeseeks at full health and emits onBorn', () => {
      const { spies } = attachSpies(world);
      world.handleMessage({ type: 'event', id: 'a', kind: 'born', name: 'Bob', task: 'jar' });
      expect(world.size()).toBe(1);
      expect(world.get('a')).toEqual({
        id: 'a',
        health: 1,
        isFreakingOut: false,
        name: 'Bob',
        task: 'jar',
        blocks: 0,
        role: 'unknown',
      });
      expect(spies.onBorn).toHaveBeenCalledTimes(1);
      expect(spies.onBorn).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'a',
          health: 1,
          isFreakingOut: false,
          name: 'Bob',
          task: 'jar',
        }),
      );
    });

    it('coerces missing name/task to null', () => {
      world.handleMessage({ type: 'event', id: 'b', kind: 'born' });
      expect(world.get('b')).toEqual({
        id: 'b',
        health: 1,
        isFreakingOut: false,
        name: null,
        task: null,
        blocks: 0,
        role: 'unknown',
      });
    });

    it('assigns role "planner" for [W] prefix name', () => {
      world.handleMessage({
        type: 'event',
        id: 'w1',
        kind: 'born',
        name: '[W] worker-core-999',
      });
      expect(world.get('w1')?.role).toBe('planner');
    });

    it('assigns role "atomic" for [A] prefix name', () => {
      world.handleMessage({
        type: 'event',
        id: 'a1',
        kind: 'born',
        name: '[A] atomic-task-A1',
      });
      expect(world.get('a1')?.role).toBe('atomic');
    });

    it('assigns role "unknown" for name without prefix', () => {
      world.handleMessage({ type: 'event', id: 'u1', kind: 'born', name: 'free-name' });
      expect(world.get('u1')?.role).toBe('unknown');
    });

    it('assigns role "unknown" when name is absent', () => {
      world.handleMessage({ type: 'event', id: 'u2', kind: 'born' });
      expect(world.get('u2')?.role).toBe('unknown');
    });

    it('ignores duplicate born for an existing id', () => {
      world.handleMessage({ type: 'event', id: 'a', kind: 'born' });
      const { spies } = attachSpies(world);
      world.handleMessage({ type: 'event', id: 'a', kind: 'born' });
      expect(spies.onBorn).not.toHaveBeenCalled();
      expect(world.size()).toBe(1);
    });
  });

  describe('state', () => {
    beforeEach(() => world.handleMessage({ type: 'event', id: 'a', kind: 'born' }));

    it('emits onStateChange with previous health', () => {
      const { spies } = attachSpies(world);
      world.handleMessage({ type: 'state', id: 'a', health: 0.5 });
      expect(spies.onStateChange).toHaveBeenCalledTimes(1);
      expect(spies.onStateChange).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'a', health: 0.5 }),
        1,
      );
      expect(world.get('a')?.health).toBe(0.5);
    });

    it('is a no-op when value did not change', () => {
      world.handleMessage({ type: 'state', id: 'a', health: 0.5 });
      const { spies } = attachSpies(world);
      world.handleMessage({ type: 'state', id: 'a', health: 0.5 });
      expect(spies.onStateChange).not.toHaveBeenCalled();
    });

    it('clamps health to [0, 1]', () => {
      world.handleMessage({ type: 'state', id: 'a', health: -5 });
      expect(world.get('a')?.health).toBe(0);
      world.handleMessage({ type: 'state', id: 'a', health: 99 });
      expect(world.get('a')?.health).toBe(1);
    });

    it('rejects NaN by clamping to 0', () => {
      world.handleMessage({ type: 'state', id: 'a', health: Number.NaN });
      expect(world.get('a')?.health).toBe(0);
    });

    it('drops updates for unknown ids without emitting', () => {
      const { spies } = attachSpies(world);
      world.handleMessage({ type: 'state', id: 'ghost', health: 0.4 });
      expect(spies.onStateChange).not.toHaveBeenCalled();
    });
  });

  describe('freak-out / recover', () => {
    beforeEach(() => world.handleMessage({ type: 'event', id: 'a', kind: 'born' }));

    it('flips into freaking_out and emits once', () => {
      const { spies } = attachSpies(world);
      world.handleMessage({ type: 'event', id: 'a', kind: 'freaking_out' });
      expect(spies.onFreakingOut).toHaveBeenCalledOnce();
      expect(world.get('a')?.isFreakingOut).toBe(true);
    });

    it('ignores freak_out when already freaking', () => {
      world.handleMessage({ type: 'event', id: 'a', kind: 'freaking_out' });
      const { spies } = attachSpies(world);
      world.handleMessage({ type: 'event', id: 'a', kind: 'freaking_out' });
      expect(spies.onFreakingOut).not.toHaveBeenCalled();
    });

    it('recovered exits freak-out and emits', () => {
      world.handleMessage({ type: 'event', id: 'a', kind: 'freaking_out' });
      const { spies } = attachSpies(world);
      world.handleMessage({ type: 'event', id: 'a', kind: 'recovered' });
      expect(spies.onRecovered).toHaveBeenCalledOnce();
      expect(world.get('a')?.isFreakingOut).toBe(false);
    });

    it('recovered is a no-op when not freaking', () => {
      const { spies } = attachSpies(world);
      world.handleMessage({ type: 'event', id: 'a', kind: 'recovered' });
      expect(spies.onRecovered).not.toHaveBeenCalled();
    });
  });

  describe('death', () => {
    beforeEach(() => world.handleMessage({ type: 'event', id: 'a', kind: 'born' }));

    it('died_happy removes from world and emits', () => {
      const { spies } = attachSpies(world);
      world.handleMessage({ type: 'event', id: 'a', kind: 'died_happy' });
      expect(spies.onDiedHappy).toHaveBeenCalledOnce();
      expect(world.size()).toBe(0);
      expect(world.get('a')).toBeNull();
    });

    it('died_defeated removes from world and emits', () => {
      const { spies } = attachSpies(world);
      world.handleMessage({ type: 'event', id: 'a', kind: 'died_defeated' });
      expect(spies.onDiedDefeated).toHaveBeenCalledOnce();
      expect(world.size()).toBe(0);
    });

    it('unknown ids are silently ignored on death', () => {
      const { spies } = attachSpies(world);
      world.handleMessage({ type: 'event', id: 'ghost', kind: 'died_happy' });
      expect(spies.onDiedHappy).not.toHaveBeenCalled();
    });
  });

  describe('snapshot', () => {
    it('wipes existing state and re-emits onBorn for incoming entries', () => {
      world.handleMessage({ type: 'event', id: 'a', kind: 'born' });
      world.handleMessage({ type: 'event', id: 'b', kind: 'born' });
      const { spies } = attachSpies(world);
      world.handleMessage({
        type: 'snapshot',
        meeseeks: [{ id: 'x', health: 0.7, isFreakingOut: true, name: 'X' }, { id: 'y' }],
      });
      expect(spies.onBorn).toHaveBeenCalledTimes(2);
      expect(world.size()).toBe(2);
      expect(world.get('x')).toEqual({
        id: 'x',
        health: 0.7,
        isFreakingOut: true,
        name: 'X',
        task: null,
        blocks: 0,
        role: 'unknown',
      });
      expect(world.get('y')).toEqual({
        id: 'y',
        health: 1,
        isFreakingOut: false,
        name: null,
        task: null,
        blocks: 0,
        role: 'unknown',
      });
    });

    it('clamps health in snapshot entries', () => {
      world.handleMessage({
        type: 'snapshot',
        meeseeks: [{ id: 'z', health: 2 }],
      });
      expect(world.get('z')?.health).toBe(1);
    });
  });

  describe('block_added', () => {
    beforeEach(() => world.handleMessage({ type: 'event', id: 'a', kind: 'born' }));

    it('increments blocks and emits onBlockAdded once', () => {
      const { spies } = attachSpies(world);
      world.handleMessage({ type: 'event', id: 'a', kind: 'block_added' });
      expect(world.get('a')?.blocks).toBe(1);
      expect(spies.onBlockAdded).toHaveBeenCalledTimes(1);
      expect(spies.onBlockAdded).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'a', blocks: 1 }),
      );
    });

    it('accumulates over many calls', () => {
      for (let i = 0; i < 5; i++) {
        world.handleMessage({ type: 'event', id: 'a', kind: 'block_added' });
      }
      expect(world.get('a')?.blocks).toBe(5);
    });

    it('caps at 40; extra block_added events are no-ops', () => {
      const { spies } = attachSpies(world);
      for (let i = 0; i < 45; i++) {
        world.handleMessage({ type: 'event', id: 'a', kind: 'block_added' });
      }
      expect(world.get('a')?.blocks).toBe(40);
      expect(spies.onBlockAdded).toHaveBeenCalledTimes(40);
    });

    it('drops block_added for unknown ids without side effects', () => {
      const { spies } = attachSpies(world);
      world.handleMessage({ type: 'event', id: 'ghost', kind: 'block_added' });
      expect(spies.onBlockAdded).not.toHaveBeenCalled();
      expect(world.get('ghost')).toBeNull();
    });

    it('leaves health and isFreakingOut untouched', () => {
      world.handleMessage({ type: 'state', id: 'a', health: 0.42 });
      world.handleMessage({ type: 'event', id: 'a', kind: 'freaking_out' });
      world.handleMessage({ type: 'event', id: 'a', kind: 'block_added' });
      const m = world.get('a');
      expect(m?.health).toBe(0.42);
      expect(m?.isFreakingOut).toBe(true);
      expect(m?.blocks).toBe(1);
    });
  });

  describe('queries', () => {
    it('returns immutable shallow copies', () => {
      world.handleMessage({ type: 'event', id: 'a', kind: 'born' });
      const all = world.getAll();
      all[0]!.health = 0;
      expect(world.get('a')?.health).toBe(1);
    });

    it('getFreakingOut filters correctly', () => {
      world.handleMessage({ type: 'event', id: 'a', kind: 'born' });
      world.handleMessage({ type: 'event', id: 'b', kind: 'born' });
      world.handleMessage({ type: 'event', id: 'b', kind: 'freaking_out' });
      expect(world.getFreakingOut().map((m) => m.id)).toEqual(['b']);
    });
  });
});
