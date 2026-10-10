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

function skipIfNoSession() {
  test.skip(!OPS_PASSWORD || !loginOk, 'Needs a live API + the UAT ops fixtures with UAT_OPS_PASSWORD set -- not provisioned in CI. See file header.');
}

async function authedPage(browser: Browser, width: number, height = 900): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ storageState: STORAGE_PATH, viewport: { width, height } });
  const page = await context.newPage();
  return { page, close: () => context.close() };
}

test.describe('[LOCAL ONLY, skips in CI -- see file header] PageHeader never silently clips its action row', () => {
  for (const width of WIDTHS) {
    test(`/dashboard/logistics header actions stay reachable at ${width}px`, async ({ browser }) => {
      skipIfNoSession();
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
