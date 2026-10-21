import { defineConfig } from '@playwright/test';
import { CONTRAST_BASE_URL } from './e2e/support/server';

/**
 * Requirement 7 contrast check for apps/admin -- see apps/web's own
 * playwright.contrast.config.ts for the full reasoning; identical here,
 * including the CONTRAST_PORT/global-setup.contrast.ts split from the
 * visual suite's PORT/global-setup.ts (found live, 2026-10-21, PR #469).
 */
export default defineConfig({
  testDir: './e2e/contrast',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: CONTRAST_BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  globalSetup: require.resolve('./e2e/support/global-setup.contrast.ts'),
});
