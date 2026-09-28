/**
 * BMPL-284/285: sender/recipient availability windows — storage and the
 * sender write surface only. NO CONSUMER this round: nothing in dispatch,
 * quoting or leg scheduling reads this table yet, deliberately (BMPL-284's
 * own scope finding — the consumer surface is wider than hub hours and is
 * its own card).
 *
 * Deliberately NOT the weekly-pattern-plus-exception shape hub/vendor/route
 * hours use: a shipment is a ONE-TIME event, so this is a short flat list —
 * one row per time range, a role saying which door-touching attempt it
 * governs, no day-of-week or date-exception axis at all.
 *
 * What this file exists specifically to prove:
 *  - a shipment with NO window behaves IDENTICALLY to today — nothing here
 *    can gate or change dispatch, because nothing reads this table yet.
 *  - the replace-all write surface, its validation (start before end, both
 *    at the API and the CHECK), and its gating (a role's windows may only
 *    be SET while the leg that role governs has not started; CLEARING is
 *    always allowed, since it only widens back toward "no constraint").
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let hub: Record<string, string>;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const put = (c: string[], p: string, b: object = {}) => request(ctx.server).put(`/api/${p}`).set('Cookie', c).send(b);
const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);

async function registerUser(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

async function fundedSender() {
  const { cookies, userId } = await registerUser(`sender_${uniq()}@example.com`);
  await post(admin, 'admin/wallet/test-credit', { userId, amountMinor: 100_000, reason: 'BMPL-285 test fixture.' });
  return { cookies, userId };
}

async function driverFor(userId: string, districts: string[]) {
  const s = uniq();
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId, legalName: 'D River', displayName: `Drv${s}`, phone: '+5016000000',
      homeDistrict: districts[0] as never, licenceNumber: `DL-${s}`, licenceExpiry: FUTURE,
      vehicleOwnership: 'OWNED', availability: 'OFFLINE', isActive: true,
    },
  });
  await ctx.prisma.driverVehicle.create({
    data: {
      driverProfileId: profile.id, type: 'CAR', make: 'Toyota', model: 'Corolla',
      licencePlate: `BZ-${s}`.slice(0, 18), registrationExpiry: FUTURE, insuranceExpiry: FUTURE,
      isActive: true, isPrimary: true, approvalStatus: 'APPROVED',
    },
  });
  for (const d of districts) {
    await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: d as never, isActive: true } });
  }
  return { driverProfileId: profile.id };
}

async function seedNetwork() {
  const hubs = [
    { code: 'AWP', name: 'Availability-window Placencia', district: 'STANN_CREEK', city: 'Placencia', fee: 1200 },
    { code: 'AWS', name: 'Availability-window San Pedro', district: 'BELIZE', city: 'San Pedro', fee: 1500 },
  ];
  hub = {};
  for (const h of hubs) {
    const r = await post(admin, 'admin/logistics/hubs', {
      code: `${h.code}${uniq()}`.slice(0, 12), name: h.name, type: 'AIRSTRIP', district: h.district, city: h.city, modes: ['LAND', 'AIR'],
    });
    expect(r.status).toBe(201);
    hub[h.code] = r.body.id;
    await ctx.prisma.logisticsHub.update({ where: { id: r.body.id }, data: { courierFeeMinor: BigInt(h.fee) } });
  }
  expect(
    (
      await post(admin, 'admin/logistics/routes', {
        originHubId: hub.AWP, destinationHubId: hub.AWS, mode: 'AIR',
        durationMinutes: 20, priceMinor: 6000, carrierName: 'Tropic Air',
      })
    ).status,
  ).toBe(201);
}

const doorToDoor = () => ({
  service: 'DOOR_TO_DOOR',
  origin: { district: 'STANN_CREEK', city: 'Placencia', address: '1 Sidewalk', name: 'Sender', phone: '501-2223333', latitude: 16.5122, longitude: -88.3661 },
  destination: { district: 'BELIZE', city: 'San Pedro', address: '5 Barrier Reef Drive', name: 'Recipient', phone: '501-4445555', latitude: 17.9214, longitude: -87.9611 },
  preferredMode: 'AIR',
  description: 'One box',
});

/** Same district, same town, no hub network involved — isLocalDoorToDoor
 *  gives a single DIRECT leg, the case where one leg governs BOTH roles. */
const localDoorToDoor = () => ({
  service: 'DOOR_TO_DOOR',
  origin: { district: 'ORANGE_WALK', city: 'Orange Walk Town', address: '1 Main St', name: 'Sender', phone: '501-2223333', latitude: 18.0833, longitude: -88.5667 },
  destination: { district: 'ORANGE_WALK', city: 'Orange Walk Town', address: '2 Main St', name: 'Recipient', phone: '501-4445555', latitude: 18.0840, longitude: -88.5670 },
  description: 'One box, across town',
});

async function book(cookies: string[], body: Record<string, unknown>) {
  const r = await post(cookies, 'shipping', { ...body, payWithWallet: true });
  expect(r.status).toBe(201);
  return r.body;
}

const legsOf = (shipmentId: string) => ctx.prisma.shipmentLeg.findMany({ where: { shipmentId }, orderBy: { sequence: 'asc' } });

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password }));
  await seedNetwork();
});
afterAll(async () => { await ctx.app.close(); });
beforeEach(async () => {
  // dispatchAutomatic off: these tests care about the STORAGE and WRITE
  // surface, not dispatch — keeping it off means no driver races ahead of
  // a leg-status assertion regardless of who is online.
  const row = await ctx.prisma.platformSetting.findFirst();
  const data = { dispatchAutomatic: false };
  if (row) await ctx.prisma.platformSetting.update({ where: { id: row.id }, data });
  else await ctx.prisma.platformSetting.create({ data });
});

describe('shipment availability windows — storage and write surface (BMPL-285)', () => {
  it('a fresh shipment has no windows, and behaves identically to a shipment with none ever set', async () => {
    const sender = await fundedSender();
    const shipment = await book(sender.cookies, doorToDoor());
    expect(shipment.availabilityWindows).toEqual([]);

    const tracked = await get(sender.cookies, `shipping/${shipment.reference}`);
    expect(tracked.status).toBe(200);
    expect(tracked.body.availabilityWindows).toEqual([]);
  });

  it('sets windows for both roles, and a resubmit REPLACES rather than merges', async () => {
    const sender = await fundedSender();
    const shipment = await book(sender.cookies, doorToDoor());

    const first = await put(sender.cookies, `shipping/${shipment.id}/availability-windows`, {
      windows: [
        { role: 'SENDER', startTime: '09:00', endTime: '12:00' },
        { role: 'SENDER', startTime: '14:00', endTime: '17:00' },
        { role: 'RECIPIENT', startTime: '10:00', endTime: '13:00' },
      ],
    });
    expect(first.status).toBe(200);
    expect(first.body.availabilityWindows).toHaveLength(3);

    // A second submission with only ONE window removes the other two — no
    // stale row survives, same discipline as hub weekly hours.
    const second = await put(sender.cookies, `shipping/${shipment.id}/availability-windows`, {
      windows: [{ role: 'SENDER', startTime: '08:00', endTime: '11:00' }],
    });
    expect(second.status).toBe(200);
    expect(second.body.availabilityWindows).toEqual([
      expect.objectContaining({ role: 'SENDER', startTime: '08:00', endTime: '11:00' }),
    ]);

    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'SHIPMENT_AVAILABILITY_WINDOWS_SET' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeTruthy();
    expect(audit!.actorId).toBe(sender.userId);
  });

  it('rejects end-before-start and end-equals-start before either reaches the database', async () => {
    const sender = await fundedSender();
    const shipment = await book(sender.cookies, doorToDoor());

    const endBeforeStart = await put(sender.cookies, `shipping/${shipment.id}/availability-windows`, {
      windows: [{ role: 'SENDER', startTime: '14:00', endTime: '09:00' }],
    });
    expect(endBeforeStart.status).toBe(400);

    const equal = await put(sender.cookies, `shipping/${shipment.id}/availability-windows`, {
      windows: [{ role: 'SENDER', startTime: '09:00', endTime: '09:00' }],
    });
    expect(equal.status).toBe(400);

    expect(await ctx.prisma.shipmentAvailabilityWindow.count({ where: { shipmentId: shipment.id } })).toBe(0);
  });

  it('refuses a role with no leg for it to govern', async () => {
    const sender = await fundedSender();
    // HUB_TO_HUB: neither end is a door, so there is no FIRST_MILE and no
    // LAST_MILE leg at all — nobody's door is ever visited.
    const shipment = await book(sender.cookies, {
      service: 'HUB_TO_HUB',
      origin: { hubId: hub.AWP },
      destination: { hubId: hub.AWS, name: 'Recipient', phone: '501-4445555' },
      preferredMode: 'AIR',
      description: 'Hub to hub',
    });
    const legs = await legsOf(shipment.id);
    expect(legs.some((l) => l.kind === 'FIRST_MILE' || l.kind === 'LAST_MILE')).toBe(false);

    const senderWindow = await put(sender.cookies, `shipping/${shipment.id}/availability-windows`, {
      windows: [{ role: 'SENDER', startTime: '09:00', endTime: '12:00' }],
    });
    expect(senderWindow.status).toBe(400);
    const recipientWindow = await put(sender.cookies, `shipping/${shipment.id}/availability-windows`, {
      windows: [{ role: 'RECIPIENT', startTime: '09:00', endTime: '12:00' }],
    });
    expect(recipientWindow.status).toBe(400);
  });

  it('a role may be SET only before the leg it governs has started, but may still be CLEARED after', async () => {
    const sender = await fundedSender();
    const shipment = await book(sender.cookies, doorToDoor());
    const legs = await legsOf(shipment.id);
    const firstMile = legs.find((l) => l.kind === 'FIRST_MILE')!;

    // Set successfully while PENDING.
    expect(
      (
        await put(sender.cookies, `shipping/${shipment.id}/availability-windows`, {
          windows: [{ role: 'SENDER', startTime: '09:00', endTime: '12:00' }],
        })
      ).status,
    ).toBe(200);

    // Move the leg to IN_PROGRESS directly — no supported path needs a
    // driver for this test, only the state the write surface must respect.
    await ctx.prisma.shipmentLeg.update({ where: { id: firstMile.id }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });

    // Changing it now is refused.
    const changeAfterStart = await put(sender.cookies, `shipping/${shipment.id}/availability-windows`, {
      windows: [{ role: 'SENDER', startTime: '10:00', endTime: '13:00' }],
    });
    expect(changeAfterStart.status).toBe(400);

    // But clearing it (submitting nothing for SENDER) is still allowed —
    // dropping a window only widens back toward "no constraint".
    const clear = await put(sender.cookies, `shipping/${shipment.id}/availability-windows`, { windows: [] });
    expect(clear.status).toBe(200);
    expect(clear.body.availabilityWindows).toEqual([]);
  });

  it('a DIRECT leg (local door-to-door) is governed by ONE leg for BOTH roles', async () => {
    const row = await ctx.prisma.platformSetting.findFirst();
    await ctx.prisma.platformSetting.update({ where: { id: row!.id }, data: { localCourierFeeMinor: 1000n, localCourierMinutes: 45 } });

    const sender = await fundedSender();
    const shipment = await book(sender.cookies, localDoorToDoor());
    const legs = await legsOf(shipment.id);
    expect(legs).toHaveLength(1);
    expect(legs[0]!.kind).toBe('DIRECT');

    // Both roles set successfully against the one leg.
    const set = await put(sender.cookies, `shipping/${shipment.id}/availability-windows`, {
      windows: [
        { role: 'SENDER', startTime: '09:00', endTime: '12:00' },
        { role: 'RECIPIENT', startTime: '13:00', endTime: '16:00' },
      ],
    });
    expect(set.status).toBe(200);

    // Once the single DIRECT leg starts, NEITHER role may be newly set.
    await ctx.prisma.shipmentLeg.update({ where: { id: legs[0]!.id }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });
    expect(
      (
        await put(sender.cookies, `shipping/${shipment.id}/availability-windows`, {
          windows: [{ role: 'RECIPIENT', startTime: '14:00', endTime: '17:00' }],
        })
      ).status,
    ).toBe(400);
  });

  it('only the shipment owner may read or write its windows', async () => {
    const sender = await fundedSender();
    const shipment = await book(sender.cookies, doorToDoor());
    const stranger = await registerUser(`stranger_${uniq()}@example.com`);

    expect((await get(stranger.cookies, `shipping/${shipment.reference}`)).status).toBe(404);
    expect(
      (
        await put(stranger.cookies, `shipping/${shipment.id}/availability-windows`, {
          windows: [{ role: 'SENDER', startTime: '09:00', endTime: '12:00' }],
        })
      ).status,
    ).toBe(404);
  });

  it('a nonexistent shipment 404s', async () => {
    const sender = await fundedSender();
    expect(
      (
        await put(sender.cookies, 'shipping/nonexistent00000000000000/availability-windows', {
          windows: [{ role: 'SENDER', startTime: '09:00', endTime: '12:00' }],
        })
      ).status,
    ).toBe(404);
  });
});
