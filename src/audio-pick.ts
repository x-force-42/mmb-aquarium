/**
 * Audio inventory + weighted pick + chain decisions — all pure.
 *
 * Random is injected (`random: () => number`) so the unit suite can replay
 * any branch deterministically. Real callers pass `Math.random`.
 *
 * The weight matrix in `docs/audio-map.md` is the single source of truth.
 * If you tweak a number here, tweak the doc in the same change.
 */

import type { Mood } from './audio-mood';

/** Stable identifier for each clip. The on-disk filename is in `AUDIO_FILES`. */
export type AudioId =
  | 'imMrMeeseeks'
  | 'mrMeeseeks'
  | 'lookAtMe'
  | 'canDo'
  | 'excuseMe'
  | 'letMeTry'
  | 'ohOk'
  | 'mistakesDontExistThisLong'
  | 'iJustWantToDie'
  | 'allDone';

export const AUDIO_IDS: readonly AudioId[] = [
  'imMrMeeseeks',
  'mrMeeseeks',
  'lookAtMe',
  'canDo',
  'excuseMe',
  'letMeTry',
  'ohOk',
  'mistakesDontExistThisLong',
  'iJustWantToDie',
  'allDone',
] as const;

/** Filename under `public/audio/`. URL is `/audio/<name>`. */
export const AUDIO_FILES: Readonly<Record<AudioId, string>> = Object.freeze({
  imMrMeeseeks: 'im-mr-meeseeks.mp3',
  mrMeeseeks: 'mr-meeseeks.mp3',
  lookAtMe: 'look-at-me.mp3',
  canDo: 'can-do.mp3',
  excuseMe: 'excuse-me.mp3',
  letMeTry: 'let-me-try.mp3',
  ohOk: 'oh-ok.mp3',
  mistakesDontExistThisLong: 'mistakes-dont-exist-this-long.mp3',
  iJustWantToDie: 'i-just-want-to-die.mp3',
  allDone: 'all-done.mp3',
});

/**
 * Weight per (mood, audio). 0 = never plays in that mood.
 * Mirror of the table in `docs/audio-map.md`.
 */
export const WEIGHT_MATRIX: Readonly<Record<Mood, Readonly<Record<AudioId, number>>>> =
  Object.freeze({
    // Birth is deterministic: always the iconic "I'm Mr. Meeseeks, look at me!"
    // Chain logic still rolls afterward (35% canDo, 15% lookAtMe, 50% silence).
    newborn: Object.freeze({
      imMrMeeseeks: 1,
      mrMeeseeks: 0,
      lookAtMe: 0,
      canDo: 0,
      excuseMe: 0,
      letMeTry: 0,
      ohOk: 0,
      mistakesDontExistThisLong: 0,
      iJustWantToDie: 0,
      allDone: 0,
    }),
    healthy: Object.freeze({
      imMrMeeseeks: 0,
      mrMeeseeks: 0,
      lookAtMe: 1,
      canDo: 4,
      excuseMe: 2,
      letMeTry: 2,
      ohOk: 0,
      mistakesDontExistThisLong: 0,
      iJustWantToDie: 0,
      allDone: 0,
    }),
    declining: Object.freeze({
      imMrMeeseeks: 0,
      mrMeeseeks: 0,
      lookAtMe: 0,
      canDo: 1,
      excuseMe: 3,
      letMeTry: 3,
      ohOk: 1,
      mistakesDontExistThisLong: 1,
      iJustWantToDie: 0,
      allDone: 0,
    }),
    critical: Object.freeze({
      imMrMeeseeks: 0,
      mrMeeseeks: 0,
      lookAtMe: 0,
      canDo: 0,
      excuseMe: 1,
      letMeTry: 1,
      ohOk: 2,
      mistakesDontExistThisLong: 3,
      iJustWantToDie: 1,
      allDone: 0,
    }),
    freakingOut: Object.freeze({
      imMrMeeseeks: 0,
      mrMeeseeks: 0,
      lookAtMe: 0,
      canDo: 0,
      excuseMe: 0,
      letMeTry: 1,
      ohOk: 0,
      mistakesDontExistThisLong: 4,
      iJustWantToDie: 3,
      allDone: 0,
    }),
    recovered: Object.freeze({
      imMrMeeseeks: 0,
      mrMeeseeks: 0,
      lookAtMe: 0,
      canDo: 4,
      excuseMe: 1,
      letMeTry: 1,
      ohOk: 4,
      mistakesDontExistThisLong: 0,
      iJustWantToDie: 0,
      allDone: 0,
    }),
    dyingHappy: Object.freeze({
      imMrMeeseeks: 0,
      mrMeeseeks: 0,
      lookAtMe: 0,
      canDo: 0,
      excuseMe: 0,
      letMeTry: 0,
      ohOk: 0,
      mistakesDontExistThisLong: 0,
      iJustWantToDie: 0,
      allDone: 1,
    }),
    dyingDefeated: Object.freeze({
      imMrMeeseeks: 0,
      mrMeeseeks: 0,
      lookAtMe: 0,
      canDo: 0,
      excuseMe: 0,
      letMeTry: 0,
      ohOk: 0,
      mistakesDontExistThisLong: 3,
      iJustWantToDie: 5,
      allDone: 0,
    }),
  });

/**
 * Weighted pick within a mood. `excludeId` (typically the last-played for this
 * Meeseeks) is zeroed out before the draw. Returns `null` when every reachable
 * weight is zero — caller treats that as silence.
 *
 * `random()` is sampled at most once per call.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- reason: weighted picker with explicit exclusion + floating-point fallthrough; complexity is in the rule count, not entangled control flow. Extracting helpers adds indirection without clarity.
export function pickAudio(
  mood: Mood,
  excludeId: AudioId | null,
  random: () => number,
): AudioId | null {
  const row = WEIGHT_MATRIX[mood];
  let total = 0;
  for (const id of AUDIO_IDS) {
    if (id === excludeId) continue;
    total += row[id];
  }
  if (total <= 0) return null;

  let r = random() * total;
  for (const id of AUDIO_IDS) {
    if (id === excludeId) continue;
    const w = row[id];
    if (w <= 0) continue;
    r -= w;
    if (r < 0) return id;
  }

  // Floating-point fallthrough: pick the last non-zero, non-excluded entry.
  for (let i = AUDIO_IDS.length - 1; i >= 0; i--) {
    const id = AUDIO_IDS[i];
    if (id === undefined) continue;
    if (id === excludeId) continue;
    if (row[id] > 0) return id;
  }
  return null;
}

/**
 * Roll for a chained follow-up after a primary line plays.
 *
 * Chains cap at depth 2 (one primary + at most one chain) — the AudioSystem
 * is responsible for not calling this again on the chained line.
 *
 * Per `docs/audio-map.md`, `canDo`, `letMeTry`, and `mistakes…` only chain
 * within specific moods; other primaries chain regardless of mood.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- reason: dispatch table over `primary`; each branch is a 1-2 line probability check. Splitting into helpers per case would obscure the chain rules that live next to each other in docs/audio-map.md.
export function pickChain(primary: AudioId, mood: Mood, random: () => number): AudioId | null {
  const r = random();
  switch (primary) {
    case 'imMrMeeseeks':
    case 'mrMeeseeks':
      if (r < 0.35) return 'canDo';
      if (r < 0.5) return 'lookAtMe';
      return null;

    case 'lookAtMe':
      if (r < 0.25) return 'canDo';
      return null;

    case 'canDo':
      if (mood === 'healthy' && r < 0.1) return 'letMeTry';
      return null;

    case 'excuseMe':
      if (r < 0.25) return 'letMeTry';
      return null;

    case 'letMeTry':
      if ((mood === 'critical' || mood === 'freakingOut') && r < 0.3) {
        return 'mistakesDontExistThisLong';
      }
      return null;

    case 'mistakesDontExistThisLong':
      if (mood === 'freakingOut' && r < 0.2) return 'iJustWantToDie';
      return null;

    default:
      return null;
  }
}
