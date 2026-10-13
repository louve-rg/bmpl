import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { tryLogin } from './support/auth';

/**
 * Found during the layout-workstream sweep (god, conv-mission-2026-10-13).
 * `/dashboard/users/[id]`'s role list (`page.tsx`) renders each role as
 * `<li className="flex items-center justify-between gap-3 py-3">`: a label
 * block on the left (role name + optional status reason, no min-w-0/
 * truncate) against a StatusBadge + Suspend/Revoke button group on the
 * right -- no `flex-wrap` on the row and nothing on either side can shrink.
 * When the right-hand group's own natural width (badge + two buttons) plus
 * the label's width exceeds the viewport, the row has nowhere to go: no
 * wrap, no truncation, no scroll -- it silently overflows into the page
 * shell's own overflow-x-hidden with zero page-level scrollWidth signal.
 * Measured live at 320px: the action group's right edge at 374px, 54px
 * past the viewport, Revoke's own right edge included -- a REAL button
 * becomes genuinely unreachable, not merely visually clipped.
 *
 * Fix: add `flex-wrap` to the `li` row (matches the `flex flex-wrap
 * items-center gap-2` pattern already used throughout jobs/marketing/
 * properties page.tsx for the same badge-plus-actions shape) -- the action
 * group now drops to its own line below the label when space is tight,
 * confirmed visually via screenshot before committing.
 *
 * LOCAL ONLY / skips in CI, same shape as page-header-overflow.spec.ts and
 * master-detail-grid-overflow.spec.ts: needs a live API + a seeded
 * SUPER_ADMIN, and a real user with at least one role (any seeded account
 * works -- the mechanism does not depend on which role or how many).
 */

const EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL;
const PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD;
const STORAGE_PATH = path.join(os.tmpdir(), `bmpl-admin-e2e-super-admin-state-userdetail-${process.pid}.json`);

let loginOk = false;
let userId: string | null = null;

test.beforeAll(async ({ browser }) => {
  if (!EMAIL || !PASSWORD) return;
  const context = await browser.newContext();
  const page = await context.newPage();
  loginOk = await tryLogin(page, EMAIL, PASSWORD);
  if (loginOk) {
    await context.storageState({ path: STORAGE_PATH });
    // Any real user detail link from the Users list reproduces the
    // mechanism -- it does not depend on which user or which role.
    await page.goto('/dashboard/users');
    const href = await page.locator('a[href^="/dashboard/users/"]').first().getAttribute('href').catch(() => null);
    userId = href ? href.replace('/dashboard/users/', '') : null;
  }
  await context.close();
});

test.afterAll(() => {
  fs.rmSync(STORAGE_PATH, { force: true });
});

test.describe('[LOCAL ONLY, skips in CI -- see file header] user detail role rows stay reachable at 320px', () => {
  test.skip(!EMAIL || !PASSWORD, 'Needs SEED_SUPER_ADMIN_EMAIL/SEED_SUPER_ADMIN_PASSWORD set -- not provisioned in CI. See file header.');

  test('role row action group never extends past the viewport', async ({ browser }) => {
    test.skip(!loginOk, 'Needs a live API + a seeded SUPER_ADMIN -- login did not succeed. See file header.');
    test.skip(!userId, 'No users found to open a detail page for.');

    const context = await browser.newContext({ storageState: STORAGE_PATH, viewport: { width: 320, height: 900 } });
    const page = await context.newPage();
    await page.goto(`/dashboard/users/${userId}`);

    // Measure the actual interactive buttons, not the row -- a flex row's
    // own box stays within its parent (the `ul`, full width) even while
    // its CHILDREN overflow it (flexbox's default `min-width: auto`
    // lets a flex item ignore its container and keep its natural width).
    // That is exactly how the original defect hid: the `li` itself never
    // reported an overflow, only the badge+actions div inside it did.
    const buttons = page.locator('li button:has-text("Suspend"), li button:has-text("Restore"), li button:has-text("Revoke")');
    const count = await buttons.count();
    test.skip(count === 0, 'This user has no roles with a visible action button to measure.');

    for (let i = 0; i < count; i++) {
      const right = await buttons.nth(i).evaluate((el) => el.getBoundingClientRect().right);
      const label = await buttons.nth(i).textContent();
      expect(right, `"${label}" button right edge ${right}px at 320px viewport`).toBeLessThanOrEqual(321);
    }

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    await context.close();

    expect(scrollWidth, 'page overflow at 320px').toBeLessThanOrEqual(clientWidth + 1);
  });
});
