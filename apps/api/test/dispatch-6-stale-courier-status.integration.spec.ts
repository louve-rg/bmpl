/**
 * DISPATCH-6 — a staff/terminal handoff permanently burns driver capacity.
 *
 * `ShipmentService.completeLeg()`'s conditional `updateMany` set `status`,
 * `completedAt`, `handoffVerifiedAt`/`handoffVerificationStatus` and
 * `handoffReceivedByName` — and never touched `courierStatus` or
 * `driverQueuePosition`. The DRIVER path compensated: `completeHandoff()`
 * (`shipment-driver.service.ts`) called `completeLeg()` and then did a SECOND,
 * unconditional write setting `courierStatus: 'DELIVERED'` and
 * `driverQueuePosition: null`. Only the driver path did that. A courier-kind
 * leg (FIRST_MILE/LAST_MILE/DIRECT) completed through
 * `admin/logistics/legs/:id/handoff` or `terminal/legs/:id/handoff` — staff
 * receiving the parcel at a counter, not the driver tapping "done" in the app
 * — kept whatever `courierStatus` it held a moment before completion
 * (typically `ARRIVING`) forever.
 *
 * `ShipmentDispatchService.rankFor`, `DriverService.activeJobCount` and
 * `DriverService.eligibleDriversForDistrict` all grouped/counted on
 * `courierStatus` with no filter on the leg's own `status` — so a COMPLETED
 * leg with a stale `ARRIVING` counted as live load indefinitely. Default
 * `dispatchMaxConcurrentPerDriver` is 3: three staff/terminal handoffs and a
 * real driver was never offered work again, silently, with no way back
 * through the API either (`flagException`/`resolveException` both refuse a
 * COMPLETED leg).
 *
 * Two independent invariants, matching the two changes that fix this:
 *  (1) a COMPLETED leg carrying a stale ARRIVING courierStatus must not
 *      consume capacity — proven directly against the load queries,
 *      independent of how the staleness arose.
 *  (2) a staff/terminal handoff must leave the driver immediately offerable
 *      again — proven end-to-end through the real admin handoff route.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';
import { ShipmentDispatchService } from '../src/shipping/shipment-dispatch.service';
import { DriverService } from '../src/driver/driver.service';

let ctx: TestContext;
let dispatch: ShipmentDispatchService;
let drivers: DriverService;
let admin: string[];
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const patch = (c: string[], p: string, b: object = {}) => request(ctx.server).patch(`/api/${p}`).set('Cookie', c).send(b);

async function registerCustomer(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

async function fund(userId: string, amountMinor: number) {
  const r = await post(admin, 'admin/wallet/test-credit', { userId, amountMinor, reason: 'DISPATCH-6 fixture' });
  expect(r.status).toBe(201);
}

async function fundedCustomer() {
  const { cookies, userId } = await registerCustomer(`cust_${uniq()}@example.com`);
  await fund(userId, 100_000);
  return { cookies, userId };
}

/** Matches shipment-dispatch-starvation.integration.spec.ts's own helper. */
async function makeDriver(district: string) {
  const { userId } = await registerCustomer(`drv_${uniq()}@example.com`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
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
  return { driverProfileId: profile.id };
}

async function setDispatch(maxConcurrentPerDriver: number) {
  const row = await ctx.prisma.platformSetting.findFirst();
  const data = { dispatchAutomatic: true, dispatchOfferTimeoutSeconds: 90, dispatchMaxOffers: 3, dispatchMaxConcurrentPerDriver: maxConcurrentPerDriver };
  if (row) await ctx.prisma.platformSetting.update({ where: { id: row.id }, data });
  else await ctx.prisma.platformSetting.create({ data });
}

/** DIRECT leg, door-to-door, both ends in the same district/city — no hub network needed. */
async function bookDirect(cookies: string[], district: string, city: string): Promise<string> {
  const r = await post(cookies, 'shipping', {
    service: 'DOOR_TO_DOOR',
    origin: { district, city, address: '1 Front St', name: 'S', phone: '501-222-3333' },
    destination: { district, city, address: '2 Front St', name: 'R', phone: '501-444-5555' },
    description: 'Documents', pieces: 1, payWithWallet: true,
  });
  expect(r.status).toBe(201);
  return r.body.id as string;
}

/**
 * A completed leg carrying exactly the stale shape a buggy staff/terminal
 * handoff used to leave: shipment-side `status` COMPLETED, but
 * `courierStatus` still whatever it held a moment before (ARRIVING).
 * Written directly — this invariant must hold regardless of which code path
 * produced the staleness.
 */
async function makeStaleCompletedLeg(driverProfileId: string) {
  const s = uniq();
  const shipment = await ctx.prisma.shipment.create({
    data: { reference: `S6-${s}`, service: 'DOOR_TO_DOOR', status: 'DELIVERED', description: 'One box', pieces: 1 },
  });
  return ctx.prisma.shipmentLeg.create({
    data: {
      shipmentId: shipment.id, sequence: 1, kind: 'DIRECT', mode: 'LAND', status: 'COMPLETED',
      assignedDriverProfileId: driverProfileId, courierStatus: 'ARRIVING', completedAt: new Date(),
      handoffVerificationStatus: 'VERIFIED',
    },
  });
}

async function pickupPinFor(legId: string) {
  return (await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId }, select: { pickupPin: true } })).pickupPin;
}

/** Drives a courier leg up to the moment a staff/terminal counter would receive it — short of
 *  the driver's own handoff, which the test calls through the admin route instead. */
async function driveToArriving(cookies: string[], legId: string) {
  expect((await post(cookies, `driver/shipping-jobs/${legId}/accept`)).status).toBe(201);
  const pin = await pickupPinFor(legId);
  expect((await post(cookies, `driver/shipping-jobs/${legId}/pickup`, pin ? { pin } : {})).status).toBe(201);
  expect((await post(cookies, `driver/shipping-jobs/${legId}/in-transit`)).status).toBe(201);
  expect((await post(cookies, `driver/shipping-jobs/${legId}/arriving`)).status).toBe(201);
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password }));
  await patch(admin, 'admin/ops/settings', { localCourierFeeMinor: 1500, localCourierFeeTestMinor: 1500, localCourierMinutes: 60 });
  dispatch = ctx.app.get(ShipmentDispatchService);
  drivers = ctx.app.get(DriverService);
});

afterAll(async () => {
  await ctx.app.close();
});

describe('DISPATCH-6 (1): a COMPLETED leg with a stale courierStatus must not count as load', () => {
  it('DriverService.activeJobCount ignores legs whose own status already reached COMPLETED', async () => {
    const { driverProfileId } = await makeDriver('ORANGE_WALK');
    // Three — more than the default dispatchMaxConcurrentPerDriver (3) would
    // ever let a real driver carry — so this can only read 0 if the
    // terminal-status guard is doing the excluding, not a coincidence of count.
    await makeStaleCompletedLeg(driverProfileId);
    await makeStaleCompletedLeg(driverProfileId);
    await makeStaleCompletedLeg(driverProfileId);

    expect(await drivers.activeJobCount(driverProfileId)).toBe(0);
  });

  it('DriverService.eligibleDriversForDistrict reports activeJobs: 0 for the same driver', async () => {
    const district = 'TOLEDO';
    const { driverProfileId } = await makeDriver(district);
    await makeStaleCompletedLeg(driverProfileId);
    await makeStaleCompletedLeg(driverProfileId);

    const pool = await drivers.eligibleDriversForDistrict(district, {});
    const found = pool.find((d) => d.driverProfileId === driverProfileId);
    expect(found).toBeDefined();
    expect(found!.activeJobs).toBe(0);
  });

  it('ShipmentDispatchService offers a new leg to a driver whose only history is stale COMPLETED legs', async () => {
    await setDispatch(1); // the strictest possible cap — one miscounted stale leg would already block this
    const district = 'STANN_CREEK';
    const { driverProfileId } = await makeDriver(district);
    await makeStaleCompletedLeg(driverProfileId);
    await makeStaleCompletedLeg(driverProfileId);
    await makeStaleCompletedLeg(driverProfileId);

    const { cookies } = await fundedCustomer();
    const shipmentId = await bookDirect(cookies, district, 'Orange Walk Town');
    const leg = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId } });
    await dispatch.dispatchLeg(leg.id);

    const after = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: leg.id } });
    expect(after.assignedDriverProfileId).toBe(driverProfileId);
  });
});

describe('DISPATCH-6 (2): a staff/terminal handoff leaves the driver immediately offerable again', () => {
  it('admin/logistics/legs/:id/handoff clears courierStatus and driverQueuePosition, not just status', async () => {
    await setDispatch(3);
    const district = 'CAYO';
    const { driverProfileId } = await makeDriver(district);
    const { cookies: customerCookies } = await fundedCustomer();
    const shipmentId = await bookDirect(customerCookies, district, 'San Ignacio');
    const leg = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId } });

    await dispatch.dispatchLeg(leg.id);
    const offered = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: leg.id } });
    expect(offered.assignedDriverProfileId).toBe(driverProfileId);

    const driverUserId = await ctx.prisma.driverProfile
      .findUniqueOrThrow({ where: { id: driverProfileId }, select: { userId: true } })
      .then((p) => p.userId);
    const driverLogin = await ctx.prisma.user.findUniqueOrThrow({ where: { id: driverUserId }, select: { email: true } });
    const driverCookies = cookiesOf(
      await request(ctx.server).post('/api/auth/login').send({ email: driverLogin.email, password: 'CustomerPass123' }),
    );
    await driveToArriving(driverCookies, leg.id);

    // Still live load right up to the handoff — otherwise this test would
    // pass for a reason that has nothing to do with the fix under test.
    expect(await drivers.activeJobCount(driverProfileId)).toBeGreaterThanOrEqual(1);
    const arriving = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: leg.id } });
    expect(arriving.courierStatus).toBe('ARRIVING');

    const pin = (await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: leg.id }, select: { handoffPin: true } })).handoffPin!;
    // `presentedByAssignedCourier: true` — Oscar's handoff-desk UI shape
    // (TERM-7): staff never learn the driver's user id, so the identity the
    // PIN check verifies against is DERIVED server-side from the leg's own
    // `assignedDriverProfileId`, not from the submitting admin's own id.
    const handoff = await post(admin, `admin/logistics/legs/${leg.id}/handoff`, {
      pin, receivedByName: 'Counter staff', presentedByAssignedCourier: true,
    });
    expect(handoff.status).toBe(201);

    const after = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: leg.id } });
    expect(after.status).toBe('COMPLETED');
    expect(after.courierStatus).toBe('DELIVERED');
    expect(after.driverQueuePosition).toBeNull();
    expect(await drivers.activeJobCount(driverProfileId)).toBe(0);
  });
});
