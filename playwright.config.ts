import { defineConfig, devices, type ReporterDescription } from '@playwright/test';

// E2E runs against the production build served by `vite preview`. The
// webServer block builds first so we test the real artifact, not the
// dev server with HMR magic.
//
// Coverage: when COVERAGE=1, monocart-reporter attaches to each page via
// CDP, collects V8 coverage, and source-maps it back to src/*.ts using the
// build sourcemaps (enabled in vite.config.ts). Opt-in so the plain
// `npm run test:e2e` run stays lean.
const collectCoverage = process.env['COVERAGE'] === '1';

const reporter: ReporterDescription[] = [['list']];
if (collectCoverage) {
  reporter.push([
    'monocart-reporter',
    {
      name: 'Mr. Meeseeks Aquarium — E2E',
      outputFile: './coverage/e2e/test-report.html',
     