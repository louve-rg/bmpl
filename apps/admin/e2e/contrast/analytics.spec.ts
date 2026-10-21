import { test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tryLogin, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD } from '../support/auth';
import { settleForSnapshot, CONTRAST_VIEWPORTS } from '../support/visual';
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
 * NINE WIDTHS (2026-10-21) -- widened from the original three (320/375/
 * 1440) to CONTRAST_VIEWPORTS, the union of the pixel-baseline breakpoint
 * widths and the owner's real-device verification widths. See apps/web's
 * own copy of this file, and visual.ts's CONTRAST_VIEWPORTS comment, for
 * the full reasoning.
 */

const VIEWPORTS = CONTRAST_VIEWPORTS;
const ROUTE = '/dashboard/analytics';
const KNOWN_VIOLATIONS: KnownViolationEntry[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'contrast-known-violations.json'), 'utf8'),
);

// Discovered-and-passed names, across widths that reached recordPassNames
// within ONE worker lifetime -- see apps/web's identical copy of this
// comment. workers:1/fullyParallel:false (playwright.contrast.config.ts, not
// the base playwright.config.ts -- confirmed by reading the actual config
// `test:contrast` runs, after an earlier verification read the wrong file)
// rules out PARALLEL splitting, but NOT this: Playwright restarts its worker
// process after a failed test, which reloads this module fresh -- so on a
// run where every test fails, this accumulator never spans more than one
// viewport (god, 2026-10-21). The contributed=N/widths header below says so
// honestly instead of claiming "across all widths" when it wasn't.
const discoveredPassNames = new Set<string>();
// See apps/web's identical copy of this comment: counts widths that actually
// reached recordPassNames, so absence from the pass list below can be read
// as NOT DISCOVERED only when contributed equals the total -- otherwise it's
// unknown for whichever widths skipped or threw (god, 2026-10-21).
let contributedCount = 0;

function recordPassNames(result: { text: { pass: Array<{ element: { accessibleRole: string | null; accessibleName: string | null } }> }; icon: { pass: Array<{ element: { accessibleRole: string | null; accessibleName: string | null } }> } }): void {
  contributedCount += 1;
  for (const reading of [...result.text.pass, ...result.icon.pass]) {
    discoveredPassNames.add(`role=${reading.element.accessibleRole ?? '(none)'} name="${reading.element.accessibleName ?? '(none)'}"`);
  }
}

test.describe('contrast: admin analytics', () => {
  test.afterAll(() => {
    // UNCONDITIONAL, and WORDING FIX not a mechanism fix -- see apps/web's
    // identical copy of this block for the full reasoning (god, 2026-10-21):
    // Playwright restarts its worker after a failed test, resetting this
    // module, so "across all widths" was false whenever contributed < total.
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
      test.skip(!SUPER_ADMIN_PASSWORD, 'Needs SEED_SUPER_ADMIN_PASSWORD -- set by the visual-regression CI job, or locally per apps/admin/e2e/support/auth.ts.');
      const loggedIn = await tryLogin(page, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD!);
      test.skip(!loggedIn, 'Needs a live API + seeded dev database -- not reachable.');

      await page.setViewportSize({ width: viewport, height: 900 });
      await page.goto(ROUTE);
      await settleForSnapshot(page);
      await page.waitForTimeout(500);

      // TEMPORARY DIAGNOSTIC, TO BE REMOVED once the mechanism is found --
      // PageHeader's eyebrow/title/description (ui.tsx:122-129) are
      // under-discovered by the sweep at most of the nine widths, while
      // EmptyState's own description text on the SAME page, SAME run, is
      // discovered and passing every time (god, 2026-10-21) -- so this is
      // not a page-wide or worker-cold-load timing issue, it is specific to
      // PageHeader. Logs the real box + computed style for PageHeader's
      // three text children and their shared min-w-0 parent at the exact
      // moment sweepContrast is about to sample them, independent of and
      // without touching contrast-sweep.ts's own discovery/scoring code.
      const pageHeaderDiag = await page.evaluate(() => {
        const texts = ['Insights', 'Platform analytics', 'Marketplace performance'];
        const found: Array<{ text: string; tag: string; box: DOMRect | null; display: string; visibility: string; opacity: string; parentBox: DOMRect | null }> = [];
        for (const needle of texts) {
          const el = [...document.querySelectorAll('p, h1')].find((e) => (e.textContent || '').trim().startsWith(needle));
          if (!el) {
            found.push({ text: needle, tag: '(not found in DOM at all)', box: null, display: '', visibility: '', opacity: '', parentBox: null });
            continue;
          }
          const cs = getComputedStyle(el);
          const parent = el.parentElement;
          found.push({
            text: needle,
            tag: el.tagName,
            box: el.getBoundingClientRect(),
            display: cs.display,
            visibility: cs.visibility,
            opacity: cs.opacity,
            parentBox: parent ? parent.getBoundingClientRect() : null,
          });
        }
        return found;
      });
      console.log(`[diag] admin PageHeader @ ${viewport}px: ${JSON.stringify(pageHeaderDiag)}`);

      const result = await sweepContrast(page);
      console.log(formatSweepReport(`admin ${ROUTE} SUPER_ADMIN @ ${viewport}px`, result));
      recordPassNames(result);

      if (result.text.measuredCount === 0) {
        throw new Error(`contrast sweep measured ZERO text elements on ${ROUTE} at ${viewport}px -- this is a false clean, not a pass. Investigate before trusting this run.`);
      }

      const scoped = KNOWN_VIOLATIONS.filter((e) => e.route === ROUTE && e.viewport === viewport);
      assertRatchet(result, scoped, { route: ROUTE, viewport });
    });
  }
});
