import { test, expect, type Page } from '@playwright/test';
import {
  tryLogin,
  UAT_CUSTOMER_EMAIL,
  UAT_FIXTURE_PASSWORD,
  UAT_DRIVER_EMAIL,
  UAT_DRIVER_PASSWORD,
} from './support/auth';

/**
 * [LOCAL ONLY, MDF-587 follow-up] The owner's §7 names five handoff
 * rejections that must hold -- an INVALID code, a WRONG-TERMINAL attempt, an
 * UNAUTHORIZED courier, an UNASSIGNED courier, and a DUPLICATE handoff -- plus
 * "direct deliveries must be preserved." Nothing on this floor asserted any
 * of them before this file. Extends the merged
 * mdf587-shipping-journey.local-only.spec.ts harness (same fixtures, same
 * helpers, same no-DB-shortcut discipline) rather than rebuilding it.
 *
 * Every negative probe is a REAL HTTP call against the REAL running API,
 * through either a real driver/admin/terminal-staff session's own cookies
 * (`page.evaluate(fetch(...))`, same pattern the merged spec's step-14 used)
 * or the real booking UI. No application code is touched to make a case
 * pass -- a case that does not enforce as described is reported as a finding,
 * not patched.
 *
 * Reuses UAT_CUSTOMER_EMAIL / UAT_DRIVER_EMAIL (DOOR_TO_DOOR legs) and the
 * existing UATBC/UATBP simulation hubs + courier lane (packages/database/
 * prisma/seed-uat-logistics.ts) for the one case that needs a hub-bearing leg
 * (WRONG-TERMINAL, DOOR_TO_HUB). The WRONG-TERMINAL case also needs a genuine
 * terminal-company staff account scoped to the WRONG hub -- there is no
 * existing seeded fixture for that (terminal companies are business
 * configuration, not seed data, per root CLAUDE.md §5), so this creates one
 * through the real admin console API + the real public accept-invite flow,
 * exactly the sanctioned path an operator would use -- no DB shortcut.
 */
const WEB = process.env.BASE_URL ?? 'http://localhost:3177';
const API = process.env.API_BASE_URL ?? 'http://localhost:4010';

const ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@bzemarketplace.com';
const ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD;

const stamp = Date.now();

test.describe.configure({ mode: 'serial' });

/* ------------------------------------------------------------- helpers ---
 * Duplicated from mdf587-shipping-journey.local-only.spec.ts on purpose --
 * this is a sibling spec, not a shared module, so each file stays runnable
 * and readable on its own. */

async function readCodeBlock(page: Page, label: string): Promise<string | null> {
  const block = page.getByText(label, { exact: true }).locator('..');
  const text = await block.innerText().catch(() => '');
  const m = text.match(/\b\d{4}\b/);
  return m?.[0] ?? null;
}

type DriverJob = {
  id: string;
  status: string;
  nextActionLabel: string | null;
  requiresPickupPin?: boolean;
};

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

/** Reads the double-submit CSRF cookie and posts with it echoed as a header --
 * every mutating fetch against an authenticated route needs this (apps/web's
 * own lib/api.ts csrfToken() helper does it for every real app request; a
 * raw fetch from a test does not get it for free). Terminal invite-accept is
 * `@Public()` and does NOT need this (see CsrfGuard: isPublic routes are
 * exempt entirely) -- only call this for an authenticated mutation. */
async function postWithCsrf<T>(
  page: Page,
  path: string,
  body: unknown,
  method: 'POST' | 'PATCH' = 'POST',
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; body: T }> {
  return page.evaluate(
    async ({ path, body, method, extraHeaders }) => {
      let csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1];
      if (!csrfToken) {
        await fetch('/api/auth/csrf', { credentials: 'include', cache: 'no-store' }).catch(() => {});
        csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1];
      }
      csrfToken = csrfToken ? decodeURIComponent(csrfToken) : undefined;
      const res = await fetch(`/api${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}), ...extraHeaders },
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
    { path, body, method, extraHeaders },
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

/** Books a DOOR_TO_DOOR shipment through the real UI, exactly as the merged
 * journey spec does -- same saved address, same debounce waits. */
async function bookDoorToDoor(page: Page, recipientLabel: string, destinationPhone: string): Promise<string> {
  await page.goto(`${WEB}/dashboard/shipments/new`);
  await page.waitForTimeout(1500);

  const collectGroup = page.getByRole('group', { name: 'Collect from' });
  await collectGroup.getByLabel('How would you like to give us the address?').selectOption('SAVED');
  await page.waitForTimeout(500);
  await collectGroup.getByLabel('Saved address', { exact: true }).selectOption({ index: 1 });

  const deliverGroup = page.getByRole('group', { name: 'Deliver to' });
  await deliverGroup.getByLabel('Full name').fill(recipientLabel);
  await deliverGroup.getByLabel('Phone').fill(destinationPhone);
  await deliverGroup.getByLabel('Street').fill('77 Freetown Road');
  await deliverGroup.getByLabel('City, town or village').fill('Belize City');
  await deliverGroup.getByLabel('District or island').selectOption('BELIZE');
  await page.waitForTimeout(1200);

  const bookButton = page.getByRole('button', { name: /pay.*book shipment|book shipment/i }).first();
  await expect(bookButton, 'book button never became enabled').toBeEnabled({ timeout: 10_000 });
  await bookButton.click();
  await page.waitForURL((u) => u.pathname.startsWith('/dashboard/shipments/') && u.pathname !== '/dashboard/shipments/new', {
    timeout: 15_000,
  });
  const reference = decodeURIComponent(page.url().split('/').pop() ?? '');
  expect(reference, 'no shipment reference in the post-booking URL').toBeTruthy();
  return reference;
}

/** Polls the UAT driver's job list until the given reference is offered,
 * then opens it and returns its legId/legUrl. Same ~90-100s window the
 * merged journey spec observed empirically for the sweeper's first offer. */
async function waitForDispatchOffer(driverPage: Page, reference: string): Promise<{ legId: string; legUrl: string }> {
  let offered = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    await driverPage.goto(`${WEB}/dashboard/driver/jobs`);
    const bodyText = await driverPage.locator('body').innerText();
    if (bodyText.includes(reference)) {
      offered = true;
      break;
    }
    await driverPage.waitForTimeout(4000);
  }
  expect(offered, `automatic dispatch never offered ${reference} to the UAT driver`).toBeTruthy();
  await driverPage.getByText(reference, { exact: false }).first().click();
  await driverPage.waitForURL(/\/dashboard\/driver\/shipping\//, { timeout: 20_000 });
  const legUrl = driverPage.url();
  const legId = legUrl.split('/').pop() ?? '';
  return { legId, legUrl };
}

/** Drives a leg (any kind -- FIRST_MILE/LAST_MILE/DIRECT share one state
 * machine) from ASSIGNED through to ARRIVING via the real driver UI, exactly
 * the merged journey spec's own click sequence. Stops short of the handoff
 * itself -- callers do that differently depending on which negative case
 * they are proving. */
async function driveToArriving(driverPage: Page, customerPage: Page, reference: string, legId: string, legUrl: string): Promise<void> {
  let job = await getDriverJob(driverPage, legId);
  expect(job.nextActionLabel, 'no primary action label on an ASSIGNED job').toBeTruthy();
  await clickLabeledAction(driverPage, job.nextActionLabel!);
  await driverPage.waitForTimeout(800);
  job = await getDriverJob(driverPage, legId);
  expect(job.status, 'accept click did not move the job past ASSIGNED').not.toBe('ASSIGNED');

  const requiresPickupPin = !!job.requiresPickupPin;
  if (requiresPickupPin) {
    await customerPage.goto(`${WEB}/dashboard/shipments/${encodeURIComponent(reference)}`);
    const pickupCode = await readCodeBlock(customerPage, 'Your pickup code');
    expect(pickupCode, 'leg requires a pickup code but the customer page showed none').toBeTruthy();
    await driverPage.goto(legUrl);
    await driverPage.locator('#code').fill(pickupCode!);
  } else {
    await driverPage.goto(legUrl);
  }
  job = await getDriverJob(driverPage, legId);
  await clickLabeledAction(driverPage, job.nextActionLabel!);
  await driverPage.waitForTimeout(800);
  job = await getDriverJob(driverPage, legId);
  expect(job.status, 'pickup click did not advance the job').not.toBe('DRIVER_ACCEPTED');

  await driverPage.goto(legUrl);
  job = await getDriverJob(driverPage, legId);
  await clickLabeledAction(driverPage, job.nextActionLabel!);
  await driverPage.waitForTimeout(800);
  job = await getDriverJob(driverPage, legId);
  expect(job.status, 'in-transit click did not advance the job').toBe('IN_TRANSIT');

  await driverPage.goto(legUrl);
  job = await getDriverJob(driverPage, legId);
  await clickLabeledAction(driverPage, job.nextActionLabel!);
  await driverPage.waitForTimeout(800);
  job = await getDriverJob(driverPage, legId);
  expect(job.status, 'arriving click did not advance the job').toBe('ARRIVING');
}

async function adminLogin(page: Page): Promise<void> {
  expect(ADMIN_PASSWORD, 'SEED_SUPER_ADMIN_PASSWORD not set in this environment -- hard stop, not a skip').toBeTruthy();
  const loggedIn = await tryLogin(page, ADMIN_EMAIL, ADMIN_PASSWORD!);
  expect(loggedIn, 'admin login failed -- hard stop, not a skip').toBeTruthy();
}

async function findUserIdByEmail(adminPage: Page, email: string): Promise<string> {
  const { status, body } = await getJson<{ items: Array<{ id: string; email: string }> }>(
    adminPage,
    `/admin/users?query=${encodeURIComponent(email)}`,
  );
  expect(status, `GET /admin/users for ${email} -> ${status}`).toBe(200);
  const id = body.items.find((u) => u.email === email)?.id;
  expect(id, `could not find ${email} via /admin/users`).toBeTruthy();
  return id!;
}

async function custodyChainOf(adminPage: Page, reference: string): Promise<unknown[]> {
  const { status, body } = await getJson<{ custody?: unknown[] }>(
    adminPage,
    `/admin/logistics/shipments/${encodeURIComponent(reference)}`,
  ).catch(() => ({ status: 0, body: {} as { custody?: unknown[] } }));
  if (status !== 200) return [];
  return body.custody ?? [];
}

/* ================================================================= TESTS */

test('negative case: INVALID handoff code is refused and leaves custody unchanged', async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await (await browser.newContext()).newPage();
  const driverPage = await (await browser.newContext()).newPage();

  expect(await tryLogin(page, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD)).toBeTruthy();
  expect(await tryLogin(driverPage, UAT_DRIVER_EMAIL, UAT_DRIVER_PASSWORD)).toBeTruthy();

  const reference = await bookDoorToDoor(page, `Mdf587 Invalid ${stamp}`, '501-222-5556');
  console.log('[INVALID] booked', reference);
  const { legId, legUrl } = await waitForDispatchOffer(driverPage, reference);
  await driveToArriving(driverPage, page, reference, legId, legUrl);

  await page.goto(`${WEB}/dashboard/shipments/${encodeURIComponent(reference)}`);
  const realCode = await readCodeBlock(page, 'Your delivery code');
  expect(realCode, 'no delivery code shown on the customer page at ARRIVING').toBeTruthy();
  const wrongCode = realCode === '0000' ? '0001' : '0000';

  const before = await getDriverJob(driverPage, legId);
  const probe = await postWithCsrf<{ message?: string }>(driverPage, `/driver/shipping-jobs/${legId}/handoff`, {
    pin: wrongCode,
    receivedByName: 'Invalid Code Probe',
  });
  console.log('[INVALID] wrong-code probe ->', probe.status, JSON.stringify(probe.body));
  expect(probe.status, 'a wrong handoff code must be refused, not accepted').toBe(400);
  expect(probe.body.message, 'wrong-code message shape changed').toMatch(/not right/i);

  const after = await getDriverJob(driverPage, legId);
  expect(after.status, 'leg status must not change on a rejected code').toBe(before.status);
  console.log('[INVALID] leg status unchanged after rejection:', before.status, '->', after.status);

  // Clean completion with the REAL code, proving the bad attempt only cost a
  // counted try and did not corrupt anything else.
  await driverPage.goto(legUrl);
  await driverPage.locator('#code').fill(realCode!);
  await driverPage.locator('#who').fill(`Mdf587 Invalid ${stamp}`);
  const job = await getDriverJob(driverPage, legId);
  await clickLabeledAction(driverPage, job.nextActionLabel!);
  await driverPage.waitForTimeout(1200);
  console.log('[INVALID] completed normally after the rejected attempt -- OK');
});

test('negative case: DUPLICATE handoff is refused once the leg is already delivered', async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await (await browser.newContext()).newPage();
  const driverPage = await (await browser.newContext()).newPage();

  expect(await tryLogin(page, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD)).toBeTruthy();
  expect(await tryLogin(driverPage, UAT_DRIVER_EMAIL, UAT_DRIVER_PASSWORD)).toBeTruthy();

  const reference = await bookDoorToDoor(page, `Mdf587 Dup ${stamp}`, '501-222-5557');
  console.log('[DUPLICATE] booked', reference);
  const { legId, legUrl } = await waitForDispatchOffer(driverPage, reference);
  await driveToArriving(driverPage, page, reference, legId, legUrl);

  await page.goto(`${WEB}/dashboard/shipments/${encodeURIComponent(reference)}`);
  const realCode = await readCodeBlock(page, 'Your delivery code');
  expect(realCode).toBeTruthy();

  const first = await postWithCsrf<{ message?: string }>(driverPage, `/driver/shipping-jobs/${legId}/handoff`, {
    pin: realCode,
    receivedByName: 'Duplicate Probe First',
  });
  console.log('[DUPLICATE] first (real) handoff ->', first.status);
  expect(first.status, 'the real handoff must succeed').toBe(201);

  const adminPage = await (await browser.newContext()).newPage();
  await adminLogin(adminPage);
  const chainAfterFirst = await custodyChainOf(adminPage, reference);
  console.log('[DUPLICATE] custody entries after first handoff:', chainAfterFirst.length);

  const second = await postWithCsrf<{ message?: string }>(driverPage, `/driver/shipping-jobs/${legId}/handoff`, {
    pin: realCode,
    receivedByName: 'Duplicate Probe Second',
  });
  console.log('[DUPLICATE] second (repeat) handoff ->', second.status, JSON.stringify(second.body));
  expect(second.status, 'a second handoff on an already-delivered leg must be refused').toBe(400);

  const chainAfterSecond = await custodyChainOf(adminPage, reference);
  console.log('[DUPLICATE] custody entries after repeat attempt:', chainAfterSecond.length);
  expect(chainAfterSecond.length, 'the repeat attempt must not append a second custody entry').toBe(chainAfterFirst.length);
});

test('negative case: UNASSIGNED courier -- staff cannot present a code before any driver is assigned', async ({ browser }) => {
  test.setTimeout(60_000);
  const page = await (await browser.newContext()).newPage();
  expect(await tryLogin(page, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD)).toBeTruthy();

  const adminPage = await (await browser.newContext()).newPage();
  await adminLogin(adminPage);

  // FINDING, discovered live: booking through the UI/API with payWithWallet
  // offers the first leg to a driver SYNCHRONOUSLY, inside the same request
  // (shipment.service.ts's own comment: "rather than waiting up to twenty
  // seconds for the sweeper -- the customer has just pressed Book"). A first
  // attempt at this case assumed a race against the ~20s sweeper tick and
  // lost it almost every time (the leg was already ASSIGNED by the time the
  // probe fired). The only DETERMINISTIC way to get a genuinely unassigned
  // leg is the same one seed-uat-logistics.ts uses for its own permanent
  // /track fixture: book UNPAID (payWithWallet omitted) -- "neither this
  // call nor the sweeper can turn one into a driver's job" per
  // ShipmentService.create's own comment. Real API call, same endpoint the
  // booking UI itself posts to, no DB shortcut -- just the sanctioned unpaid
  // path instead of racing a synchronous side effect.
  await postWithCsrf(adminPage, '/admin/ops/settings', { localCourierFeeTestMinor: 111 }, 'PATCH');
  const booking = {
    service: 'DOOR_TO_DOOR',
    origin: {
      name: 'Mdf587 Unassigned Sender',
      phone: '+501-600-5001',
      address: '12 MDF-587 Unassigned Fixture Street',
      city: 'Belize City',
      district: 'BELIZE',
    },
    destination: {
      name: `Mdf587 Unassigned ${stamp}`,
      phone: '501-222-5558',
      address: '34 MDF-587 Unassigned Fixture Avenue',
      city: 'Belize City',
      district: 'BELIZE',
    },
    pieces: 1,
    description: `MDF-587 unassigned-courier fixture ${stamp}`,
  };
  await postWithCsrf(page, '/shipping/quote', booking);
  const created = await postWithCsrf<{ reference: string; legs: Array<{ id: string }> }>(page, '/shipping', booking);
  expect(created.status, 'unpaid DOOR_TO_DOOR booking failed').toBe(201);
  const reference = created.body.reference;
  const legId = created.body.legs[0]?.id;
  console.log('[UNASSIGNED] booked UNPAID', reference, 'legId', legId);
  expect(legId, 'no legId in the unpaid booking response').toBeTruthy();

  // Booking itself already writes one custody row (SENDER holds it from the
  // moment it's booked) -- the bar here is "unchanged by the probe", not
  // "zero".
  const chainBefore = await custodyChainOf(adminPage, reference);

  const probe = await postWithCsrf<{ message?: string }>(adminPage, `/admin/logistics/legs/${legId}/handoff`, {
    pin: '0000',
    receivedByName: 'Unassigned Probe',
    presentedByAssignedCourier: true,
  });
  console.log('[UNASSIGNED] staff handoff with no assigned courier ->', probe.status, JSON.stringify(probe.body));
  expect(probe.status, 'staff presenting a code on an unassigned leg must be refused').toBe(400);
  expect(probe.body.message, 'unassigned-courier message shape changed').toMatch(/no courier is assigned/i);

  const chainAfter = await custodyChainOf(adminPage, reference);
  expect(chainAfter.length, 'an unassigned-courier probe must leave custody unchanged').toBe(chainBefore.length);
});

test('negative case: UNAUTHORIZED courier -- staff presenting the right code under the wrong identity is refused the same as a wrong code', async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await (await browser.newContext()).newPage();
  const driverPage = await (await browser.newContext()).newPage();

  expect(await tryLogin(page, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD)).toBeTruthy();
  expect(await tryLogin(driverPage, UAT_DRIVER_EMAIL, UAT_DRIVER_PASSWORD)).toBeTruthy();

  const reference = await bookDoorToDoor(page, `Mdf587 Unauthorized ${stamp}`, '501-222-5559');
  console.log('[UNAUTHORIZED] booked', reference);
  const { legId, legUrl } = await waitForDispatchOffer(driverPage, reference);
  await driveToArriving(driverPage, page, reference, legId, legUrl);

  await page.goto(`${WEB}/dashboard/shipments/${encodeURIComponent(reference)}`);
  const realCode = await readCodeBlock(page, 'Your delivery code');
  expect(realCode).toBeTruthy();

  const adminPage = await (await browser.newContext()).newPage();
  await adminLogin(adminPage);
  const customerUserId = await findUserIdByEmail(adminPage, UAT_CUSTOMER_EMAIL);

  const chainBefore = await custodyChainOf(adminPage, reference);

  const probe = await postWithCsrf<{ message?: string }>(adminPage, `/admin/logistics/legs/${legId}/handoff`, {
    pin: realCode,
    receivedByName: 'Unauthorized Probe',
    presentedCourierUserId: customerUserId,
  });
  console.log('[UNAUTHORIZED] CORRECT code, WRONG presented identity ->', probe.status, JSON.stringify(probe.body));
  expect(probe.status, 'the right code under the wrong identity must still be refused').toBe(400);
  console.log(
    '[UNAUTHORIZED] FINDING: message is "' +
      probe.body.message +
      '" -- deliberately identical in shape to a plain wrong-code rejection (shipment.service.ts verifyLegPinOrThrow\'s own comment: wrong-courier and wrong-code are folded into ONE failure path on purpose, so the two are indistinguishable from the outside).',
  );

  const chainAfter = await custodyChainOf(adminPage, reference);
  expect(chainAfter.length, 'an unauthorized-identity probe must leave custody unchanged').toBe(chainBefore.length);

  // Clean completion via the real driver, proving the probe did not corrupt
  // the leg -- it only spent one of the five shared attempts.
  await driverPage.goto(legUrl);
  await driverPage.locator('#code').fill(realCode!);
  await driverPage.locator('#who').fill(`Mdf587 Unauthorized ${stamp}`);
  const job = await getDriverJob(driverPage, legId);
  await clickLabeledAction(driverPage, job.nextActionLabel!);
  await driverPage.waitForTimeout(1200);
  console.log('[UNAUTHORIZED] completed normally by the real assigned driver after the probe -- OK');
});

test('negative case: WRONG-TERMINAL -- terminal staff scoped to a different hub cannot hand off this leg, and a DIRECT leg has no terminal to mis-scope at all', async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await (await browser.newContext()).newPage();
  const driverPage = await (await browser.newContext()).newPage();

  expect(await tryLogin(page, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD)).toBeTruthy();
  expect(await tryLogin(driverPage, UAT_DRIVER_EMAIL, UAT_DRIVER_PASSWORD)).toBeTruthy();

  const adminPage = await (await browser.newContext()).newPage();
  await adminLogin(adminPage);

  const { status: hubsStatus, body: hubs } = await getJson<Array<{ id: string; code: string }>>(
    adminPage,
    '/admin/logistics/hubs',
  );
  expect(hubsStatus).toBe(200);
  const hubA = hubs.find((h) => h.code === 'UATBC'); // Belize City UAT Depot -- origin hub, this leg's own handoff hub
  const hubB = hubs.find((h) => h.code === 'UATBP'); // Belmopan UAT Depot -- the WRONG hub for this leg
  expect(hubA, 'UATBC simulation hub not found -- expected from seed-uat-logistics.ts').toBeTruthy();
  expect(hubB, 'UATBP simulation hub not found -- expected from seed-uat-logistics.ts').toBeTruthy();

  // ---- book a DOOR_TO_HUB shipment: door (Belize City) -> UATBP terminal.
  // First-mile leg's own handoff hub is the ORIGIN depot (UATBC/hubA), per
  // ShipmentService.legHubFor: HANDOFF on a non-LAST_MILE leg uses
  // destinationHubId, and for a FIRST_MILE leg that destination IS the local
  // depot the parcel is handed INTO before the line-haul onward.
  //
  // FINDING, discovered live: the booking UI's own Terminal picker cannot be
  // driven for this case at all -- LogisticsNetworkService.publicHubs() (the
  // exact query GET /shipping/hubs runs, which feeds the customer booking
  // form's hub dropdown) hardcodes `where: { isActive: true, isTest: false }`.
  // It does not derive isTest from the caller the way every other
  // isTest-isolated query in this codebase does (root CLAUDE.md SS4/SS5: "the
  // two sides never mix" means a test caller sees the test side, not nothing)
  // -- it unconditionally excludes every isTest hub, for every caller. UATBC/
  // UATBP are isTest:true, so they can never appear in that dropdown, for any
  // account, in any environment: the `selectOption({value: hubB.id})` call
  // this test used originally retried for the full test timeout because the
  // option genuinely never exists in that <select>, not because of a timing
  // issue. Since production has zero real (isTest:false) hubs on purpose
  // (CLAUDE.md SS5), this also means DOOR_TO_HUB/HUB_TO_DOOR booking through
  // the customer UI is not exercisable by ANY account today -- worth Pam
  // confirming as a real gap, separate from the five SS7 cases this file
  // exists to prove. Routed around here the same sanctioned way the
  // UNASSIGNED case already does: the real POST /shipping endpoint directly,
  // same JSON shape seed-uat-logistics.ts's own permanent walkthrough fixture
  // uses for this exact hub pair, `payWithWallet: true` so the first leg
  // dispatches synchronously (same mechanism the UNASSIGNED case's finding
  // documents) instead of waiting on the sweeper.
  const booking = {
    service: 'DOOR_TO_HUB',
    origin: {
      name: 'Mdf587 Wrongterminal Sender',
      phone: '+501-600-5002',
      address: '12 MDF-587 Wrongterminal Fixture Street',
      city: 'Belize City',
      district: 'BELIZE',
    },
    destination: {
      hubId: hubB!.id,
      name: `Mdf587 Wrongterminal ${stamp}`,
      phone: '501-222-5559',
    },
    pieces: 1,
    description: `MDF-587 wrong-terminal fixture ${stamp}`,
    payWithWallet: true,
  };
  await postWithCsrf(page, '/shipping/quote', booking);
  const created = await postWithCsrf<{ reference: string }>(page, '/shipping', booking);
  expect(created.status, 'DOOR_TO_HUB booking failed -- is the UATBC<->UATBP lane still priced, and is the UAT customer wallet funded?').toBe(201);
  const reference = created.body.reference;
  console.log('[WRONG-TERMINAL] booked DOOR_TO_HUB', reference);

  const { legId, legUrl } = await waitForDispatchOffer(driverPage, reference);
  await driveToArriving(driverPage, page, reference, legId, legUrl);

  // A FIRST_MILE leg's code is the COURIER's own code to present at a hub
  // counter (TERM-5) -- never a customer-facing "Your delivery code" block,
  // which only ever exists for a DIRECT/LAST_MILE leg ending at a recipient's
  // door. Read it the same way the real driver UI does: GET .../code as the
  // assigned driver (shipment.service.ts revealCourierCode -- `leg.kind ===
  // 'FIRST_MILE'` returns the handoffPin under `code`).
  const codeReveal = await getJson<{ kind: string; code: string | null }>(driverPage, `/driver/shipping-jobs/${legId}/code`);
  expect(codeReveal.status, 'courier code reveal failed for the first-mile leg at ARRIVING').toBe(200);
  const realCode = codeReveal.body.code;
  expect(realCode, 'no handoff code revealed for the first-mile leg at ARRIVING').toBeTruthy();

  // ---- create a terminal company + two locations, invite a staff member
  // scoped to ONLY hubB (the wrong hub for this leg) -- the real admin
  // console API, the real public accept-invite flow, no DB write.
  const company = await postWithCsrf<{ id: string }>(adminPage, '/admin/terminal/companies', {
    businessName: `MDF587 Wrongterm Co ${stamp}`,
    contactEmail: `mdf587-wrongterm-co-${stamp}@example.bz`,
    isTest: true,
  });
  expect(company.status, 'terminal company creation failed').toBe(201);
  const companyId = company.body.id;

  const locA = await postWithCsrf<{ id: string }>(adminPage, `/admin/terminal/companies/${companyId}/locations`, { hubId: hubA!.id });
  const locB = await postWithCsrf<{ id: string }>(adminPage, `/admin/terminal/companies/${companyId}/locations`, { hubId: hubB!.id });
  expect(locA.status, 'adding hubA location failed').toBe(201);
  expect(locB.status, 'adding hubB location failed').toBe(201);

  const staffEmail = `mdf587-wrongterm-staff-${stamp}@example.bz`;
  const invite = await postWithCsrf<{ id: string }>(adminPage, `/admin/terminal/companies/${companyId}/invites`, {
    email: staffEmail,
    memberRole: 'OPERATOR',
    locationIds: [locB.body.id], // ONLY the wrong hub -- never hubA, the leg's real hub
  });
  expect(invite.status, 'inviting the terminal staff member failed').toBe(201);

  const mailbox = await getJson<{ body: string }>(adminPage, `/dev/emails/latest?email=${encodeURIComponent(staffEmail)}`);
  expect(mailbox.status, 'dev mailbox did not capture the invite email -- is NODE_ENV production?').toBe(200);
  const token = mailbox.body.body.match(/token=([^"&\s]+)/)?.[1];
  expect(token, 'could not find the invite token in the captured email body').toBeTruthy();

  const staffPage = await (await browser.newContext()).newPage();
  // postWithCsrf reads document.cookie -- a freshly-created page is still on
  // about:blank, where that throws a SecurityError rather than returning "".
  // Navigate to the real origin first, same as every other page in this file
  // already is by the time it is used (via tryLogin's own page.goto).
  await staffPage.goto(WEB);
  const accepted = await postWithCsrf<{ accepted: boolean }>(staffPage, '/terminal/invites/accept', {
    token,
    password: UAT_FIXTURE_PASSWORD,
    firstName: 'Wrongterm',
    lastName: 'Staff',
  });
  console.log('[WRONG-TERMINAL] accept-invite ->', accepted.status, JSON.stringify(accepted.body));
  expect(accepted.status, 'accept-invite failed').toBe(201);
  const staffLoggedIn = await tryLogin(staffPage, staffEmail, UAT_FIXTURE_PASSWORD);
  expect(staffLoggedIn, 'newly created terminal staff could not log in').toBeTruthy();

  // ---- THE ACTUAL CASE: this staff member holds hubB, not hubA. This leg's
  // handoff happens at hubA. Must be refused.
  const chainBeforeWrongTerminal = await custodyChainOf(adminPage, reference);
  const wrongTerminalProbe = await postWithCsrf<{ message?: string }>(staffPage, `/terminal/legs/${legId}/handoff`, {
    pin: realCode,
    receivedByName: 'Wrong Terminal Probe',
  });
  console.log('[WRONG-TERMINAL] staff scoped to UATBP attempting a UATBC-hub leg ->', wrongTerminalProbe.status, JSON.stringify(wrongTerminalProbe.body));
  expect(wrongTerminalProbe.status, 'a terminal staff member not holding this leg\'s hub must be refused').toBe(403);
  expect(wrongTerminalProbe.body.message, 'wrong-terminal message shape changed').toMatch(/do not hold this terminal location/i);

  const chainAfterWrongTerminal = await custodyChainOf(adminPage, reference);
  expect(chainAfterWrongTerminal.length, 'a wrong-terminal probe must leave custody unchanged').toBe(chainBeforeWrongTerminal.length);

  // ---- "direct deliveries must be preserved": a DIRECT (door-to-door) leg
  // has no hub at all, on EITHER end, by construction -- the SAME staff
  // account, which legitimately holds nothing on this leg either, must get
  // the STRUCTURAL "no terminal location" refusal, never a false allow and
  // never confused with the location-mismatch case above. Reuses the
  // DOOR_TO_DOOR leg this very staff account has no business near.
  const directReference = await bookDoorToDoor(page, `Mdf587 DirectCheck ${stamp}`, '501-222-5560');
  console.log('[WRONG-TERMINAL/direct-preserved] booked DOOR_TO_DOOR control', directReference);
  const { status: mineStatus, body: mine } = await getJson<Array<{ reference: string; legs: Array<{ id: string }> }>>(
    page,
    '/shipping',
  );
  expect(mineStatus).toBe(200);
  const directLegId = mine.find((s) => s.reference === directReference)?.legs[0]?.id;
  expect(directLegId, 'could not read the DIRECT control leg id').toBeTruthy();

  const directProbe = await postWithCsrf<{ message?: string }>(staffPage, `/terminal/legs/${directLegId}/handoff`, {
    pin: '0000',
    receivedByName: 'Direct Preservation Probe',
  });
  console.log('[WRONG-TERMINAL/direct-preserved] terminal staff attempting a DIRECT (no-hub) leg ->', directProbe.status, JSON.stringify(directProbe.body));
  expect(directProbe.status, 'a DIRECT leg has no hub -- the terminal gate must refuse structurally, not fall through').toBe(403);
  expect(directProbe.body.message, 'no-terminal-location message shape changed').toMatch(/no terminal location to authorize against/i);

  // ---- positive control: complete the first-mile leg via the UNRESTRICTED
  // admin/logistics.operate path (BML's own ops staff, by design not
  // location-scoped -- TerminalLegsController's own doc comment), proving
  // the journey itself still finishes once a path that CAN act here is used.
  //
  // `presentedByAssignedCourier: true` is required here, not optional: per
  // verifyLegPinOrThrow (shipment.service.ts), the identity check defaults to
  // `presentedCourierUserId ?? actor.userId` -- without either, an admin's
  // OWN userId is checked against the leg's assigned driver profile, which
  // can never match, so the call folds into the same wrong-courier/wrong-code
  // path the UNAUTHORIZED case exercises on purpose, even with the exactly
  // correct pin. This flag is the desk-clerk assertion "the courier standing
  // in front of me is the one assigned to this leg."
  const complete = await postWithCsrf<{ id: string }>(adminPage, `/admin/logistics/legs/${legId}/handoff`, {
    pin: realCode,
    receivedByName: 'Ops Staff (unrestricted)',
    presentedByAssignedCourier: true,
  });
  console.log('[WRONG-TERMINAL] real completion via admin/logistics.operate (unrestricted by location) ->', complete.status);
  expect(complete.status, 'the leg must still be completable by an unrestricted ops-staff account').toBe(201);
});

/* ======================================================================
 * TERM-12 ADDENDUM (god's 2026-11-10T03-07-55-276Z-c6003c dispatch): main
 * moved underneath this branch -- TERM-12 (03fe9201) added a
 * collection-code gate + lockout/unlock cycle at the terminal counter for
 * a HUB-ENDING shipment (AWAITING_COLLECTION), the other half of the §7
 * terminal-custody story this file already covers. Four cases on top of
 * the five above, same no-DB-shortcut discipline, same file (per god:
 * "two instruments for one story eventually disagree").
 *
 * Setup deliberately uses HUB_TO_HUB, not DOOR_TO_HUB -- HUB_TO_HUB needs
 * NEITHER a first-mile courier NOR a last-mile courier (packages/shared/
 * src/shipping.ts: needsFirstMile/needsLastMile both false), so reaching
 * AWAITING_COLLECTION here is pure admin/ops API calls on the one
 * LINE_HAUL leg -- no driver dispatch, no UAT-driver-fixture capacity
 * fight (see the WRONG-TERMINAL case above and its cleanup notes: a test
 * leg left at ARRIVING blocks the single UAT driver fixture from any new
 * offer until it is completed or declined). Collecting a shipment is
 * staff-at-a-counter work regardless of which service type got it there,
 * so HUB_TO_HUB proves the same collection-code gate DOOR_TO_HUB or
 * HUB_TO_DOOR would, without that risk.
 * ====================================================================== */

async function getHandoffPinReveal(adminPage: Page, legId: string): Promise<{ status: number; body: { handoffPin: string | null } }> {
  return getJson(adminPage, `/admin/logistics/legs/${legId}/handoff-pin`);
}

async function departLineHaul(adminPage: Page, legId: string): Promise<{ status: number; body: unknown }> {
  return postWithCsrf(adminPage, `/admin/logistics/legs/${legId}/depart`, {});
}

async function arriveLineHaul(adminPage: Page, legId: string): Promise<{ status: number; body: unknown }> {
  return postWithCsrf(adminPage, `/admin/logistics/legs/${legId}/arrive`, {});
}

/** Books HUB_TO_HUB (hubA -> hubB, paid) and drives its single LINE_HAUL leg
 * all the way to COMPLETED via real admin/ops API calls -- depart, arrive,
 * then the same handoff endpoint the five cases above already use, with the
 * STAFF-revealed code (LINE_HAUL has no courier, so TERM-5's courier-reveal
 * endpoint refuses it on purpose -- the staff-facing handoff-pin reveal is
 * the correct one here; see revealHandoffPin's own `kind !== 'LINE_HAUL'`
 * guard). Returns once the shipment has recomputed to AWAITING_COLLECTION. */
async function bookAndArriveAtCollection(
  customerPage: Page,
  adminPage: Page,
  hubAId: string,
  hubBId: string,
  label: string,
): Promise<{ reference: string; shipmentId: string }> {
  const booking = {
    service: 'HUB_TO_HUB',
    origin: { hubId: hubAId },
    destination: { hubId: hubBId, name: label, phone: '501-222-5561' },
    pieces: 1,
    description: `MDF-587/TERM-12 collection fixture ${label}`,
    payWithWallet: true,
  };
  await postWithCsrf(customerPage, '/shipping/quote', booking);
  const created = await postWithCsrf<{ reference: string; legs: Array<{ id: string }> }>(customerPage, '/shipping', booking);
  expect(created.status, 'HUB_TO_HUB booking failed -- is the UATBC<->UATBP lane still priced, and is the UAT customer wallet funded?').toBe(201);
  const reference = created.body.reference;
  const legId = created.body.legs[0]!.id;

  const depart = await departLineHaul(adminPage, legId);
  expect(depart.status, `depart failed: ${JSON.stringify(depart.body)}`).toBe(201);
  const arrive = await arriveLineHaul(adminPage, legId);
  expect(arrive.status, `arrive failed: ${JSON.stringify(arrive.body)}`).toBe(201);

  const reveal = await getHandoffPinReveal(adminPage, legId);
  expect(reveal.status, 'staff handoff-pin reveal failed for the line-haul leg').toBe(200);
  const handoffPin = reveal.body.handoffPin;
  expect(handoffPin, 'no handoff pin revealed for the line-haul leg').toBeTruthy();

  const handoff = await postWithCsrf<{ id: string }>(adminPage, `/admin/logistics/legs/${legId}/handoff`, {
    pin: handoffPin,
    receivedByName: `Ops Staff (${label} receiving hub)`,
  });
  expect(handoff.status, `line-haul handoff failed: ${JSON.stringify(handoff.body)}`).toBe(201);

  const { status, body } = await getJson<{ id: string; status: string }>(adminPage, `/admin/logistics/shipments/${encodeURIComponent(reference)}`);
  expect(status).toBe(200);
  expect(body.status, 'shipment did not reach AWAITING_COLLECTION after the line-haul leg completed').toBe('AWAITING_COLLECTION');
  return { reference, shipmentId: body.id };
}

/**
 * `xff` (optional): `/collect` carries `@StrictThrottle()` (10 req/60s per IP,
 * TERM-12 -- deliberate, same guard every guessable-code route carries).
 * Several of these negative cases deliberately burn through that budget on
 * purpose (proving lockout). Running several such tests back-to-back shares
 * one real per-IP budget and trips a LEGITIMATE 429 that has nothing to do
 * with collection-code logic. `trust proxy` is `1` in `main.ts`, so a single
 * `X-Forwarded-For` value from a direct connection (this harness, not a real
 * proxy chain) is trusted as `req.ip` outright (confirmed empirically against
 * express+trust-proxy directly). Giving each throttle-sensitive test its own
 * synthetic source IP isolates its budget deterministically -- no sleeping,
 * no ordering dependency between tests.
 */
async function collect(
  adminPage: Page,
  shipmentId: string,
  code: string | undefined,
  collectedByName = 'Collection Probe',
  xff?: string,
): Promise<{ status: number; body: { message?: string } }> {
  return postWithCsrf(
    adminPage,
    `/admin/logistics/shipments/${shipmentId}/collect`,
    { collectedByName, ...(code !== undefined ? { code } : {}) },
    'POST',
    xff ? { 'X-Forwarded-For': xff } : {},
  );
}

async function unlockCollection(adminPage: Page, shipmentId: string, note: string): Promise<{ status: number; body: { message?: string } }> {
  return postWithCsrf(adminPage, `/admin/logistics/shipments/${shipmentId}/unlock-collection`, { note });
}

test('negative case: WRONG collection code is refused and the attempt is counted', async ({ browser }) => {
  test.setTimeout(60_000);
  const customerPage = await (await browser.newContext()).newPage();
  expect(await tryLogin(customerPage, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD)).toBeTruthy();
  const adminPage = await (await browser.newContext()).newPage();
  await adminLogin(adminPage);

  const { status: hubsStatus, body: hubs } = await getJson<Array<{ id: string; code: string }>>(adminPage, '/admin/logistics/hubs');
  expect(hubsStatus).toBe(200);
  const hubA = hubs.find((h) => h.code === 'UATBC');
  const hubB = hubs.find((h) => h.code === 'UATBP');
  expect(hubA && hubB, 'UATBC/UATBP simulation hubs not found').toBeTruthy();

  const { reference, shipmentId } = await bookAndArriveAtCollection(customerPage, adminPage, hubA!.id, hubB!.id, `Wrongcode ${stamp}`);
  console.log('[COLLECTION-WRONG] at AWAITING_COLLECTION:', reference);

  const before = await custodyChainOf(adminPage, reference);
  const probe = await collect(adminPage, shipmentId, '0000', undefined, '10.99.6.1');
  console.log('[COLLECTION-WRONG] wrong-code probe ->', probe.status, JSON.stringify(probe.body));
  expect(probe.status, 'a wrong collection code must be refused, not accepted').toBe(400);
  expect(probe.body.message, 'wrong-code message shape changed').toMatch(/not right/i);
  const after = await custodyChainOf(adminPage, reference);
  expect(after.length, 'a wrong collection-code probe must leave custody unchanged').toBe(before.length);

  const staffView = await getJson<{ collectionCode: unknown; collectionVerificationStatus: string; collectionPinAttemptsRemaining: number }>(
    adminPage,
    `/admin/logistics/shipments/${encodeURIComponent(reference)}`,
  );
  expect(staffView.status).toBe(200);
  expect(staffView.body.collectionCode, 'STAFF audience must NEVER see collectionCode').toBeNull();
  console.log('[COLLECTION-WRONG] attempt counted, STAFF view after one wrong try:', JSON.stringify({
    collectionVerificationStatus: staffView.body.collectionVerificationStatus,
    collectionPinAttemptsRemaining: staffView.body.collectionPinAttemptsRemaining,
  }));
});

test('negative case: the fifth wrong collection code LOCKS the shipment, visible to STAFF only', async ({ browser }) => {
  test.setTimeout(60_000);
  const customerPage = await (await browser.newContext()).newPage();
  expect(await tryLogin(customerPage, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD)).toBeTruthy();
  const adminPage = await (await browser.newContext()).newPage();
  await adminLogin(adminPage);

  const { status: hubsStatus, body: hubs } = await getJson<Array<{ id: string; code: string }>>(adminPage, '/admin/logistics/hubs');
  expect(hubsStatus).toBe(200);
  const hubA = hubs.find((h) => h.code === 'UATBC');
  const hubB = hubs.find((h) => h.code === 'UATBP');

  const { reference, shipmentId } = await bookAndArriveAtCollection(customerPage, adminPage, hubA!.id, hubB!.id, `Lockout ${stamp}`);
  console.log('[COLLECTION-LOCKOUT] at AWAITING_COLLECTION:', reference);

  // DELIVERY_PIN_MAX_ATTEMPTS is 5 (root CLAUDE.md boundary: never touch
  // that constant or the grandfather column -- only probe against it).
  let last: { status: number; body: { message?: string } } | null = null;
  for (let i = 1; i <= 5; i++) {
    last = await collect(adminPage, shipmentId, '0000', undefined, '10.99.7.1');
    console.log(`[COLLECTION-LOCKOUT] wrong attempt ${i} ->`, last.status, JSON.stringify(last.body));
  }
  expect(last!.status, 'the fifth wrong attempt must still read as a code failure, not a lockout message').toBe(400);
  expect(last!.body.message, 'the fifth-failure message shape changed').toMatch(/last try/i);

  const staffView = await getJson<{ collectionCode: unknown; collectionVerificationStatus: string; collectionPinAttemptsRemaining: number }>(
    adminPage,
    `/admin/logistics/shipments/${encodeURIComponent(reference)}`,
  );
  expect(staffView.status).toBe(200);
  expect(staffView.body.collectionVerificationStatus, 'STAFF must see the lockout as FAILED').toBe('FAILED');
  expect(staffView.body.collectionPinAttemptsRemaining, 'STAFF must see zero attempts remaining once locked').toBe(0);
  expect(staffView.body.collectionCode, 'STAFF audience must NEVER see collectionCode, locked or not').toBeNull();

  const customerView = await getJson<{ collectionCode: unknown; collectionVerificationStatus: unknown; collectionPinAttemptsRemaining: unknown }>(
    customerPage,
    `/shipping/${encodeURIComponent(reference)}`,
  );
  expect(customerView.status).toBe(200);
  expect(customerView.body.collectionVerificationStatus, 'CUSTOMER audience must never see the lockout state').toBeNull();
  expect(customerView.body.collectionPinAttemptsRemaining, 'CUSTOMER audience must never see attempts-remaining').toBeNull();
  console.log('[COLLECTION-LOCKOUT] customer view collectionCode while locked:', JSON.stringify(customerView.body.collectionCode));

  // Locked out: even the CORRECT code is refused now, per
  // verifyCollectionPinOrThrow's own attempts>=MAX check running before the
  // code comparison -- this is the "an administrator has to confirm this
  // collection" dead end TERM-12 exists to fix.
  const correctAttempt = await collect(adminPage, shipmentId, '1234', undefined, '10.99.7.1');
  console.log('[COLLECTION-LOCKOUT] correct-looking code against a locked shipment ->', correctAttempt.status, JSON.stringify(correctAttempt.body));
  expect(correctAttempt.status, 'a locked shipment must refuse even a plausible code').toBe(403);
  expect(correctAttempt.body.message, 'lockout message shape changed').toMatch(/administrator has to confirm/i);
});

test('negative case: unlocking a collection lockout requires a real reason, and only clears the counter', async ({ browser }) => {
  test.setTimeout(60_000);
  const customerPage = await (await browser.newContext()).newPage();
  expect(await tryLogin(customerPage, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD)).toBeTruthy();
  const adminPage = await (await browser.newContext()).newPage();
  await adminLogin(adminPage);

  const { status: hubsStatus, body: hubs } = await getJson<Array<{ id: string; code: string }>>(adminPage, '/admin/logistics/hubs');
  expect(hubsStatus).toBe(200);
  const hubA = hubs.find((h) => h.code === 'UATBC');
  const hubB = hubs.find((h) => h.code === 'UATBP');

  const { reference, shipmentId } = await bookAndArriveAtCollection(customerPage, adminPage, hubA!.id, hubB!.id, `Unlock ${stamp}`);
  console.log('[COLLECTION-UNLOCK] at AWAITING_COLLECTION:', reference, shipmentId);
  for (let i = 1; i <= 5; i++) {
    const r = await collect(adminPage, shipmentId, '0000', undefined, '10.99.8.1');
    console.log(`[COLLECTION-UNLOCK] warmup wrong attempt ${i} ->`, r.status, JSON.stringify(r.body));
  }
  const locked = await getJson<{ collectionVerificationStatus: string }>(adminPage, `/admin/logistics/shipments/${encodeURIComponent(reference)}`);
  expect(locked.body.collectionVerificationStatus, 'setup: shipment should be locked before testing unlock').toBe('FAILED');

  const before = await custodyChainOf(adminPage, reference);
  const tooShort = await unlockCollection(adminPage, shipmentId, 'no');
  console.log('[COLLECTION-UNLOCK] note under 4 chars ->', tooShort.status, JSON.stringify(tooShort.body));
  expect(tooShort.status, 'a reason shorter than 4 characters must be refused').toBe(400);

  const stillLocked = await getJson<{ collectionVerificationStatus: string }>(adminPage, `/admin/logistics/shipments/${encodeURIComponent(reference)}`);
  expect(stillLocked.body.collectionVerificationStatus, 'a rejected unlock attempt must not change lockout state').toBe('FAILED');

  const unlocked = await unlockCollection(adminPage, shipmentId, 'Verified by phone with the sender, clearing to recollect.');
  console.log('[COLLECTION-UNLOCK] valid reason ->', unlocked.status, JSON.stringify(unlocked.body));
  expect(unlocked.status, 'a reason of at least 4 characters must unlock the shipment').toBe(201);

  const after = await custodyChainOf(adminPage, reference);
  expect(after.length, 'unlocking must not itself write a custody row -- it clears a counter, not a handoff').toBe(before.length);

  const staffView = await getJson<{ collectionVerificationStatus: string; collectionPinAttemptsRemaining: number }>(
    adminPage,
    `/admin/logistics/shipments/${encodeURIComponent(reference)}`,
  );
  expect(staffView.body.collectionVerificationStatus, 'unlock must clear FAILED back to PENDING').toBe('PENDING');
  expect(staffView.body.collectionPinAttemptsRemaining, 'unlock must reset the attempt counter to the full budget').toBe(5);

  const reunlock = await unlockCollection(adminPage, shipmentId, 'Second unlock attempt on an already-unlocked shipment.');
  console.log('[COLLECTION-UNLOCK] unlocking an already-unlocked shipment ->', reunlock.status, JSON.stringify(reunlock.body));
  expect(reunlock.status, 'unlocking a shipment that is not locked must be refused, not a silent no-op').toBe(400);
});

test('negative case: after unlock, the CORRECT collection code completes the collection', async ({ browser }) => {
  test.setTimeout(60_000);
  const customerPage = await (await browser.newContext()).newPage();
  expect(await tryLogin(customerPage, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD)).toBeTruthy();
  const adminPage = await (await browser.newContext()).newPage();
  await adminLogin(adminPage);

  const { status: hubsStatus, body: hubs } = await getJson<Array<{ id: string; code: string }>>(adminPage, '/admin/logistics/hubs');
  expect(hubsStatus).toBe(200);
  const hubA = hubs.find((h) => h.code === 'UATBC');
  const hubB = hubs.find((h) => h.code === 'UATBP');

  const { reference, shipmentId } = await bookAndArriveAtCollection(customerPage, adminPage, hubA!.id, hubB!.id, `Recover ${stamp}`);

  // CUSTOMER view before any lockout: the real code must be visible (it is
  // the customer's own code to relay to whoever picks the parcel up), and
  // the two STAFF-only fields must be null for them regardless of state.
  const customerBefore = await getJson<{ collectionCode: string | null; collectionVerificationStatus: unknown; collectionPinAttemptsRemaining: unknown }>(
    customerPage,
    `/shipping/${encodeURIComponent(reference)}`,
  );
  expect(customerBefore.status).toBe(200);
  expect(customerBefore.body.collectionCode, 'CUSTOMER must see their own real collection code while awaiting collection').toBeTruthy();
  expect(customerBefore.body.collectionVerificationStatus, 'CUSTOMER audience must never see verification status').toBeNull();
  expect(customerBefore.body.collectionPinAttemptsRemaining, 'CUSTOMER audience must never see attempts-remaining').toBeNull();
  const realCode = customerBefore.body.collectionCode!;

  for (let i = 1; i <= 5; i++) await collect(adminPage, shipmentId, '0000', undefined, '10.99.9.1');
  const unlocked = await unlockCollection(adminPage, shipmentId, 'Verified by phone with the sender, clearing to recollect.');
  expect(unlocked.status).toBe(201);

  const before = await custodyChainOf(adminPage, reference);
  const success = await collect(adminPage, shipmentId, realCode, 'Recovered Collection', '10.99.9.1');
  console.log('[COLLECTION-RECOVER] correct code after unlock ->', success.status, JSON.stringify(success.body));
  expect(success.status, 'the correct code must succeed once the lockout is cleared').toBe(201);
  const after = await custodyChainOf(adminPage, reference);
  expect(after.length, 'a successful collection must append exactly one custody row').toBe(before.length + 1);

  // STAFF response for the collect call itself is STAFF audience too --
  // collectionCode must stay null even in the success response, and the
  // shipment must now read DELIVERED, not AWAITING_COLLECTION.
  const staffAfter = await getJson<{ status: string; collectionCode: unknown; deliveredAt: string | null }>(
    adminPage,
    `/admin/logistics/shipments/${encodeURIComponent(reference)}`,
  );
  expect(staffAfter.body.status, 'a collected hub-ending shipment must read DELIVERED').toBe('DELIVERED');
  expect(staffAfter.body.collectionCode, 'STAFF audience must never see collectionCode, even after a successful collection').toBeNull();
  // `collectedAt` is never serialized to any audience -- `deliveredAt` is the
  // public proxy for it (recompute() sets both together once status flips to
  // DELIVERED; see shipment.service.ts's own recompute()).
  expect(staffAfter.body.deliveredAt, 'deliveredAt must be set once collected').toBeTruthy();

  const duplicate = await collect(adminPage, shipmentId, realCode, 'Duplicate Collection Probe');
  console.log('[COLLECTION-RECOVER] duplicate collect after success ->', duplicate.status, JSON.stringify(duplicate.body));
  expect(duplicate.status, 'collecting an already-collected shipment must be refused').toBe(400);
});
