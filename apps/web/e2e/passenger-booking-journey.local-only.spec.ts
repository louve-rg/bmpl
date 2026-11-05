import { test, expect, type Browser, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  tryLogin,
  UAT_CUSTOMER_EMAIL,
  UAT_FIXTURE_PASSWORD,
  UAT_CUSTOMER_2_EMAIL,
  UAT_CUSTOMER_2_PASSWORD,
  UAT_PASSENGER_DRIVER_EMAIL,
  UAT_PASSENGER_PROVIDER_EMAIL,
  SUPER_ADMIN_EMAIL,
  SUPER_ADMIN_PASSWORD,
} from './support/auth';
import { clickMapToPlacePin, dragPinBy, readPinCoordinates } from './support/leaflet-map';

/**
 * MDF-556 — the owner's section 7: one continuous journey through the real
 * application, all FOUR roles. A customer books; the OPERATOR confirms that
 * same booking (role 2); the DRIVER then moves the trip through its own
 * statuses and completes it (role 3, god's follow-up: "the driver or
 * operator" named either as acceptable, but his section 7 words are "the
 * driver OR operator... updates the trip" — the trip update is the driver's
 * own surface, absent from the first pass, added here); the customer AND the
 * administrator both see the final result (role 4, admin leg in its own
 * file, see below) — plus the five negative cases the owner rates as highly
 * as the happy path.
 *
 * *** LOCAL ONLY, same reason as every other local-only spec in this repo:
 * *** /dashboard/* needs a real live API behind a real login, and CI has no
 * *** seeded database.
 *
 * SCOPE SPLIT (apps/web vs apps/admin, same reasoning as MDF-550's split):
 * customer, operator and driver are all apps/web surfaces, so the
 * customer-books -> operator-confirms -> driver-completes -> customer-sees-
 * status leg lives entirely in THIS file, genuinely continuous. "The
 * administrator sees the resulting status" is a separate app (apps/admin),
 * its own Playwright config and dev-server lifecycle — proven independently
 * in apps/admin/e2e/passenger-booking-journey-admin.local-only.spec.ts,
 * which this file cannot run inside any more than the pin-visibility spec
 * could.
 *
 * WHY CONFIRM IS THE OPERATOR'S MOMENT, NOT THE DRIVER'S: Confirm
 * (apps/web/components/passenger-operator/BookingsPanel.tsx) is the action
 * that actually changes the BOOKING's status in a way the customer and
 * admin both then see differently — the driver's start/complete acts on the
 * TRIP. Both are exercised here now: the operator confirms the booking
 * (steps 1-3), the driver moves and completes the trip (step 5), each on its
 * own fixture leg so neither interferes with the other's negative cases.
 *
 * THREE NEW OPERATOR SURFACES (Oscar's feat/passenger-location-web @
 * b0fffab9, MDF-554), each a frontend gap an API test alone cannot prove —
 * exercised in step 4: the operator's BookingsPanel row now renders the
 * rider's own pickup/drop-off pins directly (asserted on step 2's row too);
 * DeparturesManager's "View passengers" toggle fetches the trip's bookings
 * only once expanded, and only that trip's; the passenger's name renders on
 * the operator's pin row but — asserted as a negative case in step 5 — must
 * never appear on the driver's own pin view (`includePassengerName: false`
 * server-side, by construction).
 *
 * DRIVER TRIP HISTORY (Jim's finding, god's follow-up): completing a trip
 * made it vanish from the driver's own /trips list with nowhere to find it
 * again (listDriverTrips hardcoded ASSIGNED/IN_PROGRESS). Fixed on Pam's
 * additive ?status=COMPLETED filter (API @ 7aecc8f8) and Oscar's Trip
 * History page (web @ 09ec83ea, /dashboard/passenger-driver/trips/history).
 * Step 5 asserts BOTH halves of that fix: the trip really disappears from
 * the default list (that disappearance is the server's actual, intended
 * behaviour, not a bug to work around) and is reachable in History. Her own
 * integration test already proves the API half; this step proves only what
 * it cannot -- that the interface actually gets the driver there.
 *
 * FIXTURE: MAIN, a route/trip with a seat-capacity-1 vehicle ASSIGNED
 * (deliberately 1 seat, so the "unavailable seats" negative case is
 * reachable without inventing a second vehicle); SPARE, a second,
 * unassigned route/trip for the two negative cases that must not disturb
 * MAIN's booking count or its "customer already has a booking here" state;
 * and a THIRD, independent DRIVER_ROUTE/trip dedicated to the driver's own
 * start/complete actions, because advancing MAIN's own trip status away
 * from ASSIGNED would break confirmBooking's BOOKABLE_TRIP_STATUSES gate for
 * the "unavailable seats" case below (see that var's own comment).
 *
 * NEGATIVE CASES, one owner-named case per test, mapped to the actual server
 * rule each one exercises (apps/api/src/passenger/passenger-operations.service.ts):
 *   unauthorised access        -> a second customer cannot cancel the first
 *                                  customer's booking (bookingOnProviderTrip/
 *                                  cancelOwnBooking's ownership check, 404)
 *   unavailable seats          -> confirming a second request once MAIN's
 *                                  one seat is already held (confirmBooking's
 *                                  capacity check)
 *   duplicate booking attempts -> the same customer requesting the same
 *                                  departure twice (createBooking's
 *                                  "You already have a booking" check)
 *   invalid locations          -> pickup and dropoff set to the identical
 *                                  place (the schema's sameStop refusal)
 *   cancellation restrictions  -> cancelling an already-cancelled booking
 *                                  ("This booking is already settled.")
 *
 * Report, do not fix (god's standing instruction) — any failure below names
 * the step and the file/line it traces to, same discipline as MDF-550.
 */

const STORAGE_DIR = os.tmpdir();
const storagePathFor = (who: string) => path.join(STORAGE_DIR, `bmpl-e2e-journey-${who}-state-${process.pid}.json`);

async function loginAndSave(browser: Browser, email: string, password: string | undefined, storagePath: string): Promise<boolean> {
  if (!password) return false;
  const context = await browser.newContext();
  const page = await context.newPage();
  const ok = await tryLogin(page, email, password);
  if (ok) await context.storageState({ path: storagePath });
  await context.close();
  return ok;
}

async function authedPage(browser: Browser, storagePath: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ storageState: storagePath });
  const page = await context.newPage();
  return { page, close: () => context.close() };
}

/** Scopes to the one DepartureCard whose route name matches — UiCard's own
 *  `bmpl-card` class, same reasoning as the MDF-550 harness's own helper. */
function departureCard(page: Page, routeName: string) {
  return page.locator('b', { hasText: routeName }).locator('xpath=ancestor::*[contains(@class, "bmpl-card")][1]');
}

/** Scopes an operator bookings-panel row by the booking's own reference
 *  (BML-xxxxxxxx, unique) — never by passenger name or route, both of which
 *  repeat across fixture runs on the same seeded accounts. */
function operatorBookingRow(page: Page, reference: string) {
  return page.locator('li', { hasText: reference });
}

/* ----------------------------------------------------------------- logins */

const CUSTOMER_STORAGE = storagePathFor('customer');
const CUSTOMER2_STORAGE = storagePathFor('customer2');
const PROVIDER_STORAGE = storagePathFor('provider');
const DRIVER_STORAGE = storagePathFor('driver');
const ADMIN_SETUP_STORAGE = storagePathFor('admin-setup');

let customerOk = false;
let customer2Ok = false;
let providerOk = false;
let fixtureOk = false;

let mainTripId = '';
let spareTripId = '';
const MAIN_ROUTE_NAME = `MDF-556 journey ${Date.now()}`;
const SPARE_ROUTE_NAME = `MDF-556 journey spare ${Date.now()}`;

let mainBookingId = '';
let mainBookingReference = '';
let mainPassengerName = '';

// A THIRD, independent trip dedicated to the driver's own start/complete
// actions. MAIN must stay ASSIGNED (not COMPLETED/IN_PROGRESS) for the
// negative cases below -- confirmBooking's BOOKABLE_TRIP_STATUSES gate
// (passenger-operations.service.ts) only allows SCHEDULED/ASSIGNED, so
// advancing MAIN's own trip status here would break "unavailable seats"'
// capacity-specific refusal by hitting the trip-status refusal instead.
let driverTripId = '';
const DRIVER_ROUTE_NAME = `MDF-556 journey driver-leg ${Date.now()}`;
let driverBookingId = '';
let driverBookingReference = '';

function skipIfNoFixture() {
  test.skip(!fixtureOk, 'Needs a live API + seeded dev database (UAT_CUSTOMER/UAT_CUSTOMER_2/UAT_PASSENGER_PROVIDER/UAT_PASSENGER_DRIVER/SUPER_ADMIN). See file header.');
}

test.beforeAll(async ({ browser }) => {
  // Five sequential UI logins plus a dozen-odd API round trips, same
  // reasoning as MDF-550's beforeAll: comfortably exceeds the file's default
  // 30s per-test timeout, which a bare hook inherits.
  test.setTimeout(120_000);

  customerOk = await loginAndSave(browser, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD, CUSTOMER_STORAGE);
  customer2Ok = await loginAndSave(browser, UAT_CUSTOMER_2_EMAIL, UAT_CUSTOMER_2_PASSWORD, CUSTOMER2_STORAGE);
  providerOk = await loginAndSave(browser, UAT_PASSENGER_PROVIDER_EMAIL, UAT_FIXTURE_PASSWORD, PROVIDER_STORAGE);
  const driverOk = await loginAndSave(browser, UAT_PASSENGER_DRIVER_EMAIL, UAT_FIXTURE_PASSWORD, DRIVER_STORAGE);
  const adminOk = await loginAndSave(browser, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD ?? '', ADMIN_SETUP_STORAGE);
  if (!customerOk || !customer2Ok || !providerOk || !driverOk || !adminOk) return;

  const provider = await authedPage(browser, PROVIDER_STORAGE);
  const driver = await authedPage(browser, DRIVER_STORAGE);
  const admin = await authedPage(browser, ADMIN_SETUP_STORAGE);
  const customer = await authedPage(browser, CUSTOMER_STORAGE);
  try {
    const driverProfileRes = await driver.page.request.get('/api/passenger/driver/profile');
    if (!driverProfileRes.ok()) return;
    const driverProfileId = (await driverProfileRes.json()).id as string;

    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

    const mainRouteRes = await provider.page.request.post('/api/passenger/provider/routes', {
      data: {
        name: MAIN_ROUTE_NAME,
        originDistrict: 'BELIZE',
        originCity: 'Belize City',
        destinationDistrict: 'CAYO',
        destinationCity: 'San Ignacio',
        scheduleNote: 'MDF-556 journey harness fixture',
        baseFareMinor: 3000,
      },
    });
    if (!mainRouteRes.ok()) return;
    const mainRoute = await mainRouteRes.json();
    const mainTripRes = await provider.page.request.post('/api/passenger/provider/trips', {
      data: { routeId: mainRoute.id, scheduledDepartureAt: tomorrow },
    });
    if (!mainTripRes.ok()) return;
    mainTripId = (await mainTripRes.json()).id;

    // SPARE: fare configured, deliberately left UNASSIGNED — the two
    // negative cases that use it (invalid locations, cancellation
    // restrictions) never reach confirmation, so no vehicle is needed, and
    // staying off MAIN keeps those checks from touching MAIN's one-seat
    // capacity or the "already have a booking on this departure" state.
    const spareRouteRes = await provider.page.request.post('/api/passenger/provider/routes', {
      data: {
        name: SPARE_ROUTE_NAME,
        originDistrict: 'BELIZE',
        originCity: 'Belize City',
        destinationDistrict: 'CAYO',
        destinationCity: 'San Ignacio',
        scheduleNote: 'MDF-556 journey harness fixture (spare, unassigned)',
        baseFareMinor: 3000,
      },
    });
    if (!spareRouteRes.ok()) return;
    const spareRoute = await spareRouteRes.json();
    const spareTripRes = await provider.page.request.post('/api/passenger/provider/trips', {
      data: { routeId: spareRoute.id, scheduledDepartureAt: tomorrow },
    });
    if (!spareTripRes.ok()) return;
    spareTripId = (await spareTripRes.json()).id;

    // Idempotent affiliation, same pattern as MDF-550: a prior run may
    // already hold an ACCEPTED affiliation between this provider and driver.
    const existingRes = await provider.page.request.get('/api/passenger/provider/affiliations');
    const existing = existingRes.ok() ? await existingRes.json() : [];
    const already = (existing as Array<{ id: string; driverProfileId: string; status: string }>).find(
      (a) => a.driverProfileId === driverProfileId && a.status === 'ACCEPTED',
    );
    if (!already) {
      const inviteRes = await provider.page.request.post('/api/passenger/provider/affiliations/invite', {
        data: { driverProfileId },
      });
      if (!inviteRes.ok()) return;
      const invite = await inviteRes.json();
      const acceptRes = await driver.page.request.post(`/api/passenger/driver/affiliations/${invite.id}/accept`);
      if (!acceptRes.ok()) return;
    }

    // seatCapacity: 1 — deliberately the smallest real capacity, so the
    // "unavailable seats" negative case needs no second vehicle and no
    // contrived oversell; one confirmed booking IS the exhausted state.
    const vehicleRes = await provider.page.request.post('/api/passenger/provider/vehicles', {
      data: { type: 'CAR', make: 'Toyota', model: 'Corolla', licencePlate: `UAT556${Date.now()}`.slice(0, 18), seatCapacity: 1 },
    });
    if (!vehicleRes.ok()) return;
    const vehicle = await vehicleRes.json();
    const approveRes = await admin.page.request.post(`/api/admin/passengers/vehicles/${vehicle.id}/approve`);
    if (!approveRes.ok()) return;

    const assignRes = await provider.page.request.post(`/api/passenger/provider/trips/${mainTripId}/assign`, {
      data: { driverProfileId, vehicleId: vehicle.id },
    });
    if (!assignRes.ok()) return;

    // DRIVER_ROUTE: its own route/trip/vehicle, assigned to the same driver,
    // kept separate from MAIN for the reason at this file's top (the driver
    // leg advances this trip's status all the way to COMPLETED; MAIN must
    // not move). Booked and confirmed via direct API -- "customer books" and
    // "operator confirms" are already proven through the real UI on MAIN in
    // steps 1-2; this leg's own job is the driver's actions and what the
    // customer sees once they land.
    const driverRouteRes = await provider.page.request.post('/api/passenger/provider/routes', {
      data: {
        name: DRIVER_ROUTE_NAME,
        originDistrict: 'BELIZE',
        originCity: 'Belize City',
        destinationDistrict: 'CAYO',
        destinationCity: 'San Ignacio',
        scheduleNote: 'MDF-556 journey harness fixture (driver leg)',
        baseFareMinor: 3000,
      },
    });
    if (!driverRouteRes.ok()) return;
    const driverRoute = await driverRouteRes.json();
    const driverTripRes = await provider.page.request.post('/api/passenger/provider/trips', {
      data: { routeId: driverRoute.id, scheduledDepartureAt: tomorrow },
    });
    if (!driverTripRes.ok()) return;
    driverTripId = (await driverTripRes.json()).id;

    const driverVehicleRes = await provider.page.request.post('/api/passenger/provider/vehicles', {
      data: { type: 'CAR', make: 'Toyota', model: 'Yaris', licencePlate: `UAT556D${Date.now()}`.slice(0, 18), seatCapacity: 1 },
    });
    if (!driverVehicleRes.ok()) return;
    const driverVehicle = await driverVehicleRes.json();
    const driverVehicleApproveRes = await admin.page.request.post(`/api/admin/passengers/vehicles/${driverVehicle.id}/approve`);
    if (!driverVehicleApproveRes.ok()) return;

    const driverAssignRes = await provider.page.request.post(`/api/passenger/provider/trips/${driverTripId}/assign`, {
      data: { driverProfileId, vehicleId: driverVehicle.id },
    });
    if (!driverAssignRes.ok()) return;

    const driverBookingRes = await customer.page.request.post('/api/passenger/bookings', {
      data: {
        tripId: driverTripId,
        seats: 1,
        // isLocatable (packages/validation/src/common.ts) needs a street OR
        // a complete pin -- district/city alone is not a locatable address.
        pickup: { district: 'CAYO', city: 'Spanish Lookout', address: 'Spanish Lookout Centre' },
        dropoff: { district: 'CAYO', city: 'Benque Viejo', address: 'Benque Viejo Town Centre' },
      },
    });
    if (!driverBookingRes.ok()) return;
    const driverBooking = await driverBookingRes.json();
    driverBookingId = driverBooking.id;
    driverBookingReference = driverBooking.reference;

    const driverConfirmRes = await provider.page.request.post(`/api/passenger/provider/bookings/${driverBookingId}/confirm`);
    fixtureOk = driverConfirmRes.ok();
  } finally {
    await provider.close();
    await driver.close();
    await admin.close();
    await customer.close();
  }
});

test.afterAll(() => {
  fs.rmSync(CUSTOMER_STORAGE, { force: true });
  fs.rmSync(CUSTOMER2_STORAGE, { force: true });
  fs.rmSync(PROVIDER_STORAGE, { force: true });
  fs.rmSync(DRIVER_STORAGE, { force: true });
  fs.rmSync(ADMIN_SETUP_STORAGE, { force: true });
});

/* ------------------------------------------------- the continuous journey */

test.describe.serial('[LOCAL ONLY, skips in CI] MDF-556 — customer books, operator confirms, customer sees the result', () => {
  test('step 1 — the customer finds the service, drops both pins, sees a price, and submits', async ({ browser }) => {
    skipIfNoFixture();
    const { page, close } = await authedPage(browser, CUSTOMER_STORAGE);
    try {
      await page.goto('/dashboard/passenger');
      const card = departureCard(page, MAIN_ROUTE_NAME);

      // "sees a price" — the fare gate's positive state, not computed on by
      // this test, just shown verbatim by the server-configured figure.
      await expect(card.getByText('Fare', { exact: false })).toBeVisible({ timeout: 10_000 });

      await card.getByRole('button', { name: 'Request seats' }).click();

      await page.getByLabel(/Pick me up somewhere other than the route.s stop/i).check();
      const pickupSection = page.getByRole('group', { name: 'Pickup location' });
      await pickupSection.getByLabel(/city, town or village/i).fill('Spanish Lookout');
      await pickupSection.getByLabel(/district or island/i).selectOption('CAYO');
      await clickMapToPlacePin(page, { x: 0.3, y: 0.3 }, 0);

      await page.getByLabel(/Drop me off somewhere other than the route.s stop/i).check();
      const dropoffSection = page.getByRole('group', { name: 'Destination' });
      await dropoffSection.getByLabel(/city, town or village/i).fill('Benque Viejo');
      await dropoffSection.getByLabel(/district or island/i).selectOption('CAYO');
      await clickMapToPlacePin(page, { x: 0.8, y: 0.8 }, 1);

      // "picks seats" — explicit, not just accepting the field's own default.
      await card.locator('input[type="number"]').fill('1');

      await card.getByRole('button', { name: 'Send request' }).click();
      await expect(page.getByText('Request sent')).toBeVisible({ timeout: 10_000 });

      const bookingsRes = await page.request.get('/api/passenger/bookings');
      expect(bookingsRes.ok()).toBe(true);
      const bookings = (await bookingsRes.json()) as Array<{ id: string; reference: string; tripId: string; status: string }>;
      const mine = bookings.find((b) => b.tripId === mainTripId);
      if (!mine) throw new Error('Could not find the just-submitted booking in /passenger/bookings.');
      expect(mine.status).toBe('REQUESTED');
      mainBookingId = mine.id;
      mainBookingReference = mine.reference;
    } finally {
      await close();
    }
  });

  test('step 2 — the operator sees the same booking and confirms it', async ({ browser }) => {
    skipIfNoFixture();
    test.skip(!mainBookingId, 'step 1 did not produce a booking to confirm.');
    const { page, close } = await authedPage(browser, PROVIDER_STORAGE);
    try {
      await page.goto('/dashboard/passenger-operator/bookings');
      const row = operatorBookingRow(page, mainBookingReference);
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.getByRole('button', { name: 'Confirm' }).click();
      await expect(row.getByText(/confirmed/i)).toBeVisible({ timeout: 10_000 });

      // MDF-554 gap A: the operator's own booking row now carries the
      // rider's pins directly -- assert the ones the customer placed in
      // step 1 are the ones the operator reads here.
      await expect(row.getByText(/Spanish Lookout/i)).toBeVisible();
      await expect(row.getByText(/Benque Viejo/i)).toBeVisible();
    } finally {
      await close();
    }
  });

  test('step 3 — the customer sees the booking is now confirmed, with seats actually held', async ({ browser }) => {
    skipIfNoFixture();
    test.skip(!mainBookingId, 'step 1/2 did not produce a confirmed booking to view.');
    const { page, close } = await authedPage(browser, CUSTOMER_STORAGE);
    try {
      await page.goto('/dashboard/passenger/bookings');
      const row = page.locator('li', { hasText: mainBookingReference });
      await expect(row.getByText('Confirmed', { exact: true })).toBeVisible({ timeout: 10_000 });
      await expect(row.getByText('Your seats are held on this departure.', { exact: false })).toBeVisible();
    } finally {
      await close();
    }
  });

  test('step 4 — the operator opens View passengers and reads the rider\'s pins and name, fetched only once expanded and filtered to the one departure', async ({ browser }) => {
    skipIfNoFixture();
    test.skip(!mainBookingId, 'depends on step 1/2 having a confirmed booking on MAIN to view.');
    const { page, close } = await authedPage(browser, PROVIDER_STORAGE);
    const customer2 = await authedPage(browser, CUSTOMER2_STORAGE);
    let spareBookingId = '';
    try {
      // A throwaway booking on the OTHER departure, to prove the tripId
      // filter actually excludes another trip's bookings rather than
      // happening to be the only one around.
      const spareBookingRes = await customer2.page.request.post('/api/passenger/bookings', { data: { tripId: spareTripId, seats: 1 } });
      if (spareBookingRes.ok()) spareBookingId = (await spareBookingRes.json()).id;

      // The server's own word on what this view should show, not a guess at
      // the fixture's seeded name.
      const filteredRes = await page.request.get(`/api/passenger/provider/bookings?tripId=${mainTripId}`);
      expect(filteredRes.ok()).toBe(true);
      const filtered = (await filteredRes.json()) as Array<{ id: string; tripId: string | null; passengerName?: string | null }>;
      const mainRow = filtered.find((b) => b.id === mainBookingId);
      if (!mainRow || !mainRow.passengerName) {
        throw new Error('Fixture booking has no passengerName from the server -- cannot assert the UI against it.');
      }
      mainPassengerName = mainRow.passengerName;
      expect(filtered.every((b) => b.tripId === mainTripId)).toBe(true);
      expect(filtered.some((b) => b.id === spareBookingId)).toBe(false);

      const allRes = await page.request.get('/api/passenger/provider/bookings');
      const all = (await allRes.json()) as Array<{ id: string }>;
      expect(all.some((b) => b.id === spareBookingId)).toBe(true); // confirms the spare booking really exists, just filtered out above

      let fetchCount = 0;
      page.on('request', (req) => {
        if (req.url().includes(`/passenger/provider/bookings?tripId=${mainTripId}`)) fetchCount++;
      });

      await page.goto('/dashboard/passenger-operator/departures');
      const card = departureCard(page, MAIN_ROUTE_NAME);
      await expect(card.getByRole('button', { name: 'View passengers' })).toBeVisible({ timeout: 10_000 });
      expect(fetchCount).toBe(0); // not fetched merely by loading the departures page

      await card.getByRole('button', { name: 'View passengers' }).click();
      const pinRow = card.locator('li', { hasText: mainBookingReference });
      await expect(pinRow).toBeVisible({ timeout: 10_000 });
      await expect(pinRow.getByText(mainPassengerName)).toBeVisible();
      await expect(pinRow.getByText(/Spanish Lookout/i)).toBeVisible();
      await expect(pinRow.getByText(/Benque Viejo/i)).toBeVisible();
      expect(fetchCount).toBeGreaterThanOrEqual(1); // fetched once it's expanded
    } finally {
      // Self-cancel immediately -- this booking exists only to prove
      // filtering; left ACTIVE it would collide with "cancellation
      // restrictions" below, which needs customer 2 free to open its own
      // fresh booking on SPARE.
      if (spareBookingId) await customer2.page.request.post(`/api/passenger/bookings/${spareBookingId}/cancel`, { data: {} });
      await customer2.close();
      await close();
    }
  });

  test('step 5 — the driver reads the same pins with no passenger name, starts the trip, completes it, and the trip moves to history instead of vanishing', async ({ browser }) => {
    skipIfNoFixture();
    test.skip(!driverBookingId, 'the driver-leg fixture (its own route/trip/vehicle/booking) did not come up.');
    const { page, close } = await authedPage(browser, DRIVER_STORAGE);
    try {
      await page.goto('/dashboard/passenger-driver/trips');
      const row = departureCard(page, DRIVER_ROUTE_NAME);
      await expect(row).toBeVisible({ timeout: 10_000 });

      await row.getByRole('button', { name: 'View passengers' }).click();
      const pinRow = row.locator('li', { hasText: driverBookingReference });
      await expect(pinRow).toBeVisible({ timeout: 10_000 });
      await expect(pinRow.getByText(/Spanish Lookout/i)).toBeVisible();
      await expect(pinRow.getByText(/Benque Viejo/i)).toBeVisible();
      // The negative assertion the owner named: a name must never appear on
      // the driver's own pin view. The server passes includePassengerName:
      // false on this endpoint by construction -- if it ever leaks through,
      // this is the defect.
      if (mainPassengerName) await expect(pinRow.getByText(mainPassengerName)).toHaveCount(0);

      await row.getByRole('button', { name: 'Start trip' }).click();
      await expect(row.getByText(/in progress/i)).toBeVisible({ timeout: 10_000 });

      await row.getByRole('button', { name: 'Complete trip' }).click();
      // Jim's finding (confirmed server-side: listDriverTrips only ever
      // returned ASSIGNED/IN_PROGRESS): a completed trip genuinely vanishes
      // from this default list -- that disappearance IS the bug, so
      // asserting it here is the correct, expected behaviour, not something
      // to route around.
      await expect(row).toHaveCount(0, { timeout: 10_000 });

      // Pam's additive ?status=COMPLETED filter (API @ 7aecc8f8) already has
      // its own integration coverage for the data; Oscar's Trip History page
      // (web @ 09ec83ea) is the thing her test cannot prove -- that the
      // driver can actually REACH the completed trip through the real
      // interface, not just that the API returns it correctly. Written
      // against the real surface now that it exists; if this ever
      // regresses, the failure here names exactly what disappeared.
      await page.goto('/dashboard/passenger-driver/trips/history');
      const historyRow = departureCard(page, DRIVER_ROUTE_NAME);
      await expect(historyRow).toBeVisible({ timeout: 10_000 });
      await expect(historyRow.getByText(/completed/i)).toBeVisible();
    } finally {
      await close();
    }
  });

  test('step 6 — the customer sees the booking is completed once the driver finishes the trip', async ({ browser }) => {
    skipIfNoFixture();
    test.skip(!driverBookingId, 'depends on step 5 completing the driver-leg trip.');
    const { page, close } = await authedPage(browser, CUSTOMER_STORAGE);
    try {
      await page.goto('/dashboard/passenger/bookings');
      const row = page.locator('li', { hasText: driverBookingReference });
      await expect(row.getByText('Completed', { exact: true })).toBeVisible({ timeout: 10_000 });
      // Not the state it was in a moment ago -- proves a live read of the
      // post-completion status, not the confirmed one step 3 saw on MAIN.
      await expect(row.getByText('Confirmed', { exact: true })).toHaveCount(0);
    } finally {
      await close();
    }
  });
});

/* --------------------------------------- negative cases against MAIN/step-1-2 state */

test.describe('[LOCAL ONLY, skips in CI] MDF-556 negative cases — unauthorised access, unavailable seats, duplicate booking', () => {
  test('unavailable seats — once the one seat on MAIN is held, confirming a second request on it fails', async ({ browser }) => {
    skipIfNoFixture();
    test.skip(!mainBookingId, 'depends on step 1/2 having confirmed the one seat on MAIN.');
    const customer2 = await authedPage(browser, CUSTOMER2_STORAGE);
    const provider = await authedPage(browser, PROVIDER_STORAGE);
    try {
      const reqRes = await customer2.page.request.post('/api/passenger/bookings', {
        data: { tripId: mainTripId, seats: 1 },
      });
      // A request is always accepted — capacity is checked at CONFIRMATION,
      // not at request time (the server's documented design, not a bug).
      expect(reqRes.ok()).toBe(true);
      const secondBooking = await reqRes.json();

      await provider.page.goto('/dashboard/passenger-operator/bookings');
      const row = operatorBookingRow(provider.page, secondBooking.reference);
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.getByRole('button', { name: 'Confirm' }).click();
      await expect(row.getByText(/not enough seats left/i)).toBeVisible({ timeout: 10_000 });

      // The server's own word on it, not just the UI's claim.
      const check = await provider.page.request.get(`/api/passenger/provider/bookings?tripId=${mainTripId}`);
      const rows = (await check.json()) as Array<{ id: string; status: string }>;
      expect(rows.find((b) => b.id === secondBooking.id)?.status).toBe('REQUESTED');
    } finally {
      await customer2.close();
      await provider.close();
    }
  });

  test('duplicate booking attempts — the same customer cannot request the same departure twice', async ({ browser }) => {
    skipIfNoFixture();
    test.skip(!mainBookingId, 'depends on step 1 already holding a booking on MAIN.');
    const { page, close } = await authedPage(browser, CUSTOMER_STORAGE);
    try {
      await page.goto('/dashboard/passenger');
      const card = departureCard(page, MAIN_ROUTE_NAME);
      // The confirmed booking already removed "Request seats" from this
      // card's own happy-path state in step 1-3's run, so this hits the
      // server directly — the same call the button would make, and the
      // rule under test (createBooking's "You already have a booking")
      // fires identically either way.
      const dupeRes = await page.request.post('/api/passenger/bookings', { data: { tripId: mainTripId, seats: 1 } });
      expect(dupeRes.ok()).toBe(false);
      expect(dupeRes.status()).toBe(400);
      const body = await dupeRes.json();
      expect(body.message).toMatch(/already have a booking/i);
    } finally {
      await close();
    }
  });

  test('unauthorised access — a second customer cannot cancel the first customer\'s booking', async ({ browser }) => {
    skipIfNoFixture();
    test.skip(!mainBookingId, 'depends on step 1 having a real booking id to attack.');
    const customer2 = await authedPage(browser, CUSTOMER2_STORAGE);
    try {
      const res = await customer2.page.request.post(`/api/passenger/bookings/${mainBookingId}/cancel`, { data: {} });
      expect(res.ok()).toBe(false);
      expect(res.status()).toBe(404);

      // Not just the attacker's own view — prove the booking the real owner
      // sees is untouched by the attempt.
      const owner = await authedPage(browser, CUSTOMER_STORAGE);
      try {
        const mineRes = await owner.page.request.get('/api/passenger/bookings');
        const mine = (await mineRes.json()) as Array<{ id: string; status: string }>;
        expect(mine.find((b) => b.id === mainBookingId)?.status).toBe('CONFIRMED');
      } finally {
        await owner.close();
      }
    } finally {
      await customer2.close();
    }
  });
});

/* ---------------------------------- negative cases independent of MAIN (use SPARE) */

test.describe('[LOCAL ONLY, skips in CI] MDF-556 negative cases — invalid locations, cancellation restrictions', () => {
  test('invalid locations — pickup and dropoff cannot be set to the identical place', async ({ browser }) => {
    skipIfNoFixture();
    const { page, close } = await authedPage(browser, CUSTOMER_STORAGE);
    try {
      const res = await page.request.post('/api/passenger/bookings', {
        data: {
          tripId: spareTripId,
          seats: 1,
          pickup: { district: 'CAYO', city: 'San Ignacio', address: 'Same Street' },
          dropoff: { district: 'CAYO', city: 'San Ignacio', address: 'Same Street' },
        },
      });
      expect(res.ok()).toBe(false);
      expect(res.status()).toBe(400);
      // The Zod validation pipe's shape (apps/api/src/common/zod-validation.pipe.ts):
      // a flat "Validation failed" at the top, the real per-field refusal in
      // `errors[]` — not `message` itself.
      const body = (await res.json()) as { message: string; errors: Array<{ path: string; message: string }> };
      expect(body.errors.some((e) => /[Pp]ickup and dropoff cannot be the same place/.test(e.message))).toBe(true);
    } finally {
      await close();
    }
  });

  test('cancellation restrictions — a booking that is already cancelled cannot be cancelled again', async ({ browser }) => {
    skipIfNoFixture();
    const { page, close } = await authedPage(browser, CUSTOMER2_STORAGE);
    try {
      const createRes = await page.request.post('/api/passenger/bookings', { data: { tripId: spareTripId, seats: 1 } });
      expect(createRes.ok()).toBe(true);
      const booking = await createRes.json();

      const firstCancel = await page.request.post(`/api/passenger/bookings/${booking.id}/cancel`, { data: {} });
      expect(firstCancel.ok()).toBe(true);
      expect((await firstCancel.json()).status).toBe('CANCELLED');

      const secondCancel = await page.request.post(`/api/passenger/bookings/${booking.id}/cancel`, { data: {} });
      expect(secondCancel.ok()).toBe(false);
      expect(secondCancel.status()).toBe(400);
      const body = await secondCancel.json();
      expect(body.message).toMatch(/already settled/i);
    } finally {
      await close();
    }
  });
});
