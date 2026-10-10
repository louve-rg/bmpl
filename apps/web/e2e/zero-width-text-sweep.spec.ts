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
 * viewport, and nothing's edge sits outside 0..width. The defect was a
 * `min-w-0` flex child's OWN box collapsing to zero while it holds real,
 * non-empty text.
 *
 * FIRST GROUP is the regression guard for that fixed defect. Fix shipped as
 * PR #349 (cc2e941, on main) and is now holding in production -- these three
 * widths assert the Platform Wallet transaction labels ("Payment to vendor",
 * "Wallet top-up") stay non-zero-width at 768px (inside the sm-to-lg
 * breakpoint gap the bug lived in), 639px (below `sm`, the card is still
 * stacked) and 1024px (the grid has widened the card by then). Before #349
 * merged, this group instead proved the detector was sensitive against the
 * live defect (768px asserted the collapse); once the fix landed, that
 * negative-control assertion became a false-red on main, so it was flipped
 * to a plain cleanliness check -- the detector itself is still exercised by
 * the second group below.
 *
 * SECOND GROUP is the regression guard for the bug CLASS: a sweep across
 * every other route and width this floor has already audited for the other
 * two detectors, so a future `min-w-0`/`shrink-0` collapse anywhere else
 * gets caught the same way. `/` itself is deliberately excluded from this
 * group (it is the subject of the first group, and conflating "the known,
 * tracked defect" with "an unexpected new one" in the same assertion would
 * hide a second regression behind the first).
 */

test.describe('zero-width text stays clean on the Platform Wallet card (regression guard for PR #349)', () => {
  test('/ at 768px: the Platform Wallet transaction labels are not zero width', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1400 });
    await page.goto('/');
    const findings = await zeroWidthTextFindings(page);
    const texts = findings.map((f) => f.text);
    expect(texts, 'zero-width findings at 768px on /').not.toEqual(
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
