import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * /dashboard/shipments/new's "Review and pay" summary (the `Line` helper at
 * the bottom of page.tsx) renders free-text customer input -- the parcel
 * description, and the origin/destination town -- inside a plain
 * `flex items-baseline justify-between` row with no `min-w-0`/`break-words`
 * on the value cell. Same mechanism as PR #397/#410 (a flex item's default
 * `min-width: auto` sizes it to its longest UNBREAKABLE word no matter what
 * wrapping rule the text itself carries): a single long, unbroken word in
 * the "What is in it?" field pins the row at its full content width, which
 * overflows the card at 320px. The card has no `overflow-hidden` of its own
 * here, so the row's OWN box is the right thing to measure directly -- not
 * `document.documentElement.scrollWidth`, which (per the standing floor
 * lesson from PR #410) can still read clean if some other ancestor clips it
 * first.
 *
 * [LOCAL ONLY] A prior version of this comment claimed "no live API: ...
 * nothing here needs a seeded database or a running API... expected to run
 * for real in CI". That was wrong: `/dashboard/shipments/new` sits under
 * app/dashboard/*, whose layout does its own server-side `serverGet('/me')`
 * (apps/web/lib/server-api.ts) -- a real `fetch()` to `NEXT_PUBLIC_API_URL`
 * that `page.route()` cannot intercept, because that only hooks the
 * browser's own network stack, not Next's SSR fetch. The middleware-only
 * cookie-presence check this comment described is real (apps/web/
 * middleware.ts), but it is not the only gate on this route -- the layout's
 * own SSR call is a second one, upstream of anything page.route() can see.
 * CI's e2e job has no API/DB services (apps/web never talks to Postgres/
 * Redis/MinIO directly, root CLAUDE.md s2), so nothing answers `/me` there
 * and this spec cannot pass as configured -- it needs a live API (or a
 * local stand-in for `/me`) pointed at `NEXT_PUBLIC_API_URL`. Without one,
 * `serverGet` throws, uncaught, before the layout even reaches its own
 * `redirect('/login')`, so `openReviewPanel` below skips the test rather
 * than failing on this unrelated precondition.
 */

const WIDTHS = [320, 375, 768, 1024, 1440];

const HUBS = [
  { id: 'hub-1', code: 'BZE', name: 'Belize City Terminal', type: 'AIRPORT', district: 'BELIZE', city: 'Belize City', address: null, latitude: null, longitude: null, modes: ['AIR', 'LAND'], instructions: null },
  { id: 'hub-2', code: 'SPR', name: 'San Pedro Terminal', type: 'WATER_TAXI_TERMINAL', district: 'BELIZE', city: 'San Pedro', address: null, latitude: null, longitude: null, modes: ['AIR', 'SEA'], instructions: null },
];

const QUOTE_AVAILABLE = {
  available: true,
  service: 'HUB_TO_HUB',
  serviceLabel: 'Terminal to terminal',
  serviceDescription: 'Drop the shipment at the origin hub. BML transports it to the destination hub for collection.',
  totalMinor: 8000,
  transportMinutes: 45,
  explanation: 'Priced via Belize City Terminal -> San Pedro Terminal.',
  requestedDate: '2026-10-20',
  pricingIncomplete: false,
  pricingNote: null,
  legs: [{ sequence: 1, description: 'Belize City Terminal to San Pedro Terminal by air' }],
};

async function openReviewPanel(page: Page): Promise<Locator | null> {
  await page.context().addCookies([
    { name: 'access_token', value: 'fake-for-layout-check', domain: 'localhost', path: '/' },
  ]);
  await page.route('**/api/shipping/hubs', (r) => r.fulfill({ json: HUBS }));
  await page.route('**/api/shipping/modes', (r) => r.fulfill({ json: ['LAND', 'AIR', 'SEA'] }));
  await page.route('**/api/wallet', (r) => {
    if (r.request().method() !== 'GET') return r.continue();
    return r.fulfill({ json: { currency: 'BZD', availableMinor: 500000, onHoldMinor: 0, totalMinor: 500000, status: 'ACTIVE', exists: true } });
  });
  await page.route('**/api/shipping/quote', (r) => r.fulfill({ json: QUOTE_AVAILABLE }));

  try {
    // `goto` and the readiness check on `#service-type` both belong inside
    // this try: a failed SSR `/me` call throws before the dashboard layout
    // ever renders the form at all, so the select would otherwise sit in
    // `selectOption`'s own default 30s timeout waiting for an element that
    // is never coming -- that is a precondition failure, not a reason to
    // fail this spec's own, unrelated overflow assertion.
    await page.goto('/dashboard/shipments/new');
    const serviceType = page.locator('#service-type');
    await expect(serviceType).toBeVisible({ timeout: 5000 });
    await serviceType.selectOption('HUB_TO_HUB');

    const terminalSelects = page.locator('select').filter({ hasText: 'Choose a terminal' });
    await terminalSelects.nth(0).selectOption('hub-1');
    await terminalSelects.nth(1).selectOption('hub-2');

    // A deliberately pathological single, unbroken word -- the exact shape
    // that defeats ordinary word-wrap and exposes a missing min-w-0.
    await page.getByPlaceholder('One box of documents').fill('A'.repeat(60));

    const parcelRow = page.locator('div', { hasText: /^Parcel/ }).last();
    await expect(parcelRow).toBeVisible({ timeout: 5000 });
    return parcelRow;
  } catch {
    return null;
  }
}

test.describe('[LOCAL ONLY, skips without a /me responder -- see file header] shipment booking review panel never overflows on a long parcel description', () => {
  for (const width of WIDTHS) {
    test(`the Parcel row stays inside its own box at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const parcelRow = await openReviewPanel(page);
      test.skip(parcelRow === null, 'Needs a local responder for the dashboard-shell /me SSR call -- see file header.');

      const measured = await parcelRow!.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));

      expect(
        measured.scrollWidth,
        `Parcel row scrollWidth ${measured.scrollWidth} vs its own clientWidth ${measured.clientWidth} at ${width}px -- the row should never overflow itself`,
      ).toBeLessThanOrEqual(measured.clientWidth + 1);
    });
  }
});
