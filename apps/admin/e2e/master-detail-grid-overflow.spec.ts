import { test, expect, type Page, type Browser } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { tryLogin } from './support/auth';

/**
 * Found during the layout-workstream sweep (god, conv-mission-2026-10-13),
 * same mechanism class as page-header-overflow.spec.ts but a different
 * culprit: a list+detail layout built as `grid gap-5
 * lg:grid-cols-[minmax(0,Nrem)_minmax(0,1fr)]` with NO base-breakpoint
 * `grid-cols-1`. CSS Grid's default implicit column, with no explicit
 * `grid-template-columns` at the base breakpoint, sizes to its content's
 * intrinsic width rather than shrinking to fit the container -- so on a
 * narrow viewport (below `lg`, 1024px) the single stacked column renders at
 * whatever width its content asks for (measured live at 477px on
 * /dashboard/jobs) instead of the 280px actually available, silently
 * clipped by the page shell's own overflow-x-hidden with no page-level
 * scrollWidth signal. Same CSS Grid "missing base grid-cols" family as
 * PR #372's Services.tsx bento grid fix on the web side, and apps/web's own
 * dashboard/messages/page.tsx already has the correct form
 * (`grid-cols-1 lg:grid-cols-[minmax(0,22rem)_1fr]`) -- that page was the
 * reference for the fix here, not a new pattern invented for it.
 *
 * Seven sites shared the exact same unfixed shape and are all covered here:
 * jobs moderation, marketing moderation/promotions, properties
 * moderation/listings + owners + agents, and support. The fix adds
 * `grid-cols-1` before the `lg:` variant at each -- the grid previously had
 * zero explicit columns below `lg`; it now has exactly one, full width,
 * matching what was already visually intended (list above, detail below on
 * mobile).
 *
 * Needs only a logged-in SUPER_ADMIN, not any of the UAT ops/logistics
 * fixtures page-header-overflow.spec.ts needs. Still LOCAL ONLY / skips in
 * CI: CI's admin e2e job (ci.yml) runs with no live API at all
 * (informational, continue-on-error, no services: block), so any spec
 * needing a real login skips there regardless -- same shape, stated the
 * same way, as page-header-overflow.spec.ts.
 *
 * IMPORTANT, found while proving this red-then-green: the grid ELEMENT
 * (list panel + detail/empty-state panel) renders unconditionally once
 * `listState` leaves 'loading', regardless of whether `items` is empty --
 * but the OVERFLOW only shows up once the right-hand detail panel actually
 * has wide content to render (a real selected record's title/badges/
 * description), which needs `items` non-empty AND a record selected. Of
 * the six cases below, only "jobs moderation" currently has seeded data
 * (BMPL-228 fixture jobs) that reproduces it -- confirmed by reverting the
 * fix and re-running: 1/6 failed (jobs, scrollWidth 477 vs clientWidth 280),
 * 5/6 stayed green (marketing/support/properties variants all render their
 * narrow EmptyState with no items seeded in this database, so their grid
 * never gets wide content to overflow either way). The other five share the
 * identical vulnerable class and component shape (confirmed by code
 * reading, not assumption -- see the fix commit) and get the identical fix;
 * this spec still asserts the same real invariant for all six
 * (`scrollWidth <= clientWidth`, i.e. "this grid never overflows its own
 * box"), which is sound regardless of data and will catch a REAL future
 * regression on any of them the moment seeded data exists for it. Only
 * "jobs" is a proven red-before/green-after defect today; the rest are
 * verified-correct-by-construction plus defense-in-depth, and that
 * distinction is deliberately not blurred here.
 */

const EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL;
const PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD;
const STORAGE_PATH = path.join(os.tmpdir(), `bmpl-admin-e2e-super-admin-state-${process.pid}.json`);

let loginOk = false;

test.beforeAll(async ({ browser }) => {
  if (!EMAIL || !PASSWORD) return;
  const context = await browser.newContext();
  const page = await context.newPage();
  loginOk = await tryLogin(page, EMAIL, PASSWORD);
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

/**
 * Measures the FIRST `.grid.gap-5` list+detail layout on the page. Matched
 * without requiring `grid-cols-1` on purpose -- that class is the fix itself,
 * and a selector that only exists post-fix would fail for the wrong reason
 * (element not found) rather than the real one (too wide for its container)
 * when run against the pre-fix code.
 *
 * The grid ELEMENT's own getBoundingClientRect().width is the wrong signal
 * -- `display: grid` sizes the grid box itself to its parent (280px) either
 * way, fix or no fix. The actual defect is that the grid's IMPLICIT column
 * track, with no explicit `grid-template-columns` at the base breakpoint,
 * sizes to its content's intrinsic width and overflows ITS OWN box -- caught
 * live, not assumed, when this test's first version (comparing the grid
 * element's own rect) passed 6/6 against knowingly-reverted, still-broken
 * source. `scrollWidth` vs `clientWidth` on the grid itself is what actually
 * reflects that: 477 vs 280 on the broken version, confirmed directly
 * against a running dev server before trusting this measurement.
 */
async function measureMasterDetailGrid(page: Page) {
  return page.evaluate(() => {
    const grid = document.querySelector('.grid.gap-5');
    if (!grid) return null;
    return {
      gridTemplateColumns: getComputedStyle(grid).gridTemplateColumns,
      scrollWidth: grid.scrollWidth,
      clientWidth: grid.clientWidth,
    };
  });
}

test.describe('[LOCAL ONLY, skips in CI -- see file header] list+detail admin grids stay single-column below lg (1024px)', () => {
  test.skip(!EMAIL || !PASSWORD, 'Needs SEED_SUPER_ADMIN_EMAIL/SEED_SUPER_ADMIN_PASSWORD set -- not provisioned in CI. See file header.');

  const ROUTES: Array<{ route: string; label: string; tabText?: string }> = [
    { route: '/dashboard/jobs', label: 'jobs moderation (default tab)' },
    { route: '/dashboard/marketing', label: 'marketing moderation (default tab)' },
    { route: '/dashboard/properties', label: 'properties moderation (default tab)' },
    { route: '/dashboard/support', label: 'support console' },
    { route: '/dashboard/properties', label: 'properties owners tab', tabText: 'Owners' },
    { route: '/dashboard/properties', label: 'properties agents tab', tabText: 'Agents' },
  ];

  for (const { route, label, tabText } of ROUTES) {
    test(`${label} fits its container at 320px`, async ({ browser }) => {
      test.skip(!loginOk, 'Needs a live API + a seeded SUPER_ADMIN -- login did not succeed. See file header.');
      const { page, close } = await authedPage(browser, 320);
      await page.goto(route);
      if (tabText) await page.getByText(tabText, { exact: true }).click();

      // The list + detail panel both populate from an async GET after
      // mount, and `goto`'s default waitUntil ('load') does not wait for
      // it -- measuring immediately races the fetch and can catch the grid
      // mid-loading-spinner, before the wide content that actually exposes
      // the overflow has mounted. Caught live: without this wait, 5 of 6
      // routes passed against knowingly-reverted, still-broken source
      // (only the slowest one, jobs, lost the race and failed for the
      // right reason). `role="status"` is Spinner's own (components/ui.tsx).
      await page.getByRole('status', { name: 'Loading' }).first().waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});

      const measured = await measureMasterDetailGrid(page);
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      await close();

      expect(measured, `no .grid.gap-5 found on ${route}${tabText ? ` (${tabText} tab)` : ''}`).not.toBeNull();
      expect(
        measured!.scrollWidth,
        `grid scrollWidth ${measured!.scrollWidth}px vs its own clientWidth ${measured!.clientWidth}px (columns: ${measured!.gridTemplateColumns})`,
      ).toBeLessThanOrEqual(measured!.clientWidth + 1);
      expect(scrollWidth, 'page overflow at 320px').toBeLessThanOrEqual(clientWidth + 1);
    });
  }
});
