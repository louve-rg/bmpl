import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { tryLogin } from './support/auth';

/**
 * MDF-550, owner directive 2026-11-05, check #9 (god's numbering to me) /
 * the owner's final named check: the admin can view a passenger's pinned
 * pickup and destination. Lives in its own file, not in apps/web's harness
 * (apps/web/e2e/location-address-harness.local-only.spec.ts) — apps/admin is
 * a separate Next.js app, separate Playwright config, separate dev-server
 * lifecycle; that file's own header explains why admin visibility can never
 * run inside it.
 *
 * *** LOCAL ONLY, SKIPS IN CI -- same reason as every other local-only spec
 * *** in this repo: /dashboard/* needs a real live API behind a real login,
 * *** and CI has no seeded database.
 *
 * FIXTURE (route, trip, booking) is built by talking to the live API
 * DIRECTLY (plain `request.newContext()` at the API's own base URL, not
 * through either Next app's rewrite proxy) rather than through this app's
 * own UI — admin visibility of pickup/dropoff needs no assigned vehicle at
 * all (confirmed against apps/api/test/passenger-booking.integration.spec.ts's
 * own "reaches admins" test, which never assigns one either), so the setup
 * stays to exactly what the one check under test needs. Reuses the already-
 * seeded UAT_PASSENGER_PROVIDER / UAT_CUSTOMER accounts rather than
 * registering throwaway ones.
 *
 * ASYMMETRIC locations, god's own instruction for the reversal property:
 * Belize City pickup, Punta Gorda dropoff — the same two towns Pam's own
 * integration test uses, not invented here.
 */

const SUPER_ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@bzemarketplace.com';
const SUPER_ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD;
const UAT_PASSENGER_PROVIDER_EMAIL = 'uat-passenger-provider@bzemarketplace.com';
const UAT_CUSTOMER_EMAIL = 'uat-customer@bzemarketplace.com';
const UAT_FIXTURE_PASSWORD = process.env.UAT_SEED_PASSWORD ?? 'UatWalkthrough!123';

/**
 * The API's own base URL — same variable this app's next.config.mjs reads
 * for its /api/* rewrite (see that file's own error message), so a fixture
 * built against this always matches whatever the admin UI itself will proxy
 * to. No hardcoded-port fallback here on purpose: an unset var must fail
 * fixture setup loudly (skips the suite) rather than guess a port.
 */
const API_BASE = process.env.ADMIN_PUBLIC_API_URL;

const ADMIN_STORAGE = path.join(os.tmpdir(), `bmpl-e2e-pax-admin-view-${process.pid}.json`);
let fixtureOk = false;
let bookingId = '';

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
        name: `MDF-550 admin-view ${Date.now()}`,
        originDistrict: 'BELIZE',
        originCity: 'Belize City',
        destinationDistrict: 'TOLEDO',
        destinationCity: 'Punta Gorda',
        scheduleNote: 'MDF-550 admin-visibility harness fixture',
        baseFareMinor: 2500,
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

    const bookingRes = await rider.post('/api/passenger/bookings', {
      data: {
        tripId: trip.id,
        seats: 1,
        // Ladyville/Dangriga — deliberately distinct from the route's own
        // Belize City/Punta Gorda origin-destination (set above), so a text
        // match in the assertions below cannot be satisfied by the route's
        // own, unrelated display, only by the booking's actual pin snapshot.
        pickup: { district: 'BELIZE', city: 'Ladyville', latitude: 17.4995, longitude: -88.1976 },
        dropoff: { district: 'STANN_CREEK', city: 'Dangriga', latitude: 16.103, longitude: -88.8004 },
      },
    });
    if (!bookingRes.ok()) return;
    bookingId = (await bookingRes.json()).id as string;
    fixtureOk = true;
  } finally {
    await provider.dispose();
    await rider.dispose();
  }
});

test.afterAll(() => {
  fs.rmSync(ADMIN_STORAGE, { force: true });
});

function skipIfNoFixture() {
  test.skip(!fixtureOk, 'Needs a live API + seeded dev database (SEED_SUPER_ADMIN_PASSWORD, UAT_PASSENGER_PROVIDER, UAT_CUSTOMER) and ADMIN_PUBLIC_API_URL set. See file header.');
}

test.describe('[LOCAL ONLY, skips in CI] MDF-550 #9 — the admin can view a passenger booking\'s pickup and destination, not swapped', () => {
  test('admin booking-detail page shows the real pickup and destination', async ({ browser }) => {
    skipIfNoFixture();
    const context = await browser.newContext({ storageState: ADMIN_STORAGE });
    const page = await context.newPage();
    try {
      await page.goto(`/dashboard/passengers/bookings/${bookingId}`);
      // Not reversed: Ladyville (pickup) and Dangriga (dropoff) each visible,
      // under their own "Pickup"/"Drop-off" EndCard — scoped past a bare
      // text match so a swap (Ladyville under Drop-off) would fail this, not
      // just a missing render.
      const pickupCard = page.getByText('Pickup', { exact: true }).locator('xpath=ancestor::*[self::section or self::div][1]');
      const dropoffCard = page.getByText('Drop-off', { exact: true }).locator('xpath=ancestor::*[self::section or self::div][1]');
      await expect(pickupCard.getByText('Ladyville', { exact: false })).toBeVisible({ timeout: 10_000 });
      await expect(dropoffCard.getByText('Dangriga', { exact: false })).toBeVisible();
      await expect(pickupCard.getByText('Dangriga', { exact: false })).toHaveCount(0);
      await expect(dropoffCard.getByText('Ladyville', { exact: false })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
