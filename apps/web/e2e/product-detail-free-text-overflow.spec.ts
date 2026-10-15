import http from 'node:http';
import { test, expect, type Page } from '@playwright/test';

/**
 * `/products/[slug]` had never been swept. Four plain, non-flex, non-grid
 * elements render vendor/customer free text with no `break-words` -- the
 * fourth overflow mechanism already on record (#429/#430: a plain block
 * element with no `overflow-wrap`/`break-words` lets an unbreakable word
 * overflow ITS OWN box, no flex/grid item growing needed):
 *   - the `<h1>` product title (`title`, max 200 -- `packages/validation/
 *     src/marketplace.ts:400`)
 *   - the variant display's secondary/family lines (`displayName`, max 160)
 *   - the "Sold by {vendor}" paragraph (`businessName`, max 120)
 *   - the product description (`description`, max 8000)
 *
 * The description additionally needed the outer `grid gap-8 md:grid-cols-2`
 * given a base `grid-cols-1` -- confirmed by elimination on a calibration
 * page (neither fix alone moves document scrollWidth off 1888px at 320px;
 * both together give 320/320), same shape as #418's two-necessary-fixes
 * table: below the `md` breakpoint there is no explicit column template, and
 * the implicit single column still sized to the long word's max-content
 * width rather than the viewport.
 *
 * A fifth site, the page-level "Visit {vendor}" link (`app/products/[slug]/
 * page.tsx`), needed a different combination: it is `inline-flex` with the
 * dynamic text as a direct child, and neither `break-words` on the link nor
 * `min-w-0 break-words` on a wrapping `<span>` alone was enough (measured
 * identical to unfixed in both cases) -- only adding `max-w-full` on the
 * `inline-flex` element ITSELF, combined with `min-w-0 break-words` on the
 * `<span>` wrapping its text, closed it. An `inline-flex`/`inline-block`
 * element's own box is sized by shrink-to-fit against its max-content width,
 * not the containing block, so it never shrinks on its own; `max-w-full`
 * caps that box at the available width.
 *
 * This is a public page (no auth, no dashboard shell, so no ancestor
 * `overflow-x-hidden` -- document-level scrollWidth is the correct
 * instrument here, unlike a dashboard route). But `page.tsx`'s
 * `fetchProduct` runs through `serverGet` -- a server-side fetch Playwright's
 * `page.route()` cannot intercept -- so a tiny real HTTP server answers
 * `GET /api/marketplace/products/:slug` on `NEXT_PUBLIC_API_URL`; every
 * other call (reviews, related, saved, recently-viewed) 404s from the same
 * server and is swallowed by the existing graceful-failure handling in each
 * of those client components (RelatedProducts: "a failed fetch renders
 * nothing"; ReviewList: catches into its own error state) -- no mocking
 * needed for those.
 */

const WIDTHS = [320, 375, 768, 1024, 1440];
const LONG_WORD = (n: number, ch: string) => ch.repeat(n);

const SLUG = 'e2e-overflow-fixture';

function fixtureProduct() {
  return {
    id: 'prod-e2e-1',
    title: LONG_WORD(150, 'T'),
    slug: SLUG,
    brand: null,
    description: LONG_WORD(250, 'D'),
    priceMinor: 2599,
    salePriceMinor: null,
    currency: 'BZD',
    category: { name: 'Test category', slug: 'test-category' },
    vendor: { businessName: LONG_WORD(100, 'V'), slug: 'e2e-vendor' },
    weightGrams: null,
    dimensionsMm: { length: null, width: null, height: null },
    tags: [],
    images: [],
    availability: { inStock: true, outOfStock: false, available: null, unlimited: true, allowBackorders: false },
    options: [],
    variants: [],
  };
}

let server: http.Server;
let serverPort: number;

test.beforeAll(async () => {
  serverPort = Number(new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').port || 4000);
  server = http.createServer((req, res) => {
    if (req.url === `/api/marketplace/products/${SLUG}` && req.method === 'GET') {
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

async function openProduct(page: Page) {
  await page.goto(`/products/${SLUG}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

test.describe('/products/[slug] never overflows on vendor/customer free text', () => {
  for (const width of WIDTHS) {
    test(`the page stays inside the viewport at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1200 });
      await openProduct(page);

      const measured = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      expect(
        measured.scrollWidth,
        `document scrollWidth ${measured.scrollWidth} vs clientWidth ${measured.clientWidth} at ${width}px`,
      ).toBeLessThanOrEqual(measured.clientWidth + 1);
    });
  }

  test('the "Visit {vendor}" link stays inside the viewport at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 1200 });
    await openProduct(page);
    const link = page.getByRole('link', { name: /^Visit/ });
    await expect(link).toBeVisible();
    const box = await link.boundingBox();
    expect(box, 'the "Visit" link should have a measurable box').not.toBeNull();
    expect(box!.x + box!.width, 'the "Visit" link right edge at a 320px viewport').toBeLessThanOrEqual(321);
  });
});
