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
} from './support/auth';
import {
  mapContainer,
  clickMapToPlacePin,
  dragPinBy,
  touchDragPinBy,
  readPinCoordinates,
  denyGeolocationPermission,
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
 * FORWARD-LOOKING CHECKS, written against semantics that do not exist in the
 * tree yet (Oscar is actively building them) — see describe I and J below.
 * Both are EXPECTED TO FAIL OR SKIP until that work lands; that is
 * information, not a problem (god's own framing) — written now so the check
 * exists the moment the semantics do, rather than as a round-trip later.
 */

const STORAGE_DIR = os.tmpdir();
const storagePathFor = (who: string) => path.join(STORAGE_DIR, `bmpl-e2e-${who}-state-${process.pid}.json`);

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
    const search = await page.request.get('/api/marketplace/products?q=UAT+Location-E2E+Widget');
    const found = (await search.json()) as { items?: Array<{ id: string; slug: string }> };
    const product = found.items?.[0];
    test.skip(!product, 'Needs the location-harness product from seed-uat-location-e2e.ts.');
    await page.request.post('/api/cart/items', { data: { productId: product!.id, quantity: 1 } });

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

    await page.getByRole('button', { name: 'Add an address' }).click();
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

    await page.getByRole('button', { name: 'Add an address' }).click();
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

    const search = await page.request.get('/api/marketplace/products?q=UAT+Location-E2E+Widget');
    const found = (await search.json()) as { items?: Array<{ id: string }> };
    test.skip(!found.items?.[0], 'Needs the location-harness product from seed-uat-location-e2e.ts.');
    await page.request.post('/api/cart/items', { data: { productId: found.items![0]!.id, quantity: 1 } });

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

    const search = await page.request.get('/api/marketplace/products?q=UAT+Location-E2E+Widget');
    const found = (await search.json()) as { items?: Array<{ id: string }> };
    test.skip(!found.items?.[0], 'Needs the location-harness product from seed-uat-location-e2e.ts.');
    await page.request.post('/api/cart/items', { data: { productId: found.items![0]!.id, quantity: 1 } });

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
    skipIfNoCustomer();
    skipIfNoDriver();
    test.skip(!adminLoginOk, 'Needs the super admin fixture to assign the delivery (deliveries.assign permission).');

    // 1. A fresh real order, PINNED delivery address, via the real checkout —
    // same product/vendor as describe E, built fresh here rather than reused
    // so this test fully owns the PENDING_ASSIGNMENT -> ASSIGNED -> accepted
    // transition (a seeded, already-accepted order could prove this only once).
    const customer = await authedPage(browser, CUSTOMER_STORAGE);
    const search = await customer.page.request.get('/api/marketplace/products?q=UAT+Location-E2E+Widget');
    const found = (await search.json()) as { items?: Array<{ id: string }> };
    test.skip(!found.items?.[0], 'Needs the location-harness product from seed-uat-location-e2e.ts.');
    await customer.page.request.post('/api/cart/items', { data: { productId: found.items![0]!.id, quantity: 1 } });

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
    await customer.page.waitForURL(/\/orders\//, { timeout: 15_000 });
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
    await admin.close();
    expect(assignResponse.ok(), `assign failed: ${await assignResponse.text()}`).toBe(true);

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
    expect(postAcceptBody.deliveryAddress.addressLine1).not.toBeNull();
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
    const search = await checkoutPage.request.get('/api/marketplace/products?q=UAT+Location-E2E+Widget');
    const found = (await search.json()) as { items?: Array<{ id: string }> };
    test.skip(!found.items?.[0], 'Needs the location-harness product from seed-uat-location-e2e.ts.');
    await checkoutPage.request.post('/api/cart/items', { data: { productId: found.items![0]!.id, quantity: 1 } });
    await checkoutPage.goto('/checkout');
    await checkoutPage.locator('label', { hasText: 'Delivery' }).filter({ has: checkoutPage.locator('input[type=radio]') }).first().click();
    const methodSelect = checkoutPage.locator('select').filter({ has: checkoutPage.locator('option', { hasText: 'Drop a pin' }) }).first();
    await methodSelect.selectOption('PIN');

    // Drop via a real touch tap (the browser synthesizes the click Leaflet
    // listens for — same real-event-path reasoning as the mouse click path).
    const box = await mapContainer(checkoutPage).boundingBox();
    if (!box) throw new Error('Map container not visible.');
    await checkoutPage.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
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
 * I — FORWARD-LOOKING: FullScreenMapModal confirm/cancel semantics
 *     (owner check #2, refined — "confirm" only becomes a distinct action
 *     once this lands, per god's MDF-535 follow-up). NOT YET SHIPPED:
 *     today the modal's ✕/Escape/confirm all call the same onClose, so this
 *     is EXPECTED TO FAIL until Oscar's change lands — written now so the
 *     check exists the moment it's needed, same discipline as this
 *     engagement's other pre-written verification contracts.
 * ======================================================================== */

test.describe('[LOCAL ONLY, skips in CI, EXPECTED TO FAIL until Oscar ships FullScreenMapModal confirm/cancel] #2 refined — cancel reverts to the opening value, confirm keeps the moved pin', () => {
  test('dragging the pin inside the full-screen modal then Cancel restores the value the modal opened with', async ({ browser }) => {
    skipIfNoCustomer();
    const context = await browser.newContext({ storageState: CUSTOMER_STORAGE });
    const page = await context.newPage();
    const search = await page.request.get('/api/marketplace/products?q=UAT+Location-E2E+Widget');
    const found = (await search.json()) as { items?: Array<{ id: string }> };
    test.skip(!found.items?.[0], 'Needs the location-harness product from seed-uat-location-e2e.ts.');
    await page.request.post('/api/cart/items', { data: { productId: found.items![0]!.id, quantity: 1 } });
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
 * J — FORWARD-LOOKING: search box must not breach Nominatim rate policy
 *     (Oscar's gap-table finding #2). NOT YET SHIPPED: LocationPicker has no
 *     search input at all today (confirmed by grep before writing this) —
 *     this test SKIPS cleanly until one exists, rather than erroring on a
 *     missing element, and documents the exact assertion to run once it does.
 * ======================================================================== */

test.describe('[LOCAL ONLY, skips in CI, PENDING Oscar\'s LocationPicker search input] typing a search query never sends one geocode request per keystroke', () => {
  test('a rapid multi-character query produces far fewer real /geocode requests than characters typed', async ({ browser }) => {
    skipIfNoCustomer();
    const context = await browser.newContext({ storageState: CUSTOMER_STORAGE });
    const page = await context.newPage();
    const search = await page.request.get('/api/marketplace/products?q=UAT+Location-E2E+Widget');
    const found = (await search.json()) as { items?: Array<{ id: string }> };
    test.skip(!found.items?.[0], 'Needs the location-harness product from seed-uat-location-e2e.ts.');
    await page.request.post('/api/cart/items', { data: { productId: found.items![0]!.id, quantity: 1 } });
    await page.goto('/checkout');
    await page.locator('label', { hasText: 'Delivery' }).filter({ has: page.locator('input[type=radio]') }).first().click();
    const methodSelect = page.locator('select').filter({ has: page.locator('option', { hasText: 'Drop a pin' }) }).first();
    await methodSelect.selectOption('PIN');

    const searchInput = mapContainer(page).locator('..').getByRole('searchbox').or(page.getByPlaceholder(/search for a place|search address/i));
    const hasSearchBox = await searchInput.first().isVisible().catch(() => false);
    test.skip(!hasSearchBox, 'LocationPicker has no search input yet — Oscar is adding one (MDF-535 follow-up). This check is ready the moment it ships; nothing to run against today.');

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
