# Guardrails survey — sensors and feedback for the aquarium stack

> Status: **survey / opinion piece**. Reading this should be enough to decide
> what to install and in what order. Concrete install instructions come in a
> follow-up prompt once we agree on the shortlist.

---

## Why this exists

The project is mostly written by AI agents now. That changes the cost / value
math of every guardrail:

- **Agents are fast at writing code, but slow to notice consequences**
  (unused imports, dead exports, `any` creeping in, indentation drift,
  files that get truncated mid-write — see our actual history).
- **A guardrail is a sensor + a feedback loop.** The sensor detects a
  bad state; the feedback either fixes it automatically or blocks the next
  step until a human/agent resolves it.
- **Faster feedback wins.** A check that fires in the editor while the agent
  is typing is worth ten times one that fires in CI after the push.

So the survey is organized by **when the sensor fires**, not by tool category.
For each, I note our stack fit, the install cost, and signal-to-noise risk
(false positives are worse than no sensor — agents learn to ignore noisy ones).

---

## The feedback-loop view

```
   ┌─ author-time ─┐    save     stage     commit    push    PR / CI    release
   │   while       │     │         │         │         │        │           │
   │   typing      │     │         │         │         │        │           │
   ▼               ▼     ▼         ▼         ▼         ▼        ▼           ▼
  IDE          format   lint     unit     conv-       full    integration  changelog
  inference    on-save  fix      tests    commits    suite   coverage     version
  (tsc)        (Prettier) (eslint  (changed)         on remote
               (eslint   --fix on  files)
                hints)  staged)
```

Three rules of thumb when picking what goes at which stage:

1. **Cheap, fast, deterministic → push it as early as possible.**
   Formatting on save costs nothing; running e2e on save costs everything.
2. **Same check, repeated across stages, is fine.** Editor lints + lint-staged
   on commit + lint in CI is normal. Each stage catches what the previous
   stage skipped (offline, hooks disabled, etc).
3. **Hard fails in CI; auto-fix locally.** The local stages should auto-fix
   what's mechanical (formatting, simple lint rules). The PR stage should
   refuse to merge if anything's still off.

---

## What we already have

| Sensor                          | Stage               | Notes                                                              |
| ------------------------------- | ------------------- | ------------------------------------------------------------------ |
| TypeScript strict + extras      | author / pre-commit | `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.          |
| Vitest unit suite               | pre-commit / CI     | Pure modules covered; renderer/sprite/particle excluded by design. |
| Playwright e2e                  | CI / before merge   | Now auto-installs chromium via `pretest:e2e`.                      |
| @vitest/coverage-v8             | on-demand           | `npm run test:unit:coverage`.                                      |
| monocart-reporter               | on-demand           | E2E coverage via CDP, gated behind `COVERAGE=1`.                   |
| `.gitignore` + `.gitattributes` | always              | Line-ending sanity + ignore list.                                  |
| Slash commands                  | agent-driven        | `/check`, `/dev`, `/add-event-kind`.                               |
| CLAUDE.md briefing              | agent-driven        | Architecture rules, test contract, pitfalls.                       |

Gaps the survey below is trying to fill:

- No lint (style, anti-patterns, dead code, formatting drift).
- No git hooks — anyone can commit broken code if they bypass `/check`.
- No commit message validation (we've been doing conventional commits by hand).
- No dependency audit on a cadence.
- No CI pipeline (everything is local; first push to GitHub will need one).

---

## Candidate tools, by stage

### Author-time / save-time (in the editor)

| Tool                                                   | What it catches                                                         | Stack fit | Install cost | Recommendation                                                                                       |
| ------------------------------------------------------ | ----------------------------------------------------------------------- | --------- | ------------ | ---------------------------------------------------------------------------------------------------- |
| **ESLint** (+ `typescript-eslint`)                     | Anti-patterns, unused vars, `any`, missing returns, broken hooks, etc.  | Excellent | Medium       | **Install.** Core guardrail.                                                                         |
| `eslint-plugin-import`                                 | Import order, no-cycle, no-unresolved.                                  | Excellent | Low          | **Install with ESLint.**                                                                             |
| `eslint-plugin-promise`                                | Missing `await`, returned promise not handled.                          | Good      | Low          | **Install.**                                                                                         |
| `eslint-plugin-vitest`                                 | `expect` outside `it`, focused tests (`it.only`), bad mocks.            | Good      | Low          | **Install** — agents leave `.only` in code by accident.                                              |
| `eslint-plugin-playwright`                             | `await` missing on locators, wrong assertions, test isolation issues.   | Good      | Low          | **Install.**                                                                                         |
| `eslint-plugin-unicorn`                                | Opinionated modernization rules. Lots of suggestions; noisy by default. | OK        | Low          | Skip — false-positive risk on stylistic preferences.                                                 |
| `eslint-plugin-jsdoc`                                  | JSDoc shape validation.                                                 | Low       | Low          | Skip — we don't lean on JSDoc.                                                                       |
| `eslint-plugin-security`                               | Common JS security anti-patterns.                                       | OK        | Low          | Skip for now — meant for server code mostly.                                                         |
| **Prettier**                                           | Formatting consistency.                                                 | Excellent | Low          | **Install.** Stop arguing about commas.                                                              |
| **EditorConfig** (`.editorconfig`)                     | Baseline tab/eol/charset for any editor.                                | Excellent | Trivial      | **Install** — covers editors that don't read Prettier.                                               |
| **VSCode `.vscode/settings.json` + `extensions.json`** | "Format on save", recommended extensions.                               | Excellent | Trivial      | **Install** — zero-cost productivity boost.                                                          |
| **oxlint** (Rust ESLint clone)                         | ~50x faster lint runner; only a subset of rules.                        | OK        | Low          | Wait — usable as a fast pre-commit step later, but ESLint coverage is broader today.                 |
| **Biome**                                              | Combined formatter + linter, Rust-based, ~100x faster.                  | Good      | Medium       | Consider as a future migration target if ESLint+Prettier feels slow. Not now — ecosystem is younger. |

### Stage-time (when running `git add`, before commit)

| Tool                 | What it does                                                  | Stack fit | Install cost | Recommendation                                          |
| -------------------- | ------------------------------------------------------------- | --------- | ------------ | ------------------------------------------------------- |
| **lint-staged**      | Runs Prettier/ESLint **only** on staged files. Fast feedback. | Excellent | Trivial      | **Install** with husky.                                 |
| **husky**            | Standard git hooks manager. Hooks live in `.husky/`.          | Excellent | Low          | **Install.** De-facto.                                  |
| **simple-git-hooks** | Tiny, no-dependency alternative to husky.                     | Good      | Trivial      | Consider as lighter swap if husky feels heavy. Same UX. |
| **lefthook**         | Cross-language, fast, parallel hooks. Good for monorepos.     | OK        | Low          | Overkill for a single-package project.                  |

### Commit-time

| Tool                                                 | What it enforces                             | Stack fit | Install cost | Recommendation                                       |
| ---------------------------------------------------- | -------------------------------------------- | --------- | ------------ | ---------------------------------------------------- |
| **commitlint** (+ `@commitlint/config-conventional`) | Commit messages follow Conventional Commits. | Excellent | Low          | **Install.** Locks in what we've been doing by hand. |
| commitizen / `cz-conventional-changelog`             | Interactive commit prompt.                   | Good      | Low          | Optional — nice for humans, agents won't use it.     |
| `commitlint-format-juicy` etc.                       | Pretty-print of failures.                    | -         | Trivial      | Optional — quality-of-life.                          |

### Push-time

| Tool                  | What it does                                        | Stack fit | Install cost | Recommendation                             |
| --------------------- | --------------------------------------------------- | --------- | ------------ | ------------------------------------------ |
| `husky` pre-push hook | Run `typecheck` + `test:unit` before allowing push. | Excellent | Trivial      | **Install** (same husky we already added). |

### CI (after push, before merge)

| Tool                    | What it does                                                 | Stack fit | Install cost | Recommendation                                           |
| ----------------------- | ------------------------------------------------------------ | --------- | ------------ | -------------------------------------------------------- |
| **GitHub Actions**      | Free for public repos; trivially integrates `npm run check`. | Excellent | Medium       | **Install** when the repo lands on GitHub.               |
| **act**                 | Run Actions locally for debugging the workflow.              | Excellent | Low          | Install on-demand, not in CI.                            |
| GitLab CI               | If we ever move; same shape as Actions.                      | OK        | Medium       | Pick when we commit to a host.                           |
| **Codecov / Coveralls** | Coverage trend tracking with a badge.                        | Good      | Low          | Optional — only useful once a team is reading the trend. |

### Code health (on-demand / nightly)

| Tool                    | What it catches                                                                                                                         | Stack fit | Install cost | Recommendation                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------ | ----------------------------------------------------------------------------------------- |
| **knip**                | Unused files, unused exports, unused dependencies — in one tool.                                                                        | Excellent | Low          | **Install** — high-signal for AI-written code.                                            |
| ts-prune                | Unused TS exports (subset of knip).                                                                                                     | Good      | Low          | Skip — knip supersedes it.                                                                |
| depcheck                | Unused npm deps.                                                                                                                        | OK        | Low          | Skip — knip covers this.                                                                  |
| **madge** / dpdm        | Circular dependencies.                                                                                                                  | Good      | Low          | **Install madge** — cycle into world.ts / renderer.ts is the kind of thing that ruins us. |
| **dependency-cruiser**  | Encode the architecture rules from CLAUDE.md (e.g. "`world.ts` only imports `emitter` + `types`") as executable contracts that fail CI. | Excellent | Medium       | **Install** — makes our layering rules a sensor instead of a polite request.              |
| size-limit / bundlesize | Bundle size budget.                                                                                                                     | OK        | Medium       | Skip for now — Pixi dominates the bundle and we accept that.                              |

### Code smell / "minimal Sonar"

| Tool                        | What it catches                                                                                                                                                                         | Stack fit | Install cost | Recommendation                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------ | ------------------------------------------------------------------------------------------ |
| **`eslint-plugin-sonarjs`** | Ports ~60 SonarJS rules into ESLint: cognitive complexity, duplicate strings, identical functions, collapsible-ifs, redundant booleans, useless catches, switch-with-only-default, etc. | Excellent | Low          | **Install** — this _is_ our "Sonar minimalist" without a server.                           |
| **`jscpd`**                 | Copy/paste duplicate-block detector. CLI-only; outputs a quick report.                                                                                                                  | Good      | Low          | **Install** as an on-demand CLI; gate in CI later if duplication grows.                    |
| SonarCloud                  | Full SonarQube hosted on the cloud; free for public repos.                                                                                                                              | Good      | Medium       | Optional — only meaningful once the repo is public on GitHub and we want trend dashboards. |
| Codacy / DeepSource         | Hosted code-quality dashboards with free tiers.                                                                                                                                         | OK        | Medium       | Skip — overlaps with what `eslint-plugin-sonarjs` already gives locally.                   |
| GitHub CodeQL               | Semantic security analysis; free on public repos.                                                                                                                                       | OK        | Low          | Optional — turn on the default GitHub config when the repo is public.                      |

### Security

| Tool            | What it catches                                               | Stack fit | Install cost | Recommendation                                             |
| --------------- | ------------------------------------------------------------- | --------- | ------------ | ---------------------------------------------------------- |
| **`npm audit`** | Known CVEs in dependency tree. Built-in.                      | Excellent | None         | **Already available** — wire into CI.                      |
| **Dependabot**  | PRs that bump vulnerable / outdated deps.                     | Excellent | Trivial      | **Install on GitHub.** Free.                               |
| Renovate        | More configurable Dependabot alternative.                     | Excellent | Medium       | Pick over Dependabot only if you want fine-tuned grouping. |
| Snyk            | Deeper vuln scanning + license issues. Free tier OK.          | OK        | Low          | Optional — `npm audit` + Dependabot covers the basics.     |
| Socket.dev      | Supply-chain anomalies (typosquatting, install scripts, etc). | Good      | Low          | Optional — useful once dep count grows.                    |

### Docs / consistency

| Tool                 | What it catches                                                       | Stack fit | Install cost | Recommendation                                           |
| -------------------- | --------------------------------------------------------------------- | --------- | ------------ | -------------------------------------------------------- |
| **markdownlint**     | Inconsistent markdown (heading levels, table alignment, link syntax). | Good      | Low          | **Install** — our docs are agent-written and drift fast. |
| Prettier (for `.md`) | Same formatter as code.                                               | Excellent | Trivial      | **Install** (already implied by Prettier above).         |
| `cspell`             | Spell check across code + docs.                                       | OK        | Medium       | Skip — false-positive heavy for technical jargon.        |
| `alex`               | Inclusive-language nudges.                                            | -         | Low          | Skip — out of scope.                                     |

---

## Recommended minimal set (ship this now)

Eight tools that cost almost nothing and recover almost everything we've been
doing by hand:

1. **ESLint** (flat config) + `typescript-eslint` + `eslint-plugin-import` + `eslint-plugin-promise` + `eslint-plugin-vitest` + `eslint-plugin-playwright`
2. **`eslint-plugin-sonarjs`** — code smell / cognitive complexity rules ("minimal Sonar")
3. **Prettier** (formatter)
4. **EditorConfig** (`.editorconfig`)
5. **husky** + **lint-staged** (pre-commit auto-fix)
6. **commitlint** + `@commitlint/config-conventional` (enforces Conventional Commits format; scope policy left **free-form** for now)
7. **knip** (unused files / exports / deps, on-demand)
8. **dependency-cruiser** (encodes the CLAUDE.md layering rules as an executable contract)

That's one `npm install -D` block. Adds: `eslint.config.js`,
`.prettierrc`, `.editorconfig`, `.husky/pre-commit`, `commitlint.config.js`,
`.dependency-cruiser.cjs`. Total surface area: 6 small config files.

After this: a `git commit` would auto-format, lint-fix the staged files,
refuse the commit if the message isn't Conventional, and CI would fail any
PR that imports across forbidden layer boundaries.

## Recommended extended set (after the basics are calm)

Add when the minimal set is stable:

9. **GitHub Actions** workflow that runs `typecheck + lint + test:unit + test:e2e + knip + dependency-cruiser + npm audit` on every PR.
10. **Dependabot** (free, just enable in repo settings).
11. **madge** for a visual circular-dep graph (dependency-cruiser already enforces; madge is more for humans reading).
12. **markdownlint** for `docs/` and `CLAUDE.md`.
13. **`jscpd`** as an occasional duplication report.
14. **SonarCloud** _or_ **CodeQL** — only once the repo is public on GitHub.

## Explicit overkill (don't add)

- **Snyk / Socket.dev paid tiers** — `npm audit` + Dependabot covers a 1-person project's needs.
- **Codecov dashboards** — we don't have a coverage trend story yet; it's vanity.
- **cspell** — false positives on Pixi / Meeseeks / domain jargon.
- **Bundle-size budgets** — Pixi dominates; we'd be policing a constant.
- **Subagent definitions in `.claude/agents/`** — at our codebase size, a generalist agent + good slash commands is fine.
- **Pre-push e2e** — too slow; e2e belongs in CI.

---

## Sensor → Agent action matrix

Crucial part of "instructions for any AI agent on what to do when a sensor
trips." Worth living in `CLAUDE.md` once we wire any of this.

| Sensor                                           | Severity | What the agent must do                                                                                                                                                   |
| ------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tsc --noEmit` error                             | hard     | Fix the type. **Never widen `tsconfig.json` or add `any` to silence it.** If a third-party type is wrong, narrow with a tight `as` cast + a code comment explaining why. |
| ESLint error                                     | hard     | Read the rule docs, then fix the cause. Only `// eslint-disable-next-line <rule>` with a `// reason: …` comment, and only if the rule genuinely doesn't fit this case.   |
| ESLint warning                                   | soft     | Fix or suppress in the same commit. If suppressed, mention it in the commit body.                                                                                        |
| Prettier diff                                    | hard     | Run Prettier; never hand-format. If Prettier's choice feels wrong, fix `.prettierrc`, not the code.                                                                      |
| Unit test failure                                | hard     | Fix the behavior. **Never relax the assertion** unless the assertion itself was the bug (justify in commit).                                                             |
| E2E test failure                                 | hard     | Read the trace. First check the `window.__aquarium` hook; then the renderer; then the world. Don't increase a `timeout` to make red go green.                            |
| commitlint failure                               | hard     | Reword the commit message to match Conventional Commits. See the type table in CLAUDE.md.                                                                                |
| knip — unused export                             | soft     | Either consume the export, delete it, or — if it's a public API — add a `// knip-ignore: <reason>`.                                                                      |
| knip — unused file                               | hard     | Delete it. If it's a fixture or sample, move under `tests/` or `docs/`.                                                                                                  |
| madge — circular dependency                      | hard     | Refactor to break the cycle. The architecture rules in CLAUDE.md exist to prevent these; if you got one, you broke a layer.                                              |
| dependency-cruiser — forbidden import            | hard     | You imported across a layer boundary. Re-read CLAUDE.md "Architecture"; the fix is structural, not an exception in `.dependency-cruiser.cjs`.                            |
| sonarjs — cognitive complexity                   | hard     | Extract a helper; the function is doing too much. Don't bump the threshold to silence it.                                                                                |
| sonarjs — duplicate-string / identical-functions | soft     | Extract to a constant or shared util. If duplication is intentional (e.g., two copies of a fixture), suppress with a reason comment.                                     |
| npm audit (high / critical)                      | hard     | Bump the affected dep. If no fix exists yet, document it and add a TODO.                                                                                                 |
| npm audit (low / moderate)                       | soft     | Note in the commit body; don't block.                                                                                                                                    |
| Coverage drop > 2 %                              | soft     | Add a unit test for the dropped path before merging. Only acceptable drop is for excluded layers (Renderer/Sprite/Particle).                                             |
| Bundle size grew > N %                           | n/a      | Not enforced yet.                                                                                                                                                        |

---

## Resolved decisions

| #   | Question                            | Decision                                                                                                                                                    |
| --- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | ESLint flat config or legacy?       | **Flat** (`eslint.config.js`). ESLint 9+ recommended baseline.                                                                                              |
| 2   | Pre-commit cadence?                 | **Every commit.** `--no-verify` and `HUSKY=0` remain as escapes for emergencies.                                                                            |
| 3   | ESLint base configs?                | `@typescript-eslint/recommended-type-checked` + `eslint:recommended` + the plugin recommendations (`import`, `promise`, `sonarjs`, `vitest`, `playwright`). |
| 4   | commitlint scope policy?            | **Free-form** scopes initially. Revisit once the codebase shows a stable scope vocabulary.                                                                  |
| 5   | Want a Sonar-style code-smell tool? | **Yes — `eslint-plugin-sonarjs`** (in-ESLint, no server). SonarCloud / Codacy stay in the extended set for a hypothetical public-repo future.               |

With these resolved, the next step is a self-contained implementation
prompt in `docs/prompts/guardrails-implementation.md` — same shape as the
audio one. It will list every config file to add, every script to wire into
`package.json`, and what `npm run check` should look like after.
