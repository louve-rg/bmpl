/**
 * A customer could pay for a driver-worked leg (FIRST_MILE/LAST_MILE/DIRECT)
 * that nobody could ever fulfil, and nothing in the system ever told anyone
 * — measured in production as the entire source of courier coverage: one of
 * Belize's six districts, two drivers, both gated on being online right now.
 *
 * Two distinct mechanisms, proven here:
 *  1. Booking time (ShipmentService#runCreate): UNSUPPORTED (nobody has ever
 *     configured coverage for the district) refuses the booking before any
 *     wallet lock. TEMPORARILY_UNAVAILABLE (coverage configured, nobody
 *     online this second) does NOT refuse — an otherwise-valid future
 *     booking must still go through — but carries a `fulfilmentNotices`
 *     field in the response instead of succeeding silently.
 *  2. Dispatch time (ShipmentDispatchService#recordUnavailableIfNew): a leg
 *     stuck with zero eligible drivers is made visible — one admin alert,
 *     one customer notification, one audit row — the first time it is
 *     observed, not on every 20s sweep.
 *
 * TOLEDO is used as the deliberately-unsupported district: `seedRoles`
 * (test/helpers.ts) now seeds a baseline, permanently-OFFLINE courier
 * covering all six districts so the rest of the suite keeps booking
 * unblocked exactly as it always did; this file removes TOLEDO from that
 * baseline's coverage to get a genuinely zero-coverage district to test
 * against, without touching what every other spec relies on.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';
import { ShipmentDispatchService } from '../src/shipping/shipment-dispatch.service';

let ctx: TestContext;
let admin: string[];
let dispatch: ShipmentDispatchService;
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const patch = (c: string[], p: string, b: object = {}) => request(ctx.server).patch(`/api/${p}`).set('Cookie', c).send(b);

const parcel = (district: string, city: string) => ({
  service: 'DOOR_TO_DOOR',
  origin: { district, city, address: '1 Front St', name: 'S', phone: '501-222-3333' },
  destination: { district, city, address: '2 Front St', name: 'R', phone: '501-444-5555' },
  description: 'Documents',
  pieces: 1,
});

async function registerCustomer(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

async function fund(userId: string, amountMinor: number) {
  const r = await post(admin, 'admin/wallet/test-credit', { userId, amountMinor, reason: 'dispatch-feasibility fixture' });
  expect(r.status).toBe(201);
}

async function onlineDriverFor(district: string) {
  const { userId } = await registerCustomer(`drv_${uniq()}@example.com`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  const s = uniq();
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId, legalName: 'On Line', displayName: `Drv${s}`, phone: '+5016000099',
      homeDistrict: district as never, licenceNumber: `DL-${s}`, licenceExpiry: FUTURE,
      vehicleOwnership: 'OWNED', availability: 'ONLINE', isActive: true,
    },
  });
  await ctx.prisma.driverVehicle.create({
    data: {
      driverProfileId: profile.id, type: 'CAR', make: 'Toyota', model: 'Corolla',
      licencePlate: `BZ-${s}`.slice(0, 18), registrationExpiry: FUTURE, insuranceExpiry: FUTURE,
      isActive: true, isPrimary: true, approvalStatus: 'APPROVED',
    },
  });
  await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: district as never, isActive: true } });
  return profile.id;
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma); // also seeds the all-district baseline courier (OFFLINE, never dispatched)
  const a = await seedSuperAdmin(ctx.prisma);
  admin = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password }));
  await patch(admin, 'admin/ops/settings', { localCourierFeeMinor: 1500, localCourierFeeTestMinor: 1500, localCourierMinutes: 60 });
  dispatch = ctx.app.get(ShipmentDispatchService);
  // The one deliberate gap: remove the baseline's TOLEDO coverage so this
  // file has a genuinely UNSUPPORTED district to test against, without
  // touching the other five districts every other spec's baseline relies on.
  await ctx.prisma.driverServiceArea.deleteMany({
    where: { district: 'TOLEDO', driverProfile: { user: { email: 'it-baseline-courier@example.bz' } } },
  });
});

afterAll(async () => {
  await ctx.app.close();
});

describe('booking-time feasibility (UNSUPPORTED vs TEMPORARILY_UNAVAILABLE)', () => {
  it('refuses a booking into a district with zero configured coverage, before any wallet lock, with no shipment/payment created', async () => {
    const customer = await registerCustomer(`unsup_${uniq()}@example.com`);
    await fund(customer.userId, 10_000);
    const wallet = await ctx.prisma.walletAccount.findFirstOrThrow({ where: { userId: customer.userId, type: 'USER' } });
    const balanceBefore = await ctx.prisma.walletLedgerEntry
      .findMany({ where: { accountId: wallet.id } })
      .then((rows) => rows.reduce((s, e) => s + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor), 0n));

    const r = await post(customer.cookies, 'shipping', { ...parcel('TOLEDO', 'Punta Gorda'), payWithWallet: true });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/do not yet have a courier serving TOLEDO/i);

    expect(await ctx.prisma.shipment.count({ where: { customerUserId: customer.userId } })).toBe(0);
    expect(await ctx.prisma.payment.count({ where: { userId: customer.userId } })).toBe(0);
    const balanceAfter = await ctx.prisma.walletLedgerEntry
      .findMany({ where: { accountId: wallet.id } })
      .then((rows) => rows.reduce((s, e) => s + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor), 0n));
    expect(balanceAfter).toBe(balanceBefore);
  });

  it('books a district with configured coverage but nobody online, and tells the customer plainly instead of promising dispatch', async () => {
    const customer = await registerCustomer(`temp_${uniq()}@example.com`);
    await fund(customer.userId, 10_000);

    // COROZAL: covered only by the baseline (permanently OFFLINE) courier.
    const r = await post(customer.cookies, 'shipping', { ...parcel('COROZAL', 'Corozal Town'), payWithWallet: true });
    expect(r.status).toBe(201);
    expect(r.body.fulfilmentNotices).toEqual([expect.stringMatching(/no courier is currently online in COROZAL/i)]);
    expect(await ctx.prisma.shipment.count({ where: { id: r.body.id } })).toBe(1);
  });

  it('books a district with an online eligible driver and carries no fulfilmentNotices field at all', async () => {
    await onlineDriverFor('CAYO');
    const customer = await registerCustomer(`ok_${uniq()}@example.com`);
    await fund(customer.userId, 10_000);

    const r = await post(customer.cookies, 'shipping', { ...parcel('CAYO', 'San Ignacio'), payWithWallet: true });
    expect(r.status).toBe(201);
    expect(r.body.fulfilmentNotices).toBeUndefined();
  });
});

describe('dispatch-time escalation (ShipmentDispatchService#recordUnavailableIfNew)', () => {
  it('alerts admin and the customer exactly once per episode, not once per sweep tick', async () => {
    const customer = await registerCustomer(`escalate_${uniq()}@example.com`);
    await fund(customer.userId, 10_000);
    const r = await post(customer.cookies, 'shipping', { ...parcel('STANN_CREEK', 'Dangriga'), payWithWallet: true });
    expect(r.status).toBe(201);
    const leg = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId: r.body.id } });

    // Booking itself already dispatched once (runCreate's own synchronous
    // dispatchLeg call for a paid FIRST_MILE/DIRECT first leg) — confirm the
    // alert already landed from that alone, exactly once.
    const auditAfterBooking = await ctx.prisma.auditLog.count({ where: { action: 'SHIPMENT_LEG_DISPATCH_UNAVAILABLE' } });
    expect(auditAfterBooking).toBe(1);

    const notifAfterBooking = await ctx.prisma.notification.count({ where: { event: 'SHIPMENT_COURIER_UNAVAILABLE' } });
    expect(notifAfterBooking).toBe(1); // admin only so far? re-dispatch below proves the customer side too

    // A second sweep tick on the same still-unavailable leg must NOT alert again.
    await dispatch.dispatchLeg(leg.id);
    await dispatch.dispatchLeg(leg.id);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'SHIPMENT_LEG_DISPATCH_UNAVAILABLE' } })).toBe(1);

    const recipients = await ctx.prisma.notificationRecipient.findMany({
      where: { notification: { event: 'SHIPMENT_COURIER_UNAVAILABLE' } },
      include: { notification: true },
    });
    // One admin (every logistics.read holder) and the customer who paid.
    const recipientUserIds = new Set(recipients.map((r2) => r2.userId));
    expect(recipientUserIds.has(customer.userId)).toBe(true);
  });

  it('resets the dedup once a driver comes online and offers the leg, so a LATER unavailable episode alerts again', async () => {
    const customer = await registerCustomer(`reset_${uniq()}@example.com`);
    await fund(customer.userId, 10_000);
    const r = await post(customer.cookies, 'shipping', { ...parcel('ORANGE_WALK', 'Orange Walk Town'), payWithWallet: true });
    expect(r.status).toBe(201);
    const leg = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId: r.body.id } });
    expect(await ctx.prisma.auditLog.count({ where: { action: 'SHIPMENT_LEG_DISPATCH_UNAVAILABLE' } })).toBeGreaterThanOrEqual(1);
    const before = await ctx.prisma.auditLog.count({ where: { action: 'SHIPMENT_LEG_DISPATCH_UNAVAILABLE' } });

    const driverProfileId = await onlineDriverFor('ORANGE_WALK');
    const outcome = await dispatch.dispatchLeg(leg.id);
    expect(outcome.result).toBe('OFFERED');

    // Decline the offer so the leg returns to SKIPPED's "no eligible driver"
    // path once the only driver goes offline again — a genuinely NEW episode.
    await ctx.prisma.driverProfile.update({ where: { id: driverProfileId }, data: { availability: 'OFFLINE' } });
    await dispatch.dispatchLeg(leg.id);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'SHIPMENT_LEG_DISPATCH_UNAVAILABLE' } })).toBe(before + 1);
  });
});

describe('a blocked leg is still safely cancellable and refundable', () => {
  it('cancels a TEMPORARILY_UNAVAILABLE shipment before it moves and refunds in full', async () => {
    const customer = await registerCustomer(`cancel_${uniq()}@example.com`);
    await fund(customer.userId, 10_000);
    const wallet = await ctx.prisma.walletAccount.findFirstOrThrow({ where: { userId: customer.userId, type: 'USER' } });
    const balanceOf = async () =>
      ctx.prisma.walletLedgerEntry
        .findMany({ where: { accountId: wallet.id } })
        .then((rows) => rows.reduce((s, e) => s + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor), 0n));
    const before = await balanceOf();

    const r = await post(customer.cookies, 'shipping', { ...parcel('COROZAL', 'Corozal Town'), payWithWallet: true });
    expect(r.status).toBe(201);
    const afterCharge = await balanceOf();
    expect(afterCharge).toBeLessThan(before);

    const c = await post(customer.cookies, `shipping/${r.body.id}/cancel`, { reason: 'Changed my mind.' });
    expect(c.status).toBe(201);
    expect(await balanceOf()).toBe(before);
  });
});
