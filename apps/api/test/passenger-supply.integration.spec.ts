/**
 * Passenger transportation — supply & moderation (S1), against real Postgres.
 *
 * The claims this suite exists to defend:
 *  - the simulation flag is ADMIN-SET ONLY, on both profile kinds, and a
 *    vehicle inherits its owner's side of the boundary;
 *  - a passenger vehicle has exactly ONE owner — a driver or a fleet — by
 *    construction of the two registration paths;
 *  - going ONLINE is earned (approved role + valid licence + approved usable
 *    vehicle), not asserted;
 *  - moderation is split: passengers.read can look, only passengers.moderate
 *    can decide, and every decision lands in the audit trail naming who asked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedLimitedAdmin, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const put = (c: string[], p: string, b: object) => request(ctx.server).put(`/api/${p}`).set('Cookie', c).send(b);
const patch = (c: string[], p: string, b: object) => request(ctx.server).patch(`/api/${p}`).set('Cookie', c).send(b);

async function registerUser(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'P', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

const driverProfileBody = () => ({
  legalName: 'Pat Driver',
  displayName: `PDrv${uniq()}`,
  phone: '+5016100000',
  homeDistrict: 'BELIZE',
  licenceNumber: `PDL-${uniq()}`,
  licenceExpiry: FUTURE.toISOString(),
  termsAccepted: true,
});

const vehicleBody = () => ({
  type: 'VAN',
  make: 'Toyota',
  model: 'Hiace',
  licencePlate: `PV-${uniq()}`.slice(0, 18),
  registrationExpiry: FUTURE.toISOString(),
  insuranceExpiry: FUTURE.toISOString(),
  seatCapacity: 12,
});

async function approveRole(userId: string, roleCode: 'PASSENGER_DRIVER' | 'PASSENGER_PROVIDER') {
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode } },
    create: { userId, roleCode, status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
}

const limitedAdmin = async (permissions: string[]) => {
  const seeded = await seedLimitedAdmin(ctx.prisma, `plim_${uniq()}@example.bz`, permissions);
  const login = await request(ctx.server).post('/api/auth/login').send({ email: seeded.email, password: seeded.password });
  return { id: seeded.id, cookies: cookiesOf(login) };
};

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
  await ctx.prisma.passengerTripAssignment.deleteMany();
  await ctx.prisma.passengerBooking.deleteMany();
  await ctx.prisma.passengerTrip.deleteMany();
  await ctx.prisma.passengerVehicle.deleteMany();
  await ctx.prisma.passengerRouteStop.deleteMany();
  await ctx.prisma.passengerRoute.deleteMany();
  await ctx.prisma.passengerDriverProfile.deleteMany();
  await ctx.prisma.passengerProviderProfile.deleteMany();
});

/* ------------------------------------------------------------------------- */

describe('the passenger-driver profile', () => {
  it('lets an applicant build a profile before approval, and ignores any smuggled isTest', async () => {
    const u = await registerUser(`papp_${uniq()}@example.com`);
    const r = await put(u.cookies, 'passenger/driver/profile', { ...driverProfileBody(), isTest: true });
    expect(r.status).toBe(200);
    // The flag never comes from a request. Zod strips it; the row proves it.
    const row = await ctx.prisma.passengerDriverProfile.findUniqueOrThrow({ where: { userId: u.userId } });
    expect(row.isTest).toBe(false);
    expect(r.body.availability).toBe('OFFLINE');
  });

  it('keeps the two driving jobs separate: a passenger profile creates no delivery profile', async () => {
    const u = await registerUser(`psep_${uniq()}@example.com`);
    expect((await put(u.cookies, 'passenger/driver/profile', driverProfileBody())).status).toBe(200);
    expect(await ctx.prisma.driverProfile.findUnique({ where: { userId: u.userId } })).toBeNull();
  });
});

describe('going online is earned', () => {
  it('refuses ONLINE until the role is approved and a vehicle is approved and usable', async () => {
    const u = await registerUser(`pon_${uniq()}@example.com`);
    await put(u.cookies, 'passenger/driver/profile', driverProfileBody());

    // No approved role, no vehicle.
    let r = await patch(u.cookies, 'passenger/driver/availability', { availability: 'ONLINE' });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/can't go online/i);

    // Approved role, vehicle still PENDING moderation.
    await approveRole(u.userId, 'PASSENGER_DRIVER');
    const v = await post(u.cookies, 'passenger/driver/vehicles', vehicleBody());
    expect(v.status).toBe(201);
    expect(v.body.approvalStatus).toBe('PENDING');
    r = await patch(u.cookies, 'passenger/driver/availability', { availability: 'ONLINE' });
    expect(r.status).toBe(400);

    // Vehicle approved → online works.
    const moderator = await limitedAdmin(['passengers.moderate']);
    expect((await post(moderator.cookies, `admin/passengers/vehicles/${v.body.id}/approve`)).status).toBe(201);
    r = await patch(u.cookies, 'passenger/driver/availability', { availability: 'ONLINE' });
    expect(r.status).toBe(200);
    expect(r.body.availability).toBe('ONLINE');
  });
});

describe('vehicle moderation', () => {
  it('splits looking from deciding, and audits WHO decided', async () => {
    const u = await registerUser(`pmod_${uniq()}@example.com`);
    await put(u.cookies, 'passenger/driver/profile', driverProfileBody());
    const v = await post(u.cookies, 'passenger/driver/vehicles', vehicleBody());

    const reader = await limitedAdmin(['passengers.read']);
    const moderator = await limitedAdmin(['passengers.moderate']);

    // read can look…
    expect((await get(reader.cookies, 'admin/passengers/drivers')).status).toBe(200);
    // …but not decide.
    expect((await post(reader.cookies, `admin/passengers/vehicles/${v.body.id}/approve`)).status).toBe(403);
    // moderate decides, and the trail names them.
    const ok = await post(moderator.cookies, `admin/passengers/vehicles/${v.body.id}/approve`);
    expect(ok.status).toBe(201);
    expect(ok.body.approvalStatus).toBe('APPROVED');
    const rows = (
      await ctx.prisma.auditLog.findMany({ where: { action: 'PASSENGER_VEHICLE_APPROVED' } })
    ).filter((row) => (row.newValue as { vehicleId?: string }).vehicleId === v.body.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorId).toBe(moderator.id);
  });

  it('rejection carries the reason back to the vehicle', async () => {
    const u = await registerUser(`prej_${uniq()}@example.com`);
    await put(u.cookies, 'passenger/driver/profile', driverProfileBody());
    const v = await post(u.cookies, 'passenger/driver/vehicles', vehicleBody());
    const moderator = await limitedAdmin(['passengers.moderate']);
    const r = await post(moderator.cookies, `admin/passengers/vehicles/${v.body.id}/reject`, { reason: 'No insurance document.' });
    expect(r.status).toBe(201);
    expect(r.body.approvalStatus).toBe('REJECTED');
    expect(r.body.rejectionReason).toBe('No insurance document.');
  });

  it('editing regulated fields sends an approved vehicle back to PENDING', async () => {
    const u = await registerUser(`pres_${uniq()}@example.com`);
    await put(u.cookies, 'passenger/driver/profile', driverProfileBody());
    const v = await post(u.cookies, 'passenger/driver/vehicles', vehicleBody());
    const moderator = await limitedAdmin(['passengers.moderate']);
    await post(moderator.cookies, `admin/passengers/vehicles/${v.body.id}/approve`);
    // Changing seat capacity is regulated: it is what a booking would sell.
    const r = await patch(u.cookies, `passenger/driver/vehicles/${v.body.id}`, { seatCapacity: 30 });
    expect(r.status).toBe(200);
    expect(r.body.approvalStatus).toBe('PENDING');
  });
});

describe('the simulation boundary', () => {
  it('is admin-set on the driver, audited, and inherited by later vehicles', async () => {
    const u = await registerUser(`ptest_${uniq()}@example.com`);
    await put(u.cookies, 'passenger/driver/profile', driverProfileBody());
    const profile = await ctx.prisma.passengerDriverProfile.findUniqueOrThrow({ where: { userId: u.userId } });

    const moderator = await limitedAdmin(['passengers.moderate']);
    const r = await patch(moderator.cookies, `admin/passengers/drivers/${profile.id}/test-mode`, { isTest: true, reason: 'Simulation cohort.' });
    expect(r.status).toBe(200);
    expect(r.body.isTest).toBe(true);

    const audits = (
      await ctx.prisma.auditLog.findMany({ where: { action: 'PASSENGER_DRIVER_TEST_MODE_CHANGED' } })
    ).filter((row) => (row.newValue as { passengerDriverProfileId?: string }).passengerDriverProfileId === profile.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actorId).toBe(moderator.id);

    // A vehicle registered AFTER the flip is a test vehicle — derived, never sent.
    const v = await post(u.cookies, 'passenger/driver/vehicles', vehicleBody());
    expect((await ctx.prisma.passengerVehicle.findUniqueOrThrow({ where: { id: v.body.id } })).isTest).toBe(true);
  });

  it('is admin-set on the operator too, with its own audit code', async () => {
    const u = await registerUser(`pprov_${uniq()}@example.com`);
    await put(u.cookies, 'passenger/provider/profile', { businessName: 'Coastal Runners', contactEmail: 'ops@example.com' });
    const profile = await ctx.prisma.passengerProviderProfile.findUniqueOrThrow({ where: { userId: u.userId } });
    const moderator = await limitedAdmin(['passengers.moderate']);
    const r = await patch(moderator.cookies, `admin/passengers/providers/${profile.id}/test-mode`, { isTest: true });
    expect(r.status).toBe(200);
    const audits = (
      await ctx.prisma.auditLog.findMany({ where: { action: 'PASSENGER_PROVIDER_TEST_MODE_CHANGED' } })
    ).filter((row) => (row.newValue as { passengerProviderProfileId?: string }).passengerProviderProfileId === profile.id);
    expect(audits).toHaveLength(1);
  });
});

describe('a vehicle has exactly one owner', () => {
  it('a fleet vehicle belongs to the fleet; a driver vehicle to the driver — never both', async () => {
    const d = await registerUser(`pxor1_${uniq()}@example.com`);
    await put(d.cookies, 'passenger/driver/profile', driverProfileBody());
    const dv = await post(d.cookies, 'passenger/driver/vehicles', vehicleBody());

    const o = await registerUser(`pxor2_${uniq()}@example.com`);
    await put(o.cookies, 'passenger/provider/profile', { businessName: 'Island Shuttles', contactEmail: 'fleet@example.com' });
    const pv = await post(o.cookies, 'passenger/provider/vehicles', { ...vehicleBody(), type: 'BUS', seatCapacity: 40 });
    expect(pv.status).toBe(201);

    const driverVehicle = await ctx.prisma.passengerVehicle.findUniqueOrThrow({ where: { id: dv.body.id } });
    expect(driverVehicle.ownerDriverProfileId).not.toBeNull();
    expect(driverVehicle.providerProfileId).toBeNull();
    const fleetVehicle = await ctx.prisma.passengerVehicle.findUniqueOrThrow({ where: { id: pv.body.id } });
    expect(fleetVehicle.providerProfileId).not.toBeNull();
    expect(fleetVehicle.ownerDriverProfileId).toBeNull();

    // And neither owner can touch the other's vehicle.
    expect((await patch(d.cookies, `passenger/driver/vehicles/${pv.body.id}`, { color: 'red' })).status).toBe(404);
    expect((await patch(o.cookies, `passenger/provider/vehicles/${dv.body.id}`, { color: 'red' })).status).toBe(404);
  });
});

describe('who may see the admin surface', () => {
  it('refuses a plain customer everywhere', async () => {
    const u = await registerUser(`pnoadm_${uniq()}@example.com`);
    expect((await get(u.cookies, 'admin/passengers/drivers')).status).toBe(403);
    expect((await get(u.cookies, 'admin/passengers/providers')).status).toBe(403);
    expect((await post(u.cookies, 'admin/passengers/vehicles/nonexistent/approve')).status).toBe(403);
  });
});
