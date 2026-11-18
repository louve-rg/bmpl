import { chromium } from '@playwright/test';
import baseGlobalSetup from './global-setup';
import { writeSharedAuthState, cleanupSharedAuthState } from './local-only-shared-auth';

/**
 * TERM-STAFF-INFRA: the local-only runner's own global setup. Wraps the
 * shared dev-server-lifecycle setup (./global-setup.ts -- also used by the
 * main CI config, left untouched, same server/port/readiness contract) with
 * ONE extra step specific to this runner: once the dev server is actually
 * ready, build the shared SUPER_ADMIN/UAT_CUSTOMER auth state (see
 * local-only-shared-auth.ts) before any spec file's own beforeAll runs.
 */
export default async function localOnlyGlobalSetup() {
  const baseTeardown = await baseGlobalSetup();

  const browser = await chromium.launch();
  try {
    await writeSharedAuthState(browser);
  } finally {
    await browser.close();
  }

  return async () => {
    cleanupSharedAuthState();
    await baseTeardown?.();
  };
}
