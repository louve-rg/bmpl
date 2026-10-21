import { test, expect, type Page } from '@playwright/test';

/**
 * /orders (the customer's own order list) renders a joined list of vendor
 * business names (`o.vendors.join(', ')`) inside a <p> whose parent <div>
 * is an unguarded flex item of the row's own `flex flex-wrap` Card -- no
 * `min-w-0`, same mechanism as #413/#415/#418. A single long, unbroken
 * vendor business name (real data, same field already confirmed long-
 * capable in #415's checkout fix) pins the row's own <div> at its content
 * width, which is never clipped here -- the whole PAGE grows wider than
 * the viewport, a visible horizontal scrollbar (the #415 shape, not #413's
 * silent clip).
 *
 * No real login, no live API: `/orders` is gated only by the auth cookie's
 * PRESENCE (apps/web/middleware.ts), and the one data call is route-mocked.
 */

const WIDTHS = [320, 375, 768, 1024, 1440];
const LONG_VENDOR = 'E'.repeat(80);

function orders() {
  return [
    {
      id: 'order-1',
      orderNumber: 'ORD-0001',
      status: 'PENDING',
      itemCount: 2,
      totalMinor: 5000,
      placedAt: new Date().toISOString(),
      vendorCount: 1,
      vendors: [LONG_VENDOR],
    },
  ];
}

async function openOrdersList(page: Page) {
  await page.context().addCookies([
    { name: 'access_token', value: 'fake-for-layout-check', domain: 'localhost', path: '/' },
  ]);
  await page.route('**/api/orders', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: orders() }) : r.continue()));
  await page.goto('/orders');
  await expect(page.getByText(LONG_VENDOR)).toBeVisible();
}

test.describe('customer orders list never widens the page on a long vendor name', () => {
  for (const width of WIDTHS) {
    test(`page stays inside the viewport at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openOrdersList(page);

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      expect(
        scrollWidth,
        `page scrollWidth ${scrollWidth} vs clientWidth ${clientWidth} at ${width}px -- a long vendor name should never widen the page`,
      ).toBeLessThanOrEqual(clientWidth + 1);
    });
  }
});
