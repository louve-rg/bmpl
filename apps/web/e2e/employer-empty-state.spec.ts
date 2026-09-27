import { test, expect } from '@playwright/test';
import { tryLogin, EMPLOYER_NO_PROFILE_EMAIL, FIXTURE_PASSWORD } from './support/auth';

/**
 * Committed regression proof for BMPL-141: a brand-new approved employer who
 * had never saved a company profile got an error alert instead of the form
 * to create one (the page treated GET /employer/profile 404 as a failure).
 * Fixed in 9cc2028. This is the real-browser version of the walk that found
 * the defect in the first place (BMPL-228) -- a jsdom test already covers the
 * same logic (apps/web/app/dashboard/employer/page.test.tsx, mocked fetch)
 * but that proof lives only against a mock; this one is against the real
 * API, the real 404 shape, and real routing.
 *
 * RESIDUE, stated up front (BMPL-148 is still open -- Belize Connect has no
 * isTest boundary and no delete endpoint for an employer profile): this test
 * NEVER submits the profile form. It only asserts the form renders. The
 * fixture account (prisma/seed.ts, do-not-create-a-profile.e2e-fixture@…) is
 * an approved EMPLOYER seeded with NO profile, on purpose, forever -- a
 * profile can never be un-created once made, so the one rule that keeps this
 * test repeatable with zero residue is that it must never call
 * PUT /employer/profile for this account. Do not add a fill-and-save step
 * here.
 *
 * CI, stated plainly: this spec needs a live API backed by the seeded dev
 * database (the fixture above only exists there). apps/web/e2e's CI step
 * deliberately provisions no services (see playwright.config.ts and
 * .github/workflows/ci.yml) -- adding Postgres/Redis there would duplicate
 * the integration job's coverage and re-entangle a step that exists
 * specifically to not depend on that infrastructure. So this spec SKIPS in
 * CI rather than failing: `tryLogin` fails fast (no reachable API, or a
 * misrouted rewrite reaching production, where this fixture does not exist),
 * and the run is reported as skipped with the reason, not red. It runs for
 * real locally: `pnpm infra:up && pnpm db:seed`, a running API
 * (`pnpm --filter @bmpl/api build && node --env-file=../../.env dist/main.js`
 * or `pnpm --filter @bmpl/api start:dev`), then
 * `pnpm --filter @bmpl/web test:e2e employer-empty-state`.
 */
test.describe('Employer journey: reaching the profile form with no profile yet', () => {
  test('shows the company-profile FORM, not an error, for an approved employer with no profile yet', async ({ page }) => {
    const loggedIn = await tryLogin(page, EMPLOYER_NO_PROFILE_EMAIL, FIXTURE_PASSWORD);
    test.skip(!loggedIn, 'Needs a live API + seeded dev database (BMPL-228 fixtures) -- not provisioned in CI. See file header.');

    await page.goto('/dashboard/employer');

    // getByRole('alert') also matches Next's own always-present route
    // announcer (#__next-route-announcer__), so absence is asserted by text
    // rather than role.
    await expect(page.getByText(/failed to load/i)).toHaveCount(0);
    await expect(page.getByLabel('Company name')).toBeVisible();
    await expect(page.getByText(/set up your company profile to start posting jobs/i)).toBeVisible();

    // Do NOT fill or submit anything here. See the file header.
  });
});
