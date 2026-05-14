# Audio map — when each Meeseeks line plays

> Status: **DESIGN — not yet implemented.** This document is the spec the
> upcoming `AudioSystem` layer will follow. Validate the mappings here before
> writing code; if the personality feels wrong on paper, it'll feel worse on screen.

---

## Why this matters (Meeseeks personality, briefly)

A Meeseeks is summoned from the Meeseeks Box to complete a single task. Their
existence is *that task*, and the task only. Three pillars of the personality
the audio has to convey:

1. **Born confident.** They greet the world with joy and announce themselves.
   `"I'm Mr. Meeseeks, look at me!"` and `"Can do!"` are the canonical opening
   beats. They want to help. They believe they will succeed.
2. **Existence is pain.** The longer they stay alive without completing the
   task, the more agitated they get. The arc is enthusiasm → polite frustration
   → existential dread → full breakdown.
3. **Death is relief.** Completing the task triggers `"All done!"` and a peaceful
   poof. Failing to complete (defeat) is silent or tragic — no "all done."

The aquarium is a visual analogy: a Meeseeks's `health` is "how much patience
they have left to fulfill their purpose," `isFreakingOut` is the breakdown
state, and the two death events are the two ways the arc resolves.

The audio system makes each Meeseeks **vocally** travel that arc. Every line
in the inventory must be reachable from the right state of mind, with some
randomness so the aquarium never feels canned.

---

## Audio inventory

| File                                                            | Likely line                                                                              | Tone                                  |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------- |
| `6-i-m-mr-meeseeks-look-at-me.mp3`                              | "I'm Mr. Meeseeks, look at me!"                                                          | Iconic, energetic, full greeting      |
| `mr-meeks.mp3`                                                  | "Mr. Meeseeks!"                                                                          | Short, punchy intro variant           |
| `look-at-me.mp3`                                                | "Look at me!"                                                                            | Attention grab, eager                 |
| `can-do.mp3`                                                    | "Can do!"                                                                                | Enthusiastic agreement, optimism      |
| `excuse-me.mp3`                                                 | "Excuse me!"                                                                             | Polite intervention, slight worry     |
| `let-me-try-something.mp3`                                      | "Let me try something."                                                                  | Problem-solving, hopeful uncertainty  |
| `oh-ok.mp3`                                                     | "Oh, OK."                                                                                | Resigned acceptance / mild deflation  |
| `mistakes-don-t-usually-have-to-exist-this-long.mp3`            | "Mistakes don't usually have to exist this long."                                        | Existential dread, mounting panic     |
| `i-just-want-to-die-we-all-want-to-die-we-re-missing.mp3`       | "I just want to die. We all want to die. We're missing!"                                 | Full despair, breakdown               |
| `all-done.mp3`                                                  | "All done!"                                                                              | Triumphant farewell, only on success  |

Internally we'll name them with stable ids (kebab-case, no extension) so the
code never embeds filenames in switch statements:

```
imMrMeeseeks, mrMeeseeks, lookAtMe, canDo,
excuseMe, letMeTry, ohOk,
mistakesDontExistThisLong, iJustWantToDie,
allDone
```

---

## Mood states (the "estado de espírito")

The mood is **derived** from `MeeseeksState` + recent events; it isn't stored
in the World. The audio layer computes it on its own. Six discrete moods, ranked
by how much the Meeseeks is suffering:

| Mood              | Condition                                                                |
| ----------------- | ------------------------------------------------------------------------ |
| `newborn`         | Born within the last ~1.5 s. Overrides all others until it lapses.       |
| `healthy`         | `health > 0.7` AND `!isFreakingOut`                                      |
| `declining`       | `0.4 < health <= 0.7` AND `!isFreakingOut`                               |
| `critical`        | `health <= 0.4` AND `!isFreakingOut`                                     |
| `freakingOut`     | `isFreakingOut === true` (regardless of health)                          |
| `recovered`       | Just left `freakingOut` within the last ~1.5 s                           |

Two "moment" moods only triggered by terminal events (they always play exactly
one line, then the Meeseeks is gone):

| Moment            | Trigger                |
| ----------------- | ---------------------- |
| `dyingHappy`      | `onDiedHappy` event    |
| `dyingDefeated`   | `onDiedDefeated` event |

---

## Weight matrix — which lines fit each mood

Cells are **weights**, not probabilities. The system normalizes them within the
chosen mood at pick time. `0` = never plays in that mood. Bigger weight = more
likely.

| Audio                          | newborn | healthy | declining | critical | freakingOut | recovered | dyingHappy | dyingDefeated |
| ------------------------------ | :-----: | :-----: | :-------: | :------: | :---------: | :-------: | :--------: | :-----------: |
| `imMrMeeseeks`                 |    1    |    0    |     0     |    0     |      0      |     0     |     0      |       0       |
| `mrMeeseeks`                   |    0    |    0    |     0     |    0     |      0      |     0     |     0      |       0       |
| `lookAtMe`                     |    0    |    1    |     0     |    0     |      0      |     0     |     0      |       0       |
| `canDo`                        |    0    |    4    |     1     |    0     |      0      |     4     |     0      |       0       |
| `excuseMe`                     |    0    |    2    |     3     |    1     |      0      |     1     |     0      |       0       |
| `letMeTry`                     |    0    |    2    |     3     |    1     |      1      |     1     |     0      |       0       |
| `ohOk`                         |    0    |    0    |     1     |    2     |      0      |     4     |     0      |       0       |
| `mistakesDontExistThisLong`    |    0    |    0    |     1     |    3     |      4      |     0     |     0      |       3       |
| `iJustWantToDie`               |    0    |    0    |     0     |    1     |      3      |     0     |     0      |       5       |
| `allDone`                      |    0    |    0    |     0     |    0     |      0      |     0     |     1      |       0       |

**Reading the columns:**

- `newborn`: deterministic — every birth opens with the iconic
  "I'm Mr. Meeseeks, look at me!" The variety in births still comes from the
  *chain roll* afterward (35% canDo, 15% lookAtMe, 50% silence) plus the
  per-Meeseeks pitch variant.
- `healthy`: `canDo` is the spine of optimism. `letMeTry` and `excuseMe` show
  initiative. Occasional `lookAtMe` keeps them visible.
- `declining`: `excuseMe` and `letMeTry` become the dominant lines — they're
  still trying, but it's becoming work. `ohOk` and `mistakes…` start creeping in.
- `critical`: pain emerges. `mistakesDontExistThisLong` is the headline line.
  `ohOk` is the dejected sigh. `iJustWantToDie` appears as a tease of the freak.
- `freakingOut`: the meltdown lines take over. `mistakes…` and `iJustWantToDie`
  are dominant; `letMeTry` survives as a desperate attempt.
- `recovered`: half-relief, half-dazed. `ohOk` and `canDo` evenly split,
  `excuseMe`/`letMeTry` lighter — they're rebuilding.
- `dyingHappy`: **only** `allDone` plays. Iconic.
- `dyingDefeated`: tragic close. `iJustWantToDie` is the heaviest, `mistakes…`
  the runner-up. **No `allDone` ever**.

---

## Triggers — when the system *considers* speaking

Two kinds of triggers:

### Event-driven (deterministic, one-shot)

These always fire an audio (subject to per-Meeseeks cooldown), with the mood at
the moment of the event determining the pool:

| Event             | Mood used    | Notes                                                       |
| ----------------- | ------------ | ----------------------------------------------------------- |
| `onBorn`          | `newborn`    | Lock the `newborn` mood for ~1500 ms after firing.          |
| `onFreakingOut`   | `freakingOut`| Skip cooldown — the breakdown shouldn't wait politely.      |
| `onRecovered`     | `recovered`  | Lock `recovered` mood for ~1500 ms.                         |
| `onDiedHappy`     | `dyingHappy` | Plays exactly one line, regardless of cooldown.             |
| `onDiedDefeated`  | `dyingDefeated` | Plays exactly one line, regardless of cooldown.          |
| `onStateChange` crossing `health=0.4` downward | `critical`   | Trigger once per crossing (debounced).                      |

### Ambient (probabilistic, recurring)

A per-Meeseeks "consider speaking" tick runs roughly every `2s ± 1s` (jittered
per instance). On each tick:

| Mood          | Speak probability | Notes                                            |
| ------------- | :---------------: | ------------------------------------------------ |
| `newborn`     | 0% (event-driven only) | The greeting already covered it.          |
| `healthy`     | 12%               | Sporadic confidence beats.                       |
| `declining`   | 18%               | More vocal as patience erodes.                   |
| `critical`    | 28%               | Frequent existential mumbling.                   |
| `freakingOut` | 50%               | They're loud and constant in this state.         |
| `recovered`   | 25%               | Coming-down chatter for ~1.5 s, then back to mood-of-the-moment. |

Numbers above are starting points — tunable in code.

---

## Randomness criterion

Three concentric layers of randomness, in order of importance:

### 1. Weighted pick within mood

When a trigger fires, the system:
1. Computes current mood from the Meeseeks's state.
2. Looks up the row in the weight matrix.
3. **Excludes the last-played audio for this Meeseeks** (so we don't repeat back-to-back).
4. Picks one entry weighted-random from what remains.
5. If the row sums to 0 (impossible mood), silence.

### 2. Chained lines (combinations)

After a primary line plays, there's a *chance* the Meeseeks immediately chains
into a follow-up. This is what gives some moments their character.

| Primary                    | Chain candidates (rolled at end of primary)                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `imMrMeeseeks` / `mrMeeseeks` | 35% → `canDo`, 15% → `lookAtMe`, 50% → silence                                                              |
| `lookAtMe`                 | 25% → `canDo`, 75% → silence                                                                                |
| `canDo` (in healthy)       | 10% → `letMeTry`, 90% → silence                                                                             |
| `excuseMe`                 | 25% → `letMeTry`, 75% → silence                                                                             |
| `letMeTry` (in critical/freaking) | 30% → `mistakesDontExistThisLong`, 70% → silence                                                     |
| `mistakesDontExistThisLong` (in freaking) | 20% → `iJustWantToDie`, 80% → silence                                                        |

Chains respect cooldowns: the chained line ignores the chance gate but still
queues after the primary finishes (no overlap). A chain caps at 2 lines deep
(no infinite "mistakes → die → mistakes → die" loops).

### 3. Per-Meeseeks voice variation

Each Meeseeks gets one of **three discrete pitch variants** at birth — the
canonical voice and two alternates. The variant is chosen at random from the
configured list (see [Configuration](#configuration-env)). Applied as
`AudioBufferSourceNode.playbackRate`. Default list: `[0.92, 1.0, 1.08]`.

Layered on top:

- `volume`: ±10 % jitter per playback.
- `pan`: a stereo pan based on the sprite's screen x position (left edge → −1,
  right edge → +1) so the chorus has spatial depth.

Three discrete tones (instead of a continuous range) is intentional: it makes
two Meeseeks easy to distinguish, while keeping the canon "Meeseeks voice"
identity strong. Adding more variants later is a config-only change.

---

## Cooldowns and concurrency

| Rule                                            | Default                            | Env override                            |
| ----------------------------------------------- | ---------------------------------- | --------------------------------------- |
| Per-Meeseeks min gap between sounds (s)         | `2.5` (jitter ±0.8)                | `VITE_AUDIO_COOLDOWN_S`                 |
| Per-Meeseeks gap after a chain finishes (s)     | `4.0` (jitter ±1.0)                | `VITE_AUDIO_CHAIN_COOLDOWN_S`           |
| Global cap on concurrent playbacks              | `4`                                | `VITE_AUDIO_CONCURRENT_CAP`             |
| Ambient consideration tick (s)                  | `2.0` (jitter ±1.0 per id)         | `VITE_AUDIO_AMBIENT_TICK_S`             |
| Newborn-mood lock (s)                           | `1.5`                              | `VITE_AUDIO_NEWBORN_LOCK_S`             |
| Recovered-mood lock (s)                         | `1.5`                              | `VITE_AUDIO_RECOVERED_LOCK_S`           |
| Birth-burst greeter cap                         | `3`                                | `VITE_AUDIO_BIRTH_BURST_CAP`            |
| Birth-burst window (ms)                         | `400`                              | `VITE_AUDIO_BIRTH_BURST_WINDOW_MS`      |

If a trigger hits while the per-Meeseeks cooldown is active, it's dropped (with
two exceptions: `onFreakingOut`, `onDiedHappy`, `onDiedDefeated` — those always
win and reset the cooldown).

When the global concurrent cap is hit, low-priority ambient considerations are
silently dropped; event-driven triggers are queued for up to 250 ms before
giving up.

**Birth bursts.** When ≥ `VITE_AUDIO_BIRTH_BURST_CAP` Meeseeks are born within
`VITE_AUDIO_BIRTH_BURST_WINDOW_MS` of each other (e.g., from a `snapshot`
message), only the first N greet; the rest silently enter the `newborn`-lock
without speaking. Prevents auditory garbage on bulk loads.

**Cadence sanity check (with the defaults above):**

| Mood          | Approximate "speak every…" |
| ------------- | -------------------------- |
| `healthy`     | 15–20 s                    |
| `declining`   | 10–12 s                    |
| `critical`    | 7–10 s                     |
| `freakingOut` | 4–5 s                      |

These are starting points. Every value is hot-swappable via `.env` — tune by
ear once the sound is wired up.

---

## Worked timelines

Three illustrative runs to sanity-check the design.

### A. A healthy task that ends well

```
t=0.00s  onBorn                  → "I'm Mr. Meeseeks, look at me!"
t=1.30s  chain (35% hit)         → "Can do!"
t=3.50s  ambient tick (12%)      → silence
t=5.40s  ambient tick (12%)      → "Let me try something."
t=8.10s  ambient tick (12%)      → silence
t=9.90s  ambient tick (12%)      → "Can do!"
t=12.0s  onDiedHappy             → "All done!"
```

### B. A long sufferer (decay, freak, recover, decay, die defeated)

```
t=0.00s  onBorn                  → "Mr. Meeseeks!"  (variant)
t=0.95s  chain (35% hit)         → "Can do!"
…
t=15.0s  health crosses 0.4      → "Mistakes don't usually have to exist this long."
t=18.0s  onFreakingOut           → "I just want to die. We all want to die. We're missing!"
                                   (cooldown reset; ambient prob → 50%)
t=20.5s  ambient tick (50% hit)  → "Mistakes don't usually have to exist this long."
t=23.0s  onRecovered             → "Oh, OK."
t=24.7s  ambient tick (25%)      → "Can do!"  (rebuilding)
…
t=40.0s  onDiedDefeated          → "I just want to die..."
```

### C. Two Meeseeks chanting together

Two Meeseeks born ~0.3 s apart, each picks an independent greeting variant.
Their `pitchOffset` keeps them distinguishable. Stereo pan splits them L/R
based on sprite x. Global cap of 4 ensures the third newborn's audio still
plays.

---

## Implementation hints (for the next agent)

You're not implementing here — but when you do, read the architecture rules in
`CLAUDE.md` first. Audio is a **new layer**, plugged in the same way as the
Renderer:

```
   Transport ─AppMessage→ World ─WorldEvent→ { Renderer, AudioSystem }
```

Concretely:

- New module `src/audio.ts` exporting an `AudioSystem` class.
- It implements `bind(world: World): void` exactly like the Renderer does.
- It owns its `AudioContext` and a cache of decoded `AudioBuffer`s.
- It schedules ambient ticks via `requestAnimationFrame` or a `setInterval`-
  with-jitter — your call, document the choice.
- It exposes a narrow test hook on `window.__aquarium.audio` for e2e probing:
  `getLastPlayed(id)`, `setMuted(bool)`, `forceTick()`. Treat that as part of
  the test contract.
- `main.ts` wires it once, after the Renderer. Mute-by-default in tests via a
  `?muted=1` query param or a `data-muted` attribute on `<html>`.
- Add unit tests for the **pure** parts: mood derivation, weighted pick (with
  deterministic random injection), chain decision. Keep AudioContext work
  out of unit and verify the wiring via e2e (Playwright can listen for
  `audio.onplay` events through `page.evaluate`).
- Add an `/add-mood` slash command if more moods appear (e.g., `panicking`,
  `triumphant`) — follow the `/add-event-kind` pattern.

Three pitfalls a fresh agent will hit if not warned:

1. **AudioContext is suspended until user gesture** in modern browsers. The
   first audio after page load needs a user click to unlock — handle this
   gracefully (defer the queue, don't throw).
2. **Don't decode the MP3 on every play.** Decode once at boot, cache the
   `AudioBuffer`, reuse forever.
3. **Don't play through `<audio>` elements** if you want pan/pitch — use Web
   Audio API. `<audio>` is fine if you skip the spatial/pitch variation.

---

## Configuration (.env)

All tunables live in a `.env` (or `.env.local`) file read by Vite at build/dev
time. Vite exposes anything prefixed with `VITE_` to client code via
`import.meta.env.VITE_*`. The implementation must:

- Parse comma-separated lists into `number[]` (e.g., pitch offsets).
- Fall back to the documented default when a var is missing or unparseable.
- **Never throw on bad config** — log a warning, fall back, move on. Audio
  should never crash the aquarium.

```env
# --- Mute / unmute ------------------------------------------------------------
# `true` (default) starts muted with a toggle button next to the counter.
# `false` starts unmuted (handy for video demos).
VITE_AUDIO_DEFAULT_MUTED=true

# --- Voice variants -----------------------------------------------------------
# Comma-separated playbackRate multipliers. Each newborn picks one at random.
# Default below gives one canonical voice + two siblings (lower / higher).
VITE_AUDIO_PITCH_OFFSETS=0.92,1.0,1.08

# --- Birth bursts -------------------------------------------------------------
VITE_AUDIO_BIRTH_BURST_CAP=3
VITE_AUDIO_BIRTH_BURST_WINDOW_MS=400

# --- Cadence (seconds) --------------------------------------------------------
VITE_AUDIO_COOLDOWN_S=2.5
VITE_AUDIO_CHAIN_COOLDOWN_S=4.0
VITE_AUDIO_AMBIENT_TICK_S=2.0
VITE_AUDIO_NEWBORN_LOCK_S=1.5
VITE_AUDIO_RECOVERED_LOCK_S=1.5

# --- Concurrency --------------------------------------------------------------
VITE_AUDIO_CONCURRENT_CAP=4
```

A `.env.example` with these defaults gets committed; `.env` and `.env.local`
stay in `.gitignore` for per-developer overrides.

---

## Resolved decisions

| #  | Question                              | Decision                                                           |
| -- | ------------------------------------- | ------------------------------------------------------------------ |
| 1  | Mute by default?                      | **Yes.** Toggle button rendered next to the `#counter` element.    |
| 2  | One voice or many?                    | **One canonical voice + 2 pitch variants** (3 total, configurable).|
| 3  | Birth burst limit?                    | **First 3 greet** in a 400 ms window. Configurable.                |
| 4  | Cooldown defaults — too chatty?       | **Ship the defaults, tune by ear.** Every cadence value is in `.env`. |
| 5  | Newborn primary line: vary or fix?    | **Fix on `imMrMeeseeks`.** The "I'm Mr. Meeseeks, look at me!" line is iconic enough that randomizing the *first* sound of every birth dilutes it. Variety comes from the chain roll, pitch variant, and pan. `mrMeeseeks` / `lookAtMe` / `canDo` keep weight 0 in the `newborn` row. |
