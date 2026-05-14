/**
 * Audio config — pure parser for `import.meta.env.VITE_AUDIO_*`.
 *
 * The audio layer never throws on bad config: an unparseable value silently
 * falls back to the default and a warning gets logged. The aquarium has to
 * keep rendering even if the operator typed `0.92,banana,1.08`.
 *
 * No DOM, no Web Audio — this module is pure so unit tests can shove arbitrary
 * env-like objects in without standing up jsdom.
 */

/** Frozen shape consumed by the AudioSystem. All durations are in *seconds*. */
export interface AudioConfig {
  readonly defaultMuted: boolean;
  readonly pitchOffsets: readonly number[];
  readonly birthBurstCap: number;
  readonly birthBurstWindowMs: number;
  readonly cooldownS: number;
  readonly chainCooldownS: number;
  readonly ambientTickS: number;
  readonly newbornLockS: number;
  readonly recoveredLockS: number;
  readonly concurrentCap: number;
  /** Whether ambient ticks ("ruídos") fire by default. Events still fire either way. */
  readonly ambientEnabled: boolean;
  /** Master gain applied to every clip. [0, 1]. */
  readonly masterVolume: number;
  /** Extra gain bus applied on top of master to ambient clips only. [0, 1]. */
  readonly ambientVolume: number;
}

export const DEFAULT_AUDIO_CONFIG: AudioConfig = Object.freeze({
  defaultMuted: true,
  pitchOffsets: Object.freeze([0.92, 1.0, 1.08]) as readonly number[],
  birthBurstCap: 3,
  birthBurstWindowMs: 400,
  cooldownS: 2.5,
  chainCooldownS: 4.0,
  ambientTickS: 2.0,
  newbornLockS: 1.5,
  recoveredLockS: 1.5,
  concurrentCap: 4,
  ambientEnabled: true,
  masterVolume: 1.0,
  ambientVolume: 0.4,
});

/** Anything that quacks like Vite's `import.meta.env`. */
export type EnvLike = Readonly<Record<string, string | undefined>>;

type Warn = (msg: string) => void;
const defaultWarn: Warn = (msg) => {
  // eslint-disable-next-line no-console
  console.warn(msg);
};

/**
 * Parse an env-like object into an `AudioConfig`. Bad values are replaced with
 * defaults (with a `console.warn`). Never throws.
 */
export function parseAudioConfig(env: EnvLike | undefined, warn: Warn = defaultWarn): AudioConfig {
  const e = env ?? {};
  return {
    defaultMuted: parseBool(e['VITE_AUDIO_DEFAULT_MUTED'], DEFAULT_AUDIO_CONFIG.defaultMuted, 'VITE_AUDIO_DEFAULT_MUTED', warn),
    pitchOffsets: parseNumberList(e['VITE_AUDIO_PITCH_OFFSETS'], DEFAULT_AUDIO_CONFIG.pitchOffsets, 'VITE_AUDIO_PITCH_OFFSETS', warn),
    birthBurstCap: parsePositiveInt(e['VITE_AUDIO_BIRTH_BURST_CAP'], DEFAULT_AUDIO_CONFIG.birthBurstCap, 'VITE_AUDIO_BIRTH_BURST_CAP', warn),
    birthBurstWindowMs: parsePositiveNumber(e['VITE_AUDIO_BIRTH_BURST_WINDOW_MS'], DEFAULT_AUDIO_CONFIG.birthBurstWindowMs, 'VITE_AUDIO_BIRTH_BURST_WINDOW_MS', warn),
    cooldownS: parseNonNegativeNumber(e['VITE_AUDIO_COOLDOWN_S'], DEFAULT_AUDIO_CONFIG.cooldownS, 'VITE_AUDIO_COOLDOWN_S', warn),
    chainCooldownS: parseNonNegativeNumber(e['VITE_AUDIO_CHAIN_COOLDOWN_S'], DEFAULT_AUDIO_CONFIG.chainCooldownS, 'VITE_AUDIO_CHAIN_COOLDOWN_S', warn),
    ambientTickS: parsePositiveNumber(e['VITE_AUDIO_AMBIENT_TICK_S'], DEFAULT_AUDIO_CONFIG.ambientTickS, 'VITE_AUDIO_AMBIENT_TICK_S', warn),
    newbornLockS: parseNonNegativeNumber(e['VITE_AUDIO_NEWBORN_LOCK_S'], DEFAULT_AUDIO_CONFIG.newbornLockS, 'VITE_AUDIO_NEWBORN_LOCK_S', warn),
    recoveredLockS: parseNonNegativeNumber(e['VITE_AUDIO_RECOVERED_LOCK_S'], DEFAULT_AUDIO_CONFIG.recoveredLockS, 'VITE_AUDIO_RECOVERED_LOCK_S', warn),
    concurrentCap: parsePositiveInt(e['VITE_AUDIO_CONCURRENT_CAP'], DEFAULT_AUDIO_CONFIG.concurrentCap, 'VITE_AUDIO_CONCURRENT_CAP', warn),
    ambientEnabled: parseBool(e['VITE_AUDIO_AMBIENT_ENABLED'], DEFAULT_AUDIO_CONFIG.ambientEnabled, 'VITE_AUDIO_AMBIENT_ENABLED', warn),
    masterVolume: parseFraction(e['VITE_AUDIO_MASTER_VOLUME'], DEFAULT_AUDIO_CONFIG.masterVolume, 'VITE_AUDIO_MASTER_VOLUME', warn),
    ambientVolume: parseFraction(e['VITE_AUDIO_AMBIENT_VOLUME'], DEFAULT_AUDIO_CONFIG.ambientVolume, 'VITE_AUDIO_AMBIENT_VOLUME', warn),
  };
}

// ---------------------------------------------------------------------------
// Primitive parsers — each returns `fallback` on missing / bad input.
// ---------------------------------------------------------------------------

function parseBool(raw: string | undefined, fallback: boolean, key: string, warn: Warn): boolean {
  if (raw === undefined || raw === '') return fallback;
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  warn(`[audio-config] ${key}=${JSON.stringify(raw)} is not a boolean, using ${fallback}`);
  return fallback;
}

function parsePositiveNumber(raw: string | undefined, fallback: number, key: string, warn: Warn): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    warn(`[audio-config] ${key}=${JSON.stringify(raw)} is not a positive number, using ${fallback}`);
    return fallback;
  }
  return n;
}

function parseNonNegativeNumber(raw: string | undefined, fallback: number, key: string, warn: Warn): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    warn(`[audio-config] ${key}=${JSON.stringify(raw)} is not a non-negative number, using ${fallback}`);
    return fallback;
  }
  return n;
}

function parseFraction(raw: string | undefined, fallback: number, key: string, warn: Warn): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    warn(`[audio-config] ${key}=${JSON.stringify(raw)} is not a number in [0, 1], using ${fallback}`);
    return fallback;
  }
  return n;
}

function parsePositiveInt(raw: string | undefined, fallback: number, key: string, warn: Warn): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    warn(`[audio-config] ${key}=${JSON.stringify(raw)} is not a positive integer, using ${fallback}`);
    return fallback;
  }
  return n;
}

function parseNumberList(
  raw: string | undefined,
  fallback: readonly number[],
  key: string,
  warn: Warn,
): readonly number[] {
  if (raw === undefined || raw === '') return fallback;
  const parts = raw.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) {
    warn(`[audio-config] ${key}=${JSON.stringify(raw)} is empty, using defaults`);
    return fallback;
  }
  const nums: number[] = [];
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isFinite(n) || n <= 0) {
      warn(`[audio-config] ${key}=${JSON.stringify(raw)} contains non-positive number ${JSON.stringify(p)}, using defaults`);
      return fallback;
    }
    nums.push(n);
  }
  return Object.freeze(nums);
}
