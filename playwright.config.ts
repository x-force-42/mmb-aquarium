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
      coverage: {
        // Keep only our source under src/ — drop node_modules, vite chunks, etc.
        entryFilter: (entry: { url: string }) => /\/src\//.test(entry.url),
        sourceFilter: (path: string) => path.includes('/src/'),
        reports: [['v8'], ['console-details']],
      },
    },
  ]);
}

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  reporter,
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
