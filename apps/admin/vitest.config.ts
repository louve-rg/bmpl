import { defineConfig } from 'vitest/config';

// Unit tests for the admin console's pure logic (dispatch display and gating
// rules). Node environment — these are framework-free functions, no DOM needed.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // '*.test.mjs' (root only) covers next.config.mjs, which can't move into
    // lib/ (Next loads it directly as plain Node ESM, not through the app's
    // TS build) but still needs its own default-guard behavior under test.
    include: ['{lib,components}/**/*.test.ts', '*.test.mjs'],
  },
});
