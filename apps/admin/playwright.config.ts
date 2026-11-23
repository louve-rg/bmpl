import { defineConfig } from '@playwright/test';
import { BASE_URL } from './e2e/support/server';

/**
 * Real-browser regression suite for apps/admin — its first. See
 * e2e/support/server.ts for why the server lifecycle is hand-rolled instead
 * of Playwright's built-in `webServer` option (reused from apps/web's own
 * e2e harness for the same reason, not re-derived).
 *
 * Needs a live API: ADMIN_PUBLIC_API_URL=http://localhost:4001 pnpm --filter
 * @bmpl/admin test:e2e (adjust the port to wherever your API is running).
 * Specs that need a seeded account skip, not fail, when login doesn't work —
 * see e2e/support/auth.ts.
 */
export default defineConfig({
  testDir: './e2e',
  // e2e/visual belongs to playwright.visual.config.ts and e2e/contrast to
  // playwright.contrast.config.ts -- see apps/web's own configs for the
  // full reasoning; identical here.
  testIgnore: ['**/visual/**', '**/contrast/**', '**/*.local-only.spec.ts'],
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  // MDF-906: CI-only, not a continue-on-error-style swallow. A test that
  // fails then passes on retry is reported FLAKY, not silently dropped --
  // the occurrence stays visible in the run output and the apps/web
  // 10-consecutive-run gate on the browser step now requires zero FLAKY
  // too, not just zero FAILED (same shape here, for consistency). A local
  // run gets no retry: a developer needs the raw first-failure signal, not
  // a second attempt that quietly passes.
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  globalSetup: require.resolve('./e2e/support/global-setup.ts'),
});
