import { test, expect, type Page } from '@playwright/test';

/**
 * Real-browser geometry proof for the desktop nav groups (P6, native
 * `<details>`), at 1024 and 1440 — the two widths the owner's P6 fix
 * targeted after the live "21px sideways overflow at 1024" finding.
 *
 * jsdom already proves (Header.test.tsx) that Escape and an outside
 * `mousedown` remove the `open` attribute and that focus returns to the
 * summary. That is a DOM-event simulation, not real pointer hit-testing or
 * real layout — jsdom has no layout engine at all. This file proves the
 * same behaviours with a real mouse click and real keyboard input against
 * real computed geometry, which is the gap the owner's bar names explicitly:
 * a click outside a real `<details>` only closes it because the browser's
 * own focus/click semantics plus this component's handler cooperate, and a
 * panel that is clipped by the viewport would still report `open` in the
 * DOM while being visually broken — exactly what a jsdom assertion cannot
 * see and a `boundingBox()` can.
 */

const WIDTHS = [1024, 1440];

async function openGroup(page: Page, index: number) {
  const summary = page.locator('nav[aria-label="Primary"] details > summary').nth(index);
  await summary.click();
  const panel = page.locator('nav[aria-label="Primary"] details[open] > div').first();
  await expect(panel).toBeVisible();
  return { summary, panel };
}

test.describe('desktop nav group dropdown, real pointer and keyboard, real geometry', () => {
  for (const width of WIDTHS) {
    test(`no group's open panel is clipped by the viewport at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const count = await page.locator('nav[aria-label="Primary"] details > summary').count();
      expect(count).toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        const { panel } = await openGroup(page, i);
        const box = await panel.boundingBox();
        expect(box, `group ${i} has no panel box at ${width}px`).not.toBeNull();
        expect(box!.x, `group ${i} left edge at ${width}px`).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width, `group ${i} right edge at ${width}px (viewport ${width})`).toBeLessThanOrEqual(width);
        // Close via a real outside click before opening the next group, so each
        // iteration starts from the same state rather than stacking opens.
        await page.mouse.click(width - 2, 2);
      }
    });

    test(`a real pointer click outside the open group closes it at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const { panel } = await openGroup(page, 0);
      await expect(panel).toBeVisible();
      // A real click well away from any nav control -- the center of the page body.
      await page.mouse.click(width / 2, 700);
      await expect(panel).toBeHidden();
    });

    test(`real Escape closes the open group and its panel is gone, not just the DOM attribute, at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const { panel } = await openGroup(page, 0);
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
    });

    test(`opening a second group leaves exactly one panel visible at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await openGroup(page, 0);
      await openGroup(page, 1);
      const openPanels = page.locator('nav[aria-label="Primary"] details[open] > div');
      await expect(openPanels).toHaveCount(1);
    });
  }
});
