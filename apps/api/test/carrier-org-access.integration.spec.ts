/**
 * Carrier organizations (BMPL-137), against real Postgres.
 *
 * The claim this suite exists to defend: A CARRIER'S PEOPLE CAN MOVE EXACTLY
 * THEIR ORGANIZATION'S TRANSPORT LEGS, AND NOTHING ELSE. The org is a row
 * (the profile), who may act for it is a membership resolved fresh per
 * request, and every write funnels into the same leg state machine the admin
 * console uses — so sequencing, custody and status derivation hold whichever
 * door the transition came through, on a boat and on a plane alike.
 *
 * Carried over from the discarded user-level prior art: the allowlist
 * deep-scan, the probe-404-identity, state-machine reuse, and the symmetric
 * isTest refusals.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let customer: string[];
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const put = (c: string[], p: string, b: object = {}) => request(ctx.server).put(`/api/${p}`).set('Cookie', c).send(b);
const patch = (c: string[], p: string, b: object = {}) => request(ctx.server).patch(`/api/${p}`).set('Cookie', c).send(b);
const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);

let hub: Record<string, string> = {};
let route: Record<'SEA' | 'AIR', string>;

async function registerUser(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

async function approveProviderRole(userId: string) {
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'SHIPPING_PROVIDER' } },
    create: { userId, roleCode: 'SHIPPING_PROVIDER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
}

/** An org: approved owner + self-service profile (which births the OWNER row). */
async function makeCarrier(name: string) {
  const owner = await registerUser(`xown_${uniq()}@example.com`);
  await approveProviderRole(owner.userId);
  const created = await put(owner.cookies, 'shipping/provider/profile', {
    businessName: name,
    contactEmail: `ops_${uniq()}@example.com`,
  });
  expect(created.status).toBe(200);
  return { ...owner, profileId: created.body.id as string };
}

/** A staff member: approved role (phase-1 two-gate) + admin-added membership. */
async function makeStaff(profileId: string) {
  const staff = await registerUser(`xstf_${uniq()}@example.com`);
  await approveProviderRole(staff.userId);
  expect((await post(admin, `admin/logistics/providers/${profileId}/members`, { userId: staff.userId })).status).toBe(201);
  return staff;
}

/** Water and air, so nothing here can quietly become mode-specific. */
async function seedNetwork() {
  hub = {};
  for (const h of [
    { code: 'SPW', name: 'San Pedro Water Taxi Terminal', type: 'WATER_TAXI_TERMINAL', city: 'San Pedro', modes: ['LAND', 'SEA'] },
    { code: 'BZW', name: 'Belize City Water Taxi Terminal', type: 'WATER_TAXI_TERMINAL', city: 'Belize City', modes: ['LAND', 'SEA'] },
    { code: 'SPA', name: 'San Pedro Airstrip', type: 'AIRSTRIP', city: 'San Pedro', modes: ['LAND', 'AIR'] },
    { code: 'MUN', name: 'Belize City Municipal Airstrip', type: 'AIRSTRIP', city: 'Belize City', modes: ['LAND', 'AIR'] },
  ]) {
    const r = await post(admin, 'admin/logistics/hubs', {
      code: h.code, name: h.name, type: h.type, district: 'BELIZE', city: h.city, modes: h.modes, courierFeeMinor: 1000,
    });
    expect(r.status).toBe(201);
    hub[h.code] = r.body.id;
  }
  route = { SEA: '', AIR: '' };
  for (const r of [
    { key: 'SEA' as const, from: 'SPW', to: 'BZW', mode: 'SEA', carrierName: 'UAT Water Taxi' },
    { key: 'AIR' as const, from: 'SPA', to: 'MUN', mode: 'AIR', carrierName: 'UAT Island Air' },
  ]) {
    const made = await post(admin, 'admin/logistics/routes', {
      originHubId: hub[r.from], destinationHubId: hub[r.to], mode: r.mode,
      durationMinutes: 60, priceMinor: 3000, carrierName: r.carrierName,
    });
    expect(made.status).toBe(201);
    route[r.key] = made.body.id;
  }
}

/** Terminal to terminal: one LINE_HAUL, READY the moment it is paid. */
async function bookHubToHub(mode: 'SEA' | 'AIR') {
  const [o, d] = mode === 'SEA' ? ['SPW', 'BZW'] : ['SPA', 'MUN'];
  const r = await post(customer, 'shipping', {
    service: 'HUB_TO_HUB',
    origin: { hubId: hub[o!]!, name: 'Sender Sentinelname', phone: '501-2223333' },
    destination: { hubId: hub[d!]!, name: 'Recipient Sentinelname', phone: '501-4445555' },
    preferredMode: mode,
    description: 'One box',
    payWithWallet: true,
  });
  expect(r.status).toBe(201);
  return r.body;
}

const legsOf = (shipmentId: string) =>
  ctx.prisma.shipmentLeg.findMany({ where: { shipmentId }, orderBy: { sequence: 'asc' } });

const setOperator = (legId: string, providerProfileId: string | null) =>
  post(admin, `admin/logistics/legs/${legId}/operator`, { providerProfileId });

async function pinOf(legId: string) {
  const leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId }, select: { handoffPin: true } });
  return leg.handoffPin!;
}

/** Booked on `mode`, its single line-haul assigned to the org. */
async function bookedFor(profileId: string, mode: 'SEA' | 'AIR' = 'SEA') {
  const s = await bookHubToHub(mode);
  const [leg] = await legsOf(s.id);
  expect((await setOperator(leg!.id, profileId)).status).toBe(201);
  return { shipment: s, leg: leg! };
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
  await ctx.prisma.shipmentLegOffer.deleteMany();
  await ctx.prisma.custodyEvent.deleteMany();
  await ctx.prisma.shipmentLeg.deleteMany();
  await ctx.prisma.shipment.deleteMany();
  await ctx.prisma.logisticsRoute.deleteMany();
  await ctx.prisma.logisticsHub.deleteMany();
  await ctx.prisma.shippingProviderMember.deleteMany();
  await ctx.prisma.shippingProviderProfile.deleteMany();
  const c = await registerUser(`xcust_${uniq()}@example.com`);
  customer = c.cookies;
  await post(admin, 'admin/wallet/test-credit', { userId: c.userId, amountMinor: 100_000, reason: 'Carrier org fixture.' });
  await seedNetwork();
});

/* ------------------------------------------------------------------------- */

describe('the organization', () => {
  it('is born by self-service upsert — the passenger mirror — with its OWNER membership', async () => {
    const carrier = await makeCarrier('Reef Runner Ltd');
    const member = await ctx.prisma.shippingProviderMember.findUniqueOrThrow({
      where: { providerProfileId_userId: { providerProfileId: carrier.profileId, userId: carrier.userId } },
    });
    expect(member.memberRole).toBe('OWNER');
    expect(member.status).toBe('ACTIVE');
    // Round-trip and partial update, same as the passenger profile.
    expect((await get(carrier.cookies, 'shipping/provider/profile')).body.businessName).toBe('Reef Runner Ltd');
    expect((await patch(carrier.cookies, 'shipping/provider/profile', { city: 'San Pedro' })).body.city).toBe('San Pedro');
    // An account that has not applied yet can still START a profile (@Roles CUSTOMER).
    const applicant = await registerUser(`xapp_${uniq()}@example.com`);
    expect((await put(applicant.cookies, 'shipping/provider/profile', {
      businessName: 'Not Yet Approved Freight', contactEmail: 'nya@example.com',
    })).status).toBe(200);
  });

  it('admin adds, ends, and reactivates STAFF — and cannot end the OWNER', async () => {
    const carrier = await makeCarrier('Reef Runner Ltd');
    const staff = await makeStaff(carrier.profileId);
    const row = await ctx.prisma.shippingProviderMember.findUniqueOrThrow({
      where: { providerProfileId_userId: { providerProfileId: carrier.profileId, userId: staff.userId } },
    });
    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'SHIPPING_PROVIDER_MEMBER_CHANGED' }, orderBy: { createdAt: 'desc' } });
    expect(audit?.targetUserId).toBe(staff.userId);

    expect((await post(admin, `admin/logistics/providers/${carrier.profileId}/members/${staff.userId}/end`)).status).toBe(201);
    // Re-adding reactivates the SAME row rather than growing a second one.
    expect((await post(admin, `admin/logistics/providers/${carrier.profileId}/members`, { userId: staff.userId })).status).toBe(201);
    const after = await ctx.prisma.shippingProviderMember.findMany({ where: { providerProfileId: carrier.profileId, userId: staff.userId } });
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(row.id);
    expect(after[0]!.status).toBe('ACTIVE');

    const ownerEnd = await post(admin, `admin/logistics/providers/${carrier.profileId}/members/${carrier.userId}/end`);
    expect(ownerEnd.status).toBe(400);
    expect(ownerEnd.body.message).toContain('owner');
  });

  it('the OWNER cannot be demoted by re-adding — the side door to ending them stays shut (BMPL-151)', async () => {
    const carrier = await makeCarrier('Reef Runner Ltd');
    // The hole: re-add the owner as STAFF, then end the now-STAFF row.
    const demote = await post(admin, `admin/logistics/providers/${carrier.profileId}/members`, {
      userId: carrier.userId, memberRole: 'STAFF',
    });
    expect(demote.status).toBe(400);
    expect(demote.body.message).toContain('demoted');
    const row = await ctx.prisma.shippingProviderMember.findUniqueOrThrow({
      where: { providerProfileId_userId: { providerProfileId: carrier.profileId, userId: carrier.userId } },
    });
    expect(row.memberRole).toBe('OWNER');
    expect(row.status).toBe('ACTIVE');
    // Re-adding the owner WITHOUT a role stays a harmless no-op reactivation.
    expect((await post(admin, `admin/logistics/providers/${carrier.profileId}/members`, { userId: carrier.userId })).status).toBe(201);
    expect((await ctx.prisma.shippingProviderMember.findUniqueOrThrow({
      where: { providerProfileId_userId: { providerProfileId: carrier.profileId, userId: carrier.userId } },
    })).memberRole).toBe('OWNER');
  });
});

describe('assigning an operator', () => {
  it('validates the organization: real, active, approved, and on the shipment side of the simulation boundary', async () => {
    const carrier = await makeCarrier('Reef Runner Ltd');
    const s = await bookHubToHub('SEA');
    const [leg] = await legsOf(s.id);

    // A test org cannot take a real shipment (and the reverse is the same rule).
    await ctx.prisma.shippingProviderProfile.update({ where: { id: carrier.profileId }, data: { isTest: true } });
    const wrongSide = await setOperator(leg!.id, carrier.profileId);
    expect(wrongSide.status).toBe(400);
    expect(wrongSide.body.message).toContain('test carrier');
    await ctx.prisma.shippingProviderProfile.update({ where: { id: carrier.profileId }, data: { isTest: false } });

    // A deactivated org is refused.
    await ctx.prisma.shippingProviderProfile.update({ where: { id: carrier.profileId }, data: { isActive: false } });
    expect((await setOperator(leg!.id, carrier.profileId)).status).toBe(400);
    await ctx.prisma.shippingProviderProfile.update({ where: { id: carrier.profileId }, data: { isActive: true } });

    // An org whose owner's role is not approved is refused.
    await ctx.prisma.userRole.update({
      where: { userId_roleCode: { userId: carrier.userId, roleCode: 'SHIPPING_PROVIDER' } },
      data: { status: 'SUSPENDED' },
    });
    expect((await setOperator(leg!.id, carrier.profileId)).status).toBe(400);
    await approveProviderRole(carrier.userId);

    // And a valid org is accepted; clearing works.
    expect((await setOperator(leg!.id, carrier.profileId)).status).toBe(201);
    expect((await setOperator(leg!.id, null)).status).toBe(201);
    expect((await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: leg!.id } })).operatedByProviderId).toBeNull();
  });

  it('a lapsed org stops collecting new legs: booking re-checks eligibility and leaves the leg unassigned (BMPL-152)', async () => {
    const carrier = await makeCarrier('Reef Runner Ltd');
    expect((await patch(admin, `admin/logistics/routes/${route.SEA}`, { operatedByProviderId: carrier.profileId })).status).toBe(200);

    // Deactivated org: the route keeps its standing operator, but a NEW
    // booking's leg lands UNASSIGNED — surfacing in the manual-assignment
    // path instead of stalling where nobody can act on it.
    await ctx.prisma.shippingProviderProfile.update({ where: { id: carrier.profileId }, data: { isActive: false } });
    const whileInactive = await bookHubToHub('SEA');
    expect((await legsOf(whileInactive.id))[0]!.operatedByProviderId).toBeNull();

    // The booking itself never fails over a lapsed carrier.
    await ctx.prisma.shippingProviderProfile.update({ where: { id: carrier.profileId }, data: { isActive: true } });
    // Suspended owner role: same outcome, same shared rule.
    await ctx.prisma.userRole.update({
      where: { userId_roleCode: { userId: carrier.userId, roleCode: 'SHIPPING_PROVIDER' } },
      data: { status: 'SUSPENDED' },
    });
    const whileSuspended = await bookHubToHub('SEA');
    expect((await legsOf(whileSuspended.id))[0]!.operatedByProviderId).toBeNull();

    // Restored, the standing operator flows again.
    await approveProviderRole(carrier.userId);
    const restored = await bookHubToHub('SEA');
    expect((await legsOf(restored.id))[0]!.operatedByProviderId).toBe(carrier.profileId);
  });

  it('the simulation boundary refuses in BOTH directions: a real carrier never operates a test shipment', async () => {
    // The reverse of the pinned real-shipment/test-carrier line (BMPL-137 note a).
    const carrier = await makeCarrier('Reef Runner Ltd'); // real-side org
    // A test-side network and customer, built through the product.
    const th: Record<string, string> = {};
    for (const h of [
      { code: 'TSW', name: 'Test San Pedro Dock', city: 'San Pedro' },
      { code: 'TBW', name: 'Test Belize City Dock', city: 'Belize City' },
    ]) {
      const r = await post(admin, 'admin/logistics/hubs', {
        code: h.code, name: h.name, type: 'WATER_TAXI_TERMINAL', district: 'BELIZE', city: h.city,
        modes: ['LAND', 'SEA'], courierFeeMinor: 1000, isTest: true,
      });
      expect(r.status).toBe(201);
      th[h.code] = r.body.id;
    }
    expect((await post(admin, 'admin/logistics/routes', {
      originHubId: th.TSW, destinationHubId: th.TBW, mode: 'SEA', durationMinutes: 60, priceMinor: 3000,
      carrierName: 'UAT Test Boat', isTest: true,
    })).status).toBe(201);
    const t = await registerUser(`xtcust_${uniq()}@example.com`);
    await ctx.prisma.user.update({ where: { id: t.userId }, data: { isTest: true } });
    await post(admin, 'admin/wallet/test-credit', { userId: t.userId, amountMinor: 100_000, reason: 'Reverse isTest fixture.' });
    const booked = await post(t.cookies, 'shipping', {
      service: 'HUB_TO_HUB',
      origin: { hubId: th.TSW, name: 'S', phone: '501-2223333' },
      destination: { hubId: th.TBW, name: 'R', phone: '501-4445555' },
      preferredMode: 'SEA', description: 'Test box', payWithWallet: true,
    });
    expect(booked.status).toBe(201);
    const [leg] = await legsOf(booked.body.id);
    const refused = await setOperator(leg!.id, carrier.profileId);
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain('test carrier');
  });

  it("a route's standing carrier flows onto new legs at booking; a bare route stays unassigned", async () => {
    const carrier = await makeCarrier('Reef Runner Ltd');
    expect((await patch(admin, `admin/logistics/routes/${route.SEA}`, { operatedByProviderId: carrier.profileId })).status).toBe(200);

    const sea = await bookHubToHub('SEA');
    const [seaLeg] = await legsOf(sea.id);
    expect(seaLeg!.operatedByProviderId).toBe(carrier.profileId);

    const air = await bookHubToHub('AIR'); // its route has no standing carrier
    const [airLeg] = await legsOf(air.id);
    expect(airLeg!.operatedByProviderId).toBeNull();
  });
});

describe('the carrier surface', () => {
  it('demands the role, and an ACTIVE membership on top of it', async () => {
    expect((await request(ctx.server).get('/api/shipping/provider/legs')).status).toBe(401);
    // Role but no membership: the second gate refuses.
    const roleOnly = await registerUser(`xrole_${uniq()}@example.com`);
    await approveProviderRole(roleOnly.userId);
    expect((await get(roleOnly.cookies, 'shipping/provider/legs')).status).toBe(403);
    // Membership but suspended role: the first gate refuses.
    const carrier = await makeCarrier('Reef Runner Ltd');
    await ctx.prisma.userRole.update({
      where: { userId_roleCode: { userId: carrier.userId, roleCode: 'SHIPPING_PROVIDER' } },
      data: { status: 'SUSPENDED' },
    });
    expect((await get(carrier.cookies, 'shipping/provider/legs')).status).toBe(403);
  });

  it("staff see the org's legs, and the payload is an allowlist", async () => {
    const carrier = await makeCarrier('Reef Runner Ltd');
    const staff = await makeStaff(carrier.profileId);
    const { leg } = await bookedFor(carrier.profileId);

    const list = await get(staff.cookies, 'shipping/provider/legs');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(leg.id);
    expect(list.body[0].canDepart).toBe(true);

    const raw = JSON.stringify(list.body);
    const pin = await pinOf(leg.id);
    for (const leaked of ['Sentinelname', '501-2223333', '501-4445555', pin, 'handoffPin', 'priceMinor']) {
      expect(raw).not.toContain(leaked);
    }
  });

  it('a cross-org probe reads exactly like a missing leg', async () => {
    const carrierA = await makeCarrier('Reef Runner Ltd');
    const carrierB = await makeCarrier('Cave Branch Bus Co');
    const { leg } = await bookedFor(carrierA.profileId);
    const foreign = await post(carrierB.cookies, `shipping/provider/legs/${leg.id}/depart`, {});
    const missing = await post(carrierB.cookies, `shipping/provider/legs/nonexistent00000000000000/depart`, {});
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
  });

  it('reaches zero admin surfaces', async () => {
    const carrier = await makeCarrier('Reef Runner Ltd');
    const { leg } = await bookedFor(carrier.profileId);
    expect((await get(carrier.cookies, 'admin/logistics/hubs')).status).toBe(403);
    expect((await get(carrier.cookies, 'admin/logistics/providers')).status).toBe(403);
    expect((await post(carrier.cookies, `admin/logistics/legs/${leg.id}/operator`, { providerProfileId: null })).status).toBe(403);
    // The two-party property: the org that must PRODUCE the code can never
    // reach the desk-side reveal.
    expect((await get(carrier.cookies, `admin/logistics/legs/${leg.id}/handoff-pin`)).status).toBe(403);
  });

  it('departs and arrives through the real state machine — on the water and in the air', async () => {
    const carrier = await makeCarrier('Reef Runner Ltd');
    for (const mode of ['SEA', 'AIR'] as const) {
      const { shipment, leg } = await bookedFor(carrier.profileId, mode);
      const departed = await post(carrier.cookies, `shipping/provider/legs/${leg.id}/depart`, { carrierBookingRef: `${mode}-42` });
      expect(departed.status).toBe(201);
      expect(departed.body.departedAt).toBeTruthy();
      expect(departed.body.canArrive).toBe(true);
      const custody = await ctx.prisma.custodyEvent.findFirst({
        where: { shipmentLegId: leg.id, toHolder: 'CARRIER' },
        orderBy: { occurredAt: 'desc' },
      });
      expect(custody?.fromHolder).toBe('HUB');

      expect((await post(carrier.cookies, `shipping/provider/legs/${leg.id}/arrive`)).status).toBe(201);
      // The receiving desk completes the handoff — that stays a staff act.
      expect((await post(admin, `admin/logistics/legs/${leg.id}/handoff`, {
        pin: await pinOf(leg.id), receivedByName: 'Desk staff',
      })).status).toBe(201);
      const s = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
      expect(s.status).toBe('AWAITING_COLLECTION');
    }
  });

  it('an ended membership cuts access on the very next request; the org keeps working', async () => {
    const carrier = await makeCarrier('Reef Runner Ltd');
    const staff = await makeStaff(carrier.profileId);
    const { leg } = await bookedFor(carrier.profileId);
    expect((await get(staff.cookies, 'shipping/provider/legs')).status).toBe(200);

    expect((await post(admin, `admin/logistics/providers/${carrier.profileId}/members/${staff.userId}/end`)).status).toBe(201);
    // Same session cookies, no re-login: access is resolved per request.
    expect((await get(staff.cookies, 'shipping/provider/legs')).status).toBe(403);
    // The organization is unaffected: the owner still works the leg.
    expect((await post(carrier.cookies, `shipping/provider/legs/${leg.id}/depart`, {})).status).toBe(201);
  });
});
