// @ts-check
/**
 * ESLint flat config (ESLint 9+).
 *
 * Composition order matters:
 *  1. Global ignores.
 *  2. JS recommended baseline.
 *  3. typescript-eslint type-checked rules (needs `parserOptions.project`).
 *  4. Plugin recommendations: import, promise, sonarjs.
 *  5. Project-wide language options + project-specific rule tweaks.
 *  6. Per-suite overrides (vitest in tests/unit, playwright in tests/e2e).
 *  7. eslint-config-prettier — MUST be last; turns off formatting rules that
 *     would otherwise fight Prettier.
 *
 * See `docs/guardrails-survey.md` "Sensor → Agent action matrix" for what to
 * do when a rule trips.
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import promisePlugin from 'eslint-plugin-promise';
import sonarjs from 'eslint-plugin-sonarjs';
import vitest from 'eslint-plugin-vitest';
import playwright from 'eslint-plugin-playwright';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'node_modules/**',
      'public/**',
      '.husky/_/**',
      // Claude Code per-session worktrees live under .claude/worktrees/.
      // They're separate working copies of other branches; never lint them
      // from here — they have their own ESLint run.
      '.claude/**',
      // Standalone Node helper scripts (relay, tooling). They live outside the
      // TS project graph and would otherwise trip the type-aware parser.
      'scripts/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  // eslint-plugin-import: flat-config-aware preset. Disable no-unresolved
  // because TypeScript already validates module resolution and the plugin's
  // resolver doesn't see our `bundler` moduleResolution out of the box.
  {
    ...importPlugin.flatConfigs.recommended,
    rules: {
      ...importPlugin.flatConfigs.recommended.rules,
      'import/no-unresolved': 'off',
      // TS reports unused exports through type-aware tooling later (knip in step 2).
      'import/named': 'off',
      'import/namespace': 'off',
      'import/default': 'off',
      'import/no-named-as-default-member': 'off',
    },
  },

  // eslint-plugin-promise: flat config preset.
  promisePlugin.configs['flat/recommended'],

  // eslint-plugin-sonarjs: legacy `recommended` config still works in flat mode.
  sonarjs.configs.recommended,

  // Project-wide language options + rule tweaks.
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        // Browser
        window: 'readonly',
        document: 'readonly',
        HTMLElement: 'readonly',
        HTMLCanvasElement: 'readonly',
        MessageEvent: 'readonly',
        WebSocket: 'readonly',
        console: 'readonly',
        // Pixi types live in TS land; nothing to expose globally here.
      },
    },
    rules: {
      // `console.error` and `console.warn` are explicit diagnostics; allow.
      // `console.log` slips into production code by accident — warn (not error)
      // so existing intentional uses can be cleaned up incrementally.
      'no-console': ['warn', { allow: ['error', 'warn'] }],
    },
  },

  // Pixi-coupled visual layer: Math.random drives jitter, particle motion,
  // and spawn positioning — purely cosmetic, never security-sensitive. The
  // sonarjs rule is a security check and doesn't apply here. Architectural
  // separation is documented in CLAUDE.md ("Architecture" + "Renderer").
  {
    files: ['src/renderer.ts', 'src/sprite.ts', 'src/particle.ts'],
    rules: {
      'sonarjs/pseudo-random': 'off',
    },
  },

  // Vitest unit tests.
  {
    files: ['tests/unit/**/*.ts'],
    plugins: { vitest },
    rules: {
      ...vitest.configs.recommended.rules,
      // Tests routinely use non-null assertions to keep specs terse.
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Tests often poke private state via casts; loosen unsafe-* rules.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
    languageOptions: {
      globals: {
        document: 'readonly',
        window: 'readonly',
      },
    },
  },

  // Playwright e2e tests.
  {
    files: ['tests/e2e/**/*.ts'],
    plugins: { playwright },
    rules: {
      ...playwright.configs['flat/recommended'].rules,
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      'no-console': 'off',
    },
  },

  // Config files: not part of the TS project graph, so disable type-aware rules.
  {
    files: ['*.config.{js,ts,mjs,cjs}', 'eslint.config.js', 'commitlint.config.js'],
    languageOptions: {
      parserOptions: {
        project: null,
      },
    },
    ...tseslint.configs.disableTypeChecked,
  },

  // MUST be last: disables formatting rules that conflict with Prettier.
  prettierConfig,
);
