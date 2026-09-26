import type { Page } from '@playwright/test';

/** A tiny transparent PNG, served in place of real OpenStreetMap tiles so the
 * suite never depends on network reachability of an external tile server —
 * tile *rendering* is out of scope here; dialog focus behaviour is what's
 * under test, and Leaflet handles a substitute tile fine either way. */
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

export async function blockMapTiles(page: Page): Promise<void> {
  await page.route('https://tile.openstreetmap.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TRANSPARENT_PNG }),
  );
}

/** Identifies the focused element well enough to assert against, without caring about its exact DOM shape. */
export async function activeElementSignature(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return 'BODY';
    // `??` only falls through on null/undefined, and both `id` and an absent
    // aria-label read back as '' (not null) on a DOM element -- an element
    // with neither (e.g. the Expand button, which is unlabelled text) would
    // silently signature as '' instead of falling through to textContent.
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;
    if (el.id) return el.id;
    const text = el.textContent?.trim();
    if (text) return text;
    return el.tagName;
  });
}

export async function pressTab(page: Page, times: number, shift = false): Promise<void> {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab');
  }
}

/** True while the currently focused element is somewhere inside the open dialog — the trap's actual claim. */
export async function focusIsInsideDialog(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.activeElement;
    const dialog = document.querySelector('[role="dialog"]');
    return !!(el && dialog && dialog.contains(el));
  });
}

/** True when `selector` has an `inert` ancestor — the ground-truth check for background isolation, independent of tab order. */
export async function hasInertAncestor(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? el.closest('[inert]') !== null : false;
  }, selector);
}

/** Attempts a direct programmatic `.focus()` and reports whether it actually landed — proves an element is genuinely reachable again (or not), independent of Tab order. */
export async function canProgrammaticallyFocus(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return false;
    el.focus();
    return document.activeElement === el;
  }, selector);
}
