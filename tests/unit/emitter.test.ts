import { describe, it, expect, vi } from 'vitest';
import { Emitter } from '../../src/emitter';

interface Events {
  ping: (n: number) => void;
  pong: (msg: string) => void;
}

describe('Emitter', () => {
  it('calls subscribers with typed args', () => {
    const e = new Emitter<Events>();
    const cb = vi.fn();
    e.on('ping', cb);
    e.emit('ping', 42);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(42);
  });

  it('supports multiple subscribers in dispatch order', () => {
    const e = new Emitter<Events>();
    const calls: string[] = [];
    e.on('ping', () => calls.push('a'));
    e.on('ping', () => calls.push('b'));
    e.emit('ping', 1);
    expect(calls).toEqual(['a', 'b']);
  });

  it('isolates event channels', () => {
    const e = new Emitter<Events>();
    const ping = vi.fn();
    const pong = vi.fn();
    e.on('ping', ping);
    e.on('pong', pong);
    e.emit('pong', 'hi');
    expect(ping).not.toHaveBeenCalled();
    expect(pong).toHaveBeenCalledWith('hi');
  });

  it('off() removes a listener', () => {
    const e = new Emitter<Events>();
    const cb = vi.fn();
    e.on('ping', cb);
    e.off('ping', cb);
    e.emit('ping', 1);
    expect(cb).not.toHaveBeenCalled();
  });

  it('returns an unsubscribe handle from on()', () => {
    const e = new Emitter<Events>();
    const cb = vi.fn();
    const unsub = e.on('ping', cb);
    unsub();
    e.emit('ping', 1);
    expect(cb).not.toHaveBeenCalled();
  });

  it('an unsubscribe mid-dispatch is safe for the rest of the batch', () => {
    const e = new Emitter<Events>();
    const order: string[] = [];
    const second = vi.fn(() => order.push('second'));
    e.on('ping', () => { order.push('first'); e.off('ping', second); });
    e.on('ping', second);
    e.emit('ping', 1);
    // Snapshot dispatch: `second` still runs in this batch even though it
    // was unsubscribed during the first callback.
    expect(order).toEqual(['first', 'second']);
    // But the next emit no longer reaches it.
    e.emit('ping', 2);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('swallows handler exceptions and continues', () => {
    const e = new Emitter<Events>();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const second = vi.fn();
    e.on('ping', () => { throw new Error('boom'); });
    e.on('ping', second);
    e.emit('ping', 1);
    expect(second).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('listenerCount tracks subscribers', () => {
    const e = new Emitter<Events>();
    expect(e.listenerCount('ping')).toBe(0);
    const off = e.on('ping', () => {});
    expect(e.listenerCount('ping')).toBe(1);
    off();
    expect(e.listenerCount('ping')).toBe(0);
  });

  it('removeAll() clears every channel', () => {
    const e = new Emitter<Events>();
    const ping = vi.fn();
    const pong = vi.fn();
    e.on('ping', ping);
    e.on('pong', pong);
    e.removeAll();
    e.emit('ping', 1);
    e.emit('pong', 'x');
    expect(ping).not.toHaveBeenCalled();
    expect(pong).not.