import { test, expect, type Page, type Browser } from '@playwright/test';
import { tryLogin, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, UAT_DRIVER_EMAIL, UAT_DRIVER_PASSWORD } from '../support/auth';

/**
 * MDF-376: StickyActionBar covers content it has no mechanism to clear. Not
 * a pixel-baseline spec (no `toHaveScreenshot`, no PNG) -- a DOM-geometry
 * regression test, living here rather than under the plain `e2e/` dir
 * because it needs a real login and this is the one suite with a live API +
 * seeded database in CI (see ci.yml, "Visual regression baseline"); the
 * plain e2e job provisions neither, so a spec needing `tryLogin` to
 * actually succeed (not just gracefully skip) can only run for real here.
 *
 * WHY THIS SPEC EXISTS AT ALL: a contrast sweep cannot see this defect (no
 * color is wrong), and an automated DOM overflow scan reports 0px (nothing
 * overflows its own box -- a `position: fixed` element simply paints over
 * whatever the viewport scrolls underneath it). The only way to ever catch
 * a regression here is to measure a real focused element against the real
 * bar, which is what this does.
 *
 * ASSERTS THE INVARIANT, NOT PINNED PIXELS. An earlier version of this
 * investigation hardcoded the exact overlap measured at one viewport
 * (430x932); the same mechanism did NOT reproduce at 320/375/390 in that
 * repro, because the browser's scrollIntoView-on-focus stopping point
 * depends on the page's exact height/content at the moment of focus --
 * something that shifts with unrelated copy changes elsewhere on the page.
 * A spec pinned to measured pixels would be flaky by construction; this one
 * asserts "after focusing the field, its bottom is not below the bar's
 * top", which holds regardless of exactly how far the browser scrolled to
 * get there.
 */

const WIDTHS: Array<{ width: number; height: number }> = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];

async function authedContext(browser: Browser, email: string, password: string | undefined, width: number, height: number) {
  if (!password) return null;
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const ok = await tryLogin(page, email, password);
  if (!ok) {
    await context.close();
    return null;
  }
  return { page, close: () => context.close() };
}

async function barTop(page: Page): Promise<number | null> {
  const box = await page.locator('[class*="isolate"][class*="z-30"]').first().boundingBox();
  return box ? box.y : null;
}

/** Not covered means the element's own bottom edge sits at or above the bar's top. */
async function expectClearOfBar(page: Page, target: ReturnType<Page['locator']>, label: string) {
  const bar = await barTop(page);
  const box = await target.boundingBox();
  expect(bar, `${label}: StickyActionBar not found`).not.toBeNull();
  expect(box, `${label}: target element not found/visible`).not.toBeNull();
  if (bar == null || box == null) return;
  const targetBottom = box.y + box.height;
  expect(targetBottom, `${label}: bottom (${targetBottom.toFixed(1)}) should not be below the bar's top (${bar.toFixed(1)})`).toBeLessThanOrEqual(bar + 1);
}

/* ---------------------------------------------------------------------- */
/* 1. FIXED mode -- /dashboard/shipments/new, "Collect from" (TYPED method) */

async function openTypedOrigin(page: Page) {
  await page.goto('/dashboard/shipments/new');
  const serviceType = page.locator('#service-type');
  await serviceType.waitFor({ state: 'visible', timeout: 10_000 });
  await serviceType.selectOption('DOOR_TO_DOOR');
  // The method picker is a <select>, not a button -- two render (Collect
  // from, Deliver to); .first() is "Collect from".
  await page.getByLabel('How would you like to give us the address?').first().selectOption('TYPED');
}

test.describe('fixed StickyActionBar reserves its space (shipments/new)', () => {
  for (const { width, height } of WIDTHS) {
    test(`focused address input stays clear of the bar at ${width}x${height}`, async ({ browser }) => {
      const ctx = await authedContext(browser, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, width, height);
      test.skip(ctx === null, 'Needs a live API + seeded dev database with SEED_SUPER_ADMIN_PASSWORD set.');
      if (!ctx) return;
      const { page, close } = ctx;
      await openTypedOrigin(page);

      const input = page.locator('input[autocomplete="address-line1"]').first();
      await input.waitFor({ state: 'visible', timeout: 10_000 });

      // The real bug: the browser's own scrollIntoView-on-focus, not a
      // manual scroll -- no scrolling here beyond what .focus() itself does.
      await input.focus();
      await page.waitForTimeout(250); // let the browser's own scroll settle
      await expectClearOfBar(page, input, `address input @ ${width}x${height}`);

      // The zoom buttons are real focusable <a> elements inside Leaflet's
      // own control -- scroll-padding-bottom applies to every focus-scroll
      // in the document, so this should already be covered by the same fix;
      // verified here rather than assumed, per MDF-376. Asserted present
      // (not silently skipped if absent) -- a missing locator here would
      // otherwise let this half of the spec pass without checking anything.
      const zoomIn = page.locator('a.leaflet-control-zoom-in').first();
      await zoomIn.waitFor({ state: 'attached', timeout: 10_000 });
      await zoomIn.focus();
      await page.waitForTimeout(250);
      await expectClearOfBar(page, zoomIn, `Leaflet zoom-in control @ ${width}x${height}`);

      await close();
    });
  }
});

/* ---------------------------------------------------------------------- */
/* 2. STICKY mode -- driver shipping job page, handoff code input. Kept as a
      passing assertion: documents that `sticky` needs no fix today, and
      catches anyone converting this page to `fixed` later. */

const MOCK_JOB = {
  id: 'e2e-stickybar-coverage-job',
  jobKind: 'LAST_MILE',
  reference: 'INV-0001',
  status: 'ARRIVING',
  statusLabel: 'Arriving',
  nextActionLabel: null,
  modeLabel: 'Road',
  addressUnlocked: true,
  pickup: null,
  dropoff: null,
  routeStops: [],
  parcel: { description: 'Coverage-spec parcel', pieces: 1, weightGrams: null },
  feeMinor: 500,
  handoffCodeHeldBy: 'the recipient',
  offerExpiresAt: null,
  pinAttemptsRemaining: 5,
};

test.describe('sticky StickyActionBar already reserves its space (driver shipping job)', () => {
  for (const { width, height } of WIDTHS) {
    test(`focused handoff-code input stays clear of the bar at ${width}x${height}`, async ({ browser }) => {
      const ctx = await authedContext(browser, UAT_DRIVER_EMAIL, UAT_DRIVER_PASSWORD, width, height);
      test.skip(ctx === null, 'Needs the UAT driver fixture (packages/database/prisma/seed-uat-logistics.ts).');
      if (!ctx) return;
      const { page, close } = ctx;
      await page.route('**/api/driver/shipping-jobs/e2e-stickybar-coverage-job', (r) => r.fulfill({ json: MOCK_JOB }));
      await page.goto('/dashboard/driver/shipping/e2e-stickybar-coverage-job');

      const codeInput = page.locator('#code');
      await codeInput.waitFor({ state: 'visible', timeout: 10_000 });
      await codeInput.focus();
      await page.waitForTimeout(250);
      await expectClearOfBar(page, codeInput, `handoff code input @ ${width}x${height}`);

      await close();
    });
  }
});
