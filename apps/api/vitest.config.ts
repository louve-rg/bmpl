import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // The wrapper spec is plain .mjs (typechecked by neither tsconfig — it
    // tests a .mjs script) and must run with the unit suite: it needs no
    // infrastructure, and the integration config would only reach it through
    // the very wrapper it tests.
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts', 'test/run-integration.spec.mjs'],
  },
});
