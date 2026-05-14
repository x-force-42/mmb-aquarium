/**
 * Audio prefs — pure JSON validator for persisted user preferences.
 *
 * The actual `localStorage` read/write happens in `audio.ts`. This module
 * only takes a parsed blob and returns the keys that pass type + range
 * checks — anything missing or malformed is dropped silently. Never throws.
 *
 * Note: mute is intentionally NOT persisted. Browsers require a user
 * gesture to resume a suspended AudioContext, so re-loading with mute=false
 * would give the illusion of working audio that's silently queued behind a
 * suspended context until the next click.
 */

export interface AudioPrefs {
  ambientEnabled: boolean;
  masterVolume: number; // 0..1
  ambientVolume: number; // 0..1
}

export const PREFS_STORAGE_KEY = 'mma-audio-prefs';

/**
 * Take any parsed JSON value and pick out the prefs keys with valid shapes.
 * Returns a partial object — caller overlays it on top of its defaults.
 */
export function validatePrefs(raw: unknown): Partial<AudioPrefs> {
  if (!raw || typeof raw !== 'object') return {};
  const obj = raw as Record<string, unknown>;
  const out: Partial<AudioPrefs> = {};

  const ae = obj['ambientEnabled'];
  if (typeof ae === 'boolean') out.ambientEnabled = ae;

  const mv = obj['masterVolume'];
  if (isFraction(mv)) out.masterVolume = mv;

  const av = obj['ambientVolume'];
  if (isFraction(av)) out.ambientVolume = av;

  return out;
}

function isFraction(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
}
