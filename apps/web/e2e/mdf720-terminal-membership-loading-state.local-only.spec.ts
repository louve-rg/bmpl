import { test, expect, type Page } from '@playwright/test';
import { tryLogin, UAT_FIXTURE_PASSWORD } from './support/auth';

/**
 * [LOCAL ONLY, MDF-705 follow-up] god's dispatch: write the gap-proof test
 * for MDF-720 BEFORE Oscar's fix, independent of whether MDF-720 is
 * slowness-shaped or error-shaped -- this test produces that evidence
 * rather than assuming it.
 *
 * The defect (`apps/web/lib/use-terminal-membership.ts`): `isMember` starts
 * `false` and only ever flips to `true` on a SUCCESSFUL resolve of
 * `GET /terminal/me`. There is no loading state and no error state -- a
 * request that is merely slow and a request that fails outright are both
 * indistinguishable from "not a terminal member" for as long as they are
 * pending, and an error leaves it that way FOREVER, silently (the hook's
 * own `.catch(() => {})`).
 *
 * Two REAL tests against a genuine terminal MANAGER, intercepting the
 * browser's own `/api/terminal/me` call (never the backend) to prove each
 * half live:
 *  - GAP-PROOF: DELAYED. A delayed-but-eventually-successful response
 *    hides the nav for the whole delay, with nothing distinguishing that
 *    from "no access" -- then the nav DOES appear once it resolves. This
 *    settles the open question from the MDF-698/manager-operator-login
 *    report: the defect is logic-shaped (any pending state reads as
 *    "hide"), not merely "requests never complete" -- a real manager does
 *    eventually see the link, just with no indication anything was
 *    loading in between.
 *  - GAP-PROOF: ERRORED. A failed response hides the nav and it NEVER
 *    recovers, with no error shown anywhere.
 *
 * `test.fixme` names the target (three distinct outcomes: loading, error,
 * not-a-member) without guessing Oscar's actual implementation -- replace
 * the stub with the real selectors/copy once MDF-720 ships.
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

test('GAP-PROOF: a DELAYED (but eventually successful) GET /terminal/me hides the nav for the whole delay, indistinguishable from no access', async ({ browser }) => {
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

  // Mid-delay: a genuine MANAGER, request pending, not yet resolved.
  await page.waitForTimeout(DELAY_MS / 2);
  await expect(
    page.getByRole('link', { name: 'Terminal Workspace' }),
    'CONFIRMED GAP: while GET /terminal/me is pending, a real MANAGER sees no Terminal Workspace link, no spinner, no indication anything is loading -- identical to having no access at all',
  ).toHaveCount(0);
  await expect(page.getByText(/loading/i), 'no loading indicator exists anywhere for this -- confirms the hidden state is not even accompanied by a spinner').toHaveCount(0);

  // After the delay resolves: the nav DOES appear -- proving this is a
  // logic defect (any pending state reads as "hide"), not a request that
  // never completes. A longer client-side timeout would not have helped a
  // test waiting on this link; the link only ever flips once the fetch's
  // OWN promise resolves, with nothing to poll for in between.
  await expect(
    page.getByRole('link', { name: 'Terminal Workspace' }),
    'once GET /terminal/me finally resolves, the nav link must appear -- this is the "eventually correct, never loading" half of the defect',
  ).toBeVisible({ timeout: 15_000 });
});

test('GAP-PROOF: an ERRORED GET /terminal/me hides the nav forever, with no error shown anywhere', async ({ browser }) => {
  test.setTimeout(60_000);
  const adminPage = await (await browser.newContext()).newPage();
  await adminLogin(adminPage);
  const { email } = await createTerminalManager(adminPage, 'Errored');

  const page = await (await browser.newContext()).newPage();
  expect(await tryLogin(page, email, UAT_FIXTURE_PASSWORD), 'MANAGER login failed').toBeTruthy();

  await page.route('**/api/terminal/me', async (route) => {
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Simulated MDF-720 upstream failure' }) });
  });

  await page.goto(`${WEB}/dashboard`);
  await waitForDashboardLoaded(page);

  // Give the (failed) request every chance to settle, then assert it never
  // recovers and never surfaces anything -- the hook's own `.catch(() => {})`
  // means a genuine MANAGER who hits a transient API blip concludes, with
  // no evidence to the contrary anywhere on the page, that they have no
  // terminal access at all.
  await page.waitForTimeout(3_000);
  await expect(
    page.getByRole('link', { name: 'Terminal Workspace' }),
    'CONFIRMED GAP: a real MANAGER whose GET /terminal/me errors sees no Terminal Workspace link, ever, with no error message anywhere on the page',
  ).toHaveCount(0);
  await expect(page.getByText(/error|something went wrong|try again/i), 'no error indicator exists anywhere for this -- the failure is completely silent').toHaveCount(0);
});

/**
 * PENDING MDF-720 (Oscar). Target: `useTerminalMembership` returns three
 * distinct outcomes -- loading, error, not-a-member -- rather than
 * collapsing all three into one boolean. Do NOT guess Oscar's actual
 * selectors/copy here; once MDF-720 ships, replace this stub with real
 * assertions that:
 *  - while GET /terminal/me is pending, SOMETHING on the page is visibly
 *    different from "not a member" (a loading indicator of some kind);
 *  - on an error, SOMETHING is visibly different from "not a member" too
 *    (an error indicator of some kind), not just silence;
 *  - a genuine non-member still sees neither the link nor an error.
 * This is also the only test on this floor positioned to catch a
 * regression where the three states get silently collapsed back into one
 * -- exactly the kind of fix that quietly reverts.
 */
test.fixme('Loading, error and not-a-member are three visibly distinct outcomes, never collapsed back into one (PENDING: MDF-720 not yet shipped)', async () => {});
