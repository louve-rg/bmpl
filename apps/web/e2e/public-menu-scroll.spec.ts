import { test, expect, type Page } from '@playwright/test';

/**
 * Regression pin for the public mobile menu on a short phone (c37f8c0, #340).
 *
 * The open menu was taller than the screen while the page behind it is locked
 * (body overflow hidden), so nothing could scroll and the lower links, including
 * Create account, were unreachable. The fix bounds the menu to the viewport and
 * lets it scroll inside itself.
 *
 * The height test is the cause. The reachability test is the symptom Edward
 * reported. Both are kept separate so each can go red on its own.
 */

const SHORT_PHONE = { width: 375, height: 667 };
const TOGGLE = { name: 'Toggle menu' };
const PANEL = '#public-mobile-nav';

test.use({ viewport: SHORT_PHONE });

async function openMenu(page: Page) {
  await page.goto('/');
  await page.getByRole('button', TOGGLE).click();
  await expect(page.locator(PANEL)).toBeVisible();
}

async function centreOfPanel(page: Page) {
  const box = await page.locator(PANEL).boundingBox();
  if (!box) throw new Error('menu panel has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe('public mobile menu on a short phone', () => {
  test('the open menu fits the screen', async ({ page }) => {
    await openMenu(page);
    const box = await page.locator(PANEL).boundingBox();
    expect(box!.height).toBeLessThanOrEqual(SHORT_PHONE.height);
  });

  test('a user can reach Create account in the open menu by scrolling it', async ({ page }) => {
    await openMenu(page);
    const { x, y } = await centreOfPanel(page);
    await page.mouse.move(x, y);
    for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 400);
    await expect(page.locator(PANEL).getByRole('link', { name: 'Create account' })).toBeInViewport();
  });

  test('a wheel over the open menu reaches the menu and does not move the page behind it', async ({ page }) => {
    await openMenu(page);
    await page.evaluate((selector) => {
      const panel = document.querySelector(selector);
      (window as unknown as { __wheelOnPanel: number }).__wheelOnPanel = 0;
      panel?.addEventListener('wheel', () => {
        (window as unknown as { __wheelOnPanel: number }).__wheelOnPanel += 1;
      });
    }, PANEL);

    const { x, y } = await centreOfPanel(page);
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(300);

    expect(await page.evaluate(() => (window as unknown as { __wheelOnPanel: number }).__wheelOnPanel)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('page scroll returns after the menu closes and after navigating away', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', TOGGLE).click();
    await expect(page.locator(PANEL)).toBeVisible();
    await page.getByRole('button', TOGGLE).click();
    await expect(page.locator(PANEL)).toBeHidden();

    await page.mouse.move(SHORT_PHONE.width / 2, SHORT_PHONE.height / 2);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    await page.getByRole('button', TOGGLE).click();
    await page.goto('/products');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.mouse.move(SHORT_PHONE.width / 2, SHORT_PHONE.height / 2);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });
});
