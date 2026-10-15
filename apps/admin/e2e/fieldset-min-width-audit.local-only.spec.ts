import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { tryLogin } from './support/auth';

/**
 * The seeded SUPER_ADMIN account (packages/database/prisma/seed.ts), not the
 * UAT ops fixtures from support/auth.ts -- those hold `logistics.*`
 * permissions (hub/route/leg config) for the manual-dispatch walkthrough,
 * not `ops.read`/`ops.manage` (the platform announcement console this page
 * actually gates on). Confirmed live: SUPER_ADMIN_EMAIL 403'd with "You don't
 * have the ops.read permission" on first attempt.
 */
const SUPER_ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@bzemarketplace.com';
const SUPER_ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD;

/**
 * *** LOCAL ONLY, SKIPS IN CI -- same reason as the apps/web siblings:
 * *** /dashboard/* needs a real live API behind a real login.
 *
 * MDF-278 fieldset audit, admin app half: apps/admin/app/dashboard/ops/
 * page.tsx:295 is the one remaining fieldset of the 8, and the one with
 * the clearest live stress vector -- an admin-typed `announcementMessage`
 * (Textarea, maxLength 500) renders in a live Preview block
 * (`<span className="flex-1">{announcementMessage.trim()}</span>`) inside
 * a `flex items-start gap-3` row, itself inside the fieldset. Measured
 * with a real long unbroken string typed into the real Textarea, not
 * mocked -- the fieldset's own `initial` data comes from a real admin
 * login, so there is nothing to intercept here.
 */

const WIDTHS = [320, 375, 768, 1024, 1440];
const OPS_STORAGE = path.join(os.tmpdir(), `bmpl-e2e-fieldset-audit-ops-${process.pid}.json`);
const LONG_ANNOUNCEMENT =
  'Belizecitytownandalldistrictsservedbythisplatformareexperiencingaonetimeschedulingadjustmentnotification';

let loginOk = false;

test.beforeAll(async ({ browser }) => {
  if (!SUPER_ADMIN_PASSWORD) return;
  const context = await browser.newContext();
  const page = await context.newPage();
  loginOk = await tryLogin(page, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
  if (loginOk) await context.storageState({ path: OPS_STORAGE });
  await context.close();
});

test.afterAll(() => {
  fs.rmSync(OPS_STORAGE, { force: true });
});

function skipIfNoSession() {
  test.skip(!SUPER_ADMIN_PASSWORD || !loginOk, 'Needs a live API + seeded dev database with SEED_SUPER_ADMIN_PASSWORD set.');
}

test.describe('[LOCAL ONLY, skips in CI] MDF-278 fieldset audit: admin ops/page.tsx:295 (announcement/maintenance, stress-tested)', () => {
  for (const width of WIDTHS) {
    test(`announcement fieldset (incl. live Preview) stays inside the viewport at ${width}px`, async ({ browser }) => {
      skipIfNoSession();
      const context = await browser.newContext({ storageState: OPS_STORAGE, viewport: { width, height: 900 } });
      const page = await context.newPage();
      await page.goto('/dashboard/ops');

      const textarea = page.locator('#ann-message');
      await expect(textarea).toBeVisible();
      await textarea.fill(LONG_ANNOUNCEMENT);

      const activeCheckbox = page.locator('label', { hasText: 'Show announcement banner' }).locator('input[type="checkbox"]');
      if (!(await activeCheckbox.isChecked())) await activeCheckbox.check();

      const preview = page.locator('span.flex-1', { hasText: LONG_ANNOUNCEMENT });
      await expect(preview).toBeVisible();

      const fieldset = page.locator('fieldset', { hasText: 'Announcement message' });
      const box = await fieldset.boundingBox();
      await context.close();

      expect(box, `no fieldset box at ${width}px`).not.toBeNull();
      expect(
        box!.x + box!.width,
        `announcement fieldset right edge ${(box!.x + box!.width).toFixed(1)} at ${width}px with a long unbroken announcement`,
      ).toBeLessThanOrEqual(width + 1);
    });
  }
});
