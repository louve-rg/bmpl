import { test, expect, type Page } from '@playwright/test';

/**
 * MDF-128 follow-up: the original pin (`public-menu-scroll.spec.ts`) proves
 * the open-menu-scrolls-itself fix at exactly 375x667, the one phone size
 * Edward reported against. The fix itself (`max-h-[calc(100vh-4rem)]
 * overflow-y-auto`) is not specific to that height, so this file proves the
 * same two properties — the panel never exceeds the viewport, and its last
 * link is reachable by scrolling — at the other two narrow widths the
 * owner named: 414 (a taller phone, where the menu may or may not actually
 * overflow) and 768 (tablet portrait, still below the `lg` breakpoint where
 * the mobile list renders instead of the desktop groups).
 *
 * Kept as a separate file rather than edited into the merged pin, so that
 * file's own history and bytes stay untouched.
 */

const WIDTHS = [
  { width: 414, height: 896 },
  { width: 768, height: 1024 },
];
const TOGGLE = { name: 'Toggle menu' };
const PANEL = '#public-mobile-nav';

async function openMenu(page: Page) {
  await page.goto('/');
  await page.getByRole('button', TOGGLE).click();
  await expect(page.locator(PANEL)).toBeVisible();
}

test.describe('public mobile menu stays bounded and scrollable at other required widths', () => {
  for (const { width, height } of WIDTHS) {
    test.describe(`${width}x${height}`, () => {
      test.use({ viewport: { width, height } });

      test('the open menu never exceeds the viewport height', async ({ page }) => {
        await openMenu(page);
        const box = await page.locator(PANEL).boundingBox();
        expect(box!.height).toBeLessThanOrEqual(height);
      });

      test('Create account is reachable inside the panel (by scroll, or already visible)', async ({ page }) => {
        await openMenu(page);
        const panel = page.locator(PANEL);
        const box = await panel.boundingBox();
        const { x, y } = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
        await page.mouse.move(x, y);
        for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 400);
        await expect(panel.getByRole('link', { name: 'Create account' })).toBeInViewport();
      });

      test('the page behind stays at scroll 0 while the menu is open and scrolled', async ({ page }) => {
        await openMenu(page);
        const box = await page.locator(PANEL).boundingBox();
        await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
        await page.mouse.wheel(0, 400);
        await page.waitForTimeout(200);
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
      });
    });
  }
});
