import { test, expect, type Page } from '@playwright/test';

/**
 * Independent responsive geometry audit of the public header/footer shell
 * (MDF-128 follow-up), at the five widths the owner named: 375, 414, 768,
 * 1024, 1440. Real-browser measurements only — `document.documentElement`
 * geometry and `boundingBox()` — never a render-only assertion, per the
 * owner's explicit bar ("do not rely on tests that merely confirm
 * components render").
 *
 * `/` is server-rendered static marketing content and needs no API;
 * `/products`, `/register`, `/login` likewise render their shell without a
 * live backend (confirmed empirically: a transient third-party dev server
 * on the conventional API port produced two false reds here before this
 * file existed — see the MDF-128 report for the port-collision finding).
 */

const WIDTHS = [375, 414, 768, 1024, 1440];
const ROUTES = ['/', '/products', '/register', '/login'];
const MIN_HIT_PX = 44;

async function noHorizontalOverflow(page: Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

test.describe('no page ever scrolls sideways, at any required breakpoint', () => {
  for (const width of WIDTHS) {
    for (const route of ROUTES) {
      test(`${route} at ${width}px has no horizontal overflow`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(route);
        const { scrollWidth, clientWidth } = await noHorizontalOverflow(page);
        // +1px tolerance for sub-pixel rounding in real layout, not a loosened check.
        expect(scrollWidth, `scrollWidth ${scrollWidth} vs clientWidth ${clientWidth} at ${width}px on ${route}`).toBeLessThanOrEqual(
          clientWidth + 1,
        );
      });
    }
  }
});

test.describe('primary header controls meet the 44px hit-area floor, measured from real layout', () => {
  test('the mobile toggle is at least 44x44 at every narrow width', async ({ page }) => {
    for (const width of [375, 414, 768]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');
      const box = await page.getByRole('button', { name: 'Toggle menu' }).boundingBox();
      expect(box, `no bounding box for the toggle at ${width}px`).not.toBeNull();
      expect(box!.width, `toggle width at ${width}px`).toBeGreaterThanOrEqual(MIN_HIT_PX);
      expect(box!.height, `toggle height at ${width}px`).toBeGreaterThanOrEqual(MIN_HIT_PX);
    }
  });

  test('Cart and Wishlist icons are at least 44x44 at every narrow width', async ({ page }) => {
    for (const width of [375, 414, 768]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');
      for (const name of ['Cart', 'Wishlist']) {
        const box = await page.getByRole('link', { name }).boundingBox();
        expect(box, `no bounding box for ${name} at ${width}px`).not.toBeNull();
        expect(box!.width, `${name} width at ${width}px`).toBeGreaterThanOrEqual(MIN_HIT_PX);
        expect(box!.height, `${name} height at ${width}px`).toBeGreaterThanOrEqual(MIN_HIT_PX);
      }
    }
  });

  test('each desktop nav group summary is at least 44px tall at 1024 and 1440', async ({ page }) => {
    for (const width of [1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const summaries = page.locator('nav[aria-label="Primary"] details > summary');
      const count = await summaries.count();
      expect(count, `no desktop nav groups found at ${width}px`).toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        const box = await summaries.nth(i).boundingBox();
        expect(box, `no bounding box for group ${i} at ${width}px`).not.toBeNull();
        expect(box!.height, `group ${i} summary height at ${width}px`).toBeGreaterThanOrEqual(MIN_HIT_PX);
      }
    }
  });
});
