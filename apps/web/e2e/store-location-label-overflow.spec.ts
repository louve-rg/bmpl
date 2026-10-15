import { test, expect, type Page } from '@playwright/test';

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
 * `/dashboard/store` sits under app/dashboard/*, whose layout does its own
 * server-side `serverGet('/me')` that `page.route()` cannot intercept -- a
 * tiny real HTTP server answers that one SSR call on the configured
 * `NEXT_PUBLIC_API_URL` port; every client-side call stays route-mocked.
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

async function openStoreLocations(page: Page) {
  await page.context().addCookies([
    { name: 'access_token', value: 'fake-for-layout-check', domain: 'localhost', path: '/' },
  ]);
  await page.route('**/api/vendor/profile', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: storeProfile() }) : r.continue()));
  await page.goto('/dashboard/store');
  const li = page.locator('li', { hasText: LONG_LABEL }).first();
  await expect(li).toBeVisible();
  return li;
}

test.describe('store pickup-location row never overflows itself on a long label', () => {
  for (const width of WIDTHS) {
    test(`the location row stays inside its own box at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1200 });
      const li = await openStoreLocations(page);

      const measured = await li.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));

      expect(
        measured.scrollWidth,
        `location row scrollWidth ${measured.scrollWidth} vs its own clientWidth ${measured.clientWidth} at ${width}px -- the row should never overflow itself`,
      ).toBeLessThanOrEqual(measured.clientWidth + 1);
    });
  }
});
