import { test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loginAsRole } from '../support/auth';
import { settleForSnapshot, CONTRAST_VIEWPORTS } from '../support/visual';
import { sweepContrast, formatSweepReport, measureForegroundColorsByText, writeSweepResultRecords } from '../support/contrast-sweep';
import { assertRatchet, type KnownViolationEntry } from '../support/contrast-ratchet';
import { sampleContrast } from '../support/contrast';

/**
 * Requirement 7's second swept route (`hive/agents/god/CONTRAST-STANDARD.md`,
 * now `docs/design/CONTRAST-STANDARD.md`) -- see analytics.spec.ts in this
 * same directory for the full design reasoning (three-bucket sweep, the
 * ratchet allowlist, the pass/ambiguous prints). This file is deliberately
 * its OWN push and its own commit, not bundled with any other route or any
 * other change (god, 2026-10-21): it is a DELIBERATE REGRESSION TEST for a
 * confirmed, not-yet-fixed defect (MDF-357) -- Dwight hand-measured the
 * StorefrontView sidebar on this exact route at ~1.78:1 against a bg-white
 * frame that predates the glass token system (owner's own 1.17-1.84 range).
 *
 * EXPECT THIS TO FAIL IN CI RIGHT NOW. That is the point, not a regression in
 * this change -- it is the first req-7 case where a test goes red BEFORE a
 * fix lands and is expected to go green AFTER it, rather than being verified
 * only by absence or by eye. Do not "fix" the ratchet, the sweep, or this
 * spec to make it pass; the fix belongs in the StorefrontView component
 * (Oscar, MDF-357). Once that fix lands, this test should go green with no
 * change needed here.
 *
 * ALSO A PREDICTION TEST ON THE INSTRUMENT ITSELF: the failing composite is a
 * flat opaque mid-gray (.bmpl-card's glass token composited under a solid
 * bg-white frame), not a gradient or mural edge -- so dominantShare should
 * come out HIGH and this reading should land in the FAIL bucket, not
 * ambiguous (god, 2026-10-21). If it lands in ambiguous instead, that
 * prediction is wrong and the "fail bucket is trustworthy, ambiguous bucket
 * is glass-blind" story from the ratchet change needs revisiting -- report
 * the dominantShare either way, don't just report pass/fail.
 *
 * AFTER #477: the post-fix sweep reports TWO readings sharing the accessible
 * name "uat-vendor@bzemarketplace.com" at very different ratios (one outright
 * pass, one ambiguous-would-pass at 17.24) -- a discriminating test, not a
 * guess (god, 2026-10-21): print getComputedStyle(el).color for every leaf
 * element with that exact text. The hardcoded `text-slate-600` line (the
 * actual MDF-357 defect element, StorefrontView.tsx:184) should read
 * rgb(71, 85, 105); anything else at that position means the account of which
 * node is the defect element is wrong and needs revisiting before this test
 * is trusted as a clean before/after proof.
 */

const VIEWPORTS = CONTRAST_VIEWPORTS;
const ROUTE = '/dashboard/store/preview';
const KNOWN_VIOLATIONS: KnownViolationEntry[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'contrast-known-violations.json'), 'utf8'),
);

// See analytics.spec.ts's identical copy of this comment for the full
// mechanism (Playwright restarts its worker after a failed test, resetting
// this module -- workers:1/fullyParallel:false rules out parallel splitting
// only, not that).
const discoveredPassNames = new Set<string>();
let contributedCount = 0;
let emailColorsReported = false;
let ratingCountRatioReported = false;

function recordPassNames(result: { text: { pass: Array<{ element: { accessibleRole: string | null; accessibleName: string | null } }> }; icon: { pass: Array<{ element: { accessibleRole: string | null; accessibleName: string | null } }> } }): void {
  contributedCount += 1;
  for (const reading of [...result.text.pass, ...result.icon.pass]) {
    discoveredPassNames.add(`role=${reading.element.accessibleRole ?? '(none)'} name="${reading.element.accessibleName ?? '(none)'}"`);
  }
}

test.describe('contrast: vendor store preview', () => {
  test.afterAll(() => {
    const scope = contributedCount >= VIEWPORTS.length ? 'across all widths' : `across the ${contributedCount} width(s) this worker ran before restarting (NOT all ${VIEWPORTS.length} -- see this block's own comment)`;
    console.log(`[contrast] web ${ROUTE} -- pass-bucket elements discovered ${scope}, contributed=${contributedCount}/${VIEWPORTS.length} (deduped by role+name; absence below is only "not discovered" when contributed equals the total):`);
    if (discoveredPassNames.size === 0) {
      console.log('  (none -- either nothing passed at any contributing width, or every test above was skipped/threw)');
    } else {
      for (const name of [...discoveredPassNames].sort()) console.log(`  - ${name}`);
    }
  });

  for (const viewport of VIEWPORTS) {
    test(`${ROUTE} has no un-allowlisted contrast violations at ${viewport}px`, async ({ page }) => {
      const loggedIn = await loginAsRole(page, 'VENDOR');
      test.skip(!loggedIn, 'Needs a live API + seeded dev database with the UAT vendor fixture (packages/database/prisma/seed-uat-roles.ts) -- not provisioned in CI unless the visual-regression job seeded it.');

      await page.setViewportSize({ width: viewport, height: 900 });
      await page.goto(ROUTE);
      await settleForSnapshot(page);
      await page.waitForTimeout(500);

      // One-shot, fires at most once per run -- see this file's own header
      // comment, "AFTER #477", for what this discriminates.
      if (!emailColorsReported) {
        const colors = await measureForegroundColorsByText(page, 'uat-vendor@bzemarketplace.com');
        if (colors.length > 0) {
          console.log(`[contrast] web ${ROUTE} -- "uat-vendor@bzemarketplace.com" measured foreground colour(s): ${colors.join(', ')}`);
          emailColorsReported = true;
        }
      }

      // One-shot, fires at most once per run (MDF-376): directly re-samples
      // the real text node behind StarRating.tsx's `role="img"` count span
      // via the already-existing single-locator `sampleContrast`, as an
      // independent cross-check of the fixed sweep's own PASS-bucket
      // discovery for this exact node now that `isExemptForText`
      // (contrast-sweep.ts) routes it through the text path.
      if (!ratingCountRatioReported) {
        const noReviewsLocator = page.getByText('No reviews yet', { exact: true });
        if ((await noReviewsLocator.count()) > 0) {
          const reading = await sampleContrast(noReviewsLocator.first());
          console.log(
            `[contrast] web ${ROUTE} -- one-shot sampleContrast on name="No reviews yet" leaf (StarRating.tsx:73-75's count span) @ ${viewport}px: ratio=${reading.ratio} dominantShare=${reading.dominantShare} fg=rgb(${reading.foreground.r},${reading.foreground.g},${reading.foreground.b}) bg=rgb(${reading.dominantBackground.r},${reading.dominantBackground.g},${reading.dominantBackground.b})`,
          );
          ratingCountRatioReported = true;
        }
      }

      const result = await sweepContrast(page);
      console.log(formatSweepReport(`web ${ROUTE} VENDOR @ ${viewport}px`, result));
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
