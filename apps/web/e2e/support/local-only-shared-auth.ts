import fs from 'node:fs';
import path from 'node:path';
import type { Browser } from '@playwright/test';
import { tryLogin, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD } from './auth';
import { BASE_URL } from './server';

/**
 * TERM-STAFF-INFRA (god, 2026-11-18): the structural half of MDF-705's
 * throttle finding (#685's PR description, not re-derived here). Both
 * commit-6629d2c9 dense local-only files used to log in as SUPER_ADMIN and
 * UAT_CUSTOMER fresh in their own per-file `beforeAll`, on top of the
 * per-test STAFF/RECIPIENT logins that genuinely cannot be cached (each is a
 * new, distinct account under test). That admin+customer overhead scaled
 * with the number of dense files `playwright.local-only.config.ts` runs in
 * one invocation (`testMatch: ['**\/*.local-only.spec.ts']`, by design) --
 * the two files already combined to ~10 real `/auth/login`-family calls,
 * right at `THROTTLE_AUTH_LIMIT`'s default of 10/60s, so a third dense file
 * (the staff-management feature's) was always going to tip it over.
 *
 * Fix: log in as SUPER_ADMIN and UAT_CUSTOMER exactly ONCE for the whole
 * `test:e2e:local-only` run, from `local-only-global-setup.ts` (which runs
 * once, before any spec file), cache each as a storageState file on disk,
 * and have every spec file load the cached file instead of calling
 * `/auth/login` itself. Distinct per-test accounts (staff invited, or a
 * newly registered recipient) are NOT touched by this -- they are the thing
 * under test and must stay real, fresh logins; this only removes the
 * redundant shared-fixture overhead that scaled with file count for no
 * reason. Does not touch the throttle, its config, or any production guard.
 */
const AUTH_STATE_DIR = path.join(__dirname, '.local-only-auth-state');
export const ADMIN_STATE_PATH = path.join(AUTH_STATE_DIR, 'admin.json');
export const CUSTOMER_STATE_PATH = path.join(AUTH_STATE_DIR, 'customer.json');

/** Called once from local-only-global-setup.ts, after the dev server is ready. */
export async function writeSharedAuthState(browser: Browser): Promise<void> {
  fs.mkdirSync(AUTH_STATE_DIR, { recursive: true });

  const adminCtx = await browser.newContext({ baseURL: BASE_URL });
  try {
    if (!SUPER_ADMIN_PASSWORD) {
      throw new Error('SEED_SUPER_ADMIN_PASSWORD not set -- required to build the shared local-only auth state.');
    }
    const ok = await tryLogin(await adminCtx.newPage(), SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
    if (!ok) throw new Error('Shared SUPER_ADMIN login failed while building local-only auth state.');
    await adminCtx.storageState({ path: ADMIN_STATE_PATH });
  } finally {
    await adminCtx.close();
  }

  const customerCtx = await browser.newContext({ baseURL: BASE_URL });
  try {
    const ok = await tryLogin(await customerCtx.newPage(), UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD);
    if (!ok) throw new Error('Shared UAT_CUSTOMER login failed while building local-only auth state.');
    await customerCtx.storageState({ path: CUSTOMER_STATE_PATH });
  } finally {
    await customerCtx.close();
  }
}

/** Called once from local-only-global-setup.ts's teardown. */
export function cleanupSharedAuthState(): void {
  fs.rmSync(AUTH_STATE_DIR, { recursive: true, force: true });
}
