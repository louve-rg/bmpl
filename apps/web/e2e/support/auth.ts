import type { Page } from '@playwright/test';

/**
 * Two permanent Belize Connect employer fixtures seeded by
 * packages/database/prisma/seed.ts (BMPL-228) — see the block comment above
 * seedEmployerE2eFixtures() there before touching either account.
 */
export const FIXTURE_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'DemoPass123';
export const EMPLOYER_WITH_PROFILE_EMAIL = 'e2e-fixture.employer-with-profile@example.bz';
export const EMPLOYER_NO_PROFILE_EMAIL = 'do-not-create-a-profile.e2e-fixture@example.bz';

/**
 * Logs in through the real login form and reports whether it landed on
 * /dashboard. A failure here is treated as "this environment cannot run the
 * journey" rather than a test failure — it means either no live API is
 * reachable, or (BMPL-224) the rewrite silently reached the wrong one. Both
 * are covered by the same check: these seeded fixtures never exist outside a
 * seeded dev database, including production on purpose (seed.ts skips demo
 * data entirely when NODE_ENV=production), so a login failure here means the
 * environment this spec needs isn't present -- see the file-level comment in
 * each spec for what that means for CI.
 */
export async function tryLogin(page: Page, email: string, password: string): Promise<boolean> {
  try {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}
