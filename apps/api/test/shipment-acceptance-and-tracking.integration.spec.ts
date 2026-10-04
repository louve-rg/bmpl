/**
 * Edward req 10 rule 2 (a courier accepting a job is not custody, so a customer
 * cancelling in between still gets the full amount back) and req 7 (the public
 * tracking payload never carries a courier conversation id).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';
import { ShipmentDispatchService } from '../src/shipping/shipment-dispatch.service';

let ctx: TestContext;
let dispatch: ShipmentDispatchService;
let admin: string[];
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);

const localParcel = () => ({
  service: 'DOOR_TO_DOOR',
  origin: { district: 'BELIZE', city: 'Belize City', address: '5 Barrack Road', name: 'Sender', phone: '501-222-3333' },
  destination: { district: 'BELIZE', city: 'Belize City', address: '18 Newtown Barracks', name: 'Recipient', phone: '501-444-5555' },
  description: 'Documents',
  pieces: 1,
});

async function registerUser(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

async function fundedCustomer(amountMinor: number) {
  const { cookies, userId } = await registerUser(`cust_${uniq()}@example.com`);
  const credit = await post(admin, 'admin/wallet/test-credit', { userId, amountMinor, reason: 'Acceptance and tracking tests.' });
  expect(credit.status).toBe(201);
  return { cookies, userId };
}

/** An approved, online driver serving Belize City. */
async function makeCourier() {
  const s = uniq();
  const { cookies, userId } = await registerUser(`courier_${s}@example.com`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId, isTest: false, legalName: 'D River', displayName: `Drv${s}`, phone: '+5016000000',
      homeDistrict: 'BELIZE', licenceNumber: `HDL-${s}`, licenceExpiry: FUTURE,
      vehicleOwnership: 'OWNED', availability: 'ONLINE', isActive: true,
    },
  });
  await ctx.prisma.driverVehicle.create({
    data: {
      driverProfileId: profile.id, type: 'CAR', make: 'Toyota', model: 'Corolla',
      licencePlate: `HV-${s}`.slice(0, 18), registrationExpiry: FUTURE, insuranceExpiry: FUTURE,
      isActive: true, isPrimary: true, approvalStatus: 'APPROVED',
    },
  });
  await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: 'BELIZE', isActive: true } });
  return { cookies, userId };
}

async function bookPaid(customer: string[]) {
  const r = await post(customer, 'shipping', { ...localParcel(), payWithWallet: true });
  expect(r.status).toBe(201);
  return r.body as { id: string; reference: string; recipientTrackingToken: string };
}

const legOf = async (shipmentId: string) =>
  ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId }, orderBy: { sequence: 'asc' } });

/** Offers the leg to the courier and has them accept it. Acceptance writes no custody row. */
async function courierAccepts(legId: string, courier: string[]) {
  await dispatch.dispatchLeg(legId);
  expect((await post(courier, `driver/shipping-jobs/${legId}/accept`)).status).toBe(201);
}

const custodyTransfers = (shipmentId: string) =>
  ctx.prisma.custodyEvent.count({ where: { shipmentId, fromHolder: { not: null } } });

const balanceOf = async (customer: string[]) =>
  (await get(customer, 'wallet')).body as { availableMinor: number; onHoldMinor: number };

/** Without a configured local courier price every booking is refused with a 400. */
async function setLocalCourierFee(feeMinor: number) {
  const r = await request(ctx.server)
    .patch('/api/admin/ops/settings')
    .set('Cookie', admin)
    .send({ localCourierFeeMinor: feeMinor, localCourierFeeTestMinor: feeMinor, localCourierMinutes: 60 });
  expect(r.status).toBe(200);
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password }));
  dispatch = ctx.app.get(ShipmentDispatchService);
  await setLocalCourierFee(1500);
});

afterAll(async () => {
  await ctx.app.close();
});

describe('acceptance is not custody (req 10, rule 2)', () => {
  it('a customer cancelling after courier acceptance but before custody gets every shilling back and no custody row exists', async () => {
    const customer = await fundedCustomer(10_000);
    const shipment = await bookPaid(customer.cookies);
    const leg = await legOf(shipment.id);
    const courier = await makeCourier();
    await courierAccepts(leg.id, courier.cookies);
    expect((await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: leg.id } })).courierStatus).toBe('DRIVER_ACCEPTED');

    const cancel = await post(customer.cookies, `shipping/${shipment.id}/cancel`, { reason: 'Changed my mind after a driver accepted.' });
    expect(cancel.status).toBe(201);

    const after = await balanceOf(customer.cookies);
    expect(after.availableMinor).toBe(10_000);
    expect(after.onHoldMinor).toBe(0);
    expect(await custodyTransfers(shipment.id)).toBe(0);
  });

  it('once a real custody transfer has happened, the same customer cancel is refused and the fee is not given back', async () => {
    const customer = await fundedCustomer(10_000);
    const shipment = await bookPaid(customer.cookies);
    const leg = await legOf(shipment.id);
    const courier = await makeCourier();
    await courierAccepts(leg.id, courier.cookies);
    expect((await post(admin, `admin/logistics/legs/${leg.id}/start`)).status).toBe(201);
    expect(await custodyTransfers(shipment.id)).toBe(1);

    const before = await balanceOf(customer.cookies);
    const cancel = await post(customer.cookies, `shipping/${shipment.id}/cancel`, { reason: 'Too late now.' });
    expect(cancel.status).toBe(400);

    const after = await balanceOf(customer.cookies);
    expect(after.availableMinor).toBe(before.availableMinor);
    expect(after.onHoldMinor).toBe(before.onHoldMinor);
  });
});

describe('the public tracking payload carries no courier conversation (req 7)', () => {
  it('a token holder sees no conversation id, even when a courier has accepted and the conversation is open', async () => {
    const customer = await fundedCustomer(10_000);
    const shipment = await bookPaid(customer.cookies);
    const leg = await legOf(shipment.id);
    const courier = await makeCourier();
    await courierAccepts(leg.id, courier.cookies);

    const conversation = await ctx.prisma.conversation.findFirst({ where: { contextType: 'SHIPMENT_LEG', contextId: leg.id } });
    expect(conversation).not.toBeNull();

    const track = await request(ctx.server).get(`/api/shipping/track/${shipment.recipientTrackingToken}`);
    expect(track.status).toBe(200);
    const body = JSON.stringify(track.body);
    expect(body).not.toContain('conversationId');
    expect(body).not.toContain(conversation!.id);
  });
});
