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
