import { defineConfig } from 'vitest/config';

// Unit tests for the web app's pure logic (variant filtering, inventory maths).
// Node environment — these are framework-free functions, no DOM needed.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['{lib,components}/**/*.test.ts'],
  },
});
