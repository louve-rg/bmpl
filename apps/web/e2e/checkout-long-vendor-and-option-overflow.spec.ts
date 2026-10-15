import { test, expect, type Page } from '@playwright/test';

/**
 * /checkout renders two pieces of real business data with no length limit
 * enforced anywhere in the UI: the vendor's own business name (header row,
 * `flex items-center justify-between` with no `min-w-0`/`break-words` on the
 * name) and a product's title / selected option value (`CheckoutItem`'s
 * `dl`, a `flex` item itself with no `min-w-0`, whose `grid-cols-[max-
 * content_1fr]` template also left its `1fr` column unclamped -- a grid
 * track's default minimum is its content's max-content size unless given
 * `minmax(0, 1fr)`, the grid analog of a flex item's `min-width: auto`).
 *
 * Unlike the shipment-new Parcel-row defect (silently clipped by an
 * overflow-hidden Card), THIS one is not clipped at all: the page itself
 * grows wider than the viewport, a visible horizontal scrollbar on every
 * mandated width up to the point the content naturally fits. Measured
 * before the fix: document scrollWidth 743 vs clientWidth 320 at 320px.
 *
 * No real login, no live API: `/checkout` is gated only by the auth
 * cookie's PRESENCE (apps/web/middleware.ts), and every data call is
 * route-mocked below. Not local-only -- expected to run for real in CI.
 */

const WIDTHS = [320, 375, 768, 1024, 1440];

const LONG_WORD = 'A'.repeat(60);

function cartView() {
  return {
    id: 'cart-1',
    currency: 'BZD',
    itemCount: 1,
    distinctItemCount: 1,
    subtotalMinor: 5000,
    hasPriceChanges: false,
    hasUnavailableItems: false,
    vendors: [
      {
        vendorProfileId: 'vendor-1',
        slug: 'vendor-1',
        businessName: LONG_WORD,
        storeStatus: 'OPEN',
        subtotalMinor: 5000,
        itemCount: 1,
        items: [
          {
            id: 'line-1',
            productId: 'prod-1',
            variantId: null,
            title: 'Test product',
            slug: 'test-product',
            variantTitle: null,
            displayName: null,
            variantLabel: null,
            optionValues: [LONG_WORD],
            options: [{ name: 'Color', value: LONG_WORD }],
            sku: 'SKU1',
            imageUrl: null,
            currency: 'BZD',
            quantity: 1,
            unitPriceMinor: 5000,
            unitPriceMinorSnapshot: 5000,
            priceChanged: false,
            lineSubtotalMinor: 5000,
            available: 10,
            inStock: true,
            issues: [],
            purchasable: true,
          },
        ],
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}

async function openCheckout(page: Page) {
  await page.context().addCookies([
    { name: 'access_token', value: 'fake-for-layout-check', domain: 'localhost', path: '/' },
  ]);
  await page.route('**/api/cart', (r) => {
    if (r.request().method() !== 'GET') return r.continue();
    return r.fulfill({ json: cartView() });
  });
  await page.route('**/api/wallet', (r) => {
    if (r.request().method() !== 'GET') return r.continue();
    return r.fulfill({ json: { currency: 'BZD', availableMinor: 500000, onHoldMinor: 0, totalMinor: 500000, status: 'ACTIVE', exists: true } });
  });

  await page.goto('/checkout');
  await expect(page.getByText(LONG_WORD).first()).toBeVisible();
}

test.describe('checkout never overflows the page on a long vendor name or product option', () => {
  for (const width of WIDTHS) {
    test(`page stays inside the viewport at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openCheckout(page);

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      expect(
        scrollWidth,
        `page scrollWidth ${scrollWidth} vs clientWidth ${clientWidth} at ${width}px -- a long vendor name or option value should never widen the page`,
      ).toBeLessThanOrEqual(clientWidth + 1);
    });
  }
});
