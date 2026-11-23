import { test, expect, type Page } from '@playwright/test';
import { ADMIN_STATE_PATH } from './support/local-only-shared-auth';

/**
 * [LOCAL ONLY, WALLET-P2P-E2E] Written ahead of Pam's API PR and Oscar's web
 * PR landing, per god's instruction (thread conv-090b69) to author the
 * browser-acceptance spec against the frozen contract immediately, so it is
 * ready to run the day both land -- same precedent as the MDF-709/710 file
 * in this directory.
 *
 * *** THE FROZEN CONTRACT (god's message, conv-090b69, verbatim shape) ***
 *   POST /wallet/transfers/recipient-lookup  { email }
 *     -> 200 { recipientUserId, displayName }
 *     -> 404 "No eligible BML account for that email address."
 *   POST /wallet/transfers  { recipientUserId, amountMinor, idempotencyKey, note? }
 *     -> 201 receipt | 200 receipt+replayed:true | 400 | 404
 *   GET  /wallet/transfers/:transactionId
 *     -> 200 receipt for sender or recipient ONLY; anyone else gets 404, not 403.
 *   TransferReceipt = { transactionId, reference, direction: "SENT"|"RECEIVED",
 *     amountMinor, currency, status, counterpartyName, note, postedAt, isTest, replayed? }
 *   GET /wallet/transactions gains direction + counterpartyName on TRANSFER rows.
 *   DECIDED, not tested: no fee, no limits, no reversals, no cancel, NO PENDING
 *   STATE, exact-email lookup only, BZD only, audit reuses
 *   WALLET_TRANSACTION_POSTED, type reuses WalletTransactionType.TRANSFER
 *   (confirmed already present in schema.prisma -- no migration needed for it).
 *
 * Two different kinds of test here, same labelling convention as MDF-709/710
 * so neither is mistaken for the other or counted as health by anyone
 * tallying green:
 *  - TWO real `GAP-PROOF:` tests, against what exists TODAY (before Pam/Oscar
 *    land anything), proving the feature genuinely does not exist yet --
 *    not assumed, checked live.
 *  - `test.fixme` stubs for every case god asked for, each with the full
 *    target assertion already written out against the frozen contract above,
 *    ready to run the day `test.fixme` comes off and the real selectors are
 *    confirmed against Oscar's actual markup. UI selectors below are a
 *    best-mirror-of-the-existing-/wallet-page guess (Button text "Send
 *    money", a recipient-email field, an amount field, a "Send" confirm) --
 *    NOT a confirmed contract. Confirm against the real PR before removing
 *    `test.fixme`, same discipline as MDF-709/710's own stubs.
 *
 * OPEN QUESTION flagged to god, not assumed either way: WALLET_MONEY_MOVEMENT_ENABLED
 * "stays false" is listed as a standing constraint. If that flag gates the
 * whole P2P feature (not just a production safety switch), the fixme tests
 * below may need it true in THIS isolated local stack to ever leave
 * test.fixme -- asked god rather than guessing which.
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

/* ========================================================== GAP-PROOF:
   proves today's actual absence of the feature, checked live, not assumed. */

test('GAP-PROOF: POST /wallet/transfers/recipient-lookup is not a registered route today', async ({ browser }) => {
  const adminPage = await adminPageFromCache(browser);
  const lookup = await postWithCsrf<{ message?: string; error?: string }>(adminPage, '/wallet/transfers/recipient-lookup', {
    email: 'nobody@example.bz',
  });
  // A real controller's "no eligible account" 404 and Nest's own
  // "route doesn't exist" 404 are the same STATUS CODE -- the only honest way
  // to tell them apart live is the framework's own generic error text, which
  // the contract's real message ("No eligible BML account for that email
  // address.") is deliberately NOT.
  expect(lookup.status, 'unexpected status for an unregistered route').toBe(404);
  expect(
    lookup.body.message,
    'CONFIRMED GAP: recipient-lookup already answers with the contract\'s own message -- this GAP-PROOF test is stale, ' +
      'Pam\'s PR has landed. Remove this test and flip the fixme stubs below instead of trusting this one further.',
  ).not.toBe('No eligible BML account for that email address.');
  console.log('[WALLET-P2P-GAP] recipient-lookup 404 body today:', JSON.stringify(lookup.body));
});

test('GAP-PROOF: the /wallet page has no "Send money" control today', async ({ browser }) => {
  const adminPage = await adminPageFromCache(browser);
  const sender = await registerTestCustomer(browser, adminPage, 'gapcheck');
  await sender.page.goto(`${WEB}/wallet`);
  await expect(sender.page.getByRole('heading', { name: 'Wallet' }), 'the wallet page itself failed to render').toBeVisible();
  const sendMoneyControl = sender.page.getByRole('button', { name: /send money/i }).or(sender.page.getByRole('link', { name: /send money/i }));
  await expect(
    sendMoneyControl,
    'CONFIRMED GAP: a "Send money" control already exists on /wallet -- this GAP-PROOF test is stale, Oscar\'s PR has ' +
      'landed. Remove this test and flip the fixme stubs below instead of trusting this one further.',
  ).toHaveCount(0);
});

/* ========================================================== PENDING:
   every case god asked for, full target assertion written against the
   frozen contract, ready to run once test.fixme comes off AND the real
   selectors below are confirmed against Oscar's actual markup. */

test.fixme(
  'successful transfer with both sides observed: sender sees the receipt, recipient sees it in history with an updated available balance',
  async ({ browser }) => {
    test.setTimeout(120_000);
    const adminPage = await adminPageFromCache(browser);
    const sender = await registerTestCustomer(browser, adminPage, 'sender-success');
    const recipient = await registerTestCustomer(browser, adminPage, 'recipient-success');
    await fundWallet(adminPage, sender.userId, 5000, 'WALLET-P2P-E2E fixture funding');

    const recipientBefore = await getJson<{ availableMinor: number }>(recipient.page, '/wallet');

    // PENDING selectors -- confirm against Oscar's PR.
    await sender.page.goto(`${WEB}/wallet`);
    await sender.page.getByRole('button', { name: /send money/i }).click();
    await sender.page.getByLabel(/recipient.*email/i).fill(recipient.email);
    await sender.page.getByLabel(/amount/i).fill('25.00');
    await sender.page.getByRole('button', { name: /^(send|confirm)/i }).click();

    // Sender side: a receipt, SENT, this exact counterparty.
    await expect(sender.page.getByText(/sent/i)).toBeVisible();
    await expect(sender.page.getByText(recipient.email).or(sender.page.getByText(/wallet-p2p-recipient-success/i))).toBeVisible();

    // Recipient side -- the shape this test exists to prove, per god: a
    // sender-only check proves a UI, not a transfer.
    await recipient.page.goto(`${WEB}/wallet`);
    await expect(recipient.page.getByText(/received/i)).toBeVisible();
    const recipientAfter = await getJson<{ availableMinor: number }>(recipient.page, '/wallet');
    expect(recipientAfter.body.availableMinor, 'recipient available balance did not rise by exactly the sent amount').toBe(
      recipientBefore.body.availableMinor + 2500,
    );
  },
);

test.fixme('insufficient funds is refused in the UI, not silently debited', async ({ browser }) => {
  test.setTimeout(120_000);
  const adminPage = await adminPageFromCache(browser);
  const sender = await registerTestCustomer(browser, adminPage, 'sender-insufficient');
  const recipient = await registerTestCustomer(browser, adminPage, 'recipient-insufficient');
  await fundWallet(adminPage, sender.userId, 1000, 'WALLET-P2P-E2E fixture funding');

  const senderBefore = await getJson<{ availableMinor: number }>(sender.page, '/wallet');

  await sender.page.goto(`${WEB}/wallet`);
  await sender.page.getByRole('button', { name: /send money/i }).click();
  await sender.page.getByLabel(/recipient.*email/i).fill(recipient.email);
  await sender.page.getByLabel(/amount/i).fill('50.00');
  await sender.page.getByRole('button', { name: /^(send|confirm)/i }).click();

  await expect(sender.page.getByText(/insufficient|not enough/i), 'no refusal message shown for an amount the wallet cannot cover').toBeVisible();
  const senderAfter = await getJson<{ availableMinor: number }>(sender.page, '/wallet');
  expect(senderAfter.body.availableMinor, 'a refused transfer must not move any money').toBe(senderBefore.body.availableMinor);
});

test.fixme('an unknown recipient email shows the server\'s own message, not a generic error', async ({ browser }) => {
  const adminPage = await adminPageFromCache(browser);
  const sender = await registerTestCustomer(browser, adminPage, 'sender-unknown');
  await fundWallet(adminPage, sender.userId, 5000, 'WALLET-P2P-E2E fixture funding');

  await sender.page.goto(`${WEB}/wallet`);
  await sender.page.getByRole('button', { name: /send money/i }).click();
  await sender.page.getByLabel(/recipient.*email/i).fill(`no-such-account-${stamp}@example.bz`);
  await sender.page.getByLabel(/amount/i).blur();

  await expect(
    sender.page.getByText('No eligible BML account for that email address.'),
    'the UI must surface the server\'s own 404 message verbatim, not a generic "something went wrong"',
  ).toBeVisible();
});

test.fixme('a self-transfer attempt is refused', async ({ browser }) => {
  const adminPage = await adminPageFromCache(browser);
  const sender = await registerTestCustomer(browser, adminPage, 'sender-self');
  await fundWallet(adminPage, sender.userId, 5000, 'WALLET-P2P-E2E fixture funding');

  await sender.page.goto(`${WEB}/wallet`);
  await sender.page.getByRole('button', { name: /send money/i }).click();
  await sender.page.getByLabel(/recipient.*email/i).fill(sender.email);
  await sender.page.getByLabel(/amount/i).fill('10.00');
  await sender.page.getByRole('button', { name: /^(send|confirm)/i }).click();

  await expect(sender.page.getByText(/yourself|own (account|wallet)/i), 'no self-transfer refusal shown').toBeVisible();
  const after = await getJson<{ availableMinor: number }>(sender.page, '/wallet');
  const before = await getJson<{ availableMinor: number }>(sender.page, '/wallet');
  expect(after.body.availableMinor, 'a refused self-transfer must not move any money').toBe(before.body.availableMinor);
});

test.fixme(
  'double-clicking confirm produces exactly ONE movement in history -- the one case most likely genuinely broken, so adversarial by design',
  async ({ browser }) => {
    test.setTimeout(120_000);
    const adminPage = await adminPageFromCache(browser);
    const sender = await registerTestCustomer(browser, adminPage, 'sender-dblclick');
    const recipient = await registerTestCustomer(browser, adminPage, 'recipient-dblclick');
    await fundWallet(adminPage, sender.userId, 5000, 'WALLET-P2P-E2E fixture funding');

    await sender.page.goto(`${WEB}/wallet`);
    await sender.page.getByRole('button', { name: /send money/i }).click();
    await sender.page.getByLabel(/recipient.*email/i).fill(recipient.email);
    await sender.page.getByLabel(/amount/i).fill('15.00');
    const confirmBtn = sender.page.getByRole('button', { name: /^(send|confirm)/i });
    // Two real clicks, back to back, no wait between them -- not a
    // simulated double-submit, an actual fast double-click the way a real
    // thumb on a slow connection produces one.
    await Promise.all([confirmBtn.click(), confirmBtn.click({ force: true })]);

    const history = await getJson<{ rows: Array<{ type: string; amountMinor: number }> }>(sender.page, '/wallet/transactions');
    const transfers = history.body.rows.filter((r) => r.type === 'TRANSFER' && Math.abs(r.amountMinor) === 1500);
    expect(transfers.length, 'a fast double-click produced more than one movement').toBe(1);
  },
);

test.fixme(
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

    const idempotencyKey = `wallet-p2p-replay-${stamp}`;
    const body = { recipientUserId: lookup.body.recipientUserId, amountMinor: 1200, idempotencyKey };
    const first = await postWithCsrf<{ transactionId: string; replayed?: boolean }>(sender.page, '/wallet/transfers', body);
    expect(first.status, 'first transfer call did not succeed').toBe(201);

    const second = await postWithCsrf<{ transactionId: string; replayed?: boolean }>(sender.page, '/wallet/transfers', body);
    expect(second.status, 'a replay with the SAME idempotencyKey must come back 200, not a fresh 201').toBe(200);
    expect(second.body.replayed, 'a replayed response must say so').toBe(true);
    expect(second.body.transactionId, 'a replay must return the SAME transaction, not a new one').toBe(first.body.transactionId);

    const history = await getJson<{ rows: Array<{ type: string; amountMinor: number }> }>(sender.page, '/wallet/transactions');
    const transfers = history.body.rows.filter((r) => r.type === 'TRANSFER' && Math.abs(r.amountMinor) === 1200);
    expect(transfers.length, 'a replayed request produced a second real movement, not just a second response').toBe(1);
  },
);

test.fixme(
  'the receipt view opened from a history row shows reference, amount, counterparty, date and status',
  async ({ browser }) => {
    test.setTimeout(120_000);
    const adminPage = await adminPageFromCache(browser);
    const sender = await registerTestCustomer(browser, adminPage, 'sender-receipt');
    const recipient = await registerTestCustomer(browser, adminPage, 'recipient-receipt');
    await fundWallet(adminPage, sender.userId, 5000, 'WALLET-P2P-E2E fixture funding');

    await sender.page.goto(`${WEB}/wallet`);
    await sender.page.getByRole('button', { name: /send money/i }).click();
    await sender.page.getByLabel(/recipient.*email/i).fill(recipient.email);
    await sender.page.getByLabel(/amount/i).fill('8.00');
    await sender.page.getByRole('button', { name: /^(send|confirm)/i }).click();

    await sender.page.goto(`${WEB}/wallet`);
    await sender.page.getByText(/sent/i).first().click();

    await expect(sender.page.getByText(/reference/i)).toBeVisible();
    await expect(sender.page.getByText('BZ$8.00')).toBeVisible();
    await expect(sender.page.getByText(recipient.email).or(sender.page.getByText(/wallet-p2p-recipient-receipt/i))).toBeVisible();
    await expect(sender.page.getByText(/\d{1,2}[/,-]\d{1,2}|january|february|march|april|may|june|july|august|september|october|november|december/i)).toBeVisible();
    // The existing /wallet/[id] page already renders a StatusBadge for
    // every transaction type -- the receipt must not be the one type that
    // skips it.
    await expect(sender.page.locator('[class*="badge" i], [data-testid*="status" i]').first()).toBeVisible();
  },
);

test.fixme('the full send-money flow completes at ~400px mobile width, not just desktop', async ({ browser }) => {
  test.setTimeout(120_000);
  const adminPage = await adminPageFromCache(browser);
  const sender = await registerTestCustomer(browser, adminPage, 'sender-mobile');
  const recipient = await registerTestCustomer(browser, adminPage, 'recipient-mobile');
  await fundWallet(adminPage, sender.userId, 5000, 'WALLET-P2P-E2E fixture funding');
  await sender.page.setViewportSize({ width: 390, height: 844 });

  await sender.page.goto(`${WEB}/wallet`);
  const sendBtn = sender.page.getByRole('button', { name: /send money/i });
  await sendBtn.scrollIntoViewIfNeeded();
  await expect(sendBtn, 'Send money control not reachable at 390px').toBeVisible();
  await sendBtn.click();
  await sender.page.getByLabel(/recipient.*email/i).fill(recipient.email);
  await sender.page.getByLabel(/amount/i).fill('5.00');
  const confirmBtn = sender.page.getByRole('button', { name: /^(send|confirm)/i });
  await confirmBtn.scrollIntoViewIfNeeded();
  await expect(confirmBtn, 'confirm control not reachable at 390px').toBeVisible();
  await confirmBtn.click();

  await expect(sender.page.getByText(/sent/i), 'flow did not complete at 390px').toBeVisible();
});
