import { test, expect } from '@playwright/test';
import { FIXTURE_PATH } from './support/server';
import {
  activeElementSignature,
  blockMapTiles,
  canProgrammaticallyFocus,
  focusIsInsideDialog,
  hasInertAncestor,
  pressTab,
} from './support/keyboard';

/**
 * Committed regression suite for `useDialogFocusTrap` (BMPL-208), replacing
 * two real-Chromium walks that were run once on 2026-09-26 and then thrown
 * away (BMPL-217) — 12/12 on FullScreenMapModal, 13/13 on EnlargeableImage.
 * This file does not try to reproduce those exact counts; it re-derives the
 * same claims from the hook and the two components as they exist today, so a
 * future regression is caught by `pnpm --filter @bmpl/web test:e2e` rather
 * than by a person.
 *
 * SCOPE, stated on purpose: this suite proves only what a REAL BROWSER is
 * needed to prove — genuine `inert` enforcement and genuine pointer
 * hit-testing. It deliberately does NOT re-prove the "opener disconnected"
 * fallback (document.activeElement?.blur() when the opener has been
 * unmounted) — that is already a committed jsdom test
 * (apps/web/lib/use-dialog-focus-trap.test.tsx) and jsdom is sufficient for
 * it, since it is ordinary DOM-connectivity logic, not a real-inert or
 * real-hit-testing question.
 *
 * TWO TOOL FACTS BAKED INTO HOW THIS IS WRITTEN, at real cost the first time
 * (BMPL-216) — not re-derived here:
 *   - `element.click()` fires on an inert element in real Chromium (it
 *     invokes activation behaviour directly, bypassing the pointer
 *     hit-testing pipeline `inert` actually gates). Every "this cannot be
 *     clicked" assertion below uses a real `page.mouse.click()` at screen
 *     coordinates instead.
 *   - A dialog whose own focused content is unmounted resets focus to
 *     <body> for free, in both jsdom and real browsers, with no help from
 *     any code — a restoration test must move focus OUTSIDE the dialog
 *     first, or it passes against broken code. Not applicable to the tests
 *     below (the opener here is never unmounted), but the reason is stated
 *     so a future edit doesn't accidentally recreate that shape.
 *
 * ONE HONEST LIMITATION, carried forward rather than re-derived: both
 * dialogs are a fixed full-viewport overlay, so a background pointer click
 * is ALSO blocked by ordinary z-index stacking alone, with or without inert.
 * The "background is not reachable by a real pointer click" tests below
 * prove a real guarantee (the background truly cannot be clicked) but
 * cannot ISOLATE `inert` as the mechanism — only the Tab-order and
 * `hasInertAncestor` assertions can do that, because inert is the only
 * possible explanation for THOSE. Test names below say only what each test
 * actually proves.
 */

const OUTSIDE_SELECTORS = ['#nav-home', '#nav-settings', '#nav-profile', '#fixture-before', '#fixture-after'];

test.beforeEach(async ({ page }) => {
  await blockMapTiles(page);
  await page.goto(FIXTURE_PATH);
  await expect(page.locator('[data-e2e-fixture-ready]')).toBeAttached();
});

test.describe('FullScreenMapModal (via ExpandableRouteMap)', () => {
  async function openViaKeyboard(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: 'Expand' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Fixture route' })).toBeVisible();
  }

  test('Expand is keyboard-reachable and opens the dialog with focus on Close', async ({ page }) => {
    await openViaKeyboard(page);
    expect(await activeElementSignature(page)).toBe('Close map');
  });

  test('Tab is trapped: 20 presses never leave the dialog', async ({ page }) => {
    await openViaKeyboard(page);
    for (let i = 0; i < 20; i++) {
      await pressTab(page, 1);
      expect(await focusIsInsideDialog(page), `tab press #${i + 1} escaped the dialog`).toBe(true);
    }
  });

  test('Shift+Tab from the first focusable wraps inside the dialog, not backward out of it', async ({ page }) => {
    await openViaKeyboard(page);
    expect(await activeElementSignature(page)).toBe('Close map'); // first focusable
    await pressTab(page, 1, true);
    expect(await focusIsInsideDialog(page)).toBe(true);
  });

  test('every element outside the dialog has an inert ancestor while it is open', async ({ page }) => {
    await openViaKeyboard(page);
    for (const selector of OUTSIDE_SELECTORS) {
      expect(await hasInertAncestor(page, selector), `${selector} should be inert while the modal is open`).toBe(true);
    }
  });

  test('Escape closes the dialog', async ({ page }) => {
    await openViaKeyboard(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Fixture route' })).not.toBeVisible();
  });

  test('closing returns focus to the Expand button that opened it', async ({ page }) => {
    await openViaKeyboard(page);
    await page.keyboard.press('Escape');
    expect(await activeElementSignature(page)).toBe('Expand');
  });

  test('background is not reachable by a real pointer click while the dialog is open', async ({ page }) => {
    await openViaKeyboard(page);
    const before = page.locator('#fixture-before');
    const box = await before.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    // If the click had reached #fixture-before, Chromium would have focused it.
    expect(await activeElementSignature(page)).not.toBe('fixture-before');
    await expect(page.getByRole('dialog', { name: 'Fixture route' })).toBeVisible();
  });

  test('inert is released after close: background is focusable again', async ({ page }) => {
    await openViaKeyboard(page);
    await page.keyboard.press('Escape');
    for (const selector of OUTSIDE_SELECTORS) {
      expect(await canProgrammaticallyFocus(page, selector), `${selector} should be focusable again after close`).toBe(true);
    }
  });
});

test.describe('EnlargeableImage lightbox (three siblings)', () => {
  /** Opens the MIDDLE of three near-identical triggers — the case a single-instance test cannot see (BMPL-208 review). */
  async function openMiddleViaKeyboard(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: 'Enlarge product photo 2' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Enlarge product photo 2' })).toBeVisible();
  }

  test('the middle trigger is keyboard-reachable and opens its own dialog with focus on Close', async ({ page }) => {
    await openMiddleViaKeyboard(page);
    expect(await activeElementSignature(page)).toBe('Close');
  });

  test('Tab is trapped: 20 presses never leave the dialog', async ({ page }) => {
    await openMiddleViaKeyboard(page);
    for (let i = 0; i < 20; i++) {
      await pressTab(page, 1);
      expect(await focusIsInsideDialog(page), `tab press #${i + 1} escaped the dialog`).toBe(true);
    }
  });

  test('Shift+Tab from the first focusable wraps inside the dialog, not backward out of it', async ({ page }) => {
    await openMiddleViaKeyboard(page);
    await pressTab(page, 1, true);
    expect(await focusIsInsideDialog(page)).toBe(true);
  });

  test('every element outside the dialog is inert, including the OTHER TWO sibling triggers specifically', async ({ page }) => {
    await openMiddleViaKeyboard(page);
    const outside = [
      ...OUTSIDE_SELECTORS,
      'button[aria-label="Enlarge product photo 1"]',
      'button[aria-label="Enlarge product photo 3"]',
    ];
    for (const selector of outside) {
      expect(await hasInertAncestor(page, selector), `${selector} should be inert while the lightbox is open`).toBe(true);
    }
  });

  test('Escape closes the dialog', async ({ page }) => {
    await openMiddleViaKeyboard(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Enlarge product photo 2' })).not.toBeVisible();
  });

  test('closing returns focus to the SPECIFIC trigger that opened it, not a different sibling', async ({ page }) => {
    await openMiddleViaKeyboard(page);
    await page.keyboard.press('Escape');
    expect(await activeElementSignature(page)).toBe('Enlarge product photo 2');
  });

  test('a pointer click over the inert background never reaches the sibling underneath it', async ({ page }) => {
    await openMiddleViaKeyboard(page);
    const sibling = page.locator('button[aria-label="Enlarge product photo 1"]');
    const box = await sibling.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    // Unlike FullScreenMapModal, EnlargeableImage's own overlay closes on ANY
    // click that isn't the enlarged image itself (a deliberate backdrop-
    // dismiss affordance, stated in its own docstring) -- so the dialog
    // closing here is not a failure, it IS the proof: the overlay caught the
    // click before it could ever reach the inert sibling underneath. Had the
    // click actually reached sibling 1, focus would have moved to IT;
    // instead it returns to the trigger that opened THIS dialog.
    expect(await activeElementSignature(page)).toBe('Enlarge product photo 2');
  });

  test('inert is released after close: the other two siblings are focusable again', async ({ page }) => {
    await openMiddleViaKeyboard(page);
    await page.keyboard.press('Escape');
    for (const selector of ['button[aria-label="Enlarge product photo 1"]', 'button[aria-label="Enlarge product photo 3"]']) {
      expect(await canProgrammaticallyFocus(page, selector), `${selector} should be focusable again after close`).toBe(true);
    }
  });
});
