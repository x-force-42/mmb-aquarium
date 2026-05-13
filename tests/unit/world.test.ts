import { describe, it, expect, vi, beforeEach } from 'vitest';
import { World } from '../../src/world';
import type { WorldEvents } from '../../src/types';

/**
 * Spy on every World event so tests can assert on the full event tape.
 * Returns an object with the mocks plus a `dispose` to detach them.
 */
function attachSpies(w: World): { spies: { [K in keyof WorldEvents]: ReturnType<typeof vi.fn> }, dispose: () => void } {
  const names: Array<keyof WorldEvents> = [
    'onBorn', 'onStateChange', 'onDiedHappy', 'onDiedDefeated', 'onFreakingOut', 'onRecovered',
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
  beforeEach(() => { world = new World(); });

  describe('born', () => {
    it('creates a Meeseeks at full health and emits onBorn', () => {
      const { spies } = attachSpies(world);
      world.handleMessage({ type: 'event', id: 'a', kind: 'born', name: 'Bob', task: 'jar' });
      expect(world.size()).toBe(1);
      expect(world.get('a')).toEqual({ id: 'a', health: 1, isFreakingOut: false, name: 'Bob', task: 'jar' });
      expect(spies.onBorn).toHaveBeenCalledTimes(1);
      expect(spies.onBorn).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'a', health: 1, isFreakingOut: false, name: 'Bob', task: 'jar' }),
      );
    });

    it('coerces missing name/task to null', () => {
      world.handleMessage({ type: 'event', id: 'b', kind: 'born' });
      expect(world.get('b')).toEqual({ id: 'b', health: 1, isFreakingOut: false, name: null, task: null });
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
        meeseeks: [
          { id: 'x', health: 0.7, isFreakingOut: true, name: 'X' },
          { id: 'y' },
        ],
      });
      expect(spies.onBorn).toHaveBeenCalledTimes(2);
      expect(world.size()).toBe(2);
      expect(world.get('x')).toEqual({ id: 'x', health: 0.7, isFreakingOut: true, name: 'X', task: null });
      expect(world.get('y')).toEqual({ id: 'y', health: 1, isFreakingOut: false, name: null, task: null });
    });

    it('clamps health in snapshot entries', () => {
      world.handleMessage({
        type: 'snapshot',
        meeseeks: [{ id: 'z', health: 2 }],
      });
      expect(world.get('z')?.health).toBe(1);
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
      world.handleMessage({ type: 'event', id: 'b', kind: 'freaking_out' }