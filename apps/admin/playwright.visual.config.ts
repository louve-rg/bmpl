import { defineConfig } from '@playwright/test';
import { BASE_URL } from './e2e/support/server';

/**
 * Pixel-baseline visual-regression suite for apps/admin (Priority 6
 * remediation, owner directive 2026-10-16). Same split from
 * playwright.config.ts, and the same reasoning, as apps/web's own
 * playwright.visual.config.ts — not re-derived, reused deliberately so both
 * apps' visual suites behave identically.
 *
 * BASELINES ARE CAPTURED ONLY ON ubuntu-latest, IN CI, NEVER LOCALLY — see
 * apps/web/playwright.visual.config.ts for the full reasoning and
 * docs/visual-baseline-exit-log.md for the review-before-update workflow.
 *
 * Needs a live API: this config's own CI job (ci.yml, "Visual regression
 * baseline") sets ADMIN_PUBLIC_API_URL before starting the dev server. A
 * local run needs the same env var pointed at a real running API, same as
 * the existing test:e2e config.
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
      maxDiffPixelRatio: 0.01,
    },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  globalSetup: require.resolve('./e2e/support/global-setup.ts'),
});
