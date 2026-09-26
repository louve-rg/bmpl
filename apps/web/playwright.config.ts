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
