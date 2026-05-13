import { defineConfig } from 'vite';

// Vite as our dev server and prod bundler. No frameworks, no JSX —
// just TypeScript modules consumed by index.html.
export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
