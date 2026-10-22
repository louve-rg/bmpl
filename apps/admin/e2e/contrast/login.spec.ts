import { test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { settleForSnapshot, CONTRAST_VIEWPORTS } from '../support/visual';
import { sweepContrast, formatSweepReport, writeSweepResultRecords } from '../support/contrast-sweep';
import { assertRatchet, type KnownViolationEntry } from '../support/contrast-ratchet';

/**
 * Requirement 7's admin route (`hive/agents/god/CONTRAST-STANDARD.md`, now
 * `docs/design/CONTRAST-STANDARD.md`) -- see analytics.spec.ts in this same
 * directory for the full design reasoning. `/login` is the only admin route
 * swept so far that is NOT dashboard chrome and needs no fixture/auth at all
 * -- chosen for surface diversity (a bare public-style page inside the admin
 * app), not for the `.bmpl-eyebrow` prediction (confirmed by grep: no
 * `.bmpl-eyebrow` usage on this page, so no measured-foreground-colour print
 * here -- see apps/web's products.spec.ts/vendors.spec.ts for that check).
 */

const VIEWPORTS = CONTRAST_VIEWPORTS;
const ROUTE = '/login';
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

test.describe('contrast: admin login', () => {
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
      await page.setViewportSize({ width: viewport, height: 900 });
      await page.goto(ROUTE);
      await settleForSnapshot(page);
      await page.waitForTimeout(500);

      const result = await sweepContrast(page);
      console.log(formatSweepReport(`admin ${ROUTE} @ ${viewport}px`, result));
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
