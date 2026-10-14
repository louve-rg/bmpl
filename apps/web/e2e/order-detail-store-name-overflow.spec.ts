import { test, expect, type Page } from '@playwright/test';

/**
 * apps/web/app/orders/[id]/page.tsx: the vendor-order header's store-name
 * Link, same min-width:auto trap named in CLAUDE.md and already fixed at
 * three other sites on branch fix/web-long-title-grid-overflow (ProductCard,
 * JobCard, /vendors) -- this is the fourth, found on this file specifically
 * (god, conv-modules-2026-10-14) rather than by the parked layout sweep.
 *
 * MECHANISM, confirmed live step by step before fixing anything, same order
 * as the other three sites: neither fixed -> each alone -> both together.
 * This file has ONE MORE flex-item boundary than the others, though: the
 * Link sits inside its own `<div className="flex items-center gap-2">`
 * (grouping it with DeliveryBadge), which is ITSELF a flex item of the
 * outer `<header>`. min-w-0 + break-words on the Link alone (header
 * 618/286) and min-w-0 on that inner div alone with break-words on the Link
 * (inner div's own box correctly narrows to 254, but its CONTENT still
 * overflows it, scrollWidth 602) were both confirmed NOT sufficient on
 * their own -- every flex item along the chain between the text node and
 * the point something finally constrains its width needs its own min-w-0.
 * All three together (min-w-0 on the inner div, min-w-0 AND break-words on
 * the Link) is what actually returned the header to 286/286.
 *
 * This page requires a session (middleware.ts gates /orders/:path* on
 * cookie PRESENCE only, not validity -- real authorization is the API's
 * job on every request). A fake access_token cookie satisfies the
 * middleware; the actual order data is supplied by intercepting
 * GET /api/orders/:id, so no live API call, login flow or seeded database
 * is needed -- this can run in CI exactly like the public-page cases in
 * long-title-grid-item-overflow.spec.ts.
 *
 * MEASURED ON THE HEADER ELEMENT ITSELF, NOT document.documentElement --
 * caught live while writing this spec, not a precaution copied from
 * elsewhere: the ancestor Card carries `overflow-hidden` (apps/web/
 * components/ui.tsx, used so a long parcel description never blows out the
 * card's rounded corners), which silently clips the header's own overflow
 * before it can ever reach the page's scrollWidth -- confirmed by running
 * this exact spec against the UNFIXED markup first: document.documentElement
 * .scrollWidth stayed 320 (a false pass) while the header element's own
 * scrollWidth measured 618 against a clientWidth of 286. Same silent-clip
 * shape already on record for the dashboard/messages thread-pane card.
 */

const LONG_UNBROKEN_NAME =
  'SupercalifragilisticexpialidociousHardwareAndBuildingSupplyCompanyLtdxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

function mockOrder(businessName: string) {
  return {
    id: 'e2e-order-1',
    orderNumber: 'BML-ORD-0001',
    status: 'PENDING',
    currency: 'BZD',
    itemCount: 1,
    subtotalMinor: 1000,
    deliveryFeeMinor: 0,
    totalMinor: 1000,
    placedAt: new Date().toISOString(),
    deliveryAddress: null,
    vendorOrders: [
      {
        id: 'e2e-vo-1',
        orderNumber: 'BML-VO-0001',
        status: 'PENDING',
        deliveryMethod: 'PICKUP',
        customerNotes: null,
        currency: 'BZD',
        itemCount: 1,
        subtotalMinor: 1000,
        vendor: { businessName, slug: 'e2e-long-name-store' },
        items: [{ productTitle: 'A box', variantTitle: null, unitPriceMinor: 1000, quantity: 1, subtotalMinor: 1000, imageUrl: null }],
      },
    ],
  };
}

async function gotoOrderAsFakeSession(page: Page, businessName: string) {
  await page.context().addCookies([
    { name: 'access_token', value: 'e2e-fake-for-layout-check-only', domain: 'localhost', path: '/' },
  ]);
  await page.route('**/api/orders/e2e-order-1', (r) => r.fulfill({ json: mockOrder(businessName) }));
  await page.route('**/api/payments/for-order/**', (r) => r.fulfill({ status: 404, json: { status: 404, message: 'none' } }));
  await page.goto('/orders/e2e-order-1');
}

async function measureHeaderBox(page: Page, linkTextSnippet: string) {
  return page.evaluate((snippet) => {
    const link = Array.from(document.querySelectorAll('a')).find((a) => a.textContent?.includes(snippet));
    const header = link?.closest('header');
    return {
      found: Boolean(header),
      scrollWidth: header?.scrollWidth ?? -1,
      clientWidth: header?.clientWidth ?? -1,
    };
  }, linkTextSnippet);
}

test.describe('/orders/[id] store-name Link does not overflow its own header at 320px', () => {
  test('an unbroken long business name stays inside the header', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 1000 });
    await gotoOrderAsFakeSession(page, LONG_UNBROKEN_NAME);
    await expect(page.getByText('Supercalifragilistic', { exact: false })).toBeVisible();

    const box = await measureHeaderBox(page, 'Supercalifragilistic');
    expect(box.found, 'the vendor-order header should be found via the store-name Link').toBe(true);
    expect(box.scrollWidth, `header scrollWidth ${box.scrollWidth} vs clientWidth ${box.clientWidth} with an unbroken long business name`).toBeLessThanOrEqual(box.clientWidth + 1);
  });

  test('a normal multi-word business name is unaffected', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 1000 });
    await gotoOrderAsFakeSession(page, 'The Exceptionally Long Named Hardware And Building Supply Company Ltd');
    await expect(page.getByText('Exceptionally Long Named', { exact: false })).toBeVisible();

    const box = await measureHeaderBox(page, 'Exceptionally Long Named');
    expect(box.found, 'the vendor-order header should be found via the store-name Link').toBe(true);
    expect(box.scrollWidth, `header scrollWidth ${box.scrollWidth} vs clientWidth ${box.clientWidth} with a normal long business name`).toBeLessThanOrEqual(box.clientWidth + 1);
  });
});
