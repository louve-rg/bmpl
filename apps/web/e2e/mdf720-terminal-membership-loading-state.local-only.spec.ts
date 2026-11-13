import { test, expect, type Page } from '@playwright/test';
import { tryLogin, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD } from './support/auth';

/**
 * [LOCAL ONLY, MDF-705 follow-up] Proves MDF-720 end-to-end against a real
 * terminal MANAGER, intercepting the browser's own `/api/terminal/me` call
 * (never the backend).
 *
 * THE ORIGINAL DEFECT (`apps/web/lib/use-terminal-membership.ts`, pre-#694):
 * `isMember` started `false` and only ever flipped `true` on a SUCCESSFUL
 * resolve. A merely slow request and a failed one were both indistinguishable
 * from "not a terminal member" while pending, and a failure left it that way
 * FOREVER, silently (`.catch(() => {})`). The DELAYED/ERRORED tests below
 * were originally written as GAP-PROOF against that code, before any fix
 * existed, intercepting a delayed and an errored response respectively.
 *
 * TWO SELECTOR GAPS FOUND AND FIXED while that gap-proof pair ran against
 * unfixed main (Dwight, 2026-11-13): TERM-11's collapsible nav groups meant
 * the group header appearing (not the inner link) was the real evidence
 * membership resolved -- fixed by expanding the group before asserting the
 * link; and an unscoped `getByText` absence check matched non-visible DOM a
 * Next.js dev overlay supplied -- fixed by scoping every text check to
 * `page.getByRole('navigation', {name: 'Dashboard'})` (`navRegion` below),
 * the same region the link lives in, confirmed as the only such region
 * mounted on initial load (`MobileNavDrawer` only portals its own copy
 * behind `{open && createPortal(...)}`, closed by default).
 *
 * THE FIX SHIPPED AND MERGED (#694, main `f3696c66`): `useTerminalMembership`
 * now returns `{ status, retry }`, one of `'loading' | 'member' |
 * 'not-member' | 'error'`, rendered in `DashboardNavList.tsx` as two new
 * elements OUTSIDE the nav groups loop, never simultaneous with each other
 * or with the real link: `[data-testid="terminal-membership-loading"]`
 * ("Loading terminal access…") and `[data-testid="terminal-membership-
 * error"]` ("Something went wrong checking your terminal access." plus a
 * "Try again" button wired to `retry()`). A 403 is definitive
 * ('not-member'); anything else retries automatically on a capped backoff
 * (1s/3s/9s/30s, then steady 30s) in addition to the manual button.
 *
 * THE SAME BRANCH ALSO SHIPPED F-NAV (`10f178db`): the "Terminal" group now
 * auto-opens whenever a confirmed member, and a `TerminalWorkspaceBanner`
 * (outside `<nav>`, on `/dashboard` itself) surfaces the same link above
 * the fold. Re-diffing before touching anything caught that the DELAYED/
 * ERRORED tests' manual group-click would now toggle an already-open group
 * CLOSED -- removed; and that the banner's link, whose accessible name also
 * contains "Terminal Workspace" as a substring (Playwright's default name
 * match), could have collided with every link assertion here -- it can't,
 * because every one was already scoped to `navRegion`, and the banner
 * renders outside it.
 *
 * FLOOR RULE SATISFIED (god, from Oscar's MDF-722 catch): a test for a
 * defect depending on intermediate render state is credited only once
 * PROVEN to fail against the unfixed code, not merely shown to pass against
 * the fix. Dwight ran the revert-and-prove protocol (#694's DashboardNavList
 * kept, only `use-terminal-membership.ts` reverted to the old bare-boolean
 * hook): the loading and error bodies both failed/errored as required (the
 * test-ids didn't exist on the old hook); the non-member body passed at
 * both ends, correctly judged NOT a protocol failure since a pure absence
 * check has no intermediate state to hide. With the real fix restored, all
 * three passed.
 *
 * REWRITTEN, NOT DELETED (floor convention: a deleted test takes its
 * evidence of the original defect with it). The DELAYED/ERRORED tests below
 * are the same two gap-proof tests, same account setup, rewritten in place
 * to assert the now-shipped positive behavior instead of the gap. The
 * non-member test is unchanged from its `test.fixme` body, now flipped live.
 */
const WEB = process.env.BASE_URL ?? 'http://localhost:3177';
const ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@bzemarketplace.com';
const ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD;
const stamp = Date.now();

async function postWithCsrf<T>(page: Page, path: string, body: unknown): Promise<{ status: number; body: T }> {
  return page.evaluate(
    async ({ path, body }) => {
      let csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1];
      if (!csrfToken) {
        await fetch('/api/auth/csrf', { credentials: 'include', cache: 'no-store' }).catch(() => {});
        csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1];
      }
      csrfToken = csrfToken ? decodeURIComponent(csrfToken) : undefined;
      const res = await fetch(`/api${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}) },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text;
      }
      return { status: res.status, body: parsed };
    },
    { path, body },
  ) as Promise<{ status: number; body: T }>;
}

async function getJson<T>(page: Page, path: string): Promise<{ status: number; body: T }> {
  return page.evaluate(async (path) => {
    const res = await fetch(`/api${path}`, { credentials: 'include' });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed };
  }, path) as Promise<{ status: number; body: T }>;
}

async function adminLogin(page: Page): Promise<void> {
  expect(ADMIN_PASSWORD, 'SEED_SUPER_ADMIN_PASSWORD not set -- hard stop, not a skip').toBeTruthy();
  expect(await tryLogin(page, ADMIN_EMAIL, ADMIN_PASSWORD!), 'admin login failed -- hard stop, not a skip').toBeTruthy();
}

/** A real, genuinely-granted terminal MANAGER -- same real admin-console API
 * + accept-invite flow every other file in this batch uses, no DB write. */
async function createTerminalManager(adminPage: Page, label: string): Promise<{ email: string }> {
  const { body: hubs } = await getJson<Array<{ id: string; code: string }>>(adminPage, '/admin/logistics/hubs');
  const hubA = hubs.find((h) => h.code === 'UATBC');
  expect(hubA, 'UATBC simulation hub not found').toBeTruthy();

  const company = await postWithCsrf<{ id: string }>(adminPage, '/admin/terminal/companies', {
    businessName: `MDF720 ${label} Co ${stamp}`,
    contactEmail: `mdf720-${label.toLowerCase()}-co-${stamp}@example.bz`,
    isTest: true,
  });
  expect(company.status).toBe(201);
  const loc = await postWithCsrf<{ id: string }>(adminPage, `/admin/terminal/companies/${company.body.id}/locations`, { hubId: hubA!.id });
  expect(loc.status).toBe(201);
  const email = `mdf720-${label.toLowerCase()}-staff-${stamp}@example.bz`;
  const invite = await postWithCsrf<{ id: string }>(adminPage, `/admin/terminal/companies/${company.body.id}/invites`, {
    email,
    memberRole: 'MANAGER',
    locationIds: [loc.body.id],
  });
  expect(invite.status).toBe(201);
  const mailbox = await getJson<{ body: string }>(adminPage, `/dev/emails/latest?email=${encodeURIComponent(email)}`);
  const token = mailbox.body.body.match(/token=([^"&\s]+)/)?.[1];
  const staffPage = await adminPage.context().browser()!.newContext().then((c) => c.newPage());
  await staffPage.goto(WEB);
  await postWithCsrf(staffPage, '/terminal/invites/accept', { token, password: UAT_FIXTURE_PASSWORD, firstName: label, lastName: 'Manager' });
  await staffPage.close();
  return { email };
}

/** Positive control: `Overview` is in `BASE_NAV`, "the customer baseline
 * every signed-in user gets" -- proves the dashboard genuinely rendered,
 * so an absent Terminal Workspace link means something, not "blank page". */
async function waitForDashboardLoaded(page: Page): Promise<void> {
  await expect(page.getByRole('link', { name: 'Overview' }), 'dashboard never actually loaded (would make every check below meaningless)').toBeVisible({ timeout: 15_000 });
}

/** The single nav region ("Terminal Workspace" and its loading/error state
 * both live here) -- scoping text-absence checks to it, rather than the
 * whole page, keeps a Next.js dev overlay's own (non-visible) DOM from
 * producing a false match unrelated to the product. */
function navRegion(page: Page) {
  return page.getByRole('navigation', { name: 'Dashboard' });
}

test('a DELAYED GET /terminal/me shows a visible loading affordance, then the real link once it resolves (was GAP-PROOF; #694 fixed this)', async ({ browser }) => {
  test.setTimeout(60_000);
  const adminPage = await (await browser.newContext()).newPage();
  await adminLogin(adminPage);
  const { email } = await createTerminalManager(adminPage, 'Delayed');

  const page = await (await browser.newContext()).newPage();
  expect(await tryLogin(page, email, UAT_FIXTURE_PASSWORD), 'MANAGER login failed').toBeTruthy();

  const DELAY_MS = 4_000;
  await page.route('**/api/terminal/me', async (route) => {
    await new Promise((r) => setTimeout(r, DELAY_MS));
    await route.continue();
  });

  await page.goto(`${WEB}/dashboard`);
  await waitForDashboardLoaded(page);

  // Mid-delay: a genuine MANAGER, request pending, not yet resolved. A
  // visible loading affordance must distinguish this from "not a member" --
  // before #694 nothing here would have been visible at all.
  await page.waitForTimeout(DELAY_MS / 2);
  await expect(
    navRegion(page).getByTestId('terminal-membership-loading'),
    'mid-delay: a visible loading affordance must distinguish this from "not a member"',
  ).toBeVisible();
  await expect(navRegion(page).getByTestId('terminal-membership-loading')).toHaveText(/Loading terminal access/i);
  await expect(navRegion(page).getByRole('link', { name: 'Terminal Workspace' })).toHaveCount(0);
  await expect(navRegion(page).getByTestId('terminal-membership-error')).toHaveCount(0);

  // After the delay resolves: the link appears and the loading affordance
  // clears. F-NAV auto-opens "Terminal" for a confirmed member -- no click
  // needed (and none attempted: that would toggle an already-open group
  // closed against this fixed code).
  const terminalGroup = navRegion(page).getByRole('button', { name: 'Terminal' });
  await expect(terminalGroup, 'Terminal nav group header never appeared after the delay resolved').toBeVisible({ timeout: 15_000 });
  await expect(navRegion(page).getByTestId('terminal-membership-loading'), 'loading affordance must disappear once membership resolves').toHaveCount(0);
  await expect(
    navRegion(page).getByRole('link', { name: 'Terminal Workspace' }),
    'once GET /terminal/me finally resolves, the nav link must appear',
  ).toBeVisible({ timeout: 5_000 });
});

test('an ERRORED GET /terminal/me shows a visible error affordance with a working manual retry (was GAP-PROOF; #694 fixed this)', async ({ browser }) => {
  test.setTimeout(60_000);
  const adminPage = await (await browser.newContext()).newPage();
  await adminLogin(adminPage);
  const { email } = await createTerminalManager(adminPage, 'Errored');

  const page = await (await browser.newContext()).newPage();
  expect(await tryLogin(page, email, UAT_FIXTURE_PASSWORD), 'MANAGER login failed').toBeTruthy();

  let failRequests = true;
  await page.route('**/api/terminal/me', async (route) => {
    if (failRequests) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Simulated MDF-720 upstream failure' }) });
    } else {
      await route.continue();
    }
  });

  await page.goto(`${WEB}/dashboard`);
  await waitForDashboardLoaded(page);

  // Give the failed request every chance to settle, then assert a visible
  // error affordance replaced the old silent hide.
  await page.waitForTimeout(3_000);
  const errorBox = navRegion(page).getByTestId('terminal-membership-error');
  await expect(errorBox, 'a visible error affordance must replace the old silent hide').toBeVisible();
  await expect(errorBox).toContainText('Something went wrong checking your terminal access.');
  await expect(navRegion(page).getByRole('link', { name: 'Terminal Workspace' })).toHaveCount(0);

  // Manual retry: unblock the route, click "Try again", membership resolves.
  // Clicking "Try again" and seeing the link actually appear proves retry()
  // re-checks rather than just dismissing the error -- a test only asserting
  // the error text vanished would pass against a button that does nothing.
  failRequests = false;
  await errorBox.getByRole('button', { name: 'Try again' }).click();

  // F-NAV auto-opens "Terminal" for a confirmed member -- no click needed.
  const terminalGroup = navRegion(page).getByRole('button', { name: 'Terminal' });
  await expect(terminalGroup, 'retry must actually re-check membership, not just dismiss the error').toBeVisible({ timeout: 15_000 });
  await expect(navRegion(page).getByTestId('terminal-membership-error'), 'error affordance must clear once retry succeeds').toHaveCount(0);
  await expect(navRegion(page).getByRole('link', { name: 'Terminal Workspace' })).toBeVisible({ timeout: 5_000 });
});

test('a genuine non-member sees neither the link, the loading affordance, nor the error affordance', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  expect(await tryLogin(page, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD), 'CUSTOMER login failed').toBeTruthy();
  await waitForDashboardLoaded(page);

  // Real 403 from the real backend -- no interception. Give the hook
  // every chance to settle before asserting the quiet, correct outcome.
  await page.waitForTimeout(3_000);
  await expect(navRegion(page).getByRole('link', { name: 'Terminal Workspace' })).toHaveCount(0);
  await expect(navRegion(page).getByTestId('terminal-membership-loading')).toHaveCount(0);
  await expect(navRegion(page).getByTestId('terminal-membership-error')).toHaveCount(0);
});
