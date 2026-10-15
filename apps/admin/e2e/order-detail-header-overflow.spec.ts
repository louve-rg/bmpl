import { test, expect, type Page } from '@playwright/test';

/**
 * Two sites on `/dashboard/orders/[id]` share the same unguarded-flex-item
 * mechanism already on record for apps/web (#410/#413/#415/#418/#419/#420):
 * a flex item with no `min-w-0` sizes to its content's min-content width
 * (for an unbroken word, the whole word), regardless of `flex-wrap` on the
 * row around it.
 *
 *   1. The page header: `order.customer.name`/`.email` (customer free text)
 *      sit in a `<p>` inside a plain `<div>` that is itself an unguarded
 *      flex item of `flex flex-wrap items-center justify-between gap-3`
 *      (next to the StatusBadge) -- not clipped by anything, so this one
 *      shows up as a genuine ancestor (this app's page shell has its own
 *      `overflow-x-hidden`, confirmed empirically, same shape as apps/web's
 *      dashboard shell) overflow, measured on the header row itself.
 *   2. `vo.vendor.businessName` (the SAME field already confirmed
 *      long-capable by apps/web's #415/#419) sits in a `<span>` that is an
 *      unguarded flex item of the vendor card's own
 *      `flex flex-wrap items-center justify-between gap-2` header --
 *      INSIDE a `<Card className="overflow-hidden p-0">`, so this one is
 *      silently clipped (same shape as #413/#420): the document never moves,
 *      only the card's own scrollWidth does.
 *
 * [LOCAL ONLY] This page sits under app/dashboard/*, whose layout does a
 * server-side `serverGet('/me')` that `page.route()` cannot intercept (it
 * never crosses the browser). Point `ADMIN_PUBLIC_API_URL`/
 * `NEXT_PUBLIC_API_URL` at a tiny local responder for `/me` before running
 * this file locally (same gotcha apps/web's dashboard-shell specs document);
 * without one, the dashboard layout redirects to /login and every test here
 * skips itself rather than failing on an unrelated precondition.
 */

const WIDTHS = [320, 375, 768, 1024, 1440];
const LONG_WORD = 'A'.repeat(70);

function order() {
  return {
    id: 'order-1',
    orderNumber: 'ORD-0001',
    status: 'PLACED',
    itemCount: 1,
    subtotalMinor: 5000,
    deliveryFeeMinor: 500,
    totalMinor: 5500,
    currency: 'BZD',
    placedAt: new Date().toISOString(),
    customer: { name: `Customer ${LONG_WORD}`, email: `${LONG_WORD}@example.com` },
    deliveryAddress: null,
    vendorOrders: [
      {
        id: 'vo-1',
        orderNumber: 'VO-0001',
        status: 'ACCEPTED',
        deliveryMethod: 'PICKUP',
        delivery: null,
        customerNotes: null,
        itemCount: 1,
        subtotalMinor: 5000,
        vendor: { businessName: `Vendor ${LONG_WORD}` },
        items: [{ productTitle: 'Widget', variantTitle: null, sku: 'W-1', unitPriceMinor: 5000, quantity: 1, subtotalMinor: 5000 }],
        originLocation: null,
      },
    ],
  };
}

async function openOrderDetail(page: Page): Promise<boolean> {
  await page.context().addCookies([{ name: 'access_token', value: 'fake-for-layout-check', domain: 'localhost', path: '/' }]);
  await page.route('**/api/admin/orders/order-1', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: order() }) : r.continue()));
  await page.goto('/dashboard/orders/order-1');
  try {
    await expect(page.getByText('ORD-0001')).toBeVisible({ timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

test.describe('[LOCAL ONLY, skips without a /me responder -- see file header] order detail header rows never overflow their own box', () => {
  for (const width of WIDTHS) {
    test(`the customer header row and vendor header stay inside their own box at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1200 });
      const ready = await openOrderDetail(page);
      test.skip(!ready, 'Needs a local responder for the dashboard-shell /me SSR call -- see file header.');

      const measured = await page.evaluate(() => {
        const headerRow = document.querySelector('h1')?.closest('.flex') as HTMLElement | null;
        const vendorCard = Array.from(document.querySelectorAll<HTMLElement>('div')).find((d) => d.className.includes('overflow-hidden'));
        const pick = (el: HTMLElement | null | undefined) => (el ? { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth } : null);
        return { headerRow: pick(headerRow), vendorCard: pick(vendorCard) };
      });

      expect(measured.headerRow, 'customer header row element not found').not.toBeNull();
      expect(
        measured.headerRow!.scrollWidth,
        `customer header row scrollWidth ${measured.headerRow!.scrollWidth} vs its own clientWidth ${measured.headerRow!.clientWidth} at ${width}px`,
      ).toBeLessThanOrEqual(measured.headerRow!.clientWidth + 1);

      expect(measured.vendorCard, 'vendor card (overflow-hidden) element not found').not.toBeNull();
      expect(
        measured.vendorCard!.scrollWidth,
        `vendor card scrollWidth ${measured.vendorCard!.scrollWidth} vs its own clientWidth ${measured.vendorCard!.clientWidth} at ${width}px`,
      ).toBeLessThanOrEqual(measured.vendorCard!.clientWidth + 1);
    });
  }
});
