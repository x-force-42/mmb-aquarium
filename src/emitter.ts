/**
 * Tiny typed event emitter.
 *
 * Generic over an event map (`{ eventName: (...args) => void }`) so that
 * both the listener arity and parameter types are checked at call sites.
 *
 * Why not Node's `EventEmitter` or the DOM's `EventTarget`?
 *  - EventEmitter isn't ergonomic in the browser and has untyped emits.
 *  - EventTarget forces wrapping every payload in a CustomEvent.
 *
 * This implementation is ~30 lines and easy to reason about in tests.
 */

// Self-referential constraint: each value of `TEvents` must be a callable
// returning void. Using a mapped type here (rather than `Record<string, ...>`)
// lets us pass *interfaces with fixed keys* like `WorldEvents`, which don't
// otherwise satisfy a `Record` index-signature constraint.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EventCallback = (...args: any[]) => void;

export class Emitter<TEvents extends { [K in keyof TEvents]: EventCallback }> {
  // Per-event listener lists. Stored as arrays so dispatch order is stable.
  private readonly listeners = new Map<keyof TEvents, EventCallback[]>();

  /** Subscribe; returns an unsubscribe function. */
  on<K extends keyof TEvents>(event: K, cb: TEvents[K]): () => void {
    let list = this.listeners.get(event);
    if (!list) {
      list = [];
      this.listeners.set(event, list);
    }
    list.push(cb as EventCallback);
    return () => this.off(event, cb);
  }

  off<K extends keyof TEvents>(event: K, cb: TEvents[K]): void {
    const list = this.listeners.get(event);
    if (!list) return;
    const idx = list.indexOf(cb as EventCallback);
    if (idx >= 0) list.splice(idx, 1);
  }

  /** Fire-and-forget. Errors in handlers are caught so one bad listener doesn't kill the rest. */
  emit<K extends keyof TEvents>(event: K, ...args: Parameters<TEvents[K]>): void {
    const list = this.listeners.get(event);
    if (!list || list.length === 0) return;
    // Snapshot — handlers may unsubscribe mid-dispatch.
    for (const cb of list.slice()) {
      try {
        (cb as (...a: Parameters<TEvents[K]>) => void)(...args);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`Emitter[${String(event)}] handler threw:`, err);
      }
    }
  }

  /** Test-only convenience. */
  listenerCount<K extends keyof TEvents>(event: K): number {
    return this.listeners.get(event)?.length ?? 0;
  }

  removeAll(): void {
    this.listeners.clear();
  }
}
