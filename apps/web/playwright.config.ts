import { defineConfig } from '@playwright/test';
import { BASE_URL } from './e2e/support/server';

/**
 * Real-browser regression suite (BMPL-217) -- runs locally only, on purpose.
 * See root CLAUDE.md and the e2e/support/server.ts doc comment for why the
 * server lifecycle is hand-rolled instead of Playwright's `webServer` option.
 *
 * Deliberately no CI wiring here: the owner's artifact-storage decision for
 * CI (BMPL-188) is still open, and this must not block on it. Run locally:
 *
 *   pnpm --filter @bmpl/web test:e2e
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  globalSetup: require.resolve('./e2e/support/global-setup.ts'),
});
