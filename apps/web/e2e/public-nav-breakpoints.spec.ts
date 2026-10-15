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

/**
 * MDF-279 diagnostic, temporary: a CI-only "scrollWidth 331 vs clientWidth
 * 320" at the 320px width below reproduces on NO environment this floor
 * could construct (real local backend, backend genuinely unreachable at
 * CI's own API port, a forced different font, a real Linux container, and
 * the literal CI-captured DOM re-measured from its own trace) -- yet it is
 * route-selective within the SAME CI run: `/` and `/products` (both fetch
 * data) fail, `/register` and `/login` (static forms) pass. Logged for
 * every route in this 320px block, not just the failing ones, so the
 * passing routes serve as a same-run baseline to diff against -- this is
 * the question CI's own log needs to answer directly rather than guessed
 * at again from outside. Remove once MDF-279 is resolved.
 */
async function logOverflowDiagnostic(page: Page, route: string, scrollWidth: number, clientWidth: number) {
  const widest = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    let best: { tag: string; cls: string; rectWidth: number; computedWidth: string; offsetParent: string; fontFamily: string } | null =
      null;
    document.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!best || r.width > best.rectWidth) {
        const cs = getComputedStyle(el);
        best = {
          tag: el.tagName,
          cls: (el.className || '').toString().slice(0, 200),
          rectWidth: Math.round(r.width * 10) / 10,
          computedWidth: cs.width,
          offsetParent: (el as HTMLElement).offsetParent ? (el as HTMLElement).offsetParent!.tagName : 'null',
          fontFamily: cs.fontFamily,
        };
      }
    });
    // Also the widest element whose own right edge actually clears the
    // viewport, separate from "widest by width" -- a short, far-right-offset
    // element could overflow without being the single widest box on the page.
    const pastViewport: Array<{ tag: string; cls: string; right: number }> = [];
    document.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 0.5 && r.width > 0) {
        pastViewport.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 120), right: Math.round(r.right * 10) / 10 });
      }
    });
    pastViewport.sort((a, b) => b.right - a.right);

    // getComputedStyle().fontFamily only ever reports the AUTHORED CSS stack
    // ("Inter, system-ui, ...Segoe UI, Roboto, sans-serif") -- 'Inter' is
    // declared in globals.css but never actually loaded anywhere (no
    // @font-face, no next/font, no Google Fonts link), so every platform's
    // browser silently falls through to whichever real font its OS resolves
    // for `system-ui`/`sans-serif`, and getComputedStyle cannot name that.
    // Canvas measureText(), run with that same declared stack, DOES reflect
    // whatever font the browser actually substituted -- a comparable,
    // OS-dependent NUMBER instead of an unchanging string, which is the
    // thing that would actually explain a cross-environment width delta.
    const probeText = 'Belize Marketplace And Logistics 0123456789';
    const bodyFont = getComputedStyle(document.body).fontFamily;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    let fontProbe: { declaredStack: string; measuredWidthPx: number | null } = { declaredStack: bodyFont, measuredWidthPx: null };
    if (ctx) {
      ctx.font = `700 16px ${bodyFont}`;
      fontProbe = { declaredStack: bodyFont, measuredWidthPx: Math.round(ctx.measureText(probeText).width * 100) / 100 };
    }

    return { widest: best, pastViewport: pastViewport.slice(0, 5), fontProbe };
  });
  // eslint-disable-next-line no-console
  console.log(
    `[MDF-279 diagnostic] route=${route} scrollWidth=${scrollWidth} clientWidth=${clientWidth} widest=${JSON.stringify(
      widest.widest,
    )} pastViewport=${JSON.stringify(widest.pastViewport)} fontProbe=${JSON.stringify(widest.fontProbe)}`,
  );
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

/**
 * 320px is narrower than any width the owner-named WIDTHS set above covers
 * (375 is the narrowest), but it's the exact width this landing-page defect
 * was measured at (god/Jim, 2026-10-11): the Services bento grid's two outer
 * `grid ... lg:grid-cols-12` containers had no grid-template-columns at all
 * below `lg`, so the browser's default single implicit column sized itself
 * to the MarketplaceCard's content instead of the viewport -- scrollWidth
 * 340 against clientWidth 320. Fix: an explicit `grid-cols-1` at the base
 * breakpoint, matching every other grid in this file, which Tailwind
 * compiles to `repeat(1, minmax(0, 1fr))` and so clamps the track to the
 * container regardless of content width. A separate describe block (not
 * added to WIDTHS) so it doesn't change what width the owner-named sweep
 * above asserts for every route -- but it loops over the SAME ROUTES list
 * that sweep uses, so 320px gets the same route coverage as every other
 * width rather than checking only the one route this defect happened to be
 * found on.
 */
test.describe('no page scrolls sideways at 320px either', () => {
  for (const route of ROUTES) {
    test(`${route} at 320px has no horizontal overflow`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 900 });
      await page.goto(route);
      const { scrollWidth, clientWidth } = await noHorizontalOverflow(page);
      await logOverflowDiagnostic(page, route, scrollWidth, clientWidth);
      expect(scrollWidth, `scrollWidth ${scrollWidth} vs clientWidth ${clientWidth} at 320px on ${route}`).toBeLessThanOrEqual(clientWidth + 1);
    });
  }
});
