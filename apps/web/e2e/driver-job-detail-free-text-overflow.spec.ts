import http from 'node:http';
import { test, expect, type Page } from '@playwright/test';

/**
 * `/dashboard/driver/jobs/[id]` had never been swept. Confirms two things:
 *
 * 1. The shared `PageHeader` component (`components/ui.tsx`), used across
 *    most dashboard pages, overflows on a long free-text `description` --
 *    this page passes `job.vendor.businessName` (max 120,
 *    `packages/validation/src/marketplace.ts:124`) there. `PageHeader`'s
 *    wrapping div is `flex flex-col gap-3 sm:flex-row ...`: a `flex-col`
 *    below `sm` (640px) stretches cross-axis width by default, so the
 *    overflow there is the plain fourth-mechanism kind (no `break-words` on
 *    the `<h1>`/`<p>`); but at `sm` and above it becomes a flex ROW, making
 *    the title/description `<div>` a genuine flex item needing its own
 *    `min-w-0` (the #410 chain). Confirmed by elimination on a calibration
 *    page: unfixed overflows at 320/375 (plain-block) AND at 640/768/1024
 *    (flex-item chain); `break-words` alone fixes only the first range,
 *    `min-w-0` alone fixes only the second, both together fix every width.
 * 2. Several page-local sites render customer/vendor/driver free text in
 *    plain blocks with no `break-words`: delivery instructions (customer,
 *    max 1000), the store's pickup instructions (max 500), the delivery
 *    address (customer, `fullName` max 160/`addressLine*` max 200), the
 *    vehicle's make/model/color (driver, max 80 each, in a flex row needing
 *    `min-w-0` on the text span too), the order item's product title
 *    (vendor, max 200), and the recipient name on a completed delivery
 *    (customer, `recipientName` max 160).
 *
 * `/dashboard/*` sits under a layout whose own server-side `serverGet('/me')`
 * `page.route()` cannot intercept, so a tiny real HTTP server answers both
 * that SSR call and the page's own `GET /api/driver/jobs/:id` client call on
 * `NEXT_PUBLIC_API_URL` -- simpler than route-mocking since both are GETs
 * with no auth decision this spec cares about. `overflow-x-hidden` is on the
 * dashboard shell (`app/dashboard/layout.tsx`), so document-level
 * `scrollWidth` would stay clean even on a real defect here -- this spec
 * measures the `PageHeader`'s own title/description wrapper directly, which
 * is the correct instrument for a route under that shell.
 */

const WIDTHS = [320, 375, 640, 768, 1024, 1440];
const JOB_ID = 'e2e-job-1';
const LONG = (n: number, ch: string) => ch.repeat(n);

function fixtureMe() {
  return {
    id: 'driver-1',
    email: 'driver@example.bz',
    firstName: 'E2E',
    lastName: 'Driver',
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
    activeRole: 'DELIVERY_DRIVER',
    roles: [{ roleCode: 'DELIVERY_DRIVER', label: 'Delivery driver', status: 'APPROVED', isSelectable: true }],
  };
}

function fixtureJob() {
  return {
    id: JOB_ID,
    status: 'DRIVER_ACCEPTED',
    statusLabel: 'Accepted',
    orderNumber: '10234',
    vendor: { businessName: LONG(100, 'V') },
    feeMinor: 500,
    estimate: null,
    instructions: LONG(120, 'I'),
    deliveryAddress: {
      fullName: LONG(90, 'N'),
      phone: null,
      addressLine1: LONG(100, 'A'),
      addressLine2: null,
      city: 'Belize City',
      district: 'BELIZE',
    },
    addressUnlocked: true,
    pinnedLocation: null,
    navigationUrl: null,
    deliveryInstructions: LONG(120, 'D'),
    isTest: false,
    pickupLocation: null,
    items: [{ productTitle: LONG(100, 'P'), variantTitle: null, quantity: 1 }],
    vehicle: { type: 'Car', make: LONG(60, 'M'), model: LONG(60, 'O'), color: LONG(40, 'C'), licencePlate: 'ABC-123' },
    requiresPickupPin: false,
    requiresDeliveryPin: true,
    recipientName: null,
    podPhotoUrls: [],
    timeline: [],
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
    if (req.url === `/api/driver/jobs/${JOB_ID}` && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(fixtureJob()));
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

async function openJob(page: Page) {
  await page.context().addCookies([
    { name: 'access_token', value: 'fake-for-layout-check', domain: 'localhost', path: '/' },
  ]);
  await page.goto(`/dashboard/driver/jobs/${JOB_ID}`);
  await expect(page.getByRole('heading', { name: /Order #10234/ })).toBeVisible();
}

test.describe('/dashboard/driver/jobs/[id] never overflows on free text', () => {
  for (const width of WIDTHS) {
    test(`the PageHeader title/description row stays inside the viewport at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1200 });
      await openJob(page);

      const header = page.locator('h1', { hasText: 'Order #10234' }).locator('..');
      const measured = await header.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));

      expect(
        measured.scrollWidth,
        `PageHeader title/description wrapper scrollWidth ${measured.scrollWidth} vs clientWidth ${measured.clientWidth} at ${width}px`,
      ).toBeLessThanOrEqual(measured.clientWidth + 1);
    });
  }

  test('the page-local free-text sites stay inside the viewport at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 1600 });
    await openJob(page);

    const main = page.locator('main');
    const measured = await main.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));

    expect(
      measured.scrollWidth,
      `dashboard main scrollWidth ${measured.scrollWidth} vs clientWidth ${measured.clientWidth} at 320px`,
    ).toBeLessThanOrEqual(measured.clientWidth + 1);
  });
});
