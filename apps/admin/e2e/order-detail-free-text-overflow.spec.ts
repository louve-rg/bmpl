import { test, expect, type Page } from '@playwright/test';

/**
 * A FOURTH overflow mechanism on `/dashboard/orders/[id]`, distinct from the
 * three already on record (the flex-item min-width:auto chain #410/#413/
 * #415/#418/#419/#420, the grid-track `minmax(0,1fr)` rule #415, and the
 * `<fieldset>` UA min-width quirk #418): a plain, non-flex, non-grid `<p>`
 * with no `overflow-wrap`/`break-words` still lets an unbreakable word
 * overflow ITS OWN box -- no flex/grid item growing is needed. Confirmed
 * with a minimal calibration page (a bare `<div role="alert">` with no flex
 * ancestor, one 200-char unbroken word): docScrollWidth 2324 vs
 * docClientWidth 320 at a 320px viewport, zero flex/grid in the chain.
 *
 * Four sites on this page hit it, all inside the vendor card's
 * `overflow-hidden` box (so, like #413/#420, this is silently clipped --
 * the document and even the card's own getBoundingClientRect() stay inside
 * the viewport; only the card's scrollWidth vs clientWidth shows it):
 *   - `vo.customerNotes` (customer free text)
 *   - `vo.delivery.instructions` (customer free text)
 *   - `vo.originLocation.label` (vendor-typed location label, max 120)
 *   - `order.deliveryAddress.fullName` (customer free text, in a separate
 *     Card with no overflow-hidden of its own -- clipped one level further
 *     out, by the dashboard shell's own `overflow-x-hidden`, same as
 *     order-detail-header-overflow.spec.ts's header-row case)
 *
 * [LOCAL ONLY] Same dashboard-shell `/me` SSR precondition as
 * order-detail-header-overflow.spec.ts -- see that file's header for detail.
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
    customer: { name: 'Customer', email: 'customer@example.com' },
    deliveryAddress: {
      fullName: `Recipient ${LONG_WORD}`,
      phone: '+501 600 0000',
      addressLine1: '12 Front Street',
      addressLine2: null,
      city: 'Belize City',
      district: 'BELIZE',
      country: 'Belize',
    },
    vendorOrders: [
      {
        id: 'vo-1',
        orderNumber: 'VO-0001',
        status: 'ACCEPTED',
        deliveryMethod: 'DELIVERY',
        delivery: {
          status: 'PENDING',
          feeMinor: 500,
          freeApplied: false,
          estimate: { minHours: 1, maxHours: 2, label: null },
          instructions: `Leave at the back ${LONG_WORD}`,
        },
        customerNotes: `Please call first ${LONG_WORD}`,
        itemCount: 1,
        subtotalMinor: 5000,
        vendor: { businessName: 'Acme Store' },
        items: [{ productTitle: 'Widget', variantTitle: null, sku: 'W-1', unitPriceMinor: 5000, quantity: 1, subtotalMinor: 5000 }],
        originLocation: { id: 'loc-1', label: `Main Branch ${LONG_WORD}` },
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

test.describe('[LOCAL ONLY, skips without a /me responder -- see file header] order detail free-text elements never overflow their own box', () => {
  for (const width of WIDTHS) {
    test(`notes, instructions, origin label and delivery-address name all stay inside their own box at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1200 });
      const ready = await openOrderDetail(page);
      test.skip(!ready, 'Needs a local responder for the dashboard-shell /me SSR call -- see file header.');

      const measured = await page.evaluate(() => {
        const pick = (el: Element | null | undefined) => (el ? { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth } : null);
        const notesP = Array.from(document.querySelectorAll('p')).find((p) => p.textContent?.startsWith('Notes:'));
        const instrP = Array.from(document.querySelectorAll('p')).find((p) => p.textContent?.includes('Instructions:'));
        const originP = Array.from(document.querySelectorAll('p')).find((p) => p.textContent?.startsWith('Fulfilled from'));
        const addrP = Array.from(document.querySelectorAll('p')).find((p) => p.textContent?.includes('Recipient'));
        return { notesP: pick(notesP), instrP: pick(instrP), originP: pick(originP), addrP: pick(addrP) };
      });

      for (const [name, m] of Object.entries(measured)) {
        expect(m, `${name} element not found`).not.toBeNull();
        expect(m!.scrollWidth, `${name} scrollWidth ${m!.scrollWidth} vs its own clientWidth ${m!.clientWidth} at ${width}px`).toBeLessThanOrEqual(
          m!.clientWidth + 1,
        );
      }
    });
  }
});
