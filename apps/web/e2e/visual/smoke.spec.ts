import { test, expect } from '@playwright/test';
import { tryLogin, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD } from '../support/auth';
import { settleForSnapshot } from '../support/visual';

/**
 * Phase 1 plumbing smoke test (Priority 6, owner directive 2026-10-16) — NOT
 * a Phase 2 baseline. No `toHaveScreenshot`, no committed PNG. The new CI
 * job ("Visual regression baseline") boots a real API, migrates and seeds a
 * real database, then runs this suite — but with zero other spec files in
 * this directory yet, a bare `playwright test` run would exit non-zero on
 * "no tests found" and prove nothing about whether the chain actually
 * works. This one test exists only to answer that: does the seed produce a
 * usable account, does the Next dev server come up on port 3177 under
 * Linux (apps/web/e2e/support/server.ts's `findPidOnPort` POSIX branch has
 * never been exercised before this job — its own doc comment says so), does
 * the browser reach it, and does login succeed against the live API this
 * job just booted.
 *
 * Delete this file once Phase 2 adds a real baseline spec that exercises
 * the same login path with an actual screenshot assertion — that answers
 * "does the suite run at all" more completely than this does.
 */
test('smoke: the seeded super-admin can log in and reach the dashboard', async ({ page }) => {
  test.skip(
    !SUPER_ADMIN_PASSWORD,
    'Needs SEED_SUPER_ADMIN_PASSWORD -- set by the new CI job, or locally per apps/web/e2e/support/auth.ts.',
  );

  const loggedIn = await tryLogin(page, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD!);
  expect(loggedIn, 'login should land on /dashboard -- see tryLogin in support/auth.ts for what counts as failure here').toBe(true);

  // Not a screenshot assertion -- just confirms the determinism plumbing
  // itself (animation kill, document.fonts.ready, one settled frame) runs
  // cleanly against a real page before Phase 2 depends on it everywhere.
  await settleForSnapshot(page);

  await expect(page.getByRole('link', { name: 'Your profile' })).toBeVisible();
});
