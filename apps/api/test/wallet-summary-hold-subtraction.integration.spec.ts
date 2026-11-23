/**
 * WALLET-P2P-LEDGER-INTEGRITY follow-up (god, 2026-11-23T22-33).
 *
 * A fact about MAIN as it stands today, independent of the in-flight P2P
 * transfer feature: does `WalletService.summary()`
 * (apps/api/src/wallet/wallet.service.ts:510) subtract an ACTIVE (HELD)
 * `WalletHold` when it reports what a customer can spend?
 *
 * Why this matters right now: god told Pam to debit AVAILABLE balance, not
 * raw ledger balance, when building the transfer — a transfer that spends
 * money an escrow hold is counting on strands that payment, and the floor
 * has live evidence this happens (Stanley is sitting on three stranded
 * holds). Whether `summary()` already does that subtraction is a
 * pre-existing fact about main, not about the transfer feature, so it is
 * established here, separately, by someone not building the transfer.
 *
 * Method: fund a wallet via the real top-up endpoint, place a REAL HELD hold
 * against part of it by checking out an order (the same path
 * `wallet-authorization.integration.spec.ts` uses, stopping BEFORE calling
 * `authorize` so the hold stays HELD rather than becoming AUTHORIZED), then
 * read `GET /api/wallet` (summary) and compare it to the raw ledger sum read
 * directly from `WalletLedgerEntry`.
 *
 * Tests only. No production writes, no real money (WALLET_MONEY_MOVEMENT_ENABLED
 * stays false), isolated local DB. Funding exclusively via the existing
 * test-credit path (admin/users/test-flag + POST wallet/top-up) — never a
 * direct balance write.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let categoryId: string;
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);

async function registerCustomer(email: string) {
  const reg = await request(ctx.server).post('/api/auth/register').send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id, email };
}

/** A customer an administrator has designated as a simulation account — the only way to unlock wallet funding. */
async function makeTestCustomer(label: string) {
  const c = await registerCustomer(`hold_${label}_${uniq()}@example.com`);
  const r = await post(admin, 'admin/users/test-flag', { userId: c.userId, isTest: true, reason: 'WALLET-P2P-LEDGER-INTEGRITY follow-up: summary() hold subtraction.' });
  expect(r.status).toBe(201);
  return c;
}

/** Fund via the EXISTING test-credit path — never a direct balance write. */
async function fund(cookies: string[], amountMinor: number) {
  const r = await post(cookies, 'wallet/top-up', { amountMinor });
  expect(r.status).toBe(201);
}

async function makeVendor(label: string) {
  const s = uniq();
  const v = await registerCustomer(`hold_vendor_${label}_${s}@example.com`);
  await ctx.prisma.userRole.create({ data: { userId: v.userId, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });
  const profile = await post(v.cookies, 'vendor/profile', { businessName: `HoldShop ${s}`, contactEmail: v.email });
  await post(v.cookies, 'vendor/profile/submit');
  await post(admin, `admin/vendors/${profile.body.profile.id}/approve`, {});
  await request(ctx.server).patch('/api/vendor/profile').set('Cookie', v.cookies).send({ storeStatus: 'OPEN' });
  return { cookies: v.cookies, vpId: profile.body.profile.id as string };
}

async function createProduct(cookies: string[], priceMinor: number) {
  const s = uniq();
  const res = await post(cookies, 'vendor/products', { categoryId, title: `Held ${s}`, sku: `HELD-${s}`, priceMinor });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

const setStock = (cookies: string[], productId: string, delta: number) =>
  post(cookies, `vendor/products/${productId}/inventory/adjust`, { delta, reason: 'RESTOCK' });

/** Raw ledger sum — the source of truth, independent of summary()'s own arithmetic. */
async function rawLedgerBalance(accountId: string): Promise<bigint> {
  const rows = await ctx.prisma.walletLedgerEntry.findMany({ where: { accountId }, select: { direction: true, amountMinor: true } });
  return rows.reduce((s, e) => s + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor), 0n);
}

const walletOf = (userId: string) => ctx.prisma.walletAccount.findFirstOrThrow({ where: { userId, type: 'USER', currency: 'BZD' } });

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password }).then((r) => cookiesOf(r));
  const cat = await post(admin, 'admin/categories', { name: 'Held' });
  categoryId = cat.body.id;
});
afterAll(async () => {
  await ctx.app.close();
});

describe('WALLET-P2P-LEDGER-INTEGRITY follow-up: does summary() subtract an active HELD hold?', () => {
  it('HELD/VIOLATED: summary().availableMinor vs raw ledger balance, with a real HELD hold in place', async () => {
    const customer = await makeTestCustomer('summary1');
    await fund(customer.cookies, 60_00); // BZ$60.00
    const vendor = await makeVendor('summary1');
    const productId = await createProduct(vendor.cookies, 35_00); // BZ$35.00
    await setStock(vendor.cookies, productId, 5);

    await post(customer.cookies, 'cart/items', { productId, quantity: 1 }).expect(201);
    // Matches wallet-authorization.integration.spec.ts's own checkout(customer)
    // call exactly (empty body) — that suite's vendor fixture is built the
    // same way (API profile create + submit + admin approve + storeStatus
    // OPEN), with no vendors[]/deliveryAddress needed.
    const checkoutRes = await post(customer.cookies, 'checkout', {});
    if (checkoutRes.status !== 201) console.log('[DEBUG] checkout failed:', JSON.stringify(checkoutRes.body));
    expect(checkoutRes.status).toBe(201);

    const wallet = await walletOf(customer.userId);
    const payment = (await get(customer.cookies, 'payments').expect(200)).body[0];
    expect(payment).toBeTruthy();

    // Confirm, directly against the row, that this is a real HELD hold for the
    // full order amount — not assumed from the endpoint's 201 alone.
    const hold = await ctx.prisma.walletHold.findFirstOrThrow({ where: { paymentId: payment.id } });
    expect(hold.status).toBe('HELD');
    expect(hold.amountMinor).toBe(3500n);

    // THE MEASUREMENT.
    const raw = await rawLedgerBalance(wallet.id);
    const summaryRes = await get(customer.cookies, 'wallet').expect(200);
    const { availableMinor, onHoldMinor, totalMinor } = summaryRes.body;

    console.log(
      `[WALLET-P2P-LEDGER-INTEGRITY follow-up] rawLedgerBalanceMinor=${raw} ` +
        `holdAmountMinor=${hold.amountMinor} summary={availableMinor:${availableMinor},onHoldMinor:${onHoldMinor},totalMinor:${totalMinor}}`,
    );

    // The HELD hold has NOT touched the ledger (per the schema's own comment on
    // WalletHold: "does NOT create a ledger entry and does NOT change the
    // wallet balance"), so raw ledger balance must still be the full funded
    // amount — this is the baseline the subtraction is measured against, not
    // itself the thing being verified.
    expect(raw).toBe(6000n);

    // THE VERDICT: if summary() subtracts the active HELD hold,
    // availableMinor == raw - holdAmount == 2500. If it does NOT subtract it
    // (the pre-existing defect god asked me to check for), availableMinor ==
    // raw == 6000 — a customer would be shown money as spendable that is
    // already committed to an order in flight.
    const holdAmount = Number(hold.amountMinor);
    const expectedIfSubtracted = Number(raw) - holdAmount;
    if (availableMinor === expectedIfSubtracted) {
      console.log('[WALLET-P2P-LEDGER-INTEGRITY follow-up] VERDICT: HELD — summary() subtracts the active HELD hold.');
    } else if (availableMinor === Number(raw)) {
      console.log('[WALLET-P2P-LEDGER-INTEGRITY follow-up] VERDICT: VIOLATED — summary() does NOT subtract the active HELD hold.');
    } else {
      console.log(`[WALLET-P2P-LEDGER-INTEGRITY follow-up] VERDICT: UNEXPECTED — availableMinor=${availableMinor} matches neither prediction.`);
    }

    // Asserted as the real claim, not left to the console log alone: this is
    // what makes the run itself fail loudly if the answer is VIOLATED or
    // UNEXPECTED, rather than requiring someone to read stdout to find out.
    expect(availableMinor, `raw=${raw}, holdAmount=${holdAmount}, onHoldMinor=${onHoldMinor}, totalMinor=${totalMinor}`).toBe(expectedIfSubtracted);
    expect(onHoldMinor).toBe(holdAmount);
    expect(totalMinor).toBe(Number(raw)); // nothing has left the ledger yet — the hold is soft
  });
});
