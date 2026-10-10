import { test, expect, type Page, type Browser } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { tryLogin, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD } from './support/auth';

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

async function authedPage(browser: Browser, width: number, height = 900): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ storageState: STORAGE_PATH, viewport: { width, height } });
  const page = await context.newPage();
  return { page, close: () => context.close() };
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
