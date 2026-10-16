import { defineConfig } from '@playwright/test';
import { BASE_URL } from './e2e/support/server';

/**
 * Pixel-baseline visual-regression suite (Priority 6 remediation, owner
 * directive 2026-10-16) — separate config and testDir from playwright.config.ts
 * (the existing DOM/overflow/geometry suite) on purpose:
 *   - a pixel baseline is expensive to maintain (one PNG per page x role x
 *     viewport x state) and reviewed differently — a baseline UPDATE is its
 *     own commit with its own changelog line, never bundled with an
 *     unrelated feature change — so mixing it into the same testDir as the
 *     cheap DOM checks would make every baseline-touching PR look like an
 *     ordinary spec change.
 *   - CI treats the two suites differently too: this config's job (see
 *     ci.yml, "Visual regression baseline") runs against a live API and a
 *     seeded database; the plain e2e job deliberately provisions neither.
 *
 * BASELINES ARE CAPTURED ONLY ON ubuntu-latest, IN CI, NEVER LOCALLY.
 * Playwright's screenshot output is not guaranteed pixel-identical across
 * operating systems or font-rendering stacks — a baseline captured on a
 * developer's own Windows machine would fail for every other reviewer, and
 * for CI itself, forever. `pnpm test:visual` run locally only ever VERIFIES
 * against an existing committed baseline; `pnpm test:visual:update` exists
 * but is only meant to be run from the matching CI job, reviewed before its
 * output is committed — see docs/visual-baseline-exit-log.md for the full
 * review-before-update workflow and the written exit criterion for when this
 * suite is allowed to start blocking a merge.
 */
export default defineConfig({
  testDir: './e2e/visual',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  expect: {
    toHaveScreenshot: {
      // One number, used everywhere. A per-test fudge factor to chase a
      // flaky diff is exactly how a visual suite rots silently (owner
      // directive, 2026-10-16) — if a specific test needs more tolerance,
      // that is a signal to fix its determinism (§1 of the design doc), not
      // to raise its number alone.
      maxDiffPixelRatio: 0.01,
    },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  globalSetup: require.resolve('./e2e/support/global-setup.ts'),
});
