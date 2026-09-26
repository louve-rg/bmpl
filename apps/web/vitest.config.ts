import { defineConfig } from 'vitest/config';

// Unit tests for the web app's pure logic (variant filtering, inventory maths)
// default to the node environment — no DOM needed. A handful of behaviours
// (BMPL-208: focus containment, tab order) are genuinely DOM behaviour, not
// pure functions; those files opt into jsdom individually via a
// `// @vitest-environment jsdom` pragma at the top of the file rather than
// paying jsdom's cost for every test in the suite.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['{lib,components}/**/*.test.{ts,tsx}'],
  },
});
