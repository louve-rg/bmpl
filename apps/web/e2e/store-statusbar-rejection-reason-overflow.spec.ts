import { test, expect, type Locator, type Page } from '@playwright/test';

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
 * [LOCAL ONLY] `/dashboard/store` sits under app/dashboard/*, whose layout
 * does its own server-side `serverGet('/me')` (apps/web/lib/server-api.ts) --
 * a real `fetch()` to `NEXT_PUBLIC_API_URL` that `page.route()` cannot
 * intercept, because that only hooks the browser's own network stack, not
 * Next's SSR fetch. A prior version of this comment claimed "the global
 * test server (see e2e/support/server.ts) already answers that" -- that is
 * not true: checked `e2e/support/server.ts` and `e2e/support/global-setup.ts`
 * in full, they start the Next dev server on port 3177 and nothing else.
 * Nothing answers `/me`, and CI's e2e job has no API/DB services (apps/web
 * never talks to Postgres/Redis/MinIO directly, root CLAUDE.md s2), so this
 * spec cannot pass as configured there -- it needs a live API (or a local
 * stand-in for `/me`) pointed at `NEXT_PUBLIC_API_URL`. Without one,
 * `serverGet` throws, uncaught, before the layout even reaches its own
 * `redirect('/login')`, so `openStoreStatusBar` below skips the test rather
 * than failing on this unrelated precondition.
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

async function openStoreStatusBar(page: Page): Promise<Locator | null> {
  await page.context().addCookies([
    { name: 'access_token', value: 'fake-for-layout-check', domain: 'localhost', path: '/' },
  ]);
  await page.route('**/api/vendor/profile', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: storeProfile() }) : r.continue()));
  try {
    // `goto` belongs inside this try: a failed SSR `/me` call throws before
    // the dashboard layout ever renders, so the "Reason:" span never
    // appears -- that is a precondition failure, not a reason to fail this
    // spec's own, unrelated overflow assertion.
    await page.goto('/dashboard/store');
    const span = page.locator('span', { hasText: 'Reason:' }).first();
    await expect(span).toBeVisible({ timeout: 5000 });
    return span;
  } catch {
    return null;
  }
}

test.describe('[LOCAL ONLY, skips without a /me responder -- see file header] store StatusBar rejection-reason span never overflows the viewport on a long reason', () => {
  for (const width of WIDTHS) {
    test(`the reason span stays inside the viewport at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1200 });
      const span = await openStoreStatusBar(page);
      test.skip(span === null, 'Needs a local responder for the dashboard-shell /me SSR call -- see file header.');

      const rect = await span!.evaluate((el) => el.getBoundingClientRect());

      expect(
        rect.right,
        `reason span right edge ${rect.right} vs viewport width ${width}px -- it should never extend past the viewport`,
      ).toBeLessThanOrEqual(width + 1);
    });
  }
});
