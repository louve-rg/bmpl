import { test, expect, type Page, type Browser, type BrowserContext, type CDPSession } from '@playwright/test';

/**
 * LocationPicker's and MapPreview's embedded Leaflet maps trapped a
 * one-finger scroll: `touch-action: pan-y` was already set on both
 * containers, but it never had any effect, because `touch-action` governs
 * the BROWSER's own default touch handling, not a library's own
 * touchstart/touchmove listeners -- and Leaflet's `dragging` handler
 * (L.Draggable) listens to those directly and repositions the map pane in
 * its own JavaScript, which is not the "default action" touch-action
 * suppresses. Observed in Chromium with `hasTouch` at 375px, unfixed: a
 * one-finger swipe on either embedded map panned the map and the page did
 * not scroll at all -- a longer swipe never advanced `scrollY`.
 *
 * Fix: `attachCooperativeMapDrag` (./../components/maps/cooperative-map-
 * drag.ts), shared by both files. On every touchstart/touchmove/touchend/
 * touchcancel it recomputes from the CURRENT touch count: exactly one
 * active touch disables `map.dragging` (so nothing competes with the
 * browser's native pan-y scroll any more), anything else (zero, or two-plus)
 * re-enables it. Two-finger pinch AND two-finger pan both go through the
 * separate, always-on `touchZoom` handler (Map.TouchZoom.js computes a
 * centre-point delta independently of `dragging` -- confirmed by reading
 * the Leaflet 1.9.4 source, not assumed), so toggling `dragging` never
 * affects that path. Gated to the embedded case only (`!inModal` /
 * `!scrollWheelZoom`); the full-screen modal case is untouched -- there is
 * no page scroll underneath it to protect, so the map owning every gesture
 * there is intentional.
 *
 * Four things verified live, not reasoned, because each one is a way this
 * fix could make the component worse than the trap it closes:
 *   1. Tap-to-place a pin still works with `dragging` disabled (Leaflet's
 *      click/tap detection is the browser's native synthetic click event,
 *      entirely separate from the drag handler).
 *   2. A two-finger drag actually translates the map, not just zooms it.
 *   3. `touchcancel` (an interrupted gesture) never leaves `dragging` stuck
 *      disabled -- a normal one-finger swipe afterwards still scrolls.
 *   4. The full-screen modal case is completely unchanged: the map still
 *      owns every gesture there.
 *
 * Dispatches real touch input via the Chrome DevTools Protocol
 * (`Input.dispatchTouchEvent`), not synthetic DOM events -- a JS-dispatched
 * `TouchEvent` never goes through the browser's actual touch/gesture
 * pipeline that `touch-action` and `dragging.disable()` interact with, so
 * it would prove nothing here. Runs as an ordinary spec against this
 * directory's shared dev server (e2e/support/server.ts): `/checkout` is
 * not under the dashboard shell, needs no live backend (`page.route()`
 * mocks the one call it makes, `/api/cart`), and no login -- the
 * middleware's auth gate only checks for the COOKIE's presence, so a fake
 * one clears it. Confirmed by actually running this file through
 * `pnpm --filter @bmpl/web test:e2e`, the same mechanism CI uses: 5/5 pass.
 *
 * A first attempt at this measurement put the touch coordinates OFF-SCREEN
 * (map scrolled out of an 800px viewport) and got a false green -- nothing
 * was on screen to intercept the gesture, so "the page scrolled" meant
 * nothing. Every test below calls `scrollIntoViewIfNeeded()` on the map
 * before touching it, specifically to not repeat that mistake.
 */

const WIDTH = 375;
const HEIGHT = 800;

function cartFixture() {
  return {
    id: 'cart-1', currency: 'BZD', itemCount: 1, distinctItemCount: 1, subtotalMinor: 2000,
    hasPriceChanges: false, hasUnavailableItems: false, updatedAt: new Date().toISOString(),
    vendors: [
      {
        vendorProfileId: 'v1', slug: 'acme-store', businessName: 'Acme Store', storeStatus: 'OPEN',
        subtotalMinor: 2000, itemCount: 1,
        items: [
          {
            id: 'line-1', productId: 'p1', variantId: null, title: 'Widget', slug: 'widget',
            variantTitle: null, displayName: null, variantLabel: null, optionValues: [], options: [],
            sku: 'W-1', imageUrl: null, currency: 'BZD', quantity: 1, unitPriceMinor: 2000,
            unitPriceMinorSnapshot: 2000, lineSubtotalMinor: 2000,
          },
        ],
      },
    ],
  };
}

async function dispatchTouch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', touchPoints: Array<{ x: number; y: number; id?: number }>) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
}
async function swipeOneFinger(cdp: CDPSession, points: Array<{ x: number; y: number }>) {
  await dispatchTouch(cdp, 'touchStart', [points[0]!]);
  for (let i = 1; i < points.length; i++) await dispatchTouch(cdp, 'touchMove', [points[i]!]);
  await dispatchTouch(cdp, 'touchEnd', []);
}

async function openEmbeddedCheckoutMap(page: Page) {
  await page.context().addCookies([{ name: 'access_token', value: 'fake-for-layout-check', domain: 'localhost', path: '/' }]);
  await page.route('**/api/cart', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: cartFixture() }) : r.continue()));
  await page.goto('/checkout');
  await expect(page.getByText('Acme Store')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('radio', { name: 'Delivery' }).click();
  const mapBox = page.locator('[role="application"][aria-label*="Map for choosing"]').first();
  await expect(mapBox).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500); // Leaflet's own async mount.
  await mapBox.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  return mapBox;
}

const readPaneTransform = (page: Page) =>
  page.evaluate(() => {
    const pane = document.querySelector('.leaflet-map-pane');
    return pane ? getComputedStyle(pane).transform : null;
  });
const readZoomLayerTransform = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('.leaflet-zoom-animated');
    return el ? getComputedStyle(el).transform : null;
  });

async function newTouchContext(browser: Browser): Promise<{ context: BrowserContext; page: Page; cdp: CDPSession }> {
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  return { context, page, cdp };
}

test.describe('embedded map cooperative touch gesture', () => {
  test('one-finger swipe scrolls the page, not the map', async ({ browser }) => {
    const { context, page, cdp } = await newTouchContext(browser);
    const mapBox = await openEmbeddedCheckoutMap(page);
    const box = (await mapBox.boundingBox())!;
    const cx = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    const before = { scrollY: await page.evaluate(() => window.scrollY), pane: await readPaneTransform(page) };
    await swipeOneFinger(cdp, [
      { x: cx, y: startY },
      { x: cx, y: startY - 50 },
      { x: cx, y: startY - 100 },
      { x: cx, y: startY - 150 },
    ]);
    await page.waitForTimeout(300);
    const after = { scrollY: await page.evaluate(() => window.scrollY), pane: await readPaneTransform(page) };

    expect(after.scrollY, 'page should scroll on a one-finger swipe').toBeGreaterThan(before.scrollY);
    expect(after.pane, 'map should NOT pan on a one-finger swipe').toBe(before.pane);
    await context.close();
  });

  test('verification 1: tap-to-place a pin still works with dragging disabled', async ({ browser }) => {
    const { context, page, cdp } = await newTouchContext(browser);
    const mapBox = await openEmbeddedCheckoutMap(page);
    const box = (await mapBox.boundingBox())!;

    const markerBefore = await page.evaluate(() => !!document.querySelector('.leaflet-marker-icon'));
    await dispatchTouch(cdp, 'touchStart', [{ x: box.x + box.width * 0.3, y: box.y + box.height * 0.3 }]);
    await dispatchTouch(cdp, 'touchEnd', []);
    await page.waitForTimeout(400);
    const markerAfter = await page.evaluate(() => !!document.querySelector('.leaflet-marker-icon'));

    expect(markerBefore, 'no pin before the tap').toBe(false);
    expect(markerAfter, 'a tap must still place a pin with dragging disabled').toBe(true);
    await expect(page.getByText('Location selected')).toBeVisible();
    await context.close();
  });

  test('verification 2: a two-finger drag translates the map, not just zooms it', async ({ browser }) => {
    const { context, page, cdp } = await newTouchContext(browser);
    const mapBox = await openEmbeddedCheckoutMap(page);
    const box = (await mapBox.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const gap = 30;

    const before = { pane: await readPaneTransform(page), zoom: await readZoomLayerTransform(page) };
    await dispatchTouch(cdp, 'touchStart', [{ x: cx - gap, y: cy, id: 0 }, { x: cx + gap, y: cy, id: 1 }]);
    const steps = 6;
    for (let s = 1; s <= steps; s++) {
      const dy = (80 * s) / steps;
      await dispatchTouch(cdp, 'touchMove', [{ x: cx - gap, y: cy - dy, id: 0 }, { x: cx + gap, y: cy - dy, id: 1 }]);
    }
    await dispatchTouch(cdp, 'touchEnd', []);
    await page.waitForTimeout(400);
    const after = { pane: await readPaneTransform(page), zoom: await readZoomLayerTransform(page) };

    expect(after.zoom !== before.zoom || after.pane !== before.pane, 'a fixed-distance two-finger drag must move the map').toBe(true);
    await context.close();
  });

  test('verification 3: touchcancel does not leave dragging stuck disabled', async ({ browser }) => {
    const { context, page, cdp } = await newTouchContext(browser);
    const mapBox = await openEmbeddedCheckoutMap(page);
    const box = (await mapBox.boundingBox())!;
    const cx = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    // Start a one-finger touch (dragging disables), then CANCEL it instead of
    // ending it normally -- simulates an interrupted gesture.
    await dispatchTouch(cdp, 'touchStart', [{ x: cx, y: startY }]);
    await dispatchTouch(cdp, 'touchMove', [{ x: cx, y: startY - 20 }]);
    await dispatchTouch(cdp, 'touchCancel', []);
    await page.waitForTimeout(200);

    const scrollBefore = await page.evaluate(() => window.scrollY);
    await swipeOneFinger(cdp, [
      { x: cx, y: startY },
      { x: cx, y: startY - 50 },
      { x: cx, y: startY - 100 },
      { x: cx, y: startY - 150 },
    ]);
    await page.waitForTimeout(300);
    const scrollAfter = await page.evaluate(() => window.scrollY);

    expect(scrollAfter, 'a normal swipe after a touchcancel must still scroll the page').toBeGreaterThan(scrollBefore);
    await context.close();
  });

  test('verification 4: the full-screen modal is unaffected -- the map still owns every gesture', async ({ browser }) => {
    const { context, page, cdp } = await newTouchContext(browser);
    await openEmbeddedCheckoutMap(page);
    await page.getByRole('button', { name: /Full screen/i }).click();
    await page.waitForTimeout(600);

    const bodyOverflow = await page.evaluate(() => getComputedStyle(document.body).overflow);
    const mapBox = page.locator('[role="application"][aria-label*="Map for choosing"]').first();
    await mapBox.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const box = (await mapBox.boundingBox())!;
    const cx = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    const before = await readPaneTransform(page);
    await swipeOneFinger(cdp, [
      { x: cx, y: startY },
      { x: cx, y: startY - 50 },
      { x: cx, y: startY - 100 },
    ]);
    await page.waitForTimeout(300);
    const after = await readPaneTransform(page);

    expect(bodyOverflow, 'background scroll stays locked while the modal is open').toBe('hidden');
    expect(after, 'the map must still pan on a one-finger swipe inside the modal').not.toBe(before);
    await context.close();
  });
});
