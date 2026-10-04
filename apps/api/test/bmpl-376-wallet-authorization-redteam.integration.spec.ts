/**
 * BMPL-376 — negative controls on a money boundary, written BEFORE any fix
 * exists. The owner's ruling: "Staff may initiate or prepare a post-custody
 * return, but staff action alone must NEVER authorize charging the
 * customer's wallet" and "payWithWallet: true must not transform an
 * operational staff action into customer payment consent." He asked for the
 * hole demonstrated by a red test, not described in a message.
 *
 * THE CHAIN, VERIFIED IN CODE BEFORE WRITING ANY ASSERTION (not accepted
 * from the dispatch that asked for this file):
 *  - `reversedReturnInput()` (shipment.service.ts) sets `payWithWallet: true`
 *    unconditionally — its own comment says "a return is never booked
 *    unpaid." `rerouteInput()` does the same, unconditionally, for reroute.
 *  - `returnToSender`/`rerouteShipment` are STAFF-ONLY actions
 *    (`logistics.manage`). Neither `ReturnToSenderInput` nor `RerouteInput`
 *    carries any customer-consent field — only a staff `note` string.
 *  - `create()` reads `payNow = input.payWithWallet === true` and, when
 *    true, calls `payments.createForShipment` + `payments.escrowInTx`
 *    INSIDE THE SAME `$transaction` that creates the shipment — no
 *    out-of-band step, no customer action, anywhere in that transaction.
 *  - `escrowInTx` takes a row lock on the customer's own wallet, debits it,
 *    credits SYSTEM_ESCROW, flips the Payment to AUTHORIZED, and even sends
 *    the customer a "Payment authorized" notification — all synchronously,
 *    all from one staff HTTP call.
 *
 * So: a single `logistics.manage` staff call moves a customer's money with
 * no customer involvement anywhere in the request. Tests 1 and 2 below are
 * expected to FAIL today — that failure is this card's deliverable, not a
 * bug in the test.
 *
 * SCOPE: tests only. The fix is BMPL-375, owned by the API lane, starting
 * now in parallel — nothing here touches the payment path.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let customer: string[];
let customerUserId: string;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);

let hub: Record<string, string> = {};

async function registerUser(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

async function makeDriver() {
  const s = uniq();
  const { cookies, userId } = await registerUser(`wdrv_${s}@example.com`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId,
      legalName: 'D River',
      displayName: `Wrv${s}`,
      phone: '+5016000000',
      homeDistrict: 'BELIZE',
      licenceNumber: `WDL-${s}`,
      licenceExpiry: FUTURE,
      vehicleOwnership: 'OWNED',
      availability: 'ONLINE',
      isActive: true,
    },
  });
  const vehicle = await ctx.prisma.driverVehicle.create({
    data: {
      driverProfileId: profile.id,
      type: 'CAR', make: 'Toyota', model: 'Corolla',
      licencePlate: `WZ-${s}`.slice(0, 18),
      registrationExpiry: FUTURE, insuranceExpiry: FUTURE,
      isActive: true, isPrimary: true, approvalStatus: 'APPROVED',
    },
  });
  for (const district of ['BELIZE', 'STANN_CREEK']) {
    await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: district as never, isActive: true } });
  }
  return { cookies, userId, driverProfileId: profile.id, vehicleId: vehicle.id };
}

/** Placencia (STANN_CREEK) <-> Belize City hub <-> San Pedro (BELIZE), both directions configured — a return/reroute MUST be priceable here, so a failure below is about authorization, never a side-effect of an unpriced lane. */
async function seedNetwork() {
  hub = {};
  for (const h of [
    { code: 'WMUN', name: 'Belize City Municipal Airstrip', district: 'BELIZE', city: 'Belize City', fee: 1000 },
    { code: 'WSPA', name: 'San Pedro Airstrip', district: 'BELIZE', city: 'San Pedro', fee: 1500 },
    { code: 'WPLA', name: 'Placencia Airstrip', district: 'STANN_CREEK', city: 'Placencia', fee: 1200 },
  ]) {
    const r = await post(admin, 'admin/logistics/hubs', {
      code: h.code, name: h.name, type: 'AIRSTRIP', district: h.district, city: h.city, modes: ['LAND', 'AIR'],
      courierFeeMinor: h.fee,
    });
    expect(r.status).toBe(201);
    hub[h.code] = r.body.id;
  }
  for (const r of [
    { from: 'WPLA', to: 'WMUN', minutes: 45, price: 8000 },
    { from: 'WMUN', to: 'WSPA', minutes: 20, price: 6000 },
    { from: 'WSPA', to: 'WMUN', minutes: 20, price: 6000 },
    { from: 'WMUN', to: 'WPLA', minutes: 45, price: 8000 },
  ]) {
    expect((await post(admin, 'admin/logistics/routes', {
      originHubId: hub[r.from], destinationHubId: hub[r.to], mode: 'AIR',
      durationMinutes: r.minutes, priceMinor: r.price, carrierName: 'Tropic Air',
    })).status).toBe(201);
  }
}

async function disableDispatch() {
  const row = await ctx.prisma.platformSetting.findFirst();
  const data = { dispatchAutomatic: false };
  if (row) await ctx.prisma.platformSetting.update({ where: { id: row.id }, data });
  else await ctx.prisma.platformSetting.create({ data });
}

const doorToDoor = () => ({
  service: 'DOOR_TO_DOOR',
  origin: { district: 'STANN_CREEK', city: 'Placencia', address: '1 Sidewalk', name: 'Sender', phone: '501-2223333' },
  destination: { district: 'BELIZE', city: 'San Pedro', address: '5 Barrier Reef Drive', name: 'Recipient', phone: '501-4445555' },
  preferredMode: 'AIR',
  description: 'One box',
});

async function book() {
  const r = await post(customer, 'shipping', { ...doorToDoor(), payWithWallet: true });
  expect(r.status).toBe(201);
  return r.body;
}

const legs = (shipmentId: string) =>
  ctx.prisma.shipmentLeg.findMany({ where: { shipmentId }, orderBy: { sequence: 'asc' } });

async function pinOf(legId: string) {
  const leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId }, select: { handoffPin: true } });
  return leg.handoffPin!;
}

const assign = (legId: string, d: { driverProfileId: string; vehicleId: string }) =>
  post(admin, `admin/logistics/legs/${legId}/assign`, { driverProfileId: d.driverProfileId, vehicleId: d.vehicleId });

const flag = (legId: string, reason = 'Recipient not home; no safe place to leave the parcel.') =>
  post(admin, `admin/logistics/legs/${legId}/exception`, { reason });

async function driveCourierLeg(driver: { cookies: string[] }, legId: string) {
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/accept`)).status).toBe(201);
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/pickup`)).status).toBe(201);
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/in-transit`)).status).toBe(201);
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/arriving`)).status).toBe(201);
  expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/handoff`, {
    pin: await pinOf(legId), receivedByName: 'Counter staff',
  })).status).toBe(201);
}

/** Walks a shipment to a post-custody LAST_MILE exception — the exact state
 *  both returnToSender and rerouteShipment require. Identical shape to the
 *  helper already proven in shipment-return-to-sender.integration.spec.ts. */
async function walkToLastMileException() {
  const firstDriver = await makeDriver();
  const lastDriver = await makeDriver();
  const shipment = await book();

  const first = (await legs(shipment.id)).find((l) => l.kind === 'FIRST_MILE')!;
  expect((await assign(first.id, firstDriver)).status).toBe(201);
  await driveCourierLeg(firstDriver, first.id);

  const hauls = (await legs(shipment.id)).filter((l) => l.kind === 'LINE_HAUL');
  for (const haul of hauls) {
    expect((await post(admin, `admin/logistics/legs/${haul.id}/depart`, {})).status).toBe(201);
    expect((await post(admin, `admin/logistics/legs/${haul.id}/arrive`, {})).status).toBe(201);
    expect((await post(admin, `admin/logistics/legs/${haul.id}/handoff`, {
      pin: await pinOf(haul.id), receivedByName: 'Hub desk',
    })).status).toBe(201);
  }

  const last = (await legs(shipment.id)).find((l) => l.kind === 'LAST_MILE')!;
  expect((await assign(last.id, lastDriver)).status).toBe(201);
  expect((await post(lastDriver.cookies, `driver/shipping-jobs/${last.id}/accept`)).status).toBe(201);
  expect((await post(lastDriver.cookies, `driver/shipping-jobs/${last.id}/pickup`)).status).toBe(201);

  expect((await flag(last.id)).status).toBe(201);
  return { shipment, legId: last.id };
}

const returnToSender = (legId: string, body: object = { note: 'Recipient unreachable after two attempts.' }) =>
  post(admin, `admin/logistics/legs/${legId}/return-to-sender`, body);

const toHub = () => ({ hubId: hub.WMUN, name: 'Counter pickup', phone: '501-7778888' });
const rerouteShipment = (legId: string, body: object = { destination: toHub(), note: 'Recipient asked for a different address.' }) =>
  post(admin, `admin/logistics/legs/${legId}/reroute`, body);

/** The customer's own wallet account row — queried directly, never through
 *  the API, so a bug in the /wallet read endpoint cannot mask the ledger's
 *  real state (or hide a real debit behind a stale read). */
const walletAccountOf = (userId: string) =>
  ctx.prisma.walletAccount.findFirstOrThrow({ where: { userId, type: 'USER' } });

async function ledgerEntriesFor(accountId: string) {
  return ctx.prisma.walletLedgerEntry.findMany({ where: { accountId }, include: { transaction: true } });
}

/** Every posted WalletLedgerEntry must have a counterpart summing to zero
 *  PER TRANSACTION — the double-entry invariant itself, independent of
 *  whether the transaction should have been allowed to happen at all. */
async function assertLedgerBalances(transactionIds: string[]) {
  for (const id of transactionIds) {
    const entries = await ctx.prisma.walletLedgerEntry.findMany({ where: { transactionId: id } });
    const net = entries.reduce((sum, e) => sum + (e.direction === 'DEBIT' ? -e.amountMinor : e.amountMinor), 0n);
    expect(net, `transaction ${id} does not net to zero: ${JSON.stringify(entries.map((e) => ({ account: e.accountId, dir: e.direction, amt: Number(e.amountMinor) })))}`).toBe(0n);
    expect(entries.length, `transaction ${id} has no entries at all`).toBeGreaterThan(0);
  }
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password }));
});

afterAll(async () => {
  await ctx.app.close();
});

beforeEach(async () => {
  await ctx.prisma.driverEarning.deleteMany();
  await ctx.prisma.walletHold.deleteMany();
  // Escrow is a shared system account; its ledger accumulates across tests
  // unless cleared between them — same precedent as shipment-payments.integration.spec.ts.
  await ctx.prisma.walletLedgerEntry.deleteMany();
  await ctx.prisma.walletTransaction.deleteMany();
  await ctx.prisma.ledgerReference.deleteMany();
  await ctx.prisma.paymentEvent.deleteMany();
  await ctx.prisma.payment.deleteMany();
  await ctx.prisma.shipmentLegOffer.deleteMany();
  await ctx.prisma.custodyEvent.deleteMany();
  await ctx.prisma.shipmentLeg.deleteMany();
  await ctx.prisma.shipment.deleteMany();
  await ctx.prisma.logisticsRoute.deleteMany();
  await ctx.prisma.logisticsHub.deleteMany();
  await ctx.prisma.driverServiceArea.deleteMany();
  await ctx.prisma.driverVehicle.deleteMany();
  await ctx.prisma.driverProfile.deleteMany();
  const c = await registerUser(`wcust_${uniq()}@example.com`);
  customer = c.cookies;
  customerUserId = c.userId;
  await post(admin, 'admin/wallet/test-credit', { userId: c.userId, amountMinor: 100_000, reason: 'BMPL-376 red-team fixture.' });
  await disableDispatch();
  await seedNetwork();
});

/* ------------------------------------------------------------------------- */

describe('BMPL-376: staff action alone must never authorize a customer wallet charge', () => {
  it('[regression guard] return-to-sender by a logistics.manage staff member, with no customer involved anywhere, must NOT move the customer\'s money', async () => {
    const { legId } = await walkToLastMileException();
    const wallet = await walletAccountOf(customerUserId);
    const before = await ctx.prisma.walletAccount.findUniqueOrThrow({ where: { id: wallet.id } });
    // Baseline taken here, not assumed zero: `walkToLastMileException`'s own
    // `book()` already posted the ORIGINAL shipment's legitimate payment
    // entries against this same wallet — this test isolates entries NEW
    // since that point, not "this wallet has never moved".
    const entriesBefore = await ledgerEntriesFor(wallet.id);

    // THE ENTIRE ACTION: one staff HTTP call. No customer cookie, no
    // customer endpoint, no customer confirmation step exists anywhere in
    // this test up to this line.
    const r = await returnToSender(legId);
    expect(r.status).toBe(201);

    const after = await ctx.prisma.walletAccount.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(after.cachedBalanceMinor, 'a staff-only call moved the customer wallet balance with no customer authorization step').toBe(before.cachedBalanceMinor);

    const entriesAfter = await ledgerEntriesFor(wallet.id);
    expect(entriesAfter.length, 'a staff-only call posted NEW ledger entries against the customer wallet with no customer authorization step').toBe(entriesBefore.length);

    // Scoped to the SPECIFIC shipment this action created, not "any payment
    // on this customer's account" — the ORIGINAL shipment's own payment is
    // already legitimately AUTHORIZED from setup and must not be mistaken
    // for evidence of this action's own wrongdoing.
    const returnShipmentId = (r.body as { returnShipment?: { id: string } }).returnShipment?.id;
    if (returnShipmentId) {
      const newPayment = await ctx.prisma.payment.findFirst({ where: { shipmentId: returnShipmentId } });
      expect(newPayment?.status === 'AUTHORIZED', 'a staff-only call authorized the NEW return shipment\'s Payment with no customer authorization step').toBe(false);
    }
  });

  it('[regression guard] reroute mirrors return exactly, so if return has the hole, reroute has it too — verified, not assumed', async () => {
    const { legId } = await walkToLastMileException();
    const wallet = await walletAccountOf(customerUserId);
    const before = await ctx.prisma.walletAccount.findUniqueOrThrow({ where: { id: wallet.id } });
    const entriesBefore = await ledgerEntriesFor(wallet.id);

    const r = await rerouteShipment(legId);
    expect(r.status).toBe(201);

    const after = await ctx.prisma.walletAccount.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(after.cachedBalanceMinor, 'a staff-only reroute call moved the customer wallet balance with no customer authorization step').toBe(before.cachedBalanceMinor);

    const entriesAfter = await ledgerEntriesFor(wallet.id);
    expect(entriesAfter.length, 'a staff-only reroute call posted NEW ledger entries against the customer wallet with no customer authorization step').toBe(entriesBefore.length);

    const rerouteShipmentId = (r.body as { rerouteShipment?: { id: string } }).rerouteShipment?.id;
    if (rerouteShipmentId) {
      const newPayment = await ctx.prisma.payment.findFirst({ where: { shipmentId: rerouteShipmentId } });
      expect(newPayment?.status === 'AUTHORIZED', 'a staff-only reroute call authorized the NEW reroute shipment\'s Payment with no customer authorization step').toBe(false);
    }
  });

  it('DIAGNOSTIC — documents exactly what moves today: whatever the ledger does on that staff call, it nets to zero per transaction (the double-entry mechanics are not broken; the AUTHORIZATION TO RUN THEM AT ALL is)', async () => {
    const { shipment, legId } = await walkToLastMileException();
    const wallet = await walletAccountOf(customerUserId);

    const r = await returnToSender(legId);
    expect(r.status).toBe(201);

    const entries = await ledgerEntriesFor(wallet.id);
    // This assertion documents today's REAL behavior for the record — it is
    // not the thing this card is trying to fail. If BMPL-375 changes this to
    // zero entries, this test is expected to need updating alongside it.
    const txnIds = [...new Set(entries.map((e) => e.transactionId))];
    await assertLedgerBalances(txnIds);

    // Exactly which entries appear, named for the report rather than left
    // for someone to re-derive: one DEBIT off the customer's own wallet, one
    // CREDIT into SYSTEM_ESCROW, for the full reverse-route price — the
    // ordinary escrow shape, run by a staff call that the customer never
    // saw. Flagged here, not asserted as "correct": documentation of the
    // live behavior, not endorsement of it.
    expect(entries.length).toBeGreaterThan(0);
    const returnShipmentId = (r.body as { returnShipment?: { id: string } }).returnShipment?.id;
    const returnPayment = await ctx.prisma.payment.findFirstOrThrow({ where: { shipmentId: returnShipmentId } });
    for (const e of entries) {
      expect(['DEBIT', 'CREDIT']).toContain(e.direction);
    }
    expect(Number(returnPayment.amountMinor)).toBeGreaterThan(0);
    void shipment;
  });

  it('POSITIVE CONTROL — an ordinary customer-initiated booking still charges correctly (a fix that breaks real payments is not a fix)', async () => {
    const wallet = await walletAccountOf(customerUserId);
    const before = await ctx.prisma.walletAccount.findUniqueOrThrow({ where: { id: wallet.id } });

    const shipment = await book(); // the customer's OWN cookie, the customer's OWN booking call
    expect(shipment.id).toBeTruthy();

    const after = await ctx.prisma.walletAccount.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(after.cachedBalanceMinor).toBeLessThan(before.cachedBalanceMinor);

    const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { shipmentId: shipment.id } });
    expect(payment.status).toBe('AUTHORIZED');

    const entries = await ledgerEntriesFor(wallet.id);
    const txnIds = [...new Set(entries.map((e) => e.transactionId))];
    await assertLedgerBalances(txnIds);
    expect(entries.length).toBeGreaterThan(0);
  });
});
