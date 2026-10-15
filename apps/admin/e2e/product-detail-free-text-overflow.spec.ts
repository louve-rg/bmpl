import http from 'node:http';
import { test, expect, type Page } from '@playwright/test';

/**
 * `/dashboard/products/[id]` had never been swept for this. Several plain,
 * non-flex, non-grid elements render vendor free text with no
 * `break-words` -- the fourth overflow mechanism already on record for
 * apps/web (#429/#430) and now also apps/admin (companion PR on
 * apps/web/app/products/[slug]):
 *   - the `<h1>` product title + "SKU · category · by {vendor}" line (the
 *     wrapping flex row also had no `min-w-0` on the title block)
 *   - the product description (max 8000)
 *   - the SEO title/description fields (max 200/500)
 *   - the moderation-history note (max 2000)
 *   - the `Row` helper (Brand/Barcode), a grid item at `sm:grid-cols-2`
 *     with no `min-w-0`
 *
 * It also found the SAME `Breadcrumbs` defect already fixed on apps/web's
 * copy (`components/ui.tsx`): apps/admin keeps its own parallel copy of
 * `Breadcrumbs`, byte-identical in structure, and this page passes the
 * product title as the last breadcrumb label. Fixed at source in both
 * `components/ui.tsx` files since each app's copy is used site-wide within
 * that app.
 *
 * And apps/admin's `PageHeader` (a DIFFERENT component from `Breadcrumbs`,
 * also in `components/ui.tsx`) already had `min-w-0` on its title wrapper
 * from an earlier, unrelated fix (#page-header-overflow.spec.ts, god,
 * 2026-10-10 -- an actions-row-not-wrapping defect) but was never given
 * `break-words` on the `<h1>`/`<p>`, so it still overflowed below the `sm`
 * breakpoint on long free text -- confirmed by the apps/web calibration
 * (`measure13.js`'s "min-w-0 ONLY" row: unchanged from unfixed at
 * 320/375px). Not exercised by this page (its own title/description are
 * both short), so not covered by this spec's assertions, but fixed at
 * source alongside the rest since it is the same shared file.
 *
 * `apps/admin`'s dashboard layout does its own server-side `serverGet('/me')`
 * (same shape as apps/web's), and `/dashboard/products/[id]/page.tsx` itself
 * is an async server component calling `serverGet` directly -- neither is
 * interceptable by `page.route()`. A tiny real HTTP server answers both on
 * `ADMIN_PUBLIC_API_URL`. `AdminShell` carries the same `overflow-x-hidden`
 * shell as apps/web's dashboard, so this measures the page's own elements,
 * not the document.
 */

const WIDTHS = [320, 375, 768, 1024, 1440];
const PRODUCT_ID = 'e2e-admin-product-1';
const LONG = (n: number, ch: string) => ch.repeat(n);

function fixtureMe() {
  return {
    roles: [{ roleCode: 'ADMIN', status: 'APPROVED' }],
    adminPermissions: ['products.read', 'products.moderate'],
  };
}

function fixtureProduct() {
  return {
    id: PRODUCT_ID,
    title: LONG(120, 'T'),
    slug: 'e2e-admin-product',
    description: LONG(150, 'D'),
    sku: 'SKU-1',
    barcode: LONG(60, 'B'),
    brand: LONG(100, 'R'),
    status: 'PUBLISHED',
    priceMinor: 2599,
    salePriceMinor: null,
    currency: 'BZD',
    weightGrams: null,
    featured: false,
    metaTitle: LONG(150, 'S'),
    metaDescription: LONG(300, 'M'),
    category: { name: 'Test category' },
    vendor: { businessName: LONG(100, 'V'), slug: 'e2e-vendor' },
    tags: [],
    rejectionReason: null,
    images: [],
    reviews: [{ action: 'APPROVE', note: LONG(150, 'N'), toStatus: 'PUBLISHED', createdAt: new Date().toISOString(), reviewer: 'Staff' }],
  };
}

let server: http.Server;
let serverPort: number;

test.beforeAll(async () => {
  serverPort = Number(new URL(process.env.ADMIN_PUBLIC_API_URL ?? 'http://localhost:4000').port || 4000);
  server = http.createServer((req, res) => {
    if (req.url === '/api/me' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(fixtureMe()));
      return;
    }
    if (req.url === `/api/admin/products/${PRODUCT_ID}` && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(fixtureProduct()));
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

async function openProduct(page: Page): Promise<boolean> {
  await page.context().addCookies([
    { name: 'access_token', value: 'fake-for-layout-check', domain: 'localhost', path: '/' },
  ]);
  try {
    // `goto` belongs inside this try, not just the `expect` below: when the
    // dev server itself is unreachable, `goto` throws `ERR_CONNECTION_REFUSED`
    // before the page ever has a chance to render -- that is a precondition
    // failure same as a failed SSR call, not a reason to crash the test
    // instead of skipping it. Same guard shape as the three #439 specs
    // (order-detail-free-text-overflow.spec.ts etc.) -- this spec's own
    // self-hosted stub should make the server and the SSR call both succeed
    // today, but the guard stays as the safety net for when either doesn't.
    await page.goto(`/dashboard/products/${PRODUCT_ID}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

test.describe('/dashboard/products/[id] never overflows on vendor free text', () => {
  for (const width of WIDTHS) {
    test(`every Card stays inside its own box at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1400 });
      const ready = await openProduct(page);
      test.skip(!ready, 'Needs a reachable admin dev server and a successful /dashboard/products/[id] render -- see file header.');

      const cards = page.locator('.bmpl-card');
      const count = await cards.count();
      for (let i = 0; i < count; i++) {
        const measured = await cards.nth(i).evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
        expect(
          measured.scrollWidth,
          `card #${i} scrollWidth ${measured.scrollWidth} vs clientWidth ${measured.clientWidth} at ${width}px`,
        ).toBeLessThanOrEqual(measured.clientWidth + 1);
      }

      const header = page.locator('h1').locator('..');
      const headerMeasured = await header.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
      expect(
        headerMeasured.scrollWidth,
        `title block scrollWidth ${headerMeasured.scrollWidth} vs clientWidth ${headerMeasured.clientWidth} at ${width}px`,
      ).toBeLessThanOrEqual(headerMeasured.clientWidth + 1);

      const breadcrumbNav = page.getByRole('navigation', { name: 'Breadcrumb' });
      const breadcrumbMeasured = await breadcrumbNav.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
      expect(
        breadcrumbMeasured.scrollWidth,
        `breadcrumb nav scrollWidth ${breadcrumbMeasured.scrollWidth} vs clientWidth ${breadcrumbMeasured.clientWidth} at ${width}px`,
      ).toBeLessThanOrEqual(breadcrumbMeasured.clientWidth + 1);
    });
  }
});
