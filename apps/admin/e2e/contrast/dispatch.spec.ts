import { test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loginAsRole } from '../support/auth';
import { settleForSnapshot, CONTRAST_VIEWPORTS } from '../support/visual';
import { sweepContrast, formatSweepReport } from '../support/contrast-sweep';
import { assertRatchet, type KnownViolationEntry } from '../support/contrast-ratchet';

/**
 * MDF-376 slice 1 (god, 2026-10-22): the two highest-severity, highest-
 * exposure uncovered routes from the coverage-gap count in
 * docs/visual-baseline-exit-log.md -- a live assignment screen, at the top
 * of the owner's stated priority order ("unreadable operational controls"
 * first), inside admin's glass shell (AdminShell.tsx:161's
 * data-theme="glass", scoping the whole admin console) where the four
 * translucent text tokens render by DEFAULT, not by exception. ADDITIVE
 * ONLY: this file does not touch contrast.ts, contrast-sweep.ts,
 * contrast-ratchet.ts, or contrast-known-violations.json (stays [] in both
 * apps, unchanged by this commit). REPORT, DO NOT FIX: any violation this
 * finds is for Oscar to fix and god to sequence, not this spec's job.
 *
 * Logs in as SUPER_ADMIN, same reasoning as notifications.spec.ts: the
 * ADMIN/OPS_FULL fixture reads UAT_OPS_PASSWORD, which CI has never set
 * (9b69fa8, "no UAT_OPS_PASSWORD set here on purpose"); SUPER_ADMIN reads
 * SEED_SUPER_ADMIN_PASSWORD, which the visual-regression job does set.
 * Dispatch has no role-gated rendering split analogous to logistics/hubs's
 * OPS_LIMITED case (the assignment-mode card and delivery list render for
 * any admin who can reach /dashboard/dispatch at all), so one fixture
 * covers both routes below.
 */

const VIEWPORTS = CONTRAST_VIEWPORTS;
const LIST_ROUTE = '/dashboard/dispatch';
// A label for the ratchet/report context only, not a real path -- the
// detail route is dynamic and the actual id is discovered at runtime from
// whatever the seeded DB has (see the detail describe block below).
// KNOWN_VIOLATIONS stays [] in this app, so no entry is ever scoped to this
// literal string either way.
const DETAIL_ROUTE_LABEL = '/dashboard/dispatch/[id]';
const KNOWN_VIOLATIONS: KnownViolationEntry[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'contrast-known-violations.json'), 'utf8'),
);

// See analytics.spec.ts's identical copy of this comment for the full
// mechanism (Playwright restarts its worker after a failed test, resetting
// this module -- workers:1/fullyParallel:false rules out parallel splitting
// only, not that). Built as a factory, not a module-level singleton like
// the single-route spec files, because this file covers TWO routes and a
// shared accumulator would mix the list route's discovered pass names into
// the detail route's report (or vice versa) on a worker restart.
function makeRecorder() {
  const discoveredPassNames = new Set<string>();
  let contributedCount = 0;
  function recordPassNames(result: { text: { pass: Array<{ element: { accessibleRole: string | null; accessibleName: string | null } }> }; icon: { pass: Array<{ element: { accessibleRole: string | null; accessibleName: string | null } }> } }): void {
    contributedCount += 1;
    for (const reading of [...result.text.pass, ...result.icon.pass]) {
      discoveredPassNames.add(`role=${reading.element.accessibleRole ?? '(none)'} name="${reading.element.accessibleName ?? '(none)'}"`);
    }
  }
  function report(label: string) {
    const scope = contributedCount >= VIEWPORTS.length ? 'across all widths' : `across the ${contributedCount} width(s) this worker ran before restarting (NOT all ${VIEWPORTS.length} -- see this block's own comment)`;
    console.log(`[contrast] admin ${label} -- pass-bucket elements discovered ${scope}, contributed=${contributedCount}/${VIEWPORTS.length} (deduped by role+name; absence below is only "not discovered" when contributed equals the total):`);
    if (discoveredPassNames.size === 0) {
      console.log('  (none -- either nothing passed at any contributing width, or every test above was skipped/threw)');
    } else {
      for (const name of [...discoveredPassNames].sort()) console.log(`  - ${name}`);
    }
  }
  return { recordPassNames, report };
}

test.describe('contrast: admin dispatch list', () => {
  const { recordPassNames, report } = makeRecorder();
  test.afterAll(() => report(LIST_ROUTE));

  for (const viewport of VIEWPORTS) {
    test(`${LIST_ROUTE} has no un-allowlisted contrast violations at ${viewport}px`, async ({ page }) => {
      const loggedIn = await loginAsRole(page, 'SUPER_ADMIN');
      test.skip(!loggedIn, 'Needs SEED_SUPER_ADMIN_PASSWORD and a live API -- set by the visual-regression CI job, or locally per apps/admin/e2e/support/auth.ts.');

      await page.setViewportSize({ width: viewport, height: 900 });
      await page.goto(LIST_ROUTE);
      await settleForSnapshot(page);
      await page.waitForTimeout(500);

      const result = await sweepContrast(page);
      console.log(formatSweepReport(`admin ${LIST_ROUTE} SUPER_ADMIN @ ${viewport}px`, result));
      recordPassNames(result);

      if (result.text.measuredCount === 0) {
        throw new Error(`contrast sweep measured ZERO text elements on ${LIST_ROUTE} at ${viewport}px -- this is a false clean, not a pass. Investigate before trusting this run.`);
      }

      const scoped = KNOWN_VIOLATIONS.filter((e) => e.route === LIST_ROUTE && e.viewport === viewport);
      assertRatchet(result, scoped, { route: LIST_ROUTE, viewport });
    });
  }
});

test.describe('contrast: admin dispatch detail', () => {
  const { recordPassNames, report } = makeRecorder();
  test.afterAll(() => report(DETAIL_ROUTE_LABEL));

  for (const viewport of VIEWPORTS) {
    test(`${DETAIL_ROUTE_LABEL} has no un-allowlisted contrast violations at ${viewport}px`, async ({ page }) => {
      const loggedIn = await loginAsRole(page, 'SUPER_ADMIN');
      test.skip(!loggedIn, 'Needs SEED_SUPER_ADMIN_PASSWORD and a live API -- set by the visual-regression CI job, or locally per apps/admin/e2e/support/auth.ts.');

      await page.setViewportSize({ width: viewport, height: 900 });
      await page.goto(LIST_ROUTE);
      await settleForSnapshot(page);

      // The detail route is dynamic; there is no fixed id to hard-code
      // without inventing data (CLAUDE.md S5 forbids fabricated business
      // data, and a fake id would only exercise the detail page's error
      // state, not its real content). Discover a real delivery the same way
      // an operator would -- by following the list page's own row link --
      // and skip cleanly, not falsely, if this environment has none at all.
      const detailLink = page.locator(`a[href^="${LIST_ROUTE}/"]`).first();
      const hasRow = (await detailLink.count()) > 0;
      test.skip(!hasRow, 'No delivery rows in this environment -- the detail page cannot be reached without a real delivery id, and one is not fabricated here (CLAUDE.md S5).');

      const href = await detailLink.getAttribute('href');
      await page.goto(href!);
      await settleForSnapshot(page);
      await page.waitForTimeout(500);

      const result = await sweepContrast(page);
      console.log(formatSweepReport(`admin ${href} SUPER_ADMIN @ ${viewport}px`, result));
      recordPassNames(result);

      if (result.text.measuredCount === 0) {
        throw new Error(`contrast sweep measured ZERO text elements on ${href} at ${viewport}px -- this is a false clean, not a pass. Investigate before trusting this run.`);
      }

      const scoped = KNOWN_VIOLATIONS.filter((e) => e.route === DETAIL_ROUTE_LABEL && e.viewport === viewport);
      assertRatchet(result, scoped, { route: DETAIL_ROUTE_LABEL, viewport });
    });
  }
});
