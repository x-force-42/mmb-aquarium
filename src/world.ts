/**
 * World — the single source of truth for which Meeseeks exist and what state they're in.
 *
 * Inputs:  any caller feeds it `AppMessage`s via `handleMessage`.
 * Outputs: typed events via `on(event, cb)`.
 *
 * No DOM, no Pixi, no transport awareness. This is the unit-testable core.
 */

import { Emitter } from './emitter';
import { parseAgentRole } from './agent-role';
import type { AppMessage, MeeseeksId, MeeseeksState, WorldEvents, WorldQuery } from './types';

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Returns a defensive shallow copy so callers can't mutate internal state. */
function copy(m: MeeseeksState): MeeseeksState {
  return {
    id: m.id,
    health: m.health,
    isFreakingOut: m.isFreakingOut,
    name: m.name,
    task: m.task,
    blocks: m.blocks,
    role: m.role,
  };
}

/** Hard cap on the per-Meeseeks progress-block pile. Beyond this, `block_added` no-ops. */
export const BLOCK_CAP = 40;

export class World implements WorldQuery {
  private readonly state = new Map<MeeseeksId, MeeseeksState>();
  private readonly emitter = new Emitter<WorldEvents>();

  // ---------------------------------------------------------------------------
  // Subscription
  // ---------------------------------------------------------------------------
  on<K extends keyof WorldEvents>(event: K, cb: WorldEvents[K]): () => void {
    return this.emitter.on(event, cb);
  }

  // ---------------------------------------------------------------------------
  // Queries (immutable views — safe to pass anywhere)
  // ---------------------------------------------------------------------------
  getAll(): MeeseeksState[] {
    return Array.from(this.state.values(), copy);
  }

  /** "Alive" == present in the world. Dead Meeseeks have already been removed. */
  getAlive(): MeeseeksState[] {
    return this.getAll();
  }

  getFreakingOut(): MeeseeksState[] {
    return this.getAll().filter((m) => m.isFreakingOut);
  }

  get(id: MeeseeksId): MeeseeksState | null {
    const m = this.state.get(id);
    return m ? copy(m) : null;
  }

  size(): number {
    return this.state.size;
  }

  // ---------------------------------------------------------------------------
  // Intake — the only mutating entry point.
  // ---------------------------------------------------------------------------
  handleMessage(msg: AppMessage): void {
    switch (msg.type) {
      case 'snapshot':
        this.applySnapshot(msg);
        return;
      case 'state':
        this.applyState(msg);
        return;
      case 'event':
        this.applyEvent(msg);
        return;
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------
  private applySnapshot(msg: Extract<AppMessage, { type: 'snapshot' }>): void {
    // Wipe everything; snapshots are a reset, not a story. Renderer rebuilds
    // from the resulting onBorn stream — simplest correct behavior for v1.
    this.state.clear();
    for (const raw of msg.meeseeks) {
      const m: MeeseeksState = {
        id: String(raw.id),
        health: clamp01(raw.health ?? 1),
        isFreakingOut: !!raw.isFreakingOut,
        name: raw.name ?? null,
        task: raw.task ?? null,
        blocks: 0,
        role: parseAgentRole(raw.name),
      };
      this.state.set(m.id, m);
      this.emitter.emit('onBorn', copy(m));
    }
  }

  private applyState(msg: Extract<AppMessage, { type: 'state' }>): void {
    const m = this.state.get(String(msg.id));
    if (!m) return; // unknown id — drop
    const prev = m.health;
    const next = clamp01(msg.health);
    if (next === prev) return;
    m.health = next;
    this.emitter.emit('onStateChange', copy(m), prev);
  }

  private applyEvent(msg: Extract<AppMessage, { type: 'event' }>): void {
    const id = String(msg.id);
    switch (msg.kind) {
      case 'born': {
        if (this.state.has(id)) return; // ignore duplicate births
        const m: MeeseeksState = {
          id,
          health: 1,
          isFreakingOut: false,
          name: msg.name ?? null,
          task: msg.task ?? null,
          blocks: 0,
          role: parseAgentRole(msg.name),
        };
        this.state.set(id, m);
        this.emitter.emit('onBorn', copy(m));
        return;
      }
      case 'died_happy': {
        const m = this.state.get(id);
        if (!m) return;
        this.state.delete(id);
        this.emitter.emit('onDiedHappy', copy(m));
        return;
      }
      case 'died_defeated': {
        const m = this.state.get(id);
        if (!m) return;
        this.state.delete(id);
        this.emitter.emit('onDiedDefeated', copy(m));
        return;
      }
      case 'freaking_out': {
        const m = this.state.get(id);
        if (!m || m.isFreakingOut) return;
        m.isFreakingOut = true;
        this.emitter.emit('onFreakingOut', copy(m));
        return;
      }
      case 'recovered': {
        const m = this.state.get(id);
        if (!m || !m.isFreakingOut) return;
        m.isFreakingOut = false;
        this.emitter.emit('onRecovered', copy(m));
        return;
      }
      case 'block_added': {
        const m = this.state.get(id);
        if (!m) return; // unknown id — drop
        if (m.blocks >= BLOCK_CAP) return; // hard cap; further blocks ignored
        m.blocks += 1;
        this.emitter.emit('onBlockAdded', copy(m));
        return;
      }
    }
  }
}
