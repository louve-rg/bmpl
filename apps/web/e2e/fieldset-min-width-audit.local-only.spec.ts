import { test, expect, type Page, type Browser } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { tryLogin, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, UAT_DRIVER_EMAIL, UAT_DRIVER_PASSWORD } from './support/auth';

/**
 * *** LOCAL ONLY, SKIPS IN CI -- same reason as authenticated-dashboard-
 * *** geometry.local-only.spec.ts and endpoint-picker-hub-instructions-
 * *** overflow.local-only.spec.ts: every /dashboard/* route does a
 * *** server-side serverGet('/me') that page.route() cannot intercept.
 *
 * MDF-278: audit of the 8 remaining <fieldset> elements across apps/web
 * that carry no `min-w-0`, now that mechanism #3 (a <fieldset>'s own
 * browser UA-stylesheet `min-width: min-content`, which `overflow-wrap`
 * cannot shrink -- see MDF-251/MDF-276) has two independently confirmed
 * real instances. Presence of the construct is NOT a defect: a fieldset
 * only overflows when something INSIDE it has an unbreakable intrinsic
 * width. The instrument is boundingBox() against the viewport width --
 * scrollWidth and documentElement.scrollWidth both read clean through the
 * dashboard shell's overflow-x-hidden, proven on MDF-276.
 *
 * This file covers the 6 of 8 reachable from apps/web (apps/admin's ops
 * page is a separate spec in that app). Two routes need no real backend at
 * all (/, public; /checkout, middleware only checks cookie PRESENCE and
 * the page is 'use client' with no server-side data fetch, same mechanism
 * already used by shipment-new-parcel-description-overflow.spec.ts) -- the
 * other four are under /dashboard/* and need a real login.
 */

const WIDTHS = [320, 375, 768, 1024, 1440];
const SUPER_ADMIN_STORAGE = path.join(os.tmpdir(), `bmpl-e2e-fieldset-audit-admin-${process.pid}.json`);
const DRIVER_STORAGE = path.join(os.tmpdir(), `bmpl-e2e-fieldset-audit-driver-${process.pid}.json`);

let adminLoginOk = false;
let driverLoginOk = false;

test.beforeAll(async ({ browser }) => {
  if (SUPER_ADMIN_PASSWORD) {
    const context = await browser.newContext();
    const page = await context.newPage();
    adminLoginOk = await tryLogin(page, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
    if (adminLoginOk) await context.storageState({ path: SUPER_ADMIN_STORAGE });
    await context.close();
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  driverLoginOk = await tryLogin(page, UAT_DRIVER_EMAIL, UAT_DRIVER_PASSWORD);
  if (driverLoginOk) await context.storageState({ path: DRIVER_STORAGE });
  await context.close();
});

test.afterAll(() => {
  fs.rmSync(SUPER_ADMIN_STORAGE, { force: true });
  fs.rmSync(DRIVER_STORAGE, { force: true });
});

async function rightEdge(page: Page, locator: ReturnType<Page['locator']>): Promise<number> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element not found/visible');
  return box.x + box.width;
}

async function authedContext(browser: Browser, storagePath: string, width: number) {
  const context = await browser.newContext({ storageState: storagePath, viewport: { width, height: 900 } });
  const page = await context.newPage();
  return { page, close: () => context.close() };
}

/* ---------------------------------------------------------------------- */
/* 1. Providers.tsx:43 -- public landing page, no login. ROLES is a
      hardcoded compile-time array (packages/landing copy), longest label
      "Shipping Provider" / "Passenger Driver" / "Real Estate Agent" -- all
      short, multi-word (wraps at spaces by default), never operator free
      text. Measured as-is: nothing in this component can ever vary. */
test.describe('[LOCAL ONLY, skips in CI] MDF-278 fieldset audit: Providers.tsx:43 (public landing, role selector)', () => {
  for (const width of WIDTHS) {
    test(`role-selector fieldset stays inside the viewport at ${width}px`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      await page.goto('/');
      const fieldset = page.locator('fieldset', { has: page.getByRole('radio', { name: 'Vendor' }) });
      await expect(fieldset).toBeVisible();
      const edge = await rightEdge(page, fieldset);
      await context.close();
      expect(edge, `fieldset right edge ${edge.toFixed(1)} at ${width}px`).toBeLessThanOrEqual(width + 1);
    });
  }
});

/* ---------------------------------------------------------------------- */
/* 2. checkout/page.tsx:283 -- /checkout is in middleware's matcher but the
      page itself is 'use client' with no server component data fetch, so
      a fake cookie (middleware only checks presence) plus full
      page.route() mocking reaches it with no real backend at all --
      exactly the mechanism shipment-new-parcel-description-overflow.spec.ts
      already uses. Fulfilment fieldset contains only fixed "Pickup"/
      "Delivery" radio labels -- no free text possible. */
async function openCheckoutFulfilment(page: Page) {
  await page.context().addCookies([{ name: 'access_token', value: 'fake-for-layout-check', domain: 'localhost', path: '/' }]);
  await page.route('**/api/cart', (r) =>
    r.fulfill({
      json: {
        vendors: [
          {
            vendorProfileId: 'v1',
            businessName: 'Test Vendor',
            subtotalMinor: 1000,
            items: [{ id: 'i1', name: 'Item', quantity: 1, priceMinor: 1000 }],
          },
        ],
        hasUnavailableItems: false,
      },
    }),
  );
  await page.route('**/api/wallet', (r) => r.fulfill({ json: { currency: 'BZD', availableMinor: 0, onHoldMinor: 0, totalMinor: 0, status: 'ACTIVE', exists: true } }));
  await page.route('**/api/checkout/quote*', (r) => r.fulfill({ json: [] }));
  await page.route('**/api/addresses', (r) => r.fulfill({ json: [] }));
  await page.goto('/checkout');
}

test.describe('[LOCAL ONLY, skips in CI] MDF-278 fieldset audit: checkout/page.tsx:283 (Fulfilment radio)', () => {
  for (const width of WIDTHS) {
    test(`Fulfilment fieldset stays inside the viewport at ${width}px`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      await openCheckoutFulfilment(page);
      const fieldset = page.locator('fieldset', { hasText: 'Fulfilment' }).first();
      await expect(fieldset).toBeVisible();
      const edge = await rightEdge(page, fieldset);
      await context.close();
      expect(edge, `fieldset right edge ${edge.toFixed(1)} at ${width}px`).toBeLessThanOrEqual(width + 1);
    });
  }
});

/* ---------------------------------------------------------------------- */
/* 3. shipments/new/page.tsx:219 -- "How should it travel?" fieldset.
      Contains mode-toggle buttons (TRANSPORT_MODE_LABELS, fixed enum), a
      static explanatory <p>, and three <input>s (parcel description,
      pieces, travel date) -- an <input>'s VALUE never forces its own or an
      ancestor's layout width (replaced element, fixed CSS width), so even
      a very long typed description cannot stress this fieldset. Measured
      live against the real local stack (same setup as MDF-276/PR #443). */
function skipIfNoAdminSession() {
  test.skip(!SUPER_ADMIN_PASSWORD || !adminLoginOk, 'Needs a live API + seeded dev database with SEED_SUPER_ADMIN_PASSWORD set.');
}

async function openShipmentsNew(page: Page) {
  await page.goto('/dashboard/shipments/new');
}

test.describe('[LOCAL ONLY, skips in CI] MDF-278 fieldset audit: shipments/new/page.tsx:219 ("How should it travel?")', () => {
  for (const width of WIDTHS) {
    test(`mode fieldset stays inside the viewport at ${width}px`, async ({ browser }) => {
      skipIfNoAdminSession();
      const { page, close } = await authedContext(browser, SUPER_ADMIN_STORAGE, width);
      await openShipmentsNew(page);
      const fieldset = page.locator('fieldset', { hasText: 'How should it travel?' });
      await expect(fieldset).toBeVisible();
      const edge = await rightEdge(page, fieldset);
      await close();
      expect(edge, `fieldset right edge ${edge.toFixed(1)} at ${width}px`).toBeLessThanOrEqual(width + 1);
    });
  }
});

/* ---------------------------------------------------------------------- */
/* 4. EndpointPicker.tsx:116 -- the DOOR/HUB toggle fieldset, gated by
      `{allowDoor && allowHub && (...)}`. Its ONLY call site
      (shipments/new/page.tsx:198-216) passes allowDoor={needsFirstMile(s)}
      and allowHub={!needsFirstMile(s)} for the origin picker, and the
      exact same complementary pair (needsLastMile/!needsLastMile) for the
      destination picker -- allowDoor and allowHub are strict logical
      complements at both call sites, so `allowDoor && allowHub` is
      mathematically always false. This fieldset cannot render through any
      UI interaction on the only page that uses this component -- not
      measured live because there is no way to reach it; GREEN by
      construction (unreachable), not inspection-only speculation. Flagged
      separately as a probable dead-code finding, out of scope for this
      overflow audit. */
test.describe('[LOCAL ONLY, skips in CI] MDF-278 fieldset audit: EndpointPicker.tsx:116 (DOOR/HUB toggle) -- confirms unreachable, not measured', () => {
  test('no UI path renders the allowDoor&&allowHub fieldset for any of the 4 service types', async ({ browser }) => {
    skipIfNoAdminSession();
    const { page, close } = await authedContext(browser, SUPER_ADMIN_STORAGE, 1024);
    await openShipmentsNew(page);
    for (const service of ['DOOR_TO_DOOR', 'DOOR_TO_HUB', 'HUB_TO_HUB', 'HUB_TO_DOOR']) {
      await page.selectOption('#service-type', service);
      // The toggle fieldset's two buttons are "An address" / "A terminal" --
      // confirm neither appears for any service type.
      await expect(page.getByRole('button', { name: 'A terminal', exact: false })).toHaveCount(0);
    }
    await close();
  });
});

/* ---------------------------------------------------------------------- */
/* 5. delivery/page.tsx:155 (DistrictCheckboxes, via AddZoneForm) -- fixed
      6-item DISTRICTS array, districtLabel() is a pure format function
      over that fixed array, never operator free text. GET /vendor/delivery
      is a client-side api.get() call (not server-side), so it's mockable
      via page.route() even with a SUPER_ADMIN session that holds no real
      vendor profile -- avoids needing a vendor fixture just to reach a
      fieldset whose content cannot vary regardless. */
async function openDeliverySettings(page: Page) {
  await page.route('**/api/vendor/delivery', (r) =>
    r.fulfill({
      json: {
        settings: { pickupEnabled: true, deliveryEnabled: true, baseDeliveryFeeMinor: 500, freeDeliveryThresholdMinor: null, minimumOrderMinor: null, deliveryRadiusKm: 10 },
        zones: [],
        estimate: null,
      },
    }),
  );
  await page.goto('/dashboard/delivery');
}

test.describe('[LOCAL ONLY, skips in CI] MDF-278 fieldset audit: delivery/page.tsx:155 (Districts, Add zone form)', () => {
  for (const width of WIDTHS) {
    test(`Add-zone Districts fieldset stays inside the viewport at ${width}px`, async ({ browser }) => {
      skipIfNoAdminSession();
      const { page, close } = await authedContext(browser, SUPER_ADMIN_STORAGE, width);
      await openDeliverySettings(page);
      const fieldset = page.locator('fieldset', { hasText: 'Districts' }).first();
      await expect(fieldset).toBeVisible();
      const edge = await rightEdge(page, fieldset);
      await close();
      expect(edge, `fieldset right edge ${edge.toFixed(1)} at ${width}px`).toBeLessThanOrEqual(width + 1);
    });
  }
});

/* ---------------------------------------------------------------------- */
/* 6. ServiceAreasSection.tsx:83 (Districts you can deliver in) -- same
      fixed 6-item DISTRICTS/districtLabel() pattern as #5, no free text.
      Needs the DELIVERY_DRIVER role (SUPER_ADMIN holds no driver role). */
function skipIfNoDriverSession() {
  test.skip(!driverLoginOk, 'Needs the UAT driver fixture (packages/database/prisma/seed-uat-logistics.ts).');
}

async function mockDriverDashboard(page: Page, cities: string[] = []) {
  await page.route('**/api/driver/dashboard', (r) =>
    r.fulfill({
      json: {
        hasProfile: true,
        roleStatus: 'APPROVED',
        application: null,
        profile: null,
        vehicles: [],
        serviceAreas: [{ district: 'BELIZE', isActive: true, cities: cities.map((c, i) => ({ id: `c${i}`, city: c, isActive: true })) }],
        eligibility: { canGoOnline: true, reasons: [] },
      },
    }),
  );
}

test.describe('[LOCAL ONLY, skips in CI] MDF-278 fieldset audit: ServiceAreasSection.tsx:83 (district checkboxes)', () => {
  for (const width of WIDTHS) {
    test(`Districts-you-can-deliver-in fieldset stays inside the viewport at ${width}px`, async ({ browser }) => {
      skipIfNoDriverSession();
      const { page, close } = await authedContext(browser, DRIVER_STORAGE, width);
      await mockDriverDashboard(page);
      await page.goto('/dashboard/driver/service-areas');
      const fieldset = page.locator('fieldset', { hasText: 'Districts you can deliver in' });
      await expect(fieldset).toBeVisible();
      const edge = await rightEdge(page, fieldset);
      await close();
      expect(edge, `fieldset right edge ${edge.toFixed(1)} at ${width}px`).toBeLessThanOrEqual(width + 1);
    });
  }
});

/* ---------------------------------------------------------------------- */
/* 7. ServiceAreasSection.tsx:222 (per-district town list) -- the genuine
      stress candidate in this file: `city` comes from
      GET /driver/service-areas/:district/cities, an admin-configured town
      name (hubBase.city: z.string().trim().min(2).max(80), no word-break
      requirement) -- not a fixed enum like DISTRICTS. A client-side
      api.get() call, mockable via page.route() with a long unbroken
      synthetic town name, same technique as #5 (no real hub mutation
      needed -- cheaper than PATCHing a real hub the way MDF-276 did,
      since this data is read client-side, not via a server component). */
const LONG_TOWN_NAME = 'Sanpedrotownverylongunbrokensettlementnamewithnospacesatallinthewholestring';

test.describe('[LOCAL ONLY, skips in CI] MDF-278 fieldset audit: ServiceAreasSection.tsx:222 (per-district towns, stress-tested)', () => {
  for (const width of WIDTHS) {
    test(`town-list fieldset stays inside the viewport at ${width}px with an unbroken long town name`, async ({ browser }) => {
      skipIfNoDriverSession();
      const { page, close } = await authedContext(browser, DRIVER_STORAGE, width);
      // BELIZE already marked `isActive` AND carrying one saved city row
      // (dashboard-data.tsx's own union-with-initial logic) is what makes
      // DistrictCities render immediately -- no UI interaction needed.
      await mockDriverDashboard(page, [LONG_TOWN_NAME]);
      await page.route('**/api/driver/service-areas/*/cities', (r) => r.fulfill({ json: { cities: [LONG_TOWN_NAME] } }));
      await page.goto('/dashboard/driver/service-areas');
      const fieldset = page.locator('fieldset', { hasText: LONG_TOWN_NAME.slice(0, 20) });
      await expect(fieldset).toBeVisible({ timeout: 10_000 });
      const edge = await rightEdge(page, fieldset);
      await close();
      expect(edge, `fieldset right edge ${edge.toFixed(1)} at ${width}px with town "${LONG_TOWN_NAME.slice(0, 20)}..."`).toBeLessThanOrEqual(width + 1);
    });
  }
});
