/**
 * MDF-924 — self-service account deletion, against real PostgreSQL.
 * Covers: happy-path anonymization + session revocation, wrong-password
 * refusal, unauthenticated refusal, and the three concrete "live
 * responsibility" refusals (sole terminal manager, open vendor order,
 * in-progress driver delivery) — each a hand-off case, not a silent failure.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, cookieValue, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
});
afterAll(async () => {
  await ctx.app.close();
});

async function registerAndLogin(email: string, password: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password, firstName: 'D', lastName: 'L', acceptedTerms: true });
  return { cookies: cookiesOf(reg), userId: (await ctx.prisma.user.findUniqueOrThrow({ where: { email } })).id };
}

async function login(email: string, password: string) {
  const res = await request(ctx.server).post('/api/auth/login').send({ email, password });
  return cookiesOf(res);
}

describe('account deletion — happy path', () => {
  it('anonymizes the row, revokes every session, and leaves the FK target intact', async () => {
    const email = 'delete-ok@example.bz';
    const password = 'DeleteMe12345';
    const { cookies, userId } = await registerAndLogin(email, password);

    const res = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.email).not.toBe(email);
    expect(user.email).toContain(userId);
    expect(user.firstName).toBe('Deleted');
    expect(user.lastName).toBe('User');
    expect(user.phone).toBeNull();
    expect(user.status).toBe('DEACTIVATED');
    expect(user.deletedAt).not.toBeNull();
    // The row survives — it is the FK target every other table depends on.
    expect(user.id).toBe(userId);

    const log = await ctx.prisma.auditLog.findFirst({
      where: { action: 'USER_ACCOUNT_DELETED', targetUserId: userId },
    });
    expect(log).toBeTruthy();
    expect(log?.actorId).toBe(userId);

    // Old credentials are gone...
    expect((await request(ctx.server).post('/api/auth/login').send({ email, password })).status).toBe(401);
    // ...and the acting session itself is dead, not just future logins.
    const access = cookieValue(cookies, 'access_token')!;
    expect((await request(ctx.server).get('/api/me').set('Cookie', [`access_token=${access}`])).status).toBe(401);
  });
});

describe('account deletion — refusals', () => {
  it('rejects a wrong current password and changes nothing', async () => {
    const email = 'delete-wrong-pw@example.bz';
    const password = 'RealPass12345';
    const { cookies, userId } = await registerAndLogin(email, password);

    const res = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: 'NotIt999999' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Current password is incorrect.');

    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.email).toBe(email);
    expect(user.status).toBe('ACTIVE');
    expect((await request(ctx.server).post('/api/auth/login').send({ email, password })).status).toBe(201);
  });

  it('requires authentication', async () => {
    const res = await request(ctx.server).delete('/api/me').send({ currentPassword: 'whatever12345' });
    expect(res.status).toBe(401);
  });

  it('refuses when the caller is the sole active manager of a terminal company, and allows it once a second manager exists', async () => {
    const email = 'delete-sole-manager@example.bz';
    const password = 'ManagerPass12345';
    const { cookies, userId } = await registerAndLogin(email, password);
    const other = await registerAndLogin('delete-sole-manager-other@example.bz', 'OtherPass12345');

    const company = await ctx.prisma.terminalCompanyProfile.create({
      data: { businessName: 'Sole Manager Terminal Co', contactEmail: 'ops@example.bz' },
    });
    await ctx.prisma.terminalCompanyMember.create({
      data: { terminalCompanyId: company.id, userId, memberRole: 'MANAGER', status: 'ACTIVE' },
    });

    const refused = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(refused.status).toBe(409);
    expect(refused.body.message).toBe('Your account cannot be deleted yet.');
    expect(refused.body.reasons.some((r: string) => r.includes('Sole Manager Terminal Co'))).toBe(true);

    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.status).toBe('ACTIVE');

    // A second active manager removes the floor — no code change needed to
    // re-check, just the same query seeing a different state.
    await ctx.prisma.terminalCompanyMember.create({
      data: { terminalCompanyId: company.id, userId: other.userId, memberRole: 'MANAGER', status: 'ACTIVE' },
    });
    const allowed = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(allowed.status).toBe(200);
  });

  it('refuses when the caller is a vendor with an order still awaiting fulfillment', async () => {
    const email = 'delete-open-order@example.bz';
    const password = 'VendorPass12345';
    const { cookies, userId } = await registerAndLogin(email, password);

    const vendor = await ctx.prisma.vendorProfile.create({
      data: {
        userId,
        businessName: 'Open Order Store',
        slug: 'open-order-store',
        contactEmail: 'store@example.bz',
      },
    });
    const order = await ctx.prisma.order.create({
      data: {
        orderNumber: 'ORD-DEL-TEST-1',
        userId,
        itemCount: 1,
        subtotalMinor: 1000n,
        totalMinor: 1000n,
      },
    });
    await ctx.prisma.vendorOrder.create({
      data: {
        orderNumber: 'ORD-DEL-TEST-1-V1',
        orderId: order.id,
        vendorProfileId: vendor.id,
        deliveryMethod: 'PICKUP',
        itemCount: 1,
        subtotalMinor: 1000n,
        status: 'PENDING',
      },
    });

    const res = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(res.status).toBe(409);
    expect(res.body.reasons.some((r: string) => r.includes('Open Order Store'))).toBe(true);

    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.status).toBe('ACTIVE');

    // Same underlying count-based query clears once the order is no longer open.
    await ctx.prisma.vendorOrder.updateMany({
      where: { vendorProfileId: vendor.id },
      data: { status: 'CANCELLED' },
    });
    const allowed = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(allowed.status).toBe(200);
  });

  it('refuses when the caller is a driver with a delivery still in progress', async () => {
    const email = 'delete-active-delivery@example.bz';
    const password = 'DriverPass12345';
    const { cookies, userId } = await registerAndLogin(email, password);

    const driver = await ctx.prisma.driverProfile.create({
      data: {
        userId,
        legalName: 'Test Driver',
        displayName: 'Test Driver',
        phone: '6650000',
        homeDistrict: 'BELIZE',
        licenceNumber: 'LIC-DEL-TEST-1',
        licenceExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });
    const vendorUser = await registerAndLogin('delete-active-delivery-vendor@example.bz', 'VendorPass12345');
    const vendor = await ctx.prisma.vendorProfile.create({
      data: {
        userId: vendorUser.userId,
        businessName: 'Delivery Fixture Store',
        slug: 'delivery-fixture-store',
        contactEmail: 'store2@example.bz',
      },
    });
    const order = await ctx.prisma.order.create({
      data: {
        orderNumber: 'ORD-DEL-TEST-2',
        userId: vendorUser.userId,
        itemCount: 1,
        subtotalMinor: 1000n,
        totalMinor: 1000n,
      },
    });
    const vendorOrder = await ctx.prisma.vendorOrder.create({
      data: {
        orderNumber: 'ORD-DEL-TEST-2-V1',
        orderId: order.id,
        vendorProfileId: vendor.id,
        deliveryMethod: 'DELIVERY',
        itemCount: 1,
        subtotalMinor: 1000n,
      },
    });
    const delivery = await ctx.prisma.orderDelivery.create({
      data: {
        vendorOrderId: vendorOrder.id,
        assignedDriverProfileId: driver.id,
        status: 'IN_TRANSIT',
      },
    });

    const res = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(res.status).toBe(409);
    expect(res.body.reasons.some((r: string) => /in progress/.test(r))).toBe(true);

    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.status).toBe('ACTIVE');

    // Same underlying count-based query clears once the delivery finishes.
    await ctx.prisma.orderDelivery.update({ where: { id: delivery.id }, data: { status: 'DELIVERED' } });
    const allowed = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(allowed.status).toBe(200);
  });

  it('refuses when the caller is a passenger driver with a trip still in progress, and allows it once the trip finishes', async () => {
    const email = 'delete-active-trip@example.bz';
    const password = 'PaxDriverPass12345';
    const { cookies, userId } = await registerAndLogin(email, password);

    const paxDriver = await ctx.prisma.passengerDriverProfile.create({
      data: {
        userId,
        legalName: 'Test Pax Driver',
        displayName: 'Test Pax Driver',
        phone: '6650001',
        homeDistrict: 'BELIZE',
        licenceNumber: 'LIC-PAX-TEST-1',
        licenceExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });
    const trip = await ctx.prisma.passengerTrip.create({
      data: {
        reference: 'PAX-DEL-TEST-1',
        kind: 'ON_DEMAND',
        status: 'IN_PROGRESS',
        driverProfileId: paxDriver.id,
      },
    });

    const refused = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(refused.status).toBe(409);
    expect(refused.body.reasons.some((r: string) => /passenger trip/.test(r))).toBe(true);

    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.status).toBe('ACTIVE');

    // Same underlying count-based query clears once the trip finishes.
    await ctx.prisma.passengerTrip.update({ where: { id: trip.id }, data: { status: 'COMPLETED' } });
    const allowed = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(allowed.status).toBe(200);
  });

  it('refuses when the caller is the only active super-admin (anti-lockout, not a business floor), and allows it once a second super-admin exists', async () => {
    const password = 'SuperAdminPass12345';
    const admin = await seedSuperAdmin(ctx.prisma, 'delete-last-admin@example.bz', password);
    const cookies = await login(admin.email, password);

    const refused = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(refused.status).toBe(409);
    expect(refused.body.reasons.some((r: string) => /only active super-admin/.test(r))).toBe(true);

    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(user.status).toBe('ACTIVE');

    // A second active super-admin removes the lockout risk — same pattern as
    // the terminal sole-manager case: no code change needed to re-check, just
    // the same query seeing a different state.
    await seedSuperAdmin(ctx.prisma, 'delete-last-admin-other@example.bz', 'OtherAdminPass12345');
    const allowed = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(allowed.status).toBe(200);
  });
});
