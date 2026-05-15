/**
 * Wire-level message schema + domain state.
 *
 * Kept dependency-free so any layer (transport / world / renderer / tests)
 * can import these without dragging in DOM or Pixi.
 */

// eslint-disable-next-line sonarjs/redundant-type-aliases -- reason: kept as a documentation handle ("this string is a Meeseeks id"); structural typing is intentional.
export type MeeseeksId = string;

/**
 * Visual archetype of an aquarium entity.
 *
 * - `meeseeks` (default when omitted): the canonical blue creature; the
 *   "doer" archetype. Used for atomic agents (worker sessions) and any
 *   short-lived task entity.
 * - `morty`: yellow archetype introduced for the andaime view to mark
 *   orchestrator agents (the Mestre and per-project orqs). Same physics
 *   and lifecycle as a Meeseeks; only the base tint differs.
 */
export type MeeseeksKind = 'meeseeks' | 'morty';

/** Internal, normalized state of a single Meeseeks. */
export interface MeeseeksState {
  readonly id: MeeseeksId;
  health: number; // 0..1, clamped
  isFreakingOut: boolean;
  name: string | null;
  task: string | null;
  /**
   * Visual archetype. Optional on the wire and in storage; consumers that
   * care about the distinction treat `undefined` as `'meeseeks'`. Stored
   * as a true optional (not `'meeseeks' | undefined`) to satisfy
   * `exactOptionalPropertyTypes`.
   */
  kind?: MeeseeksKind;
}

export type EventKind = 'born' | 'died_happy' | 'died_defeated' | 'freaking_out' | 'recovered';

/** Shape of a Meeseeks as it arrives in a snapshot — fields beyond id are optional. */
export interface MeeseeksSnapshotEntry {
  id: MeeseeksId;
  health?: number;
  isFreakingOut?: boolean;
  name?: string;
  task?: string;
  kind?: MeeseeksKind;
}

/** Discriminated union for everything that crosses the Transport <-> World boundary. */
export type AppMessage =
  | { type: 'snapshot'; meeseeks: ReadonlyArray<MeeseeksSnapshotEntry> }
  | { type: 'state'; id: MeeseeksId; health: number }
  | {
      type: 'event';
      id: MeeseeksId;
      kind: EventKind;
      name?: string;
      task?: string;
      /** Only meaningful when the event `kind === 'born'`. Otherwise ignored. */
      entityKind?: MeeseeksKind;
    };

/** Strongly typed map of World events that the renderer (and tests) subscribe to. */
export interface WorldEvents {
  onBorn: (m: MeeseeksState) => void;
  onStateChange: (m: MeeseeksState, prevHealth: number) => void;
  onDiedHappy: (m: MeeseeksState) => void;
  onDiedDefeated: (m: MeeseeksState) => void;
  onFreakingOut: (m: MeeseeksState) => void;
  onRecovered: (m: MeeseeksState) => void;
}

/** Narrow, read-only adapter that transports use when they need to peek at world state. */
export interface WorldQuery {
  getAll(): MeeseeksState[];
  getAlive(): MeeseeksState[];
  getFreakingOut(): MeeseeksState[];
}
