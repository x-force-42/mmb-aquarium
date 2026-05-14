# Implementation prompt — Guardrails, step 1 of 2 (lint / format / git hooks)

> **Audience:** an AI coding agent (Claude Code) walking in cold.
> **Source of truth:** `docs/guardrails-survey.md`, "Recommended minimal set"
> and "Resolved decisions" sections. Read those first.
> **Scope:** **tooling only.** No changes to source files in `src/` or `tests/`
> beyond fixes that lint/format mandates.

---

## Mission

Install the **lint + format + git-hooks** half of the guardrail stack. After
this lands, every `git commit` will auto-format and lint-fix staged files,
and any commit message that isn't Conventional Commits will be rejected.

Step 2 (a separate prompt) will add the structural sensors
(`dependency-cruiser` + `knip`). **Do not anticipate step 2 here** — keep this
PR small, single-purpose, and easy to review.

---

## Before you touch any code

Read these in order:

1. `CLAUDE.md` — architecture, conventions, test contract.
2. `docs/guardrails-survey.md` — full rationale, especially:
   - "Resolved decisions" table (settles all five open questions).
   - "Recommended minimal set" (lists what's in this step).
   - "Sensor → Agent action matrix" (the policy for what to do when each
     sensor fires; you'll need this when you encounter pre-existing lint
     errors in our source).
3. `package.json` — current scripts and dependencies (you'll extend, not
   rewrite).

If something seems ambiguous and isn't covered above, **ask in chat before
guessing**.

---

## Deliverables

### New files

| Path                   | Purpose                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `eslint.config.js`     | ESLint **flat config** (ESLint 9+). No `.eslintrc.*`.                                                            |
| `.prettierrc.json`     | Prettier rules. Minimal — `singleQuote: true`, `trailingComma: 'all'`, `printWidth: 100`.                        |
| `.prettierignore`      | Excludes `dist/`, `coverage/`, `test-results/`, `playwright-report/`, `node_modules/`, `public/audio/` (binary). |
| `.editorconfig`        | LF line endings, UTF-8, 2-space indent, final newline.                                                           |
| `commitlint.config.js` | Extends `@commitlint/config-conventional`. **No scope enumeration** (free-form scopes).                          |
| `.husky/pre-commit`    | Runs `npx --no -- lint-staged`.                                                                                  |
| `.husky/commit-msg`    | Runs `npx --no -- commitlint --edit "$1"`.                                                                       |

### Modified files

| Path           | Change                                                                                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json` | Add new `devDependencies` (list below). Add scripts: `lint`, `lint:fix`, `format`, `format:check`, `prepare` (for husky). Add `lint-staged` config block.                                      |
| `.gitignore`   | Append `.eslintcache` and (if needed) `.husky/_`. Keep existing entries.                                                                                                                       |
| `CLAUDE.md`    | Add a "Tooling guardrails" section pointing to `docs/guardrails-survey.md` and listing the new scripts. Add the new `Sensor → Action` rows from the survey to the conventions / pitfalls area. |

### `npm install -D` block

Exactly these packages, no extras (they're listed in the survey's minimal set
plus what's needed to wire them up):

```
@eslint/js
typescript-eslint
eslint
eslint-config-prettier
eslint-plugin-import
eslint-plugin-promise
eslint-plugin-sonarjs
eslint-plugin-vitest
eslint-plugin-playwright
prettier
husky
lint-staged
@commitlint/cli
@commitlint/config-conventional
```

Pin versions sensibly (current stable majors). Do **not** add anything outside
this list without flagging in chat.

### `package.json` scripts (target shape)

Existing scripts stay; add these. The exact ordering can match the rest of the
file's style.

```jsonc
{
  "scripts": {
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "prepare": "husky",
  },
}
```

Also extend the existing `check`-style flow if there is one (the project has
`/check` as a slash command). Update the slash command to include `lint` and
`format:check` in its sequence.

### `lint-staged` config (in `package.json`)

```jsonc
{
  "lint-staged": {
    "*.{ts,tsx,js,mjs,cjs}": ["eslint --fix", "prettier --write"],
    "*.{md,json,yml,yaml,html,css}": ["prettier --write"],
  },
}
```

---

## ESLint flat-config shape (guidance, not prescription)

You decide the exact syntax — use current ESLint 9 idioms. The key points:

- Compose from `@eslint/js`, `typescript-eslint`'s `recommendedTypeChecked`,
  and the plugin recommendations for `import`, `promise`, `sonarjs`.
- Apply `eslint-plugin-vitest` rules **only to `tests/unit/**`\*\*.
- Apply `eslint-plugin-playwright` rules **only to `tests/e2e/**`\*\*.
- `eslint-config-prettier` **must be the last** entry so it disables formatting
  rules that would conflict with Prettier.
- `parserOptions.project` must point to the existing `tsconfig.json` so the
  type-checked rules work.
- Ignore: `dist/`, `coverage/`, `test-results/`, `playwright-report/`,
  `node_modules/`, `public/`.

Project-specific overrides you should include:

- Allow non-null assertion (`!`) in `tests/**` — common in test code.
- Allow `console.error` and `console.warn` everywhere; ban `console.log`
  in `src/` (warn-level).

---

## Architectural rules — non-negotiable

1. **No code refactor under cover of lint.** If a lint rule disagrees with
   existing code, fix the formatting (auto-fix is fine), but don't restructure
   functions, rename symbols, or change behavior. Behavior changes belong in
   a follow-up PR with its own commit.
2. **Don't disable a rule globally without justification.** If a rule fires
   genuinely incorrectly on a specific line, add
   `// eslint-disable-next-line <rule> -- reason: <one sentence why>`. Never
   blanket-disable with `/* eslint-disable */`.
3. **No format wars in this PR.** Run Prettier once on the whole tree, accept
   the diff, move on. We're not relitigating formatting choices.
4. **The `check` slash command is part of the contract.** Update it to chain
   `lint` and `format:check` alongside the existing `typecheck + test:unit + test:e2e`.
5. **`.husky/pre-commit` and `.husky/commit-msg` must be executable.** On Unix
   that's `chmod +x`. On Windows that's `git update-index --chmod=+x`. Verify
   with `ls -la .husky/`.

---

## Acceptance criteria

Every item below must be true at the end. Verify in order.

- [ ] `npm install` completes with no errors and no audit blockers (high/critical).
- [ ] `npx eslint --version` prints a 9.x version.
- [ ] `npm run lint` exits 0 against the current source.
- [ ] `npm run format:check` exits 0 against the current source.
- [ ] `npm run typecheck` exits 0 (unchanged from before).
- [ ] `npm run test:unit` exits 0 (unchanged from before).
- [ ] `npm run test:e2e` exits 0 (unchanged from before).
- [ ] Manual smoke #1 — bad commit message rejected:
  ```
  git commit --allow-empty -m "i just wanted to test"
  ```
  Should fail with a commitlint error.
- [ ] Manual smoke #2 — good commit message accepted:
  ```
  git commit --allow-empty -m "test: verify commit-msg hook"
  ```
  Should pass. (Don't keep this commit — `git reset --hard HEAD~1` after.)
- [ ] Manual smoke #3 — pre-commit auto-fixes formatting:
      Edit a `.ts` file to add a misformatted line, `git add` it, `git commit`,
      verify the staged content was reformatted before the commit landed.

If any acceptance criterion needs source modifications to satisfy (e.g.,
existing source produces lint errors), apply the **fix the cause** rule from
the survey's matrix. Document each non-trivial fix in the commit body.

---

## Out of scope (do not do)

- `dependency-cruiser` — step 2 of this rollout.
- `knip` — step 2.
- `madge`, `markdownlint`, `jscpd`, GitHub Actions, Dependabot — extended set.
- Renaming files / refactoring source structure — separate PR.
- Bumping major versions of existing deps (TypeScript, Vite, etc.) — out of scope.
- Adding any tool not on the explicit `npm install -D` list above.

---

## Pitfalls (read before debugging)

1. **ESLint 9 flat config is different.** No `extends`, no `.eslintrc.*`,
   plugins are imported as ES modules and composed into an array. Check the
   ESLint docs for current idioms before guessing.
2. **`typescript-eslint`'s type-checked rules need `parserOptions.project`.**
   Without it, every rule that needs type info will quietly skip.
3. **`eslint-config-prettier` must come last.** Otherwise ESLint and Prettier
   will fight on commas and indentation.
4. **Husky 9 simplified install.** Just `npx husky` (no `husky install`),
   and put hook bodies directly in `.husky/<hook>` (no shebang shim needed).
   Don't follow tutorials older than ESLint 9 / Husky 9.
5. **Existing source may have lint errors.** Especially `sonarjs/cognitive-complexity`
   on the renderer's update loops. Fix the code where possible; otherwise
   suppress per-line with a reason comment **and** call it out in your report.
6. **`.husky/_/` is auto-generated.** Don't commit it; add to `.gitignore`
   if it's not already covered.
7. **Files have been truncated mid-write in this project before.** After you
   write any config larger than ~3 KB, re-read its last 5 lines to confirm
   it's intact. (Yes, even config files. We've been bitten three times.)

---

## How to report when done

Write a chat reply with:

1. Files created and modified (path + one-line purpose).
2. Lint findings on the existing source — what you fixed automatically, what
   needed a manual fix, what (if anything) you suppressed and why.
3. The output of:
   - `npm run lint`
   - `npm run format:check`
   - `npm run typecheck`
   - `npm run test:unit`
   - the three manual smokes above (each as a code block).
4. Proposed commit message, in Conventional Commits format. Suggested type:
   `chore(tooling)` or `build(lint)`. Suggested tag bump: **none** —
   tooling-only, not a release.
5. Any deviation from this brief, with rationale.

**Do not** `git commit`, `git tag`, or `git push`. Leave everything in the
working tree for human review.
