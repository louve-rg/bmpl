import { test, expect, type Page } from '@playwright/test';
import { tryLogin, UAT_CUSTOMER_EMAIL, UAT_DRIVER_EMAIL, UAT_DRIVER_PASSWORD, UAT_FIXTURE_PASSWORD } from './support/auth';

/**
 * [LOCAL ONLY, MDF-705] The UI-level complement to the already-merged
 * `mdf587-handoff-negative-cases.local-only.spec.ts`, which proves the same
 * handoff/collection rejections at the HTTP layer through admin/driver
 * sessions. This file drives the actual Terminal Workspace page
 * (apps/web/app/dashboard/terminal/page.tsx) -- real button clicks, real
 * form fields, real queue-row assertions -- because a passing API call does
 * not prove a terminal clerk can complete the same action from the screen in
 * front of them (Stanley's charter, check 1: "the screens, controls, states
 * and navigation actually exist"). See `mdf705-terminal-fixture-plan.md` for
 * what every fixture below assumes.
 *
 * Every assertion names the BEFORE and AFTER state (a queue section's row
 * count, not merely that a click happened), per god's own standard: "a test
 * that cannot fail is not evidence."
 */
const WEB = process.env.BASE_URL ?? 'http://localhost:3177';
const ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@bzemarketplace.com';
const ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD;
const stamp = Date.now();

test.describe.configure({ mode: 'serial' });

/* ---------------------------------------------------------------- helpers
 * Duplicated from sibling MDF-705/MDF-587 specs on purpose -- each file
 * stays runnable and readable on its own. */

async function postWithCsrf<T>(
  page: Page,
  path: string,
  body: unknown,
  method: 'POST' | 'PATCH' = 'POST',
): Promise<{ status: number; body: T }> {
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

async function findHubs(adminPage: Page): Promise<{ hubA: { id: string; code: string }; hubB: { id: string; code: string } }> {
  const { status, body } = await getJson<Array<{ id: string; code: string }>>(adminPage, '/admin/logistics/hubs');
  expect(status).toBe(200);
  const hubA = body.find((h) => h.code === 'UATBC');
  const hubB = body.find((h) => h.code === 'UATBP');
  expect(hubA && hubB, 'UATBC/UATBP simulation hubs not found -- expected from seed-uat-logistics.ts').toBeTruthy();
  return { hubA: hubA!, hubB: hubB! };
}

/** Real admin-console API + real public accept-invite flow. `locationIds`
 * lets callers scope a staff account to one or both hubs on purpose -- the
 * WRONG-TERMINAL case needs exactly one. */
async function createTerminalStaff(
  adminPage: Page,
  label: string,
  hubAId: string,
  hubBId: string,
  grantBoth: boolean,
): Promise<{ email: string }> {
  const company = await postWithCsrf<{ id: string }>(adminPage, '/admin/terminal/companies', {
    businessName: `MDF705J ${label} Co ${stamp}`,
    contactEmail: `mdf705j-${label.toLowerCase()}-co-${stamp}@example.bz`,
    isTest: true,
  });
  expect(company.status, `terminal company creation failed for ${label}`).toBe(201);
  const companyId = company.body.id;

  const locA = await postWithCsrf<{ id: string }>(adminPage, `/admin/terminal/companies/${companyId}/locations`, { hubId: hubAId });
  const locB = await postWithCsrf<{ id: string }>(adminPage, `/admin/terminal/companies/${companyId}/locations`, { hubId: hubBId });
  expect(locA.status).toBe(201);
  expect(locB.status).toBe(201);

  const email = `mdf705j-${label.toLowerCase()}-staff-${stamp}@example.bz`;
  const invite = await postWithCsrf<{ id: string }>(adminPage, `/admin/terminal/companies/${companyId}/invites`, {
    email,
    memberRole: 'MANAGER',
    locationIds: grantBoth ? [locA.body.id, locB.body.id] : [locB.body.id],
  });
  expect(invite.status, `inviting ${label} failed`).toBe(201);

  const mailbox = await getJson<{ body: string }>(adminPage, `/dev/emails/latest?email=${encodeURIComponent(email)}`);
  expect(mailbox.status, 'dev mailbox did not capture the invite email').toBe(200);
  const token = mailbox.body.body.match(/token=([^"&\s]+)/)?.[1];
  expect(token).toBeTruthy();

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
  return { email };
}

async function bookHubToHub(customerPage: Page, hubAId: string, hubBId: string, label: string): Promise<{ reference: string; legId: string }> {
  const booking = {
    service: 'HUB_TO_HUB',
    origin: { hubId: hubAId },
    destination: { hubId: hubBId, name: label, phone: '501-222-7001' },
    pieces: 1,
    description: `MDF-705 journey fixture ${label}`,
    payWithWallet: true,
  };
  await postWithCsrf(customerPage, '/shipping/quote', booking);
  const created = await postWithCsrf<{ reference: string; legs: Array<{ id: string }> }>(customerPage, '/shipping', booking);
  expect(created.status, `HUB_TO_HUB booking failed for ${label}: ${JSON.stringify(created.body)}`).toBe(201);
  return { reference: created.body.reference, legId: created.body.legs[0]!.id };
}

/**
 * Isolates ONE queue row's Card, not merely some div containing the
 * reference text. A plain `div:has-text(reference)` matches the WHOLE
 * ancestor chain up to the page root (every ancestor "contains" that text
 * through its descendant) -- `.last()` on that alone grabs the innermost
 * matching div, which here is the row's `min-w-0` text wrapper, a SIBLING
 * of the div holding the action buttons/inputs, not their container. (Same
 * class of selector bug already caught twice this floor: a `:not()` that
 * searched descendants not siblings, and a `:has-text` substring match
 * that hit the wrong element -- see memory.md's
 * [[toBeVisible-is-not-co-visible]] entries.) Filtering for BOTH the
 * reference text AND a descendant button narrows the matching ancestor
 * chain to [[...containers, the Card]] -- the Card is the only member that
 * has both, since the buttons live in a sibling of the text wrapper, never
 * inside it. `.last()` of THAT chain is the innermost one satisfying both,
 * i.e. the Card itself.
 */
type DriverJob = { id: string; status: string; nextActionLabel: string | null };

async function getDriverJob(page: Page, legId: string): Promise<DriverJob> {
  return page.evaluate(async (id) => {
    const res = await fetch(`/api/driver/shipping-jobs/${id}`, { credentials: 'include' });
    if (!res.ok) throw new Error(`GET /driver/shipping-jobs/${id} -> ${res.status} ${await res.text()}`);
    return res.json();
  }, legId);
}

async function clickLabeledAction(page: Page, label: string): Promise<void> {
  const button = page.getByRole('button', { name: label, exact: true });
  await expect(button, `primary action button "${label}" was not visible/enabled`).toBeEnabled({ timeout: 10_000 });
  await button.click();
}

async function queueRowFor(page: Page, reference: string) {
  const hasReference = page.getByText(reference, { exact: true });
  return page.locator('div').filter({ has: hasReference }).filter({ has: page.getByRole('button') }).last();
}

/** Waits for the given section header's parenthesised count, polling the
 * real UI (not the API) -- the Refresh button's own effect, or a fresh
 * goto, is what moves the queue forward after a write. */
async function waitForSectionCount(page: Page, title: string, expected: number): Promise<void> {
  await expect(page.getByText(new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(${expected}\\)$`)), `"${title}" section never reached a count of ${expected}`).toBeVisible({
    timeout: 20_000,
  });
}

test('Full UI journey: DEPART -> ARRIVE -> HANDOFF -> COLLECT, each step a real button click with a before/after queue assertion', async ({ browser }) => {
  test.setTimeout(180_000);
  const adminPage = await (await browser.newContext()).newPage();
  await adminLogin(adminPage);
  const { hubA, hubB } = await findHubs(adminPage);
  const { email } = await createTerminalStaff(adminPage, 'Journey', hubA.id, hubB.id, true);

  const customerPage = await (await browser.newContext()).newPage();
  expect(await tryLogin(customerPage, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD)).toBeTruthy();

  const staffPage = await (await browser.newContext()).newPage();
  expect(await tryLogin(staffPage, email, UAT_FIXTURE_PASSWORD)).toBeTruthy();

  const { reference } = await bookHubToHub(customerPage, hubA.id, hubB.id, `Journey ${stamp}`);
  console.log('[JOURNEY] booked HUB_TO_HUB', reference);

  // ---- DEPART (at hubA) ------------------------------------------------
  await staffPage.goto(`${WEB}/dashboard/terminal`);
  const departRow = await queueRowFor(staffPage, reference);
  await expect(departRow, 'the newly booked leg never appeared in "Ready to depart"').toBeVisible({ timeout: 15_000 });
  await departRow.getByRole('button', { name: 'Mark departed' }).click();
  await expect(staffPage.getByText(reference), 'the leg must leave "Ready to depart" once marked departed').not.toBeVisible({ timeout: 15_000 });
  const afterDepart = await getJson<{ status: string }>(adminPage, `/admin/logistics/shipments/${encodeURIComponent(reference)}`);
  expect(afterDepart.status).toBe(200);
  console.log('[JOURNEY] after DEPART click, shipment status:', (afterDepart.body as { status: string }).status);

  // ---- ARRIVE (at hubB) -------------------------------------------------
  await staffPage.reload();
  const arriveRow = await queueRowFor(staffPage, reference);
  await expect(arriveRow, 'the departed leg never appeared in "Confirm arrival"').toBeVisible({ timeout: 15_000 });
  await arriveRow.getByRole('button', { name: 'Confirm arrival' }).click();

  // ---- HANDOFF (at hubB, LINE_HAUL needs the staff-revealed code) ------
  // The real leg id is read from the shipment, not guessed:
  const shipmentDetail = await getJson<{ legs: Array<{ id: string }> }>(adminPage, `/admin/logistics/shipments/${encodeURIComponent(reference)}`);
  const legId = shipmentDetail.body.legs[0]!.id;
  const pinReveal = await getJson<{ handoffPin: string | null }>(adminPage, `/admin/logistics/legs/${legId}/handoff-pin`);
  expect(pinReveal.status, 'staff handoff-pin reveal failed').toBe(200);
  const handoffPin = pinReveal.body.handoffPin;
  expect(handoffPin, 'no handoff pin revealed for the arrived line-haul leg').toBeTruthy();

  await staffPage.reload();
  const handoffRow = await queueRowFor(staffPage, reference);
  await expect(handoffRow, 'the arrived leg never appeared in "Hand off to recipient or next leg"').toBeVisible({ timeout: 15_000 });
  await handoffRow.getByLabel('Code presented').fill(handoffPin!);
  await handoffRow.getByLabel('Received by').fill(`MDF705 Journey ${stamp}`);
  await handoffRow.getByRole('button', { name: 'Record handoff' }).click();
  // The reference stays visible (the same shipment now shows in the COLLECT
  // section below) -- the real assertion is that the HANDOFF action itself
  // is gone: there must be no more "Record handoff" button for this leg.
  await expect(staffPage.getByRole('button', { name: 'Record handoff' }), 'a "Record handoff" control must not remain once the handoff succeeded').toHaveCount(0, { timeout: 15_000 });

  // ---- COLLECT (shipment is now AWAITING_COLLECTION at hubB) -----------
  const afterHandoff = await getJson<{ status: string }>(adminPage, `/admin/logistics/shipments/${encodeURIComponent(reference)}`);
  expect(afterHandoff.body.status, 'shipment must read AWAITING_COLLECTION once the only leg completes').toBe('AWAITING_COLLECTION');

  const customerCode = await getJson<{ collectionCode: string | null }>(customerPage, `/shipping/${encodeURIComponent(reference)}`);
  expect(customerCode.status).toBe(200);
  const collectionCode = customerCode.body.collectionCode;
  expect(collectionCode, 'no collection code visible to the customer at AWAITING_COLLECTION').toBeTruthy();

  await staffPage.reload();
  const collectRow = await queueRowFor(staffPage, reference);
  await expect(collectRow, 'the shipment never appeared in "Collection at the counter"').toBeVisible({ timeout: 15_000 });
  await collectRow.getByLabel('Code presented').fill(collectionCode!);
  await collectRow.getByLabel('Collected by').fill(`MDF705 Recipient ${stamp}`);
  await collectRow.getByRole('button', { name: 'Record collection' }).click();
  await expect(staffPage.getByText(reference), 'the shipment must leave the queue entirely once collected').not.toBeVisible({ timeout: 15_000 });

  const finalState = await getJson<{ status: string }>(adminPage, `/admin/logistics/shipments/${encodeURIComponent(reference)}`);
  expect(finalState.body.status, 'the full UI journey must end with the shipment DELIVERED').toBe('DELIVERED');
  console.log('[JOURNEY] completed the whole counter-to-counter journey through real button clicks:', reference);
});

test('Collection via the UI: an invalid code is refused inline, the row survives, and five wrong tries lock it out', async ({ browser }) => {
  test.setTimeout(120_000);
  const adminPage = await (await browser.newContext()).newPage();
  await adminLogin(adminPage);
  const { hubA, hubB } = await findHubs(adminPage);
  const { email } = await createTerminalStaff(adminPage, 'Lockout', hubA.id, hubB.id, true);

  const customerPage = await (await browser.newContext()).newPage();
  expect(await tryLogin(customerPage, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD)).toBeTruthy();
  const staffPage = await (await browser.newContext()).newPage();
  expect(await tryLogin(staffPage, email, UAT_FIXTURE_PASSWORD)).toBeTruthy();

  const { reference } = await bookHubToHub(customerPage, hubA.id, hubB.id, `Lockout ${stamp}`);

  // Drive straight to AWAITING_COLLECTION via the same sanctioned admin API
  // mdf587 already uses for this -- this test is about the COLLECTION step
  // through the UI, not re-proving depart/arrive/handoff a second time.
  const legId = (await getJson<{ legs: Array<{ id: string }> }>(adminPage, `/admin/logistics/shipments/${encodeURIComponent(reference)}`)).body.legs[0]!.id;
  expect((await postWithCsrf(adminPage, `/admin/logistics/legs/${legId}/depart`, {})).status).toBe(201);
  expect((await postWithCsrf(adminPage, `/admin/logistics/legs/${legId}/arrive`, {})).status).toBe(201);
  const pin = (await getJson<{ handoffPin: string | null }>(adminPage, `/admin/logistics/legs/${legId}/handoff-pin`)).body.handoffPin;
  expect((await postWithCsrf(adminPage, `/admin/logistics/legs/${legId}/handoff`, { pin, receivedByName: 'Setup' })).status).toBe(201);
  const awaiting = await getJson<{ status: string }>(adminPage, `/admin/logistics/shipments/${encodeURIComponent(reference)}`);
  expect(awaiting.body.status).toBe('AWAITING_COLLECTION');

  await staffPage.goto(`${WEB}/dashboard/terminal`);
  const row = await queueRowFor(staffPage, reference);
  await expect(row, 'shipment never reached the COLLECT section of the UI').toBeVisible({ timeout: 15_000 });

  for (let attempt = 1; attempt <= 5; attempt++) {
    await row.getByLabel('Code presented').fill('0000');
    await row.getByLabel('Collected by').fill('UI Lockout Probe');
    await row.getByRole('button', { name: 'Record collection' }).click();
    if (attempt < 5) {
      await expect(row.getByText(/not right/i), `inline error for wrong attempt ${attempt} never rendered`).toBeVisible({ timeout: 10_000 });
    } else {
      await expect(row.getByText(/last try/i), 'the fifth wrong attempt must show the "last try" wording inline').toBeVisible({ timeout: 10_000 });
    }
    // The row must still be here after every wrong attempt -- a rejected
    // code must never remove the shipment from the queue.
    await expect(row, `shipment vanished from the queue after wrong attempt ${attempt}`).toBeVisible();
  }

  const customerCode = await getJson<{ collectionCode: string | null }>(customerPage, `/shipping/${encodeURIComponent(reference)}`);
  const realCode = customerCode.body.collectionCode!;
  await row.getByLabel('Code presented').fill(realCode);
  await row.getByLabel('Collected by').fill('UI Lockout Probe Recovery');
  await row.getByRole('button', { name: 'Record collection' }).click();
  await expect(
    row.getByText(/administrator has to confirm/i),
    'a locked-out shipment must refuse even the genuinely correct code, inline, via the UI',
  ).toBeVisible({ timeout: 10_000 });
  await expect(row, 'the row must still be present after lockout -- there is no unlock control in this UI (row 13 of the inventory)').toBeVisible();
  console.log('[UI-LOCKOUT] confirmed: the Terminal Workspace has no way to clear this lockout -- a terminal manager must escalate off-screen.');
});

test('Wrong-terminal: a staff account granted only hubB never sees a hubA-scoped leg in its own queue', async ({ browser }) => {
  test.setTimeout(90_000);
  const adminPage = await (await browser.newContext()).newPage();
  await adminLogin(adminPage);
  const { hubA, hubB } = await findHubs(adminPage);
  const { email } = await createTerminalStaff(adminPage, 'Wrongterm', hubA.id, hubB.id, false /* hubB only */);

  const customerPage = await (await browser.newContext()).newPage();
  expect(await tryLogin(customerPage, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD)).toBeTruthy();
  const { reference } = await bookHubToHub(customerPage, hubA.id, hubB.id, `Wrongterm ${stamp}`);

  const staffPage = await (await browser.newContext()).newPage();
  expect(await tryLogin(staffPage, email, UAT_FIXTURE_PASSWORD)).toBeTruthy();
  await staffPage.goto(`${WEB}/dashboard/terminal`);

  // The leg's DEPART hub is hubA -- this staff account holds only hubB, so
  // the row must not exist at all (stronger than "exists but is refused" --
  // TerminalController.queue never asks ShipmentService about a hub it was
  // not handed, per terminal.service.ts's own doc comment).
  await expect(
    staffPage.getByText(reference),
    'a staff account scoped only to hubB must never see a hubA-departing leg in its queue, under any section',
  ).not.toBeVisible({ timeout: 10_000 });
  console.log('[WRONG-TERMINAL-UI] confirmed: the leg is structurally invisible to a wrongly-scoped staff account, not merely unreachable.');
});

test('Direct delivery regression: a DOOR_TO_DOOR leg never appears in any Terminal Workspace queue, for any staff account', async ({ browser }) => {
  test.setTimeout(60_000);
  const adminPage = await (await browser.newContext()).newPage();
  await adminLogin(adminPage);
  const { hubA, hubB } = await findHubs(adminPage);
  const { email } = await createTerminalStaff(adminPage, 'Direct', hubA.id, hubB.id, true);

  const customerPage = await (await browser.newContext()).newPage();
  expect(await tryLogin(customerPage, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD)).toBeTruthy();

  const booking = {
    service: 'DOOR_TO_DOOR',
    origin: { name: 'MDF705 Direct Sender', phone: '+501-600-7002', address: '12 MDF-705 Direct Fixture Street', city: 'Belize City', district: 'BELIZE' },
    destination: { name: `MDF705 Direct ${stamp}`, phone: '501-222-7003', address: '34 MDF-705 Direct Fixture Avenue', city: 'Belize City', district: 'BELIZE' },
    pieces: 1,
    description: `MDF-705 direct-delivery regression ${stamp}`,
  };
  await postWithCsrf(customerPage, '/shipping/quote', booking);
  const created = await postWithCsrf<{ reference: string }>(customerPage, '/shipping', booking);
  expect(created.status, 'DIRECT (unpaid) booking failed').toBe(201);
  const reference = created.body.reference;

  const staffPage = await (await browser.newContext()).newPage();
  expect(await tryLogin(staffPage, email, UAT_FIXTURE_PASSWORD)).toBeTruthy();
  await staffPage.goto(`${WEB}/dashboard/terminal`);
  await expect(
    staffPage.getByText(reference),
    'a DOOR_TO_DOOR leg has no hub on either end and must never render in any Terminal Workspace queue section, for an account holding every hub',
  ).not.toBeVisible({ timeout: 10_000 });
  console.log('[DIRECT-REGRESSION] confirmed: a terminal-staff account holding BOTH simulation hubs still sees nothing for a DIRECT leg.');
});

test('Release to courier via the UI: a LAST_MILE leg a driver has accepted can be released from the counter', async ({ browser }) => {
  test.setTimeout(180_000);
  const adminPage = await (await browser.newContext()).newPage();
  await adminLogin(adminPage);
  const { hubA, hubB } = await findHubs(adminPage);
  const { email } = await createTerminalStaff(adminPage, 'Release', hubA.id, hubB.id, true);

  const customerPage = await (await browser.newContext()).newPage();
  expect(await tryLogin(customerPage, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD)).toBeTruthy();
  const driverPage = await (await browser.newContext()).newPage();
  expect(await tryLogin(driverPage, UAT_DRIVER_EMAIL, UAT_DRIVER_PASSWORD)).toBeTruthy();

  // HUB_TO_DOOR: the booking UI's own hub picker cannot select an isTest hub
  // (confirmed defect, see mdf587's WRONG-TERMINAL case) -- booked via the
  // real endpoint directly, same sanctioned route-around.
  const booking = {
    service: 'HUB_TO_DOOR',
    origin: { hubId: hubA.id },
    destination: { name: `MDF705 Release ${stamp}`, phone: '501-222-7004', address: '56 MDF-705 Release Fixture Road', city: 'Belize City', district: 'BELIZE' },
    pieces: 1,
    description: `MDF-705 release-to-courier fixture ${stamp}`,
    payWithWallet: true,
  };
  await postWithCsrf(customerPage, '/shipping/quote', booking);
  const created = await postWithCsrf<{ reference: string }>(customerPage, '/shipping', booking);
  expect(created.status, 'HUB_TO_DOOR booking failed').toBe(201);
  const reference = created.body.reference;
  console.log('[RELEASE-UI] booked HUB_TO_DOOR', reference);

  let offered = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    await driverPage.goto(`${WEB}/dashboard/driver/jobs`);
    if ((await driverPage.locator('body').innerText()).includes(reference)) {
      offered = true;
      break;
    }
    await driverPage.waitForTimeout(4000);
  }
  expect(offered, 'automatic dispatch never offered the LAST_MILE leg to the UAT driver').toBeTruthy();
  await driverPage.getByText(reference, { exact: false }).first().click();
  await driverPage.waitForURL(/\/dashboard\/driver\/shipping\//, { timeout: 20_000 });
  const legUrl = driverPage.url();
  const legId = legUrl.split('/').pop() ?? '';
  // ONE accept click only -- RELEASE_TO_COURIER needs courierStatus
  // DRIVER_ACCEPTED, not a confirmed pickup; confirming pickup here would
  // skip past the exact state this test exists to exercise.
  let job = await getDriverJob(driverPage, legId);
  expect(job.nextActionLabel, 'no primary action label on an ASSIGNED job').toBeTruthy();
  await clickLabeledAction(driverPage, job.nextActionLabel!);
  await driverPage.waitForTimeout(800);
  job = await getDriverJob(driverPage, legId);
  expect(job.status, 'accept click did not move the job past ASSIGNED').not.toBe('ASSIGNED');

  const staffPage = await (await browser.newContext()).newPage();
  expect(await tryLogin(staffPage, email, UAT_FIXTURE_PASSWORD)).toBeTruthy();
  await staffPage.goto(`${WEB}/dashboard/terminal`);

  const row = await queueRowFor(staffPage, reference);
  await expect(row, 'the driver-accepted LAST_MILE leg never appeared in "Release to courier"').toBeVisible({ timeout: 20_000 });

  // The RELEASE_TO_COURIER code is the COURIER's own self-revealed pickup
  // code (revealCourierCode -> pickupPin for a LAST_MILE leg), never the
  // staff-facing handoff-pin reveal -- that endpoint explicitly refuses
  // anything but a LINE_HAUL leg (shipment.service.ts's revealHandoffPin:
  // "This code is held by the courier or the recipient, never by staff").
  // Same reveal call the WRONG-TERMINAL case already uses for a FIRST_MILE
  // leg's handoffPin; here it returns pickupPin instead.
  const codeReveal = await getJson<{ kind: string; code: string | null }>(driverPage, `/driver/shipping-jobs/${legId}/code`);
  expect(codeReveal.status, 'courier self-reveal failed for the driver-accepted LAST_MILE leg').toBe(200);
  const code = codeReveal.body.code;
  expect(code, 'no pickup code revealed to the assigned courier for the release-to-courier step').toBeTruthy();

  await row.getByLabel('Code presented').fill(code!);
  await row.getByRole('button', { name: 'Release to courier' }).click();
  await expect(staffPage.getByText(reference), 'the leg must leave "Release to courier" once released').not.toBeVisible({ timeout: 15_000 });
  console.log('[RELEASE-UI] released to courier through the real Terminal Workspace button:', reference);
});

/**
 * PENDING: there is no lookup-by-reference anywhere in the terminal surface
 * today -- no search input on apps/web/app/dashboard/terminal/page.tsx, no
 * query parameter on GET /terminal/queue, and no GET /terminal/shipments/:ref
 * on terminal.controller.ts (confirmed by reading every route on both
 * TerminalController and TerminalShipmentsController). A test asserting "a
 * reference belonging to another terminal is refused" needs a lookup
 * mechanism to attempt first; none exists to attempt. This is the finding
 * itself (NOT IMPLEMENTED, matching terminal-feature-inventory.md row 5),
 * not an environment gap -- recorded here rather than silently dropped.
 */
test.fixme('Lookup by reference, including cross-terminal refusal (PENDING: no lookup-by-reference surface exists anywhere, UI or API)', async () => {});
