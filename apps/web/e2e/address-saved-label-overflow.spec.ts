import { test, expect, type Page } from '@playwright/test';

/**
 * AddressField's "saved to your address book" confirmation line
 * (`Saved in your address book as "{label}".`) sat directly inside a
 * `flex items-center` `<p>` as a RAW TEXT NODE alongside the star icon --
 * unlike an element, a raw text node that is a direct child of a flex
 * container still becomes an anonymous flex item with the same default
 * `min-width: auto` as any other flex item. `savedRow.label` is customer
 * free text (`z.string().min(1).max(60)`, packages/validation/src/
 * marketplace.ts) -- long enough to be one unbroken 60-char word, which
 * pinned the whole page wider than the viewport (not clipped -- the
 * document itself grows, same visible-scrollbar shape as #415, not #413's
 * silent clip).
 *
 * Exercised through /checkout (no real login, no live API, no server-side
 * /me call since /checkout sits outside the app/dashboard/* shell): fake
 * access_token cookie past the cookie-presence-only middleware gate, every
 * data call route-mocked.
 */

const WIDTHS = [320, 375, 768, 1024, 1440];
const LONG_LABEL = 'B'.repeat(60);

function cartView() {
  return {
    id: 'cart-1', currency: 'BZD', itemCount: 1, distinctItemCount: 1, subtotalMinor: 5000,
    hasPriceChanges: false, hasUnavailableItems: false,
    vendors: [{
      vendorProfileId: 'vendor-1', slug: 'vendor-1', businessName: 'Test Vendor', storeStatus: 'OPEN',
      subtotalMinor: 5000, itemCount: 1,
      items: [{
        id: 'line-1', productId: 'prod-1', variantId: null, title: 'Test product', slug: 'test-product',
        variantTitle: null, displayName: null, variantLabel: null, optionValues: [], options: [],
        sku: 'SKU1', imageUrl: null, currency: 'BZD', quantity: 1, unitPriceMinor: 5000,
        unitPriceMinorSnapshot: 5000, priceChanged: false, lineSubtotalMinor: 5000, available: 10,
        inStock: true, issues: [], purchasable: true,
      }],
    }],
    updatedAt: new Date().toISOString(),
  };
}

function savedAddresses() {
  return [{
    id: 'addr-1', label: LONG_LABEL, fullName: 'Test Customer', phone: '501-222-3333', email: null,
    company: null, addressLine1: '123 Test St', addressLine2: null, city: 'Belize City', district: 'BELIZE',
    instructions: null, latitude: 17.5, longitude: -88.2, isDefault: true,
  }];
}

async function openSavedAddressConfirmation(page: Page) {
  await page.context().addCookies([
    { name: 'access_token', value: 'fake-for-layout-check', domain: 'localhost', path: '/' },
  ]);
  await page.route('**/api/cart', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: cartView() }) : r.continue()));
  await page.route('**/api/wallet', (r) => r.fulfill({ json: { currency: 'BZD', availableMinor: 500000, onHoldMinor: 0, totalMinor: 500000, status: 'ACTIVE', exists: true } }));
  await page.route('**/api/addresses', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: savedAddresses() }) : r.continue()));

  await page.goto('/checkout');

  await page.locator('label', { hasText: 'Delivery' }).filter({ has: page.locator('input[type=radio]') }).first().click();

  const methodSelect = page.locator('select').filter({ has: page.locator('option', { hasText: 'Type the address' }) }).first();
  await methodSelect.selectOption('SAVED');

  const savedSelect = page.locator('select').filter({ has: page.locator('option', { hasText: LONG_LABEL }) }).first();
  await savedSelect.selectOption('addr-1');

  const savedRow = page.locator('p', { hasText: 'Saved in your address book' });
  await expect(savedRow).toBeVisible();
  return savedRow;
}

/**
 * MDF-906 (CI-BROWSER-SPECS-FAIL-INSTEAD-OF-SKIPPING): observed twice in CI,
 * both times at exactly 375px, never the other four widths -- `locator.click:
 * Test timeout exceeded` waiting on the Delivery radio label. The 60s
 * test.setTimeout() below did NOT prevent the second occurrence: it ran the
 * full 60 seconds before giving up, which is itself evidence against "give it
 * more time" as the fix. The trace artifact from that second run showed why:
 * across the whole 60 seconds every asset the page requested (document,
 * Next's client-bootstrap JS/CSS chunks, stylesheet, logo) came back HTTP
 * 200, there was no /api/cart request at all -- not pending, not failed,
 * never sent -- and a second, unrelated component (Header's own /me effect)
 * also never fired in the same frame. Zero console messages, zero page
 * errors; the screencast kept producing frames, so the renderer was alive,
 * but the DOM never changed between the first frame and the one Playwright
 * gave up on. Client-side JS execution did not get a turn for that tab for
 * most of a minute, in two unrelated components at once -- environmental,
 * not a defect in anything this page does, but the low-level cause (runner
 * CPU quota, a long renderer pause, something else tab-specific) is not
 * pinned from what the trace captured. The next three tests in the SAME
 * worker ran at roughly a second each, immediately after. `retries:
 * process.env.CI ? 1 : 0` in playwright.config.ts is the actual mitigation --
 * a stall that clears in three seconds and cannot be reproduced is exactly
 * what a single retry is for; the 60s raise stays because reverting it costs
 * a PR for nothing, not because it fixed this.
 */
test.describe('AddressField saved-address confirmation never widens the page on a long label', () => {
  for (const width of WIDTHS) {
    test(`page stays inside the viewport at ${width}px`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width, height: 900 });
      await openSavedAddressConfirmation(page);

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      console.log(`page scrollWidth ${scrollWidth} vs clientWidth ${clientWidth} at ${width}px -- a long saved-address label should never widen the page`);
      expect(
        scrollWidth,
        `page scrollWidth ${scrollWidth} vs clientWidth ${clientWidth} at ${width}px -- a long saved-address label should never widen the page`,
      ).toBeLessThanOrEqual(clientWidth + 1);
    });
  }
});
