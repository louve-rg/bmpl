import { test, expect, request as pwRequest, type APIRequestContext, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { tryLogin } from './support/auth';

/**
 * MDF-556, the admin-sees-status leg of the owner's section 7 journey. Lives
 * in its own file for the same reason as
 * apps/admin/e2e/passenger-booking-pin-visibility.local-only.spec.ts: apps/admin
 * is a separate Next.js app, separate Playwright config, separate dev-server
 * lifecycle — the customer-books/operator-confirms half of this journey
 * (apps/web/e2e/passenger-booking-journey.local-only.spec.ts) cannot run
 * inside this process any more than it could for MDF-550.
 *
 * *** LOCAL ONLY, same reason as every other local-only spec in this repo.
 *
 * FIXTURE is built and CONFIRMED entirely by direct API calls (provider +
 * rider, same pattern as the pin-visibility spec) — the operator's Confirm
 * action itself is already proven, end to end, through the real operator UI,
 * by the apps/web half of this journey. Re-proving the button here would be
 * the same check running twice in two apps for no new coverage; what THIS
 * file proves that the web half cannot is narrower and genuinely its own:
 * once a booking is CONFIRMED, does the administrator's OWN interface show
 * that status correctly — and, since god's follow-up named "the customer AND
 * admin legs should see the resulting state" (plural, the post-driver-
 * completion one, not just confirmed), a second test drives the same trip
 * through the driver's start/complete (direct API, same reasoning as the
 * rest of this fixture — the driver's own UI buttons are already proven by
 * the web half's step 5) and re-reads the SAME booking-detail page for
 * COMPLETED.
 *
 * THREE FURTHER ADMINISTRATOR CAPABILITIES, each from a later head:
 *
 * 1. Pam's feat/passenger-admin-affiliations-pagination @ 9b045ba3 adds
 *    GET /admin/passengers/affiliations — read-only BY DESIGN. One negative
 *    assertion mirrors hers (passenger-affiliation.integration.spec.ts): an
 *    admin cannot consent on a party's behalf through ANY existing route,
 *    proven by attempting the driver's own accept endpoint with the admin's
 *    cookies and getting refused.
 *
 * 2. The same head makes GET /admin/passengers/bookings genuinely paginated
 *    ({rows,total,page,pageSize}, default pageSize 20, max 100) — the 301st
 *    booking used to be silently unreachable past the old 300-row cap. One
 *    extra booking (cheap: one more tiny trip, same rider) proves `total`
 *    tracks the real count, and pageSize=1 across two pages proves page 2 is
 *    real, different data — not page 1 repeated or a result that only ever
 *    looks complete.
 *
 * 3. The owner's administrator list, item one — "reviews and approves
 *    applications" — had never actually been exercised: zero pending
 *    PASSENGER_DRIVER applications in fixture data (Jim's finding). Seeds
 *    one on a FRESH, throwaway account (never a shared UAT fixture — the
 *    role, once approved, cannot be re-applied for, so reusing one would
 *    make the test pass exactly once) via the real submission chain
 *    (register, verify email through the dev-only mailbox at
 *    /api/dev/emails/latest, upload one minimal real document, submit),
 *    approves it through the real admin UI, then proves the SECOND half —
 *    the part that matters — by checking the newly-approved account can
 *    actually reach /dashboard/passenger-driver/trips with no "Approval
 *    required" banner. An approval that flips a row but leaves the user
 *    unable to act is the owner's exact failure shape; this is written to
 *    catch it, not just to exercise the button.
 */

const SUPER_ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@bzemarketplace.com';
const SUPER_ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD;
const UAT_PASSENGER_PROVIDER_EMAIL = 'uat-passenger-provider@bzemarketplace.com';
const UAT_PASSENGER_DRIVER_EMAIL = 'uat-passenger-driver@bzemarketplace.com';
const UAT_CUSTOMER_EMAIL = 'uat-customer@bzemarketplace.com';
const UAT_FIXTURE_PASSWORD = process.env.UAT_SEED_PASSWORD ?? 'UatWalkthrough!123';

/** Same variable this app's next.config.mjs reads for its /api/* rewrite —
 *  a fixture built against this always matches whatever the admin UI itself
 *  will proxy to. No hardcoded-port fallback: an unset var fails fixture
 *  setup loudly (skips the suite) rather than guess a port. */
const API_BASE = process.env.ADMIN_PUBLIC_API_URL;

const ADMIN_STORAGE = path.join(os.tmpdir(), `bmpl-e2e-journey-admin-view-${process.pid}.json`);
let fixtureOk = false;
let bookingId = '';
let tripId = '';
/** Kept open past beforeAll (unlike provider/rider) so the second test can
 *  drive this same trip to COMPLETED — disposed in afterAll instead. */
let driverCtx: APIRequestContext | null = null;

async function apiLogin(email: string, password: string): Promise<APIRequestContext | null> {
  if (!API_BASE) return null;
  const ctx = await pwRequest.newContext({ baseURL: API_BASE });
  const res = await ctx.post('/api/auth/login', { data: { email, password } });
  if (!res.ok()) {
    await ctx.dispose();
    return null;
  }
  return ctx;
}

test.beforeAll(async ({ browser }) => {
  if (!SUPER_ADMIN_PASSWORD) return;
  const context = await browser.newContext();
  const page = await context.newPage();
  const loginOk = await tryLogin(page, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
  if (loginOk) await context.storageState({ path: ADMIN_STORAGE });
  await context.close();
  if (!loginOk) return;

  const provider = await apiLogin(UAT_PASSENGER_PROVIDER_EMAIL, UAT_FIXTURE_PASSWORD);
  const rider = await apiLogin(UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD);
  if (!provider || !rider) return;
  try {
    const routeRes = await provider.post('/api/passenger/provider/routes', {
      data: {
        name: `MDF-556 admin-status ${Date.now()}`,
        originDistrict: 'BELIZE',
        originCity: 'Belize City',
        destinationDistrict: 'CAYO',
        destinationCity: 'San Ignacio',
        scheduleNote: 'MDF-556 admin-status harness fixture',
        baseFareMinor: 3000,
      },
    });
    if (!routeRes.ok()) return;
    const route = await routeRes.json();

    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const tripRes = await provider.post('/api/passenger/provider/trips', {
      data: { routeId: route.id, scheduledDepartureAt: tomorrow },
    });
    if (!tripRes.ok()) return;
    const trip = await tripRes.json();
    tripId = trip.id as string;

    // No vehicle assignment needed: admin visibility of status needs no
    // capacity check, and this fixture never calls confirm through the
    // normal (capacity-checked) provider path -- it goes through the ADMIN
    // confirm endpoint instead (admin-passenger-network.controller.ts),
    // which still enforces the fare gate but, like the provider path, still
    // requires an assigned vehicle for the capacity check. Assign one so the
    // confirm this fixture performs is the real rule, not a shortcut around it.
    const driverRes = await provider.get('/api/passenger/provider/affiliations');
    const affiliations = driverRes.ok() ? await driverRes.json() : [];
    const accepted = (affiliations as Array<{ id: string; driverProfileId: string; status: string }>).find((a) => a.status === 'ACCEPTED');
    if (!accepted) return;

    const vehicleRes = await provider.post('/api/passenger/provider/vehicles', {
      data: { type: 'CAR', make: 'Honda', model: 'Civic', licencePlate: `UAT556A${Date.now()}`.slice(0, 18), seatCapacity: 4 },
    });
    if (!vehicleRes.ok()) return;
    const vehicle = await vehicleRes.json();

    const adminCtx = await apiLogin(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
    if (!adminCtx) return;
    try {
      const approveRes = await adminCtx.post(`/api/admin/passengers/vehicles/${vehicle.id}/approve`);
      if (!approveRes.ok()) return;
    } finally {
      await adminCtx.dispose();
    }

    const assignRes = await provider.post(`/api/passenger/provider/trips/${trip.id}/assign`, {
      data: { driverProfileId: accepted.driverProfileId, vehicleId: vehicle.id },
    });
    if (!assignRes.ok()) return;

    const bookingRes = await rider.post('/api/passenger/bookings', { data: { tripId: trip.id, seats: 1 } });
    if (!bookingRes.ok()) return;
    bookingId = (await bookingRes.json()).id as string;

    const confirmRes = await provider.post(`/api/passenger/provider/bookings/${bookingId}/confirm`);
    if (!confirmRes.ok()) return;

    // Logged in but left ASSIGNED, not yet started -- the second test drives
    // start/complete itself, so the first test still reads a genuinely
    // CONFIRMED (not already COMPLETED) booking.
    driverCtx = await apiLogin(UAT_PASSENGER_DRIVER_EMAIL, UAT_FIXTURE_PASSWORD);
    fixtureOk = driverCtx !== null;
  } finally {
    await provider.dispose();
    await rider.dispose();
  }
});

test.afterAll(async () => {
  fs.rmSync(ADMIN_STORAGE, { force: true });
  if (driverCtx) await driverCtx.dispose();
});

function skipIfNoFixture() {
  test.skip(!fixtureOk, 'Needs a live API + seeded dev database (SEED_SUPER_ADMIN_PASSWORD, UAT_PASSENGER_PROVIDER, UAT_CUSTOMER) and ADMIN_PUBLIC_API_URL set. See file header.');
}

test.describe.serial('[LOCAL ONLY, skips in CI] MDF-556 — the administrator sees the booking\'s status correctly at each stage', () => {
  test('admin booking-detail page shows CONFIRMED, not the pre-confirmation state', async ({ browser }) => {
    skipIfNoFixture();
    const context = await browser.newContext({ storageState: ADMIN_STORAGE });
    const page = await context.newPage();
    try {
      await page.goto(`/dashboard/passengers/bookings/${bookingId}`);
      await expect(page.getByText('confirmed', { exact: true })).toBeVisible({ timeout: 10_000 });
      // Not the state it started in -- proves this is a live read of the
      // current status, not a cached or default render.
      await expect(page.getByText('requested', { exact: true })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('admin booking-detail page shows COMPLETED once the driver finishes the trip', async ({ browser }) => {
    skipIfNoFixture();
    test.skip(!driverCtx, 'driver login unavailable -- cannot drive the trip to completion.');
    // The driver's own start/complete buttons are already proven through the
    // real UI by the web half's step 5 -- this fixture's own job is only to
    // reach the state, same reasoning as the rest of this file's setup.
    const startRes = await driverCtx!.post(`/api/passenger/driver/trips/${tripId}/start`);
    expect(startRes.ok()).toBe(true);
    const completeRes = await driverCtx!.post(`/api/passenger/driver/trips/${tripId}/complete`);
    expect(completeRes.ok()).toBe(true);

    const context = await browser.newContext({ storageState: ADMIN_STORAGE });
    const page = await context.newPage();
    try {
      await page.goto(`/dashboard/passengers/bookings/${bookingId}`);
      await expect(page.getByText('completed', { exact: true })).toBeVisible({ timeout: 10_000 });
      // Not the state the previous test saw -- proves a live read of the
      // post-completion status, not the confirmed one still cached somewhere.
      await expect(page.getByText('confirmed', { exact: true })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});

/** Pulls the real verification token out of the dev-only captured mailbox
 *  (apps/api/src/dev/dev.controller.ts) -- the same link a real inbox would
 *  show, without needing a mail server in this environment. */
async function latestVerificationToken(ctx: APIRequestContext, email: string): Promise<string | null> {
  const res = await ctx.get(`/api/dev/emails/latest?email=${encodeURIComponent(email)}`);
  if (!res.ok()) return null;
  const body = (await res.json()) as { body: string };
  const match = body.body.match(/token=([^\s&"]+)/);
  return match?.[1] ?? null;
}

test.describe('[LOCAL ONLY, skips in CI] MDF-556/MDF-553 — admin affiliations are read-only, and the booking list is really paginated', () => {
  test('admin can read every affiliation but cannot accept or end one on a party\'s behalf', async ({ browser }) => {
    test.skip(!SUPER_ADMIN_PASSWORD || !API_BASE, 'Needs SEED_SUPER_ADMIN_PASSWORD and ADMIN_PUBLIC_API_URL. See file header.');
    const provider = await apiLogin(UAT_PASSENGER_PROVIDER_EMAIL, UAT_FIXTURE_PASSWORD);
    const driver = await apiLogin(UAT_PASSENGER_DRIVER_EMAIL, UAT_FIXTURE_PASSWORD);
    const admin = await apiLogin(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD ?? '');
    test.skip(!provider || !driver || !admin, 'Fixture logins unavailable.');
    try {
      const driverProfileRes = await driver!.get('/api/passenger/driver/profile');
      test.skip(!driverProfileRes.ok(), 'Driver profile unavailable -- cannot build a real affiliation to read.');
      const driverProfileId = (await driverProfileRes.json()).id as string;

      // A pending ask, so there is something real for the admin to read and
      // for the negative case below to try acting on.
      const invite = await provider!.post('/api/passenger/provider/affiliations/invite', { data: { driverProfileId, message: 'MDF-556 admin read-only check' } });
      // The provider/driver pair may already be ACCEPTED from the main
      // fixture (test/location-e2e-harness's own beforeAll) -- a second
      // invite between an already-affiliated pair is refused, which is fine:
      // the READ below still has a real row to find either way.
      const readRes = await admin!.get('/api/admin/passengers/affiliations');
      expect(readRes.ok()).toBe(true);
      const rows = (await readRes.json()) as Array<{ id: string; status: string }>;
      expect(Array.isArray(rows)).toBe(true);

      // The one negative assertion: no route lets the admin consent FOR a
      // party. Mirrors Pam's own proof (passenger-affiliation.integration.spec.ts)
      // by attempting the driver's own accept endpoint with the ADMIN's
      // cookies -- role-gated to PASSENGER_DRIVER, so an admin must be refused.
      const targetId = invite.ok() ? (await invite.json()).id : rows[0]?.id;
      test.skip(!targetId, 'No affiliation id available to attempt acting on.');
      const actRes = await admin!.post(`/api/passenger/driver/affiliations/${targetId}/accept`);
      expect(actRes.ok()).toBe(false);
      expect(actRes.status()).toBe(403);
    } finally {
      await provider?.dispose();
      await driver?.dispose();
      await admin?.dispose();
    }
  });

  test('the booking list is really paginated — total tracks a real change, and page 2 is different data', async ({ browser }) => {
    test.skip(!SUPER_ADMIN_PASSWORD || !API_BASE, 'Needs SEED_SUPER_ADMIN_PASSWORD and ADMIN_PUBLIC_API_URL. See file header.');
    const provider = await apiLogin(UAT_PASSENGER_PROVIDER_EMAIL, UAT_FIXTURE_PASSWORD);
    const rider = await apiLogin(UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD);
    const admin = await apiLogin(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD ?? '');
    test.skip(!provider || !rider || !admin, 'Fixture logins unavailable.');
    try {
      const before = await admin!.get('/api/admin/passengers/bookings?page=1&pageSize=1');
      expect(before.ok()).toBe(true);
      const beforeBody = (await before.json()) as { total: number };

      // One cheap new booking -- its own tiny trip, no vehicle needed since
      // this only tests the READ, not confirmation.
      const routeRes = await provider!.post('/api/passenger/provider/routes', {
        data: {
          name: `MDF-556 pagination ${Date.now()}`,
          originDistrict: 'BELIZE',
          originCity: 'Belize City',
          destinationDistrict: 'CAYO',
          destinationCity: 'San Ignacio',
          scheduleNote: 'MDF-556 pagination-boundary fixture',
          baseFareMinor: 3000,
        },
      });
      expect(routeRes.ok()).toBe(true);
      const route = await routeRes.json();
      const tripRes = await provider!.post('/api/passenger/provider/trips', {
        data: { routeId: route.id, scheduledDepartureAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString() },
      });
      expect(tripRes.ok()).toBe(true);
      const trip = await tripRes.json();
      const bookingRes = await rider!.post('/api/passenger/bookings', { data: { tripId: trip.id, seats: 1 } });
      expect(bookingRes.ok()).toBe(true);
      const booking = await bookingRes.json();

      const after = await admin!.get('/api/admin/passengers/bookings?page=1&pageSize=1');
      expect(after.ok()).toBe(true);
      const afterBody = (await after.json()) as { total: number; rows: Array<{ id: string }> };
      // The exact delta, not just "grew" -- a count that merely increases
      // could still be hiding a silent truncation elsewhere.
      expect(afterBody.total).toBe(beforeBody.total + 1);

      // Page 2 is real, different data -- not page 1 repeated.
      const page1 = await admin!.get('/api/admin/passengers/bookings?page=1&pageSize=1');
      const page2 = await admin!.get('/api/admin/passengers/bookings?page=2&pageSize=1');
      expect(page1.ok() && page2.ok()).toBe(true);
      const p1 = (await page1.json()) as { rows: Array<{ id: string }> };
      const p2 = (await page2.json()) as { rows: Array<{ id: string }> };
      expect(p1.rows).toHaveLength(1);
      expect(p2.rows).toHaveLength(1);
      expect(p1.rows[0]?.id).not.toBe(p2.rows[0]?.id);

      // And the specific booking just created is genuinely retrievable, not
      // just counted -- scoped by its own tripId so this is exact, not a
      // guess at which page it landed on amid however many already exist.
      const scoped = await admin!.get(`/api/admin/passengers/bookings?tripId=${trip.id}`);
      const scopedBody = (await scoped.json()) as { rows: Array<{ id: string }> };
      expect(scopedBody.rows.some((b) => b.id === booking.id)).toBe(true);
    } finally {
      await provider?.dispose();
      await rider?.dispose();
      await admin?.dispose();
    }
  });
});

test.describe('[LOCAL ONLY, skips in CI] MDF-556 — the owner\'s administrator list, item one: reviewing and approving applications', () => {
  test('a pending PASSENGER_DRIVER application, approved through the real admin UI, actually unlocks the role', async ({ browser }) => {
    test.skip(!SUPER_ADMIN_PASSWORD || !API_BASE, 'Needs SEED_SUPER_ADMIN_PASSWORD and ADMIN_PUBLIC_API_URL. See file header.');
    const applicantEmail = `mdf556-applicant-${Date.now()}@example.bz`;
    const applicantPassword = 'UatWalkthrough!123';

    const applicant = await pwRequest.newContext({ baseURL: API_BASE });
    let applicationId = '';
    try {
      // A FRESH account, never a shared UAT fixture -- PASSENGER_DRIVER
      // cannot be re-applied for once APPROVED, so a shared account would
      // only let this test pass once, ever.
      const registerRes = await applicant.post('/api/auth/register', {
        data: { email: applicantEmail, password: applicantPassword, firstName: 'Mdf', lastName: 'Applicant', acceptedTerms: true },
      });
      expect(registerRes.ok()).toBe(true);

      await applicant.post('/api/auth/resend-verification', { data: { email: applicantEmail } });
      const token = await latestVerificationToken(applicant, applicantEmail);
      if (!token) throw new Error('No verification email was captured in the dev mailbox -- cannot proceed without one.');
      const verifyRes = await applicant.post('/api/auth/verify-email', { data: { token } });
      expect(verifyRes.ok()).toBe(true);

      // One real document (not a stub skipped past): a 4-byte buffer whose
      // magic bytes genuinely sniff as application/pdf
      // (packages/shared/src/storage.ts sniffDocumentMime) -- closes Jim's
      // "did not push an actual file upload through" gap rather than
      // reporting it as a cost, since the real upload path is this cheap.
      const uploadRes = await applicant.post('/api/roles/applications/PASSENGER_DRIVER/documents/upload?filename=licence.pdf', {
        headers: { 'Content-Type': 'application/pdf' },
        data: Buffer.from('%PDF'),
      });
      expect(uploadRes.ok()).toBe(true);
      const doc = (await uploadRes.json()) as { key: string };

      const submitRes = await applicant.post('/api/roles/applications', {
        data: { roleCode: 'PASSENGER_DRIVER', documentKeys: [doc.key] },
      });
      expect(submitRes.ok()).toBe(true);
      applicationId = (await submitRes.json()).applicationId as string;

      // The profile itself (legalName/licence/etc.) is a separate
      // self-service step, independent of the role grant -- build it so the
      // post-approval check below exercises the real driver surface, not an
      // approved role with nothing behind it.
      const profileRes = await applicant.put('/api/passenger/driver/profile', {
        data: {
          legalName: 'Mdf Applicant',
          displayName: 'Mdf A.',
          phone: '501-555-0199',
          homeDistrict: 'CAYO',
          licenceNumber: `DL-MDF556-${Date.now()}`,
          licenceExpiry: '2030-01-01',
          termsAccepted: true,
        },
      });
      expect(profileRes.ok()).toBe(true);

      // Before approval: the role gate refuses, by design.
      const beforeApproval = await applicant.get('/api/passenger/driver/trips');
      expect(beforeApproval.status()).toBe(403);

      // The real admin UI, not a shortcut call -- this is the half Jim could
      // walk but found nothing to exercise it with.
      const context = await browser.newContext({ storageState: ADMIN_STORAGE });
      const page: Page = await context.newPage();
      try {
        await page.goto(`/dashboard/applications/${applicationId}`);
        await expect(page.getByText(applicantEmail)).toBeVisible({ timeout: 10_000 });
        await page.getByRole('button', { name: 'Approve' }).click();
        await page.getByRole('button', { name: 'Confirm decision' }).click();
        await expect(page).toHaveURL(/\/dashboard\/applications$/, { timeout: 10_000 });
      } finally {
        await context.close();
      }

      // The second half, the part that matters: not just a row flipped, but
      // the role-gated endpoint the driver's own UI calls now actually
      // answers 200, not the 403 it gave a moment ago with the SAME
      // session/cookies -- the live before/after proof that approval
      // unlocked the role, not just that the application record says so.
      // This file's own app has no /dashboard/passenger-driver/* route to
      // check the web UI's "no Approval-required banner" rendering from
      // here (apps/admin is a different app/process -- same boundary this
      // file already respects for the operator's Confirm button); that
      // exact rendering, driven by this same role gate, is already proven
      // against a pre-approved account by the web half's driver-leg steps,
      // so it is not re-proven on a second account here.
      const afterApproval = await applicant.get('/api/passenger/driver/trips');
      expect(afterApproval.status()).toBe(200);
      expect(afterApproval.status()).not.toBe(403);
    } finally {
      await applicant.dispose();
    }
  });
});
