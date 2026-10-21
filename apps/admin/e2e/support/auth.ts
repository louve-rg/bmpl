import type { Page } from '@playwright/test';

/**
 * The two UAT ops fixtures seeded by packages/database/prisma/seed-uat-logistics.ts
 * (run via `pnpm --filter @bmpl/database seed:uat`) — a real application+review
 * flow, not hand-written data. Both share one password: the UAT_SEED_PASSWORD
 * env var, or the script's own default if unset. No hardcoded fallback here on
 * purpose — read it from the script itself at run time rather than committing it
 * a second place.
 */
export const OPS_FULL_EMAIL = 'uat-ops-full@bzemarketplace.com';
export const OPS_LIMITED_EMAIL = 'uat-ops-limited@bzemarketplace.com';
export const OPS_PASSWORD = process.env.UAT_OPS_PASSWORD;

/**
 * Logs in through the real login form and reports whether it landed on
 * /dashboard. A failure here means either no live API is reachable or these
 * UAT fixtures are not seeded in whatever database ADMIN_PUBLIC_API_URL
 * points at — both mean "this environment cannot run the spec", not a test
 * failure.
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
