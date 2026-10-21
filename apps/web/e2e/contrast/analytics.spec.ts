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

// Discovered-and-passed names, across widths that reached recordPassNames
// within ONE worker lifetime. The per-viewport fail/ambiguous lines already
// answer "found, and it failed" for an element; nothing anywhere answered
// "found, and it passed" vs "never found at all" for the SAME element, at
// any viewport -- that's what this accumulates (deduped role+name) and
// prints via afterAll instead of one line per element per viewport (9 widths
// x up to 60 elements would bury the lines that actually matter under
// hundreds of rows).
// workers:1/fullyParallel:false (playwright.contrast.config.ts, not the base
// playwright.config.ts -- confirmed by reading the actual config
// `test:contrast` runs, after an earlier verification read the wrong file)
// rules out PARALLEL splitting, but NOT this: Playwright restarts its worker
// process after a failed test, which reloads this module fresh -- so on a
// run where every test fails, this accumulator never spans more than one
// viewport (god, 2026-10-21). The contributed=N/widths header below says so
// honestly instead of claiming "across all widths" when it wasn't.
const discoveredPassNames = new Set<string>();
// Widths that actually reached recordPassNames (sweepContrast returned, no
// throw) -- a skipped test (no seeded fixture, no live API) or a width whose
// sweepContrast call throws before returning never increments this, and never
// contributes a name either. Without this counter, absence from the pass list
// is ambiguous between "checked and not found" and "never checked" -- exactly
// the gap this whole print exists to close, just one level up (god,
// 2026-10-21): "$0.00 is absent from the pass list" only means NOT DISCOVERED
// if contributed === VIEWPORTS.length; otherwise it means unknown for
// whichever widths didn't contribute.
let contributedCount = 0;

function recordPassNames(result: { text: { pass: Array<{ element: { accessibleRole: string | null; accessibleName: string | null } }> }; icon: { pass: Array<{ element: { accessibleRole: string | null; accessibleName: string | null } }> } }): void {
  contributedCount += 1;
  for (const reading of [...result.text.pass, ...result.icon.pass]) {
    discoveredPassNames.add(`role=${reading.element.accessibleRole ?? '(none)'} name="${reading.element.accessibleName ?? '(none)'}"`);
  }
}

test.describe('contrast: vendor analytics', () => {
  test.afterAll(() => {
    // UNCONDITIONAL -- not gated on any failure existing. A fully-green run
    // is exactly the run where "discovered and passed" vs "never discovered"
    // matters most, because green plus silence is the ambiguous case this
    // print exists to close.
    //
    // WORDING FIX, NOT A MECHANISM FIX (god, 2026-10-21): Playwright restarts
    // its worker process after a failed test, which reloads this module and
    // resets discoveredPassNames/contributedCount -- so on a run where every
    // test fails, this fires once per test, each time having only seen ONE
    // viewport, not accumulated across all nine. The header below used to
    // unconditionally say "across all widths", which is false whenever
    // contributed < VIEWPORTS.length -- exactly the failure mode this print
    // exists to prevent, just one level up. Fixed to say what actually
    // happened; true aggregation across worker restarts (afterAll writes to
    // a file, a custom reporter unions them) is deliberately NOT done here --
    // that is new measurement machinery, and this run is mid-measurement.
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
      await page.waitForTimeout(500); // chart/KPI data settles after the initial paint, same page this standard's own debt was found on

      const result = await sweepContrast(page);
      console.log(formatSweepReport(`web ${ROUTE} VENDOR @ ${viewport}px`, result));
      recordPassNames(result);

      if (result.text.measuredCount === 0) {
        throw new Error(`contrast sweep measured ZERO text elements on ${ROUTE} at ${viewport}px -- this is a false clean, not a pass. Investigate before trusting this run.`);
      }

      const scoped = KNOWN_VIOLATIONS.filter((e) => e.route === ROUTE && e.viewport === viewport);
      assertRatchet(result, scoped, { route: ROUTE, viewport });
    });
  }
});
