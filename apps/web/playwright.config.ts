import { defineConfig } from '@playwright/test';
import { BASE_URL } from './e2e/support/server';

/**
 * Real-browser regression suite (BMPL-217). See root CLAUDE.md and the
 * e2e/support/server.ts doc comment for why the server lifecycle is
 * hand-rolled instead of Playwright's `webServer` option.
 *
 * Runs locally:
 *
 *   pnpm --filter @bmpl/web test:e2e
 *
 * ...and in CI, as an informational step inside the build-and-test job
 * (.github/workflows/ci.yml) that cannot hold the Railway deploy gate --
 * step-level `continue-on-error`, the same mechanism that job already uses
 * for Format check and Lint. It needs no infrastructure of its own: apps/web
 * never talks to Postgres/Redis/MinIO directly (root CLAUDE.md §2), so the
 * open owner storage-backend decision (BMPL-188) never gated this suite --
 * that was a real, separate question this branch investigated and closed,
 * not a live blocker to keep working around here.
 */
export default defineConfig({
  testDir: './e2e',
  // e2e/visual belongs to playwright.visual.config.ts (Priority 6, owner
  // directive 2026-10-16) and e2e/contrast to playwright.contrast.config.ts
  // (requirement 7) -- both excluded here so no suite silently
  // double-enumerates another's spec files under this config too.
  testIgnore: ['**/visual/**', '**/contrast/**', '**/*.local-only.spec.ts'],
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  // MDF-906: CI-only, not a continue-on-error-style swallow. A test that
  // fails then passes on retry is reported FLAKY, not silently dropped --
  // the occurrence stays visible in the run output and the 10-consecutive-
  // run gate on the browser step now requires zero FLAKY too, not just zero
  // FAILED. A local run gets no retry: a developer needs the raw
  // first-failure signal, not a second attempt that quietly passes.
  retries: process.env.CI ? 1 : 0,
  // FIN-BROWSER-STEP: the `html` reporter is what ci.yml's "Upload Playwright
  // report" step actually uploads now (it already names apps/web/playwright-
  // report as a path). `open: 'never'` keeps CI from trying to launch a
  // browser to show it.
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  globalSetup: require.resolve('./e2e/support/global-setup.ts'),
});
