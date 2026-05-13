---
description: Add a new EventKind end-to-end, following the recipe in CLAUDE.md
argument-hint: <event-name> [--visual]
allowed-tools: Read, Edit, Write, Bash, Grep, Glob
---

Add a new `EventKind` named `$ARGUMENTS` to the project.

Follow the **"Adding a new EventKind"** recipe in `CLAUDE.md` exactly — touch
each of the 9 listed files in order. Do not skip a step; if a step doesn't
apply (e.g. the event isn't user-triggered), say so explicitly in your reply.

After every file edit, sanity-check that no other layer broke. After all edits,
run `/check`.

Hard rules:

- The new event name must be `snake_case` to match existing kinds (`born`,
  `died_happy`, `freaking_out`, etc).
- The corresponding World event handler in `WorldEvents` must follow the
  `onPascalCase` naming convention (`onBorn`, `onDiedHappy`, ...).
- Add at least three unit tests in `tests/unit/world.test.ts`: happy path,
  idempotency (or "ignored when precondition fails"), and unknown-id no-op.
- Add at least one e2e scenario in `tests/e2e/aquarium.spec.ts`.
- If the event has a visual side effect, add the animation in `sprite.ts`
  (or a new module if it deserves its own home) — never inline it in `renderer.ts`.

Reference: `CLAUDE.md` — sections "Architecture", "Common workflows", "Pitfalls".
