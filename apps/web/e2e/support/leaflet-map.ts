import type { BrowserContext, Locator, Page } from '@playwright/test';

/**
 * Driving `LocationPicker` (apps/web/components/maps/LocationPicker.tsx) from
 * a real browser test — MDF-535/MDF-485.
 *
 * Leaflet is not an ordinary form control: there is no `<input>` to fill and
 * no `value` attribute to read. Two things make it testable anyway, both
 * already true of the EXISTING component, with no production change needed:
 *
 *   1. Click-to-drop is a REAL DOM `click` listener Leaflet attaches to the
 *      map container (`map.on('click', ...)`, LocationPicker.tsx:323) and
 *      converts to lat/lng itself from the event's pixel offset. A Playwright
 *      click at a pixel position inside the container fires a genuine
 *      browser click event — Leaflet does the rest. No mock, no stub.
 *   2. Dragging the marker is Leaflet's own `Draggable` class, which listens
 *      for raw `mousedown`/`mousemove`/`mouseup` (LocationPicker.tsx:235-241
 *      wires `draggable: true` on the marker) — not HTML5 drag-and-drop, so
 *      Playwright's `locator.dragTo()` does not work here. A manual
 *      mouse.down → several mouse.move steps → mouse.up sequence does,
 *      because each synthetic mousemove is a real DOM event Leaflet's own
 *      listener receives exactly like a real mouse would produce.
 *
 * What this file CANNOT do without a test hook: click or drag to a
 * PRE-CHOSEN, exact lat/lng. Pixel position -> lat/lng is Leaflet's own
 * Web Mercator projection, a function of the map's current center/zoom at
 * the moment of interaction, which this module does not have access to from
 * outside the page. Every helper below therefore interacts at a position
 * relative to the map's own bounding box and reads back WHATEVER coordinate
 * the app itself reports afterward (via LocationPicker's own "Coordinates"
 * disclosure, LocationPicker.tsx:716-723) — sufficient for every one of the
 * 14 owner-named checks, none of which requires landing on a specific
 * pre-known point. See this harness's report to god for the one thing that
 * WOULD need a test hook (precise-coordinate targeting) and why it wasn't
 * asked for as a blocker.
 */

/** The map's own container — `role="application"`, a stable, already-shipped
 *  accessible name (LocationPicker.tsx:657-658), not a selector this harness
 *  invented. Matches both the embedded and full-screen-modal instances. */
export function mapContainer(page: Page): Locator {
  return page.getByRole('application', { name: /map for choosing/i });
}

/**
 * LocationPicker shows its own "Loading map…" placeholder
 * (LocationPicker.tsx:677/713) until its `ready` state flips true inside
 * Leaflet's `whenReady` callback. Waiting for it to disappear before
 * interacting matches the component's own readiness signal.
 */
export async function waitForMapReady(page: Page): Promise<void> {
  await page.getByText('Loading map…').waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
}

/**
 * Click inside the map container to drop (or move) the pin — the manual
 * placement path every one of the 14 checks can reach with zero GPS
 * involvement (check #11 depends on exactly this still working when
 * geolocation is denied).
 *
 * `offset` is a FRACTION of the container's own box (0..1 each axis, default
 * dead centre) rather than an absolute pixel — keeps call sites readable and
 * independent of the embedded-vs-full-screen box size.
 *
 * `scrollIntoViewIfNeeded()` is load-bearing, not cosmetic: this harness's
 * own first live run found `boundingBox()` returning page coordinates below
 * the viewport (the map sits well down a long /checkout page on first load),
 * and `page.mouse.click(x, y)` — unlike `locator.click()` — does not
 * auto-scroll. The click landed outside the viewport and hit nothing;
 * confirmed via `document.elementsFromPoint()` at the computed point
 * returning `[]`. Looked exactly like a flaky map-readiness race the first
 * time it was seen; it was a scroll-position bug in this harness.
 */
export async function clickMapToPlacePin(
  page: Page,
  offset: { x: number; y: number } = { x: 0.5, y: 0.5 },
): Promise<void> {
  await waitForMapReady(page);
  await mapContainer(page).scrollIntoViewIfNeeded();
  const box = await mapContainer(page).boundingBox();
  if (!box) throw new Error('Map container has no bounding box — is it rendered and visible?');
  await page.mouse.click(box.x + box.width * offset.x, box.y + box.height * offset.y);
}

/**
 * Drag the existing pin by a pixel delta, using Leaflet's own mouse-event
 * drag path (see file header — NOT `locator.dragTo()`, which assumes HTML5
 * DnD and silently no-ops against Leaflet's custom Draggable). Must be
 * called only after a pin already exists (`clickMapToPlacePin` first), same
 * precondition the real UI has — there is nothing to drag otherwise.
 *
 * `steps` matters, not cosmetic: Leaflet's Draggable computes movement from
 * consecutive mousemove deltas, so a single jump from A to B can register as
 * a click-drag-release too fast for its own internal drag-start threshold.
 * Several intermediate moves reproduces what a real mouse drag looks like at
 * the DOM event level.
 */
export async function dragPinBy(page: Page, deltaX: number, deltaY: number, steps = 10): Promise<void> {
  const marker = mapContainer(page).locator('.leaflet-marker-icon').first();
  const box = await marker.boundingBox();
  if (!box) throw new Error('No marker to drag — call clickMapToPlacePin first.');
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps });
  await page.mouse.up();
}

/**
 * The TOUCH equivalent of `dragPinBy` (MDF-535 follow-up: Oscar reports the
 * marker is draggable and Leaflet's `Draggable` is touch-capable natively,
 * but flagged that no repo-level test exercises that gesture specifically —
 * "the library probably handles it" is not evidence the owner's desktop/
 * tablet/mobile requirement is actually met).
 *
 * Playwright's `Touchscreen` class only offers `.tap()` — no drag primitive —
 * so this dispatches raw `touchstart`/`touchmove`/`touchend` events directly
 * via `page.evaluate`, constructing real `Touch` objects the way a touch
 * browser would. Leaflet 1.9's `Draggable` listens for exactly these events
 * when `L.Browser.touch` is true (`Draggable.START = Browser.touch ?
 * ['touchstart', 'mousedown'] : ['mousedown']`), and `L.Browser.touch`
 * resolves true under Chromium's real touch emulation — which is why the
 * calling test MUST use a context created with `hasTouch: true` (and
 * typically `isMobile: true`), or this exercises nothing: without touch
 * emulation, `ontouchstart` is absent from `window` and Leaflet never
 * attaches the touch listeners this function is trying to drive.
 */
export async function touchDragPinBy(page: Page, deltaX: number, deltaY: number, steps = 6): Promise<void> {
  const marker = mapContainer(page).locator('.leaflet-marker-icon').first();
  const box = await marker.boundingBox();
  if (!box) throw new Error('No marker to touch-drag — call clickMapToPlacePin first.');
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await marker.evaluate(
    (el, { startX, startY, deltaX, deltaY, steps }) => {
      const fire = (type: string, x: number, y: number) => {
        const touch = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
        el.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [touch], changedTouches: [touch], bubbles: true, cancelable: true }));
      };
      fire('touchstart', startX, startY);
      for (let i = 1; i <= steps; i++) {
        fire('touchmove', startX + (deltaX * i) / steps, startY + (deltaY * i) / steps);
      }
      fire('touchend', startX + deltaX, startY + deltaY);
    },
    { startX, startY, deltaX, deltaY, steps },
  );
}

/**
 * Read back the coordinate LocationPicker itself reports for the current
 * pin — the same number the component will submit, not a value this harness
 * computed independently.
 *
 * As of MDF-485 M1/M2 (owner behaviour 9, god overruled "not a gap"), this is
 * no longer behind a `<details>` disclosure: the coordinate is now always
 * visible the instant a pin exists, immediately under the "✓ Location
 * selected" line, in both the embedded and full-screen bodies
 * (LocationPicker.tsx:706, inside the same `aria-live="polite"` status
 * block as the "selected" line). Scoped to that status block rather than a
 * bare `p.font-mono` match, since other font-mono text exists elsewhere on
 * the page (e.g. the address-search results list).
 */
export function pinCoordinatesLocator(page: Page): Locator {
  return page.locator('[aria-live="polite"]', { hasText: '✓ Location selected' }).locator('p.font-mono');
}

export async function readPinCoordinates(page: Page): Promise<{ latitude: number; longitude: number }> {
  const loc = pinCoordinatesLocator(page);
  const text = await loc.textContent();
  const match = /(-?\d+\.\d+),\s*(-?\d+\.\d+)/.exec(text ?? '');
  if (!match) throw new Error(`Could not parse coordinates from "${text}" — has the "✓ Location selected" state actually been reached?`);
  return { latitude: Number(match[1]), longitude: Number(match[2]) };
}

/* ------------------------------------------------------- geolocation (#11) */

/**
 * Simulate the customer DENYING the browser's geolocation permission prompt
 * — check #11's precondition. Deliberately NOT a mock of `navigator
 * .geolocation`: Playwright blocks the real Geolocation API by default
 * until a context explicitly grants it (`browserContext.grantPermissions`),
 * so a context that simply never grants it reproduces the REAL
 * `GeolocationPositionError.PERMISSION_DENIED` branch
 * (LocationPicker.tsx:472-474) through the browser's own permission model —
 * the owner's "not mocks" ruling is about faking the API's behaviour, not
 * about which real permission state a test chooses to run under.
 *
 * No-op function kept for call-site readability (`await
 * denyGeolocationPermission(context)` reads as a deliberate choice, not an
 * omission) — a fresh context already starts in exactly this state.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function denyGeolocationPermission(_context: BrowserContext): Promise<void> {
  // Intentionally empty. See doc comment above.
}

/**
 * Give the browser a REAL geolocation fix via Chromium's own
 * `Emulation.setGeolocationOverride` (Playwright: `context.setGeolocation`)
 * — the actual mechanism Chromium DevTools' own location override uses, not
 * a JS-level stub of `navigator.geolocation`. `getCurrentPosition` resolves
 * through this exactly as it would for a real device at that position,
 * which is what lets `accuracy` drive LocationPicker's real
 * good/fair/poor wording branches (LocationPicker.tsx:51-70) for real.
 *
 * Must grant the permission first — the override has no effect while the
 * page would otherwise see PERMISSION_DENIED.
 */
export async function setGeolocationFix(
  context: BrowserContext,
  fix: { latitude: number; longitude: number; accuracy?: number },
): Promise<void> {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy ?? 10 });
}

/** A real, in-bounds Belize fix with GOOD accuracy — DISTRICT_CENTROIDS'
 *  Belize City entry, not invented (LocationPicker.tsx's own DEFAULT_CENTRE,
 *  so this is also always a valid map centre). */
export const GOOD_FIX_BELIZE_CITY = { latitude: 17.4995, longitude: -88.1976, accuracy: 10 };

/** A real fix, genuinely outside Belize — checks the existing out-of-bounds
 *  refusal path (`isWithinBelize`, LocationPicker.tsx:217-222) stays correct
 *  when the COORDINATE comes from GPS rather than a map click/drag; Miami,
 *  FL, nowhere near the Belize bounding box. */
export const OUT_OF_BELIZE_FIX = { latitude: 25.7617, longitude: -80.1918, accuracy: 10 };

/** A real fix with POOR accuracy (FAIR_ACCURACY_M=100 threshold,
 *  LocationPicker.tsx:42) — the "device gave an approximate position"
 *  warning branch, a genuinely large but real CDP-reported accuracy value,
 *  not a fabricated UI state. */
export const POOR_ACCURACY_FIX = { latitude: 17.4995, longitude: -88.1976, accuracy: 5000 };
