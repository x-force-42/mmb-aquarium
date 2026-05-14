/**
 * AudioSystem — gives each Meeseeks a voice.
 *
 * Subscribes to World events alongside the Renderer. Decides what (if
 * anything) each Meeseeks says, when, and how it sounds. Implementation
 * follows the spec in `docs/audio-map.md`; tune by ear via `.env` overrides
 * once the sound is wired up.
 *
 * Layering invariants (do not break):
 *   - Imports only audio-* helpers, types, world (for `bind`), and Web Audio.
 *   - Never reaches into the World's private state.
 *   - DOM access limited to the mute button it owns.
 */

import { deriveMood, type AliveMood, type Mood } from './audio-mood';
import {
  AUDIO_FILES,
  AUDIO_IDS,
  pickAudio,
  pickChain,
  type AudioId,
} from './audio-pick';
import type { AudioConfig } from './audio-config';
import { PREFS_STORAGE_KEY, validatePrefs, type AudioPrefs } from './audio-prefs';
import type { MeeseeksId, MeeseeksState } from './types';
import type { World } from './world';

export interface AudioDeps {
  /** -1..1 stereo pan for this Meeseeks. Default: always center (0). */
  panOf?: (id: MeeseeksId) => number;
  /** Random source for picks + jitter. Default: `Math.random`. */
  random?: () => number;
  /**
   * Fetcher used to download MP3s. Override in tests if you want.
   * Default: global `fetch`.
   */
  fetcher?: (url: string) => Promise<Response>;
}

type TimerHandle = ReturnType<typeof setTimeout>;
type CancelToken = { cancelled: boolean };

interface MeeseeksAudioState {
  bornAtMs: number;
  recoveredAtMs: number | null;
  cooldownUntilMs: number;
  lastPlayedId: AudioId | null;
  pitchOffset: number;
  health: number;
  isFreakingOut: boolean;
  ambientTimerId: TimerHandle | null;
  activeSource: AudioBufferSourceNode | null;
  activeCancelToken: CancelToken | null;
}

interface PlayOptions {
  ignoreCooldown: boolean;
  /** Routes the clip through the ambient bus (extra gain). Chain inherits this. */
  isAmbient: boolean;
}

/** Public hook published on `window.__aquarium.audio`. */
export interface AudioPublicHook {
  setMuted(value: boolean): void;
  isMuted(): boolean;
  setAmbientEnabled(value: boolean): void;
  isAmbientEnabled(): boolean;
  /** Clamped to [0, 1]. Live-updates the master gain. */
  setMasterVolume(value: number): void;
  getMasterVolume(): number;
  /** Clamped to [0, 1]. Cascades on top of master for ambient clips only. */
  setAmbientVolume(value: number): void;
  getAmbientVolume(): number;
  getLastPlayed(id: MeeseeksId): string | null;
  forceTick(): void;
}

const EVENT_QUEUE_RETRY_MS = 30;
const EVENT_QUEUE_DEADLINE_MS = 250;

export class AudioSystem implements AudioPublicHook {
  readonly config: AudioConfig;
  private readonly random: () => number;
  private readonly panOf: (id: MeeseeksId) => number;
  private readonly fetcher: (url: string) => Promise<Response>;

  private ctx: AudioContext | null = null;
  private readonly buffers = new Map<AudioId, AudioBuffer>();
  private muted: boolean;
  private ambientEnabled: boolean;
  private masterVolume: number;
  private ambientVolume: number;

  // Two-bus topology: every playback routes through ambientBus OR eventBus,
  // both feeding masterGain, which feeds destination. Volume sliders mutate
  // these GainNodes directly so changes are audible immediately.
  private masterGain: GainNode | null = null;
  private ambientBus: GainNode | null = null;
  private eventBus: GainNode | null = null;

  private readonly audioStates = new Map<MeeseeksId, MeeseeksAudioState>();
  private birthTimestamps: number[] = [];
  private activePlaybacks = 0;

  private bound = false;
  private destroyed = false;
  private readonly unsubs: Array<() => void> = [];

  constructor(config: AudioConfig, deps: AudioDeps = {}) {
    this.config = config;
    this.random = deps.random ?? Math.random;
    this.panOf = deps.panOf ?? (() => 0);
    this.fetcher = deps.fetcher ?? ((url) => fetch(url));
    this.muted = config.defaultMuted;
    this.ambientEnabled = config.ambientEnabled;
    this.masterVolume = clamp(config.masterVolume, 0, 1);
    this.ambientVolume = clamp(config.ambientVolume, 0, 1);
    // Overlay any persisted prefs on top of config defaults (mute stays off-disk).
    this.loadPersistedPrefs();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Create the AudioContext (if Web Audio is available) and decode every clip.
   * Errors are logged but never thrown — audio failure must not break the
   * aquarium.
   */
  async load(): Promise<void> {
    if (this.ctx || this.destroyed) return;
    const Ctor =
      typeof window !== 'undefined'
        ? (window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext })
              .webkitAudioContext)
        : undefined;
    if (!Ctor) {
      console.warn('[audio] Web Audio API unavailable; audio disabled.');
      return;
    }
    try {
      this.ctx = new Ctor();
    } catch (err) {
      console.warn('[audio] AudioContext could not be created:', err);
      return;
    }

    const ctx = this.ctx;
    // Build the bus topology before decoding starts. Every clip will route
    // through one of these two buses based on its classification.
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.masterVolume;
    this.masterGain.connect(ctx.destination);

    this.ambientBus = ctx.createGain();
    this.ambientBus.gain.value = this.ambientVolume;
    this.ambientBus.connect(this.masterGain);

    this.eventBus = ctx.createGain();
    this.eventBus.gain.value = 1.0;
    this.eventBus.connect(this.masterGain);

    await Promise.all(
      AUDIO_IDS.map(async (id) => {
        const url = `/audio/${AUDIO_FILES[id]}`;
        try {
          const res = await this.fetcher(url);
          if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
          const arr = await res.arrayBuffer();
          const buf = await ctx.decodeAudioData(arr);
          this.buffers.set(id, buf);
        } catch (err) {
          console.warn(`[audio] failed to load ${url}:`, err);
        }
      }),
    );
  }

  /** Subscribe to a World. Single-bind by design. */
  bind(world: World): void {
    if (this.bound || this.destroyed) return;
    this.bound = true;
    this.unsubs.push(world.on('onBorn',         (m) => this.handleBorn(m)));
    this.unsubs.push(world.on('onStateChange',  (m, prev) => this.handleStateChange(m, prev)));
    this.unsubs.push(world.on('onFreakingOut',  (m) => this.handleFreakingOut(m)));
    this.unsubs.push(world.on('onRecovered',    (m) => this.handleRecovered(m)));
    this.unsubs.push(world.on('onDiedHappy',    (m) => this.handleDeath(m, 'dyingHappy')));
    this.unsubs.push(world.on('onDiedDefeated', (m) => this.handleDeath(m, 'dyingDefeated')));
  }

  destroy(): void {
    this.destroyed = true;
    for (const off of this.unsubs) off();
    this.unsubs.length = 0;
    for (const s of this.audioStates.values()) {
      if (s.ambientTimerId !== null) {
        clearTimeout(s.ambientTimerId);
        s.ambientTimerId = null;
      }
      this.cancelActive(s);
    }
    this.audioStates.clear();
    this.buffers.clear();
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Public hook surface (window.__aquarium.audio)
  // ---------------------------------------------------------------------------

  setMuted(value: boolean): void {
    if (this.muted === value) return;
    this.muted = value;
    if (!value && this.ctx && this.ctx.state === 'suspended') {
      // Triggered from a user click → safe to resume.
      this.ctx.resume().catch(() => {});
    }
    // Mute is intentionally NOT persisted — see audio-prefs.ts for why.
  }

  isMuted(): boolean {
    return this.muted;
  }

  setAmbientEnabled(value: boolean): void {
    if (this.ambientEnabled === value) return;
    this.ambientEnabled = value;
    this.persistPrefs();
  }

  isAmbientEnabled(): boolean {
    return this.ambientEnabled;
  }

  setMasterVolume(value: number): void {
    const v = clamp(value, 0, 1);
    if (this.masterVolume === v) return;
    this.masterVolume = v;
    if (this.masterGain) this.masterGain.gain.value = v;
    this.persistPrefs();
  }

  getMasterVolume(): number {
    return this.masterVolume;
  }

  setAmbientVolume(value: number): void {
    const v = clamp(value, 0, 1);
    if (this.ambientVolume === v) return;
    this.ambientVolume = v;
    if (this.ambientBus) this.ambientBus.gain.value = v;
    this.persistPrefs();
  }

  getAmbientVolume(): number {
    return this.ambientVolume;
  }

  getLastPlayed(id: MeeseeksId): string | null {
    const s = this.audioStates.get(id);
    return s?.lastPlayedId ?? null;
  }

  /** Test convenience — run one ambient tick for every Meeseeks right now. */
  forceTick(): void {
    if (this.muted || !this.ambientEnabled) return;
    for (const id of Array.from(this.audioStates.keys())) {
      this.considerAmbient(id);
    }
  }

  // ---------------------------------------------------------------------------
  // World event handlers
  // ---------------------------------------------------------------------------

  private handleBorn(m: MeeseeksState): void {
    const now = this.now();
    const state: MeeseeksAudioState = {
      bornAtMs: now,
      recoveredAtMs: null,
      cooldownUntilMs: 0,
      lastPlayedId: null,
      pitchOffset: this.pickPitch(),
      health: m.health,
      isFreakingOut: m.isFreakingOut,
      ambientTimerId: null,
      activeSource: null,
      activeCancelToken: null,
    };
    this.audioStates.set(m.id, state);

    if (this.recordBirthAndCheckBurst(now)) {
      this.queueEventPlay(m.id, 'newborn', { ignoreCooldown: false, isAmbient: false });
    }

    this.scheduleAmbient(m.id);
  }

  private handleStateChange(m: MeeseeksState, prevHealth: number): void {
    const s = this.audioStates.get(m.id);
    if (!s) return;
    if (prevHealth > 0.4 && m.health <= 0.4 && !m.isFreakingOut) {
      this.queueEventPlay(m.id, 'critical', { ignoreCooldown: false, isAmbient: false });
    }
    s.health = m.health;
    s.isFreakingOut = m.isFreakingOut;
  }

  private handleFreakingOut(m: MeeseeksState): void {
    const s = this.audioStates.get(m.id);
    if (!s) return;
    s.isFreakingOut = true;
    this.queueEventPlay(m.id, 'freakingOut', { ignoreCooldown: true, isAmbient: false });
  }

  private handleRecovered(m: MeeseeksState): void {
    const s = this.audioStates.get(m.id);
    if (!s) return;
    s.isFreakingOut = false;
    s.recoveredAtMs = this.now();
    this.queueEventPlay(m.id, 'recovered', { ignoreCooldown: false, isAmbient: false });
  }

  private handleDeath(m: MeeseeksState, mood: 'dyingHappy' | 'dyingDefeated'): void {
    const s = this.audioStates.get(m.id);
    if (!s) return;
    if (s.ambientTimerId !== null) {
      clearTimeout(s.ambientTimerId);
      s.ambientTimerId = null;
    }
    // Death wins over cooldown and pre-empts whatever's playing.
    this.queueEventPlay(m.id, mood, { ignoreCooldown: true, isAmbient: false });

    // Cleanup once the death clip plausibly finishes.
    const buffer = this.buffers.get(mood === 'dyingHappy' ? 'allDone' : 'iJustWantToDie');
    const cleanupAfter = (buffer ? buffer.duration * 1000 : 1500) + 1000;
    setTimeout(() => this.audioStates.delete(m.id), cleanupAfter);
  }

  // ---------------------------------------------------------------------------
  // Ambient ticker
  // ---------------------------------------------------------------------------

  private scheduleAmbient(id: MeeseeksId): void {
    const s = this.audioStates.get(id);
    if (!s) return;
    if (s.ambientTimerId !== null) clearTimeout(s.ambientTimerId);
    const base = this.config.ambientTickS * 1000;
    const jitter = (this.random() - 0.5) * 2 * (base * 0.5); // ± half base
    const delay = Math.max(250, base + jitter);
    s.ambientTimerId = setTimeout(() => {
      const cur = this.audioStates.get(id);
      if (!cur) return;
      cur.ambientTimerId = null;
      this.considerAmbient(id);
      if (this.audioStates.has(id)) this.scheduleAmbient(id);
    }, delay);
  }

  private considerAmbient(id: MeeseeksId): void {
    if (this.muted || this.destroyed || !this.ambientEnabled) return;
    const s = this.audioStates.get(id);
    if (!s) return;
    const mood = this.aliveMoodOf(s);
    const prob = ambientProbability(mood);
    if (prob <= 0) return;
    if (this.random() >= prob) return;
    if (this.activePlaybacks >= this.config.concurrentCap) return; // ambient drops on cap
    this.tryPlay(id, mood, { ignoreCooldown: false, isAmbient: true });
  }

  // ---------------------------------------------------------------------------
  // Play pipeline
  // ---------------------------------------------------------------------------

  private queueEventPlay(
    id: MeeseeksId,
    mood: Mood,
    opts: PlayOptions,
    deadlineAt?: number,
  ): void {
    if (this.muted || this.destroyed) return;
    if (this.activePlaybacks < this.config.concurrentCap) {
      this.tryPlay(id, mood, opts);
      return;
    }
    const deadline = deadlineAt ?? this.now() + EVENT_QUEUE_DEADLINE_MS;
    if (this.now() > deadline) return;
    setTimeout(() => this.queueEventPlay(id, mood, opts, deadline), EVENT_QUEUE_RETRY_MS);
  }

  private tryPlay(id: MeeseeksId, mood: Mood, opts: PlayOptions): void {
    if (this.muted) return;
    const s = this.audioStates.get(id);
    if (!s) return;
    if (!opts.ignoreCooldown && this.now() < s.cooldownUntilMs) return;

    if (opts.ignoreCooldown) this.cancelActive(s);

    const audioId = pickAudio(mood, s.lastPlayedId, this.random);
    if (!audioId) return;

    if (this.playClip(id, audioId, s, mood, false, opts.isAmbient)) {
      s.lastPlayedId = audioId;
    }
  }

  private cancelActive(s: MeeseeksAudioState): void {
    if (s.activeCancelToken) s.activeCancelToken.cancelled = true;
    if (s.activeSource) {
      try { s.activeSource.stop(); } catch { /* noop */ }
    }
    s.activeSource = null;
    s.activeCancelToken = null;
  }

  private playClip(
    mid: MeeseeksId,
    audioId: AudioId,
    s: MeeseeksAudioState,
    mood: Mood,
    isChained: boolean,
    isAmbient: boolean,
  ): boolean {
    const ctx = this.ctx;
    const buffer = this.buffers.get(audioId);
    const bus = isAmbient ? this.ambientBus : this.eventBus;
    if (!ctx || !buffer || !bus) {
      // Audio not loaded yet — apply standard cooldown so we don't spam decisions.
      s.cooldownUntilMs = this.now() + this.config.cooldownS * 1000;
      return false;
    }
    if (ctx.state === 'suspended') {
      // Should already be resumed by the un-mute click; defensive call.
      ctx.resume().catch(() => {});
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = s.pitchOffset;

    const gain = ctx.createGain();
    gain.gain.value = clamp(1 + (this.random() - 0.5) * 0.2, 0.5, 1.5);

    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(this.panOf(mid), -1, 1);

    source.connect(gain).connect(panner).connect(bus);

    // Tentative cooldown until clip end — blocks ambient overlap automatically.
    const durationMs = (buffer.duration / s.pitchOffset) * 1000;
    s.cooldownUntilMs = this.now() + durationMs;

    const cancelToken: CancelToken = { cancelled: false };
    s.activeSource = source;
    s.activeCancelToken = cancelToken;

    this.activePlaybacks++;
    let ended = false;
    const onEnd = (): void => {
      if (ended) return;
      ended = true;
      this.activePlaybacks = Math.max(0, this.activePlaybacks - 1);
      try { source.disconnect(); } catch { /* noop */ }
      try { gain.disconnect(); } catch { /* noop */ }
      try { panner.disconnect(); } catch { /* noop */ }

      if (cancelToken.cancelled) return;

      const cur = this.audioStates.get(mid);
      if (!cur) return;
      if (cur.activeCancelToken === cancelToken) {
        cur.activeSource = null;
        cur.activeCancelToken = null;
      }

      if (isChained) {
        cur.cooldownUntilMs = this.now() + this.config.chainCooldownS * 1000;
        return;
      }
      const chainId = pickChain(audioId, mood, this.random);
      if (chainId && this.buffers.has(chainId) && !this.muted) {
        // Chain inherits the primary's ambient/event classification — keeps
        // a started sequence on the same bus even if the user toggles ambient
        // off mid-clip.
        cur.lastPlayedId = chainId;
        this.playClip(mid, chainId, cur, mood, true, isAmbient);
      } else {
        cur.cooldownUntilMs = this.now() + this.config.cooldownS * 1000;
      }
    };
    source.onended = onEnd;
    try {
      source.start();
    } catch (err) {
      console.warn('[audio] start() failed:', err);
      onEnd();
      return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private aliveMoodOf(s: MeeseeksAudioState): AliveMood {
    return deriveMood({
      health: s.health,
      isFreakingOut: s.isFreakingOut,
      nowMs: this.now(),
      bornAtMs: s.bornAtMs,
      recoveredAtMs: s.recoveredAtMs,
      newbornLockMs: this.config.newbornLockS * 1000,
      recoveredLockMs: this.config.recoveredLockS * 1000,
    });
  }

  private recordBirthAndCheckBurst(now: number): boolean {
    const windowMs = this.config.birthBurstWindowMs;
    this.birthTimestamps = this.birthTimestamps.filter((t) => now - t < windowMs);
    const canGreet = this.birthTimestamps.length < this.config.birthBurstCap;
    this.birthTimestamps.push(now);
    return canGreet;
  }

  private pickPitch(): number {
    const list = this.config.pitchOffsets;
    if (list.length === 0) return 1;
    const idx = Math.floor(this.random() * list.length);
    return list[idx] ?? 1;
  }

  private now(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }

  // ---------------------------------------------------------------------------
  // Persistence (localStorage). Mute is intentionally excluded.
  // ---------------------------------------------------------------------------

  private loadPersistedPrefs(): void {
    if (typeof window === 'undefined') return;
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    } catch {
      return; // localStorage access can throw in strict sandboxes
    }
    if (!raw) return;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return; }
    const prefs = validatePrefs(parsed);
    if (prefs.ambientEnabled !== undefined) this.ambientEnabled = prefs.ambientEnabled;
    if (prefs.masterVolume !== undefined) this.masterVolume = prefs.masterVolume;
    if (prefs.ambientVolume !== undefined) this.ambientVolume = prefs.ambientVolume;
  }

  private persistPrefs(): void {
    if (typeof window === 'undefined') return;
    const prefs: AudioPrefs = {
      ambientEnabled: this.ambientEnabled,
      masterVolume: this.masterVolume,
      ambientVolume: this.ambientVolume,
    };
    try {
      window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // Quota exceeded or storage disabled — non-fatal.
    }
  }
}

// ---------------------------------------------------------------------------
// Mood → ambient probability table (per docs/audio-map.md).
// ---------------------------------------------------------------------------
function ambientProbability(mood: Mood): number {
  switch (mood) {
    case 'newborn':       return 0;
    case 'healthy':       return 0.12;
    case 'declining':     return 0.18;
    case 'critical':      return 0.28;
    case 'freakingOut':   return 0.50;
    case 'recovered':     return 0.25;
    case 'dyingHappy':    return 0;
    case 'dyingDefeated': return 0;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
