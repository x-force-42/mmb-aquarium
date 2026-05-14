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
    wire(ids.born, () => this.born());
    wire(ids.diedHappy, () => this.killHappy());
    wire(ids.diedDefeated, () => this.giveUp());
    wire(ids.freakingOut, () => this.triggerFreakOut());
    wire(ids.recovered, () => this.recover());
    wire(ids.decay, () => this.decayAll());
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
// WebSocketTransport — receives JSON frames from a producer-facing WS endpoint
// (typically the local relay; see `scripts/ws-relay.mjs`). Reconnects on
// disconnect with exponential backoff + jitter; never gives up.
// ---------------------------------------------------------------------------
export class WebSocketTransport extends TransportBase {
  /** Backoff schedule in seconds; final value is reused indefinitely. */
  private static readonly RECONNECT_DELAYS_S: readonly number[] = [1, 2, 5, 10, 30];
  /** ±20 % jitter so a thundering herd of reloads doesn't pile in at the same tick. */
  private static readonly JITTER = 0.2;

  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped on every scheduled retry; reset only on a successful `open`. */
  private reconnectAttempt = 0;
  /** True once `close()` was called; suppresses the auto-reconnect path. */
  private intentionalClose = false;

  constructor(public readonly url: string) {
    super();
  }

  connect(): void {
    if (this.ws) return;
    this.intentionalClose = false;
    this.openSocket();
  }

  close(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  private openSocket(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.addEventListener('open', () => {
      console.warn(`WebSocketTransport: connected to ${this.url}`);
      this.reconnectAttempt = 0;
    });

    ws.addEventListener('message', (ev: MessageEvent) => {
      try {
        const parsed: unknown = JSON.parse(String(ev.data));
        if (isAppMessage(parsed)) {
          this.emit(parsed);
        } else {
          console.warn('WebSocketTransport: invalid message shape', parsed);
        }
      } catch (err) {
        console.warn('WebSocketTransport: bad JSON payload', err);
      }
    });

    ws.addEventListener('error', () => {
      // The `close` event always follows; that's where reconnect is scheduled.
      console.warn('WebSocketTransport: socket error');
    });

    ws.addEventListener('close', (ev) => {
      console.warn(`WebSocketTransport: socket closed (code=${ev.code})`);
      this.ws = null;
      if (this.intentionalClose) return;
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    const idx = Math.min(this.reconnectAttempt, WebSocketTransport.RECONNECT_DELAYS_S.length - 1);
    const baseS = WebSocketTransport.RECONNECT_DELAYS_S[idx] ?? 30;
    this.reconnectAttempt += 1;
    // eslint-disable-next-line sonarjs/pseudo-random -- reason: cosmetic backoff jitter, not security-sensitive
    const jitter = 1 + (Math.random() * 2 - 1) * WebSocketTransport.JITTER;
    const delayMs = Math.max(0, Math.round(baseS * 1000 * jitter));
    console.warn(
      `WebSocketTransport: reconnecting in ${delayMs}ms (attempt ${this.reconnectAttempt})`,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delayMs);
  }
}

/** Runtime guard — keeps untrusted wire payloads out of the World. */
export function isAppMessage(x: unknown): x is AppMessage {
  if (!x || typeof x !== 'object') return false;
  const m = x as { type?: unknown };
  return m.type === 'snapshot' || m.type === 'state' || m.type === 'event';
}
