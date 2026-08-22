/**
 * The multimodal engine, proven over a SIMULATION network.
 *
 * Production has no terminals and no lanes, and inventing real ones would put
 * fictional BML services in front of real customers. So this builds a network
 * marked `isTest`, which the planner only offers to designated test accounts,
 * and drives a parcel across it:
 *
 *   door → first-mile courier → origin terminal → flight → destination terminal
 *        → last-mile courier → door
 *
 * as one customer booking, paid once, with the invariant that no driver can
 * collect a parcel that has not reached them yet.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let customer: string[];
let customerId: string;
let hub: { BZE: string; SPR: string };
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);

/** Belize City to San Pedro — a real pair of places, an invented network. */
const crossWater = (over: Record<string, unknown> = {}) => ({
  service: 'DOOR_TO_DOOR',
  origin: { district: 'BELIZE', city: 'Belize City', address: '5 Barrack Road', name: 'Sender', phone: '501-222-3333' },
  destination: { district: 'BELIZE', city: 'San Pedro', address: '2 Coconut Drive', name: 'Recipient', phone: '501-444-5555' },
  description: 'Documents',
  pieces: 1,
  ...over,
});

async function registerCustomer(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

/** An approved, online, TEST driver serving one district. */
async function makeTestDriver(district: string) {
  const email = `simdrv_${uniq()}@example.com`;
  const { cookies, userId } = await registerCustomer(email);
  await ctx.prisma.userRole.create({ data: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() } });
  const future = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  const tag = uniq().slice(-6);
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId,
      isTest: true,
      legalName: 'Sim Driver',
      displayName: `Sim${tag}`,
      phone: '+5016000000',
      homeDistrict: district as never,
      licenceNumber: `SIM-${tag}`,
      licenceExpiry: future,
      vehicleOwnership: 'OWNED',
      availability: 'ONLINE',
      isActive: true,
    },
  });
  await ctx.prisma.driverVehicle.create({
    data: {
      driverProfileId: profile.id,
      type: 'CAR',
      make: 'Toyota',
      model: 'Hilux',
      licencePlate: `SIM-${tag}`.slice(0, 18),
      registrationExpiry: future,
      insuranceExpiry: future,
      isActive: true,
      isPrimary: true,
      approvalStatus: 'APPROVED',
    },
  });
  await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: district as never, isActive: true } });
  return { cookies, userId, driverProfileId: profile.id };
}

/**
 * A simulation network: two invented terminals and the lanes between them.
 *
 * Every row is marked TEST, so none of it is reachable by a real customer. The
 * names say so too, because a row that is only safe as long as somebody
 * remembers what it is for is not safe.
 */
async function seedSimulationNetwork() {
  const bze = await ctx.prisma.logisticsHub.create({
    data: {
      code: `TEST-BZE-${uniq().slice(-4)}`,
      name: 'TEST Belize City Terminal (simulation)',
      type: 'BMPL_HUB',
      district: 'BELIZE',
      city: 'Belize City',
      addressLine1: '1 Simulation Way',
      modes: ['LAND', 'AIR', 'SEA'],
      isActive: true,
      isTest: true,
      courierFeeMinor: 800n,
      latitude: 17.4995,
      longitude: -88.1976,
    },
  });
  const spr = await ctx.prisma.logisticsHub.create({
    data: {
      code: `TEST-SPR-${uniq().slice(-4)}`,
      name: 'TEST San Pedro Terminal (simulation)',
      type: 'AIRSTRIP',
      district: 'BELIZE',
      city: 'San Pedro',
      addressLine1: '1 Simulation Strip',
      modes: ['AIR', 'SEA'],
      isActive: true,
      isTest: true,
      courierFeeMinor: 900n,
      latitude: 17.9139,
      longitude: -87.9656,
    },
  });

  const lane = (originHubId: string, destinationHubId: string, mode: 'LAND' | 'AIR' | 'SEA', priceMinor: bigint, durationMinutes: number) =>
    ctx.prisma.logisticsRoute.create({
      data: { originHubId, destinationHubId, mode, priceMinor, durationMinutes, isActive: true, isTest: true },
    });

  // Air is quicker and dearer; sea is slower and cheaper. Best Available should
  // be able to tell them apart rather than taking whichever was configured first.
  await lane(bze.id, spr.id, 'AIR', 6000n, 20);
  await lane(spr.id, bze.id, 'AIR', 6000n, 20);
  await lane(bze.id, spr.id, 'SEA', 3000n, 90);
  await lane(spr.id, bze.id, 'SEA', 3000n, 90);

  return { BZE: bze.id, SPR: spr.id };
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
  await ctx.prisma.walletLedgerEntry.deleteMany();
  await ctx.prisma.walletTransaction.deleteMany();
  await ctx.prisma.ledgerReference.deleteMany();
  await ctx.prisma.paymentEvent.deleteMany();
  await ctx.prisma.payment.deleteMany();
  await ctx.prisma.custodyEvent.deleteMany();
  await ctx.prisma.shipmentLeg.deleteMany();
  await ctx.prisma.shipment.deleteMany();
  await ctx.prisma.logisticsRoute.deleteMany();
  await ctx.prisma.logisticsHub.deleteMany();

  const settings = await ctx.prisma.platformSetting.findFirst({ orderBy: { createdAt: 'asc' } });
  const data = { dispatchAutomatic: true, dispatchMaxConcurrentPerDriver: 5, localCourierFeeTestMinor: 1500n };
  if (settings) await ctx.prisma.platformSetting.update({ where: { id: settings.id }, data });
  else await ctx.prisma.platformSetting.create({ data });

  hub = await seedSimulationNetwork();

  // A designated test account, so the planner offers it the simulation network.
  const c = await registerCustomer(`simcust_${uniq()}@example.com`);
  customer = c.cookies;
  customerId = c.userId;
  await post(admin, 'admin/users/test-flag', { userId: customerId, isTest: true, reason: 'Multimodal simulation.' });
  await post(customer, 'wallet/top-up', { amountMinor: 100_000 });
});

const legsOf = (shipmentId: string) =>
  ctx.prisma.shipmentLeg.findMany({ where: { shipmentId }, orderBy: { sequence: 'asc' } });

/* ------------------------------------------------------------------------- */

describe('the simulation network is invisible to real customers', () => {
  it('a real customer is not routed over it, and is told plainly', async () => {
    const real = await registerCustomer(`realcust_${uniq()}@example.com`);
    const r = await post(real.cookies, 'shipping/quote', crossWater());
    expect(r.status).toBe(201);
    // No REAL terminal serves either end, because there are no real terminals.
    expect(r.body.available).toBe(false);
    expect(r.body.reason).toBe('NO_ORIGIN_HUB');
  });

  it('a real customer sees no transport modes from it', async () => {
    const modes = await request(ctx.server).get('/api/shipping/modes');
    expect(modes.body).toEqual([]);
  });
});

describe('Best Available actually evaluates the network', () => {
  it('picks the cheapest lane that can make the trip, not the first one configured', async () => {
    const r = await post(customer, 'shipping/quote', crossWater());
    expect(r.body.available).toBe(true);
    const haul = r.body.legs.find((l: { kind: string }) => l.kind === 'LINE_HAUL');
    // AIR was configured first and costs 6000; SEA costs 3000 and should win.
    expect(haul.mode).toBe('SEA');
  });

  it('follows the price when the cheap lane is withdrawn', async () => {
    // Proves it is reading the network rather than preferring a hard-coded mode.
    await ctx.prisma.logisticsRoute.updateMany({ where: { mode: 'SEA' }, data: { isActive: false } });
    const r = await post(customer, 'shipping/quote', crossWater());
    expect(r.body.available).toBe(true);
    expect(r.body.legs.find((l: { kind: string }) => l.kind === 'LINE_HAUL').mode).toBe('AIR');
  });

  it('honours an explicit choice of the dearer mode', async () => {
    const r = await post(customer, 'shipping/quote', crossWater({ preferredMode: 'AIR' }));
    expect(r.body.available).toBe(true);
    expect(r.body.legs.find((l: { kind: string }) => l.kind === 'LINE_HAUL').mode).toBe('AIR');
  });

  it('refuses a mode the network cannot fly, in words a customer can act on', async () => {
    await ctx.prisma.logisticsRoute.updateMany({ where: { mode: 'AIR' }, data: { isActive: false } });
    const r = await post(customer, 'shipping/quote', crossWater({ preferredMode: 'AIR' }));
    expect(r.body.available).toBe(false);
    expect(r.body.reason).toBe('MODE_UNAVAILABLE');
    expect(r.body.message).toMatch(/no air service/i);
    expect(r.body.message).not.toMatch(/undefined|null|MODE_UNAVAILABLE/);
  });

  it('refuses a road trip the network has no road for', async () => {
    // San Pedro's terminal takes air and sea, not road. The refusal names the
    // missing thing — a land terminal serving San Pedro — rather than silently
    // attaching the island address to the mainland terminal, which is what the
    // planner used to do and would have sent a driver on an impossible trip.
    const r = await post(customer, 'shipping/quote', crossWater({ preferredMode: 'LAND' }));
    expect(r.body.available).toBe(false);
    expect(r.body.reason).toBe('NO_DESTINATION_HUB');
    expect(r.body.message).toMatch(/land terminal serving San Pedro/i);
  });

  it('still routes a same-district parcel straight through, with no terminal', async () => {
    // The local rule must survive having a network to route over.
    const r = await post(customer, 'shipping/quote', {
      service: 'DOOR_TO_DOOR',
      origin: { district: 'BELIZE', city: 'Belize City' },
      destination: { district: 'BELIZE', city: 'Belize City' },
    });
    expect(r.body.available).toBe(true);
    expect(r.body.legs.map((l: { kind: string }) => l.kind)).toEqual(['DIRECT']);
  });
});

describe('a multimodal parcel, paid once and carried by two drivers', () => {
  it('plans door → terminal → transport → terminal → door', async () => {
    const r = await post(customer, 'shipping/quote', crossWater());
    expect(r.body.available).toBe(true);
    expect(r.body.legs.map((l: { kind: string }) => l.kind)).toEqual(['FIRST_MILE', 'LINE_HAUL', 'LAST_MILE']);
    // 800 courier + 3000 sea + 900 courier
    expect(r.body.totalMinor).toBe(800 + 3000 + 900);
  });

  it('takes one payment for the whole journey, not one per leg', async () => {
    const booked = await post(customer, 'shipping', { ...crossWater(), payWithWallet: true });
    if (booked.status !== 201) throw new Error(`booking failed: ${booked.status} ${JSON.stringify(booked.body)}`);
    const payments = await ctx.prisma.payment.findMany({ where: { shipmentId: booked.body.id } });
    expect(payments).toHaveLength(1);
    expect(Number(payments[0]!.amountMinor)).toBe(4700);
    expect(payments[0]!.status).toBe('AUTHORIZED');
  });

  it('offers the first mile and nothing else', async () => {
    await makeTestDriver('BELIZE');
    const booked = await post(customer, 'shipping', { ...crossWater(), payWithWallet: true });
    const legs = await legsOf(booked.body.id);

    expect(legs[0]!.kind).toBe('FIRST_MILE');
    expect(legs[0]!.status).toBe('READY');
    // The parcel is not at the terminal, so the last mile is nobody's job yet.
    expect(legs[2]!.kind).toBe('LAST_MILE');
    expect(legs[2]!.status).toBe('PENDING');
    expect(legs[2]!.courierStatus).toBeNull();
  });

  it('refuses to hand the last mile to a driver before the parcel lands', async () => {
    const { ShipmentDispatchService } = await import('../src/shipping/shipment-dispatch.service');
    const dispatch = ctx.app.get(ShipmentDispatchService);
    await makeTestDriver('BELIZE');

    const booked = await post(customer, 'shipping', { ...crossWater(), payWithWallet: true });
    const legs = await legsOf(booked.body.id);

    const outcome = (await dispatch.dispatchLeg(legs[2]!.id)) as { result: string; reason?: string };
    expect(outcome.result).toBe('SKIPPED');
    expect(outcome.reason).toMatch(/not reached/i);

    const after = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legs[2]!.id } });
    expect(after.assignedDriverProfileId).toBeNull();
  });

  it('settles once the journey finishes, paying the couriers and the platform', async () => {
    const first = await makeTestDriver('BELIZE');
    const booked = await post(customer, 'shipping', { ...crossWater(), payWithWallet: true });
    const shipmentId = booked.body.id;

    // Walk the journey by driving each leg to completion. The point being
    // asserted is the settlement at the end, so the legs are advanced directly
    // rather than through six driver screens.
    const legs = await legsOf(shipmentId);
    for (const leg of legs) {
      await ctx.prisma.shipmentLeg.update({
        where: { id: leg.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          assignedDriverProfileId: leg.kind === 'LINE_HAUL' ? null : first.driverProfileId,
          courierStatus: leg.kind === 'LINE_HAUL' ? null : 'DELIVERED',
        },
      });
    }
    await ctx.prisma.shipment.update({ where: { id: shipmentId }, data: { status: 'DELIVERED' } });

    const { SettlementService } = await import('../src/settlement/settlement.service');
    const settlement = ctx.app.get(SettlementService);
    const result = await settlement.settleShipment(shipmentId, null);
    expect(result.settled).toBe(true);

    const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { shipmentId } });
    expect(payment.status).toBe('SETTLED');

    // Escrow is empty again and the ledger balances.
    const escrow = await ctx.prisma.walletAccount.findFirstOrThrow({ where: { type: 'SYSTEM_ESCROW' } });
    const escrowEntries = await ctx.prisma.walletLedgerEntry.findMany({ where: { accountId: escrow.id } });
    const escrowNet = escrowEntries.reduce((s, e) => s + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor), 0n);
    expect(escrowNet).toBe(0n);

    const all = await ctx.prisma.walletLedgerEntry.findMany();
    const net = all.reduce((s, e) => s + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor), 0n);
    expect(net).toBe(0n);

    // The courier legs earned; the carrier's line-haul did not.
    const earnings = await ctx.prisma.driverEarning.findMany({ where: { shipmentLeg: { shipmentId } } });
    expect(earnings).toHaveLength(2);
    expect(earnings.every((e) => e.status === 'POSTED')).toBe(true);
  });

  it('settles exactly once, however many times it is asked', async () => {
    const driver = await makeTestDriver('BELIZE');
    const booked = await post(customer, 'shipping', { ...crossWater(), payWithWallet: true });
    const shipmentId = booked.body.id;
    for (const leg of await legsOf(shipmentId)) {
      await ctx.prisma.shipmentLeg.update({
        where: { id: leg.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          assignedDriverProfileId: leg.kind === 'LINE_HAUL' ? null : driver.driverProfileId,
        },
      });
    }
    await ctx.prisma.shipment.update({ where: { id: shipmentId }, data: { status: 'DELIVERED' } });

    const { SettlementService } = await import('../src/settlement/settlement.service');
    const settlement = ctx.app.get(SettlementService);
    await settlement.settleShipment(shipmentId, null);
    await settlement.settleShipment(shipmentId, null);

    const releases = await ctx.prisma.walletTransaction.count({ where: { type: 'ESCROW_RELEASE' } });
    expect(releases).toBe(1);

    const all = await ctx.prisma.walletLedgerEntry.findMany();
    const net = all.reduce((s, e) => s + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor), 0n);
    expect(net).toBe(0n);
  });
});
