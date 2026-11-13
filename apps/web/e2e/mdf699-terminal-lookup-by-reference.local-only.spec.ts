import { test, expect, type Page } from '@playwright/test';
import { tryLogin, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD } from './support/auth';

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
 * UPDATE (2026-11-12, #686/bbf90094): the API half of this card has
 * SHIPPED -- `GET /terminal/shipments/:reference` on
 * `TerminalShipmentsController`, scoped via `myActiveHubIds`, 404 for an
 * unknown reference, 403 for a real shipment that touches none of the
 * caller's hubs (confirmed by reading `ShipmentService.lookupForTerminal`
 * directly, not guessed). The three tests below that were `test.fixme`
 * are now real, against that exact contract.
 *
 * UPDATE (2026-11-13, #692): the UI half (Oscar/MDF-702 step 2) has also
 * SHIPPED -- a "Lookup" tab on the Terminal Workspace page, consuming the
 * exact endpoint above. Stanley has cleared #692 on substance; it is only
 * BLOCKED from `main` by an unrelated red build (MDF-709 recipient spec),
 * which Pam is fixing, so this is written against the real diff
 * (`apps/web/app/dashboard/terminal/page.tsx` on PR #692) rather than
 * guessed, ready to push the moment main is green. Settled facts from
 * that diff, not assumptions: the tab is visible to EVERY member
 * regardless of role (lookup is hub-scoped, not role-scoped -- do not
 * assert MANAGER-only), and the two server refusals render VERBATIM, word
 * for word: 404 -> "No shipment with that reference.", 403 -> "This
 * shipment is not at one of your terminal locations." The former
 * `GAP-PROOF:` UI-absence test is replaced below with real tests driving
 * the real tab, per the exact moment this file's own header warned about.
 *
 * A SECOND, SEPARATE defect Stanley found in the same #692 diff, same
 * class as MDF-720 (one fetch failing silently removes an unrelated
 * capability): the entire tab bar -- Lookup included -- is gated behind
 * `{rows && (...)}`, and `rows` is `/terminal/queue`'s own state. Lookup's
 * data source (`/terminal/shipments/:reference`) has no dependency on the
 * queue at all, so a queue fetch failure hides a capability that never
 * needed it. One more `GAP-PROOF:` test below proves that live, using the
 * same `page.route` intercept technique MDF-720's spec established.
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

async function findHubs(adminPage: Page): Promise<{ hubA: { id: string; code: string }; hubB: { id: string; code: string } }> {
  const { body: hubs } = await getJson<Array<{ id: string; code: string }>>(adminPage, '/admin/logistics/hubs');
  const hubA = hubs.find((h) => h.code === 'UATBC');
  const hubB = hubs.find((h) => h.code === 'UATBP');
  expect(hubA && hubB, 'UATBC/UATBP simulation hubs not found').toBeTruthy();
  return { hubA: hubA!, hubB: hubB! };
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

/** Books HUB_TO_DOOR (hub -> a Belize City door) via the real endpoint --
 * same sanctioned route-around mdf705's release-to-courier fixture already
 * uses, since the booking UI's hub picker cannot select an isTest hub.
 * Touches exactly ONE hub (the origin), deterministically -- no planner
 * routing ambiguity, unlike a door-origin booking. */
async function bookHubToDoor(customerPage: Page, hubId: string, label: string): Promise<{ reference: string }> {
  const booking = {
    service: 'HUB_TO_DOOR',
    origin: { hubId },
    destination: { name: label, phone: '501-222-7099', address: '12 MDF-699 Fixture Road', city: 'Belize City', district: 'BELIZE' },
    pieces: 1,
    description: `MDF-699 fixture ${label}`,
    payWithWallet: true,
  };
  await postWithCsrf(customerPage, '/shipping/quote', booking);
  const created = await postWithCsrf<{ reference: string }>(customerPage, '/shipping', booking);
  expect(created.status, `HUB_TO_DOOR booking failed: ${JSON.stringify(created.body)}`).toBe(201);
  return { reference: created.body.reference };
}

type LookupResponse = {
  shipmentId: string;
  reference: string;
  status: string;
  description: string;
  pieces: number;
  isTest: boolean;
  senderName: string | null;
  recipientName: string | null;
  legs: Array<{ sequence: number; kind: string; status: string }>;
};

test('A terminal staff member can look up a reference at their own hub and gets a detail payload with no code/PIN/reveal-token field', async ({ browser }) => {
  test.setTimeout(60_000);
  const adminPage = await (await browser.newContext()).newPage();
  await adminLogin(adminPage);
  const { hubA } = await findHubs(adminPage);
  const { email } = await createTerminalStaff(adminPage, 'OwnHub', hubA.id);

  const customerPage = await (await browser.newContext()).newPage();
  expect(await tryLogin(customerPage, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD)).toBeTruthy();
  const { reference } = await bookHubToDoor(customerPage, hubA.id, `Mdf699OwnHub ${stamp}`);

  const staffPage = await (await browser.newContext()).newPage();
  expect(await tryLogin(staffPage, email, UAT_FIXTURE_PASSWORD)).toBeTruthy();

  const lookup = await getJson<LookupResponse>(staffPage, `/terminal/shipments/${encodeURIComponent(reference)}`);
  expect(lookup.status, 'a staff member at the right hub must get 200').toBe(200);
  expect(lookup.body.reference).toBe(reference);
  expect(Array.isArray(lookup.body.legs), 'detail payload must include a legs array for a counter conversation').toBeTruthy();

  const leakedKeys = Object.keys(lookup.body).filter((k) => /code|pin|token/i.test(k));
  expect(leakedKeys, `response must never carry a code/PIN/token field, found: ${leakedKeys.join(', ')}`).toEqual([]);
});

test('A reference belonging to another terminal is refused on lookup with a real 403, never a silent empty result', async ({ browser }) => {
  test.setTimeout(60_000);
  const adminPage = await (await browser.newContext()).newPage();
  await adminLogin(adminPage);
  const { hubA, hubB } = await findHubs(adminPage);
  // Staff holds ONLY hubA. Book a shipment that touches ONLY hubB.
  const { email } = await createTerminalStaff(adminPage, 'WrongHub', hubA.id);

  const customerPage = await (await browser.newContext()).newPage();
  expect(await tryLogin(customerPage, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD)).toBeTruthy();
  const { reference } = await bookHubToDoor(customerPage, hubB.id, `Mdf699WrongHub ${stamp}`);

  const staffPage = await (await browser.newContext()).newPage();
  expect(await tryLogin(staffPage, email, UAT_FIXTURE_PASSWORD)).toBeTruthy();

  const lookup = await getJson<Record<string, unknown>>(staffPage, `/terminal/shipments/${encodeURIComponent(reference)}`);
  expect(lookup.status, 'a real shipment at a DIFFERENT terminal must be a real 403, not a 200 with empty/null fields').toBe(403);
  expect('reference' in lookup.body, '403 body must not leak the shipment payload').toBe(false);
});

test('An unknown reference gets 404, and a DIRECT (no-hub) reference gets the same 403 as the wrong-terminal case', async ({ browser }) => {
  test.setTimeout(60_000);
  const adminPage = await (await browser.newContext()).newPage();
  await adminLogin(adminPage);
  const { hubA } = await findHubs(adminPage);
  const { email } = await createTerminalStaff(adminPage, 'NoHub', hubA.id);

  const staffPage = await (await browser.newContext()).newPage();
  expect(await tryLogin(staffPage, email, UAT_FIXTURE_PASSWORD)).toBeTruthy();

  // Unknown reference: no shipment with this reference exists anywhere.
  const unknown = await getJson(staffPage, `/terminal/shipments/BML-MDF699-NOPE-${stamp}`);
  expect(unknown.status, 'a reference that never existed must be 404, distinct from the wrong-terminal 403').toBe(404);

  // DIRECT (no-hub): a DOOR_TO_DOOR shipment touches no hub at all, so it
  // takes the SAME path as "touches none of my hubs" -- 403, confirmed by
  // reading ShipmentService.lookupForTerminal directly, not guessed. The
  // original fixme here asked whether this should be indistinguishable
  // from the wrong-terminal case to avoid an existence leak; the shipped
  // contract answers that by construction, since both a real-but-elsewhere
  // shipment and a real-but-hub-less shipment hit the identical 403 branch
  // (only "never existed anywhere" gets the different 404).
  const customerPage = await (await browser.newContext()).newPage();
  expect(await tryLogin(customerPage, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD)).toBeTruthy();
  const doorToDoor = {
    service: 'DOOR_TO_DOOR',
    origin: { name: 'Sender', phone: '501-222-7098', address: '1 MDF-699 Sender Road', city: 'Belize City', district: 'BELIZE' },
    destination: { name: `Mdf699Direct ${stamp}`, phone: '501-222-7097', address: '2 MDF-699 Recipient Road', city: 'Belize City', district: 'BELIZE' },
    pieces: 1,
    description: `MDF-699 DIRECT fixture ${stamp}`,
    payWithWallet: true,
  };
  await postWithCsrf(customerPage, '/shipping/quote', doorToDoor);
  const created = await postWithCsrf<{ reference: string }>(customerPage, '/shipping', doorToDoor);
  expect(created.status, `DOOR_TO_DOOR booking failed: ${JSON.stringify(created.body)}`).toBe(201);

  const direct = await getJson(staffPage, `/terminal/shipments/${encodeURIComponent(created.body.reference)}`);
  expect(direct.status, 'a DIRECT shipment touches no hub, so it must 403 the same way a wrong-terminal shipment does').toBe(403);
});

/** Opens the real "Lookup" tab (#692) and submits a reference through the
 * real input/button, rather than the raw API -- this is the UI half, now
 * that there is a UI to drive. */
async function lookupViaTab(staffPage: Page, reference: string): Promise<void> {
  await staffPage.getByRole('tab', { name: 'Lookup' }).click();
  await staffPage.getByLabel('Shipment reference').fill(reference);
  await staffPage.getByRole('button', { name: /look ?up/i }).click();
}

test('A terminal staff member can look up a reference at their own hub through the real Lookup tab and sees the detail rendered', async ({ browser }) => {
  test.setTimeout(60_000);
  const adminPage = await (await browser.newContext()).newPage();
  await adminLogin(adminPage);
  const { hubA } = await findHubs(adminPage);
  // OPERATOR, deliberately: #692's own contract is hub-scoped, not
  // role-scoped -- this is NOT a MANAGER-only screen, and using OPERATOR
  // here is the live demonstration, not just a claim in a comment.
  const { email } = await createTerminalStaff(adminPage, 'UiOwnHub', hubA.id);

  const customerPage = await (await browser.newContext()).newPage();
  expect(await tryLogin(customerPage, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD)).toBeTruthy();
  const { reference } = await bookHubToDoor(customerPage, hubA.id, `Mdf699UiOwnHub ${stamp}`);

  const staffPage = await (await browser.newContext()).newPage();
  expect(await tryLogin(staffPage, email, UAT_FIXTURE_PASSWORD)).toBeTruthy();
  await staffPage.goto(`${WEB}/dashboard/terminal`);
  await waitForWorkspaceLoaded(staffPage);

  await lookupViaTab(staffPage, reference);
  await expect(staffPage.getByText(reference, { exact: false }), 'the real shipment detail must render for an OPERATOR, not just a MANAGER').toBeVisible({ timeout: 15_000 });
  await expect(staffPage.getByText('Leg 1', { exact: false }), 'the leg list must render -- this is the detail payload rich enough for a counter conversation the card asked for').toBeVisible();
  await expect(staffPage.getByText('Demo', { exact: true }), 'every shipment this spec books is isTest -- the T-7 Demo badge must render, never silently omitted').toBeVisible();
});

test('The Lookup tab shows the server\'s own refusal message verbatim, never a paraphrase or a silent empty result', async ({ browser }) => {
  test.setTimeout(60_000);
  const adminPage = await (await browser.newContext()).newPage();
  await adminLogin(adminPage);
  const { hubA, hubB } = await findHubs(adminPage);
  const { email } = await createTerminalStaff(adminPage, 'UiWrongHub', hubA.id);

  const customerPage = await (await browser.newContext()).newPage();
  expect(await tryLogin(customerPage, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD)).toBeTruthy();
  const { reference: wrongTerminalRef } = await bookHubToDoor(customerPage, hubB.id, `Mdf699UiWrongHub ${stamp}`);

  const staffPage = await (await browser.newContext()).newPage();
  expect(await tryLogin(staffPage, email, UAT_FIXTURE_PASSWORD)).toBeTruthy();
  await staffPage.goto(`${WEB}/dashboard/terminal`);
  await waitForWorkspaceLoaded(staffPage);

  await lookupViaTab(staffPage, wrongTerminalRef);
  await expect(
    staffPage.getByText('This shipment is not at one of your terminal locations.'),
    'god\'s own ruling: a customer at the wrong terminal must be told their parcel is real and elsewhere, never that it does not exist',
  ).toBeVisible({ timeout: 15_000 });

  await lookupViaTab(staffPage, `BML-MDF699-UI-NOPE-${stamp}`);
  await expect(staffPage.getByText('No shipment with that reference.'), 'the OTHER refusal -- a reference that never existed anywhere -- must be a visibly different message').toBeVisible({ timeout: 15_000 });
});

test('GAP-PROOF: the Lookup tab, which has no dependency on the queue, disappears entirely when GET /terminal/queue fails', async ({ browser }) => {
  test.setTimeout(60_000);
  const adminPage = await (await browser.newContext()).newPage();
  await adminLogin(adminPage);
  const { hubA } = await findHubs(adminPage);
  const { email } = await createTerminalStaff(adminPage, 'QueueDown', hubA.id);

  const staffPage = await (await browser.newContext()).newPage();
  expect(await tryLogin(staffPage, email, UAT_FIXTURE_PASSWORD)).toBeTruthy();
  await staffPage.route('**/api/terminal/queue', async (route) => {
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });

  await staffPage.goto(`${WEB}/dashboard/terminal`);
  // Positive control: the workspace itself (independent of the queue)
  // genuinely loaded -- so what follows means something, not "blank page".
  await waitForWorkspaceLoaded(staffPage);
  await expect(staffPage.getByText('Could not load your queue.'), 'the page must show the queue actually failed, not render nothing at all').toBeVisible({ timeout: 15_000 });

  // CONFIRMED GAP: the entire tab bar, including Lookup, is gated behind
  // the queue's own `rows` state (`{rows && (<tablist>...)}` in
  // page.tsx) -- a capability with NO dependency on the queue vanishes
  // because of it. Same class as MDF-720: one fetch failing silently
  // removes an unrelated capability.
  await expect(staffPage.getByRole('tab', { name: 'Lookup' }), 'CONFIRMED GAP: a failed queue fetch hides the Lookup tab too, even though Lookup never reads the queue').toHaveCount(0);
});
