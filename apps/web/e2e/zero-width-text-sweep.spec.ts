import { test, expect } from '@playwright/test';
import { zeroWidthTextFindings } from './support/geometry';

/**
 * A third responsive-defect detector (see support/geometry.ts for the full
 * mechanism and why it needs BOTH a boundingBox() and a Range() check,
 * neither alone). Dispatched after an independent sweep of the public pages
 * with only the first two detectors (horizontal overflow, viewport clipping)
 * came back clean at 768px on `/`, while a sibling agent found -- and
 * confirmed live on production -- that the Platform Wallet card's
 * transaction labels render at literally zero width there. Neither existing
 * detector can see that shape by construction: nothing scrolls past the
 * viewport, and nothing's edge sits outside 0..width. The defect is a
 * `min-w-0` flex child's OWN box collapsing to zero while it holds real,
 * non-empty text.
 *
 * FIRST GROUP proves the detector itself is sensitive, against the known
 * live defect, independent of this file's own existence -- the equivalent
 * of a negative control run against a known-bad fixture rather than a
 * mutation. Fix is open as PR #349 (fix/bento-card-tablet-breakpoint,
 * not merged at the time this file was written). Three widths, matching
 * the dispatch's own negative-control requirement: RED at 768 (inside the
 * sm-to-lg breakpoint gap the bug lives in), clean at 639 (below `sm`, the
 * card is still stacked) and 1024 (the grid has widened the card by then).
 * reproduced the exact same two labels Oscar found on production
 * ("Payment to vendor", "Wallet top-up") plus their date lines, which
 * collapse by the identical mechanism and were not separately named.
 *
 * ONCE #349 MERGES, the first test below will go red (findings will drop
 * to zero) -- that is the signal to flip it from "reproduces the known
 * defect" to a plain "stays clean", not a regression in this file.
 *
 * SECOND GROUP is the actual regression guard: a sweep for this entire
 * bug CLASS across every other route and width this floor has already
 * audited for the other two detectors, so a future `min-w-0`/`shrink-0`
 * collapse anywhere else gets caught the same way. `/` itself is
 * deliberately excluded from this group (it is the subject of the first
 * group, and conflating "the known, tracked defect" with "an unexpected
 * new one" in the same assertion would hide a second regression behind
 * the first).
 */

test.describe('zero-width text detector proves itself against the known live defect (PR #349)', () => {
  test('/ at 768px: the Platform Wallet transaction labels collapse to zero width', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1400 });
    await page.goto('/');
    const findings = await zeroWidthTextFindings(page);
    const texts = findings.map((f) => f.text);
    expect(texts, 'zero-width findings at 768px on /').toEqual(
      expect.arrayContaining(['Payment to vendor', 'Wallet top-up']),
    );
  });

  test('/ at 639px: the same labels are visible (column layout, below the sm breakpoint)', async ({ page }) => {
    await page.setViewportSize({ width: 639, height: 1400 });
    await page.goto('/');
    const findings = await zeroWidthTextFindings(page);
    const texts = findings.map((f) => f.text);
    expect(texts, 'zero-width findings at 639px on /').not.toEqual(
      expect.arrayContaining(['Payment to vendor', 'Wallet top-up']),
    );
  });

  test('/ at 1024px: the same labels are visible again (the grid has widened the card)', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 1400 });
    await page.goto('/');
    const findings = await zeroWidthTextFindings(page);
    const texts = findings.map((f) => f.text);
    expect(texts, 'zero-width findings at 1024px on /').not.toEqual(
      expect.arrayContaining(['Payment to vendor', 'Wallet top-up']),
    );
  });
});

const WIDTHS = [375, 414, 639, 768, 1024, 1440];
const SIGNED_OUT_ROUTES = ['/products', '/register', '/login'];

test.describe('no zero-width text collapse anywhere else audited (public routes)', () => {
  for (const route of SIGNED_OUT_ROUTES) {
    for (const width of WIDTHS) {
      test(`${route} at ${width}px has no zero-width text`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1600 });
        await page.goto(route);
        const findings = await zeroWidthTextFindings(page);
        expect(findings, `zero-width findings at ${width}px on ${route}: ${JSON.stringify(findings)}`).toEqual([]);
      });
    }
  }
});
