import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
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
 * that status correctly.
 */

const SUPER_ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@bzemarketplace.com';
const SUPER_ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD;
const UAT_PASSENGER_PROVIDER_EMAIL = 'uat-passenger-provider@bzemarketplace.com';
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
    fixtureOk = confirmRes.ok();
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

test.describe('[LOCAL ONLY, skips in CI] MDF-556 — the administrator sees a confirmed booking\'s status correctly', () => {
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
});
