# Mr. Meeseeks Aquarium — Agent Briefing

A 60-second orientation for any coding agent (you) walking into this repo cold.
Read this before touching code. Re-read the relevant section before any non-trivial change.

---

## What this is

A playful, PixiJS-powered "aquarium" that visualizes the state of an external
system as Meeseeks creatures being born, living, freaking out, recovering, and
dying. The external system is currently simulated via on-page buttons; a real
WebSocket transport is wired as a stub for later.

**Stack:** TypeScript (strict), Vite, PixiJS v7, Web Audio API, Vitest, Playwright.

---

## Architecture (the single most important section)

Decoupled layers, one-way data flow:

```
   Transport  ──AppMessage──▶  World  ──WorldEvent──▶  { Renderer, AudioSystem }
       ▲                       (state)                   (Pixi)    (Web Audio)
       │
   buttons / WebSocket / tests
```

**The rules — do not break them without a deliberate design discussion:**

1. **`world.ts` imports only `emitter` and `types`.** No DOM, no Pixi, no transports. This is the testable core.
2. **`transport.ts` imports only `types`.** It produces `AppMessage`s. It consumes a thin `WorldQuery` interface — never the `World` class itself.
3. **`renderer.ts` imports `world` (for `bind`), `sprite`, `particle`, `colors`, `types`.** It subscribes to events; it never pushes back into the world.
4. **`audio.ts` imports `world` (for `bind`), `audio-mood`, `audio-pick`, `audio-config`, `types` only.** It subscribes to events; never pushes back into the world. Pure helpers (`audio-mood.ts`, `audio-pick.ts`, `audio-config.ts`) have no DOM / no Web Audio so they're fully unit-testable.
5. **`main.ts` is the ONLY file that wires concrete classes together.** Composition root. If you find yourself importing `World` in `transport.ts`, you've taken a wrong turn.
6. **All cross-layer comms are typed.** `AppMessage` going into the world, `WorldEvents` coming out. If you add a new comm shape, update `types.ts` first.

---

## File map

```
src/
  types.ts          ── AppMessage, MeeseeksState, WorldEvents, WorldQuery  (no logic)
  emitter.ts        ── Emitter<TEvents> generic typed event bus
  world.ts          ── World class; full state machine; pure
  transport.ts      ── Transport interface + SimulatorTransport + WebSocketTransport
  colors.ts         ── lerp, lerpColor, healthColor (pure math)
  sprite.ts         ── MeeseeksSprite (Pixi-coupled; animation logic)
  particle.ts       ── Particle (Pixi-coupled; death effects)
  renderer.ts       ── Renderer; owns the Pixi Application
  audio-config.ts   ── parseAudioConfig(env) → AudioConfig (pure, never throws)
  audio-mood.ts     ── deriveMood(state, ctx) → Mood (pure)
  audio-pick.ts     ── AudioId inventory, weight matrix, pickAudio, pickChain (pure)
  audio.ts          ── AudioSystem; owns AudioContext + decoded buffers
  main.ts           ── boot(): wires Transport ↔ World ↔ { Renderer, AudioSystem }

public/
  audio/*.mp3       ── 10 Meeseeks voice clips, served at /audio/<file>.mp3

tests/
  unit/             ── Vitest, happy-dom env
    emitter.test.ts, world.test.ts, transport.test.ts, colors.test.ts
    audio-config.test.ts, audio-mood.test.ts, audio-pick.test.ts
  e2e/
    aquarium.spec.ts  ── Playwright; runs against `vite preview`
```

Coverage strategy: unit tests cover the testable cores (world, transport, emitter, colors,
plus the three pure audio helpers). The Pixi- and Web-Audio-dependent files (renderer,
sprite, particle, audio) are excluded from unit coverage (see `vitest.config.ts`) and
verified by the e2e suite instead.

---

## Quick commands

```
npm install              ── one-time
npm run dev              ── Vite dev server on :5173
npm run typecheck        ── tsc --noEmit, strict
npm run test:unit        ── Vitest
npm run test:unit:watch  ── Vitest in watch mode
npm run test:e2e         ── Playwright (auto-installs chromium on first run)
npm run test:e2e:install ── force playwright install --with-deps chromium
npm run build            ── tsc + vite build → dist/
npm run preview          ── serve dist/ on :4173 (what Playwright hits)
```

> **First-time setup gotcha.** The very first `npm run test:e2e` will download
> the Chromium binary (~150MB) via the `pretest:e2e` hook. Subsequent runs are
> idempotent — Playwright skips the download if the binary is already there.
> If you see `Executable doesn't exist at ...chrome-headless-shell.exe` and the
> hook didn't run (e.g. because you invoked `playwright test` directly), run
> `npm run test:e2e:install` manually.

Or use the slash commands:

```
/check   run typecheck + unit + e2e and report
/dev     start the dev server
/add-event-kind <name>   recipe to add a new EventKind end-to-end
```

---

## The test contract (`window.__aquarium`)

`main.ts` exposes a stable test hook:

```ts
window.__aquarium = { world, renderer, sim, audio };
```

E2E tests rely on this. Treat it as part of the public API.

| Surface                          | Used by                       |
| -------------------------------- | ----------------------------- |
| `world.size()`                   | counter assertions            |
| `world.getAll()` / `getAlive()`  | health, name, task probes     |
| `world.getFreakingOut()`         | round-trip freak/recover      |
| `world.get(id)`                  | id-specific assertions        |
| `renderer.spriteCount()`         | render parity                 |
| `renderer.hasSprite(id)`         | render parity                 |
| `renderer.spritePanX(id)`        | normalised x-pan for audio    |
| `sim.born()`, `sim.killHappy()`, `sim.giveUp()`, `sim.triggerFreakOut()`, `sim.recover()`, `sim.decayAll(amount?)` | scenario setup |
| `audio.setMuted(value)` / `audio.isMuted()` | mute toggle probes     |
| `audio.getLastPlayed(id)`        | per-Meeseeks last clip (camelCase id, or `null`) |
| `audio.forceTick()`              | run an ambient consideration immediately (no-op while muted) |

**Rule:** never remove or rename a member of this surface without updating
`tests/e2e/aquarium.spec.ts` in the same change.

---

## Conventions

### TypeScript

- **Strict mode is on, including:**
  - `noUncheckedIndexedAccess` — `arr[i]` is `T | undefined`. Use `??`, narrow, or assert.
  - `exactOptionalPropertyTypes` — for `name?: string`, **omit the key** instead of setting it to `undefined`. Use `{ ...(name !== undefined ? { name } : {}) }` if you have to spread.
  - `noUnusedLocals` / `noUnusedParameters` — prefix unused params with `_` if intentional.

- **Imports:** no extensions (`import { World } from './world'`). Vite's bundler resolution handles it.

- **`readonly`** on internal collections and on public state fields that aren't supposed to mutate from outside.

### State integrity

- World queries (`getAll`, `getAlive`, `getFreakingOut`, `get`) return **defensive copies**. Mutating them does NOT mutate world state.
- A `snapshot` message **WIPES the world** and re-emits `onBorn` for each entry. It's a reset, not a delta.
- Death events (`died_happy`, `died_defeated`) **remove from the world immediately** while the renderer plays the death animation on a sprite it owns. This decoupling is intentional — don't try to make them transactional.

### Color math

- Colors are `0xRRGGBB` numbers, used both in our code and as Pixi tints.
- `Math.round(127.5) === 128` in JS. If you're writing color tests, do the math by hand.

### Renderer

- Sprites are drawn as **white-filled rects with `tint`** for color. Cheaper than re-drawing geometry on color changes.
- `image-rendering: pixelated` is set on the canvas. Keep it. Don't antialias.
- Spawn position has a 30-attempt overlap check. If all attempts fail, the last candidate is used. Don't add a busy-loop retry; gracefully degrade.

---

## Common workflows

### Adding a new `EventKind` (e.g. `'promoted'`)

Touch points, in order:

1. **`src/types.ts`**
   - Add to `EventKind` union: `| 'promoted'`
   - Add to `WorldEvents`: `onPromoted: (m: MeeseeksState) => void`
2. **`src/world.ts`**
   - New case in `applyEvent`'s switch. Apply state transition, emit the event.
3. **`tests/unit/world.test.ts`**
   - Cover: happy path, idempotency, unknown id, "ignored when precondition fails".
4. **`src/renderer.ts`**
   - Subscribe in `bind()`, route to a sprite hook.
5. **`src/sprite.ts`**
   - Implement the hook + animation in `update`.
6. **`src/transport.ts`** (if user-triggered via a button)
   - Add an action method like `promote()` that emits the event.
   - Wire it in `bindButtons`.
7. **`index.html`**
   - Add the button with a stable id.
8. **`src/main.ts`**
   - Pass the new button id to `sim.bindButtons({...})`.
9. **`tests/e2e/aquarium.spec.ts`**
   - Add a scenario that clicks the button and asserts the world state via `window.__aquarium`.

Run `/check`. If any layer is missing, the build/tests will tell you which.

### Plugging in the real WebSocket transport

The stub is `WebSocketTransport` in `src/transport.ts`.

1. Implement `connect()`: `new WebSocket(this.url)`, listen to `'message'`, `JSON.parse` and **always run through `isAppMessage` before emitting**.
2. In `src/main.ts`, swap or compose:
   ```ts
   // Replace:
   const sim = new SimulatorTransport(world);
   // With:
   const ws = new WebSocketTransport('wss://...');
   ws.onMessage((msg) => world.handleMessage(msg));
   ws.connect();
   ```
   You can run both transports simultaneously — both will feed the same `world.handleMessage`.
3. Don't forget to drop the button-binding call if the simulator is gone.

### Adding a field to `MeeseeksState`

1. `src/types.ts`: extend `MeeseeksState`. Decide if it goes on the snapshot entry too.
2. `src/world.ts`: include the field in `applySnapshot`, the `born` branch of `applyEvent`, and the `copy()` helper.
3. `tests/unit/world.test.ts`: assert the new field in the cases it affects.
4. If it's visual, surface it in `sprite.ts` (probably via an event hook + ticker).

---

## Audio system

Implemented. `AudioSystem` plugs in alongside the Renderer and gives each
Meeseeks a voice driven by mood. The full design — moods, weight matrix,
cooldowns, chain rules, `.env` knobs — lives in
[`docs/audio-map.md`](./docs/audio-map.md). The implementation brief that
shipped it is in [`docs/prompts/audio-implementation.md`](./docs/prompts/audio-implementation.md).

Files:

```
src/audio-config.ts  ── parseAudioConfig(env) → AudioConfig; never throws.
src/audio-mood.ts    ── deriveMood(state, ctx) → Mood; pure.
src/audio-pick.ts    ── AudioId inventory, weight matrix, pickAudio, pickChain; pure.
src/audio.ts         ── AudioSystem class: AudioContext, buffer cache, ambient ticker,
                        per-Meeseeks state, mute toggle, test hooks.
```

Composition is one-way, like the Renderer:

```
Transport ─AppMessage→ World ─WorldEvent→ { Renderer, AudioSystem }
```

Knobs live in `.env` (`VITE_AUDIO_*`) — see [`.env.example`](./.env.example).
Per-developer overrides go in `.env.local`; `.env*` is gitignored except for
the example.

Mute defaults to ON. The mute button (`#btn-mute`) is also the user-gesture
that resumes the `AudioContext` in browsers that suspend it until interaction.

---

## Known issues / non-goals

- **Some unit/e2e tests may currently be failing.** Triage with `npm run test:unit` and `npm run test:e2e`, then fix the *behavior* — do not relax the assertion to make red go green.
- **Animation behaviors are e2e-tested, not unit-tested.** Don't try to mock Pixi for animation. The ROI is bad.
- **No bundler-free build.** We deliberately adopted Vite when we moved to TypeScript. `index.html` no longer loads from a CDN.

---

## Pitfalls fresh agents hit

1. Trying to inspect Meeseeks via DOM selectors. They're Pixi sprites — no DOM. Use `window.__aquarium`.
2. Forgetting that `snapshot` **wipes** the world. If you're emitting one as a "patch", you're wrong; use individual messages.
3. Editing `dist/` instead of `src/`. `dist/` is a build artifact and is gitignored.
4. Asserting on a sprite's existence right after a death event. The world removes it immediately, but the sprite plays its death animation for ~1.5s before the renderer reaps it. Assert against `world.size()` for state, against `renderer.spriteCount()` for visuals.
5. Adding `undefined` to an optional field. TS strict (`exactOptionalPropertyTypes`) will reject it. **Omit the key.**

---

## When in doubt

1. Open the relevant `tests/` file — it's the most precise spec we have.
2. Then open the source file that owns the behavior.
3. Change one layer at a time. Run `/check` between changes.
4. If you're about to add a runtime dependency, ask first. The current dep list is intentionally small.
