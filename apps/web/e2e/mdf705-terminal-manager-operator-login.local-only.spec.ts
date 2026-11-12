import { test, expect, type Page } from '@playwright/test';
import { tryLogin, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD } from './support/auth';

/**
 * [LOCAL ONLY, MDF-705] Written before an environment exists — see
 * `mdf705-terminal-fixture-plan.md` for what each helper below assumes and
 * how to provision it once MDF-704 lands. Every assertion here states what
 * would make it fail; none of them pass on a click alone.
 *
 * Covers god's dispatch items: "Manager login, navigation and session
 * handling", "Operator login plus the actions an Operator must NOT be able
 * to perform once Pam lands MDF-698". The second half is split in two on
 * purpose: the part that is TRUE TODAY (Manager and Operator are
 * interchangeable — `TerminalService.assertStaffLocationAccess` authorizes
 * on hub grant only, never reads `memberRole`) is a real, running assertion.
 * The part that needs MDF-698's own permission matrix does not exist yet —
 * writing a forbidden-action list without it would be inventing a business
 * rule (root CLAUDE.md §12), so that half is `test.fixme` with the open
 * question recorded, not a guessed assertion.
 */
const WEB = process.env.BASE_URL ?? 'http://localhost:3177';
const ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@bzemarketplace.com';
const ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD;
const stamp = Date.now();

async function postWithCsrf<T>(page: Page, path: string, body: unknown, method: 'POST' | 'PATCH' = 'POST'): Promise<{ status: number; body: T }> {
  return page.evaluate(
    async ({ path, body, method }) => {
      let csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1];
      if (!csrfToken) {
        await fetch('/api/auth/csrf', { credentials: 'include', cache: 'no-store' }).catch(() => {});
        csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1];
      }
      csrfToken = csrfToken ? decodeURIComponent(csrfToken) : undefined;
      const res = await fetch(`/api${path}`, {
        method,
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
    { path, body, method },
  ) as Promise<{ status: number; body: T }>;
}

async function getJson<T>(page: Page, path: string): Promise<{ status: number; body: T }> {
  return page.evaluate(async (path) => {
    const res = await fetch(`/api${path}`, { credentials: 'include' });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, path) as Promise<{ status: number; body: T }>;
}

async function adminLogin(page: Page): Promise<void> {
  expect(ADMIN_PASSWORD, 'SEED_SUPER_ADMIN_PASSWORD not set in this environment -- hard stop, not a skip').toBeTruthy();
  expect(await tryLogin(page, ADMIN_EMAIL, ADMIN_PASSWORD!), 'admin login failed -- hard stop, not a skip').toBeTruthy();
}

/** Real admin-console API, real public accept-invite flow -- no DB write.
 * Returns login credentials for a terminal staff account with the given
 * memberRole, granted both locations of a freshly created two-hub company. */
async function createTerminalStaff(
  adminPage: Page,
  memberRole: 'MANAGER' | 'OPERATOR',
  label: string,
): Promise<{ email: string; companyName: string; hubA: { id: string; code: string }; hubB: { id: string; code: string } }> {
  const { status: hubsStatus, body: hubs } = await getJson<Array<{ id: string; code: string }>>(adminPage, '/admin/logistics/hubs');
  expect(hubsStatus).toBe(200);
  const hubA = hubs.find((h) => h.code === 'UATBC');
  const hubB = hubs.find((h) => h.code === 'UATBP');
  expect(hubA && hubB, 'UATBC/UATBP simulation hubs not found -- expected from seed-uat-logistics.ts').toBeTruthy();

  const companyName = `MDF705 ${label} Co ${stamp}`;
  const company = await postWithCsrf<{ id: string }>(adminPage, '/admin/terminal/companies', {
    businessName: companyName,
    contactEmail: `mdf705-${label.toLowerCase()}-co-${stamp}@example.bz`,
    isTest: true,
  });
  expect(company.status, `terminal company creation failed for ${label}`).toBe(201);
  const companyId = company.body.id;

  const locA = await postWithCsrf<{ id: string }>(adminPage, `/admin/terminal/companies/${companyId}/locations`, { hubId: hubA!.id });
  const locB = await postWithCsrf<{ id: string }>(adminPage, `/admin/terminal/companies/${companyId}/locations`, { hubId: hubB!.id });
  expect(locA.status, 'adding hubA location failed').toBe(201);
  expect(locB.status, 'adding hubB location failed').toBe(201);

  const email = `mdf705-${label.toLowerCase()}-staff-${stamp}@example.bz`;
  const invite = await postWithCsrf<{ id: string }>(adminPage, `/admin/terminal/companies/${companyId}/invites`, {
    email,
    memberRole,
    locationIds: [locA.body.id, locB.body.id],
  });
  expect(invite.status, `inviting the ${memberRole} failed`).toBe(201);

  const mailbox = await getJson<{ body: string }>(adminPage, `/dev/emails/latest?email=${encodeURIComponent(email)}`);
  expect(mailbox.status, 'dev mailbox did not capture the invite email -- is NODE_ENV production?').toBe(200);
  const token = mailbox.body.body.match(/token=([^"&\s]+)/)?.[1];
  expect(token, 'could not find the invite token in the captured email body').toBeTruthy();

  const staffPage = await adminPage.context().browser()!.newContext().then((c) => c.newPage());
  await staffPage.goto(WEB);
  const accepted = await postWithCsrf<{ accepted: boolean }>(staffPage, '/terminal/invites/accept', {
    token,
    password: UAT_FIXTURE_PASSWORD,
    firstName: label,
    lastName: 'Staff',
  });
  expect(accepted.status, `accept-invite failed for ${label}`).toBe(201);
  await staffPage.close();

  return { email, companyName, hubA: hubA!, hubB: hubB! };
}

test('MANAGER login: real session, real nav entry, workspace shows the correct company/role/location count', async ({ browser }) => {
  test.setTimeout(60_000);
  const adminPage = await (await browser.newContext()).newPage();
  await adminLogin(adminPage);
  const { email, companyName } = await createTerminalStaff(adminPage, 'MANAGER', 'Manager');

  const page = await (await browser.newContext()).newPage();
  const loggedIn = await tryLogin(page, email, UAT_FIXTURE_PASSWORD);
  expect(loggedIn, 'MANAGER could not log in through the real /login form').toBeTruthy();

  // Navigation: the sidebar's "Terminal Workspace" link only renders once
  // useTerminalMembership's GET /terminal/me succeeds -- assert the LINK
  // itself, not just that the destination URL happens to work, so a
  // regression that hides the nav entry (but leaves the route reachable by
  // direct URL) is still caught.
  await page.goto(`${WEB}/dashboard`);
  const navLink = page.getByRole('link', { name: 'Terminal Workspace' });
  await expect(navLink, 'MANAGER signed in but the Terminal Workspace nav entry never appeared').toBeVisible({ timeout: 15_000 });
  await navLink.click();
  await page.waitForURL(/\/dashboard\/terminal$/, { timeout: 10_000 });

  // Session handling: the workspace header must name THIS company and role
  // -- not a generic loading/error state, and not another company's name.
  await expect(page.getByRole('heading', { name: companyName }), 'workspace header did not show the MANAGER\'s own company name').toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/signed in as manager · 2 locations/i), 'workspace description did not read "manager" with 2 locations').toBeVisible();

  // A session re-check: reloading must not drop the membership or re-ask for
  // login -- still on /dashboard/terminal, still showing the same header.
  await page.reload();
  await expect(page.getByRole('heading', { name: companyName }), 'workspace session did not survive a reload').toBeVisible({ timeout: 15_000 });
  expect(page.url(), 'reload bounced the session back to /login').toContain('/dashboard/terminal');
});

test('A non-terminal-staff account never sees the Terminal Workspace nav entry or a usable workspace', async ({ browser }) => {
  test.setTimeout(30_000);
  const page = await (await browser.newContext()).newPage();
  expect(await tryLogin(page, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD)).toBeTruthy();

  await page.goto(`${WEB}/dashboard`);
  await expect(page.getByRole('link', { name: 'Terminal Workspace' }), 'a plain customer must never see this nav entry').toHaveCount(0);

  // Direct-URL check: the route itself must refuse, not merely be unlinked --
  // navigability-by-hiding-the-link is not the same guarantee as authorization.
  await page.goto(`${WEB}/dashboard/terminal`);
  await expect(
    page.getByText('No active terminal company membership'),
    'a non-member reaching the route directly must see the no-membership empty state, not a workspace',
  ).toBeVisible({ timeout: 15_000 });
});

test('TODAY: OPERATOR gets the identical workspace/nav/session a MANAGER gets -- MDF-698 is what is expected to change this', async ({ browser }) => {
  test.setTimeout(60_000);
  const adminPage = await (await browser.newContext()).newPage();
  await adminLogin(adminPage);
  const { email, companyName } = await createTerminalStaff(adminPage, 'OPERATOR', 'Operator');

  const page = await (await browser.newContext()).newPage();
  const loggedIn = await tryLogin(page, email, UAT_FIXTURE_PASSWORD);
  expect(loggedIn, 'OPERATOR could not log in through the real /login form').toBeTruthy();

  await page.goto(`${WEB}/dashboard`);
  await expect(page.getByRole('link', { name: 'Terminal Workspace' }), 'OPERATOR should see the nav entry exactly as MANAGER does today').toBeVisible({ timeout: 15_000 });
  await page.goto(`${WEB}/dashboard/terminal`);
  await expect(page.getByRole('heading', { name: companyName })).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByText(/signed in as operator · 2 locations/i),
    'workspace description must say "operator", proving memberRole is read for display even though nothing gates on it',
  ).toBeVisible();

  console.log(
    '[ROLE-TODAY] FINDING, confirmed live: an OPERATOR reached the identical page, with the identical two locations, that a MANAGER did in the sibling test. ' +
      'terminal.service.ts assertStaffLocationAccess (the one check every terminal write goes through) filters only on location.hubId + ACTIVE membership -- ' +
      'it never reads memberRole. There is currently no Manager-only action anywhere in the Terminal Workspace to restrict an Operator from.',
  );
});

/**
 * PENDING MDF-698. Cannot be written yet without inventing a business rule:
 * there is no permission matrix today naming which actions are Manager-only.
 * Once MDF-698 lands, replace this stub with real assertions of the form
 * "OPERATOR attempts <forbidden action> -> 403, custody/state unchanged" for
 * each action MDF-698 actually restricts. Do not guess the list here.
 */
test.fixme(
  'OPERATOR is refused the Manager-only actions MDF-698 defines (PENDING: exact action list not yet specified)',
  async () => {},
);
