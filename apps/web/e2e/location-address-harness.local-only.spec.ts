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
} from './support/auth';
import {
  clickMapToPlacePin,
  dragPinBy,
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
 *   #11 GPS denial doesn't block manual pin -> describe D
 *   #12 no formal street address saves -> describe B
 *   #13 cross-customer isolation       -> describe F
 *   #9, #10: NOT in this file. No authorized interface exists yet for a
 *     driver/carrier to VIEW a pickup/delivery pin (MapPreview has zero real
 *     call sites outside the maps package itself, confirmed before writing
 *     this file), and no passenger-service booking page uses LocationPicker
 *     at all — both are Pam/Oscar's new work, not something existing code can
 *     be driven to prove yet.
 *   #14 (regression): not new specs here — the existing suites this harness
 *     sits beside already cover checkout/wallet/carrier/booking; re-running
 *     them once Pam/Oscar's changes land is the actual #14 check, not a new
 *     test written against code that does not exist yet.
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
