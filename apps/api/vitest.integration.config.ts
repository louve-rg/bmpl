import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  // SWC transform emits `emitDecoratorMetadata`, which NestJS DI needs. esbuild
  // (vitest's default) does not, so guards/services would receive undefined deps.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.integration.spec.ts'],
    setupFiles: ['test/integration.setup.ts'],
    globalSetup: ['test/integration.global.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // One shared database — files run serially. Isolate so per-file env overrides
    // (e.g. the rate-limit spec's THROTTLE_* values) are picked up cleanly.
    fileParallelism: false,
    isolate: true,
    pool: 'forks',
  },
});
