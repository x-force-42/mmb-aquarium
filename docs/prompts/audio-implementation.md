# Implementation prompt — AudioSystem

> **Audience:** an AI coding agent (Claude Code) walking in cold to implement
> the AudioSystem layer.
> **Source of truth:** every decision was made in `docs/audio-map.md`. Read it
> first. This prompt is the _task brief_, not the spec.

---

## Mission

Implement the `AudioSystem` layer for Mr. Meeseeks Aquarium. It's a new layer
that subscribes to World events (alongside the Renderer) and plays Meeseeks
voice clips driven by per-Meeseeks mood. The full mapping — moods, weight
matrix, chains, cooldowns, `.env` variables — is already specified in
`docs/audio-map.md`. Your job is to faithfully translate that spec into
working code, tests, and wiring, **without breaking the existing layering
rules**.

---

## Before you touch any code

Read these in order:

1. `CLAUDE.md` — architecture, conventions, test contract, common pitfalls.
2. `docs/audio-map.md` — the AudioSystem design. **This is your blueprint.**
3. `src/world.ts` and `src/renderer.ts` — the layering pattern you'll mirror.
4. `src/main.ts` — where you'll wire your new layer.

If any of those files raise questions the audio-map doesn't already answer,
**ask before guessing.** The map is intentionally exhaustive; if you're
extrapolating, you're probably wrong.

---

## Setup step (one-time, manual)

The 10 voice clips currently live outside the project at
`/mnt/c/Users/vntelca/Downloads/*.mp3`. Move (or copy) them into the project
under `public/audio/` and rename each to its stable id from the inventory in
`docs/audio-map.md` (the kebab-case ids: `im-mr-meeseeks.mp3`,
`mr-meeseeks.mp3`, `look-at-me.mp3`, `can-do.mp3`, `excuse-me.mp3`,
`let-me-try.mp3`, `oh-ok.mp3`, `mistakes-dont-exist-this-long.mp3`,
`i-just-want-to-die.mp3`, `all-done.mp3`). Renaming on import means the
codebase never embeds the original messy filenames. Confirm with
`ls public/audio/` (10 files) before continuing.

`public/` is the right home — Vite serves it as-is from the site root, so
audio URLs are stable (e.g., `/audio/all-done.mp3`) and `fetch` + `decodeAudioData`
works without import-time bundling.

---

## Deliverables

### New files

| Path                              | Purpose                                                                                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public/audio/*.mp3`              | The 10 renamed voice clips.                                                                                                                                     |
| `.env.example`                    | Documented defaults — copy of the env block from `docs/audio-map.md` → Configuration.                                                                           |
| `src/audio-config.ts`             | Pure module: parses `import.meta.env.VITE_AUDIO_*` into a typed `AudioConfig`, with fallbacks. Never throws.                                                    |
| `src/audio-mood.ts`               | Pure module: `deriveMood(state, ctx) → Mood`. No DOM, no Web Audio. Fully unit-testable.                                                                        |
| `src/audio-pick.ts`               | Pure module: weighted pick over the mood matrix + chain decision. Takes `random: () => number` for determinism.                                                 |
| `src/audio.ts`                    | `AudioSystem` class. Owns the `AudioContext`, decoded buffers, ambient tick, mute toggle, and the `window.__aquarium.audio` test hook.                          |
| `tests/unit/audio-config.test.ts` | Env parsing edge cases (missing, malformed, comma-separated lists).                                                                                             |
| `tests/unit/audio-mood.test.ts`   | Every mood transition (newborn, healthy, declining, critical, freakingOut, recovered, dyingHappy, dyingDefeated), boundary values (`health=0.4`, `health=0.7`). |
| `tests/unit/audio-pick.test.ts`   | Weighted pick respects the matrix, never picks weight-0 entries, excludes the last-played id, chain probabilities behave as specified.                          |

### Modified files

| Path                         | Change                                                                                                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.ts`                | Instantiate `AudioSystem`, call `audio.bind(world)`. Wire the mute toggle button. Extend `window.__aquarium` to include `audio`.                                                         |
| `index.html`                 | Add `<button id="btn-mute">` next to `#counter`. Label reflects state (e.g., 🔇 / 🔊).                                                                                                   |
| `.gitignore`                 | Append `.env`, `.env.local`.                                                                                                                                                             |
| `vitest.config.ts`           | Extend the coverage `exclude` list to drop `src/audio.ts` (Web Audio bound, like the Renderer). The pure helpers (`audio-mood.ts`, `audio-pick.ts`, `audio-config.ts`) stay in coverage. |
| `tests/e2e/aquarium.spec.ts` | Add scenarios: "mute toggle starts on by default", "toggle flips the state on click", "`window.__aquarium.audio` exposes the documented hook surface".                                   |
| `CLAUDE.md`                  | Replace the "Audio system (planned, not yet wired)" section with an implemented-state version pointing to the new files. Add audio hooks to the test contract table.                     |

---

## Architectural rules — non-negotiable

These come from `CLAUDE.md`; do not relax them.

1. **`src/audio.ts` may only import** from `audio-mood.ts`, `audio-pick.ts`,
   `audio-config.ts`, `types.ts`, `world.ts` (for `bind`), and Web Audio APIs.
   No DOM beyond the `<button id="btn-mute">` it reads.
2. **`src/audio-mood.ts`, `audio-pick.ts`, `audio-config.ts` are pure.** No
   DOM, no Web Audio, no `Math.random` calls inline (inject a `random` fn).
3. **`main.ts` is still the only composition root.** `World` and `Renderer`
   must not learn about audio. If you need a piece of world state the renderer
   doesn't surface, expose it via `World` queries — don't reach into private
   fields.
4. **Strict TS, no relaxation.** `noUncheckedIndexedAccess` and
   `exactOptionalPropertyTypes` stay on. If a type fights you, fix the type,
   don't widen the config.
5. **Public test hook** at `window.__aquarium.audio` is part of the contract
   from the moment you ship it:
   - `setMuted(value: boolean): void`
   - `isMuted(): boolean`
   - `getLastPlayed(id: MeeseeksId): string | null` — returns the clip id, not the URL.
   - `forceTick(): void` — runs one ambient tick immediately (test convenience).
6. **No new runtime dependencies.** Web Audio API is built into the browser.
   If you're tempted to add `howler.js` or similar, stop and justify it in
   chat first.

---

## Acceptance criteria

Run `/check` (or `npm run typecheck && npm run test:unit && npm run test:e2e`)
at the end. All of the following must be true:

- `tsc --noEmit` passes with no errors.
- Existing unit tests still pass (no regression in Emitter / World / Transport / colors).
- New unit tests pass: `audio-config`, `audio-mood`, `audio-pick`.
- Existing e2e scenarios still pass.
- New e2e scenarios pass.
- `npm run build` succeeds end-to-end.
- Manual smoke (you may describe steps; we'll run them):
  - Page loads with mute ON by default; no audio plays.
  - Clicking the mute button switches state and reflects in `__aquarium.audio.isMuted()`.
  - With mute OFF, `Nasce Meeseeks` triggers a greeting; subsequent ambient ticks play more lines.
  - `Surta (aleat.)` immediately triggers a freak-out line, ignoring cooldown.
  - `Mata feliz` plays `all-done.mp3` exactly once, then the sprite poofs.
  - Bursting 5 births in <400 ms makes only 3 of them greet.

---

## Out of scope

Don't sneak any of this in. Bring it up as a follow-up:

- Real WebSocket transport (still a stub; keep it that way).
- Per-Meeseeks audio packs or theme variants beyond the 3 pitch variants.
- 3D spatial audio (HRTF, panner nodes). Plain stereo `StereoPannerNode` is fine.
- Audio compression / dynamics processing. Trust the source MP3s.
- Replacing the existing matchers / refactoring unrelated tests.

---

## Pitfalls (read before debugging)

1. **`AudioContext` is suspended until a user gesture** in Chrome/Firefox/Safari.
   Your first `decodeAudioData` is fine, but `BufferSource.start()` won't make
   sound until after a user click. Mute-ON-by-default sidesteps this nicely —
   the first sound is gated behind the user clicking the mute button anyway.
2. **Decode once, not per play.** Cache the 10 `AudioBuffer`s after boot. Each
   playback is a fresh `AudioBufferSourceNode` that points at the shared buffer.
3. **Don't use `<audio>` elements** if you want pitch/pan/volume control. Web
   Audio API only.
4. **Per-Meeseeks `pitchOffset`** is one of the three configured variants,
   chosen at birth and stored on a side map (`Map<MeeseeksId, MeeseeksAudioState>`)
   — not on `MeeseeksState` (don't pollute the world's domain model).
5. **Spec is in seconds**, but `setTimeout`/Web Audio scheduling uses milliseconds.
   Centralize the conversion; don't sprinkle `* 1000` everywhere.
6. **The newborn-mood lock matters.** If you skip it, a `state` event the
   moment after birth can flip the mood to `healthy` and rob the greeting of
   its chain. The lock is in the spec for a reason.
7. **Files have been truncated mid-write in this project before** (root cause
   unclear, possibly FS overlay on the sandbox). After you write any file
   larger than ~5 KB, re-read its last 5 lines to confirm it's intact.
8. **Don't commit `.env` or `.env.local`.** Only `.env.example` goes in git.

---

## How to ask for help

If the spec is ambiguous on a specific detail — for example, "should the
mute button label use an emoji or a word?" — ask in chat _before_ picking
and shipping. The audio map's "Resolved decisions" table is final; anything
outside it is fair game to clarify.

When you're done, report:

- Files created / modified (path + brief purpose).
- Test results (typecheck + unit + e2e).
- Any deviation from the spec, with rationale.
- Manual smoke results.

Then propose a commit message and tag bump (suggested: `v0.3.0`, since
this is a new layer / minor feature). Don't commit without explicit
confirmation.
