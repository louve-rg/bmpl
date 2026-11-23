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
import { StorageService } from '../src/storage/storage.service';

let ctx: TestContext;
let storage: StorageService;

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  storage = ctx.app.get(StorageService);
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

  it('refuses when the caller is the sole active manager of a terminal company, allows it once a second manager exists, and still refuses the second manager\'s own deletion afterward (ACCT-DELETE-STALE-MANAGER-VOTE)', async () => {
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

    // ACCT-DELETE-STALE-MANAGER-VOTE (Stanley's re-walk): the FIRST
    // manager's own membership is ended, not left ACTIVE — the load-bearing
    // half of the fix is the count below, but this is the test that would
    // catch a regression of the data-hygiene half too.
    const firstMembershipAfter = await ctx.prisma.terminalCompanyMember.findFirstOrThrow({ where: { terminalCompanyId: company.id, userId } });
    expect(firstMembershipAfter.status).toBe('ENDED');
    expect(firstMembershipAfter.endedAt).not.toBeNull();

    // The real catch: deleting manager 1 must NOT silently leave manager 2
    // able to delete their own account next, treating manager 1's own
    // stale-but-ACTIVE row as "someone else is still managing this
    // company." A test that stopped at the line above would pass against
    // the broken code — this is the second deletion Stanley's walk proved
    // was wrongly ALLOWED.
    const secondRefused = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', other.cookies)
      .send({ currentPassword: 'OtherPass12345' });
    expect(secondRefused.status).toBe(409);
    expect(secondRefused.body.reasons.some((r: string) => r.includes('Sole Manager Terminal Co'))).toBe(true);

    // The company still has a live manager at the end, and manager 2's own
    // account was never touched by the refused attempt.
    const otherUserAfter = await ctx.prisma.user.findUniqueOrThrow({ where: { id: other.userId } });
    expect(otherUserAfter.status).toBe('ACTIVE');
    const liveManagers = await ctx.prisma.terminalCompanyMember.count({
      where: { terminalCompanyId: company.id, status: 'ACTIVE', memberRole: 'MANAGER', user: { status: { not: 'DEACTIVATED' } } },
    });
    expect(liveManagers).toBe(1);
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

  it('a delivered DELIVERY order never blocks the VENDOR either, even though its vendor-order stays at READY_FOR_PICKUP forever — but a still-moving one does (ACCT-DELETE-DELIVERY-BLOCKS)', async () => {
    const email = 'delete-vendor-delivery-done@example.bz';
    const password = 'VendorPass12345';
    const { cookies, userId } = await registerAndLogin(email, password);

    const vendor = await ctx.prisma.vendorProfile.create({
      data: { userId, businessName: 'Vendor Delivery Done Store', slug: 'vendor-delivery-done-store', contactEmail: 'store5@example.bz' },
    });
    const customer = await registerAndLogin('delete-vendor-delivery-done-customer@example.bz', 'CustomerPass12345');
    const order = await ctx.prisma.order.create({
      data: { orderNumber: 'ORD-DEL-TEST-5', userId: customer.userId, itemCount: 1, subtotalMinor: 1000n, totalMinor: 1000n },
    });
    const vendorOrder = await ctx.prisma.vendorOrder.create({
      data: { orderNumber: 'ORD-DEL-TEST-5-V1', orderId: order.id, vendorProfileId: vendor.id, deliveryMethod: 'DELIVERY', itemCount: 1, subtotalMinor: 1000n, status: 'READY_FOR_PICKUP' },
    });
    const delivery = await ctx.prisma.orderDelivery.create({
      data: { vendorOrderId: vendorOrder.id, status: 'ARRIVING' },
    });

    const refused = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(refused.status).toBe(409);
    expect(refused.body.reasons.some((r: string) => r.includes('Vendor Delivery Done Store'))).toBe(true);

    await ctx.prisma.orderDelivery.update({ where: { id: delivery.id }, data: { status: 'DELIVERED' } });
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

  /**
   * MDF-1074: before this, LIVE_DRIVER_STATUSES omitted EXCEPTION, so a
   * driver whose delivery/leg had been flagged (never DELIVERED/COMPLETED,
   * never resolved) was not counted as holding a live responsibility at
   * all — RAISE_EXCEPTION's own `from` list means an OrderDelivery can only
   * reach EXCEPTION already mid-carry, so this account could have been
   * deleted while the driver still physically held a real customer's
   * parcel. Both kinds LIVE_DRIVER_STATUSES feeds: an OrderDelivery and a
   * ShipmentLeg.
   */
  it('refuses when the caller is a driver whose delivery is flagged (EXCEPTION), not merely in transit — RAISE_EXCEPTION means this is still mid-carry', async () => {
    const email = 'delete-exception-delivery@example.bz';
    const password = 'DriverPass12345';
    const { cookies, userId } = await registerAndLogin(email, password);

    const driver = await ctx.prisma.driverProfile.create({
      data: {
        userId, legalName: 'Test Driver', displayName: 'Test Driver', phone: '6650020', homeDistrict: 'BELIZE',
        licenceNumber: 'LIC-DEL-TEST-EXC', licenceExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });
    const vendorUser = await registerAndLogin('delete-exception-delivery-vendor@example.bz', 'VendorPass12345');
    const vendor = await ctx.prisma.vendorProfile.create({
      data: { userId: vendorUser.userId, businessName: 'Exception Fixture Store', slug: 'exception-fixture-store', contactEmail: 'excstore@example.bz' },
    });
    const order = await ctx.prisma.order.create({
      data: { orderNumber: 'ORD-DEL-TEST-EXC', userId: vendorUser.userId, itemCount: 1, subtotalMinor: 1000n, totalMinor: 1000n },
    });
    const vendorOrder = await ctx.prisma.vendorOrder.create({
      data: { orderNumber: 'ORD-DEL-TEST-EXC-V1', orderId: order.id, vendorProfileId: vendor.id, deliveryMethod: 'DELIVERY', itemCount: 1, subtotalMinor: 1000n },
    });
    const delivery = await ctx.prisma.orderDelivery.create({
      data: { vendorOrderId: vendorOrder.id, assignedDriverProfileId: driver.id, status: 'EXCEPTION', exceptionReason: 'Recipient unreachable.', exceptionAt: new Date() },
    });

    const res = await request(ctx.server).delete('/api/me').set('Cookie', cookies).send({ currentPassword: password });
    expect(res.status).toBe(409);
    expect(res.body.reasons.some((r: string) => /in progress/.test(r))).toBe(true);

    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.status).toBe('ACTIVE');

    await ctx.prisma.orderDelivery.update({ where: { id: delivery.id }, data: { status: 'DELIVERED' } });
    const allowed = await request(ctx.server).delete('/api/me').set('Cookie', cookies).send({ currentPassword: password });
    expect(allowed.status).toBe(200);
  });

  it('refuses when the caller is a driver whose shipment leg is flagged (EXCEPTION), not merely in transit', async () => {
    const email = 'delete-exception-leg@example.bz';
    const password = 'DriverPass12345';
    const { cookies, userId } = await registerAndLogin(email, password);

    const driver = await ctx.prisma.driverProfile.create({
      data: {
        userId, legalName: 'Test Driver', displayName: 'Test Driver', phone: '6650021', homeDistrict: 'BELIZE',
        licenceNumber: 'LIC-DEL-TEST-LEGEXC', licenceExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });
    const shipment = await ctx.prisma.shipment.create({
      data: { reference: 'SDEL-TEST-EXC', service: 'DOOR_TO_DOOR', description: 'One box', pieces: 1 },
    });
    const leg = await ctx.prisma.shipmentLeg.create({
      data: {
        shipmentId: shipment.id, sequence: 1, kind: 'DIRECT', mode: 'LAND', status: 'EXCEPTION',
        exceptionAt: new Date(), exceptionReason: 'Vehicle broke down.',
        assignedDriverProfileId: driver.id, courierStatus: 'EXCEPTION',
      },
    });

    const res = await request(ctx.server).delete('/api/me').set('Cookie', cookies).send({ currentPassword: password });
    expect(res.status).toBe(409);
    expect(res.body.reasons.some((r: string) => /in progress/.test(r))).toBe(true);

    await ctx.prisma.shipmentLeg.update({ where: { id: leg.id }, data: { courierStatus: 'DELIVERED', status: 'COMPLETED' } });
    const allowed = await request(ctx.server).delete('/api/me').set('Cookie', cookies).send({ currentPassword: password });
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

    // TERMINAL-MANAGER-FLOOR-STALE-VOTE hygiene fold-in: deletion must not
    // leave the deleted admin's own UserRole row sitting at APPROVED.
    const revokedRole = await ctx.prisma.userRole.findUniqueOrThrow({
      where: { userId_roleCode: { userId: admin.id, roleCode: 'SUPER_ADMIN' } },
    });
    expect(revokedRole.status).toBe('REVOKED');
    expect(revokedRole.revokedAt).not.toBeNull();
  });

  it('refuses when the caller (as customer) has an order still being fulfilled or delivered', async () => {
    const email = 'delete-inflight-order@example.bz';
    const password = 'CustomerPass12345';
    const { cookies, userId } = await registerAndLogin(email, password);

    const vendorUser = await registerAndLogin('delete-inflight-order-vendor@example.bz', 'VendorPass12345');
    const vendor = await ctx.prisma.vendorProfile.create({
      data: { userId: vendorUser.userId, businessName: 'Inflight Order Store', slug: 'inflight-order-store', contactEmail: 'store3@example.bz' },
    });
    const order = await ctx.prisma.order.create({
      data: { orderNumber: 'ORD-DEL-TEST-3', userId, itemCount: 1, subtotalMinor: 1000n, totalMinor: 1000n },
    });
    const vendorOrder = await ctx.prisma.vendorOrder.create({
      data: { orderNumber: 'ORD-DEL-TEST-3-V1', orderId: order.id, vendorProfileId: vendor.id, deliveryMethod: 'PICKUP', itemCount: 1, subtotalMinor: 1000n, status: 'PREPARING' },
    });

    const res = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(res.status).toBe(409);
    expect(res.body.reasons.some((r: string) => /still being fulfilled or delivered/.test(r))).toBe(true);

    await ctx.prisma.vendorOrder.update({ where: { id: vendorOrder.id }, data: { status: 'CANCELLED' } });
    const allowed = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(allowed.status).toBe(200);
  });

  it('a delivered DELIVERY order never blocks the customer, even though its vendor-order stays at READY_FOR_PICKUP forever — but a still-moving one does (ACCT-DELETE-DELIVERY-BLOCKS)', async () => {
    const email = 'delete-delivery-done@example.bz';
    const password = 'CustomerPass12345';
    const { cookies, userId } = await registerAndLogin(email, password);

    const vendorUser = await registerAndLogin('delete-delivery-done-vendor@example.bz', 'VendorPass12345');
    const vendor = await ctx.prisma.vendorProfile.create({
      data: { userId: vendorUser.userId, businessName: 'Delivery Done Store', slug: 'delivery-done-store', contactEmail: 'store4@example.bz' },
    });
    const order = await ctx.prisma.order.create({
      data: { orderNumber: 'ORD-DEL-TEST-4', userId, itemCount: 1, subtotalMinor: 1000n, totalMinor: 1000n },
    });
    // VendorOrder.status never advances past READY_FOR_PICKUP for a DELIVERY
    // order — the real completion signal is OrderDelivery.status.
    const vendorOrder = await ctx.prisma.vendorOrder.create({
      data: { orderNumber: 'ORD-DEL-TEST-4-V1', orderId: order.id, vendorProfileId: vendor.id, deliveryMethod: 'DELIVERY', itemCount: 1, subtotalMinor: 1000n, status: 'READY_FOR_PICKUP' },
    });
    const delivery = await ctx.prisma.orderDelivery.create({
      data: { vendorOrderId: vendorOrder.id, status: 'IN_TRANSIT' },
    });

    // Still moving: refused.
    const refused = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(refused.status).toBe(409);
    expect(refused.body.reasons.some((r: string) => /still being fulfilled or delivered/.test(r))).toBe(true);

    // Delivered: allowed, even with the vendor-order unchanged at READY_FOR_PICKUP.
    await ctx.prisma.orderDelivery.update({ where: { id: delivery.id }, data: { status: 'DELIVERED' } });
    const vo = await ctx.prisma.vendorOrder.findUniqueOrThrow({ where: { id: vendorOrder.id } });
    expect(vo.status).toBe('READY_FOR_PICKUP');
    const allowed = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(allowed.status).toBe(200);
  });

  it('refuses when the caller (as customer) has a shipment still moving', async () => {
    const email = 'delete-inflight-shipment@example.bz';
    const password = 'CustomerPass12345';
    const { cookies, userId } = await registerAndLogin(email, password);

    const shipment = await ctx.prisma.shipment.create({
      data: { reference: 'SHIP-DEL-TEST-1', service: 'DOOR_TO_DOOR', status: 'IN_TRANSIT', customerUserId: userId },
    });

    const res = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(res.status).toBe(409);
    expect(res.body.reasons.some((r: string) => /shipment.*still moving/.test(r))).toBe(true);

    await ctx.prisma.shipment.update({ where: { id: shipment.id }, data: { status: 'DELIVERED' } });
    const allowed = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(allowed.status).toBe(200);
  });

  it('refuses when the wallet still holds a balance — never sweeps it, only refuses', async () => {
    const email = 'delete-wallet-balance@example.bz';
    const password = 'CustomerPass12345';
    const { cookies, userId } = await registerAndLogin(email, password);

    const account = await ctx.prisma.walletAccount.findFirstOrThrow({ where: { userId, type: 'USER' } });
    await ctx.prisma.walletAccount.update({ where: { id: account.id }, data: { cachedBalanceMinor: 500n } });

    const res = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(res.status).toBe(409);
    expect(res.body.reasons.some((r: string) => /wallet still holds funds/.test(r))).toBe(true);

    // Never swept or zeroed by the deletion attempt itself.
    const unchanged = await ctx.prisma.walletAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(unchanged.cachedBalanceMinor).toBe(500n);

    await ctx.prisma.walletAccount.update({ where: { id: account.id }, data: { cachedBalanceMinor: 0n } });
    const allowed = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(allowed.status).toBe(200);
  });

  /**
   * Acceptance round 3: the balance case above was the only one tested —
   * an open hold or escrow with a ZERO cached balance (a real shape:
   * `cachedBalanceMinor` nets debits/credits, a hold does not move it)
   * never had its own test. Also the one place this round's wallet-copy fix
   * (item 4) is exercised: the refusal must state the fact, never instruct
   * the person to "withdraw" — there is no such route anywhere in this
   * product.
   */
  it('refuses when the wallet has an open hold or escrow with a zero cached balance — never sweeps it, only refuses', async () => {
    const email = 'delete-wallet-hold@example.bz';
    const password = 'CustomerPass12345';
    const { cookies, userId } = await registerAndLogin(email, password);

    const account = await ctx.prisma.walletAccount.findFirstOrThrow({ where: { userId, type: 'USER' } });
    expect(account.cachedBalanceMinor).toBe(0n); // the point: no balance, only a hold
    const order = await ctx.prisma.order.create({
      data: { orderNumber: 'ORD-HOLD-TEST-1', userId, itemCount: 1, subtotalMinor: 500n, totalMinor: 500n },
    });
    const payment = await ctx.prisma.payment.create({
      data: { paymentNumber: 'PAY-HOLD-TEST-1', orderId: order.id, userId, amountMinor: 500n },
    });
    const hold = await ctx.prisma.walletHold.create({
      data: { paymentId: payment.id, walletAccountId: account.id, amountMinor: 500n, status: 'HELD' },
    });

    const res = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(res.status).toBe(409);
    expect(res.body.reasons.some((r: string) => /wallet still holds funds/.test(r))).toBe(true);
    // The old copy told the person to "withdraw" — no such route exists
    // anywhere in this product (root CLAUDE.md §4/§8); the refusal must
    // never instruct an action that cannot be taken.
    expect(res.body.reasons.some((r: string) => /withdraw/i.test(r))).toBe(false);

    const unchanged = await ctx.prisma.walletHold.findUniqueOrThrow({ where: { id: hold.id } });
    expect(unchanged.status).toBe('HELD'); // never released/swept by the deletion attempt itself

    await ctx.prisma.walletHold.update({ where: { id: hold.id }, data: { status: 'RELEASED', releasedAt: new Date() } });
    const allowed = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(allowed.status).toBe(200);
  });

  it('refuses when the caller is a passenger operator with an open booking, and allows it once resolved', async () => {
    const email = 'delete-pax-operator@example.bz';
    const password = 'OperatorPass12345';
    const { cookies, userId } = await registerAndLogin(email, password);

    const provider = await ctx.prisma.passengerProviderProfile.create({
      data: { userId, businessName: 'Open Booking Transport', contactEmail: 'pax-ops@example.bz' },
    });
    // Trip itself is already COMPLETED — deliberately terminal, so this
    // test isolates the BOOKING check alone from the separate scheduled-
    // trip check (ACCT-DEL-PASSENGER-PROVIDER-NO-FLEET-REFUSAL, its own
    // test below): a booking can still be open on a trip whose own status
    // no longer blocks anything by itself.
    const trip = await ctx.prisma.passengerTrip.create({
      data: { reference: 'PAX-DEL-TEST-2', kind: 'SCHEDULED', status: 'COMPLETED', providerProfileId: provider.id },
    });
    const booking = await ctx.prisma.passengerBooking.create({
      data: { reference: 'PAX-BOOK-DEL-TEST-1', tripId: trip.id, status: 'CONFIRMED' },
    });

    const res = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(res.status).toBe(409);
    expect(res.body.reasons.some((r: string) => r.includes('Open Booking Transport'))).toBe(true);

    await ctx.prisma.passengerBooking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } });
    const allowed = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(allowed.status).toBe(200);
  });

  /**
   * ACCT-DEL-PASSENGER-PROVIDER-NO-FLEET-REFUSAL: the open-booking check
   * above only catches a trip once a rider has actually booked a seat on
   * it. A SCHEDULED departure with zero bookings yet — or a fleet driver
   * still affiliated to this operator, which has nothing to do with
   * bookings at all — used to fall through with zero live-responsibility
   * reasons and delete successfully, stranding the driver's affiliation.
   */
  it('refuses when the caller is a passenger operator with a scheduled trip and zero open bookings, and allows it once cancelled', async () => {
    const email = 'delete-pax-operator-scheduled@example.bz';
    const password = 'OperatorPass12345';
    const { cookies, userId } = await registerAndLogin(email, password);

    const provider = await ctx.prisma.passengerProviderProfile.create({
      data: { userId, businessName: 'Scheduled Departure Transport', contactEmail: 'pax-sched@example.bz' },
    });
    const trip = await ctx.prisma.passengerTrip.create({
      data: { reference: 'PAX-DEL-TEST-SCHED-1', kind: 'SCHEDULED', status: 'SCHEDULED', providerProfileId: provider.id },
    });

    const res = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(res.status).toBe(409);
    expect(res.body.reasons.some((r: string) => r.includes('Scheduled Departure Transport'))).toBe(true);

    await ctx.prisma.passengerTrip.update({ where: { id: trip.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: 'PROVIDER' } });
    const allowed = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(allowed.status).toBe(200);
  });

  it('refuses when the caller is a passenger operator with an affiliated active fleet driver, and allows it once the affiliation ends', async () => {
    const email = 'delete-pax-operator-fleet@example.bz';
    const password = 'OperatorPass12345';
    const { cookies, userId } = await registerAndLogin(email, password);
    const fleetDriver = await registerAndLogin('delete-pax-operator-fleet-driver@example.bz', 'FleetDriverPass123');

    const provider = await ctx.prisma.passengerProviderProfile.create({
      data: { userId, businessName: 'Affiliated Fleet Transport', contactEmail: 'pax-fleet@example.bz' },
    });
    const driverProfile = await ctx.prisma.passengerDriverProfile.create({
      data: {
        userId: fleetDriver.userId, legalName: 'Fleet Driver', displayName: 'Fleet Driver', phone: '6650097',
        homeDistrict: 'BELIZE', licenceNumber: 'FLEET-LICENCE-DEL-1', licenceExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });
    const affiliation = await ctx.prisma.passengerFleetAffiliation.create({
      data: { providerProfileId: provider.id, driverProfileId: driverProfile.id, initiatedBy: 'PROVIDER', status: 'ACCEPTED', acceptedAt: new Date() },
    });

    const res = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(res.status).toBe(409);
    expect(res.body.reasons.some((r: string) => r.includes('Affiliated Fleet Transport'))).toBe(true);

    await ctx.prisma.passengerFleetAffiliation.update({
      where: { id: affiliation.id },
      data: { status: 'ENDED', endedAt: new Date(), endedBy: 'PROVIDER' },
    });
    const allowed = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(allowed.status).toBe(200);
  });

  it('allows a passenger operator with no open bookings, no scheduled trips and no affiliated fleet drivers to delete immediately', async () => {
    const email = 'delete-pax-operator-clean@example.bz';
    const password = 'OperatorPass12345';
    const { cookies } = await registerAndLogin(email, password);
    await ctx.prisma.passengerProviderProfile.create({
      data: { userId: (await ctx.prisma.user.findUniqueOrThrow({ where: { email } })).id, businessName: 'Clean Transport', contactEmail: 'pax-clean@example.bz' },
    });

    const allowed = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(allowed.status).toBe(200);
  });

  it('refuses when the caller is an employer with an applicant still awaiting a decision, and allows it once resolved', async () => {
    const email = 'delete-employer@example.bz';
    const password = 'EmployerPass12345';
    const { cookies, userId } = await registerAndLogin(email, password);
    const applicant = await registerAndLogin('delete-employer-applicant@example.bz', 'ApplicantPass12345');

    const employer = await ctx.prisma.employerProfile.create({
      data: { userId, companyName: 'Open Applicant Co', slug: 'open-applicant-co', contactEmail: 'jobs@example.bz' },
    });
    const job = await ctx.prisma.jobListing.create({
      data: { employerProfileId: employer.id, title: 'Warehouse Associate', slug: 'warehouse-associate-del-test', employmentType: 'FULL_TIME', description: 'Lift things.' },
    });
    const application = await ctx.prisma.jobApplication.create({
      data: { jobId: job.id, applicantId: applicant.userId, jobTitleSnapshot: 'Warehouse Associate', companySnapshot: 'Open Applicant Co', status: 'SUBMITTED' },
    });

    const res = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(res.status).toBe(409);
    expect(res.body.reasons.some((r: string) => r.includes('Open Applicant Co'))).toBe(true);

    await ctx.prisma.jobApplication.update({ where: { id: application.id }, data: { status: 'REJECTED' } });
    const allowed = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(allowed.status).toBe(200);
  });

  it('anonymizes every personal-data table this account populated, not just the users row, and suspends a live storefront', async () => {
    const email = 'delete-full-sweep@example.bz';
    const password = 'FullSweepPass12345';
    const { cookies, userId } = await registerAndLogin(email, password);

    await ctx.prisma.savedAddress.create({
      data: { userId, label: 'Home', fullName: 'Real Person', phone: '6650010', city: 'Belize City', district: 'BELIZE' },
    });
    const driver = await ctx.prisma.driverProfile.create({
      data: {
        userId,
        legalName: 'Real Driver Name',
        displayName: 'Real Driver Name',
        phone: '6650011',
        homeDistrict: 'BELIZE',
        homeAddress: '123 Real St',
        latitude: 17.5,
        longitude: -88.2,
        emergencyContactName: 'Next Of Kin',
        emergencyContactPhone: '6650012',
        licenceNumber: 'REAL-LICENCE-1',
        licenceExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        profilePhotoKey: 'real-driver-photo-key',
      },
    });
    const vehicle = await ctx.prisma.driverVehicle.create({
      data: {
        driverProfileId: driver.id, type: 'CAR', make: 'Toyota', model: 'Hilux', licencePlate: 'REAL-PLATE-1',
        registrationNumber: 'REAL-REG-1', insuranceProvider: 'Real Insurer', insurancePolicyNumber: 'REAL-POLICY-1',
      },
    });
    const paxDriver = await ctx.prisma.passengerDriverProfile.create({
      data: {
        userId,
        legalName: 'Real Pax Driver',
        displayName: 'Real Pax Driver',
        phone: '6650013',
        homeDistrict: 'BELIZE',
        licenceNumber: 'REAL-PAX-LICENCE-1',
        licenceExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });
    // MDF-949: this account's OWN passenger vehicle — the passenger-transport
    // equivalent of the DriverVehicle below. Must be anonymized the same way.
    const paxVehicle = await ctx.prisma.passengerVehicle.create({
      data: {
        ownerDriverProfileId: paxDriver.id, type: 'CAR', make: 'Honda', model: 'Civic', licencePlate: 'REAL-PAX-PLATE-1', seatCapacity: 3,
        registrationNumber: 'REAL-PAX-REG-1', insuranceProvider: 'Real Pax Insurer', insurancePolicyNumber: 'REAL-PAX-POLICY-1',
      },
    });

    // Defect 1 (acceptance): a COMPLETED delivery this driver already
    // finished, read back through the customer's OWN tracking endpoint
    // after deletion — proving the leak is closed at the actual read site,
    // not just in the row. DELIVERED is terminal, so it never blocks
    // deletion (not in LIVE_DRIVER_STATUSES).
    const deliveryCustomer = await registerAndLogin('delete-full-sweep-customer@example.bz', 'FullSweepCustPass1');
    const deliveryVendorUser = await registerAndLogin('delete-full-sweep-vendor@example.bz', 'FullSweepVendPass1');
    const deliveryVendor = await ctx.prisma.vendorProfile.create({
      data: { userId: deliveryVendorUser.userId, businessName: 'Full Sweep Delivery Store', slug: 'full-sweep-delivery-store', contactEmail: 'fsdelivery@example.bz' },
    });
    const deliveryOrder = await ctx.prisma.order.create({
      data: { orderNumber: 'ORD-FULLSWEEP-1', userId: deliveryCustomer.userId, itemCount: 1, subtotalMinor: 1000n, totalMinor: 1000n },
    });
    const deliveryVendorOrder = await ctx.prisma.vendorOrder.create({
      data: { orderNumber: 'ORD-FULLSWEEP-1-V1', orderId: deliveryOrder.id, vendorProfileId: deliveryVendor.id, deliveryMethod: 'DELIVERY', itemCount: 1, subtotalMinor: 1000n, status: 'PICKED_UP' },
    });
    const completedDelivery = await ctx.prisma.orderDelivery.create({
      data: { vendorOrderId: deliveryVendorOrder.id, assignedDriverProfileId: driver.id, status: 'DELIVERED' },
    });
    const jobSeeker = await ctx.prisma.jobSeekerProfile.create({
      data: { userId, preferredName: 'Real Seeker', legalName: 'Real Seeker Legal', contactEmail: 'seeker@example.bz', contactPhone: '6650014' },
    });
    const vendor = await ctx.prisma.vendorProfile.create({
      data: { userId, businessName: 'Full Sweep Store', slug: 'full-sweep-store', contactEmail: 'fullsweep@example.bz', contactPhone: '6650021', approvalStatus: 'APPROVED' },
    });
    const location = await ctx.prisma.vendorLocation.create({
      data: { vendorProfileId: vendor.id, label: 'Main', addressLine1: '456 Real Ave', city: 'Belize City', district: 'BELIZE' },
    });
    const employer = await ctx.prisma.employerProfile.create({
      data: { userId, companyName: 'Full Sweep Employer', slug: 'full-sweep-employer', contactEmail: 'employer@example.bz', contactPhone: '6650015' },
    });
    const propertyOwner = await ctx.prisma.propertyOwnerProfile.create({
      data: { userId, legalName: 'Real Owner', displayName: 'Real Owner', phone: '6650016', email: 'owner@example.bz' },
    });
    const agent = await ctx.prisma.realEstateAgentProfile.create({
      data: { userId, displayName: 'Real Agent', legalName: 'Real Agent Legal', slug: 'full-sweep-agent', phone: '6650017', email: 'agent@example.bz' },
    });
    const agency = await ctx.prisma.agencyProfile.create({
      data: { managerUserId: userId, name: 'Full Sweep Agency', slug: 'full-sweep-agency', contactEmail: 'agency@example.bz', contactPhone: '6650018' },
    });
    const passengerProvider = await ctx.prisma.passengerProviderProfile.create({
      data: {
        userId, businessName: 'Full Sweep Transport', contactEmail: 'paxops@example.bz', contactPhone: '6650019',
        addressLine1: '789 Real Terminal Rd', operatingLicenceNumber: 'REAL-PAX-OP-LICENCE-1',
      },
    });
    const shippingProvider = await ctx.prisma.shippingProviderProfile.create({
      data: {
        userId, businessName: 'Full Sweep Carrier', contactEmail: 'carrierops@example.bz', contactPhone: '6650020',
        addressLine1: '321 Real Dock Rd', operatingLicenceNumber: 'REAL-CARRIER-LICENCE-1',
      },
    });

    // MDF-949: a FLEET vehicle belonging to this account's OWN passenger-
    // transport business. Must be LEFT ALONE even though the fleet's owner
    // is the account being deleted. The driver below is deliberately an
    // ENDED affiliation, not ACCEPTED — ACCT-DEL-PASSENGER-PROVIDER-NO-FLEET-REFUSAL
    // now refuses deletion outright while any fleet driver is actively
    // affiliated (own test below), so this fixture cannot reach a
    // successful delete at all with a currently-active one. An ENDED
    // affiliation still proves the real claim here: the fleet vehicle and
    // its (former) driver's own row are never swept just because their
    // shared provider is being deleted.
    const otherPaxDriverUser = await ctx.prisma.user.create({ data: { email: 'other-pax-driver@example.bz', passwordHash: 'x', firstName: 'Other', lastName: 'PaxDriver' } });
    const otherPaxDriver = await ctx.prisma.passengerDriverProfile.create({
      data: { userId: otherPaxDriverUser.id, legalName: 'Other Pax Driver', displayName: 'Other Pax Driver', phone: '6650098', homeDistrict: 'BELIZE', licenceNumber: 'OTHER-PAX-LICENCE-1', licenceExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) },
    });
    const fleetVehicle = await ctx.prisma.passengerVehicle.create({
      data: { providerProfileId: passengerProvider.id, type: 'VAN', make: 'Toyota', model: 'Hiace', licencePlate: 'REAL-FLEET-PLATE-1', seatCapacity: 10 },
    });
    await ctx.prisma.passengerFleetAffiliation.create({
      data: {
        providerProfileId: passengerProvider.id, driverProfileId: otherPaxDriver.id, initiatedBy: 'PROVIDER',
        status: 'ENDED', acceptedAt: new Date(), endedAt: new Date(), endedBy: 'PROVIDER',
      },
    });
    const roleApplication = await ctx.prisma.roleApplication.create({
      data: { userId, roleCode: 'DELIVERY_DRIVER', status: 'PENDING' },
    });
    const roleDocument = await ctx.prisma.roleApplicationDocument.create({
      data: { applicationId: roleApplication.id, label: "Driver's licence", storageKey: 'real-licence-photo-key', contentType: 'image/jpeg', sizeBytes: 1024 },
    });
    const resume = await ctx.prisma.jobSeekerResume.create({
      data: { profileId: jobSeeker.id, label: 'My real CV', storageKey: 'real-resume-key', mimeType: 'application/pdf', fileSizeBytes: 2048 },
    });

    // Acceptance round 4 — the fifth PII family: PropertyDocument. Owned
    // listing: this deleting user is the OWNER, so its documents are this
    // account's own identity/ownership paperwork and must be anonymized.
    const ownedListing = await ctx.prisma.propertyListing.create({
      data: {
        ownerProfileId: propertyOwner.id,
        purpose: 'FOR_SALE',
        propertyType: 'HOUSE',
        title: 'Owned Listing',
        slug: 'full-sweep-owned-listing',
        reference: 'FS-OWNED-1',
        description: 'A real listing this account owns.',
        priceMinor: 50_000_00n,
      },
    });
    const ownedListingDocument = await ctx.prisma.propertyDocument.create({
      data: { listingId: ownedListing.id, kind: 'TITLE_DEED', label: 'Real title deed', storageKey: 'real-title-deed-key', mimeType: 'application/pdf', fileSizeBytes: 4096 },
    });

    // A SEPARATE, still-active owner's listing, where this deleting user is
    // only the AGENT representing it. Its documents must be LEFT ALONE —
    // they are the other owner's legal paperwork, not this account's.
    const otherOwnerUser = await ctx.prisma.user.create({ data: { email: 'other-owner@example.bz', passwordHash: 'x', firstName: 'Other', lastName: 'Owner' } });
    const otherOwner = await ctx.prisma.propertyOwnerProfile.create({
      data: { userId: otherOwnerUser.id, legalName: 'Other Real Owner', phone: '6650099', email: 'other-owner@example.bz' },
    });
    const agentedListing = await ctx.prisma.propertyListing.create({
      data: {
        ownerProfileId: otherOwner.id,
        agentProfileId: agent.id,
        purpose: 'FOR_RENT',
        propertyType: 'APARTMENT',
        title: 'Agented Listing',
        slug: 'full-sweep-agented-listing',
        reference: 'FS-AGENTED-1',
        description: 'A real listing this account only agents for someone else.',
        priceMinor: 1_200_00n,
      },
    });
    const agentedListingDocument = await ctx.prisma.propertyDocument.create({
      data: { listingId: agentedListing.id, kind: 'OWNER_AUTHORIZATION', label: "Other owner's authorization", storageKey: 'real-other-owner-authorization-key', mimeType: 'application/pdf', fileSizeBytes: 4096 },
    });

    const res = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(res.status).toBe(200);

    expect(await ctx.prisma.savedAddress.count({ where: { userId } })).toBe(0);

    // The field the whole Defect 1 leak-closure claim rests on (acceptance
    // round 3): displayName is what delivery-core/reviews/passenger-network
    // actually read, so an assertion that misses it would pass even if the
    // leak were still open. Asserting the DEFINED replacement, not merely
    // .not.toBe(real value) — the same shape as the round-1 rejection,
    // closed properly here rather than left to recur a third time.
    const driverAfter = await ctx.prisma.driverProfile.findUniqueOrThrow({ where: { id: driver.id } });
    expect(driverAfter.legalName).toBe('Deleted Driver');
    expect(driverAfter.displayName).toBe('Deleted Driver');
    expect(driverAfter.phone).toBe('REMOVED');
    expect(driverAfter.homeAddress).toBeNull();
    expect(driverAfter.latitude).toBeNull();
    expect(driverAfter.longitude).toBeNull();
    expect(driverAfter.emergencyContactName).toBeNull();
    expect(driverAfter.emergencyContactPhone).toBeNull();
    expect(driverAfter.licenceNumber).toBe(`DELETED-${driver.id}`);
    expect(driverAfter.profilePhotoKey).toBeNull();
    expect(driverAfter.isActive).toBe(false);
    expect(driverAfter.availability).toBe('OFFLINE');

    const vehicleAfter = await ctx.prisma.driverVehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(vehicleAfter.licencePlate).toBe(`DELETED-${vehicle.id}`);
    expect(vehicleAfter.registrationNumber).toBeNull();
    expect(vehicleAfter.insuranceProvider).toBeNull();
    expect(vehicleAfter.insurancePolicyNumber).toBeNull();

    const paxDriverAfter = await ctx.prisma.passengerDriverProfile.findUniqueOrThrow({ where: { id: paxDriver.id } });
    expect(paxDriverAfter.legalName).toBe('Deleted Driver');
    expect(paxDriverAfter.displayName).toBe('Deleted Driver');
    expect(paxDriverAfter.phone).toBe('REMOVED');
    expect(paxDriverAfter.licenceNumber).toBe(`DELETED-${paxDriver.id}`);
    expect(paxDriverAfter.isActive).toBe(false);

    // MDF-949: this account's own passenger vehicle is anonymized, the same
    // treatment as DriverVehicle.
    const paxVehicleAfter = await ctx.prisma.passengerVehicle.findUniqueOrThrow({ where: { id: paxVehicle.id } });
    expect(paxVehicleAfter.licencePlate).toBe(`DELETED-${paxVehicle.id}`);
    expect(paxVehicleAfter.registrationNumber).toBeNull();
    expect(paxVehicleAfter.insuranceProvider).toBeNull();
    expect(paxVehicleAfter.insurancePolicyNumber).toBeNull();

    // MDF-949: a fleet vehicle this account's business owns, but which a
    // SEPARATE still-active driver is assigned to, is left completely
    // alone — see anonymizePersonalData's doc comment for why.
    const fleetVehicleAfter = await ctx.prisma.passengerVehicle.findUniqueOrThrow({ where: { id: fleetVehicle.id } });
    expect(fleetVehicleAfter.licencePlate).toBe('REAL-FLEET-PLATE-1');

    // Defect 1, read through the ACTUAL customer-facing endpoint, not just
    // the row — delivery-core.service.ts's driverSummary() reads
    // DriverProfile.displayName directly, and this proves that call site,
    // not just the data, no longer leaks the real name.
    const deliveryView = await request(ctx.server)
      .get(`/api/deliveries/${completedDelivery.id}`)
      .set('Cookie', deliveryCustomer.cookies);
    expect(deliveryView.status).toBe(200);
    expect(deliveryView.body.driver.displayName).toBe('Deleted Driver');
    expect(JSON.stringify(deliveryView.body)).not.toContain('Real Driver Name');

    const jobSeekerAfter = await ctx.prisma.jobSeekerProfile.findUniqueOrThrow({ where: { id: jobSeeker.id } });
    expect(jobSeekerAfter.preferredName).toBe('Deleted');
    expect(jobSeekerAfter.legalName).toBeNull();
    expect(jobSeekerAfter.contactEmail).toBeNull();
    expect(jobSeekerAfter.contactPhone).toBeNull();

    const resumeAfter = await ctx.prisma.jobSeekerResume.findUniqueOrThrow({ where: { id: resume.id } });
    expect(resumeAfter.storageKey).toBe(`deleted-${resume.id}`);
    expect(resumeAfter.label).toBe('Removed');

    const roleDocumentAfter = await ctx.prisma.roleApplicationDocument.findUniqueOrThrow({ where: { id: roleDocument.id } });
    expect(roleDocumentAfter.storageKey).toBe(`deleted-${roleDocument.id}`);
    expect(roleDocumentAfter.label).toBeNull();
    // contentType carries no personal data — left alone, see the doc comment.
    expect(roleDocumentAfter.contentType).toBe('image/jpeg');

    const vendorAfter = await ctx.prisma.vendorProfile.findUniqueOrThrow({ where: { id: vendor.id } });
    // Business identity is left — see anonymizePersonalData's doc comment.
    expect(vendorAfter.businessName).toBe('Full Sweep Store');
    expect(vendorAfter.contactEmail).toBe(`deleted-${vendor.id}@deleted.bmpl.internal`);
    expect(vendorAfter.contactPhone).toBeNull();
    expect(vendorAfter.approvalStatus).toBe('SUSPENDED');

    const locationAfter = await ctx.prisma.vendorLocation.findUniqueOrThrow({ where: { id: location.id } });
    expect(locationAfter.addressLine1).toBe('Address removed');

    const employerAfter = await ctx.prisma.employerProfile.findUniqueOrThrow({ where: { id: employer.id } });
    expect(employerAfter.contactEmail).toBe(`deleted-${employer.id}@deleted.bmpl.internal`);
    expect(employerAfter.contactPhone).toBeNull();
    expect(employerAfter.companyName).toBe('Full Sweep Employer');

    const propertyOwnerAfter = await ctx.prisma.propertyOwnerProfile.findUniqueOrThrow({ where: { id: propertyOwner.id } });
    expect(propertyOwnerAfter.legalName).toBe('Deleted Owner');
    expect(propertyOwnerAfter.phone).toBeNull();
    expect(propertyOwnerAfter.email).toBeNull();

    const agentAfter = await ctx.prisma.realEstateAgentProfile.findUniqueOrThrow({ where: { id: agent.id } });
    expect(agentAfter.displayName).toBe('Deleted Agent');
    expect(agentAfter.phone).toBeNull();
    expect(agentAfter.isActive).toBe(false);

    // Acceptance round 4: PropertyDocument on a listing this account OWNS
    // is anonymized, the same treatment as RoleApplicationDocument.
    const ownedListingDocumentAfter = await ctx.prisma.propertyDocument.findUniqueOrThrow({ where: { id: ownedListingDocument.id } });
    expect(ownedListingDocumentAfter.storageKey).toBe(`deleted-${ownedListingDocument.id}`);
    expect(ownedListingDocumentAfter.label).toBeNull();

    // PropertyDocument on a listing this account only AGENTS for a
    // different, still-active owner is left completely alone — that
    // owner's title deed is not this departing account's record to
    // rewrite. See anonymizePersonalData's doc comment for why.
    const agentedListingDocumentAfter = await ctx.prisma.propertyDocument.findUniqueOrThrow({ where: { id: agentedListingDocument.id } });
    expect(agentedListingDocumentAfter.storageKey).toBe('real-other-owner-authorization-key');
    expect(agentedListingDocumentAfter.label).toBe("Other owner's authorization");

    const agencyAfter = await ctx.prisma.agencyProfile.findUniqueOrThrow({ where: { id: agency.id } });
    expect(agencyAfter.contactEmail).toBe(`deleted-agency-${agency.id}@deleted.bmpl.internal`);
    expect(agencyAfter.contactPhone).toBeNull();
    expect(agencyAfter.name).toBe('Full Sweep Agency');

    const passengerProviderAfter = await ctx.prisma.passengerProviderProfile.findUniqueOrThrow({ where: { id: passengerProvider.id } });
    expect(passengerProviderAfter.contactEmail).toBe(`deleted-${passengerProvider.id}@deleted.bmpl.internal`);
    expect(passengerProviderAfter.contactPhone).toBeNull();
    expect(passengerProviderAfter.addressLine1).toBeNull();
    expect(passengerProviderAfter.operatingLicenceNumber).toBeNull();
    expect(passengerProviderAfter.businessName).toBe('Full Sweep Transport');

    const shippingProviderAfter = await ctx.prisma.shippingProviderProfile.findUniqueOrThrow({ where: { id: shippingProvider.id } });
    expect(shippingProviderAfter.contactEmail).toBe(`deleted-${shippingProvider.id}@deleted.bmpl.internal`);
    expect(shippingProviderAfter.contactPhone).toBeNull();
    expect(shippingProviderAfter.addressLine1).toBeNull();
    expect(shippingProviderAfter.operatingLicenceNumber).toBeNull();
    expect(shippingProviderAfter.businessName).toBe('Full Sweep Carrier');
  });

  /**
   * ACCT-DELETE-STORAGE-OBJECTS. The prior test only ever checked that a
   * storage KEY was nulled out of the database row — it never checked
   * whether the actual OBJECT was deleted from the bucket it really lives
   * in. That matters because an S3 `DeleteObject` against a key absent
   * from the bucket you hit returns 200, not 404: a delete issued against
   * the WRONG bucket looks exactly like a real delete and leaves the file
   * sitting there forever. This test uploads real objects to the REAL
   * bucket each key actually belongs to (mixing public and private on
   * purpose) and, after deletion, re-heads every one of them in that same
   * real bucket — proving the object is actually gone, not just that the
   * column is null. Also covers the four logo/banner keys
   * (VendorProfile, EmployerProfile, AgencyProfile,
   * PassengerProviderProfile) that `anonymizePersonalData` never
   * referenced at all before this card.
   */
  it('deletes every orphaned storage object from the bucket it was actually uploaded to — public logos/banners/photos AND private documents/photos alike', async () => {
    const email = 'delete-storage-objects@example.bz';
    const password = 'StorageObjPass12345';
    const { cookies, userId } = await registerAndLogin(email, password);

    const driver = await ctx.prisma.driverProfile.create({
      data: {
        userId,
        legalName: 'Storage Test Driver',
        displayName: 'Storage Test Driver',
        phone: '6650030',
        homeDistrict: 'BELIZE',
        licenceNumber: 'STORAGE-LICENCE-1',
        licenceExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });
    const vendor = await ctx.prisma.vendorProfile.create({
      data: { userId, businessName: 'Storage Test Store', slug: 'storage-test-store', contactEmail: 'storagevendor@example.bz' },
    });
    const employer = await ctx.prisma.employerProfile.create({
      data: { userId, companyName: 'Storage Test Employer', slug: 'storage-test-employer', contactEmail: 'storageemployer@example.bz' },
    });
    const agency = await ctx.prisma.agencyProfile.create({
      data: { managerUserId: userId, name: 'Storage Test Agency', slug: 'storage-test-agency', contactEmail: 'storageagency@example.bz' },
    });
    const agent = await ctx.prisma.realEstateAgentProfile.create({
      data: { userId, displayName: 'Storage Test Agent', slug: 'storage-test-agent' },
    });
    const passengerProvider = await ctx.prisma.passengerProviderProfile.create({
      data: { userId, businessName: 'Storage Test Transport', contactEmail: 'storagepax@example.bz' },
    });
    const roleApplication = await ctx.prisma.roleApplication.create({
      data: { userId, roleCode: 'DELIVERY_DRIVER', status: 'PENDING' },
    });

    // Real objects, each in the REAL bucket that key type actually lives
    // in — public and private on purpose, in the same fixture.
    const png = Buffer.from('storage-test-object');
    const vendorLogoKey = 'vendors/storage-test/logo.png';
    const vendorBannerKey = 'vendors/storage-test/banner.png';
    const employerLogoKey = 'employers/storage-test/logo.png';
    const employerBannerKey = 'employers/storage-test/banner.png';
    const agencyLogoKey = 'agencies/storage-test/logo.png';
    const agencyBannerKey = 'agencies/storage-test/banner.png';
    const agentPhotoKey = 'agents/storage-test/photo.png';
    const passengerProviderLogoKey = 'passenger-providers/storage-test/logo.png';
    for (const key of [
      vendorLogoKey,
      vendorBannerKey,
      employerLogoKey,
      employerBannerKey,
      agencyLogoKey,
      agencyBannerKey,
      agentPhotoKey,
      passengerProviderLogoKey,
    ]) {
      await storage.putObject(key, png, 'image/png', 'public');
    }

    const driverPhotoKey = 'drivers/storage-test/photo.png';
    const roleDocKey = 'applications/storage-test/licence.png';
    for (const key of [driverPhotoKey, roleDocKey]) {
      await storage.putObject(key, png, 'image/png', 'private');
    }

    await ctx.prisma.driverProfile.update({ where: { id: driver.id }, data: { profilePhotoKey: driverPhotoKey } });
    await ctx.prisma.vendorProfile.update({ where: { id: vendor.id }, data: { logoKey: vendorLogoKey, bannerKey: vendorBannerKey } });
    await ctx.prisma.employerProfile.update({ where: { id: employer.id }, data: { logoKey: employerLogoKey, bannerKey: employerBannerKey } });
    await ctx.prisma.agencyProfile.update({ where: { id: agency.id }, data: { logoKey: agencyLogoKey, bannerKey: agencyBannerKey } });
    await ctx.prisma.realEstateAgentProfile.update({ where: { id: agent.id }, data: { photoKey: agentPhotoKey } });
    await ctx.prisma.passengerProviderProfile.update({ where: { id: passengerProvider.id }, data: { logoKey: passengerProviderLogoKey } });
    const roleDocument = await ctx.prisma.roleApplicationDocument.create({
      data: { applicationId: roleApplication.id, label: 'Licence', storageKey: roleDocKey, contentType: 'image/png', sizeBytes: png.length },
    });

    // Sanity: every object is really there before deletion, in the bucket
    // the fixture just put it in.
    for (const key of [vendorLogoKey, vendorBannerKey, employerLogoKey, employerBannerKey, agencyLogoKey, agencyBannerKey, agentPhotoKey, passengerProviderLogoKey]) {
      expect(await storage.headObject(key, 'public')).not.toBeNull();
    }
    for (const key of [driverPhotoKey, roleDocKey]) {
      expect(await storage.headObject(key, 'private')).not.toBeNull();
    }

    const res = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(res.status).toBe(200);

    // The DB columns are nulled — the gap this card closes.
    const vendorAfter = await ctx.prisma.vendorProfile.findUniqueOrThrow({ where: { id: vendor.id } });
    expect(vendorAfter.logoKey).toBeNull();
    expect(vendorAfter.bannerKey).toBeNull();
    const employerAfter = await ctx.prisma.employerProfile.findUniqueOrThrow({ where: { id: employer.id } });
    expect(employerAfter.logoKey).toBeNull();
    expect(employerAfter.bannerKey).toBeNull();
    const agencyAfter = await ctx.prisma.agencyProfile.findUniqueOrThrow({ where: { id: agency.id } });
    expect(agencyAfter.logoKey).toBeNull();
    expect(agencyAfter.bannerKey).toBeNull();
    const passengerProviderAfter = await ctx.prisma.passengerProviderProfile.findUniqueOrThrow({ where: { id: passengerProvider.id } });
    expect(passengerProviderAfter.logoKey).toBeNull();
    const agentAfter = await ctx.prisma.realEstateAgentProfile.findUniqueOrThrow({ where: { id: agent.id } });
    expect(agentAfter.photoKey).toBeNull();

    // The actual objects are gone from the REAL bucket they lived in — not
    // merely "DeleteObject returned 200 against the wrong bucket while the
    // object survives." This is the assertion the old default-to-private
    // code would have failed: every one of these eight keys only ever
    // existed in the PUBLIC bucket, and the old deleteQuietly/deleteObject
    // default silently issued every delete against the PRIVATE bucket,
    // which would have returned 200 and deleted nothing.
    for (const key of [vendorLogoKey, vendorBannerKey, employerLogoKey, employerBannerKey, agencyLogoKey, agencyBannerKey, agentPhotoKey, passengerProviderLogoKey]) {
      expect(await storage.headObject(key, 'public')).toBeNull();
    }
    // And the private-bucket objects are also really gone, in their own bucket.
    for (const key of [driverPhotoKey, roleDocKey]) {
      expect(await storage.headObject(key, 'private')).toBeNull();
    }
    const roleDocumentAfter = await ctx.prisma.roleApplicationDocument.findUniqueOrThrow({ where: { id: roleDocument.id } });
    expect(roleDocumentAfter.storageKey).toBe(`deleted-${roleDocument.id}`);
  });

  it('scrubs free text this account wrote and network identifiers it left behind — without deleting the counterparty\'s words or any audit row (ACCT-DELETE-PII-REMNANTS)', async () => {
    const email = 'delete-pii-remnants@example.bz';
    const password = 'PiiRemnantsPass1';
    const { cookies, userId } = await registerAndLogin(email, password);

    // Defect 1: free text the person wrote themselves, not caught by any
    // prior round. headline/summary on the SAME jobSeekerProfile row whose
    // other fields are already cleared elsewhere.
    const jobSeeker = await ctx.prisma.jobSeekerProfile.create({
      data: { userId, preferredName: 'Real Seeker', headline: 'Senior Real Headline', summary: 'My phone is 6650099, call anytime.' },
    });

    // A support case: subject + opening message are both this account's own
    // free text, and god's exact finding — CONVERSATION_CREATED's own audit
    // payload carries a second copy of the subject.
    const opened = await request(ctx.server)
      .post('/api/conversations/support')
      .set('Cookie', cookies)
      .send({ subject: 'My number is 6650099, please call', message: 'Hi, this is my own message, call 6650099.' });
    expect(opened.status).toBe(201);
    const conversationId = opened.body.id as string;
    const ownMessage = await ctx.prisma.message.findFirstOrThrow({ where: { conversationId, senderId: userId } });

    // The OTHER side of the same thread — a different account's own words,
    // seeded directly (no staff-join endpoint needed to prove the point):
    // must survive this account's own deletion untouched.
    const other = await registerAndLogin('delete-pii-remnants-other@example.bz', 'OtherPartyPass1');
    await ctx.prisma.conversationParticipant.create({ data: { conversationId, userId: other.userId, role: 'SUPPORT' } });
    const otherMessage = await ctx.prisma.message.create({
      data: { conversationId, senderId: other.userId, type: 'USER', body: 'Staff reply: noted, thanks.' },
    });

    // Defect 2: a real session with a real IP/user-agent, and a non-deletion
    // audit row (the login that produced it) also carrying that IP.
    const loggedIn = await request(ctx.server)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '203.0.113.9')
      .set('User-Agent', 'PiiRemnantsTestAgent/1.0')
      .send({ email, password });
    expect(loggedIn.status).toBe(201);
    const sessionBefore = await ctx.prisma.session.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: 'desc' } });
    expect(sessionBefore.ipAddress).not.toBeNull();
    const loginAuditBefore = await ctx.prisma.auditLog.findFirstOrThrow({ where: { action: 'USER_LOGGED_IN', actorId: userId }, orderBy: { createdAt: 'desc' } });
    expect(loginAuditBefore.ipAddress).not.toBeNull();

    const del = await request(ctx.server).delete('/api/me').set('Cookie', cookies).send({ currentPassword: password });
    expect(del.status).toBe(200);

    // Defect 1, resolved.
    const jobSeekerAfter = await ctx.prisma.jobSeekerProfile.findUniqueOrThrow({ where: { id: jobSeeker.id } });
    expect(jobSeekerAfter.headline).toBeNull();
    expect(jobSeekerAfter.summary).toBeNull();

    const conversationAfter = await ctx.prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(conversationAfter.subject).toBeNull();
    const ownMessageAfter = await ctx.prisma.message.findUniqueOrThrow({ where: { id: ownMessage.id } });
    expect(ownMessageAfter.body).toBe('[removed]');
    // The counterparty's own words, in the SAME conversation, are untouched.
    const otherMessageAfter = await ctx.prisma.message.findUniqueOrThrow({ where: { id: otherMessage.id } });
    expect(otherMessageAfter.body).toBe('Staff reply: noted, thanks.');

    // ACCT-DELETE-SYSTEM-MESSAGE-SUBJECT (Stanley's re-walk): the subject
    // the person typed also survived, verbatim, inside the conversation-start
    // SYSTEM message — nulling Conversation.subject never touched it, because
    // the USER-message sweep above is scoped to type USER, and this message
    // is type SYSTEM. It must be scrubbed the same way the subject itself was.
    const systemMessage = await ctx.prisma.message.findFirstOrThrow({ where: { conversationId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    expect(systemMessage.type).toBe('SYSTEM');
    expect(systemMessage.body).not.toContain('6650099');
    expect(systemMessage.body).not.toContain('My number is 6650099, please call');

    // The audit row IS kept (never deleted) — only the one PII-bearing key
    // inside its payload is redacted.
    const createdAudit = await ctx.prisma.auditLog.findFirstOrThrow({ where: { action: 'CONVERSATION_CREATED', actorId: userId } });
    expect(createdAudit).toBeTruthy();
    expect((createdAudit.newValue as Record<string, unknown>).subject).toBeNull();
    expect((createdAudit.newValue as Record<string, unknown>).conversationId).toBe(conversationId); // the rest of the payload survives

    // Defect 2, resolved: the row stays, the IP/user-agent do not.
    const sessionAfter = await ctx.prisma.session.findUniqueOrThrow({ where: { id: sessionBefore.id } });
    expect(sessionAfter.ipAddress).toBeNull();
    expect(sessionAfter.userAgent).toBeNull();
    expect(sessionAfter.revokedAt).not.toBeNull(); // still revoked, exactly as before this card
    const loginAuditAfter = await ctx.prisma.auditLog.findUniqueOrThrow({ where: { id: loginAuditBefore.id } });
    expect(loginAuditAfter.ipAddress).toBeNull();
    expect(loginAuditAfter.action).toBe('USER_LOGGED_IN'); // the row itself is untouched otherwise

    // The USER_ACCOUNT_DELETED row this very call just wrote is caught too —
    // not left as the one exception standing.
    const deletionAudit = await ctx.prisma.auditLog.findFirstOrThrow({ where: { action: 'USER_ACCOUNT_DELETED', targetUserId: userId } });
    expect(deletionAudit.ipAddress).toBeNull();

    // The still-active other party's own account is entirely untouched.
    const otherUser = await ctx.prisma.user.findUniqueOrThrow({ where: { id: other.userId } });
    expect(otherUser.status).toBe('ACTIVE');
  });
});
