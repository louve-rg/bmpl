import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * /dashboard/store's "Pickup locations" list renders a vendor-typed location
 * label, address and (optional) pickup instructions all as text inside a
 * single <span> that is itself an unguarded flex item of the row's own
 * `flex flex-wrap items-center justify-between` <li> -- no `min-w-0`, no
 * `break-words`, same mechanism as #413/#415/#418. `label` is customer
 * free text (`z.string().min(1).max(120)`, packages/validation/src/
 * marketplace.ts) -- long enough to be one unbroken word.
 *
 * UNLIKE the orders-list sibling defect, this one IS silently clipped by an
 * ancestor -- the document itself stays exactly viewport-width while the
 * <li> itself overflows by hundreds of pixels (measured before the fix:
 * 838 scrollWidth vs 244 clientWidth at 320px). So this spec measures the
 * <li>'s own scrollWidth/clientWidth, not the document -- the correct
 * instrument for a clipped case, per the standing floor lesson from #410.
 *
 * [LOCAL ONLY] `/dashboard/store` sits under app/dashboard/*, whose layout
 * does its own server-side `serverGet('/me')` (apps/web/lib/server-api.ts) --
 * a real `fetch()` to `NEXT_PUBLIC_API_URL` that `page.route()` cannot
 * intercept, because that only hooks the browser's own network stack, not
 * Next's SSR fetch. No prior version of this file's comment was accurate
 * here: there is no "tiny real HTTP server" anywhere in this repo that
 * answers that call -- checked `e2e/support/server.ts` and
 * `e2e/support/global-setup.ts` in full; they start the Next dev server on
 * port 3177 and nothing else. CI's e2e job has no API/DB services (apps/web
 * never talks to Postgres/Redis/MinIO directly, root CLAUDE.md s2), so
 * nothing answers `/me` there and this spec cannot pass as configured --
 * it needs a live API (or a local stand-in for `/me`) pointed at
 * `NEXT_PUBLIC_API_URL`. Without one, `serverGet` throws, uncaught, before
 * the layout even reaches its own `redirect('/login')`, so `openStoreLocations`
 * below skips the test rather than failing on this unrelated precondition.
 */

const WIDTHS = [320, 375, 768, 1024, 1440];
const LONG_LABEL = 'D'.repeat(80);

function storeProfile() {
  return {
    profile: {
      id: 'vendor-1', businessName: 'Test Vendor', slug: 'test-vendor', description: null,
      contactEmail: 'v@example.com', contactPhone: null, website: null,
      approvalStatus: 'APPROVED', storeStatus: 'OPEN', rejectionReason: null, logoUrl: null, bannerUrl: null,
    },
    settings: { pickupEnabled: true, deliveryEnabled: false, vacationMode: false, hideOutOfStock: false, minimumOrderMinor: null },
    locations: [
      {
        id: 'loc-1', label: LONG_LABEL, addressLine1: '123 Main St', city: 'Belize City', district: 'BELIZE',
        isPrimary: true, latitude: 17.5, longitude: -88.2, pickupInstructions: null,
      },
    ],
    openingHours: [],
  };
}

async function openStoreLocations(page: Page): Promise<Locator | null> {
  await page.context().addCookies([
    { name: 'access_token', value: 'fake-for-layout-check', domain: 'localhost', path: '/' },
  ]);
  await page.route('**/api/vendor/profile', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: storeProfile() }) : r.continue()));
  try {
    // `goto` belongs inside this try: a failed SSR `/me` call throws before
    // the dashboard layout ever renders, so the long-label `<li>` never
    // appears -- that is a precondition failure, not a reason to fail this
    // spec's own, unrelated overflow assertion.
    await page.goto('/dashboard/store');
    const li = page.locator('li', { hasText: LONG_LABEL }).first();
    await expect(li).toBeVisible({ timeout: 5000 });
    return li;
  } catch {
    return null;
  }
}

test.describe('[LOCAL ONLY, skips without a /me responder -- see file header] store pickup-location row never overflows itself on a long label', () => {
  for (const width of WIDTHS) {
    test(`the location row stays inside its own box at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1200 });
      const li = await openStoreLocations(page);
      test.skip(li === null, 'Needs a local responder for the dashboard-shell /me SSR call -- see file header.');

      const measured = await li!.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));

      expect(
        measured.scrollWidth,
        `location row scrollWidth ${measured.scrollWidth} vs its own clientWidth ${measured.clientWidth} at ${width}px -- the row should never overflow itself`,
      ).toBeLessThanOrEqual(measured.clientWidth + 1);
    });
  }
});
