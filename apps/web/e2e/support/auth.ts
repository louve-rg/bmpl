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
 * The seeded SUPER_ADMIN account (packages/database/prisma/seed.ts,
 * seedSuperAdmin()) -- a higher-privilege credential than the fixtures
 * above, so unlike FIXTURE_PASSWORD this has NO hardcoded fallback here.
 * Set SEED_SUPER_ADMIN_EMAIL / SEED_SUPER_ADMIN_PASSWORD in the environment
 * (already in root .env for local dev) before running a spec that uses it;
 * otherwise SUPER_ADMIN_PASSWORD is undefined and the spec must skip, not
 * fall back to a string literal that would commit the seed default here.
 */
export const SUPER_ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@bzemarketplace.com';
export const SUPER_ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD;

/**
 * The UAT DELIVERY_DRIVER fixture (packages/database/prisma/seed-uat-logistics.ts) --
 * the only seeded account with an approved driver profile. Needed for any
 * spec that exercises a driver-only surface; SUPER_ADMIN above holds no
 * driver role. Same password convention as that script: an env override, or
 * its own already-committed, already-public default -- not a private value.
 */
export const UAT_DRIVER_EMAIL = 'uat-driver@bzemarketplace.com';
export const UAT_DRIVER_PASSWORD = process.env.UAT_SEED_PASSWORD ?? 'UatWalkthrough!123';

/**
 * The remaining UAT fixtures (packages/database/prisma/seed-uat-logistics.ts
 * for the customer, seed-uat-roles.ts for the other four) -- same password
 * convention as UAT_DRIVER_PASSWORD above, given its own name here because
 * it is no longer only about the driver once four more roles share it.
 */
export const UAT_FIXTURE_PASSWORD = process.env.UAT_SEED_PASSWORD ?? 'UatWalkthrough!123';
export const UAT_CUSTOMER_EMAIL = 'uat-customer@bzemarketplace.com';
export const UAT_VENDOR_EMAIL = 'uat-vendor@bzemarketplace.com';
export const UAT_JOB_SEEKER_EMAIL = 'uat-job-seeker@bzemarketplace.com';
export const UAT_PASSENGER_DRIVER_EMAIL = 'uat-passenger-driver@bzemarketplace.com';
export const UAT_PASSENGER_PROVIDER_EMAIL = 'uat-passenger-provider@bzemarketplace.com';

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

/**
 * One fixture per role code this app has a reproducible, committed-script
 * account for (Priority 6 Phase 2 role audit, 2026-10-16 —
 * hive/agents/jim-mv09alb5/memory.md has the full gap list). Every entry
 * here traces to seed.ts or seed-uat-logistics.ts or seed-uat-roles.ts and
 * is re-seedable from a fresh database — never a hand-approved account that
 * happens to exist on one machine. A role code with no entry here has no
 * reproducible fixture yet; build the seed script before writing a spec
 * that needs one, don't assume an account exists.
 *
 * ADMIN itself has no entry — that role's fixtures (OPS_FULL_EMAIL /
 * OPS_LIMITED_EMAIL) live in apps/admin/e2e/support/auth.ts, because the
 * admin console is a separate app with its own login surface; nothing here
 * logs into it.
 */
export const ROLE_FIXTURES = {
  CUSTOMER: { email: UAT_CUSTOMER_EMAIL, password: UAT_FIXTURE_PASSWORD },
  VENDOR: { email: UAT_VENDOR_EMAIL, password: UAT_FIXTURE_PASSWORD },
  DELIVERY_DRIVER: { email: UAT_DRIVER_EMAIL, password: UAT_DRIVER_PASSWORD },
  JOB_SEEKER: { email: UAT_JOB_SEEKER_EMAIL, password: UAT_FIXTURE_PASSWORD },
  PASSENGER_DRIVER: { email: UAT_PASSENGER_DRIVER_EMAIL, password: UAT_FIXTURE_PASSWORD },
  PASSENGER_PROVIDER: { email: UAT_PASSENGER_PROVIDER_EMAIL, password: UAT_FIXTURE_PASSWORD },
  EMPLOYER: { email: EMPLOYER_WITH_PROFILE_EMAIL, password: FIXTURE_PASSWORD },
  SUPER_ADMIN: { email: SUPER_ADMIN_EMAIL, password: SUPER_ADMIN_PASSWORD },
} as const satisfies Record<string, { email: string; password: string | undefined }>;

export type FixtureRoleCode = keyof typeof ROLE_FIXTURES;

/**
 * "Run as VENDOR" for a spec: logs in as that role's fixture through the
 * real form, same contract as tryLogin (false means this environment can't
 * run the spec, not that the spec failed). Returns false without attempting
 * a login when the fixture's password isn't set at all (SUPER_ADMIN has no
 * hardcoded fallback on purpose — see its own comment above) rather than
 * sending an empty-string password through the form.
 */
export async function loginAsRole(page: Page, roleCode: FixtureRoleCode): Promise<boolean> {
  const fixture = ROLE_FIXTURES[roleCode];
  if (!fixture.password) return false;
  return tryLogin(page, fixture.email, fixture.password);
}
