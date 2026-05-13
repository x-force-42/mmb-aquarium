/**
 * Transport layer — anything that produces `AppMessage`s.
 *
 * Public contract:
 *   onMessage(cb): subscribe; returns an unsubscribe fn.
 *
 * Two implementations:
 *   - SimulatorTransport — wired to UI buttons (and directly callable in tests).
 *   - WebSocketTransport — receives JSON over the wire (stub for v1).
 *
 * Neither knows anything about the World or the renderer. main.ts wires them.
 */

import type {
  AppMessage,
  EventKind,
  MeeseeksId,
  MeeseeksSnapshotEntry,
  MeeseeksState,
  WorldQuery,
} from './types';

// ---------------------------------------------------------------------------
// Common interface + base
// ---------------------------------------------------------------------------
export interface Transport {
  onMessage(cb: (msg: AppMessage) => void): () => void;
}

abstract class TransportBase implements Transport {
  private readonly handlers: Array<(msg: AppMessage) => void> = [];

  onMessage(cb: (msg: AppMessage) => void): () => void {
    this.handlers.push(cb);
    return () => {
      const i = this.handlers.indexOf(cb);
      if (i >= 0) this.handlers.splice(i, 1);
    };
  }

  protected emit(msg: AppMessage): void {
    for (const cb of this.handlers.slice()) {
      try {
        cb(msg);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Transport handler threw:', err);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// SimulatorTransport
// ---------------------------------------------------------------------------
export interface SimulatorButtonIds {
  born: string;
  diedHappy: string;
  diedDefeated: string;
  freakingOut: string;
  recovered: string;
  decay: string;
}

/**
 * Optional dependency injection — tests pass deterministic functions.
 * In production, defaults pull from `Math.random` and rotate ids monotonically.
 */
export interface SimulatorDeps {
  random?: () => number;
  idFactory?: () => MeeseeksId;
}

const DEFAULT_NAMES: readonly string[] = [
  'Mr. Meeseeks',
  'Mrs. Meeseeks',
  'Tall Meeseeks',
  'Squat Meeseeks',
  'Shouty Meeseeks',
];

const DEFAULT_TASKS: readonly string[] = [
  'two-stroke my golf swing',
  'help with my taxes',
  'open this jar',
  'reformat the spreadsheet',
  'find my keys',
  'become Mr. Meeseeks',
];

/**
 * Drives the world from button clicks (or direct method calls from tests).
 *
 * Methods are intentionally public so the e2e suite can poke them via
 * the global `__aquarium` hook, and unit tests can call them without DOM.
 */
export class SimulatorTransport extends TransportBase {
  private readonly query: WorldQuery;
  private readonly rand: () => number;
  private readonly nextId: () => MeeseeksId;

  constructor(query: WorldQuery, deps: SimulatorDeps = {}) {
    super();
    this.query = query;
    this.rand = deps.random ?? Math.random;
    if (deps.idFactory) {
      this.nextId = deps.idFactory;
    } else {
      let counter = 1;
      this.nextId = () => `m${counter++}`;
    }
  }

  // ----- Imperative actions (used by buttons and tests) -----

  born(): void {
    const name = this.pick(DEFAULT_NAMES);
    const task = this.pick(DEFAULT_TASKS);
    this.emit({ type: 'event', id: this.nextId(), kind: 'born', name, task });
  }

  killHappy(): void {
    this.randomEvent('died_happy', () => this.query.getAlive());
  }

  giveUp(): void {
    this.randomEvent('died_defeated', () => this.query.getAlive());
  }

  triggerFreakOut(): void {
    this.randomEvent('freaking_out', () => this.query.getAlive().filter((m) => !m.isFreakingOut));
  }

  recover(): void {
    this.randomEvent('recovered', () => this.query.getFreakingOut());
  }

  decayAll(amount: number = 0.1): void {
    for (const m of this.query.getAll()) {
      const next = Math.max(0, +(m.health - amount).toFixed(3));
      this.emit({ type: 'state', id: m.id, health: next });
    }
  }

  /** Useful as an explicit start-of-life signal. */
  sendInitialSnapshot(meeseeks: ReadonlyArray<MeeseeksSnapshotEntry> = []): void {
    this.emit({ type: 'snapshot', meeseeks });
  }

  // ----- DOM wiring (kept separate from the actions above) -----

  bindButtons(ids: SimulatorButtonIds): void {
    const wire = (elementId: string, handler: () => void): void => {
      const el = document.getElementById(elementId);
      if (!el) throw new Error(`SimulatorTransport: missing button #${elementId}`);
      el.addEventListener('click', handler);
    };
    wire(ids.born,         () => this.born());
    wire(ids.diedHappy,    () => this.killHappy());
    wire(ids.diedDefeated, () => this.giveUp());
    wire(ids.freakingOut,  () => this.triggerFreakOut());
    wire(ids.recovered,    () => this.recover());
    wire(ids.decay,        () => this.decayAll());
  }

  // ----- Internals -----

  private randomEvent(
    kind: Exclude<EventKind, 'born'>,
    source: () => ReadonlyArray<MeeseeksState>,
  ): void {
    const list = source();
    if (list.length === 0) return;
    const target = this.pick(list);
    this.emit({ type: 'event', id: target.id, kind });
  }

  private pick<T>(arr: ReadonlyArray<T>): T {
    // Safe: callers only invoke this with non-empty arrays.
    const idx = Math.floor(this.rand() * arr.length);
    // `noUncheckedIndexedAccess` makes TS treat arr[idx] as `T | undefined`.
    const item = arr[idx];
    if (item === undefined) throw new Error('SimulatorTransport.pick: empty array');
    return item;
  }
}

// ---------------------------------------------------------------------------
// WebSocketTransport — receives JSON; ready to plug in when a server exists.
// ---------------------------------------------------------------------------
export class WebSocketTransport extends TransportBase {
  private ws: WebSocket | null = null;

  constructor(public readonly url: string) {
    super();
  }

  connect(): void {
    if (this.ws) return;
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener('message', (ev: MessageEvent) => {
      try {
        const parsed: unknown = JSON.parse(String(ev.data));
        if (isAppMessage(parsed)) {
          this.emit(parsed);
        } else {
          // eslint-disable-next-line no-console
          console.warn('WebSocketTransport: invalid message shape', parsed);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('WebSocketTransport: bad JSON payload', err);
      }
    });
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}

/** Runtime guard — keeps untrusted wire payloads out of the World. */
export function isAppMessage(x: unknown): x is AppMessage {
  if (!x || typeof x !== 'object') return false;
  const m = x as { type?: unknown };
  return m.type === 'snapshot' || m.type === 'state' || m.type === 'event';
}
