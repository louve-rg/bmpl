import { test, expect } from '@playwright/test';

/**
 * Found during the layout-workstream sweep (god, conv-mission-2026-10-13),
 * priority 1 (320px overflow). /cart only shows two defects once there is a
 * real item in it -- the empty-cart state (already swept clean, MDF-174 and
 * earlier this session) hides both.
 *
 * DEFECT 1: `<div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">`
 * (the items column + sticky summary aside) had no base `grid-cols-1`. Same
 * CSS Grid "missing base column" family as PR #390's admin fix and PR #372's
 * Services.tsx bento grid -- the implicit column, unconstrained below `lg`
 * (1024px), sizes to content instead of the viewport, and with the aside's
 * explicit `320px` second column that content easily exceeds 320-375px. This
 * caused a REAL document.documentElement.scrollWidth overflow (445px vs a
 * 320/375px viewport) -- the page itself scrolled horizontally, not just an
 * ancestor-clipped element.
 *
 * DEFECT 2 (only visible after fixing #1): each cart line item's action row
 * -- quantity stepper + "Move to Wishlist" + "Remove" -- is
 * `<div className="mt-2 flex items-center gap-3">` with no flex-wrap, inside
 * a `min-w-0 flex-1` column that itself was already correctly built. Once
 * the outer grid stopped forcing extra width, this inner row's own content
 * (stepper + two buttons) still didn't fit a 320px column and had nowhere to
 * go -- clipped by the card's own overflow-hidden with zero page-level
 * scrollWidth signal (the defect that stays hidden behind a clean page-level
 * check, same shape as PR #391's admin user-detail role row).
 *
 * Fix: `grid-cols-1` before `lg:` on the outer grid; `flex-wrap` on the
 * line-item action row.
 *
 * CI, stated plainly: needs a live API + the seeded dev database (maya's
 * account, prisma/seed.ts) -- not provisioned in CI's web e2e step (see
 * playwright.config.ts / .github/workflows/ci.yml, same as
 * employer-job-draft-defaults.spec.ts). tryLogin fails fast without one and
 * the test skips with the reason rather than failing red.
 */

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'DemoPass123';

async function tryLogin(page: import('@playwright/test').Page): Promise<boolean> {
  try {
    await page.goto('/login');
    await page.getByLabel('Email').fill('maya.customer@example.bz');
    await page.getByLabel('Password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

test.describe('cart with a real item stays inside the viewport at 320px', () => {
  test('neither the page nor the line-item action row overflows', async ({ page }) => {
    const loggedIn = await tryLogin(page);
    test.skip(!loggedIn, 'Needs a live API + seeded dev database (maya.customer) -- not provisioned in CI. See file header.');

    await page.goto('/products/uat-walk-widget-simulation');
    await page.getByRole('button', { name: /add to cart/i }).click();

    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto('/cart');

    const removeButton = page.getByRole('button', { name: 'Remove' }).first();
    await expect(removeButton).toBeVisible();
    const removeBox = await removeButton.boundingBox();
    expect(removeBox, '"Remove" button should have a measurable box').not.toBeNull();
    expect(removeBox!.x + removeBox!.width, `"Remove" button right edge at 320px viewport`).toBeLessThanOrEqual(321);

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, 'page overflow at 320px').toBeLessThanOrEqual(clientWidth + 1);
  });
});
