import { test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tryLogin, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD } from '../support/auth';
import { settleForSnapshot, VISUAL_VIEWPORTS } from '../support/visual';
import { sweepContrast, formatSweepReport } from '../support/contrast-sweep';
import { assertRatchet, type KnownViolationEntry } from '../support/contrast-ratchet';

/**
 * Requirement 7 (`hive/agents/god/CONTRAST-STANDARD.md`, now
 * `docs/design/CONTRAST-STANDARD.md` on main) -- admin's half of the first
 * real contrast check. See apps/web/e2e/contrast/analytics.spec.ts for the
 * full design reasoning; identical here except for the login (admin has no
 * separate ADMIN-role UAT password set locally/in CI today, so this uses
 * SUPER_ADMIN directly, same as the existing visual-regression smoke spec).
 *
 * HONEST GAP: contrast-known-violations.json here was seeded by running
 * this sweep for real, but only at 1440px -- 320/375 were not reachable
 * before the local shared API went down mid-build. A real violation at
 * those widths not yet on the allowlist will correctly fail this test the
 * first time it runs in CI; that is the ratchet working as intended.
 *
 * ALL SIX pixel-baseline viewports (2026-10-21) -- widened from the
 * original three (320/375/1440), reusing VISUAL_VIEWPORTS directly rather
 * than a second list. See apps/web's own copy of this file for the full
 * reasoning.
 */

const VIEWPORTS = Object.values(VISUAL_VIEWPORTS).map((v) => v.width);
const ROUTE = '/dashboard/analytics';
const KNOWN_VIOLATIONS: KnownViolationEntry[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'contrast-known-violations.json'), 'utf8'),
);

test.describe('contrast: admin analytics', () => {
  for (const viewport of VIEWPORTS) {
    test(`${ROUTE} has no un-allowlisted contrast violations at ${viewport}px`, async ({ page }) => {
      test.skip(!SUPER_ADMIN_PASSWORD, 'Needs SEED_SUPER_ADMIN_PASSWORD -- set by the visual-regression CI job, or locally per apps/admin/e2e/support/auth.ts.');
      const loggedIn = await tryLogin(page, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD!);
      test.skip(!loggedIn, 'Needs a live API + seeded dev database -- not reachable.');

      await page.setViewportSize({ width: viewport, height: 900 });
      await page.goto(ROUTE);
      await settleForSnapshot(page);
      await page.waitForTimeout(500);

      const result = await sweepContrast(page);
      console.log(formatSweepReport(`admin ${ROUTE} SUPER_ADMIN @ ${viewport}px`, result));

      if (result.text.measuredCount === 0) {
        throw new Error(`contrast sweep measured ZERO text elements on ${ROUTE} at ${viewport}px -- this is a false clean, not a pass. Investigate before trusting this run.`);
      }

      const scoped = KNOWN_VIOLATIONS.filter((e) => e.route === ROUTE && e.viewport === viewport);
      assertRatchet(result, scoped, { route: ROUTE, viewport });
    });
  }
});
