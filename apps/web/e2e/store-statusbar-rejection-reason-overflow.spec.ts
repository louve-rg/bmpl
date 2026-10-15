import { test, expect, type Page } from '@playwright/test';

/**
 * /dashboard/store's StatusBar renders the admin-entered `rejectionReason`
 * as a raw <span> that is itself an unguarded flex item of the row's own
 * `flex flex-wrap items-center gap-2` <div> -- no `min-w-0`, no
 * `break-words`, same mechanism as #410/#413/#415/#418/#419/#420.
 *
 * This is a silently-clipped case, same shape as #413/#420: apps/web's
 * dashboard shell (`app/dashboard/layout.tsx`) wraps every dashboard page in
 * `overflow-x-hidden`, so `document.documentElement.scrollWidth` stays at
 * the viewport width no matter how badly a page inside it overflows -- that
 * is NOT evidence the page is clean, it is the shell doing its job one
 * level up. The correct instrument is the overflowing element's own
 * getBoundingClientRect() against the viewport width (confirmed live,
 * unfixed: rect.right === 755 at a 320px viewport -- 435px past the edge --
 * while document.scrollWidth stayed exactly 320).
 *
 * `/dashboard/store` sits under app/dashboard/*, whose layout does its own
 * server-side `serverGet('/me')` that `page.route()` cannot intercept -- the
 * global test server (see e2e/support/server.ts) already answers that.
 */

const WIDTHS = [320, 375, 768, 1024, 1440];
const LONG_WORD = 'A'.repeat(80);

function storeProfile() {
  return {
    profile: {
      id: 'vendor-1', businessName: 'Test Vendor', slug: 'test-vendor', description: null,
      contactEmail: 'v@example.com', contactPhone: null, website: null,
      approvalStatus: 'REJECTED', storeStatus: 'CLOSED',
      rejectionReason: `Blurry storefront photo ${LONG_WORD}`,
      logoUrl: null, bannerUrl: null,
    },
    settings: { pickupEnabled: true, deliveryEnabled: false, vacationMode: false, hideOutOfStock: false, minimumOrderMinor: null },
    locations: [],
    openingHours: [],
  };
}

async function openStoreStatusBar(page: Page) {
  await page.context().addCookies([
    { name: 'access_token', value: 'fake-for-layout-check', domain: 'localhost', path: '/' },
  ]);
  await page.route('**/api/vendor/profile', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: storeProfile() }) : r.continue()));
  await page.goto('/dashboard/store');
  const span = page.locator('span', { hasText: 'Reason:' }).first();
  await expect(span).toBeVisible();
  return span;
}

test.describe('store StatusBar rejection-reason span never overflows the viewport on a long reason', () => {
  for (const width of WIDTHS) {
    test(`the reason span stays inside the viewport at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1200 });
      const span = await openStoreStatusBar(page);

      const rect = await span.evaluate((el) => el.getBoundingClientRect());

      expect(
        rect.right,
        `reason span right edge ${rect.right} vs viewport width ${width}px -- it should never extend past the viewport`,
      ).toBeLessThanOrEqual(width + 1);
    });
  }
});
