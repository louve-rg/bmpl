import { test, expect, type Page } from '@playwright/test';
import { tryLogin, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD } from './support/auth';

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
 * for the other:
 *  - REAL tests, against EXISTING endpoints, proving today's actual gap.
 *    These need no new route and no guessed contract -- `trackAsRecipient`
 *    already exists; it is the shape of what it returns that MDF-709 item 1
 *    changes. The ones that currently FAIL on purpose use Playwright's own
 *    `test.fail()`, which flips to a real failure (catching a regression)
 *    the moment the underlying behavior starts passing unexpectedly -- i.e.
 *    once MDF-709 lands, these go green with ZERO edits, which is the "runs
 *    the instant the feature exists" instruction read literally.
 *  - `test.fixme` stubs for the pieces that need a ROUTE neither card has
 *    published yet (the unlinked two-step reveal, the notification, the UI
 *    block). Each names its best-mirror-of-the-existing-pattern guess in a
 *    comment, explicitly marked as a guess to confirm, not a contract to trust.
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

/** Books HUB_TO_HUB (UATBC -> UATBP) and drives the one LINE_HAUL leg to
 * AWAITING_COLLECTION via the real admin API -- same sequence mdf587/mdf705
 * already use for this. Also CLAIMS the shipment as a second, newly
 * registered recipient account, through the real claim endpoint, so a
 * genuinely LINKED recipient exists to test against. */
async function bookAndClaimToAwaitingCollection(
  customerPage: Page,
  adminPage: Page,
  recipientPage: Page,
  label: string,
): Promise<{ reference: string; recipientToken: string }> {
  const { body: hubs } = await getJson<Array<{ id: string; code: string }>>(adminPage, '/admin/logistics/hubs');
  const hubA = hubs.find((h) => h.code === 'UATBC');
  const hubB = hubs.find((h) => h.code === 'UATBP');
  expect(hubA && hubB, 'UATBC/UATBP simulation hubs not found').toBeTruthy();

  const booking = {
    service: 'HUB_TO_HUB',
    origin: { hubId: hubA!.id },
    destination: { hubId: hubB!.id, name: label, phone: '501-222-7101' },
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

test('TODAY: a linked recipient\'s own incoming-shipment view carries no collection code at all (MDF-709 item 1\'s gap, proven live)', async ({ browser }) => {
  test.setTimeout(120_000);
  const adminPage = await (await browser.newContext()).newPage();
  await adminLogin(adminPage);
  const customerPage = await (await browser.newContext()).newPage();
  expect(await tryLogin(customerPage, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD)).toBeTruthy();
  const recipientPage = await (await browser.newContext()).newPage();
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

  const { reference } = await bookAndClaimToAwaitingCollection(customerPage, adminPage, recipientPage, `Mdf709 ${stamp}`);
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
 * PENDING MDF-709 item 1. Once Pam's fix makes `trackAsRecipient`/
 * `listIncoming` return a real `collectionCode` for a genuinely linked
 * recipient, this test currently fails ON PURPOSE (`test.fail()`) and will
 * flip to passing with no edit required -- that flip IS the regression
 * proof. If it ever passes unexpectedly before MDF-709 ships, Playwright
 * itself raises that as an error (`test.fail()`'s own behavior), which is
 * the correct alarm: it would mean the fix landed silently, uncredited.
 */
test('AFTER MDF-709: a linked recipient sees the real collection code once AWAITING_COLLECTION, and only then', async ({ browser }) => {
  test.fail(true, 'Pending MDF-709 item 1 -- recipientView() does not expose collectionCode yet');
  test.setTimeout(120_000);
  const adminPage = await (await browser.newContext()).newPage();
  await adminLogin(adminPage);
  const customerPage = await (await browser.newContext()).newPage();
  expect(await tryLogin(customerPage, UAT_CUSTOMER_EMAIL, UAT_FIXTURE_PASSWORD)).toBeTruthy();
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

  const { reference } = await bookAndClaimToAwaitingCollection(customerPage, adminPage, recipientPage, `Mdf709After ${stamp}`);

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
