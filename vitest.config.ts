import { defineConfig } from 'vitest/config';

// Vitest config kept separate from vite.config.ts so the dev/build settings
// stay focused. happy-dom gives us window/document for transport tests
// without the weight of jsdom.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'happy-dom',
    globals: false,
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/main.ts',
        'src/renderer.ts',
        'src/sprite.ts',
        'src/particle.ts',
        // Web Audio bound — exercised by the e2e suite, not by vitest.
        'src/audio.ts',
      ],
      reporter: ['text', 'html'],
    },
  },
});
