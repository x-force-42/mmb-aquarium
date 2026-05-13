import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SimulatorTransport, isAppMessage, WebSocketTransport } from '../../src/transport';
import type { AppMessage, MeeseeksState, WorldQuery } from '../../src/types';

/**
 * Build a query stub backed by an in-memory array so tests can rehearse
 * the "world view" the simulator sees, without dragging in the real World.
 */
function makeQuery(initial: MeeseeksState[] = []): WorldQuery & { set: (xs: MeeseeksState[]) => void } {
  let items = initial.slice();
  return {
    getAll: () => items.map((m) => ({ ...m })),
    getAlive: () => items.map((m) => ({ ...m })),
    getFreakingOut: () => items.filter((m) => m.isFreakingOut).map((m) => ({ ...m })),
    set(xs) { items = xs.slice(); },
  };
}

/** Convenience: subscribe and return the accumulated message tape. */
function tape(t: SimulatorTransport): AppMessage[] {
  const out: AppMessage[] = [];
  t.onMessage((m) => out.push(m));
  return out;
}

describe('SimulatorTransport', () => {
  let query: ReturnType<typeof makeQuery>;
  beforeEach(() => {
    query = makeQuery();
  });

  it('emits a born event with a fresh id, name, and task', () => {
    const sim = new SimulatorTransport(query, {
      random: () => 0, // pick first name & task deterministically
      idFactory: () => 'fixed-id',
    });
    const msgs = tape(sim);
    sim.born();
    expect(msgs).toEqual([
      { type: 'event', id: 'fixed-id', kind: 'born', name: 'Mr. Meeseeks', task: 'two-stroke my golf swing' },
    ]);
  });

  it('auto-increments ids when no factory is supplied', () => {
    const sim = new SimulatorTransport(query, { random: () => 0 });
    const msgs = tape(sim);
    sim.born();
    sim.born();
    expect((msgs[0] as { id: string }).id).toBe('m1');
    expect((msgs[1] as { id: string }).id).toBe('m2');
  });

  it('killHappy picks a random alive Meeseeks and emits died_happy', () => {
    query.set([
      { id: 'a', health: 1, isFreakingOut: false, name: null, task: null },
      { id: 'b', health: 1, isFreakingOut: false, name: null, task: null },
    ]);
    const sim = new SimulatorTransport(query, { random: () => 0.5 }); // -> index 1
    const msgs = tape(sim);
    sim.killHappy();
    expect(msgs).toEqual([{ type: 'event', id: 'b', kind: 'died_happy' }]);
  });

  it('killHappy is a no-op when the world is empty', () => {
    const sim = new SimulatorTransport(query);
    const msgs = tape(sim);
    sim.killHappy();
    expect(msgs).toEqual([]);
  });

  it('triggerFreakOut only considers non-freaking Meeseeks', () => {
    query.set([
      { id: 'a', health: 1, isFreakingOut: true,  name: null, task: null },
      { id: 'b', health: 1, isFreakingOut: false, name: null, task: null },
    ]);
    const sim = new SimulatorTransport(query, { random: () => 0 });
    const msgs = tape(sim);
    sim.triggerFreakOut();
    expect(msgs).toEqual([{ type: 'event', id: 'b', kind: 'freaking_out' }]);
  });

  it('recover picks from freaking only', () => {
    query.set([
      { id: 'a', health: 1, isFreakingOut: true,  name: null, task: null },
      { id: 'b', health: 1, isFreakingOut: false, name: null, task: null },
    ]);
    const sim = new SimulatorTransport(query, { random: () => 0 });
    const msgs = tape(sim);
    sim.recover();
    expect(msgs).toEqual([{ type: 'event', id: 'a', kind: 'recovered' }]);
  });

  it('decayAll emits a state msg per Meeseeks with health reduced and floored at 0', () => {
    query.set([
      { id: 'a', health: 1.0, isFreakingOut: false, name: null, task: null },
      { id: 'b', health: 0.05, isFreakingOut: false, name: null, task: null },
    ]);
    const sim = new SimulatorTransport(query);
    const msgs = tape(sim);
    sim.decayAll(); // default 0.1
    expect(msgs).toEqual([
      { type: 'state', id: 'a', health: 0.9 },
      { type: 'state', id: 'b', health: 0 },
    ]);
  });

  it('decayAll respects a custom amount', () => {
    query.set([{ id: 'a', health: 0.7, isFreakingOut: false, name: null, task: null }]);
    const sim = new SimulatorTransport(query);
    const msgs = tape(sim);
    sim.decayAll(0.2);
    expect(msgs).toEqual([{ type: 'state', id: 'a', health: 0.5 }]);
  });

  it('onMessage subscribers can unsubscribe', () => {
    const sim = new SimulatorTransport(query, { random: () => 0 });
    const cb = vi.fn();
    const off = sim.onMessage(cb);
    sim.born();
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    sim.born();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('handler errors do not break other subscribers', () => {
    const sim = new SimulatorTransport(query);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const second = vi.fn();
    sim.onMessage(() => { throw new Error('nope'); });
    sim.onMessage(second);
    sim.born();
    expect(second).toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  describe('bindButtons (DOM)', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <button id="b1"></button>
        <button id="b2"></button>
        <button id="b3"></button>
        <button id="b4"></button>
        <button id="b5"></button>
        <button id="b6"></button>
      `;
    });

    it('wires click events to the right actions', () => {
      const sim = new SimulatorTransport(query, { random: () => 0 });
      const msgs = tape(sim);
      sim.bindButtons({ born: 'b1', diedHappy: 'b2', diedDefeated: 'b3', freakingOut: 'b4', recovered: 'b5', decay: 'b6' });

      document.getElementById('b1')!.click(); // born
      expect(msgs.at(-1)).toMatchObject({ type: 'event', kind: 'born' });
    });

    it('throws if a required button is missing', () => {
      const sim = new SimulatorTransport(query);
      expect(() => sim.bindButtons({
        born: 'missing', diedHappy: 'b2', diedDefeated: 'b3', freakingOut: 'b4', recovered: 'b5', decay: 'b6',
      })).toThrow(/missing button/);
    });
  });
});

describe('isAppMessage', () => {
  it('accepts known message shapes', () => {
    expect(isAppMessage({ type: 'snapshot', meeseeks: [] })).toBe(true);
    expect(isAppMessage({ type: 'state', id: 'a', health: 0.5 })).toBe(true);
    expect(isAppMessage({ type: 'event', id: 'a', kind: 'born' })).toBe(true);
  });

  it('rejects unknown / malformed shapes', () => {
    expect(isAppMessage(null)).toBe(false);
    expect(isAppMessage('hello')).toBe(false);
    expect(isAppMessage({})).toBe(false);
    expect(isAppMessage({ type: 'nope' })).toBe(false);
  });
});

describe('WebSocketTransport', () => {
  it('stores the url and exposes it readonly', () => {
    const t = new WebSocketTransport('ws://localhost:9999');
    expect(t.url).toBe('ws://localhost:9999');
  });
  // Live socket behavior is left to integration tests when there's a server.
});
