import { defineConfig } from '@playwright/test';
import { BASE_URL } from './e2e/support/server';

/**
 * Sanctioned local run for `**\/*.local-only.spec.ts` (Ruling 15 / #644,
 * tightened by a2b17ad0 after #644 would otherwise have added one of these
 * to every PR's CI run). Those specs are correctly `testIgnore`d by the
 * default `playwright.config.ts` -- CI must never run them, so that
 * exclusion stays exactly as-is. What was missing was any SANCTIONED way to
 * run them locally at all: before this file, the only way was a throwaway
 * config nobody committed, re-invented per author. This is that config,
 * committed once instead of reinvented -- same server lifecycle
 * (e2e/support/server.ts/global-setup.ts) and same conventions as
 * playwright.config.ts, just inverted to ONLY match what that one excludes.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: ['**/*.local-only.spec.ts'],
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
