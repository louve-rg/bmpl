import { test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loginAsRole } from '../support/auth';
import { settleForSnapshot, CONTRAST_VIEWPORTS } from '../support/visual';
import { sweepContrast, formatSweepReport, writeSweepResultRecords } from '../support/contrast-sweep';
import { assertRatchet, type KnownViolationEntry } from '../support/contrast-ratchet';

/**
 * Requirement 7 regression coverage for the same recurring bug class as
 * apps/web's store.spec.ts/settlements.spec.ts (god, 2026-10-21):
 * `belize-navy`, a static Tailwind colour with no glass variant, used as a
 * foreground on glass. This route's instance is the "Unread only" checkbox
 * label (measured 1.02:1 by computed style), reproducing for BOTH admin
 * roles -- a component-level defect, not role-gated. Logs in as SUPER_ADMIN,
 * not the ADMIN/OPS_FULL fixture: `apps/admin/e2e/support/auth.ts`'s ADMIN
 * fixture reads `UAT_OPS_PASSWORD`, which CI has never set since 9b69fa8
 * ("no UAT_OPS_PASSWORD set here on purpose") -- a deliberate local-only
 * decision, not a bug. ADMIN would silently skip in CI, not fail, giving
 * false confidence that this spec was proving anything. SUPER_ADMIN reads
 * `SEED_SUPER_ADMIN_PASSWORD`, which the visual-regression job does set
 * (confirmed live by analytics.spec.ts passing under it in the same job),
 * and the bug is not role-gated, so it is an equally valid fixture here.
 * Fixed by Oscar's `fix/glass-navy-text-admin` batch (merged as #483,
 * `ebea002`) -- this should now go GREEN in CI.
 */

const VIEWPORTS = CONTRAST_VIEWPORTS;
const ROUTE = '/dashboard/notifications';
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

test.describe('contrast: admin notifications', () => {
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
    test(`${ROUTE} has no un-allowlisted contrast violations at ${viewport}px`, async ({ page }) => {
      const loggedIn = await loginAsRole(page, 'SUPER_ADMIN');
      test.skip(!loggedIn, 'Needs SEED_SUPER_ADMIN_PASSWORD and a live API -- set by the visual-regression CI job, or locally per apps/admin/e2e/support/auth.ts.');

      await page.setViewportSize({ width: viewport, height: 900 });
      await page.goto(ROUTE);
      await settleForSnapshot(page);
      await page.waitForTimeout(500);

      const result = await sweepContrast(page);
      console.log(formatSweepReport(`admin ${ROUTE} SUPER_ADMIN @ ${viewport}px`, result));
      recordPassNames(result);
      writeSweepResultRecords(result, { route: ROUTE, viewport });

      if (result.text.measuredCount === 0) {
        throw new Error(`contrast sweep measured ZERO text elements on ${ROUTE} at ${viewport}px -- this is a false clean, not a pass. Investigate before trusting this run.`);
      }

      const scoped = KNOWN_VIOLATIONS.filter((e) => e.route === ROUTE && e.viewport === viewport);
      assertRatchet(result, scoped, { route: ROUTE, viewport });
    });
  }
});
