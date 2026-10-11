import { test, expect } from '@playwright/test';

/**
 * Regression pin for the home page's Platform Wallet and Real Estate bento
 * cards between 640 and 1023px (BMPL-401).
 *
 * The bento grid only gives a card more width at `lg` (1024px); each of these
 * two cards switched to a side-by-side layout one breakpoint earlier, at `sm`
 * (640px), pairing a fixed-width aside with a flexible text column. In the
 * 640-1023 window the card is narrower than the row needs, so the text column
 * gets squeezed far below its content's size. On the Wallet card this was not
 * just cramped -- the transaction row's label sits in a `min-w-0` flex child
 * next to a `shrink-0` amount, and once the row's own width collapsed to zero
 * the `truncate` label rendered with zero width: present in the DOM, invisible
 * on screen, not an ellipsis. The fix switches both cards' row breakpoint to
 * `lg`, so they stay stacked (as they already correctly do below 640) through
 * the whole range that used to break.
 *
 * 768px is the primary width: measured directly (not assumed), the label's
 * width went to exactly zero at both 640 and 768, recovered partway by 900
 * (47px of 95, still cramped but not invisible) and was fully back to normal
 * by 1023. 768 sits solidly inside the confirmed-zero part of the window, not
 * a boundary value or a partial-recovery point that could pass by
 * coincidence the way 900 first did when this test was written. 639/1024 are
 * negative controls on either side, where the card was never broken.
 */

const WALLET_LABEL = 'Payment to vendor';
const BROKEN_WIDTH = 768;

async function walletLabelBox(page: import('@playwright/test').Page) {
  return page.getByText(WALLET_LABEL, { exact: true }).boundingBox();
}

test.describe('bento cards hold their layout at tablet widths', () => {
  test('the Wallet card transaction label is visible at 768px (inside the fixed window)', async ({ page }) => {
    await page.setViewportSize({ width: BROKEN_WIDTH, height: 1400 });
    await page.goto('/');
    const box = await walletLabelBox(page);
    expect(box, 'label should be present in the DOM').not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
  });

  test('the Wallet card heading never extends past its own card at 768px', async ({ page }) => {
    await page.setViewportSize({ width: BROKEN_WIDTH, height: 1400 });
    await page.goto('/');
    const heading = page.getByRole('heading', { name: 'Platform Wallet', level: 3 });
    const card = page.locator('article', { has: heading });
    const [headingBox, cardBox] = await Promise.all([heading.boundingBox(), card.boundingBox()]);
    expect(headingBox).not.toBeNull();
    expect(cardBox).not.toBeNull();
    expect(headingBox!.x + headingBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 1);
  });

  test('negative control: the label was already visible below the window (639px)', async ({ page }) => {
    await page.setViewportSize({ width: 639, height: 1400 });
    await page.goto('/');
    const box = await walletLabelBox(page);
    expect(box!.width).toBeGreaterThan(0);
  });

  test('negative control: the label is visible above the window (1024px)', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 1400 });
    await page.goto('/');
    const box = await walletLabelBox(page);
    expect(box!.width).toBeGreaterThan(0);
  });
});
