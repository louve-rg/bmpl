import { defineConfig } from 'vitest/config';

// Unit tests for the admin console's pure logic (dispatch display and gating
// rules). Node environment — these are framework-free functions, no DOM needed.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['{lib,components}/**/*.test.ts'],
  },
});
