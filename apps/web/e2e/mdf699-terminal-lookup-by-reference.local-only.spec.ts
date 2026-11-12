import { test, expect, type Page } from '@playwright/test';
import { tryLogin, UAT_FIXTURE_PASSWORD } from './support/auth';

/**
 * [LOCAL ONLY, MDF-705 follow-up] Written ahead of MDF-699 (Pam, API)
 * landing a terminal-scoped lookup endpoint. Per the card's own text: a
 * lookup by shipment reference or tracking number, scoped to the caller's
 * own terminal locations (`assertStaffLocationAccess` must still bind),
 * returning a detail payload rich enough for a counter conversation, MUST
 * reject a reference belonging to another terminal, and MUST NEVER return
 * a collection code, PIN or reveal token to a terminal-authenticated
 * caller.
 *
 * No route exists yet (confirmed in the already-merged MDF-705 batch: zero
 * search input on page.tsx, no query param on GET /terminal/queue, no
 * GET /terminal/shipments/:ref anywhere on terminal.controller.ts). Every
 * test below except the first is `test.fixme`, each naming the exact
 * assertion to make real the moment MDF-699 publishes its route -- not a
 * guessed route, since the card text does not commit to one and inventing
 * it would be exactly the business-rule guess CLAUDE.md §12 forbids.
 *
 * The one test that runs today proves an absence, which a pass-count tally
 * cannot tell apart from a healthy feature -- Stanley's ruling on this
 * file's sibling (MDF-709/710). Its title starts `GAP-PROOF:` so it can be
 * excluded from any such tally by title/grep. It asserts the control is
 * absent by a best-guess label regex (`reference|tracking|search|lookup`);
 * that regex, not just the absence, will need re-checking against
 * whatever MDF-699/MDF-702 actually ships (a control labelled e.g. "Find a
 * shipment" would slip past it) -- plan to replace this with a positive
 * lookup test once MDF-699 lands, not just flip a wording nit.
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

async function createTerminalStaff(adminPage: Page, label: string, hubId: string): Promise<{ email: string }> {
  const company = await postWithCsrf<{ id: string }>(adminPage, '/admin/terminal/companies', {
    businessName: `MDF699 ${label} Co ${stamp}`,
    contactEmail: `mdf699-${label.toLowerCase()}-co-${stamp}@example.bz`,
    isTest: true,
  });
  expect(company.status).toBe(201);
  const loc = await postWithCsrf<{ id: string }>(adminPage, `/admin/terminal/companies/${company.body.id}/locations`, { hubId });
  expect(loc.status).toBe(201);
  const email = `mdf699-${label.toLowerCase()}-staff-${stamp}@example.bz`;
  const invite = await postWithCsrf<{ id: string }>(adminPage, `/admin/terminal/companies/${company.body.id}/invites`, {
    email,
    memberRole: 'OPERATOR',
    locationIds: [loc.body.id],
  });
  expect(invite.status).toBe(201);
  const mailbox = await getJson<{ body: string }>(adminPage, `/dev/emails/latest?email=${encodeURIComponent(email)}`);
  const token = mailbox.body.body.match(/token=([^"&\s]+)/)?.[1];
  const staffPage = await adminPage.context().browser()!.newContext().then((c) => c.newPage());
  await staffPage.goto(WEB);
  await postWithCsrf(staffPage, '/terminal/invites/accept', { token, password: UAT_FIXTURE_PASSWORD, firstName: label, lastName: 'Staff' });
  await staffPage.close();
  return { email };
}

/** Positive control for the absence check below: prove the workspace
 * actually loaded a real, non-error session first. Without this, a lookup
 * control's absence would pass just as happily on a blank/errored page
 * (Stanley's finding, originally raised against MDF-705's sibling spec). */
async function waitForWorkspaceLoaded(page: Page): Promise<void> {
  await expect(page.getByText(/signed in as (manager|operator) ·/i), 'workspace never actually loaded (would make the "no lookup control" check below meaningless)').toBeVisible({
    timeout: 15_000,
  });
}

test('GAP-PROOF: the Terminal Workspace has no lookup-by-reference control anywhere, and the queue endpoint has no query parameter to filter by', async ({ browser }) => {
  test.setTimeout(60_000);
  const adminPage = await (await browser.newContext()).newPage();
  await adminLogin(adminPage);
  const { body: hubs } = await getJson<Array<{ id: string; code: string }>>(adminPage, '/admin/logistics/hubs');
  const hubA = hubs.find((h) => h.code === 'UATBC');
  expect(hubA, 'UATBC simulation hub not found').toBeTruthy();
  const { email } = await createTerminalStaff(adminPage, 'Today', hubA!.id);

  const staffPage = await (await browser.newContext()).newPage();
  expect(await tryLogin(staffPage, email, UAT_FIXTURE_PASSWORD)).toBeTruthy();
  await staffPage.goto(`${WEB}/dashboard/terminal`);
  await waitForWorkspaceLoaded(staffPage);

  await expect(staffPage.getByRole('textbox', { name: /reference|tracking|search|lookup/i }), 'a lookup control must not exist yet -- MDF-699 is the card to add it').toHaveCount(0);
  await expect(staffPage.getByRole('button', { name: /search|look ?up/i }), 'no lookup button exists yet either').toHaveCount(0);

  console.log('[MDF699-GAP] confirmed live: nothing on the Terminal Workspace page lets a clerk look anything up by reference.');
});

/**
 * PENDING MDF-699. Route not yet published -- this is the primary happy
 * path the card describes: a terminal staff member looks up a reference
 * belonging to a shipment with a leg at one of THEIR OWN granted hubs, and
 * gets back a detail payload (status, parcel description, pieces, current
 * custody step -- enough for a counter conversation) with NO code/PIN/
 * reveal-token field present at all, not merely null.
 */
test.fixme('A terminal staff member can look up a reference at their own hub and gets a detail payload with no code/PIN/reveal-token field (PENDING: route not published)', async () => {});

/**
 * PENDING MDF-699. The card's own named negative case: a reference whose
 * leg(s) touch only a DIFFERENT terminal's hub(s) must be refused -- same
 * "structurally invisible, not merely 403'd" standard MDF-705's own
 * WRONG-TERMINAL case already proved for the queue (assertStaffLocationAccess
 * must still bind, per the card text verbatim).
 */
test.fixme('A reference belonging to another terminal is refused on lookup, the same way it is invisible in the queue (PENDING: route not published)', async () => {});

/**
 * PENDING MDF-699. A reference that does not exist at all, and a reference
 * for a DIRECT (no-hub) shipment -- both must be refused the same
 * structural way as "another terminal," never a different error shape that
 * would let staff distinguish "exists elsewhere" from "exists but not
 * here" from "never existed" (an information-leak the card's own "never
 * return a collection code, PIN or reveal token" spirit implies extends to
 * not leaking existence either, though the card does not say so in so many
 * words -- confirm this reading with Pam rather than asserting it as fact
 * once the route exists).
 */
test.fixme('An unknown reference and a DIRECT (no-hub) reference are both refused, ideally indistinguishably from the wrong-terminal case (PENDING: route not published; confirm the no-leak reading with Pam)', async () => {});
