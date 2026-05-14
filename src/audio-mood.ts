/**
 * Mood derivation — pure, deterministic, time-driven.
 *
 * The audio layer computes mood on its own from MeeseeksState + per-instance
 * audio bookkeeping (when was this one born, when did it last recover). The
 * World never learns about moods.
 *
 * Boundary cheat-sheet (matches `docs/audio-map.md`):
 *   health > 0.7        → healthy
 *   0.4 < health <= 0.7 → declining
 *   health <= 0.4       → critical
 */

/** Every mood the audio layer can be in for one Meeseeks. */
export type Mood =
  | 'newborn'
  | 'healthy'
  | 'declining'
  | 'critical'
  | 'freakingOut'
  | 'recovered'
  | 'dyingHappy'
  | 'dyingDefeated';

/** Moods reachable while the Meeseeks is still in the World. */
export type AliveMood = Exclude<Mood, 'dyingHappy' | 'dyingDefeated'>;

/** Inputs `deriveMood` needs. Times are in ms; matches `performance.now()`. */
export interface MoodInput {
  readonly health: number; // 0..1
  readonly isFreakingOut: boolean;
  readonly nowMs: number;
  readonly bornAtMs: number;
  /** `null` when this Meeseeks has never recovered yet. */
  readonly recoveredAtMs: number | null;
  readonly newbornLockMs: number;
  readonly recoveredLockMs: number;
}

/**
 * Pure mapping from `(state, time, locks)` to mood.
 *
 * Precedence is intentional and matches the spec:
 *   1. newborn lock (event-driven greeting must not be robbed by a state msg)
 *   2. freakingOut (the breakdown wins over health-band moods)
 *   3. recovered lock (give the "rebuilding" mood ~1.5s before sliding back)
 *   4. health band: healthy / declining / critical
 */
export function deriveMood(input: MoodInput): AliveMood {
  const sinceBorn = input.nowMs - input.bornAtMs;
  if (sinceBorn >= 0 && sinceBorn < input.newbornLockMs) return 'newborn';

  if (input.isFreakingOut) return 'freakingOut';

  if (input.recoveredAtMs !== null) {
    const sinceRecover = input.nowMs - input.recoveredAtMs;
    if (sinceRecover >= 0 && sinceRecover < input.recoveredLockMs) return 'recovered';
  }

  if (input.health > 0.7) return 'healthy';
  if (input.health > 0.4) return 'declining';
  return 'critical';
}
