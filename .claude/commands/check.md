---
description: Run typecheck + lint + format:check + unit + e2e and report failures cleanly
allowed-tools: Bash, Read, Grep
---

Run the full verification suite, in this order, stopping on the first failure:

1. `npm run typecheck`
2. `npm run lint`
3. `npm run format:check`
4. `npm run test:unit`
5. `npm run test:e2e`

For each failure:

- Identify the affected layer (transport / world / renderer / tests / tooling).
- For lint/format failures, follow the "Sensor → Agent action" rows in `CLAUDE.md` ("Tooling guardrails" section). Auto-fix with `npm run lint:fix` / `npm run format` where it's safe; if a rule fires on intentional code, suppress per-line with a `-- reason:` comment.
- For test failures: read the failing test file AND the source it exercises before proposing a fix.
- Prefer fixing the bug over relaxing the assertion. If the assertion is the bug, say so explicitly and explain why.
- If the failure is in the e2e suite and the unit tests are green, the bug is likely at the layer boundary (composition in `main.ts`, the `window.__aquarium` hook, or the renderer).

Reference: `CLAUDE.md` — see "Tooling guardrails", "The test contract", and "Common workflows".
