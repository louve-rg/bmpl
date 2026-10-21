import { test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loginAsRole } from '../support/auth';
import { settleForSnapshot, CONTRAST_VIEWPORTS } from '../support/visual';
import { sweepContrast, formatSweepReport } from '../support/contrast-sweep';
import { assertRatchet, type KnownViolationEntry } from '../support/contrast-ratchet';

/**
 * Requirement 7 (`hive/agents/god/CONTRAST-STANDARD.md`, now
 * `docs/design/CONTRAST-STANDARD.md` on main) — the first real contrast
 * check, against the page this standard's own write-up names a violation
 * on (vendor "Net revenue" KPI). See
 * `hive/agents/jim-mv09alb5/priority7-contrast-ci-approach-2026-10-16.md`
 * for the full design: why the existing pixel sampler over a DOM walker,
 * the three PASS/FAIL/AMBIGUOUS buckets, the ratchet allowlist.
 *
 * NINE WIDTHS (2026-10-21) -- widened from the original three (320/375/
 * 1440) to CONTRAST_VIEWPORTS, the union of the six pixel-baseline
 * breakpoint widths AND the owner's eight required real-device
 * verification widths (previously recorded only in a QA agent's own
 * memory, not in this repo -- see visual.ts's own header on
 * CONTRAST_VIEWPORTS for exactly where, and why two legitimate sets
 * differ). Cheap to add: no new dev-server lifecycle, only more
 * per-viewport test runs against the one already running. 320 remains the
 * one most likely to show a reflow onto a different ancestor background,
 * which is exactly what this check measures, but it is no longer the only
 * width checked.
 *
 * `measuredCount > 0` is asserted as the FIRST check, before any ratio --
 * a run that silently measures nothing must fail loud, never pass by
 * omission (the owner's "unverified coverage must be reported honestly"
 * acceptance criterion).
 *
 * HONEST GAP, stated rather than hidden: `contrast-known-violations.json`
 * was seeded by actually running this sweep against the live local stack,
 * but only at 1440px (the local shared API went down partway through this
 * build, before 320/375 could be run the same way -- see this change's own
 * PR description). If a real, currently-true violation exists at 320 or
 * 375 that is not yet on the allowlist, THIS TEST WILL CORRECTLY FAIL THE
 * FIRST TIME IT RUNS IN CI -- that is the ratchet working as designed, not
 * a bug: an unreviewed failure should block until a human either fixes it
 * or adds it to the allowlist with a real reason, exactly like the one
 * already there for 1440px.
 */

const VIEWPORTS = CONTRAST_VIEWPORTS;
const ROUTE = '/dashboard/analytics';
const KNOWN_VIOLATIONS: KnownViolationEntry[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'contrast-known-violations.json'), 'utf8'),
);

test.describe('contrast: vendor analytics', () => {
  for (const viewport of VIEWPORTS) {
    test(`${ROUTE} has no un-allowlisted contrast violations at ${viewport}px`, async ({ page }) => {
      const loggedIn = await loginAsRole(page, 'VENDOR');
      test.skip(!loggedIn, 'Needs a live API + seeded dev database with the UAT vendor fixture (packages/database/prisma/seed-uat-roles.ts) -- not provisioned in CI unless the visual-regression job seeded it.');

      await page.setViewportSize({ width: viewport, height: 900 });
      await page.goto(ROUTE);
      await settleForSnapshot(page);
      await page.waitForTimeout(500); // chart/KPI data settles after the initial paint, same page this standard's own debt was found on

      const result = await sweepContrast(page);
      console.log(formatSweepReport(`web ${ROUTE} VENDOR @ ${viewport}px`, result));

      if (result.text.measuredCount === 0) {
        throw new Error(`contrast sweep measured ZERO text elements on ${ROUTE} at ${viewport}px -- this is a false clean, not a pass. Investigate before trusting this run.`);
      }

      const scoped = KNOWN_VIOLATIONS.filter((e) => e.route === ROUTE && e.viewport === viewport);
      assertRatchet(result, scoped, { route: ROUTE, viewport });
    });
  }
});
