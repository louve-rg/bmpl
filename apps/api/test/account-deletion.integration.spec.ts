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
    const trip = await ctx.prisma.passengerTrip.create({
      data: { reference: 'PAX-DEL-TEST-2', kind: 'SCHEDULED', status: 'SCHEDULED', providerProfileId: provider.id },
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
    // transport business, currently assigned to a SEPARATE, still-active
    // driver. Must be LEFT ALONE even though the fleet's owner is the
    // account being deleted — that driver may be using it right now.
    const otherPaxDriverUser = await ctx.prisma.user.create({ data: { email: 'other-pax-driver@example.bz', passwordHash: 'x', firstName: 'Other', lastName: 'PaxDriver' } });
    const otherPaxDriver = await ctx.prisma.passengerDriverProfile.create({
      data: { userId: otherPaxDriverUser.id, legalName: 'Other Pax Driver', displayName: 'Other Pax Driver', phone: '6650098', homeDistrict: 'BELIZE', licenceNumber: 'OTHER-PAX-LICENCE-1', licenceExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) },
    });
    const fleetVehicle = await ctx.prisma.passengerVehicle.create({
      data: { providerProfileId: passengerProvider.id, type: 'VAN', make: 'Toyota', model: 'Hiace', licencePlate: 'REAL-FLEET-PLATE-1', seatCapacity: 10 },
    });
    await ctx.prisma.passengerFleetAffiliation.create({
      data: { providerProfileId: passengerProvider.id, driverProfileId: otherPaxDriver.id, initiatedBy: 'PROVIDER', status: 'ACCEPTED', acceptedAt: new Date() },
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
});
