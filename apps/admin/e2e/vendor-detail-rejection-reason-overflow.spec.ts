import { test, expect, type Page } from '@playwright/test';

/**
 * Admin's shared `Alert` component (components/ui.tsx) renders `title` and
 * `children` with no `break-words`/`overflow-wrap`. Its box itself is never
 * a flex/grid item here, so the already-documented min-width:auto chain
 * (#410 etc.) does not apply -- this is the SAME newly-identified mechanism
 * as order-detail-free-text-overflow.spec.ts: an unbroken word overflows
 * the Alert's own content box regardless. `/dashboard/vendors/[id]` renders
 * the admin-entered `rejectionReason` through this exact component
 * (`<Alert tone="error">Rejection reason: {v.rejectionReason}</Alert>`),
 * which is why the primitive itself -- not just this one call site -- is
 * the fix: every other Alert consumer with free-text content has the same
 * latent exposure.
 *
 * Confirmed live, unfixed: at 320/375/768/1024px the Alert's own
 * scrollWidth exceeded its clientWidth (738 vs 278 at 320px); only at
 * 1440px was the box already wide enough to hold the content without
 * overflowing. Silently clipped by the dashboard shell's own
 * `overflow-x-hidden` the same way as the other admin specs in this
 * directory -- the document and the Alert's own bounding rect both stay
 * inside the viewport, so scrollWidth vs clientWidth on the Alert element
 * itself is the only instrument that sees it.
 *
 * [LOCAL ONLY] Same dashboard-shell `/me` SSR precondition as the
 * order-detail specs in this directory -- see their file headers for detail.
 */

const WIDTHS = [320, 375, 768, 1024, 1440];
const LONG_WORD = 'A'.repeat(80);

function vendor() {
  return {
    id: 'vendor-1',
    businessName: 'Acme Store',
    slug: 'acme-store',
    description: null,
    contactEmail: 'owner@example.com',
    contactPhone: null,
    website: null,
    approvalStatus: 'REJECTED',
    storeStatus: 'CLOSED',
    rejectionReason: `Blurry photo ${LONG_WORD}`,
    logoUrl: null,
    bannerUrl: null,
    owner: { email: 'owner@example.com', firstName: 'Owner', lastName: 'Person' },
    settings: null,
    locations: [],
    openingHours: [],
    reviews: [],
  };
}

async function openVendorDetail(page: Page): Promise<boolean> {
  await page.context().addCookies([{ name: 'access_token', value: 'fake-for-layout-check', domain: 'localhost', path: '/' }]);
  await page.route('**/api/admin/vendors/vendor-1', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: vendor() }) : r.continue()));
  try {
    // `goto` belongs inside this try, not just the `expect` below: when the
    // dev server itself is unreachable, `goto` throws `ERR_CONNECTION_REFUSED`
    // before the page ever has a chance to redirect on a failed `/me` --
    // that is a precondition failure same as a failed SSR call, not a
    // reason to crash the test instead of skipping it.
    await page.goto('/dashboard/vendors/vendor-1');
    await expect(page.getByText('Rejection reason')).toBeVisible({ timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

test.describe('[LOCAL ONLY, skips without a /me responder -- see file header] Alert never overflows itself on a long rejection reason', () => {
  for (const width of WIDTHS) {
    test(`the rejection-reason alert stays inside its own box at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1200 });
      const ready = await openVendorDetail(page);
      test.skip(!ready, 'Needs a local responder for the dashboard-shell /me SSR call -- see file header.');

      const measured = await page.evaluate(() => {
        const alert = document.querySelector('[role="alert"]');
        return alert ? { scrollWidth: alert.scrollWidth, clientWidth: alert.clientWidth } : null;
      });

      expect(measured, 'alert element not found').not.toBeNull();
      expect(
        measured!.scrollWidth,
        `alert scrollWidth ${measured!.scrollWidth} vs its own clientWidth ${measured!.clientWidth} at ${width}px`,
      ).toBeLessThanOrEqual(measured!.clientWidth + 1);
    });
  }
});
