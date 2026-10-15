import http from 'node:http';
import { test, expect, type Page } from '@playwright/test';

/**
 * `apps/web/app/dashboard/orders/[id]/page.tsx` (the VENDOR's own order
 * detail -- distinct from the admin order-detail page already fixed in
 * #427/#429) had never been swept for this. Same fourth-mechanism shape
 * (#429/#430): four plain, non-flex, non-grid `<p>` elements render
 * customer free text with no `break-words`:
 *   - `vo.customerName` (first + last name, registration free text)
 *   - `vo.customerNotes` (max 1000, packages/validation/src/marketplace.ts:577)
 *   - `vo.deliveryAddress.fullName`/address lines (customer free text)
 *   - `vo.delivery.instructions` (customer free text)
 *
 * `/dashboard/*` sits under the layout's server-side `serverGet('/me')`,
 * which `page.route()` cannot intercept -- a tiny real HTTP server answers
 * that one SSR call; the page's own order fetch (`GET /vendor/orders/:id`)
 * is a client-side call and stays mocked the normal way via `page.route()`.
 * `overflow-x-hidden` is on the dashboard shell, so this measures the
 * individual `Card` elements directly, not the document.
 */

const WIDTHS = [320, 375, 768, 1024, 1440];
const ORDER_ID = 'e2e-vendor-order-1';
const LONG = (n: number, ch: string) => ch.repeat(n);

function fixtureMe() {
  return {
    id: 'vendor-user-1',
    email: 'vendor@example.bz',
    firstName: 'E2E',
    lastName: 'Vendor',
    phone: null,
    district: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    avatarUrl: null,
    avatarStatus: 'NONE',
    avatarPendingUrl: null,
    avatarRejectedReason: null,
    avatarRequired: false,
    status: 'ACTIVE',
    emailVerified: true,
    activeRole: 'VENDOR',
    roles: [{ roleCode: 'VENDOR', label: 'Vendor', status: 'APPROVED', isSelectable: true }],
  };
}

function fixtureOrder() {
  return {
    id: ORDER_ID,
    orderNumber: 'ORD-10234',
    status: 'PENDING',
    deliveryMethod: 'DELIVERY',
    customerNotes: LONG(120, 'N'),
    currency: 'BZD',
    itemCount: 1,
    subtotalMinor: 2599,
    vendor: { businessName: 'Test Vendor', slug: 'test-vendor' },
    items: [{ productTitle: 'Widget', variantTitle: null, sku: 'SKU-1', unitPriceMinor: 2599, quantity: 1, subtotalMinor: 2599, currency: 'BZD', productId: null, imageUrl: null }],
    delivery: {
      status: 'PENDING',
      feeMinor: 500,
      freeApplied: false,
      estimate: null,
      instructions: LONG(120, 'I'),
    },
    parentOrderNumber: 'ORD-10234',
    placedAt: new Date().toISOString(),
    customerName: `${LONG(80, 'F')} ${LONG(80, 'L')}`,
    deliveryAddress: {
      fullName: LONG(90, 'D'),
      phone: null,
      addressLine1: LONG(100, 'A'),
      addressLine2: null,
      city: 'Belize City',
      district: 'BELIZE',
      country: 'Belize',
    },
    pickedUpAt: null,
  };
}

let server: http.Server;
let serverPort: number;

test.beforeAll(async () => {
  serverPort = Number(new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').port || 4000);
  server = http.createServer((req, res) => {
    if (req.url === '/api/me' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(fixtureMe()));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'not found' }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(serverPort, '127.0.0.1', () => resolve());
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function openOrder(page: Page) {
  await page.context().addCookies([
    { name: 'access_token', value: 'fake-for-layout-check', domain: 'localhost', path: '/' },
  ]);
  await page.route(`**/api/vendor/orders/${ORDER_ID}`, (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: fixtureOrder() }) : r.continue(),
  );
  await page.goto(`/dashboard/orders/${ORDER_ID}`);
  await expect(page.getByRole('heading', { name: 'ORD-10234' })).toBeVisible();
}

test.describe('/dashboard/orders/[id] (vendor) never overflows on customer free text', () => {
  for (const width of WIDTHS) {
    test(`the Customer and Deliver-to cards stay inside their own box at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1200 });
      await openOrder(page);

      const cards = page.locator('.bmpl-card');
      const count = await cards.count();
      for (let i = 0; i < count; i++) {
        const measured = await cards.nth(i).evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
        expect(
          measured.scrollWidth,
          `card #${i} scrollWidth ${measured.scrollWidth} vs clientWidth ${measured.clientWidth} at ${width}px`,
        ).toBeLessThanOrEqual(measured.clientWidth + 1);
      }
    });
  }
});
