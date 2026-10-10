import { test, expect, type Page, type Browser } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { tryLogin, OPS_FULL_EMAIL, OPS_PASSWORD } from './support/auth';

/**
 * Admin's first real-browser spec, found during the admin console's first
 * ever responsive sweep (god, 2026-10-10). PageHeader (components/ui.tsx)
 * lays out a title block against an `actions` slot in a row that switches
 * flex-col -> sm:flex-row at 640px. The title block has no min-w-0 and the
 * actions wrapper is shrink-0 with no flex-wrap on the OUTER row -- neither
 * side can give, so on a page whose title+description+actions combined
 * width crosses the container at a given breakpoint, the row silently
 * overflows, clipped by the page shell's own overflow-x-hidden with no
 * page-level scrollWidth signal and no visual cue. /dashboard/logistics
 * crosses that threshold at exactly 768px (title, description, and four
 * action links); this spec pins that instance and, because the mechanism is
 * content-dependent, sweeps the other four required widths on the same
 * route so the fix's scope is provable rather than assumed (red only at the
 * width that was actually broken, green at every width that already worked).
 *
 * SKIPS without a live API + the UAT ops fixtures (seed-uat-logistics.ts,
 * `pnpm --filter @bmpl/database seed:uat`) and UAT_OPS_PASSWORD set --
 * never provisioned in CI, same shape as apps/web's own local-only specs.
 */

const WIDTHS = [375, 414, 768, 1024, 1440];
const STORAGE_PATH = path.join(os.tmpdir(), `bmpl-admin-e2e-ops-full-state-${process.pid}.json`);

let loginOk = false;

test.beforeAll(async ({ browser }) => {
  if (!OPS_PASSWORD) return;
  const context = await browser.newContext();
  const page = await context.newPage();
  loginOk = await tryLogin(page, OPS_FULL_EMAIL, OPS_PASSWORD);
  if (loginOk) await context.storageState({ path: STORAGE_PATH });
  await context.close();
});

test.afterAll(() => {
  fs.rmSync(STORAGE_PATH, { force: true });
});

async function authedPage(browser: Browser, width: number, height = 900): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ storageState: STORAGE_PATH, viewport: { width, height } });
  const page = await context.newPage();
  return { page, close: () => context.close() };
}

test.describe('[LOCAL ONLY, skips in CI -- see file header] PageHeader never silently clips its action row', () => {
  // Hoisted out of each test body (where it used to be the ONLY check,
  // alongside !loginOk below) -- a condition checked INSIDE a test body
  // still makes Playwright resolve that test's `browser` fixture parameter
  // first, which launches a real chromium even though the test immediately
  // skips. Every CI run has no UAT_OPS_PASSWORD, so this was paying for a
  // browser nobody used on every run (PR #358: two such "free" browsers in
  // one CI job -- this one plus apps/web's own local-only file's -- after
  // three app builds and the full unit suite, was enough to get the second
  // one SIGKILLed for memory). Checked here, at the describe level, with no
  // credentials the fixture is never resolved and no browser starts -- the
  // five tests still each show up individually as skipped in the report,
  // which is the point of this step existing at all. The failed-login case
  // (credentials present but wrong, or fixtures not seeded) can't be known
  // this early -- it depends on beforeAll's own login attempt -- so
  // !loginOk stays as an in-body check below, same as before.
  test.skip(!OPS_PASSWORD, 'Needs UAT_OPS_PASSWORD set -- not provisioned in CI. See file header.');

  for (const width of WIDTHS) {
    test(`/dashboard/logistics header actions stay reachable at ${width}px`, async ({ browser }) => {
      test.skip(!loginOk, 'Needs a live API + the UAT ops fixtures seeded -- login did not succeed. See file header.');
      const { page, close } = await authedPage(browser, width);
      await page.goto('/dashboard/logistics');

      const courierLanesLink = page.getByRole('link', { name: 'Courier lanes' });
      await expect(courierLanesLink).toBeAttached();
      const measured = await courierLanesLink.evaluate((node) => {
        const r = node.getBoundingClientRect();
        // Walk up to the nearest ancestor that actually clips (overflow
        // hidden) -- the same diagnostic that found this defect, because a
        // page-level scrollWidth check alone never sees it: the clip never
        // reaches the document.
        let el: HTMLElement | null = node.parentElement;
        let clipper: { scrollWidth: number; clientWidth: number } | null = null;
        while (el) {
          const style = getComputedStyle(el);
          if (style.overflowX === 'hidden' || style.overflow === 'hidden') {
            clipper = { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
            break;
          }
          el = el.parentElement;
        }
        return { right: r.right, clipper };
      });
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      await close();

      expect(measured.right, `'Courier lanes' right edge ${measured.right.toFixed(1)} at ${width}px (viewport ${width})`).toBeLessThanOrEqual(width + 1);
      if (measured.clipper) {
        expect(
          measured.clipper.scrollWidth,
          `ancestor overflow-hidden clip at ${width}px: scrollWidth ${measured.clipper.scrollWidth} vs clientWidth ${measured.clipper.clientWidth}`,
        ).toBeLessThanOrEqual(measured.clipper.clientWidth + 1);
      }
      expect(scrollWidth, `page overflow at ${width}px`).toBeLessThanOrEqual(clientWidth + 1);
    });
  }
});
