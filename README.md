# Mr. Meeseeks Aquarium

A playful, PixiJS-powered "aquarium" that visualizes the state of an external
system as Meeseeks creatures being born, living, freaking out, recovering, and
dying. The external system is currently simulated via on-page buttons; a real
WebSocket transport is wired as a stub for later.

**Stack:** TypeScript (strict), Vite, PixiJS v7, Web Audio API, Vitest, Playwright.

---

## Quick start

```bash
npm install
npm run dev
```

Visit `http://localhost:5173` and click the buttons to spawn Meeseeks.

---

## Running with external publishers

If you have an external producer publishing events to the aquarium (e.g. from
`mmb-core`, workers, or atomic agents), use `dev:full` to start both the dev
server and the relay together:

```bash
npm run dev:full
```

This runs Vite and the WebSocket relay in parallel with interleaved, color-coded output.

**Setup the producer to connect to `ws://localhost:8080/ws`** and send `AppMessage`
frames. See [`docs/integration-spec.md`](./docs/integration-spec.md) for the
full contract, examples, and naming conventions.

---

## Commands

```bash
npm run dev              # Vite dev server on :5173 (button-driven)
npm run dev:full        # Vite + relay in parallel (external publishers)
npm run relay           # WebSocket relay on :8080 (standalone)
npm run typecheck       # tsc --noEmit, strict
npm run lint            # ESLint
npm run format          # Prettier --write
npm run build           # tsc + vite build → dist/
npm run preview         # serve dist/ on :4173
npm test                # unit + e2e
npm run test:unit       # Vitest
npm run test:e2e        # Playwright
```

Or use the slash commands:

```
/dev     start the dev server
/check   run typecheck + lint + format:check + unit + e2e
```

---

## Architecture

Decoupled, one-way data flow:

```
Transport ──AppMessage──▶ World ──WorldEvent──▶ { Renderer, AudioSystem }
   ▲                      (state)               (Pixi)    (Web Audio)
   │
buttons / WebSocket / tests
```

**Core layers (no side effects):**

- `world.ts` — state machine, emits `WorldEvent`s
- `transport.ts` — `Transport` interface, `SimulatorTransport`, `WebSocketTransport`
- `types.ts` — `AppMessage`, `MeeseeksState`, `WorldEvents` (wire protocol)

**Pixi + Audio (event-driven):**

- `renderer.ts` — owns Pixi `Application`, subscribes to `WorldEvent`s
- `audio.ts` — owns `AudioContext`, per-mood voice clips

See [`CLAUDE.md`](./CLAUDE.md) for the full architecture, conventions, and
how to add a new event kind.

---

## Guardrails

This repo runs TypeScript (strict), ESLint, Prettier, commitlint, and Husky
hooks. The full survey is in [`docs/guardrails-survey.md`](./docs/guardrails-survey.md).

Run `/check` or `npm test` before committing. Pre-commit hooks enforce format
and lint compliance.

---

## Documentation

- [`CLAUDE.md`](./CLAUDE.md) — agent briefing + architecture rules
- [`docs/integration-spec.md`](./docs/integration-spec.md) — publisher contract (relay URL, message schema, examples)
- [`docs/audio-map.md`](./docs/audio-map.md) — audio system design
- [`docs/guardrails-survey.md`](./docs/guardrails-survey.md) — tooling & sensors

---

## First time?

1. Read [`CLAUDE.md`](./CLAUDE.md) — the rules are there for a reason.
2. Understand the architecture section above.
3. Look at `tests/` to see the contract in action.
4. Open an issue or PR with questions.
