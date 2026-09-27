import { test, expect } from '@playwright/test';
import { tryLogin, EMPLOYER_WITH_PROFILE_EMAIL, FIXTURE_PASSWORD } from './support/auth';

/**
 * Committed regression proof for BMPL-221: a job draft left at the form's
 * own default values (work arrangement "Not specified", openings blank)
 * was rejected by the API -- packages/validation/src/jobs.ts allowed an
 * ABSENT workArrangement/openings (`.optional()`) but not an explicit
 * `null`, which is what the form sends for a blank optional field. Fixed in
 * c652bac. This proves the real request/response shape end to end -- the
 * exact kind of bug a jsdom test mocking fetch cannot catch, since it is
 * about what the real Zod schema does with a real payload.
 *
 * RESIDUE, stated up front (BMPL-148 is still open): this test creates one
 * real, permanent Job row (status DRAFT) every time it runs, under the
 * seeded fixture employer (prisma/seed.ts,
 * e2e-fixture.employer-with-profile@…). That is accepted, bounded residue --
 * checked before this was written: a DRAFT job appears in the admin jobs
 * list by default, but has no moderation action available (only
 * SUBMITTED/UNDER_REVIEW do), so it is clutter, not something blocking a
 * queue. There is no delete endpoint to clean it up afterward.
 *
 * CI, stated plainly: same as employer-empty-state.spec.ts -- this needs a
 * live API backed by the seeded dev database, which apps/web/e2e's CI step
 * deliberately does not provision (see that file's header, and
 * playwright.config.ts / .github/workflows/ci.yml). `tryLogin` fails fast
 * without one and the test SKIPS with the reason rather than failing red.
 */
test.describe('Employer journey: creating a job draft at the form\'s own defaults', () => {
  test('creates a draft leaving work arrangement and openings at their defaults', async ({ page }) => {
    const loggedIn = await tryLogin(page, EMPLOYER_WITH_PROFILE_EMAIL, FIXTURE_PASSWORD);
    test.skip(!loggedIn, 'Needs a live API + seeded dev database (BMPL-228 fixtures) -- not provisioned in CI. See file header.');

    await page.goto('/dashboard/employer/jobs/new');

    const title = `BMPL-228 e2e job draft ${Date.now()}`;
    await page.getByLabel('Job title').fill(title);
    await page.getByLabel('About the role').fill('Seeded end-to-end regression check for BMPL-221 (default field values).');
    // Work arrangement, District, Openings, and every other optional field
    // are deliberately left untouched at the form's own defaults -- that is
    // the exact scenario BMPL-221 fixed.

    await page.getByRole('button', { name: /create draft/i }).click();

    // A validation failure re-renders this same page (still /jobs/new) with
    // an error alert; success navigates to the new job's own detail page --
    // reaching that URL is itself conclusive proof no validation error fired.
    // The id segment is excluded from matching the literal "new" itself,
    // which a naive [^/]+ would otherwise satisfy without navigating at all.
    await expect(page).toHaveURL(/\/dashboard\/employer\/jobs\/(?!new$)[\w-]+$/, { timeout: 10_000 });
    await expect(page.getByText(title)).toBeVisible();
  });
});
