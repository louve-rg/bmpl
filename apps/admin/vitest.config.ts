import { defineConfig } from 'vitest/config';

// Unit tests for the admin console's pure logic (dispatch display and gating
// rules) default to the node environment — these are framework-free
// functions, no DOM needed. A handful of screens (BMPL-276: a reader must see
// NO write affordances, not disabled ones — a rendering claim, not a logic
// one) are genuinely DOM/component behaviour; those files opt into jsdom
// individually via a `// @vitest-environment jsdom` pragma at the top of the
// file, mirroring apps/web/vitest.config.ts, rather than paying jsdom's cost
// for every test in the suite. `app` is included so a page component
// (app/**/page.tsx) can carry its own colocated test.
export default defineConfig({
  // tsconfig.json sets "jsx": "preserve" (Next's own compiler does the real
  // transform at build time); esbuild needs to be told explicitly, or it
  // falls back to the classic runtime and every source file that omits
  // `import React` (nearly all of them, since Next never requires it) fails
  // with "React is not defined" under Vitest specifically.
  esbuild: { jsx: 'automatic' },
  test: {
    globals: true,
    environment: 'node',
    // '*.test.mjs' (root only) covers next.config.mjs, which can't move into
    // lib/ (Next loads it directly as plain Node ESM, not through the app's
    // TS build) but still needs its own default-guard behavior under test.
    include: ['{lib,components,app}/**/*.test.{ts,tsx}', '*.test.mjs'],
  },
});
