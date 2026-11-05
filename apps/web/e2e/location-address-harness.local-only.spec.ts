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
  UAT_DRIVER_EMAIL,
  UAT_DRIVER_PASSWORD,
  SUPER_ADMIN_EMAIL,
  SUPER_ADMIN_PASSWORD,
  UAT_PASSENGER_DRIVER_EMAIL,
  UAT_PASSENGER_PROVIDER_EMAIL,
} from './support/auth';
import {
  mapContainer,
  clickMapToPlacePin,
  dragPinBy,
  touchDragPinBy,
  readPinCoordinates,
  denyGeolocationPermission,
  waitForMapReady,
} from './support/leaflet-map';

/**
 * MDF-535 / MDF-485 — the REAL end-to-end harness for the owner's 14 named
 * checks on saved addresses, GPS pin placement and interactive maps.
 *
 * *** LOCAL ONLY, same shape and same reason as
 * *** authenticated-dashboard-geometry.local-only.spec.ts: every test below
 * *** calls test.skip() on CI because CI has no seeded database and no live
 * *** API for tryLogin to reach. A clean run here means "ran locally against
 * *** a seeded dev database," never "CI verified this." Read that file's own
 * *** header before trusting a green check that includes this file.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT MOCK: no `page.route()` on `/addresses`,
 * `/me`, `/auth/*`, `/checkout` or `/cart` anywhere below — every one of those
 * calls hits the real API against the real seeded dev database. The two
 * exceptions, both load-bearing, both documented inline: (1) adding the
 * harness product to the cart via a direct authenticated API call rather than
 * clicking through product-browsing UI that has nothing to do with location
 * (still a REAL POST to the REAL API, not a mock); (2) geolocation, which is
 * driven through Playwright's own real permission/CDP geolocation-override
 * mechanism (support/leaflet-map.ts), never a JS stub of `navigator.geolocation`.
 *
 * FIXTURES THIS FILE NEEDS (packages/database/prisma/seed-uat-location-e2e.ts,
 * run via `pnpm --filter @bmpl/database seed:uat-location-e2e` after the base
 * `pnpm db:seed`): a second customer account (check #13 needs two), and a
 * dedicated OPEN, delivery-enabled vendor+product (checks #7/#8 need a real
 * order to land in). Skips cleanly (not failure) if that seed has not run.
 *
 * COVERAGE MAP (see this harness's report to god for the full one):
 *   #1 drop a pin         -> describe A
 *   #2 drag + confirm      -> describe A
 *   #3 coordinates saved   -> describe A (API round-trip, not the UI's own claim)
 *   #4 save as a label     -> describe B
 *   #5 persists after logout/login -> describe C
 *   #6 edit and delete     -> describe B
 *   #7 selects saved addr at checkout -> describe E
 *   #8 reaches the order record       -> describe E
 *   #6/#7 PAIR — search a landmark, then drag overrides it -> describe L
 *   #9 driver views pickup/delivery location, BOTH halves of the gate -> describe G
 *   #11 GPS denial doesn't block manual pin -> describe D
 *   #12 no formal street address saves -> describe B
 *   #13 cross-customer isolation       -> describe F
 *   TOUCH pin-drag (Oscar's gap-table finding #1, not an owner-numbered
 *     check on its own, but the forcing function for "does the map actually
 *     work on mobile" the owner's tablet/mobile requirement implies) -> describe H
 *
 * CORRECTIONS TO AN EARLIER VERSION OF THIS HARNESS, both caught by god
 * re-checking the refs rather than taking my first report on faith — kept
 * here so the next person does not repeat either mistake:
 *   - AddressField is NOT checkout-only. `EndpointPicker.tsx` (shipping's
 *     DOOR/TERMINAL picker) imports it directly — "the door case is the
 *     shared AddressField," per that file's own comment. One map
 *     implementation serves both checkout AND shipping door bookings, so
 *     #7/#8 already have a second real surface beyond marketplace checkout.
 *   - The driver interface for #9 already existed. My first grep was for
 *     `MapPreview` directly and found no real call sites — true, but the
 *     wrong question: `ExpandableRouteMap` WRAPS `MapPreview`, and
 *     `app/dashboard/driver/jobs/[id]/page.tsx` imports and renders
 *     `ExpandableRouteMap`, gated on `job.addressUnlocked` exactly as
 *     described in describe G below. Only the CARRIER half of #9 is
 *     actually unbuilt (no location surface anywhere in carrier
 *     self-service yet, confirmed independently by Jim) — Milestone 3 work.
 *
 *   #10 and the carrier half of #9: NOT in this file, correctly blocked.
 *     No passenger-service page uses LocationPicker/MapPreview at all (and
 *     the owner has an open scope question on passenger service generally —
 *     fixed-route seat booking has no pickup/destination concept — so this
 *     harness does not build toward either answer). Carrier self-service has
 *     no location surface to test yet.
 *   #14 (regression): not new specs here — the existing suites this harness
 *     sits beside already cover checkout/wallet/carrier/booking; re-running
 *     them once Pam/Oscar's changes land is the actual #14 check, not a new
 *     test written against code that does not exist yet.
 *
 * describe I and J were both originally written against semantics that did
 * not exist in the tree yet, before Oscar shipped the work each one checks
 * (FullScreenMapModal confirm/cancel, and the search box being reachable on
 * a live page). Both now run for real against the final code — their own
 * header comments record what changed and when, rather than silently
 * dropping the history once the check stopped skipping or failing.
 *
 * describe L and M are god's MDF-535 follow-up, added against the two final
 * merged heads (feat/location-api-saved-addresses 60a85ab0,
 * feat/location-web-map-picker 6a95d9aa): L is owner behaviours #6/#7 as a
 * pair (search a landmark, then prove a drag overrides it), M is the
 * cross-contamination check for "Show my address" and the search box now
 * sharing one screen.
 */

const STORAGE_DIR = os.tmpdir();
const storagePathFor = (who: string) => path.join(STORAGE_DIR, `bmpl-e2e-${who}-state-${process.pid}.json`);

/**
 * Next's dev server compiles each route on first visit, not at startup — this
 * harness's own live runs hit that directly: whichever test is first to
 * navigate to /checkout can take long enough to compile that a plain
 * `selectOption` several steps later blows the test's own timeout, with no
 * relation to Leaflet, the map, or anything this harness is meant to be
 * checking. global-setup.ts (shared by every spec in this repo, not owned by
 * this file) already waits for the SERVER process to be ready; it does not
 * and should not warm individual routes for one spec's sake. Doing the warm-up
 * here instead keeps the fix local to this file. The request's outcome is
 * irrelevant — a redirect to login is exactly as good as a 200 for forcing
 * the compile — only the wait matters.
 */
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/checkout', { timeout: 60_000 }).catch(() => {});
  await context.close();
});

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

/* ------------------------------------------------------------- customer 1 */

const CUSTOMER_STORAGE = storagePathFor('location-customer');
let customerLoginOk = false;

test.beforeAll(async ({ browser }) => {
  customerLoginOk = await loginAndSave(browser, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD, CUSTOMER_STORAGE);
});
test.afterAll(() => fs.rmSync(CUSTOMER_STORAGE, { force: true }));

function skipIfNoCustomer() {
  test.skip(!customerLoginOk, 'Needs a live API + seeded dev database (UAT_CUSTOMER). See file header.');
}

/* ------------------------------------------------------------- customer 2 */

const CUSTOMER_2_STORAGE = storagePathFor('location-customer-2');
let customer2LoginOk = false;

test.beforeAll(async ({ browser }) => {
  customer2LoginOk = await loginAndSave(browser, UAT_CUSTOMER_2_EMAIL, UAT_CUSTOMER_2_PASSWORD, CUSTOMER_2_STORAGE);
});
test.afterAll(() => fs.rmSync(CUSTOMER_2_STORAGE, { force: true }));

function skipIfNoIsolationFixtures() {
  test.skip(
    !customerLoginOk || !customer2LoginOk,
    'Needs BOTH UAT_CUSTOMER and the second customer from seed-uat-location-e2e.ts — see that script\'s own header. Not provisioned in CI.',
  );
}

/* ----------------------------------------------------------------- driver */

const DRIVER_STORAGE = storagePathFor('location-driver');
let driverLoginOk = false;

test.beforeAll(async ({ browser }) => {
  driverLoginOk = await loginAndSave(browser, UAT_DRIVER_EMAIL, UAT_DRIVER_PASSWORD, DRIVER_STORAGE);
});
test.afterAll(() => fs.rmSync(DRIVER_STORAGE, { force: true }));

function skipIfNoDriver() {
  test.skip(!driverLoginOk, 'Needs the UAT_DRIVER fixture (packages/database/prisma/seed-uat-logistics.ts — DELIVERY_DRIVER role approved, vehicle approved, isTest, ONLINE). No new driver seed was needed: this fixture already existed and is already eligible for a test marketplace delivery (same isTest-partitioned candidate pool driver.service.ts#eligibleDriversForDistrict enforces).');
}

/* --------------------------------------------------------------- super admin (assigns the delivery) */

const ADMIN_STORAGE = storagePathFor('location-admin');
let adminLoginOk = false;

test.beforeAll(async ({ browser }) => {
  adminLoginOk = await loginAndSave(browser, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, ADMIN_STORAGE);
});
test.afterAll(() => fs.rmSync(ADMIN_STORAGE, { force: true }));

/* ----------------------------------------------------- location-harness product */

/**
 * The location-harness product's vendor is deliberately isTest:true (the
 * same pattern every UAT fixture uses — keeps simulation data out of real
 * marketplace results). products.service.ts#publicList enforces this at the
 * SQL level (`AND vp."isTest" = FALSE`), so the PUBLIC `/marketplace/products`
 * search a real customer uses will NEVER return it — correct production
 * behaviour, not a bug this harness found. (First live run of this harness
 * used that endpoint and every product-dependent check skipped as a result —
 * caught by checking why, not by assuming the skips were fine.)
 *
 * The known-good fixture pattern (seed-uat-logistics.ts's dispatch fixture)
 * resolves the id directly via a call the vendor or an admin can make, not
 * public search. Resolving it once here, via the admin product-moderation
 * list (`products.read` permission, already covered by the super admin
 * fixture), is the equivalent for a spec that is not logged in as the vendor.
 */
let locationProductId: string | null = null;

test.beforeAll(async ({ browser }) => {
  if (!adminLoginOk) return;
  const { page, close } = await authedPage(browser, ADMIN_STORAGE);
  const res = await page.request.get('/api/admin/products?status=PUBLISHED');
  if (res.ok()) {
    const rows = (await res.json()) as Array<{ id: string; sku: string }>;
    locationProductId = rows.find((r) => r.sku === 'UATLOCATIONE2E-1')?.id ?? null;
  }
  await close();
});

function skipIfNoLocationProduct() {
  test.skip(
    !locationProductId,
    'Needs the location-harness product (seed-uat-location-e2e.ts, sku UATLOCATIONE2E-1) resolved via admin/products — public marketplace search excludes isTest vendors by design, so it is never found that way.',
  );
}

/* ----------------------------------------------------------------- helpers */

/** Unique per run so repeated local runs never collide on label uniqueness
 *  expectations or leave an ever-growing book behind unexamined. */
function uniqueLabel(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}`;
}

async function deleteAllSavedAddresses(page: Page): Promise<void> {
  const rows = await page.request.get('/api/addresses');
  if (!rows.ok()) return;
  const body = (await rows.json()) as Array<{ id: string }>;
  for (const row of body) {
    await page.request.delete(`/api/addresses/${row.id}`);
  }
}

/* ========================================================================
 * A — the map (checks #1, #2, #3)
 * ======================================================================== */

test.describe('[LOCAL ONLY, skips in CI] #1/#2/#3 — drop a pin, drag it, coordinates are saved correctly', () => {
  test('a pin dropped and confirmed in the address book round-trips through the real API, not just the UI\'s own display', async ({ browser }) => {
    skipIfNoCustomer();
    const { page, close } = await authedPage(browser, CUSTOMER_STORAGE);
    await deleteAllSavedAddresses(page);

    // Pick a product belonging to the location-harness vendor so checkout has
    // a real DELIVERY-eligible cart. Direct API call — see file header for
    // why this one call is not "the thing under test" and is still real.
    skipIfNoLocationProduct();
    await page.request.delete('/api/cart'); // real local runs accumulate cart state across repeated runs otherwise
    await page.request.post('/api/cart/items', { data: { productId: locationProductId!, quantity: 1 } });

    await page.goto('/checkout');
    await page.locator('label', { hasText: 'Delivery' }).filter({ has: page.locator('input[type=radio]') }).first().click();

    const methodSelect = page.locator('select').filter({ has: page.locator('option', { hasText: 'Drop a pin' }) }).first();
    await methodSelect.selectOption('PIN');

    // #1 — drop a pin by clicking the map.
    await clickMapToPlacePin(page);
    const firstPin = await readPinCoordinates(page);
    expect(firstPin.latitude).not.toBe(0);
    expect(firstPin.longitude).not.toBe(0);

    // #2 — drag it, and confirm the position actually changed. A real
    // mouse down/move/up sequence against Leaflet's own Draggable, not a
    // synthetic coordinate write — see support/leaflet-map.ts's header.
    await dragPinBy(page, 40, 40);
    const draggedPin = await readPinCoordinates(page);
    expect(draggedPin.latitude !== firstPin.latitude || draggedPin.longitude !== firstPin.longitude).toBe(true);

    // Fill the required contact/address fields and city/district (PIN mode
    // still asks for these — see AddressField.tsx's own comment on why: they
    // price and route the delivery, a pin does not imply them).
    await page.getByLabel('Full name').fill('MDF-535 Pin Customer');
    await page.getByLabel('Phone').fill('501-600-9001');
    await page.getByLabel(/city, town or village/i).fill('Belize City');
    await page.getByLabel(/district or island/i).selectOption('BELIZE');

    // #3 — save it, then verify the EXACT coordinate the API now holds
    // matches what the UI showed after the drag, not merely "some value".
    const label = uniqueLabel('MDF-535 Pin');
    await page.getByPlaceholder('Name it — Home, Office…').fill(label);
    await page.getByRole('button', { name: 'Save to my addresses' }).click();
    await expect(page.getByText(`Saved in your address book as “${label}”`)).toBeVisible();

    const savedRows = (await (await page.request.get('/api/addresses')).json()) as Array<{
      label: string; latitude: number | null; longitude: number | null;
    }>;
    const savedRow = savedRows.find((r) => r.label === label);
    await close();

    expect(savedRow, `expected a saved address labelled "${label}"`).toBeTruthy();
    expect(savedRow!.latitude).toBeCloseTo(draggedPin.latitude, 5);
    expect(savedRow!.longitude).toBeCloseTo(draggedPin.longitude, 5);
  });
});

/* ========================================================================
 * B — the address book: save/label, edit/delete, non-formal address (#4, #6, #12)
 * ======================================================================== */

test.describe('[LOCAL ONLY, skips in CI] #4/#6/#12 — saved address labelling, editing, deletion, and non-formal addresses', () => {
  test('#4 saves an address under a chosen label via /dashboard/addresses', async ({ browser }) => {
    skipIfNoCustomer();
    const { page, close } = await authedPage(browser, CUSTOMER_STORAGE);
    await deleteAllSavedAddresses(page);
    await page.goto('/dashboard/addresses');

    await page.getByRole('button', { name: 'Add an address' }).first().click();
    const label = uniqueLabel('Home');
    await page.locator('#ab-label').fill(label);
    await page.locator('#ab-name').fill('MDF-535 Book Customer');
    await page.locator('#ab-phone').fill('501-600-9002');
    await page.locator('#ab-line1').fill('12 Harbour View Street');
    await page.locator('#ab-city').fill('Belize City');
    await page.getByRole('button', { name: 'Save address' }).click();

    await expect(page.getByText(label)).toBeVisible();
    const rows = (await (await page.request.get('/api/addresses')).json()) as Array<{ label: string }>;
    await close();
    expect(rows.some((r) => r.label === label)).toBe(true);
  });

  test('#6 edits and then deletes a saved address, both through the real API', async ({ browser }) => {
    skipIfNoCustomer();
    const { page, close } = await authedPage(browser, CUSTOMER_STORAGE);
    await deleteAllSavedAddresses(page);
    const original = uniqueLabel('Work');
    const created = await page.request.post('/api/addresses', {
      data: {
        label: original, fullName: 'MDF-535 Edit Customer', phone: '501-600-9003',
        addressLine1: '1 Albert Street', city: 'Belize City', district: 'BELIZE', isDefault: true,
      },
    });
    const { id } = (await created.json()) as { id: string };

    await page.goto('/dashboard/addresses');
    await expect(page.getByText(original)).toBeVisible();
    await page.getByRole('button', { name: 'Edit' }).click();
    const renamed = uniqueLabel('Work Renamed');
    await page.locator('#ab-label').fill(renamed);
    await page.getByRole('button', { name: 'Save address' }).click();
    await expect(page.getByText(renamed)).toBeVisible();

    const afterEdit = (await (await page.request.get(`/api/addresses`)).json()) as Array<{ id: string; label: string }>;
    expect(afterEdit.find((r) => r.id === id)?.label).toBe(renamed);

    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(renamed)).not.toBeVisible();

    const afterDelete = (await (await page.request.get(`/api/addresses`)).json()) as Array<{ id: string }>;
    await close();
    expect(afterDelete.some((r) => r.id === id)).toBe(false);
  });

  test('#12 a location with no formal street address still saves successfully', async ({ browser }) => {
    skipIfNoCustomer();
    const { page, close } = await authedPage(browser, CUSTOMER_STORAGE);
    await deleteAllSavedAddresses(page);
    await page.goto('/dashboard/addresses');

    await page.getByRole('button', { name: 'Add an address' }).first().click();
    const label = uniqueLabel('No Formal Address');
    await page.locator('#ab-label').fill(label);
    await page.locator('#ab-name').fill('MDF-535 Landmark Customer');
    await page.locator('#ab-phone').fill('501-600-9004');
    // Deliberately not a formal street address — a landmark description,
    // which is the real, common case this check is about (root CLAUDE.md /
    // LocationPicker.tsx's own doc comment: "Belize street addresses are
    // frequently not findable").
    await page.locator('#ab-line1').fill('Behind the blue water tank, third gate past the church');
    await page.locator('#ab-city').fill('San Ignacio');
    await page.getByRole('button', { name: 'Save address' }).click();

    await expect(page.getByText(label)).toBeVisible();
    const rows = (await (await page.request.get('/api/addresses')).json()) as Array<{ label: string; addressLine1: string }>;
    await close();
    const row = rows.find((r) => r.label === label);
    expect(row).toBeTruthy();
    expect(row!.addressLine1).toContain('blue water tank');
  });
});

/* ========================================================================
 * C — survives logout/login (#5)
 * ======================================================================== */

test.describe('[LOCAL ONLY, skips in CI] #5 — a saved address is still there after logging out and back in', () => {
  test('the address book persists across a real logout and a fresh real login', async ({ browser }) => {
    skipIfNoCustomer();
    const label = uniqueLabel('Survives Logout');

    const setup = await authedPage(browser, CUSTOMER_STORAGE);
    await deleteAllSavedAddresses(setup.page);
    await setup.page.request.post('/api/addresses', {
      data: {
        label, fullName: 'MDF-535 Persist Customer', phone: '501-600-9005',
        addressLine1: '45 Freetown Road', city: 'Belize City', district: 'BELIZE', isDefault: true,
      },
    });
    await setup.close();

    // A FRESH context with no storage state at all — a real, cold login,
    // not a reused session that merely still happens to be signed in.
    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();
    const loggedIn = await tryLogin(freshPage, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD!);
    expect(loggedIn).toBe(true);
    await freshPage.goto('/dashboard/addresses');
    await expect(freshPage.getByText(label)).toBeVisible();
    await freshContext.close();
  });
});

/* ========================================================================
 * D — GPS denial does not block manual pin placement (#11)
 * ======================================================================== */

test.describe('[LOCAL ONLY, skips in CI] #11 — GPS permission denial does not prevent manual pin selection', () => {
  test('with geolocation denied, "Use my current location" fails gracefully and tapping the map still places a pin', async ({ browser }) => {
    skipIfNoCustomer();
    const context = await browser.newContext({ storageState: CUSTOMER_STORAGE });
    await denyGeolocationPermission(context); // documents the choice; a fresh context already denies by default
    const page = await context.newPage();

    skipIfNoLocationProduct();
    await page.request.delete('/api/cart');
    await page.request.post('/api/cart/items', { data: { productId: locationProductId!, quantity: 1 } });

    await page.goto('/checkout');
    await page.locator('label', { hasText: 'Delivery' }).filter({ has: page.locator('input[type=radio]') }).first().click();
    const methodSelect = page.locator('select').filter({ has: page.locator('option', { hasText: 'Drop a pin' }) }).first();
    await methodSelect.selectOption('PIN');

    await page.getByRole('button', { name: /use my current location/i }).click();
    // The REAL PERMISSION_DENIED branch (LocationPicker.tsx:472-474) —
    // Playwright's own default-denied geolocation produces this through the
    // browser's real permission model, not a JS mock of the error.
    await expect(page.getByText(/location permission was declined/i)).toBeVisible();

    // The check that matters: denial must not disable the manual path.
    await clickMapToPlacePin(page);
    const pin = await readPinCoordinates(page);
    expect(pin.latitude).not.toBe(0);

    await context.close();
  });
});

/* ========================================================================
 * E — saved address selected at checkout reaches the real order (#7, #8)
 * ======================================================================== */

test.describe('[LOCAL ONLY, skips in CI] #7/#8 — a saved address selected at checkout reaches the real order record', () => {
  test('choosing a saved address at checkout places an order whose delivery address matches it exactly', async ({ browser }) => {
    skipIfNoCustomer();
    const { page, close } = await authedPage(browser, CUSTOMER_STORAGE);
    await deleteAllSavedAddresses(page);

    const label = uniqueLabel('Checkout Saved');
    const created = await page.request.post('/api/addresses', {
      data: {
        label, fullName: 'MDF-535 Checkout Customer', phone: '501-600-9006',
        addressLine1: '7 Marine Parade', city: 'Belize City', district: 'BELIZE',
        latitude: 17.4995, longitude: -88.1976, isDefault: true,
      },
    });
    const savedAddress = (await created.json()) as { id: string; addressLine1: string };

    skipIfNoLocationProduct();
    await page.request.delete('/api/cart');
    await page.request.post('/api/cart/items', { data: { productId: locationProductId!, quantity: 1 } });

    await page.goto('/checkout');
    await page.locator('label', { hasText: 'Delivery' }).filter({ has: page.locator('input[type=radio]') }).first().click();
    const methodSelect = page.locator('select').filter({ has: page.locator('option', { hasText: 'Use a saved address' }) }).first();
    await methodSelect.selectOption('SAVED');

    // #7 — select the saved address from the dropdown.
    const savedSelect = page.locator('select').filter({ has: page.locator('option', { hasText: label }) }).first();
    await savedSelect.selectOption(savedAddress.id);
    await expect(page.locator('option', { hasText: label })).toBeAttached();

    const placeOrderButton = page.getByRole('button', { name: /place order|pay|complete/i }).first();
    const canSubmit = await placeOrderButton.isVisible().catch(() => false);
    test.skip(!canSubmit, 'Checkout\'s place-order control was not reachable in this environment (wallet balance or cart state) — see the harness report for the known gap this leaves until a dedicated wallet-funded fixture is added.');
    await placeOrderButton.click();

    // #8 — the selected location reaches the real order record.
    await page.waitForURL(/\/orders\//, { timeout: 15_000 });
    const orderId = page.url().split('/orders/')[1]?.split(/[/?]/)[0];
    const order = await (await page.request.get(`/api/orders/${orderId}`)).json();
    await close();

    const deliveryAddress = JSON.stringify(order);
    expect(deliveryAddress).toContain(savedAddress.addressLine1);
  });
});

/* ========================================================================
 * F — cross-customer isolation (#13)
 * ======================================================================== */

test.describe('[LOCAL ONLY, skips in CI] #13 — a user cannot access or modify another customer\'s saved addresses', () => {
  test('customer 2 cannot read, edit or delete an address saved by customer 1, through the real API behind the real UI', async ({ browser }) => {
    skipIfNoIsolationFixtures();
    const owner = await authedPage(browser, CUSTOMER_STORAGE);
    await deleteAllSavedAddresses(owner.page);
    const label = uniqueLabel('Customer1Only');
    const created = await owner.page.request.post('/api/addresses', {
      data: {
        label, fullName: 'MDF-535 Owner Customer', phone: '501-600-9007',
        addressLine1: '99 Private Lane', city: 'Belize City', district: 'BELIZE', isDefault: true,
      },
    });
    const { id } = (await created.json()) as { id: string };
    await owner.close();

    const other = await authedPage(browser, CUSTOMER_2_STORAGE);

    // Not visible in the OTHER customer's own list.
    const otherList = (await (await other.page.request.get('/api/addresses')).json()) as Array<{ id: string }>;
    expect(otherList.some((r) => r.id === id)).toBe(false);

    // Direct ID access refused, not silently allowed, on every mutating verb.
    const getAttempt = await other.page.request.get(`/api/addresses/${id}`);
    const patchAttempt = await other.page.request.patch(`/api/addresses/${id}`, { data: { label: 'Hijacked' } });
    const deleteAttempt = await other.page.request.delete(`/api/addresses/${id}`);
    await other.close();

    expect([403, 404]).toContain(getAttempt.status());
    expect([403, 404]).toContain(patchAttempt.status());
    expect([403, 404]).toContain(deleteAttempt.status());

    // The original row is provably untouched — the refusal was not a
    // "pretend success, write nothing" shape either.
    const final = await authedPage(browser, CUSTOMER_STORAGE);
    const row = (await (await final.page.request.get('/api/addresses')).json()) as Array<{ id: string; label: string }>;
    await final.close();
    expect(row.find((r) => r.id === id)?.label).toBe(label);
  });
});

/* ========================================================================
 * G — #9 driver views pickup/delivery location, BOTH halves of the gate
 * ======================================================================== */

test.describe('[LOCAL ONLY, skips in CI] #9 — a driver views the delivery location through their authorized interface, both before and after accepting', () => {
  test('BEFORE accepting: area only, no exact pin, no name/phone/street. AFTER accepting: the full address and the exact pin', async ({ browser }) => {
    // This test drives a real checkout order, a real admin assignment, and a
    // real driver accept in sequence — three real round trips through a dev
    // stack that is genuinely slower than production. Default 30s was too
    // tight; observed consistently, not a one-off.
    test.setTimeout(60_000);
    skipIfNoCustomer();
    skipIfNoDriver();
    test.skip(!adminLoginOk, 'Needs the super admin fixture to assign the delivery (deliveries.assign permission).');

    // 1. A fresh real order, PINNED delivery address, via the real checkout —
    // same product/vendor as describe E, built fresh here rather than reused
    // so this test fully owns the PENDING_ASSIGNMENT -> ASSIGNED -> accepted
    // transition (a seeded, already-accepted order could prove this only once).
    const customer = await authedPage(browser, CUSTOMER_STORAGE);
    skipIfNoLocationProduct();
    await customer.page.request.delete('/api/cart');
    await customer.page.request.post('/api/cart/items', { data: { productId: locationProductId!, quantity: 1 } });

    await customer.page.goto('/checkout');
    await customer.page.locator('label', { hasText: 'Delivery' }).filter({ has: customer.page.locator('input[type=radio]') }).first().click();
    const methodSelect = customer.page.locator('select').filter({ has: customer.page.locator('option', { hasText: 'Drop a pin' }) }).first();
    await methodSelect.selectOption('PIN');
    await clickMapToPlacePin(customer.page); // real pin first — exact value overwritten next
    await customer.page.getByLabel('Full name').fill('MDF-535 Driver-Gate Customer');
    await customer.page.getByLabel('Phone').fill('501-600-9008');
    await customer.page.getByLabel(/city, town or village/i).fill('Belize City');
    await customer.page.getByLabel(/district or island/i).selectOption('BELIZE');
    const placeOrderButton = customer.page.getByRole('button', { name: /place order|pay|complete/i }).first();
    const canSubmit = await placeOrderButton.isVisible().catch(() => false);
    test.skip(!canSubmit, 'Checkout\'s place-order control was not reachable in this environment.');
    await placeOrderButton.click();
    // 15s was too tight against this local dev stack (unoptimized Next dev
    // server + Nest watch mode) for a real order with a freshly-geocoded pin
    // address — observed twice, consistently, not a one-off: see the harness
    // report. 30s matches the test's own outer timeout headroom.
    await customer.page.waitForURL(/\/orders\//, { timeout: 30_000 });
    const orderId = customer.page.url().split('/orders/')[1]?.split(/[/?]/)[0];
    const orderDetail = (await (await customer.page.request.get(`/api/orders/${orderId}`)).json()) as {
      vendorOrders: Array<{ delivery: { id: string } | null }>;
    };
    const deliveryId = orderDetail.vendorOrders.find((vo) => vo.delivery)?.delivery?.id;
    await customer.close();
    test.skip(!deliveryId, 'Checkout did not produce an OrderDelivery row — cannot test the driver gate without one.');

    // 2. Admin assigns it to the UAT driver (the real admin/deliveries/:id/assign
    // flow — not a direct DB write), discovering driverProfileId/vehicleId the
    // same way the admin console does: the eligible-drivers endpoint.
    const admin = await authedPage(browser, ADMIN_STORAGE);
    const eligible = (await (await admin.page.request.get(`/api/admin/deliveries/${deliveryId}/eligible-drivers`)).json()) as Array<{
      driverProfileId: string; name: string; vehicles: Array<{ id: string }>;
    }>;
    const uatDriverCandidate = eligible.find((d) => d.name.toLowerCase().includes('driver') || d.vehicles.length > 0);
    test.skip(!uatDriverCandidate, `UAT driver was not in the eligible pool for this delivery (got: ${JSON.stringify(eligible)}) — isTest/district/service-area mismatch, not a harness bug to paper over.`);
    const assignResponse = await admin.page.request.post(`/api/admin/deliveries/${deliveryId}/assign`, {
      data: { driverProfileId: uatDriverCandidate!.driverProfileId, vehicleId: uatDriverCandidate!.vehicles[0]!.id },
    });
    const assignOk = assignResponse.ok();
    const assignBody = assignOk ? '' : await assignResponse.text();
    await admin.close();
    expect(assignOk, `assign failed: ${assignBody}`).toBe(true);

    // 3. BEFORE acceptance: the driver's own page shows area only.
    const driver = await authedPage(browser, DRIVER_STORAGE);
    await driver.page.goto(`/dashboard/driver/jobs/${deliveryId}`);
    await expect(driver.page.getByText(/appear once you accept|appear here once you accept/i)).toBeVisible();
    const preAccept = await driver.page.request.get(`/api/driver/jobs/${deliveryId}`);
    const preAcceptBody = (await preAccept.json()) as {
      addressUnlocked: boolean; pinnedLocation: unknown; navigationUrl: string | null;
      deliveryAddress: { fullName: string | null; phone: string | null; addressLine1: string | null; city: string };
    };
    expect(preAcceptBody.addressUnlocked).toBe(false);
    expect(preAcceptBody.pinnedLocation).toBeNull();
    expect(preAcceptBody.navigationUrl).toBeNull();
    expect(preAcceptBody.deliveryAddress.fullName).toBeNull();
    expect(preAcceptBody.deliveryAddress.phone).toBeNull();
    expect(preAcceptBody.deliveryAddress.addressLine1).toBeNull();
    expect(preAcceptBody.deliveryAddress.city).toBe('Belize City'); // the area IS shown — this is the privacy-correct half, not an over-redaction bug

    // 4. Accept, through the real endpoint — then the SAME page shows the exact pin.
    const acceptResponse = await driver.page.request.post(`/api/driver/jobs/${deliveryId}/accept`);
    expect(acceptResponse.ok(), `accept failed: ${await acceptResponse.text()}`).toBe(true);
    await driver.page.goto(`/dashboard/driver/jobs/${deliveryId}`);
    await expect(driver.page.getByText(/customer pinned an exact location/i)).toBeVisible();
    const postAccept = await driver.page.request.get(`/api/driver/jobs/${deliveryId}`);
    const postAcceptBody = (await postAccept.json()) as {
      addressUnlocked: boolean; pinnedLocation: { latitude: number; longitude: number } | null; navigationUrl: string | null;
      deliveryAddress: { fullName: string | null; phone: string | null; addressLine1: string | null };
    };
    await driver.close();
    expect(postAcceptBody.addressUnlocked).toBe(true);
    expect(postAcceptBody.pinnedLocation).not.toBeNull();
    expect(postAcceptBody.navigationUrl).not.toBeNull();
    expect(postAcceptBody.deliveryAddress.fullName).toBe('MDF-535 Driver-Gate Customer');
    expect(postAcceptBody.deliveryAddress.phone).toBe('501-600-9008');
    // addressLine1 null here is CORRECT, not a gap: this order was placed via
    // checkout's PIN mode, which never collects a street line — the pin IS
    // the address, by the same design `isLocatable()` encodes everywhere else
    // (packages/validation/src/marketplace.ts). Asserting it non-null was
    // this harness's own mistake on an earlier pass, caught by actually
    // running it rather than assumed.
  });
});

/* ========================================================================
 * H — TOUCH pin-drag (Oscar's gap-table finding; forcing function for the
 *     owner's desktop/tablet/mobile requirement)
 * ======================================================================== */

test.describe('[LOCAL ONLY, skips in CI] TOUCH pin-drag — the one gesture Oscar flagged as repo-untested', () => {
  test('a touch-emulated context can drop and drag the pin via real touchstart/touchmove/touchend, not just mouse events', async ({ browser }) => {
    skipIfNoCustomer();
    // hasTouch:true is load-bearing, not cosmetic — see touchDragPinBy's own
    // header comment: without it, L.Browser.touch is false and Leaflet never
    // attaches the touch listeners this test is trying to exercise, which
    // would make this test pass for the wrong reason (mouse fallback) rather
    // than proving anything about touch.
    // /dashboard/addresses has no map yet (Oscar is adding one — see the
    // file header's "about to change" note); until then, exercise the touch
    // drag against checkout's PIN mode map, the one real Leaflet instance
    // reachable today.
    const checkoutContext = await browser.newContext({ storageState: CUSTOMER_STORAGE, hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
    const checkoutPage = await checkoutContext.newPage();
    skipIfNoLocationProduct();
    await checkoutPage.request.delete('/api/cart');
    await checkoutPage.request.post('/api/cart/items', { data: { productId: locationProductId!, quantity: 1 } });
    await checkoutPage.goto('/checkout');
    await checkoutPage.locator('label', { hasText: 'Delivery' }).filter({ has: checkoutPage.locator('input[type=radio]') }).first().click();
    const methodSelect = checkoutPage.locator('select').filter({ has: checkoutPage.locator('option', { hasText: 'Drop a pin' }) }).first();
    await methodSelect.selectOption('PIN');

    // Drop the initial pin via the already-proven click path, NOT
    // touchscreen.tap(): a real finding from this harness's first live run —
    // Playwright/Chromium's touch emulation does not synthesize the 'click'
    // event LocationPicker's own tap-to-place listener relies on (confirmed
    // via the UI's own "No pin yet" status staying put after a real tap, not
    // a guess). A physical phone's browser synthesizes that click after a
    // tap; whether Chromium's CDP touch emulation ever does is a separate,
    // narrower question than the one this test exists to answer. Oscar's own
    // gap-table finding was specifically about DRAG being repo-untested, not
    // drop — so the drag below is what must be driven by real touch events;
    // establishing the starting pin by the mouse path does not dilute that.
    await clickMapToPlacePin(checkoutPage);
    const beforeDrag = await readPinCoordinates(checkoutPage);

    await touchDragPinBy(checkoutPage, 50, 50);
    const afterDrag = await readPinCoordinates(checkoutPage);
    await checkoutContext.close();

    expect(
      afterDrag.latitude !== beforeDrag.latitude || afterDrag.longitude !== beforeDrag.longitude,
      'a real touchstart/touchmove/touchend sequence against the marker should move the pin, same as the mouse path already proven in describe A',
    ).toBe(true);
  });
});

/* ========================================================================
 * I — FullScreenMapModal confirm/cancel semantics (owner check #2, refined —
 *     "confirm" became a distinct action once Oscar shipped the staged-draft
 *     modal, feat/location-web-map-picker commit eebfb5c2: the full-screen
 *     map now stages a draft reseeded from the live value on open; "Use this
 *     location" commits it via onChange, closing any other way (✕, Escape)
 *     discards the draft untouched. Written BEFORE that shipped (was marked
 *     EXPECTED TO FAIL); now genuinely passes against the real component —
 *     left unchanged otherwise, since it already asserted the right thing.
 * ======================================================================== */

test.describe('[LOCAL ONLY, skips in CI] #2 refined — cancel reverts to the opening value, confirm keeps the moved pin', () => {
  test('dragging the pin inside the full-screen modal then Cancel restores the value the modal opened with', async ({ browser }) => {
    skipIfNoCustomer();
    const context = await browser.newContext({ storageState: CUSTOMER_STORAGE });
    const page = await context.newPage();
    skipIfNoLocationProduct();
    await page.request.delete('/api/cart');
    await page.request.post('/api/cart/items', { data: { productId: locationProductId!, quantity: 1 } });
    await page.goto('/checkout');
    await page.locator('label', { hasText: 'Delivery' }).filter({ has: page.locator('input[type=radio]') }).first().click();
    const methodSelect = page.locator('select').filter({ has: page.locator('option', { hasText: 'Drop a pin' }) }).first();
    await methodSelect.selectOption('PIN');
    await clickMapToPlacePin(page);
    const openingValue = await readPinCoordinates(page);

    await page.getByRole('button', { name: /full screen/i }).click();
    await dragPinBy(page, 60, 60);
    // Today there is no distinct Cancel — closing the modal via ✕/Escape
    // just closes it; the pin (already committed immediately on drag,
    // per AddressField's own immediate-onChange contract) stays moved. The
    // NEW semantics this check pins: Cancel must REVERT to openingValue.
    await page.keyboard.press('Escape');
    const afterCancel = await readPinCoordinates(page);
    await context.close();

    expect(afterCancel.latitude).toBeCloseTo(openingValue.latitude, 5);
    expect(afterCancel.longitude).toBeCloseTo(openingValue.longitude, 5);
  });
});

/* ========================================================================
 * J — search box must not breach Nominatim rate policy (Oscar's gap-table
 *     finding #2). FORMERLY a correct skip, now a real check: god's own
 *     independent read of every live <LocationPicker> caller found the
 *     search box reachable on NO real page (every caller passed `address`,
 *     which used to gate it off) — owner behaviour 6 ("search for an
 *     address, business or landmark") classified MISSING OR UNUSABLE
 *     INTERFACE FUNCTIONALITY and dispatched to Oscar as a blocking fix.
 *     He landed it at feat/location-web-map-picker 6a95d9aa: the search box
 *     now renders on every picker, standalone or not (LocationPicker.tsx's
 *     `searchBox` is no longer gated on `standalone`). This test's own
 *     `hasSearchBox` guard is left in place but turned from `test.skip` into
 *     a hard `expect` — a correct skip was the point once; now that the
 *     gap is closed, a reappearing skip here would itself be the regression,
 *     not a reason to quietly pass.
 * ======================================================================== */

test.describe('[LOCAL ONLY, skips in CI] typing a search query never sends one geocode request per keystroke', () => {
  test('a rapid multi-character query produces far fewer real /geocode requests than characters typed', async ({ browser }) => {
    skipIfNoCustomer();
    const context = await browser.newContext({ storageState: CUSTOMER_STORAGE });
    const page = await context.newPage();
    skipIfNoLocationProduct();
    await page.request.delete('/api/cart');
    await page.request.post('/api/cart/items', { data: { productId: locationProductId!, quantity: 1 } });
    await page.goto('/checkout');
    await page.locator('label', { hasText: 'Delivery' }).filter({ has: page.locator('input[type=radio]') }).first().click();
    const methodSelect = page.locator('select').filter({ has: page.locator('option', { hasText: 'Drop a pin' }) }).first();
    await methodSelect.selectOption('PIN');

    const searchInput = mapContainer(page).locator('..').getByRole('searchbox').or(page.getByPlaceholder(/search for a place|search address/i));
    const hasSearchBox = await searchInput.first().isVisible().catch(() => false);
    expect(hasSearchBox, 'LocationPicker\'s search box should render on every picker as of feat/location-web-map-picker 6a95d9aa (MDF-543) — its absence here is the owner-behaviour-6 regression, not an environment gap to skip past.').toBe(true);

    // REAL network observation, not a mock — passively counts actual
    // requests the browser makes while the real UI runs, against the
    // Nominatim-backed /api/geocode endpoint (apps/api/src/geocoding/).
    let geocodeRequests = 0;
    page.on('request', (req) => {
      if (req.url().includes('/api/geocode')) geocodeRequests += 1;
    });
    const query = 'San Ignacio Belize';
    await searchInput.first().pressSequentially(query, { delay: 30 });
    await page.waitForTimeout(1500); // settle any trailing debounce before counting
    await context.close();

    expect(
      geocodeRequests,
      `typed ${query.length} characters and observed ${geocodeRequests} /geocode requests — one per keystroke is exactly the Nominatim rate-policy breach god ruled out`,
    ).toBeLessThan(query.length);
  });
});

/* ========================================================================
 * K — the dropdown is wired to the SAME fallback function as the list row
 *     (god's follow-up, MDF-535): Oscar extracted savedAddressLine()
 *     (apps/web/lib/address.ts) so the address-book list row and
 *     AddressField's saved-address dropdown share one answer for "what to
 *     show when a saved address has no street" instead of growing a second,
 *     silently different one. He unit-tested the function directly (five
 *     cases) but deliberately did NOT add a full AddressField mount test,
 *     since that component mounts Leaflet through next/dynamic and the
 *     existing checkout tests already document that path as slow and
 *     flaky — a reasoning god accepted. That leaves the WIRING untested: a
 *     unit test proves the function is correct in isolation, not that the
 *     dropdown actually calls it rather than its own copy-pasted, possibly
 *     stale version of the same logic. Cheap to check here because this
 *     harness already pays Leaflet's mount cost for every other check.
 * ======================================================================== */

test.describe('[LOCAL ONLY, skips in CI] saved-address dropdown is wired to the shared savedAddressLine fallback, not a second copy', () => {
  test('a pin-only saved address never reads as a bare leading comma in the checkout dropdown', async ({ browser }) => {
    skipIfNoCustomer();
    const { page, close } = await authedPage(browser, CUSTOMER_STORAGE);
    await deleteAllSavedAddresses(page);

    // Deliberately NO addressLine1 and NO landmark — only a pin. Before
    // Oscar's extraction, AddressField's dropdown rendered
    // `{s.addressLine1}, {s.city}` unguarded, which on exactly this row
    // would read "Label — , Belize City" (god's own "bare leading comma"
    // framing): a dash, a comma with nothing between it and the dash, and
    // no indication a pin exists at all.
    const label = uniqueLabel('Pin Only Wiring');
    const created = await page.request.post('/api/addresses', {
      data: {
        label, fullName: 'MDF-535 Wiring Customer', phone: '501-600-9009',
        city: 'Belize City', district: 'BELIZE',
        latitude: 17.4995, longitude: -88.1976, isDefault: true,
      },
    });
    expect(created.ok(), `creating a pin-only saved address failed: ${await created.text()}`).toBe(true);

    skipIfNoLocationProduct();
    await page.request.delete('/api/cart');
    await page.request.post('/api/cart/items', { data: { productId: locationProductId!, quantity: 1 } });

    await page.goto('/checkout');
    await page.locator('label', { hasText: 'Delivery' }).filter({ has: page.locator('input[type=radio]') }).first().click();
    const methodSelect = page.locator('select').filter({ has: page.locator('option', { hasText: 'Use a saved address' }) }).first();
    await methodSelect.selectOption('SAVED');

    const option = page.locator('option', { hasText: label });
    await expect(option).toBeAttached();
    const optionText = (await option.textContent()) ?? '';
    await close();

    // The exact defect shape: a comma with nothing (or only whitespace)
    // between it and the preceding dash.
    expect(optionText, `dropdown option text was "${optionText}"`).not.toMatch(/—\s*,/);
    // The positive case: savedAddressLine()'s real fallback for a pin with
    // no street and no landmark, proving the dropdown calls the SAME
    // function the list row does, not a second copy that happens to also
    // avoid the comma but says something different (or nothing).
    expect(optionText).toContain('Pinned location');
  });
});

/* ========================================================================
 * L — owner behaviours 6 and 7 as a PAIR (god's follow-up, MDF-535): a
 *     searched result is a STARTING point, not a final answer. #6 (find a
 *     business or landmark with no street address) is only half proven by
 *     the fact that a search box now exists — #7 is the half that proves the
 *     customer is still free to correct it. Runs against the real, live
 *     Nominatim endpoint (apps/api/src/geocoding/) exactly like every other
 *     geocode call in this file — no mock, per the file header. The landmark
 *     chosen is Belize's main international airport specifically because it
 *     is about as reliably mapped as anything in OpenStreetMap's genuinely
 *     patchy Belize coverage; a miss here would say more about this harness's
 *     test-data choice than about the feature, which is why an obscure local
 *     business was deliberately NOT used.
 * ======================================================================== */

test.describe('[LOCAL ONLY, skips in CI] #6/#7 — searching a landmark drops a provisional pin, and dragging it afterwards is what actually gets saved', () => {
  test('search finds the landmark, drag moves the pin, and the SAVED coordinate is the dragged one, not the searched one', async ({ browser }) => {
    skipIfNoCustomer();
    const { page, close } = await authedPage(browser, CUSTOMER_STORAGE);
    await deleteAllSavedAddresses(page);
    skipIfNoLocationProduct();
    await page.request.delete('/api/cart');
    await page.request.post('/api/cart/items', { data: { productId: locationProductId!, quantity: 1 } });

    await page.goto('/checkout');
    await page.locator('label', { hasText: 'Delivery' }).filter({ has: page.locator('input[type=radio]') }).first().click();
    const methodSelect = page.locator('select').filter({ has: page.locator('option', { hasText: 'Drop a pin' }) }).first();
    await methodSelect.selectOption('PIN');

    // #6 — find a place by name that has no street address to type into the
    // form in the first place. The search box's own query, never the typed
    // form address ("Show my address" is a separate control — see describe M).
    await waitForMapReady(page);
    await page.getByLabel('Search for an address, business or landmark on the map').fill('Philip Goldson International Airport');
    await page.getByRole('button', { name: 'Search for this on the map' }).click();
    await expect(page.getByText(/is this the right place|couldn.t find that on the map/i)).toBeVisible({ timeout: 15_000 });
    test.skip(
      await page.getByText(/couldn.t find that on the map/i).isVisible().catch(() => false),
      'Live OpenStreetMap search genuinely missed a well-known landmark this run — honest coverage gap the component itself expects (see GeocodingService\'s own doc comment), not a harness or product bug to force past.',
    );
    const searchedPin = await readPinCoordinates(page);
    expect(searchedPin.latitude).not.toBe(0);

    // #7 — a search result is provisional. Dragging it afterwards must win.
    await dragPinBy(page, 50, 50);
    const draggedPin = await readPinCoordinates(page);
    expect(
      draggedPin.latitude !== searchedPin.latitude || draggedPin.longitude !== searchedPin.longitude,
      'dragging after a search should move the pin, same as dragging after a click already proven in describe A',
    ).toBe(true);

    await page.getByLabel('Full name').fill('MDF-535 Search Customer');
    await page.getByLabel('Phone').fill('501-600-9011');
    await page.getByLabel(/city, town or village/i).fill('Ladyville');
    await page.getByLabel(/district or island/i).selectOption('BELIZE');
    const label = uniqueLabel('MDF-535 Searched');
    await page.getByPlaceholder('Name it — Home, Office…').fill(label);
    await page.getByRole('button', { name: 'Save to my addresses' }).click();
    await expect(page.getByText(`Saved in your address book as “${label}”`)).toBeVisible();

    const savedRows = (await (await page.request.get('/api/addresses')).json()) as Array<{
      label: string; latitude: number | null; longitude: number | null;
    }>;
    const savedRow = savedRows.find((r) => r.label === label);
    await close();

    expect(savedRow, `expected a saved address labelled "${label}"`).toBeTruthy();
    // The assertion that actually proves #7: the saved coordinate is the
    // DRAGGED position, not the one the search dropped.
    expect(savedRow!.latitude).toBeCloseTo(draggedPin.latitude, 5);
    expect(savedRow!.longitude).toBeCloseTo(draggedPin.longitude, 5);
    expect(
      Math.abs(savedRow!.latitude! - searchedPin.latitude) > 1e-5 || Math.abs(savedRow!.longitude! - searchedPin.longitude) > 1e-5,
      'the saved address should NOT still be the raw searched position — that would mean the drag never overrode it',
    ).toBe(true);
  });
});

/* ========================================================================
 * M — "the one thing I specifically want exercised in a browser" (god's
 *     follow-up, MDF-535): both "Show my address" and the search box are now
 *     on screen at once in every real AddressField render. Oscar split the
 *     single findAddress() into a shared geocode() plus two thin callers —
 *     findAddress() bound to the typed form address, searchPlace() bound to
 *     the search box's own query — and unit-tested the split. Proving the
 *     two controls do not cross in a REAL rendered page, where both share one
 *     component instance and one `lookup` state, is exactly the class of bug
 *     a unit test of the split function cannot see: a unit test calls each
 *     function directly with the right argument by construction; only a real
 *     page proves the onClick handlers are wired to the right one.
 * ======================================================================== */

test.describe('[LOCAL ONLY, skips in CI] "Show my address" and the search box each geocode only their own text, never the other\'s', () => {
  test('with both controls on screen, each one\'s real /geocode request carries only its own query text', async ({ browser }) => {
    skipIfNoCustomer();
    const { page, close } = await authedPage(browser, CUSTOMER_STORAGE);
    skipIfNoLocationProduct();
    await page.request.delete('/api/cart');
    await page.request.post('/api/cart/items', { data: { productId: locationProductId!, quantity: 1 } });

    await page.goto('/checkout');
    await page.locator('label', { hasText: 'Delivery' }).filter({ has: page.locator('input[type=radio]') }).first().click();
    const methodSelect = page.locator('select').filter({ has: page.locator('option', { hasText: 'Drop a pin' }) }).first();
    await methodSelect.selectOption('PIN');
    await waitForMapReady(page);

    // PIN mode has no street-line field, so AddressField's `address` prop
    // (what "Show my address" geocodes) is driven by the city field alone —
    // real, not a harness fabrication (AddressField.tsx:
    // `[addressLine1, city].filter(Boolean).join(', ')`).
    const addressQuery = 'Dangriga';
    const searchQuery = 'Mayan ruins Xunantunich';
    await page.getByLabel(/city, town or village/i).fill(addressQuery);

    const searchReq = page.waitForResponse(
      (r) => r.url().includes('/api/geocode') && r.url().includes(encodeURIComponent(searchQuery)),
      { timeout: 15_000 },
    );
    await page.getByLabel('Search for an address, business or landmark on the map').fill(searchQuery);
    await page.getByRole('button', { name: 'Search for this on the map' }).click();
    const searchReqUrl = (await searchReq).url();

    const addressReq = page.waitForResponse(
      (r) => r.url().includes('/api/geocode') && r.url().includes(encodeURIComponent(addressQuery)),
      { timeout: 15_000 },
    );
    await page.getByRole('button', { name: 'Show the address you typed on the map' }).click();
    const addressReqUrl = (await addressReq).url();

    await close();

    // The cross-contamination god named, made concrete: neither control's
    // real network request carries the OTHER control's text. If `searchPlace`
    // and `findAddress` had been swapped, or both wired to the same closed-
    // over `address`, one of these would fail.
    expect(searchReqUrl, `search box request was: ${searchReqUrl}`).not.toContain(encodeURIComponent(addressQuery));
    expect(addressReqUrl, `"Show my address" request was: ${addressReqUrl}`).not.toContain(encodeURIComponent(searchQuery));
  });
});

/* ---------------------------------------------------- MDF-550: passenger pins */

/**
 * MDF-550, owner directive 2026-11-05: the twelve named checks for a
 * passenger's pickup/destination pins, plus the reversal check god added as
 * first-class ("the single requirement most likely to pass a component test
 * and fail in a real page, because a swap is invisible unless you assert
 * which coordinate landed in which column"). Runs against this harness's own
 * local combined tree -- Pam's `feat/passenger-api-booking-pins` (897435a9)
 * and Oscar's `feat/passenger-location-web` (2c38d5f0) merged on top of this
 * branch, clean by construction (pairwise-disjoint changed-file sets, shared
 * merge-base 46d12c8a — see this harness's report to god).
 *
 * FIXTURE SETUP (route, trip, fleet affiliation, vehicle, assignment) is a
 * real, un-mocked round trip through the live API via `page.request` --
 * same discipline as every other fixture in this file. It is deliberately
 * NOT one of the twelve checks (those are the RIDER-facing flow and its
 * downstream driver view); driving it directly rather than through operator
 * UI that has nothing to do with location matches this file's own existing
 * exception for adding a product to cart. Reuses the already-seeded,
 * already-approved UAT_PASSENGER_PROVIDER / UAT_PASSENGER_DRIVER accounts
 * (seed-uat-roles.ts) rather than registering throwaway ones.
 *
 * ASYMMETRIC locations for the reversal check, god's own instruction: Belize
 * City pickup, Punta Gorda dropoff -- the same two towns Pam's own
 * integration test (apps/api/test/passenger-booking.integration.spec.ts)
 * uses for exactly this reason, not invented here.
 *
 * #11 (GPS denial does not block manual placement) needs no dedicated test:
 * this describe's rider context never calls `context.grantPermissions
 * (['geolocation'])` anywhere, so it is already running in the denied state
 * throughout -- the same reasoning this file's own `denyGeolocationPermission`
 * no-op documents ("a fresh context already starts in exactly this state").
 * Every successful manual pin placement below IS #11, not a separate case.
 *
 * ADMIN visibility (#9 of god's list to me, the owner's own list's final
 * check) is NOT in this file -- apps/admin is a separate app, separate
 * Playwright config, separate dev-server lifecycle. See
 * apps/admin/e2e/passenger-booking-pin-visibility.local-only.spec.ts.
 */
const PAX_PROVIDER_STORAGE = storagePathFor('pax-provider');
const PAX_DRIVER_STORAGE = storagePathFor('pax-driver');
const PAX_ADMIN_SETUP_STORAGE = storagePathFor('pax-admin-setup');
let paxFixtureOk = false;
let paxTripId = '';
let paxTripNoPinId = '';
const PAX_ROUTE_NAME = `MDF-550 UAT run ${Date.now()}`;
const PAX_ROUTE_NAME_NOPIN = `MDF-550 UAT run (no pin) ${Date.now()}`;

function skipIfNoPaxFixture() {
  test.skip(!paxFixtureOk, 'Needs a live API + seeded dev database (UAT_PASSENGER_PROVIDER/UAT_PASSENGER_DRIVER/SUPER_ADMIN). See file header.');
}

test.beforeAll(async ({ browser }) => {
  // Dev-server first-compile + three sequential UI logins + ~8 API round
  // trips comfortably exceeds the file's default 30s per-test timeout
  // (playwright.config.ts), which a bare hook inherits.
  test.setTimeout(90_000);
  if (!customerLoginOk) return;
  const providerOk = await loginAndSave(browser, UAT_PASSENGER_PROVIDER_EMAIL, UAT_FIXTURE_PASSWORD, PAX_PROVIDER_STORAGE);
  const driverOk = await loginAndSave(browser, UAT_PASSENGER_DRIVER_EMAIL, UAT_FIXTURE_PASSWORD, PAX_DRIVER_STORAGE);
  const adminOk = await loginAndSave(browser, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD ?? '', PAX_ADMIN_SETUP_STORAGE);
  if (!providerOk || !driverOk || !adminOk) return;

  const provider = await authedPage(browser, PAX_PROVIDER_STORAGE);
  const driver = await authedPage(browser, PAX_DRIVER_STORAGE);
  const admin = await authedPage(browser, PAX_ADMIN_SETUP_STORAGE);
  try {
    const driverProfileRes = await driver.page.request.get('/api/passenger/driver/profile');
    if (!driverProfileRes.ok()) return;
    const driverProfileId = (await driverProfileRes.json()).id as string;

    const routeRes = await provider.page.request.post('/api/passenger/provider/routes', {
      data: {
        name: PAX_ROUTE_NAME,
        originDistrict: 'BELIZE',
        originCity: 'Belize City',
        destinationDistrict: 'TOLEDO',
        destinationCity: 'Punta Gorda',
        scheduleNote: 'MDF-550 harness fixture',
        baseFareMinor: 2500,
      },
    });
    if (!routeRes.ok()) return;
    const route = await routeRes.json();

    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const tripRes = await provider.page.request.post('/api/passenger/provider/trips', {
      data: { routeId: route.id, scheduledDepartureAt: tomorrow },
    });
    if (!tripRes.ok()) return;
    paxTripId = (await tripRes.json()).id;

    // A SECOND route+trip, distinctly named — #10's regression needs a fresh
    // departure the rider has no open booking on yet (one open booking per
    // departure is a pre-existing, unrelated rule) and an unpinned booking
    // only needs a fare, never an assignment. A separate route (not just a
    // second trip on the SAME route) keeps the two departure cards
    // unambiguous to select by name in the UI — no reliance on list order.
    const routeNoPinRes = await provider.page.request.post('/api/passenger/provider/routes', {
      data: {
        name: PAX_ROUTE_NAME_NOPIN,
        originDistrict: 'BELIZE',
        originCity: 'Belize City',
        destinationDistrict: 'TOLEDO',
        destinationCity: 'Punta Gorda',
        scheduleNote: 'MDF-550 harness fixture (regression, no pins)',
        baseFareMinor: 2500,
      },
    });
    if (!routeNoPinRes.ok()) return;
    const routeNoPin = await routeNoPinRes.json();
    const tripNoPinRes = await provider.page.request.post('/api/passenger/provider/trips', {
      data: { routeId: routeNoPin.id, scheduledDepartureAt: tomorrow },
    });
    if (!tripNoPinRes.ok()) return;
    paxTripNoPinId = (await tripNoPinRes.json()).id;

    // Idempotent: a prior run of this same suite (or a retry) may already
    // hold an ACCEPTED affiliation between this provider and this driver —
    // re-inviting then 400s ("already affiliated"). Reuse it rather than
    // assuming a fresh operator with zero affiliations, which is only true
    // the first time this ever runs against a given database.
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

    const vehicleRes = await provider.page.request.post('/api/passenger/provider/vehicles', {
      data: { type: 'VAN', make: 'Toyota', model: 'Hiace', licencePlate: `UAT550${Date.now()}`.slice(0, 18), seatCapacity: 12 },
    });
    if (!vehicleRes.ok()) return;
    const vehicle = await vehicleRes.json();
    const approveRes = await admin.page.request.post(`/api/admin/passengers/vehicles/${vehicle.id}/approve`);
    if (!approveRes.ok()) return;

    const assignRes = await provider.page.request.post(`/api/passenger/provider/trips/${paxTripId}/assign`, {
      data: { driverProfileId, vehicleId: vehicle.id },
    });
    paxFixtureOk = assignRes.ok();
  } finally {
    await provider.close();
    await driver.close();
    await admin.close();
  }
});

test.afterAll(() => {
  fs.rmSync(PAX_PROVIDER_STORAGE, { force: true });
  fs.rmSync(PAX_DRIVER_STORAGE, { force: true });
  fs.rmSync(PAX_ADMIN_SETUP_STORAGE, { force: true });
});

/** Scopes to the one DepartureCard whose route name matches -- UiCard's own
 *  `bmpl-card` class (apps/web/components/ui.tsx), not a selector this
 *  harness invented, same reasoning as `mapContainer`'s own doc comment. */
function departureCard(page: Page, routeName: string) {
  return page.locator('b', { hasText: routeName }).locator('xpath=ancestor::*[contains(@class, "bmpl-card")][1]');
}

test.describe('[LOCAL ONLY, skips in CI] MDF-550 #1-#6/#8/#10/#11/#12 + reversal — passenger pickup/destination pins on a real booking', () => {
  test('rider drops an asymmetric pickup and destination pin, adjusts the pickup, submits, and both ends land in their own column — not swapped, not lost, no street address required', async ({ browser }) => {
    skipIfNoCustomer();
    skipIfNoPaxFixture();
    const { page, close } = await authedPage(browser, CUSTOMER_STORAGE);

    try {
      // #1 open passenger booking
      await page.goto('/dashboard/passenger');
      const card = departureCard(page, PAX_ROUTE_NAME);
      await card.getByRole('button', { name: 'Request seats' }).click();

      // #2/#3 — drop a pickup pin, adjust it, read back the committed value.
      // Ladyville/Dangriga (not Belize City/Punta Gorda, the ROUTE's own
      // origin/destination, which the departure card already renders as
      // "Belize City → Punta Gorda") — deliberately distinct towns, so a
      // later text match against the PIN can never be satisfied by the
      // route's own, unrelated origin/destination line.
      await page.getByLabel(/Pick me up somewhere other than the route.s stop/i).check();
      const pickupSection = page.getByRole('group', { name: 'Pickup location' });
      await pickupSection.getByLabel(/city, town or village/i).fill('Ladyville');
      await pickupSection.getByLabel(/district or island/i).selectOption('BELIZE');
      await clickMapToPlacePin(page, { x: 0.3, y: 0.3 }, 0);
      const firstPickup = await readPinCoordinates(page, 0);
      await dragPinBy(page, 40, 40, 10, 0);
      const adjustedPickup = await readPinCoordinates(page, 0);
      expect(adjustedPickup, 'dragging the pin must move it — this IS the "adjust" half of #2/#3').not.toEqual(firstPickup);

      // #4 — drop and confirm a destination pin, visibly far from pickup.
      await page.getByLabel(/Drop me off somewhere other than the route.s stop/i).check();
      const dropoffSection = page.getByRole('group', { name: 'Destination' });
      await dropoffSection.getByLabel(/city, town or village/i).fill('Dangriga');
      await dropoffSection.getByLabel(/district or island/i).selectOption('STANN_CREEK');
      await clickMapToPlacePin(page, { x: 0.8, y: 0.85 }, 1);
      const dropoff = await readPinCoordinates(page, 1);

      // Reversal check (god's addition, section 3): asymmetric by construction
      // (Belize City vs Punta Gorda), asserted here on the UI's OWN read-back
      // before submission ever happens — if the two pins already read
      // identically this far, nothing downstream can be trusted either.
      expect(dropoff, 'pickup and dropoff pins must not read as the same coordinate').not.toEqual(adjustedPickup);

      // #5 — submit.
      await card.getByRole('button', { name: 'Send request' }).click();
      await expect(page.getByText('Request sent')).toBeVisible({ timeout: 10_000 });

      // #6 — both coordinates persist in the database (API round-trip, not
      // the UI's own claim — same discipline as #3 in describe A above).
      const bookingsRes = await page.request.get('/api/passenger/bookings');
      expect(bookingsRes.ok()).toBe(true);
      const bookings = (await bookingsRes.json()) as Array<{
        tripId: string;
        pickup: { city: string; district: string; address: string | null; latitude: number; longitude: number } | null;
        dropoff: { city: string; district: string; address: string | null; latitude: number; longitude: number } | null;
      }>;
      const mine = bookings.find((b) => b.tripId === paxTripId);
      if (!mine) throw new Error('Could not find the just-submitted booking in /passenger/bookings.');

      // Not reversed, not collapsed: each end's own column holds its own data.
      expect(mine.pickup?.city).toBe('Ladyville');
      expect(mine.pickup?.district).toBe('BELIZE');
      expect(mine.pickup?.latitude).toBeCloseTo(adjustedPickup.latitude, 3);
      expect(mine.pickup?.longitude).toBeCloseTo(adjustedPickup.longitude, 3);
      expect(mine.dropoff?.city).toBe('Dangriga');
      expect(mine.dropoff?.district).toBe('STANN_CREEK');
      expect(mine.dropoff?.latitude).toBeCloseTo(dropoff.latitude, 3);
      expect(mine.dropoff?.longitude).toBeCloseTo(dropoff.longitude, 3);

      // #12 — no formal street address required: PIN mode never shows a
      // street-line field at all (AddressField.tsx), so `address` must be
      // absent on both ends of a pin-only booking like this one.
      expect(mine.pickup?.address ?? null).toBeNull();
      expect(mine.dropoff?.address ?? null).toBeNull();
    } finally {
      await close();
    }
  });

  test('#10 — an existing, unpinned passenger booking still works exactly as before', async ({ browser }) => {
    skipIfNoCustomer();
    skipIfNoPaxFixture();
    const { page, close } = await authedPage(browser, CUSTOMER_STORAGE);
    try {
      await page.goto('/dashboard/passenger');
      const card = departureCard(page, PAX_ROUTE_NAME_NOPIN);
      await card.getByRole('button', { name: 'Request seats' }).click();
      // Neither checkbox touched — the regression case: pickup/dropoff are
      // optional per booking, and the normal case on a scheduled route.
      await card.getByRole('button', { name: 'Send request' }).click();
      await expect(page.getByText('Request sent')).toBeVisible({ timeout: 10_000 });

      const bookingsRes = await page.request.get('/api/passenger/bookings');
      const bookings = (await bookingsRes.json()) as Array<{ tripId: string; pickup: unknown; dropoff: unknown }>;
      const mine = bookings.find((b) => b.tripId === paxTripNoPinId);
      if (!mine) throw new Error('Could not find the unpinned booking in /passenger/bookings.');
      expect(mine.pickup).toBeNull();
      expect(mine.dropoff).toBeNull();
    } finally {
      await close();
    }
  });

  test('#8 — the authorized driver can view the pinned pickup and destination through their own interface', async ({ browser }) => {
    skipIfNoPaxFixture();
    const { page, close } = await authedPage(browser, PAX_DRIVER_STORAGE);
    try {
      await page.goto('/dashboard/passenger-driver/trips');
      const tripCard = page.locator('b', { hasText: PAX_ROUTE_NAME }).locator('xpath=ancestor::*[contains(@class, "bmpl-card")][1]');
      await tripCard.getByRole('button', { name: 'View passengers' }).click();
      // Ladyville/Dangriga are the PIN towns, deliberately distinct from the
      // route's own Belize City/Punta Gorda origin-destination line this
      // same card already renders — a match here can only come from the
      // booking's actual pickup/dropoff snapshot, not route text.
      await expect(tripCard.getByText('Ladyville', { exact: false })).toBeVisible({ timeout: 10_000 });
      await expect(tripCard.getByText('Dangriga', { exact: false })).toBeVisible();
    } finally {
      await close();
    }
  });

  test('#7 — the booking displays the correct pickup and destination to the RIDER who set them, on their own My Bookings page', async ({ browser }) => {
    skipIfNoCustomer();
    skipIfNoPaxFixture();
    const { page, close } = await authedPage(browser, CUSTOMER_STORAGE);
    try {
      await page.goto('/dashboard/passenger/bookings');
      // Honest-fail check (god: "an honest fail is the outcome I want if it
      // is the true one"): apps/web/components/travel/MyBookings.tsx
      // (confirmed by grep before writing this) never renders pickup/dropoff
      // anywhere, on any booking row. The driver (#8 above) and admin see it
      // correctly; the rider who actually set the pins cannot see their own
      // choice reflected back on this page at all.
      await expect(page.getByText('Ladyville', { exact: false })).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText('Dangriga', { exact: false })).toBeVisible();
    } finally {
      await close();
    }
  });
});
