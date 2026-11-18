import { test, expect, type Page } from '@playwright/test';
import { ADMIN_STATE_PATH, CUSTOMER_STATE_PATH } from './support/local-only-shared-auth';

/**
 * [LOCAL ONLY, MDF-705 follow-up] Written ahead of MDF-709 (API, Pam) /
 * MDF-710 (UI, Oscar) landing, per god's instruction to write specs for
 * in-flight cards so they land with the features. Both cards extend an
 * EXISTING, already-shipped pattern -- the driver handoff code's two-step
 * unlinked reveal (`shipping.controller.ts`'s `ShippingDeliveryCodeController`,
 * `UnlinkedDeliveryCode.tsx`/`RecipientDeliveryCode.tsx`) -- to the
 * TERMINAL COLLECTION code, which today has no surface anywhere a recipient
 * can read.
 *
 * Two different kinds of test in this file, labelled so neither is mistaken
 * for the other, and neither is counted as health by anyone tallying green:
 *  - ONE real test, against an EXISTING endpoint, proving today's actual
 *    gap. Its title starts `GAP-PROOF:` -- exclude it from any pass count
 *    by title/grep, same convention as this file's MDF-699 sibling. A test
 *    whose PASS means "the product is broken" must never read as health.
 *  - `test.fixme` stubs for every piece of desired POST-fix behaviour,
 *    including the one this file originally wrote with `test.fail()`.
 *    Stanley reviewed that technique (god's own request, after proposing it
 *    floor-wide) and found it unsound here: `test.fail()` accepts ANY
 *    failure, so a down environment, a broken login, or a failed booking
 *    step all read as the expected "pending" state too, and if MDF-709
 *    ships a HALF-right fix (e.g. a code that doesn't match the sender's,
 *    or one that stays visible after collection) the test keeps failing
 *    and keeps reading green forever -- the flip never comes and nobody
 *    learns the feature is partial. `test.fixme` has neither flaw: it is
 *    always shown as skipped, never counted as a pass, and the full target
 *    assertion is written out below ready to run the day someone removes
 *    `test.fixme` and confirms the real route/shape against Pam's PR --
 *    which is manual work on ship day, not a zero-edit flip. The
 *    `GAP-PROOF` test above also needs editing that same day, since its
 *    whole premise (no `collectionCode` key) becomes false once MDF-709
 *    item 1 ships.
 */
const WEB = process.env.BASE_URL ?? 'http://localhost:3177';
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

/**
 * TERM-STAFF-INFRA (god, 2026-11-18): admin/customer no longer log in fresh
 * here -- `local-only-global-setup.ts` builds one shared storageState per
 * role for the whole local-only run (see local-only-shared-auth.ts), so this
 * just loads the cached file. storageState restores cookies, not navigation
 * history, so the page still needs an explicit `goto` before its first
 * relative fetch -- same requirement `recipientPage` already documents
 * below.
 */
async function adminPageFromCache(browser: import('@playwright/test').Browser): Promise<Page> {
  const page = await (await browser.newContext({ storageState: ADMIN_STATE_PATH })).newPage();
  await page.goto(WEB);
  return page;
}

async function customerPageFromCache(browser: import('@playwright/test').Browser): Promise<Page> {
  const page = await (await browser.newContext({ storageState: CUSTOMER_STATE_PATH })).newPage();
  await page.goto(WEB);
  return page;
}

/**
 * Books HUB_TO_HUB (UATBC -> UATBP) and drives the one LINE_HAUL leg to
 * AWAITING_COLLECTION via the real admin API -- same sequence mdf587/mdf705
 * already use for this. Also CLAIMS the shipment as a second, newly
 * registered recipient account, through the real claim endpoint, so a
 * genuinely LINKED recipient exists to test against.
 *
 * god's finding (2026-11-18, via the claim's own 400 once the earlier
 * fetch-before-navigate bug stopped masking it): `ShipmentService.
 * claimAsRecipient` (`shipment.service.ts:1527-1534`) matches on the
 * caller's own email OR phone against `destinationEmail`/`destinationPhone`
 * -- this booking set only a destination `phone`, and the recipient account
 * registers with only an `email`, no phone, so NEITHER side of that OR ever
 * matched and the claim was rejected every time this ever ran. Needs the
 * recipient's own registered email on the booking's destination for the
 * match to have anything to succeed on.
 */
async function bookAndClaimToAwaitingCollection(
  customerPage: Page,
  adminPage: Page,
  recipientPage: Page,
  recipientEmail: string,
  label: string,
): Promise<{ reference: string; recipientToken: string }> {
  const { body: hubs } = await getJson<Array<{ id: string; code: string }>>(adminPage, '/admin/logistics/hubs');
  const hubA = hubs.find((h) => h.code === 'UATBC');
  const hubB = hubs.find((h) => h.code === 'UATBP');
  expect(hubA && hubB, 'UATBC/UATBP simulation hubs not found').toBeTruthy();

  const booking = {
    service: 'HUB_TO_HUB',
    origin: { hubId: hubA!.id },
    destination: { hubId: hubB!.id, name: label, phone: '501-222-7101', email: recipientEmail },
    pieces: 1,
    description: `MDF-709/710 fixture ${label}`,
    payWithWallet: true,
  };
  await postWithCsrf(customerPage, '/shipping/quote', booking);
  const created = await postWithCsrf<{ reference: string; legs: Array<{ id: string }>; recipientTrackingToken: string }>(
    customerPage,
    '/shipping',
    booking,
  );
  expect(created.status, `HUB_TO_HUB booking failed: ${JSON.stringify(created.body)}`).toBe(201);
  const { reference } = created.body;
  const legId = created.body.legs[0]!.id;
  const recipientToken = created.body.recipientTrackingToken;
  expect(recipientToken, 'no recipientTrackingToken on the booking response').toBeTruthy();

  expect((await postWithCsrf(adminPage, `/admin/logistics/legs/${legId}/depart`, {})).status).toBe(201);
  expect((await postWithCsrf(adminPage, `/admin/logistics/legs/${legId}/arrive`, {})).status).toBe(201);
  const pin = (await getJson<{ handoffPin: string | null }>(adminPage, `/admin/logistics/legs/${legId}/handoff-pin`)).body.handoffPin;
  expect((await postWithCsrf(adminPage, `/admin/logistics/legs/${legId}/handoff`, { pin, receivedByName: 'Setup' })).status).toBe(201);
  const awaiting = await getJson<{ status: string }>(adminPage, `/admin/logistics/shipments/${encodeURIComponent(reference)}`);
  expect(awaiting.body.status).toBe('AWAITING_COLLECTION');

  // Claim as recipient -- real endpoint (ShippingClaimController), real
  // session, not a DB write.
  const claim = await postWithCsrf<{ claimed: boolean }>(recipientPage, `/shipping/track/${recipientToken}/claim`, {});
  expect(claim.status, 'recipient claim failed').toBe(201);

  return { reference, recipientToken };
}

test('GAP-PROOF: a linked recipient\'s own incoming-shipment view carries no collection code at all (MDF-709 item 1\'s gap, proven live)', async ({ browser }) => {
  test.setTimeout(120_000);
  const adminPage = await adminPageFromCache(browser);
  const customerPage = await customerPageFromCache(browser);
  const recipientPage = await (await browser.newContext()).newPage();
  // god's finding (2026-11-18): this page never navigated anywhere before
  // the first relative fetch below, so it was still on about:blank, which
  // has no origin a relative URL can resolve against -- "Failed to parse
  // URL from /api/auth/register". adminPage/customerPage never hit this --
  // adminPageFromCache/customerPageFromCache navigate as part of loading
  // the cached storageState; this page registers a brand new account
  // instead, so it needs the same real origin given explicitly.
  await recipientPage.goto(WEB);
  // A fresh account, not UAT_CUSTOMER -- the sender and recipient must be
  // different accounts for "linked recipient" to mean anything.
  const recipientEmail = `mdf709-recipient-${stamp}@example.bz`;
  const register = await recipientPage.evaluate(
    async (email) => {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password: 'Mdf709Recipient!1', firstName: 'Mdf709', lastName: 'Recipient', acceptedTerms: true }),
      });
      return res.status;
    },
    recipientEmail,
  );
  expect(register, 'recipient registration failed').toBe(201);

  // god's finding (2026-11-18): the email fix above wasn't enough -- the
  // claim still 400'd, at an EARLIER gate than the email/phone match.
  // `claimAsRecipient` (shipment.service.ts:1526-1528) refuses first on
  // `me.isTest !== s.isTest`, and a plain `/auth/register` always produces
  // isTest:false (CLAUDE.md §4: "isTest is derived, never supplied" -- a
  // public registration endpoint cannot be the one place that's untrue).
  // This shipment is isTest:true (booked by the isTest UAT_CUSTOMER), so
  // the mismatch threw before email/phone was ever compared. The sanctioned
  // designation path is admin-only (`POST /admin/users/test-flag`,
  // `admin.controller.ts:139-147`, `users.suspend`) -- exactly the
  // "owner's decision, not the user's" shape the prime directive asks for.
  const me = await getJson<{ id: string }>(recipientPage, '/me');
  expect(me.status, 'could not read the new recipient\'s own id').toBe(200);
  const flagged = await postWithCsrf(adminPage, '/admin/users/test-flag', {
    userId: me.body.id,
    isTest: true,
    reason: 'MDF-709/710 e2e fixture -- recipient must be isTest to claim an isTest shipment',
  });
  expect(flagged.status, 'could not designate the recipient as a simulation account').toBe(201);

  const { reference } = await bookAndClaimToAwaitingCollection(customerPage, adminPage, recipientPage, recipientEmail, `Mdf709 ${stamp}`);
  console.log('[MDF709-GAP] booked, departed, arrived, handed off, claimed:', reference);

  const view = await getJson<Record<string, unknown>>(recipientPage, `/shipping/incoming/${encodeURIComponent(reference)}`);
  expect(view.status, 'recipient incoming-shipment read failed').toBe(200);
  console.log('[MDF709-GAP] recipient view keys:', Object.keys(view.body));
  expect(
    'collectionCode' in view.body,
    'CONFIRMED GAP (apps/api/src/shipping/shipment.service.ts recipientView(), a hand-built allowlist that never includes collectionCode): ' +
      'a linked recipient cannot see the code a terminal will ask them for. This is exactly MDF-709 item 1.',
  ).toBe(false);
});

/**
 * PENDING MDF-709 item 1. `test.fixme` -- always shown as skipped, never
 * counted as a pass or a fail, no matter what state the environment is in.
 * The body below is the full target assertion, left in place deliberately
 * so there is nothing left to write the day Pam's PR lands: confirm the
 * real response shape against that PR, remove `test.fixme`, and this runs.
 * (See the file header for why this replaced a `test.fail()` version.)
 */
test.fixme('AFTER MDF-709: a linked recipient sees the real collection code once AWAITING_COLLECTION, and only then', async ({ browser }) => {
  test.setTimeout(120_000);
  const adminPage = await adminPageFromCache(browser);
  const customerPage = await customerPageFromCache(browser);
  const recipientPage = await (await browser.newContext()).newPage();
  const recipientEmail = `mdf709-after-${stamp}@example.bz`;
  await recipientPage.evaluate(
    async (email) =>
      fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password: 'Mdf709Recipient!1', firstName: 'Mdf709', lastName: 'After', acceptedTerms: true }),
      }),
    recipientEmail,
  );

  const { reference } = await bookAndClaimToAwaitingCollection(customerPage, adminPage, recipientPage, recipientEmail, `Mdf709After ${stamp}`);

  const customerSideCode = await getJson<{ collectionCode: string | null }>(customerPage, `/shipping/${encodeURIComponent(reference)}`);
  expect(customerSideCode.body.collectionCode, 'sanity: the sender-side code must exist at AWAITING_COLLECTION').toBeTruthy();

  const recipientView = await getJson<{ collectionCode: string | null }>(recipientPage, `/shipping/incoming/${encodeURIComponent(reference)}`);
  expect(recipientView.status).toBe(200);
  expect(
    recipientView.body.collectionCode,
    'linked recipient must see the SAME real code the sender sees, once AWAITING_COLLECTION',
  ).toBe(customerSideCode.body.collectionCode);

  // Collect it (admin path, same as mdf587/mdf705), then re-read: the
  // now-collected shipment must show null to the recipient too, same as it
  // already does for the sender today.
  const shipmentId = (await getJson<{ id: string }>(adminPage, `/admin/logistics/shipments/${encodeURIComponent(reference)}`)).body.id;
  const collect = await postWithCsrf(adminPage, `/admin/logistics/shipments/${shipmentId}/collect`, {
    code: customerSideCode.body.collectionCode,
    collectedByName: 'Mdf709 After Collect',
  });
  expect(collect.status, 'collection failed').toBe(201);

  const afterCollect = await getJson<{ collectionCode: string | null }>(recipientPage, `/shipping/incoming/${encodeURIComponent(reference)}`);
  expect(afterCollect.body.collectionCode, 'a collected shipment must read null for the recipient too, same as the sender').toBeNull();
});

/**
 * PENDING MDF-709 item 2. Best-mirror-of-`ShippingDeliveryCodeController`
 * guess, NOT a confirmed contract -- confirm the real route names against
 * Pam's PR before removing `test.fixme`. Expected shape, by analogy with
 * the existing delivery-code pair (shipping.controller.ts :190/:196):
 *   POST /shipping/track/:token/collection-code/request -> { requested: true }
 *     unconditionally (same no-oracle rule UnlinkedDeliveryCode.tsx already
 *     documents for the delivery code -- must not leak whether an email
 *     exists), same StrictThrottle, same per-shipment cooldown shape.
 *   POST /shipping/track/:token/collection-code/reveal { revealToken }
 *     -> { collectionCode } on a valid, unexpired, unused token.
 * Audit: by analogy with SHIPMENT_DELIVERY_CODE_EMAIL_REQUESTED /
 * SHIPMENT_HANDOFF_PIN_REVEALED, expect two new, distinctly-named events
 * for the collection-code pair -- NOT the same two event names, since those
 * already mean "delivery/handoff code," a different secret.
 */
test.fixme('An UNLINKED recipient can request-then-reveal the collection code by email, same two-step shape as the delivery code (PENDING: route names not yet published)', async () => {});

/**
 * PENDING MDF-709 item 3. No route/trigger published yet. Expected: once a
 * HUB_TO_HUB or HUB_TO_DOOR shipment's final leg completes into
 * AWAITING_COLLECTION, the recipient (not just the sender, which
 * notifyCustomer :3594-3607 already covers) receives an email naming the
 * terminal and inviting them to the delivery-code-style reveal above.
 */
test.fixme('The recipient is notified by email once their shipment reaches AWAITING_COLLECTION, not just the sender (PENDING: MDF-709 item 3 not yet shipped)', async () => {});

/**
 * PENDING MDF-710. Best-mirror-of-`RecipientDeliveryCode.tsx`/
 * `UnlinkedDeliveryCode.tsx` guess. Expected, by analogy:
 *  - app/dashboard/incoming/[reference]/page.tsx grows a second block
 *    beside the existing `RecipientDeliveryCode` mount (:68), same
 *    `data-theme="light"` card shape, graceful-null handling identical to
 *    that component's own copy ("No collection code to show... right now"),
 *    NEVER a hard error for the common null case (service doesn't end at a
 *    hub, or shipment isn't AWAITING_COLLECTION yet).
 *  - app/track/[token]/page.tsx grows a second two-step block beside the
 *    existing `UnlinkedDeliveryCode` mount (:116), against the new
 *    collection-code request/reveal endpoints above.
 *  - Never rendered to a staff/terminal-authenticated session -- confirm
 *    this explicitly once built, not just by omission.
 */
test.fixme('The recipient\'s incoming-shipment page and the unlinked tracking page both render the collection code block, never to a staff session (PENDING: MDF-710 not yet shipped)', async () => {});
