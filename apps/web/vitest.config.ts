import { defineConfig } from 'vitest/config';

// Unit tests for the web app's pure logic (variant filtering, inventory maths)
// default to the node environment — no DOM needed. A handful of behaviours
// (BMPL-208: focus containment, tab order; BMPL-141: a page's own first-run-
// vs-error branching) are genuinely DOM/component behaviour, not pure
// functions; those files opt into jsdom individually via a
// `// @vitest-environment jsdom` pragma at the top of the file rather than
// paying jsdom's cost for every test in the suite. `app` is included so a
// page component (app/**/page.tsx) can carry its own colocated test.
export default defineConfig({
  // tsconfig.json sets "jsx": "preserve" (Next's own compiler does the real
  // transform at build time); esbuild needs to be told explicitly, or it
  // falls back to the classic runtime and every source file that omits
  // `import React` (nearly all of them, since Next never requires it)
  // fails with "React is not defined" under Vitest specifically.
  esbuild: { jsx: 'automatic' },
  test: {
    globals: true,
    environment: 'node',
    include: ['{lib,components,app}/**/*.test.{ts,tsx}', '*.test.mjs'],
  },
});
