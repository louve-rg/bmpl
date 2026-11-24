import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { ADMIN_STATE_PATH } from './support/local-only-shared-auth';

/**
 * [LOCAL ONLY, WALLET-P2P-E2E] Browser acceptance for wallet-to-wallet P2P
 * transfers. Pam's API (PR #895, feat/wallet-p2p-api) and Oscar's web UI
 * (PR #891, feat/wallet-p2p-web) have both landed -- these are real tests
 * against their real routes and real markup, confirmed by reading both PR
 * diffs directly before writing a single assertion here. The two GAP-PROOF
 * tests that used to live in this file (proving the feature did not exist
 * yet) are gone now that it does -- same convention as MDF-709/710.
 *
 * *** THE REAL CONTRACT, as shipped -- NOT god's original text where the two differ ***
 *   POST /wallet/transfers/recipient-lookup  { email }
 *     -> 200 { recipientUserId, displayName }
 *     -> 404 "No eligible BML account for that email address." (identical for
 *        not-found, suspended, AND ineligible -- never distinguishable, by design)
 *   POST /wallet/transfers  { recipientUserId, amountMinor, idempotencyKey, note? }
 *     -> 201 receipt | 200 receipt+replayed:true | 400 | 404
 *   GET  /wallet/transfers/:transactionId -> 200 receipt for sender/recipient
 *     ONLY; anyone else gets 404, never 403.
 *   TransferReceipt.direction = "SENT" | "RECEIVED" (as originally frozen).
 *   GET /wallet/transactions rows KEEP the pre-existing direction: "IN" | "OUT"
 *     (Pam deliberately did NOT repurpose it to SENT|RECEIVED -- it already
 *     carries the sign for every transaction type, not just TRANSFER) plus a
 *     new counterpartyName. Oscar's describeTransaction() renders "Sent to X"
 *     for OUT and "Received from X" for IN. God verified both branches
 *     against each other independently before telling me this -- Oscar's
 *     label logic and Pam's field both agree.
 *   Server refusal strings actually shipped (match loosely -- a substring or
 *   case-insensitive regex, never the exact full string; wording is the kind
 *   of thing that gets polished):
 *     "Enter an amount greater than zero." / "You cannot send money to
 *     yourself." / "Unknown recipient." / "Your wallet is not active." /
 *     "That recipient's wallet is not active." / "You do not have enough
 *     available balance for this transfer."
 *   DECIDED, not tested: no fee, no limits, no reversals, no cancel, NO
 *   PENDING STATE, exact-email lookup only, BZD only, audit reuses
 *   WALLET_TRANSACTION_POSTED, type reuses WalletTransactionType.TRANSFER.
 *
 * UI, confirmed against Oscar's actual PR #891 diff, not guessed:
 *   /wallet has a "Send money" LINK (ButtonLink -> <a>, role=link, not a
 *   button) to /wallet/send. The flow there is recipient -> amount -> review
 *   -> confirm -> receipt, all on one page, nothing is a modal:
 *     #recipient-email (input), button "Find recipient", resolved recipient
 *     shows "Sending to <name>" + a "Change" button, #transfer-amount
 *     (input), #transfer-note (optional textarea), a Review card appears
 *     only once recipient+amount are both valid and in-balance (the
 *     insufficient-funds case is gated HERE, client-side, before any Confirm
 *     control exists at all -- not a server round trip), Confirm is
 *     `/^Send BZ\$/` (its own label includes the exact amount). The receipt
 *     card reads "Sent" / "to <name>" / Reference / Status / Date, with
 *     "Back to wallet" and "Send another" actions. A TRANSFER row's history
 *     link goes to the privacy-scoped /wallet/transfers/:id, not the generic
 *     /wallet/:id ledger-entries page.
 *
 *   "Send another" generates a BRAND NEW idempotencyKey per attempt
 *   (startNewAttempt() in page.tsx) -- god flagged PR #891 as HELD on a bug
 *   where this used to reuse the first attempt's key (a second transfer from
 *   one page mount would silently replay the first receipt and move no
 *   money). Reading the PR's current diff, the fix (a fresh
 *   crypto.randomUUID() on every "Send another" click) is already present.
 *   The dedicated adversarial test below checks this against the REAL
 *   running server, not the PR's own mocked unit test -- the only way to
 *   actually confirm the fix from outside, same as the double-click and
 *   replay cases already in this file.
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

async function adminPageFromCache(browser: import('@playwright/test').Browser): Promise<Page> {
  const page = await (await browser.newContext({ storageState: ADMIN_STATE_PATH })).newPage();
  await page.goto(WEB);
  return page;
}

/**
 * A FRESH, isTest-flagged customer account -- never UAT_CUSTOMER (the shared
 * cached account every other local-only file also uses). Money movement
 * tests get their own accounts on purpose: a shared account's balance is not
 * something this file may assume or leave altered for every other spec file
 * that runs in the same invocation. Mirrors MDF-709/710's own recipient
 * registration + admin test-flag pattern exactly.
 */
async function registerTestCustomer(
  browser: import('@playwright/test').Browser,
  adminPage: Page,
  label: string,
): Promise<{ page: Page; email: string; userId: string }> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(WEB);
  const email = `wallet-p2p-${label}-${stamp}@example.bz`;
  const register = await page.evaluate(
    async ({ email, label }) => {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password: 'WalletP2pFixture!1', firstName: 'WalletP2p', lastName: label, acceptedTerms: true }),
      });
      return res.status;
    },
    { email, label },
  );
  expect(register, `registration failed for ${label}`).toBe(201);

  const me = await getJson<{ id: string }>(page, '/me');
  expect(me.status, `could not read ${label}'s own id`).toBe(200);
  const flagged = await postWithCsrf(adminPage, '/admin/users/test-flag', {
    userId: me.body.id,
    isTest: true,
    reason: 'WALLET-P2P-E2E fixture -- a real-money account must never be the thing this spec credits or debits',
  });
  expect(flagged.status, `could not designate ${label} as a simulation account`).toBe(201);

  return { page, email, userId: me.body.id };
}

/** Admin test-credit path, per god's explicit boundary -- never a direct balance write. */
async function fundWallet(adminPage: Page, userId: string, amountMinor: number, reason: string): Promise<void> {
  const credited = await postWithCsrf(adminPage, '/admin/wallet/test-credit', {
    userId,
    amountMinor,
    reason,
    idempotencyKey: `wallet-p2p-fund-${userId}-${amountMinor}-${stamp}`,
  });
  expect(credited.status, `test-credit failed for ${userId}`).toBe(201);
}

/** Matches `WalletService.displayName` exactly: "<firstName> <lastName.charAt(0)>.",
 *  and `registerTestCustomer` always registers firstName: 'WalletP2p', lastName: label. */
function expectedDisplayName(label: string): string {
  return `WalletP2p ${label.charAt(0)}.`;
}

async function lookupRecipientInUi(page: Page, email: string): Promise<void> {
  await page.locator('#recipient-email').fill(email);
  await page.getByRole('button', { name: 'Find recipient' }).click();
}

/**
 * PR #898 (chore/wallet-p2p-test-ids, not yet merged -- run against it per
 * god's explicit instruction rather than waiting) added `data-testid` to
 * everything that previously had only prose or dynamic text. The Confirm
 * button's OWN accessible name embeds the live amount
 * (`Send ${bzd(amountMinor)}`, apps/web/app/wallet/send/page.tsx:418) and
 * becomes "Sending…" mid-flight -- a role/name locator on it is matching on
 * money and goes stale the instant the button's own state changes (this is
 * exactly what made the double-click case hang against the full test
 * timeout before this fix: the second dispatchEvent kept waiting for a name
 * that was never coming back). The testid never changes.
 */
function confirmButton(page: Page) {
  return page.getByTestId('send-money-confirm-button');
}

/** apps/web/app/wallet/send/page.tsx:221 -- the inline post-confirm receipt's reference. */
async function getSendReceiptReference(page: Page): Promise<string> {
  return (await page.getByTestId('send-money-receipt-reference').textContent()) ?? '';
}

test('successful transfer: sender sees the receipt, recipient sees it in history with an updated available balance', async ({ browser }) => {
  test.setTimeout(120_000);
  const adminPage = await adminPageFromCache(browser);
  const sender = await registerTestCustomer(browser, adminPage, 'sender-success');
  const recipient = await registerTestCustomer(browser, adminPage, 'recipient-success');
  await fundWallet(adminPage, sender.userId, 5000, 'WALLET-P2P-E2E fixture funding');

  const recipientBefore = await getJson<{ availableMinor: number }>(recipient.page, '/wallet');

  await sender.page.goto(`${WEB}/wallet`);
  await sender.page.getByRole('link', { name: /send money/i }).click();
  await expect(sender.page).toHaveURL(/\/wallet\/send$/);
  const recipientName = expectedDisplayName('recipient-success');
  await lookupRecipientInUi(sender.page, recipient.email);
  await expect(sender.page.getByText(`Sending to ${recipientName}`)).toBeVisible();
  await sender.page.locator('#transfer-amount').fill('25.00');
  await expect(confirmButton(sender.page)).toHaveText('Send BZ$25.00');
  await confirmButton(sender.page).click();

  // Sender side: a receipt, "Sent", this exact counterparty.
  await expect(sender.page.getByText('Sent', { exact: true })).toBeVisible();
  await expect(sender.page.getByText(`to ${recipientName}`)).toBeVisible();

  // Recipient side -- the shape this test exists to prove, per god: a
  // sender-only check proves a UI, not a transfer.
  const recipientAfter = await getJson<{ availableMinor: number }>(recipient.page, '/wallet');
  expect(recipientAfter.body.availableMinor, 'recipient available balance did not rise by exactly the sent amount').toBe(
    recipientBefore.body.availableMinor + 2500,
  );
  const senderName = expectedDisplayName('sender-success');
  await recipient.page.goto(`${WEB}/wallet`);
  await expect(recipient.page.getByText(`Received from ${senderName}`)).toBeVisible();

  const history = await getJson<{
    rows: Array<{ type: string; direction: string; counterpartyName?: string | null; signedMinor: number }>;
  }>(recipient.page, '/wallet/transactions');
  const row = history.body.rows.find((r) => r.type === 'TRANSFER' && r.signedMinor === 2500);
  expect(row, 'no matching TRANSFER row in recipient history').toBeTruthy();
  // Pam's deviation from the originally frozen contract, god-verified
  // independently against Oscar's branch: history keeps direction: IN|OUT.
  expect(row!.direction, "history direction must stay IN|OUT, not be repurposed to the receipt's SENT|RECEIVED").toBe('IN');
  expect(row!.counterpartyName).toBe(senderName);
});

test('insufficient funds is refused in the UI before any send attempt can reach the server', async ({ browser }) => {
  test.setTimeout(120_000);
  const adminPage = await adminPageFromCache(browser);
  const sender = await registerTestCustomer(browser, adminPage, 'sender-insufficient');
  const recipient = await registerTestCustomer(browser, adminPage, 'recipient-insufficient');
  await fundWallet(adminPage, sender.userId, 1000, 'WALLET-P2P-E2E fixture funding');

  const senderBefore = await getJson<{ availableMinor: number }>(sender.page, '/wallet');

  await sender.page.goto(`${WEB}/wallet/send`);
  await lookupRecipientInUi(sender.page, recipient.email);
  await sender.page.locator('#transfer-amount').fill('50.00'); // balance is BZ$10.00

  await expect(
    sender.page.getByText(/only have.*available/i),
    'no over-balance refusal shown for an amount the wallet cannot cover',
  ).toBeVisible();
  // The real build gates this CLIENT-side (`canReview = ... && !overBalance`)
  // -- the Confirm control never exists in the DOM at all, so this checks the
  // actual shipped mechanism rather than standing in for a server round trip.
  await expect(confirmButton(sender.page)).toHaveCount(0);

  const senderAfter = await getJson<{ availableMinor: number }>(sender.page, '/wallet');
  expect(senderAfter.body.availableMinor, 'a refused transfer must not move any money').toBe(senderBefore.body.availableMinor);
});

test("an unknown recipient email shows the server's own message, not a generic error", async ({ browser }) => {
  const adminPage = await adminPageFromCache(browser);
  const sender = await registerTestCustomer(browser, adminPage, 'sender-unknown');
  await fundWallet(adminPage, sender.userId, 5000, 'WALLET-P2P-E2E fixture funding');

  await sender.page.goto(`${WEB}/wallet/send`);
  await lookupRecipientInUi(sender.page, `no-such-account-${stamp}@example.bz`);

  await expect(
    sender.page.getByText('No eligible BML account for that email address.'),
    "the UI must surface the server's own 404 message verbatim, not a generic error",
  ).toBeVisible();
  await expect(sender.page.getByText('How much?')).toHaveCount(0);
});

test('a self-transfer attempt is refused', async ({ browser }) => {
  const adminPage = await adminPageFromCache(browser);
  const sender = await registerTestCustomer(browser, adminPage, 'sender-self');
  await fundWallet(adminPage, sender.userId, 5000, 'WALLET-P2P-E2E fixture funding');
  const before = await getJson<{ availableMinor: number }>(sender.page, '/wallet');

  await sender.page.goto(`${WEB}/wallet/send`);
  await lookupRecipientInUi(sender.page, sender.email);
  await sender.page.locator('#transfer-amount').fill('10.00');
  await confirmButton(sender.page).click();

  await expect(sender.page.getByText(/cannot send money to yourself/i), 'no self-transfer refusal shown').toBeVisible();
  const after = await getJson<{ availableMinor: number }>(sender.page, '/wallet');
  expect(after.body.availableMinor, 'a refused self-transfer must not move any money').toBe(before.body.availableMinor);
});

test(
  'double-clicking confirm produces exactly ONE movement in history -- the one case most likely genuinely broken, so adversarial by design',
  async ({ browser }) => {
    test.setTimeout(120_000);
    const adminPage = await adminPageFromCache(browser);
    const sender = await registerTestCustomer(browser, adminPage, 'sender-dblclick');
    const recipient = await registerTestCustomer(browser, adminPage, 'recipient-dblclick');
    await fundWallet(adminPage, sender.userId, 5000, 'WALLET-P2P-E2E fixture funding');

    await sender.page.goto(`${WEB}/wallet/send`);
    await lookupRecipientInUi(sender.page, recipient.email);
    await sender.page.locator('#transfer-amount').fill('15.00');
    const confirmBtn = confirmButton(sender.page);
    // Two real clicks, back to back, no wait between them -- not a
    // simulated double-submit, an actual fast double-click the way a real
    // thumb on a slow connection produces one. dispatchEvent bypasses
    // Playwright's actionability wait on BOTH clicks (a plain .click() would
    // keep retrying "wait for enabled" against a button the first click just
    // disabled, then hang against test timeout once the button unmounts for
    // the receipt -- a harness race, not a product signal).
    await Promise.all([confirmBtn.dispatchEvent('click'), confirmBtn.dispatchEvent('click')]);
    await expect(sender.page.getByText('Sent', { exact: true })).toBeVisible();

    const history = await getJson<{ rows: Array<{ type: string; signedMinor: number }> }>(sender.page, '/wallet/transactions');
    const transfers = history.body.rows.filter((r) => r.type === 'TRANSFER' && Math.abs(r.signedMinor) === 1500);
    expect(transfers.length, 'a fast double-click produced more than one movement').toBe(1);
  },
);

test(
  'replaying the exact same transfer request produces exactly ONE movement -- idempotencyKey honoured, checked by direct API replay',
  async ({ browser }) => {
    test.setTimeout(120_000);
    const adminPage = await adminPageFromCache(browser);
    const sender = await registerTestCustomer(browser, adminPage, 'sender-replay');
    const recipient = await registerTestCustomer(browser, adminPage, 'recipient-replay');
    await fundWallet(adminPage, sender.userId, 5000, 'WALLET-P2P-E2E fixture funding');

    const lookup = await postWithCsrf<{ recipientUserId: string }>(sender.page, '/wallet/transfers/recipient-lookup', {
      email: recipient.email,
    });
    expect(lookup.status).toBe(200);

    // createTransferSchema requires idempotencyKey to be a real UUID
    // (packages/validation/src/wallet.ts) -- a plain tagged string here
    // fails Zod validation before any DB call (confirmed: a 400 in ~1ms,
    // too fast for a business-logic rejection), which is a bug in this test's
    // own fixture, not a product bug.
    const idempotencyKey = randomUUID();
    const body = { recipientUserId: lookup.body.recipientUserId, amountMinor: 1200, idempotencyKey };
    const first = await postWithCsrf<{ transactionId: string; replayed?: boolean }>(sender.page, '/wallet/transfers', body);
    expect(first.status, 'first transfer call did not succeed').toBe(201);

    const second = await postWithCsrf<{ transactionId: string; replayed?: boolean }>(sender.page, '/wallet/transfers', body);
    expect(second.status, 'a replay with the SAME idempotencyKey must come back 200, not a fresh 201').toBe(200);
    expect(second.body.replayed, 'a replayed response must say so').toBe(true);
    expect(second.body.transactionId, 'a replay must return the SAME transaction, not a new one').toBe(first.body.transactionId);

    const history = await getJson<{ rows: Array<{ type: string; signedMinor: number }> }>(sender.page, '/wallet/transactions');
    const transfers = history.body.rows.filter((r) => r.type === 'TRANSFER' && Math.abs(r.signedMinor) === 1200);
    expect(transfers.length, 'a replayed request produced a second real movement, not just a second response').toBe(1);
  },
);

test(
  'the receipt view opened from a history row shows reference, amount, counterparty, date and status',
  async ({ browser }) => {
    test.setTimeout(120_000);
    const adminPage = await adminPageFromCache(browser);
    const sender = await registerTestCustomer(browser, adminPage, 'sender-receipt');
    const recipient = await registerTestCustomer(browser, adminPage, 'recipient-receipt');
    await fundWallet(adminPage, sender.userId, 5000, 'WALLET-P2P-E2E fixture funding');

    await sender.page.goto(`${WEB}/wallet/send`);
    const recipientName = expectedDisplayName('recipient-receipt');
    await lookupRecipientInUi(sender.page, recipient.email);
    await sender.page.locator('#transfer-amount').fill('8.00');
    await confirmButton(sender.page).click();
    await expect(sender.page.getByText('Sent', { exact: true })).toBeVisible();

    await sender.page.goto(`${WEB}/wallet`);
    await sender.page
      .getByRole('link')
      .filter({ hasText: recipientName })
      .first()
      .click();

    await expect(sender.page).toHaveURL(/\/wallet\/transfers\//);
    // apps/web/app/wallet/transfers/[transactionId]/page.tsx, read directly
    // from PR #898's branch: title + StatusBadge come from PageHeader
    // (title/description/actions), amount+counterparty+reference are inside
    // [data-testid=transfer-receipt-card] as a `dl`, but the date is
    // PageHeader's own `description` -- OUTSIDE that dl, right under the
    // title. A date search scoped to the dl (an earlier version of this
    // test) finds nothing there; an unscoped page-wide search instead hits
    // an unrelated "Coming February 2027" promo string in the page chrome.
    // Scoping to `main` (the page's own content, excluding Header/Footer)
    // avoids both.
    await expect(sender.page.getByText(`Sent to ${recipientName}`)).toBeVisible();
    await expect(sender.page.getByTestId('transfer-receipt-amount')).toHaveText('−BZ$8.00');
    await expect(sender.page.getByTestId('transfer-receipt-reference')).toContainText('transfer:');
    await expect(
      sender.page
        .locator('main')
        .getByText(/\d{1,2}[/,-]\d{1,2}|january|february|march|april|may|june|july|august|september|october|november|december/i),
    ).toBeVisible();
    // Transfers post synchronously with no pending state (DECIDED, not
    // tested: no pending state at all) -- status is always POSTED
    // (apps/api/src/wallet/wallet.service.ts:114). StatusBadge has no
    // testid and no stable class (ui.tsx's Badge has no "badge" literal in
    // its className -- the earlier `[class*="badge" i]` guess here would
    // never have matched anything), so assert its actual rendered label.
    await expect(sender.page.locator('main').getByText('POSTED', { exact: false })).toBeVisible();
  },
);

test('the full send-money flow completes at ~390px mobile width, not just desktop', async ({ browser }) => {
  test.setTimeout(120_000);
  const adminPage = await adminPageFromCache(browser);
  const sender = await registerTestCustomer(browser, adminPage, 'sender-mobile');
  const recipient = await registerTestCustomer(browser, adminPage, 'recipient-mobile');
  await fundWallet(adminPage, sender.userId, 5000, 'WALLET-P2P-E2E fixture funding');
  await sender.page.setViewportSize({ width: 390, height: 844 });

  await sender.page.goto(`${WEB}/wallet`);
  const sendLink = sender.page.getByRole('link', { name: /send money/i });
  await sendLink.scrollIntoViewIfNeeded();
  await expect(sendLink, 'Send money control not reachable at 390px').toBeVisible();
  await sendLink.click();
  await expect(sender.page).toHaveURL(/\/wallet\/send$/);

  await lookupRecipientInUi(sender.page, recipient.email);
  await sender.page.locator('#transfer-amount').fill('5.00');
  const confirmBtn = confirmButton(sender.page);
  await confirmBtn.scrollIntoViewIfNeeded();
  await expect(confirmBtn, 'confirm control not reachable at 390px').toBeVisible();
  await confirmBtn.click();

  await expect(sender.page.getByText('Sent', { exact: true }), 'flow did not complete at 390px').toBeVisible();
});

test(
  '"Send another" sends a genuinely SECOND transfer -- god\'s adversarial case for the bug he held PR #891 on: ' +
    'a different recipient for a different amount must actually receive it, not replay the first receipt',
  async ({ browser }) => {
    test.setTimeout(120_000);
    const adminPage = await adminPageFromCache(browser);
    const sender = await registerTestCustomer(browser, adminPage, 'sender-sendanother');
    const recipientA = await registerTestCustomer(browser, adminPage, 'recipienta-sendanother');
    const recipientB = await registerTestCustomer(browser, adminPage, 'recipientb-sendanother');
    await fundWallet(adminPage, sender.userId, 10000, 'WALLET-P2P-E2E fixture funding');

    const recipientABefore = await getJson<{ availableMinor: number }>(recipientA.page, '/wallet');
    const recipientBBefore = await getJson<{ availableMinor: number }>(recipientB.page, '/wallet');

    await sender.page.goto(`${WEB}/wallet/send`);
    await lookupRecipientInUi(sender.page, recipientA.email);
    await sender.page.locator('#transfer-amount').fill('25.00');
    await confirmButton(sender.page).click();
    await expect(sender.page.getByText('Sent', { exact: true })).toBeVisible();
    const firstReference = await getSendReceiptReference(sender.page);

    await sender.page.getByTestId('send-money-send-another').click();
    // Back to the recipient step, nothing left over from the first attempt.
    await expect(sender.page.getByText('Sent', { exact: true })).toHaveCount(0);
    await expect(sender.page.locator('#recipient-email')).toHaveValue('');

    await lookupRecipientInUi(sender.page, recipientB.email);
    await sender.page.locator('#transfer-amount').fill('40.00');
    await confirmButton(sender.page).click();
    await expect(sender.page.getByText('Sent', { exact: true })).toBeVisible();
    const secondReference = await getSendReceiptReference(sender.page);

    expect(
      secondReference,
      'the second attempt rendered the SAME reference as the first -- a Send-another replay, not a real second transfer',
    ).not.toBe(firstReference);

    // The real bug god flagged, checked against the actual server rather
    // than a mocked unit test: who genuinely got money.
    const recipientAAfter = await getJson<{ availableMinor: number }>(recipientA.page, '/wallet');
    const recipientBAfter = await getJson<{ availableMinor: number }>(recipientB.page, '/wallet');
    expect(recipientAAfter.body.availableMinor, 'first recipient must have received exactly the first amount, no more').toBe(
      recipientABefore.body.availableMinor + 2500,
    );
    expect(
      recipientBAfter.body.availableMinor,
      "second recipient must have actually received the second transfer -- if this is unchanged, the bug is confirmed from the outside",
    ).toBe(recipientBBefore.body.availableMinor + 4000);
  },
);
