import { test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tryLogin, OPS_LIMITED_EMAIL, OPS_PASSWORD } from '../support/auth';
import { settleForSnapshot, CONTRAST_VIEWPORTS } from '../support/visual';
import { sweepContrast, formatSweepReport } from '../support/contrast-sweep';
import { assertRatchet, type KnownViolationEntry } from '../support/contrast-ratchet';

/**
 * Requirement 7 regression coverage, same bug class as notifications.spec.ts
 * (god, 2026-10-21): `belize-navy` as a foreground on glass. This route's
 * instance -- the courier fee values, 5 nodes, measured 1.03:1 -- is visible
 * ONLY to the read-only ops role, not the manage role, so this spec logs in
 * as OPS_LIMITED directly (not `loginAsRole`, which only covers ADMIN/
 * SUPER_ADMIN today -- OPS_LIMITED_EMAIL/OPS_PASSWORD are already exported
 * for exactly this case, per auth.ts's own comment on the #12 permission
 * split; no new fixture built for this). Fixed by Oscar's
 * `fix/glass-navy-text-admin` batch, off `e953569`, not yet merged --
 * EXPECT THIS TO FAIL IN CI RIGHT NOW, the same deliberate-regression
 * pattern as the other three specs in this cluster. Do not allowlist it.
 */

const VIEWPORTS = CONTRAST_VIEWPORTS;
const ROUTE = '/dashboard/logistics/hubs';
const KNOWN_VIOLATIONS: KnownViolationEntry[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'contrast-known-violations.json'), 'utf8'),
);

// See analytics.spec.ts's identical copy of this comment for the full
// mechanism (Playwright restarts its worker after a failed test, resetting
// this module -- workers:1/fullyParallel:false rules out parallel splitting
// only, not that).
const discoveredPassNames = new Set<string>();
let contributedCount = 0;

function recordPassNames(result: { text: { pass: Array<{ element: { accessibleRole: string | null; accessibleName: string | null } }> }; icon: { pass: Array<{ element: { accessibleRole: string | null; accessibleName: string | null } }> } }): void {
  contributedCount += 1;
  for (const reading of [...result.text.pass, ...result.icon.pass]) {
    discoveredPassNames.add(`role=${reading.element.accessibleRole ?? '(none)'} name="${reading.element.accessibleName ?? '(none)'}"`);
  }
}

test.describe('contrast: admin logistics hubs (read-only ops)', () => {
  test.afterAll(() => {
    const scope = contributedCount >= VIEWPORTS.length ? 'across all widths' : `across the ${contributedCount} width(s) this worker ran before restarting (NOT all ${VIEWPORTS.length} -- see this block's own comment)`;
    console.log(`[contrast] admin ${ROUTE} -- pass-bucket elements discovered ${scope}, contributed=${contributedCount}/${VIEWPORTS.length} (deduped by role+name; absence below is only "not discovered" when contributed equals the total):`);
    if (discoveredPassNames.size === 0) {
      console.log('  (none -- either nothing passed at any contributing width, or every test above was skipped/threw)');
    } else {
      for (const name of [...discoveredPassNames].sort()) console.log(`  - ${name}`);
    }
  });

  for (const viewport of VIEWPORTS) {
    test(`${ROUTE} has no un-allowlisted contrast violations at ${viewport}px (OPS_LIMITED)`, async ({ page }) => {
      test.skip(!OPS_PASSWORD, 'Needs UAT_OPS_PASSWORD and a live API -- set by the visual-regression CI job, or locally per apps/admin/e2e/support/auth.ts.');
      const loggedIn = await tryLogin(page, OPS_LIMITED_EMAIL, OPS_PASSWORD!);
      test.skip(!loggedIn, 'Needs a live API + seeded dev database with the OPS_LIMITED UAT fixture (packages/database/prisma/seed-uat-logistics.ts) -- not provisioned in CI unless the visual-regression job seeded it.');

      await page.setViewportSize({ width: viewport, height: 900 });
      await page.goto(ROUTE);
      await settleForSnapshot(page);
      await page.waitForTimeout(500);

      const result = await sweepContrast(page);
      console.log(formatSweepReport(`admin ${ROUTE} OPS_LIMITED @ ${viewport}px`, result));
      recordPassNames(result);

      if (result.text.measuredCount === 0) {
        throw new Error(`contrast sweep measured ZERO text elements on ${ROUTE} at ${viewport}px -- this is a false clean, not a pass. Investigate before trusting this run.`);
      }

      const scoped = KNOWN_VIOLATIONS.filter((e) => e.route === ROUTE && e.viewport === viewport);
      assertRatchet(result, scoped, { route: ROUTE, viewport });
    });
  }
});
