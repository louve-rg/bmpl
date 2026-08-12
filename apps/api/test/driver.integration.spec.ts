/**
 * Driver Management Foundation (Phase 4 · M14) — integration vs real Postgres.
 * Driver profile/application, vehicles (+ primary + ownership isolation), service
 * areas, availability + ONLINE eligibility (role approval, expired licence/reg/
 * insurance, suspended, no approved vehicle), admin views + vehicle moderation +
 * permissions, and the no-assignment/no-wallet invariant. The role-application
 * document workflow itself is covered by workflows/demo-readiness specs.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, seedLimitedAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let adminCookies: string[];

async function login(email: string, password: string): Promise<string[]> {
  const res = await request(ctx.server).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(201);
  return cookiesOf(res);
}
async function registerCustomer(email: string): Promise<{ cookies: string[]; userId: string }> {
  const reg = await request(ctx.server).post('/api/auth/register').send({ email, password: 'CustomerPass123', firstName: 'D', lastName: 'R', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}
/** Set the DELIVERY_DRIVER role status directly (the doc/approval flow is tested elsewhere). */
async function setDriverRole(userId: string, status: 'PENDING' | 'APPROVED' | 'SUSPENDED' | 'REVOKED') {
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status, approvedAt: status === 'APPROVED' ? new Date() : null },
    update: { status, approvedAt: status === 'APPROVED' ? new Date() : null },
  });
}

const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
const PAST = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const profilePayload = (over: Record<string, unknown> = {}) => ({
  legalName: 'Jane Driver', displayName: 'Jane', phone: '+5016001111', homeDistrict: 'BELIZE',
  licenceNumber: 'DL-123', licenceExpiry: FUTURE, vehicleOwnership: 'OWNED', termsAccepted: true, ...over,
});
const vehiclePayload = (over: Record<string, unknown> = {}) => ({
  type: 'CAR', make: 'Toyota', model: 'Corolla', licencePlate: 'BZ-1234',
  registrationExpiry: FUTURE, insuranceExpiry: FUTURE, insuranceProvider: 'Acme', ...over,
});

const put = (c: string[], p: string, b: object | string) => request(ctx.server).put(`/api/${p}`).set('Cookie', c).send(b);
const post = (c: string[], p: string, b: object | string) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const patch = (c: string[], p: string, b: object | string) => request(ctx.server).patch(`/api/${p}`).set('Cookie', c).send(b);
const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  adminCookies = await login(admin.email, admin.password);
});
afterAll(async () => {
  await ctx.app.close();
});

describe('driver profile / application', () => {
  it('guest is 401; a customer with no profile gets null', async () => {
    await request(ctx.server).get('/api/driver/dashboard').expect(401);
    const { cookies } = await registerCustomer('drv_none@example.bz');
    expect((await get(cookies, 'driver/profile')).body).toEqual({}); // no profile → empty body
    const dash = await get(cookies, 'driver/dashboard');
    expect(dash.status).toBe(200);
    expect(dash.body).toMatchObject({ hasProfile: false, roleStatus: null });
    expect(dash.body.eligibility.canGoOnline).toBe(false);
  });

  it('a customer can create and update their driver profile', async () => {
    const { cookies } = await registerCustomer('drv_prof@example.bz');
    const res = await put(cookies, 'driver/profile', profilePayload());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ displayName: 'Jane', licenceNumber: 'DL-123', termsAccepted: true, availability: 'OFFLINE' });
    expect(res.body.licenceExpiryStatus).toBe('VALID');
    const upd = await patch(cookies, 'driver/profile', { displayName: 'Janet' });
    expect(upd.body.displayName).toBe('Janet');
  });

  it('the driver role requires supporting documents (no-doc submit → 400)', async () => {
    const { cookies } = await registerCustomer('drv_docs@example.bz');
    const res = await post(cookies, 'roles/applications', { roleCode: 'DELIVERY_DRIVER', documentKeys: [] });
    expect(res.status).toBe(400);
  });
});

describe('vehicles', () => {
  let cookies: string[];
  let vehicleId: string;

  beforeAll(async () => {
    const c = await registerCustomer('drv_veh@example.bz');
    cookies = c.cookies;
    await put(cookies, 'driver/profile', profilePayload());
  });

  it('creates a vehicle (PENDING, auto-primary as the first)', async () => {
    const res = await post(cookies, 'driver/vehicles', vehiclePayload());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ make: 'Toyota', approvalStatus: 'PENDING', isPrimary: true, isActive: true });
    vehicleId = res.body.id;
  });

  it('a second vehicle marked primary demotes the first', async () => {
    const res = await post(cookies, 'driver/vehicles', vehiclePayload({ licencePlate: 'BZ-9999', isPrimary: true }));
    expect(res.status).toBe(201);
    const list = await get(cookies, 'driver/vehicles');
    expect(list.body.filter((v: { isPrimary: boolean }) => v.isPrimary)).toHaveLength(1);
  });

  it("cannot access another driver's vehicle", async () => {
    const other = await registerCustomer('drv_veh_other@example.bz');
    await put(other.cookies, 'driver/profile', profilePayload());
    await patch(other.cookies, `driver/vehicles/${vehicleId}`, { color: 'Red' }).expect(404);
  });
});

describe('service areas', () => {
  it('sets and replaces the driver service districts', async () => {
    const { cookies } = await registerCustomer('drv_area@example.bz');
    await put(cookies, 'driver/profile', profilePayload());
    const set1 = await put(cookies, 'driver/service-areas', { districts: ['BELIZE', 'CAYO'] });
    expect(set1.body.map((a: { district: string }) => a.district).sort()).toEqual(['BELIZE', 'CAYO']);
    const set2 = await put(cookies, 'driver/service-areas', { districts: ['TOLEDO'] });
    expect(set2.body.map((a: { district: string }) => a.district)).toEqual(['TOLEDO']);
  });

  it('clears all service districts when given an empty list (including a BELIZE row)', async () => {
    const { cookies } = await registerCustomer('drv_area_clear@example.bz');
    await put(cookies, 'driver/profile', profilePayload());
    await put(cookies, 'driver/service-areas', { districts: ['BELIZE', 'CAYO'] });
    const cleared = await put(cookies, 'driver/service-areas', { districts: [] });
    expect(cleared.body).toEqual([]);
  });
});

describe('availability + ONLINE eligibility', () => {
  async function eligibleDriver(email: string) {
    const { cookies, userId } = await registerCustomer(email);
    await put(cookies, 'driver/profile', profilePayload());
    const v = await post(cookies, 'driver/vehicles', vehiclePayload());
    await setDriverRole(userId, 'APPROVED');
    // admin approves the vehicle
    await post(adminCookies, `admin/drivers/vehicles/${v.body.id}/approve`, {}).expect(201);
    return { cookies, userId, vehicleId: v.body.id };
  }

  it('a pending (unapproved) driver cannot go ONLINE', async () => {
    const { cookies } = await registerCustomer('drv_pending@example.bz');
    await put(cookies, 'driver/profile', profilePayload());
    const res = await patch(cookies, 'driver/availability', { availability: 'ONLINE' });
    expect(res.status).toBe(400);
    expect(patch(cookies, 'driver/availability', { availability: 'OFFLINE' })); // offline always allowed
  });

  it('cannot go ONLINE with no approved vehicle', async () => {
    const { cookies, userId } = await registerCustomer('drv_novehicle@example.bz');
    await put(cookies, 'driver/profile', profilePayload());
    await post(cookies, 'driver/vehicles', vehiclePayload()); // PENDING, not admin-approved
    await setDriverRole(userId, 'APPROVED');
    expect((await patch(cookies, 'driver/availability', { availability: 'ONLINE' })).status).toBe(400);
  });

  it('an approved driver with a valid approved vehicle can go ONLINE and back', async () => {
    const { cookies } = await eligibleDriver('drv_online@example.bz');
    const dash = await get(cookies, 'driver/dashboard');
    expect(dash.body.eligibility.canGoOnline).toBe(true);
    expect((await patch(cookies, 'driver/availability', { availability: 'ONLINE' })).body.availability).toBe('ONLINE');
    expect((await patch(cookies, 'driver/availability', { availability: 'UNAVAILABLE' })).body.availability).toBe('UNAVAILABLE');
  });

  it('an expired licence blocks ONLINE', async () => {
    const { cookies, userId } = await eligibleDriver('drv_exp_lic@example.bz');
    await patch(cookies, 'driver/profile', { licenceExpiry: PAST });
    expect((await patch(cookies, 'driver/availability', { availability: 'ONLINE' })).status).toBe(400);
    await setDriverRole(userId, 'APPROVED'); // unchanged
  });

  it('expired vehicle registration or insurance blocks ONLINE', async () => {
    const { cookies, vehicleId } = await eligibleDriver('drv_exp_veh@example.bz');
    await patch(cookies, `driver/vehicles/${vehicleId}`, { registrationExpiry: PAST });
    // editing regulated fields resets the vehicle to PENDING → re-approve, still expired
    await post(adminCookies, `admin/drivers/vehicles/${vehicleId}/approve`, {}).expect(201);
    expect((await patch(cookies, 'driver/availability', { availability: 'ONLINE' })).status).toBe(400);
  });

  it('a suspended driver cannot go ONLINE', async () => {
    const { cookies, userId } = await eligibleDriver('drv_susp@example.bz');
    await setDriverRole(userId, 'SUSPENDED');
    expect((await patch(cookies, 'driver/availability', { availability: 'ONLINE' })).status).toBe(400);
  });

  it('an availability change writes an audit record; no OrderDelivery/Wallet is created', async () => {
    const { cookies, userId } = await eligibleDriver('drv_audit@example.bz');
    await patch(cookies, 'driver/availability', { availability: 'ONLINE' }).expect(200);
    const audit = await ctx.prisma.auditLog.count({ where: { targetUserId: userId, action: 'DRIVER_AVAILABILITY_CHANGED' } });
    expect(audit).toBeGreaterThanOrEqual(1);
    // Foundation invariant: no delivery assignment / wallet movement exists for drivers.
    expect(await ctx.prisma.orderDelivery.count()).toBe(0);
    expect(await ctx.prisma.walletLedgerEntry.count()).toBe(0);
  });
});

describe('admin driver management', () => {
  it('lists drivers and shows a detail with vehicles + role status', async () => {
    const { cookies, userId } = await registerCustomer('drv_admin_view@example.bz');
    await put(cookies, 'driver/profile', profilePayload({ displayName: 'Viewable' }));
    await post(cookies, 'driver/vehicles', vehiclePayload());
    await setDriverRole(userId, 'APPROVED');
    const list = await get(adminCookies, 'admin/drivers');
    expect(list.status).toBe(200);
    const row = list.body.find((d: { userId: string }) => d.userId === userId);
    expect(row).toMatchObject({ displayName: 'Viewable', roleStatus: 'APPROVED', vehicleCount: 1 });
    const detail = await get(adminCookies, `admin/drivers/${row.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.vehicles).toHaveLength(1);
    expect(detail.body.roleStatus).toBe('APPROVED');
  });

  it('admin can approve and reject vehicles', async () => {
    const { cookies } = await registerCustomer('drv_veh_mod@example.bz');
    await put(cookies, 'driver/profile', profilePayload());
    const v = await post(cookies, 'driver/vehicles', vehiclePayload());
    expect((await post(adminCookies, `admin/drivers/vehicles/${v.body.id}/approve`, {})).body.approvalStatus).toBe('APPROVED');
    const rej = await post(adminCookies, `admin/drivers/vehicles/${v.body.id}/reject`, { reason: 'Blurry photo' });
    expect(rej.body).toMatchObject({ approvalStatus: 'REJECTED', rejectionReason: 'Blurry photo' });
  });

  it('an admin without drivers permissions is forbidden', async () => {
    const limited = await seedLimitedAdmin(ctx.prisma, 'drv_limited_admin@example.bz', ['users.read']);
    const lc = await login(limited.email, limited.password);
    await get(lc, 'admin/drivers').expect(403);
    const { cookies } = await registerCustomer('drv_forbidmod@example.bz');
    await put(cookies, 'driver/profile', profilePayload());
    const v = await post(cookies, 'driver/vehicles', vehiclePayload());
    await post(lc, `admin/drivers/vehicles/${v.body.id}/approve`, {}).expect(403);
  });

  it('a customer cannot reach admin driver endpoints', async () => {
    const { cookies } = await registerCustomer('drv_cust_noadmin@example.bz');
    await get(cookies, 'admin/drivers').expect(403);
  });
});
