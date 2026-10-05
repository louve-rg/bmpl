import { test, expect } from '@playwright/test';

/**
 * Regression pin for the public mobile menu on a short phone (c37f8c0, #340).
 *
 * The open menu was taller than the screen while the page behind it is locked
 * (body overflow hidden), so nothing could scroll and the lower links, including
 * Create account, were unreachable. The fix bounds the menu to the viewport and
 * lets it scroll inside itself.
 *
 * (a) and the reachability half of it are the defect. (b) and (c) are the
 * claims that must stay true before and after the fix: the page behind does not
 * move, and page scroll returns after close and navigation.
 */

const SHORT_PHONE = { width: 375, height: 667 };
const TOGGLE = { name: 'Toggle menu' };

test.use({ viewport: SHORT_PHONE });

test.describe('public mobile menu on a short phone', () => {
  test('(a) the open menu fits the screen and reaches its own last link', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', TOGGLE).click();

    const panel = page.locator('#public-mobile-nav');
    await expect(panel).toBeVisible();

    const box = await panel.boundingBox();
    const size = await panel.evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }));
    console.log(`PANEL box.height=${box?.height} clientHeight=${size.client} scrollHeight=${size.scroll} viewport=${SHORT_PHONE.height}`);
    expect(box!.height).toBeLessThanOrEqual(SHORT_PHONE.height);

    await panel.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(panel.getByRole('link', { name: 'Create account' })).toBeInViewport();
  });

  test('(b) a wheel over the open menu does not move the page behind it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', TOGGLE).click();

    const panel = page.locator('#public-mobile-nav');
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(300);

    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('(c) page scroll returns after close and after navigating away', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', TOGGLE).click();
    await expect(page.locator('#public-mobile-nav')).toBeVisible();
    await page.getByRole('button', TOGGLE).click();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');

    await page.getByRole('button', TOGGLE).click();
    await page.goto('/products');
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  });
});
