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
      },
    });
    const vehicle = await ctx.prisma.driverVehicle.create({
      data: { driverProfileId: driver.id, type: 'CAR', make: 'Toyota', model: 'Hilux', licencePlate: 'REAL-PLATE-1' },
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
    const jobSeeker = await ctx.prisma.jobSeekerProfile.create({
      data: { userId, preferredName: 'Real Seeker', legalName: 'Real Seeker Legal', contactEmail: 'seeker@example.bz', contactPhone: '6650014' },
    });
    const vendor = await ctx.prisma.vendorProfile.create({
      data: { userId, businessName: 'Full Sweep Store', slug: 'full-sweep-store', contactEmail: 'fullsweep@example.bz', approvalStatus: 'APPROVED' },
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

    const res = await request(ctx.server)
      .delete('/api/me')
      .set('Cookie', cookies)
      .send({ currentPassword: password });
    expect(res.status).toBe(200);

    expect(await ctx.prisma.savedAddress.count({ where: { userId } })).toBe(0);

    const driverAfter = await ctx.prisma.driverProfile.findUniqueOrThrow({ where: { id: driver.id } });
    expect(driverAfter.legalName).not.toBe('Real Driver Name');
    expect(driverAfter.phone).not.toBe('6650011');
    expect(driverAfter.homeAddress).toBeNull();
    expect(driverAfter.latitude).toBeNull();
    expect(driverAfter.emergencyContactName).toBeNull();
    expect(driverAfter.licenceNumber).not.toBe('REAL-LICENCE-1');
    expect(driverAfter.isActive).toBe(false);
    expect(driverAfter.availability).toBe('OFFLINE');

    const vehicleAfter = await ctx.prisma.driverVehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(vehicleAfter.licencePlate).not.toBe('REAL-PLATE-1');

    const paxDriverAfter = await ctx.prisma.passengerDriverProfile.findUniqueOrThrow({ where: { id: paxDriver.id } });
    expect(paxDriverAfter.legalName).not.toBe('Real Pax Driver');
    expect(paxDriverAfter.licenceNumber).not.toBe('REAL-PAX-LICENCE-1');
    expect(paxDriverAfter.isActive).toBe(false);

    const jobSeekerAfter = await ctx.prisma.jobSeekerProfile.findUniqueOrThrow({ where: { id: jobSeeker.id } });
    expect(jobSeekerAfter.preferredName).not.toBe('Real Seeker');
    expect(jobSeekerAfter.legalName).toBeNull();
    expect(jobSeekerAfter.contactEmail).toBeNull();
    expect(jobSeekerAfter.contactPhone).toBeNull();

    const vendorAfter = await ctx.prisma.vendorProfile.findUniqueOrThrow({ where: { id: vendor.id } });
    // Business identity is left — see anonymizePersonalData's doc comment.
    expect(vendorAfter.businessName).toBe('Full Sweep Store');
    expect(vendorAfter.approvalStatus).toBe('SUSPENDED');

    const locationAfter = await ctx.prisma.vendorLocation.findUniqueOrThrow({ where: { id: location.id } });
    expect(locationAfter.addressLine1).not.toBe('456 Real Ave');

    const employerAfter = await ctx.prisma.employerProfile.findUniqueOrThrow({ where: { id: employer.id } });
    expect(employerAfter.contactEmail).not.toBe('employer@example.bz');
    expect(employerAfter.contactPhone).toBeNull();
    expect(employerAfter.companyName).toBe('Full Sweep Employer');

    const propertyOwnerAfter = await ctx.prisma.propertyOwnerProfile.findUniqueOrThrow({ where: { id: propertyOwner.id } });
    expect(propertyOwnerAfter.legalName).not.toBe('Real Owner');
    expect(propertyOwnerAfter.phone).toBeNull();
    expect(propertyOwnerAfter.email).toBeNull();

    const agentAfter = await ctx.prisma.realEstateAgentProfile.findUniqueOrThrow({ where: { id: agent.id } });
    expect(agentAfter.displayName).not.toBe('Real Agent');
    expect(agentAfter.phone).toBeNull();
    expect(agentAfter.isActive).toBe(false);

    const agencyAfter = await ctx.prisma.agencyProfile.findUniqueOrThrow({ where: { id: agency.id } });
    expect(agencyAfter.contactEmail).not.toBe('agency@example.bz');
    expect(agencyAfter.contactPhone).toBeNull();
    expect(agencyAfter.name).toBe('Full Sweep Agency');
  });
});
