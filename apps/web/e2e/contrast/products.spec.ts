import { test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { settleForSnapshot, CONTRAST_VIEWPORTS } from '../support/visual';
import { sweepContrast, formatSweepReport, measureFirstEyebrowForeground } from '../support/contrast-sweep';
import { assertRatchet, type KnownViolationEntry } from '../support/contrast-ratchet';

/**
 * Requirement 7's public-marketplace route (`hive/agents/god/CONTRAST-STANDARD.md`,
 * now `docs/design/CONTRAST-STANDARD.md`) -- see analytics.spec.ts in this same
 * directory for the full design reasoning. Public, no login: `/products` is one
 * of two routes (with vendors.spec.ts) chosen to MEASURE a source-derived
 * prediction rather than add route breadth for its own sake (god, 2026-10-21):
 * `.bmpl-eyebrow` reads `--bmpl-accent`, whose LIGHT value is `#0ea5e9`
 * (2.7717:1 on white, an eyebrow needs 4.5 as text-xs uppercase) -- a token
 * with 101 usages across 54 files, 34 outside dashboard/admin scope, with no
 * glass ancestor on this route (confirmed by reading page.tsx: `<main
 * className="bg-slate-50 py-10">`, no data-theme). If the prediction is right,
 * this sweep should show the "Marketplace" eyebrow (and any ProductCard
 * eyebrow) failing at every width.
 *
 * This run ALSO gates a pending code change: Oscar has an approved replacement
 * value (`#0369a1`, 5.9334:1 on white) held by god until this route and
 * vendors.spec.ts report real numbers -- a dark/saturated non-glass background
 * somewhere among 101 call sites is a risk neither of them can rule out by
 * reading source alone. Do not allowlist an eyebrow failure found here; that
 * is exactly the finding this run exists to produce.
 */

const VIEWPORTS = CONTRAST_VIEWPORTS;
const ROUTE = '/products';
const KNOWN_VIOLATIONS: KnownViolationEntry[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'contrast-known-violations.json'), 'utf8'),
);

// See analytics.spec.ts's identical copy of this comment for the full
// mechanism (Playwright restarts its worker after a failed test, resetting
// this module -- workers:1/fullyParallel:false rules out parallel splitting
// only, not that).
const discoveredPassNames = new Set<string>();
let contributedCount = 0;
let eyebrowForegroundReported = false;

function recordPassNames(result: { text: { pass: Array<{ element: { accessibleRole: string | null; accessibleName: string | null } }> }; icon: { pass: Array<{ element: { accessibleRole: string | null; accessibleName: string | null } }> } }): void {
  contributedCount += 1;
  for (const reading of [...result.text.pass, ...result.icon.pass]) {
    discoveredPassNames.add(`role=${reading.element.accessibleRole ?? '(none)'} name="${reading.element.accessibleName ?? '(none)'}"`);
  }
}

test.describe('contrast: public products listing', () => {
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
      await page.setViewportSize({ width: viewport, height: 900 });
      await page.goto(ROUTE);
      await settleForSnapshot(page);
      await page.waitForTimeout(500);

      // One-shot, fires at most once per run regardless of which width finds
      // the element first -- see contrast-sweep.ts's own comment on this
      // function for why this is a falsifiable colour check, not a general
      // instrument.
      if (!eyebrowForegroundReported) {
        const eyebrowColor = await measureFirstEyebrowForeground(page);
        if (eyebrowColor !== null) {
          console.log(`[contrast] web ${ROUTE} -- first .bmpl-eyebrow measured foreground colour: ${eyebrowColor}`);
          eyebrowForegroundReported = true;
        }
      }

      const result = await sweepContrast(page);
      console.log(formatSweepReport(`web ${ROUTE} @ ${viewport}px`, result));
      recordPassNames(result);

      if (result.text.measuredCount === 0) {
        throw new Error(`contrast sweep measured ZERO text elements on ${ROUTE} at ${viewport}px -- this is a false clean, not a pass. Investigate before trusting this run.`);
      }

      const scoped = KNOWN_VIOLATIONS.filter((e) => e.route === ROUTE && e.viewport === viewport);
      assertRatchet(result, scoped, { route: ROUTE, viewport });
    });
  }
});
