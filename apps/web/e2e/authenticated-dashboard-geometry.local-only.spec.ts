import { test, expect, type Page, type Browser } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { tryLogin, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, UAT_DRIVER_EMAIL, UAT_DRIVER_PASSWORD } from './support/auth';

/**
 * *** THESE 30 TESTS NEVER RUN IN CI. THIS IS NOT A GAP IN THIS FILE --
 * *** IT IS A HONEST DESCRIPTION OF WHAT IT CAN PROVE. Read this before
 * *** trusting a green check that includes this file's run: the browser
 * *** step always reports success for a SKIPPED test, same as for a
 * *** PASSED one, and CI has no SUPER_ADMIN_EMAIL/PASSWORD, no seeded
 * *** database and no live API for `tryLogin` to reach -- so every test
 * *** below calls `test.skip()` on every CI run, every time, by design.
 * *** A clean check here means "ran locally and was clean the last time a
 * *** human or agent did," never "CI verified this." Confirmed concretely
 * *** (god, 2026-10-10): main's e2e step read "57 passed, 2 skipped"
 * *** before this file existed; this branch reads "57 passed, 32
 * *** skipped" -- the same 57, plus exactly this file's 30 tests, all
 * *** silently skipped, none of them run.
 *
 * Independent real-browser audit of the AUTHENTICATED surfaces (MDF-128
 * follow-up, dispatched after the signed-out sweep in
 * public-nav-breakpoints.spec.ts came back clean). Every route a signed-out
 * visitor can reach was already measured; these are the ones that can't be
 * reached without a session -- the dashboard shell, its drawer, the account
 * menu (JOBS/EARNINGS/WALLET boxes), the wallet page, and saved addresses
 * (PR #323). MDF-103's own notes record only a single 375px measurement of
 * the account panel and nothing at any other width -- this generalizes it.
 *
 * ONE LOGIN FOR THE WHOLE FILE, NOT ONE PER TEST -- learned the expensive
 * way. The first version of this file called tryLogin() fresh inside every
 * test (30 of them). Past roughly the first dozen, login attempts started
 * silently failing and the affected tests reported as SKIPPED rather than
 * FAILED, because `tryLogin` treats any login failure as "this environment
 * can't run this spec" (see that function's own doc comment) -- which is the
 * right default for a single login, but it means a RATE LIMIT (the global
 * guard chain's Throttle step, root CLAUDE.md section 3) silently masquerades
 * as "no environment" if you hit it from inside that same catch. Logging in
 * ONCE in `beforeAll`, saving the storage state, and handing every test a
 * context built from that saved state avoids the repeated-login traffic
 * entirely and was verified clean end to end once this changed.
 *
 * CI STATUS, SAME SHAPE AS employer-empty-state.spec.ts AND FOR THE SAME
 * REASON: needs a live API backed by the seeded dev database. apps/web's
 * own e2e CI step (inside "Build, typecheck & unit tests") provisions no
 * services on purpose -- see that file's header. Making this run in CI for
 * real is not a small addition: it would mean either giving that job a
 * services: block plus steps to build the API, apply migrations and seed a
 * database (duplicating what the separate Integration job already does),
 * or a new job entirely. That is a cross-cutting CI change and is not this
 * PR's call to make. These 30 run for real locally against
 * `pnpm infra:up && pnpm db:seed` plus a running API, with
 * SEED_SUPER_ADMIN_EMAIL/SEED_SUPER_ADMIN_PASSWORD set -- the full 30/30
 * local run this PR's description reports is genuine and was independently
 * verified; it is simply never CI's own result to show.
 *
 * THE WALLET-BALANCE STRESS CASE (the lead this file exists to prove):
 * PR #338 fixed a wallet balance that overflowed its card by 2px at 375px at
 * very large values, by wrapping instead of truncating (`break-words` on
 * apps/web/app/wallet/page.tsx's big balance line). The seeded dev wallet is
 * genuinely BZ$0.00 -- real seed data cannot exercise this at all, and that
 * is a finding about the seed, not a reason to write a row. So the stress
 * tests below start from the real saved session (real cookies, real auth,
 * the actual /dashboard route guard already proved by the login) and then
 * intercept ONLY the `/api/wallet` response with the exact stress value
 * MDF-103's own notes used ($999999999.99) via page.route() -- no database
 * write, no fabricated account, a mock confined to one endpoint layered on
 * top of a real, once-per-file login.
 *
 * MDF-152 CANDIDATES 7 AND 8 (the two min-w-0+truncate / shrink-0-sibling
 * pairings this floor checked and found CORRECT, as opposed to #349, #356,
 * #358 and #363, where the same family was found broken) -- a mechanism
 * that is only exercised by a throwaway script is cleared only for the day
 * it ran; these two cases are what makes that clearance stand. Candidate 7
 * reuses the super-admin session already logged in above. Candidate 8 needs
 * the DELIVERY_DRIVER role, which the super-admin account does not hold, so
 * it gets its own one-time login below using the same tryLogin+storageState
 * pattern, not a second harness.
 */

const WIDTHS = [375, 414, 768, 1024, 1440];
const STORAGE_PATH = path.join(os.tmpdir(), `bmpl-e2e-super-admin-state-${process.pid}.json`);

let loginOk = false;

test.beforeAll(async ({ browser }) => {
  if (!SUPER_ADMIN_PASSWORD) return;
  const context = await browser.newContext();
  const page = await context.newPage();
  loginOk = await tryLogin(page, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
  if (loginOk) await context.storageState({ path: STORAGE_PATH });
  await context.close();
});

test.afterAll(() => {
  fs.rmSync(STORAGE_PATH, { force: true });
});

function skipIfNoSession() {
  test.skip(!SUPER_ADMIN_PASSWORD || !loginOk, 'Needs a live API + seeded dev database with SEED_SUPER_ADMIN_PASSWORD set -- not provisioned in CI. See file header.');
}

async function authedPage(
  browser: Browser,
  width: number,
  height = 900,
  storagePath: string = STORAGE_PATH,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ storageState: storagePath, viewport: { width, height } });
  const page = await context.newPage();
  return { page, close: () => context.close() };
}

// Candidate 8 (DeliveryQueue) needs the DELIVERY_DRIVER role -- a separate
// one-time login, same tryLogin+storageState shape as above, not a second
// harness. UAT_DRIVER_PASSWORD always has a value (an env override or its
// own committed default -- see support/auth.ts), unlike SUPER_ADMIN_PASSWORD,
// so this still needs its own loginOk flag to skip cleanly when no live API
// or seeded database is reachable (CI).
const DRIVER_STORAGE_PATH = path.join(os.tmpdir(), `bmpl-e2e-uat-driver-state-${process.pid}.json`);
let driverLoginOk = false;

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  driverLoginOk = await tryLogin(page, UAT_DRIVER_EMAIL, UAT_DRIVER_PASSWORD);
  if (driverLoginOk) await context.storageState({ path: DRIVER_STORAGE_PATH });
  await context.close();
});

test.afterAll(() => {
  fs.rmSync(DRIVER_STORAGE_PATH, { force: true });
});

function skipIfNoDriverSession() {
  test.skip(!driverLoginOk, 'Needs a live API + seeded dev database with the UAT driver fixture (packages/database/prisma/seed-uat-logistics.ts) -- not provisioned in CI. See file header.');
}

async function openAccountMenu(page: Page, width: number) {
  if (width < 768) {
    await page.getByRole('button', { name: 'Open navigation menu' }).click();
  }
  await page.locator('[aria-haspopup="true"]:visible').first().click();
}

test.describe('[LOCAL ONLY, skips in CI -- see file header] authenticated dashboard surfaces, no horizontal overflow at any required width', () => {
  for (const width of WIDTHS) {
    for (const route of ['/dashboard', '/wallet', '/dashboard/addresses']) {
      test(`${route} at ${width}px has no horizontal overflow`, async ({ browser }) => {
        skipIfNoSession();
        const { page, close } = await authedPage(browser, width);
        await page.goto(route);
        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        await close();
        expect(scrollWidth, `scrollWidth ${scrollWidth} vs clientWidth ${clientWidth} at ${width}px on ${route}`).toBeLessThanOrEqual(clientWidth + 1);
      });
    }
  }
});

test.describe('[LOCAL ONLY, skips in CI -- see file header] account menu (JOBS/EARNINGS/WALLET) never clips the viewport', () => {
  for (const width of WIDTHS) {
    test(`the open account-menu panel stays inside the viewport at ${width}px`, async ({ browser }) => {
      skipIfNoSession();
      const { page, close } = await authedPage(browser, width);
      await page.goto('/dashboard');
      await openAccountMenu(page, width);
      const panel = page.locator('[aria-haspopup="true"]:visible').first().locator('xpath=following-sibling::div[1]');
      await expect(panel).toBeVisible();
      const box = await panel.boundingBox();
      await close();
      expect(box, `no panel box at ${width}px`).not.toBeNull();
      expect(box!.x, `panel left edge at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `panel right edge at ${width}px (viewport ${width})`).toBeLessThanOrEqual(width + 1);
    });
  }
});

test.describe('[LOCAL ONLY, skips in CI -- see file header] wallet balance at the MDF-103 stress value never overflows its card', () => {
  for (const width of WIDTHS) {
    test(`/wallet big balance wraps instead of overflowing at ${width}px`, async ({ browser }) => {
      skipIfNoSession();
      const { page, close } = await authedPage(browser, width);
      await page.route('**/api/wallet', (r) =>
        r.fulfill({
          json: { currency: 'BZD', availableMinor: 99999999999, onHoldMinor: 123456789, totalMinor: 100123456788, status: 'ACTIVE', exists: true },
        }),
      );
      await page.goto('/wallet');

      const balance = page.locator('p.text-4xl.font-bold');
      await expect(balance).toContainText('999,999,999.99');
      // NOT boundingBox(): a block <p> whose own layout width is set by its
      // container does not grow to fit `white-space: nowrap` text -- the box
      // stays inside the card even while the TEXT paints past it, so a
      // box-vs-card comparison here is vacuous by construction (verified:
      // reverting the fix to nowrap left this check green). A Range over the
      // text content reports the actual painted extent, which is what
      // "overflows its card" means. Verified sensitive the same way: nowrap
      // reproduces a ~1px overflow at this exact value (matching the
      // original "~2px at 375px" report almost exactly); break-words (the
      // real fix) reports comfortably negative.
      const measured = await balance.evaluate((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const textRight = range.getBoundingClientRect().right;
        const card = node.parentElement!.getBoundingClientRect();
        return { textRight, cardRight: card.right };
      });
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      await close();

      expect(measured.textRight, `text right edge ${measured.textRight.toFixed(1)} vs card right ${measured.cardRight.toFixed(1)} at ${width}px`).toBeLessThanOrEqual(measured.cardRight + 1);
      expect(scrollWidth, `page overflow at ${width}px with the stress value`).toBeLessThanOrEqual(clientWidth + 1);
    });

    test(`account-menu Wallet summary line wraps instead of overflowing at ${width}px`, async ({ browser }) => {
      skipIfNoSession();
      const { page, close } = await authedPage(browser, width);
      await page.route('**/api/wallet', (r) =>
        r.fulfill({
          json: { currency: 'BZD', availableMinor: 99999999999, onHoldMinor: 0, totalMinor: 99999999999, status: 'ACTIVE', exists: true },
        }),
      );
      await page.goto('/dashboard');
      await openAccountMenu(page, width);

      const valueSpan = page.getByText('Available balance:').locator('xpath=following-sibling::span[1]');
      await expect(valueSpan).toHaveText('$999,999,999.99');
      // Range over the text content, not the span's own boundingBox() -- see
      // the /wallet test above for why an element's layout box can stay
      // inside its container while the text it holds paints past it.
      const measured = await valueSpan.evaluate((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const textRight = range.getBoundingClientRect().right;
        const container = node.parentElement!.parentElement!.getBoundingClientRect();
        return { textRight, containerRight: container.right };
      });
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      await close();
      expect(measured.textRight, `value text right edge ${measured.textRight.toFixed(1)} vs box right ${measured.containerRight.toFixed(1)} at ${width}px`).toBeLessThanOrEqual(measured.containerRight + 1);
      expect(scrollWidth, `page overflow at ${width}px with the stress value in the account-menu box`).toBeLessThanOrEqual(clientWidth + 1);
    });
  }
});

test.describe('[LOCAL ONLY, skips in CI -- see file header] /dashboard/messages conversation row never silently clips below md', () => {
  // The seeded conversations on this account are a month-old incidental
  // residue (god, 2026-10-10) -- short enough to never exercise this. A long
  // subject/snippet is the only thing that reveals it: below md, the list/
  // thread grid (`grid min-h-[60vh] md:grid-cols-[minmax(0,22rem)_1fr]`) has
  // no column constraint at all, so the implicit track grows to fit the
  // longest row instead of shrinking it -- `truncate`'s overflow:hidden never
  // engages because its own box never gets narrower than the text. The
  // overflow is then clipped by the Card's own `overflow-hidden` with no
  // ellipsis and no page-level scrollWidth signal (document stays exactly
  // viewport width), which is why neither prior sweep caught it.
  const LONG_SUBJECT = 'Shipment BML-EXTREMELYLONGSHIPMENTREFERENCECODE1234567890ABCDEFGHIJ · delivery to a very long neighbourhood name';
  const LONG_SNIPPET = 'This is a deliberately long last-message preview sentence meant to stress-test the truncating node and see whether it collapses to zero width or simply ellipsises as intended under real pressure.';
  const MOCK_CONVERSATIONS = [
    {
      id: 'mock-long-1',
      contextType: 'DELIVERY',
      pairing: 'CUSTOMER_DRIVER',
      subject: LONG_SUBJECT,
      status: 'OPEN',
      contextLabel: 'Delivery',
      lastMessage: { preview: LONG_SNIPPET, type: 'TEXT', createdAt: new Date().toISOString() },
      lastMessageAt: new Date().toISOString(),
      unreadCount: 2,
    },
  ];

  for (const width of WIDTHS) {
    test(`conversation row ellipsises instead of silently clipping at ${width}px`, async ({ browser }) => {
      skipIfNoSession();
      const { page, close } = await authedPage(browser, width);
      await page.route('**/api/conversations', (r) => r.fulfill({ json: MOCK_CONVERSATIONS }));
      await page.goto('/dashboard/messages');

      const row = page.locator('li button', { hasText: 'EXTREMELYLONG' });
      await expect(row).toBeVisible();
      const measured = await row.evaluate((node) => {
        const truncs = Array.from(node.querySelectorAll('.truncate'));
        return truncs.map((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
      });
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      await close();

      // Each truncating node's own scrollWidth must never exceed its own
      // clientWidth by more than ordinary ellipsis-worthy slack -- if the
      // grid track grew to fit the content instead of constraining it, the
      // node's clientWidth equals its scrollWidth (nothing to truncate
      // against), which is exactly the bug this pins.
      for (const node of measured) {
        expect(node.clientWidth, `truncating node clientWidth ${node.clientWidth} should be far smaller than its scrollWidth ${node.scrollWidth} at ${width}px -- equal means the grid track never constrained it`).toBeLessThan(node.scrollWidth);
      }
      expect(scrollWidth, `page overflow at ${width}px with a long conversation row`).toBeLessThanOrEqual(clientWidth + 1);
    });
  }
});

/**
 * /dashboard/messages' two-pane split used to switch at `md` (768px), the
 * same breakpoint where the dashboard shell (app/dashboard/layout.tsx)
 * becomes a sidebar+main row. At that exact width the thread column's real
 * available space drops to ~94px -- far under the EmptyState's own ~176px
 * floor (icon + padding, even with zero text) -- and the Card's own
 * `overflow-hidden` clips the overflow invisibly rather than scrolling the
 * page, so neither a page-scrollWidth check nor a casual look at 768px
 * (which looks fine without opening dev tools) would have caught it. The
 * fix moves the split to `lg` (1024px) in lockstep across every pane. These
 * widths are chosen to straddle the measured defect window (768-~848px)
 * rather than reuse the file's five standard WIDTHS, which include 768 but
 * not the interior of the window where the clip is worst.
 */
const MESSAGES_THREAD_PANE_WIDTHS = [375, 768, 800, 840, 900, 1024, 1440];

test.describe('[LOCAL ONLY, skips in CI -- see file header] /dashboard/messages thread-pane empty state never clips the card', () => {
  for (const width of MESSAGES_THREAD_PANE_WIDTHS) {
    test(`the "Select a conversation" placeholder stays inside the card at ${width}px`, async ({ browser }) => {
      skipIfNoSession();
      const { page, close } = await authedPage(browser, width);
      await page.goto('/dashboard/messages');

      const placeholder = page.getByText('Select a conversation');
      const visible = await placeholder.isVisible().catch(() => false);

      if (!visible) {
        // Below `lg`, the thread pane (and its EmptyState) isn't rendered at
        // all -- the list pane fills the width instead. Nothing to clip.
        const list = page.getByRole('list', { name: 'Conversations' }).or(page.getByText('No conversations yet'));
        await expect(list.first()).toBeVisible();
        await close();
        return;
      }

      const box = page.getByText('Select a conversation').locator('xpath=ancestor::div[contains(@class,"rounded-bmpl-xl")]');
      const card = page.locator('.bmpl-card').first();
      const boxRect = await box.boundingBox();
      const cardRect = await card.boundingBox();
      await close();

      expect(boxRect, `no EmptyState box at ${width}px`).not.toBeNull();
      expect(cardRect, `no Card box at ${width}px`).not.toBeNull();
      expect(boxRect!.x, `EmptyState left edge ${boxRect!.x.toFixed(1)} vs card left ${cardRect!.x.toFixed(1)} at ${width}px`).toBeGreaterThanOrEqual(cardRect!.x - 1);
      expect(boxRect!.x + boxRect!.width, `EmptyState right edge ${(boxRect!.x + boxRect!.width).toFixed(1)} vs card right ${(cardRect!.x + cardRect!.width).toFixed(1)} at ${width}px`).toBeLessThanOrEqual(cardRect!.x + cardRect!.width + 1);
    });
  }
});

/**
 * MDF-152 candidate 7 (dashboard/messages/page.tsx:261-277). The
 * "conversation row never silently clips below md" block above already
 * proves the grid track constrains a long row (clientWidth < scrollWidth on
 * every `.truncate` node) -- but that comparison alone would pass even if
 * clientWidth collapsed to ~0, because scrollWidth is the content's natural
 * width regardless of whatever the box itself shrank to. This case asks the
 * question that one doesn't: does the subject line and the last-message
 * snippet actually RENDER (a real, non-trivial clientWidth), not just
 * "shrink to something smaller than their content." Same instrument as the
 * zero-width Platform Wallet defect this session (#349): a near-zero
 * clientWidth beside a real-content scrollWidth is the collapse; a
 * comfortably non-zero one beside a larger scrollWidth is genuine ellipsis.
 */
test.describe('[LOCAL ONLY, skips in CI -- see file header] MDF-152 candidate 7: messages row subject/snippet never collapse under long content', () => {
  const LONG_SUBJECT =
    'Re: question about my order delivery window and whether the courier can come back after 6pm because nobody will be home before then';
  const LONG_SNIPPET =
    'Hi, just wanted to follow up again on the delivery timing since the original message from yesterday afternoon seems to have gone unanswered and I would really like to know';
  const MOCK_CONVERSATIONS = [
    {
      id: 'mock-convo-mdf152-c7',
      contextType: 'VENDOR_ORDER',
      pairing: 'CUSTOMER_VENDOR',
      subject: LONG_SUBJECT,
      status: 'OPEN',
      contextLabel: 'Order #BML-MOCK01',
      lastMessage: { preview: LONG_SNIPPET, type: 'TEXT', createdAt: new Date().toISOString() },
      lastMessageAt: new Date().toISOString(),
      unreadCount: 3,
    },
  ];

  for (const width of WIDTHS) {
    test(`subject and snippet render with real, non-zero width at ${width}px`, async ({ browser }) => {
      skipIfNoSession();
      const { page, close } = await authedPage(browser, width);
      await page.route('**/api/conversations', (r) => r.fulfill({ json: MOCK_CONVERSATIONS }));
      await page.goto('/dashboard/messages');

      const row = page.locator('li button', { hasText: 'nobody will be home' });
      await expect(row).toBeVisible();
      const measured = await row.evaluate((node) => {
        const truncs = Array.from(node.querySelectorAll('.truncate'));
        return {
          truncating: truncs.map((el) => ({ clientWidth: el.clientWidth, scrollWidth: el.scrollWidth })),
          row: { clientWidth: node.clientWidth, scrollWidth: node.scrollWidth },
        };
      });
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      await close();

      // Both the subject and the snippet carry `.truncate` -- two nodes
      // expected here, not one. If either is missing, the row markup
      // changed and this test should fail loudly rather than pass on zero
      // nodes checked.
      expect(measured.truncating.length, `expected 2 truncating nodes (subject + snippet) in the row at ${width}px, found ${measured.truncating.length}`).toBe(2);
      for (const node of measured.truncating) {
        // The property that actually separates "truncating" from "collapsed
        // to zero width": a real rendered box, clearly bigger than a sliver.
        // Not "clientWidth < scrollWidth" -- a node with enough room to show
        // its full content needs no truncation at all, and that is also a
        // safe outcome, not a failure of this check.
        expect(node.clientWidth, `truncating node rendered at only ${node.clientWidth}px at ${width}px -- too close to the zero-width collapse this guards against`).toBeGreaterThan(20);
        expect(node.clientWidth, `truncating node clientWidth ${node.clientWidth} should never exceed its own content scrollWidth ${node.scrollWidth} at ${width}px`).toBeLessThanOrEqual(node.scrollWidth + 1);
      }
      // The row's own box must never overflow itself either -- if either
      // `min-w-0` partner were missing, the flex item's min-content floor
      // (the whole nowrap line, for a `truncate` node) would force the row
      // wider than its real container, and a sibling check alone (above)
      // would not catch it: each node can be internally self-consistent
      // while the row around it has already blown out. Confirmed this is
      // load-bearing, not redundant, by a negative control: removing
      // `min-w-0` from the subject <p> left every assertion above green but
      // failed this one at every width (row scrollWidth ~900+ vs clientWidth
      // ~300-350).
      expect(measured.row.scrollWidth, `row's own scrollWidth ${measured.row.scrollWidth} should not exceed its clientWidth ${measured.row.clientWidth} at ${width}px -- the row should never overflow itself`).toBeLessThanOrEqual(measured.row.clientWidth + 1);
      expect(scrollWidth, `page overflow at ${width}px with a long conversation row`).toBeLessThanOrEqual(clientWidth + 1);
    });
  }
});

/**
 * MDF-152 candidate 8 (components/driver/DeliveryQueue.tsx:236-289). Mocks
 * exactly 2 queue items -- the component returns null below that
 * (`data.items.length < 2`, line 142), so a single real or mocked job can
 * never reach this markup at all. Same non-zero-rendered-width instrument as
 * candidate 7 for the title Link, plus a check the row's OWN box never
 * overflows itself (its scrollWidth must not exceed its clientWidth) --
 * distinct from the title node, which is SUPPOSED to scroll past its own
 * clientWidth (that is what truncate is doing to it).
 */
test.describe('[LOCAL ONLY, skips in CI -- see file header] MDF-152 candidate 8: driver queue title never collapses under long content', () => {
  const LONG_REFERENCE = 'BML-SHIP-99887766-VERY-LONG-REFERENCE-CODE';
  const LONG_VENDOR = 'The Exceptionally Long Named Hardware And Building Supply Company Ltd';
  const LONG_STOP_AREA = 'Unit 14B, Independence Plaza Commercial Complex, Mile 3 Northern Highway';

  function mockItem(i: number) {
    return {
      id: `mock-item-${i}`,
      status: 'ASSIGNED',
      statusLabel: 'Assigned',
      view: 'assigned',
      kind: 'MARKETPLACE',
      kindLabel: 'Marketplace delivery',
      reference: `${LONG_REFERENCE}-${i}`,
      orderNumber: `MOCK-ORDER-${LONG_REFERENCE}-${i}`,
      vendor: LONG_VENDOR,
      pickupArea: 'Belize City',
      itemCount: 2,
      city: 'Belize City',
      district: 'Belize',
      feeMinor: 1500,
      position: i,
      recommendedPosition: null,
      stopKind: i === 1 ? 'PICKUP' : 'DROPOFF',
      stopArea: LONG_STOP_AREA,
      legDistanceKm: 4.2,
      legMinutes: 12,
      estimatePrecision: 'EXACT',
      nextAction: { kind: 'CONFIRM_PICKUP', label: 'Confirm pickup' },
      canReorder: true,
      reorderBlockedReason: null,
    };
  }

  for (const width of WIDTHS) {
    test(`queue row title renders with real, non-zero width and the row itself never overflows at ${width}px`, async ({ browser }) => {
      skipIfNoDriverSession();
      const { page, close } = await authedPage(browser, width, 900, DRIVER_STORAGE_PATH);
      await page.route('**/api/driver/jobs/queue', (r) =>
        r.fulfill({
          json: {
            items: [mockItem(1), mockItem(2)],
            route: {
              totalDistanceKm: 8.4,
              totalMinutes: 24,
              precision: 'EXACT',
              disclosure: 'Estimated from pickup and drop-off locations. Not a live ETA.',
              recommendedOrder: ['mock-item-1', 'mock-item-2'],
            },
            followsRecommendation: true,
          },
        }),
      );
      await page.goto('/dashboard/driver/jobs');

      await expect(page.getByText('Your delivery queue')).toBeVisible();
      // Scoped to text unique to the mocked data -- `ol > li` also matches
      // DriverBreadcrumb's own <ol> rendered above the queue on this page.
      const row = page.locator('li', { hasText: LONG_REFERENCE }).first();
      await expect(row).toBeVisible();
      const title = row.locator('a', { hasText: LONG_REFERENCE }).first();

      const titleSizes = await title.evaluate((el) => ({ clientWidth: el.clientWidth, scrollWidth: el.scrollWidth }));
      const rowSizes = await row.evaluate((el) => ({ clientWidth: el.clientWidth, scrollWidth: el.scrollWidth }));
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      await close();

      // Not "clientWidth < scrollWidth" -- at the widest mandated width the
      // row has room to show the reference in full, so clientWidth equals
      // scrollWidth with no truncation at all, which is also a safe outcome.
      expect(titleSizes.clientWidth, `title rendered at only ${titleSizes.clientWidth}px at ${width}px -- too close to the zero-width collapse this guards against`).toBeGreaterThan(20);
      expect(titleSizes.clientWidth, `title clientWidth ${titleSizes.clientWidth} should never exceed its own content scrollWidth ${titleSizes.scrollWidth} at ${width}px`).toBeLessThanOrEqual(titleSizes.scrollWidth + 1);
      expect(rowSizes.scrollWidth, `row's own scrollWidth ${rowSizes.scrollWidth} should not exceed its clientWidth ${rowSizes.clientWidth} at ${width}px -- the row should never overflow itself`).toBeLessThanOrEqual(rowSizes.clientWidth + 1);
      expect(scrollWidth, `page overflow at ${width}px with a long driver queue row`).toBeLessThanOrEqual(clientWidth + 1);
    });
  }
});
