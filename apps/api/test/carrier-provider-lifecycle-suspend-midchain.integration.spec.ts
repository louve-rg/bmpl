import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

/**
 * MDF-527 — multi-hop handoff state integrity when a carrier is SUSPENDED
 * (not revoked) partway through a chain.
 *
 * SUSPEND is the owner's ALLOW-continuation case (unlike REVOKE, covered in
 * MDF-527's own review round): an ordinary administrative hold must not
 * strand a shipment already in flight, but must still block that same
 * carrier from taking on anything NEW while the hold is in effect. The
 * failure mode this guards against is not a refusal — it is a chain that
 * quietly stops moving, or a leg that advances when it should not.
 */
describe('MDF-527 — mid-chain SUSPEND: continuation allowed, new work blocked, recovery via REINSTATE', () => {
  let ctx: TestContext;
  let admin: string[];
  let seq = 0;
  const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;

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

  async function approveProviderRole(userId: string) {
    await ctx.prisma.userRole.upsert({
      where: { userId_roleCode: { userId, roleCode: 'SHIPPING_PROVIDER' } },
      create: { userId, roleCode: 'SHIPPING_PROVIDER', status: 'APPROVED', approvedAt: new Date() },
      update: { status: 'APPROVED', approvedAt: new Date() },
    });
  }

  async function makeCarrier(name: string) {
    const owner = await registerUser(`smc_${uniq()}@example.com`);
    await approveProviderRole(owner.userId);
    const created = await put(owner.cookies, 'shipping/provider/profile', {
      businessName: name,
      contactEmail: `sme_${uniq()}@example.com`,
    });
    expect(created.status).toBe(200);
    expect((await post(admin, `admin/logistics/providers/${created.body.id}/approve`, {})).status).toBe(201);
    return { ...owner, profileId: created.body.id as string };
  }

  async function makeHub(code: string, city: string) {
    const r = await post(admin, 'admin/logistics/hubs', {
      code, name: `${city} Suspend Dock`, type: 'WATER_TAXI_TERMINAL', district: 'BELIZE', city,
      modes: ['LAND', 'SEA'], courierFeeMinor: 1000,
    });
    expect(r.status).toBe(201);
    return r.body.id as string;
  }

  const makeRoute = async (originHubId: string, destinationHubId: string, carrierName: string) => {
    const r = await post(admin, 'admin/logistics/routes', {
      originHubId, destinationHubId, mode: 'SEA', durationMinutes: 60, priceMinor: 3000, carrierName,
    });
    expect(r.status).toBe(201);
    return r.body.id as string;
  };

  const legsOf = (shipmentId: string) => ctx.prisma.shipmentLeg.findMany({ where: { shipmentId }, orderBy: { sequence: 'asc' } });
  const setOperator = (legId: string, providerProfileId: string) => post(admin, `admin/logistics/legs/${legId}/operator`, { providerProfileId });

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

  it('leg2 carrier is SUSPENDED (not revoked) after leg1 completes: the accepted leg2 still departs/arrives, the same carrier is refused any NEW work while suspended, the chain reaches a terminal state, and REINSTATE restores full operability', async () => {
    const tag = uniq();
    const hubA = await makeHub(`S1${tag}`.slice(0, 10), 'San Pedro');
    const hubB = await makeHub(`S2${tag}`.slice(0, 10), 'Belize City');
    const hubC = await makeHub(`S3${tag}`.slice(0, 10), 'Dangriga');
    await makeRoute(hubA, hubB, `MDF527 Suspend Leg1 Carrier ${tag}`);
    await makeRoute(hubB, hubC, `MDF527 Suspend Leg2 Carrier ${tag}`); // NO direct A->C route

    const carrier1 = await makeCarrier(`MDF527 Suspend Carrier1 ${tag}`);
    const carrier2 = await makeCarrier(`MDF527 Suspend Carrier2 ${tag}`);
    const customer = await registerUser(`mdf527susp_${uniq()}@example.com`);
    await post(admin, 'admin/wallet/test-credit', { userId: customer.userId, amountMinor: 100_000, reason: 'MDF-527 suspend mid-chain fixture' });

    const booked = await post(customer.cookies, 'shipping', {
      service: 'HUB_TO_HUB',
      origin: { hubId: hubA, name: 'Sender MDF527Susp', phone: '501-2223333' },
      destination: { hubId: hubC, name: 'Recipient MDF527Susp', phone: '501-4445555' },
      preferredMode: 'SEA', description: 'One box, multi-hop, mid-chain suspend', payWithWallet: true,
    });
    expect(booked.status).toBe(201);
    const shipmentId = booked.body.id as string;
    const legs = await legsOf(shipmentId);
    expect(legs).toHaveLength(2);
    const [leg1, leg2] = legs;
    expect(leg1!.status).toBe('READY');
    expect(leg2!.status).toBe('PENDING');

    // Leg1 runs its full course and completes at the admin desk.
    expect((await setOperator(leg1!.id, carrier1.profileId)).status).toBe(201);
    expect((await setOperator(leg2!.id, carrier2.profileId)).status).toBe(201);
    expect((await post(carrier1.cookies, `shipping/provider/legs/${leg1!.id}/accept`, {})).status).toBe(201);
    expect((await post(carrier1.cookies, `shipping/provider/legs/${leg1!.id}/depart`, {})).status).toBe(201);
    expect((await post(carrier1.cookies, `shipping/provider/legs/${leg1!.id}/arrive`, {})).status).toBe(201);
    const pin1 = await get(admin, `admin/logistics/legs/${leg1!.id}/handoff-pin`);
    expect((await post(admin, `admin/logistics/legs/${leg1!.id}/handoff`, { pin: pin1.body.handoffPin, receivedByName: 'MDF527 Suspend Desk 1' })).status).toBe(201);
    expect((await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: leg1!.id } })).status).toBe('COMPLETED');
    expect((await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: leg2!.id } })).status).toBe('READY');

    // Carrier2 accepts leg2 WHILE STILL APPROVED - this is the already-accepted
    // leg the suspension must not be allowed to strand.
    expect((await post(carrier2.cookies, `shipping/provider/legs/${leg2!.id}/accept`, {})).status).toBe(201);

    // A second, unrelated leg is proposed to carrier2 WHILE STILL APPROVED,
    // but deliberately left unaccepted - this is the still-pending proposal
    // the suspension must still be allowed to block (setLegOperator itself
    // already refuses NEW assignments to a non-APPROVED carrier, so the
    // proposal has to exist before the suspension for accept() to be the
    // thing under test here, not assignment).
    const freshBooking = await post(customer.cookies, 'shipping', {
      service: 'HUB_TO_HUB',
      origin: { hubId: hubA, name: 'Sender MDF527Susp2', phone: '501-2223333' },
      destination: { hubId: hubB, name: 'Recipient MDF527Susp2', phone: '501-4445555' },
      preferredMode: 'SEA', description: 'Unrelated new leg, must be refused to the suspended carrier', payWithWallet: true,
    });
    expect(freshBooking.status).toBe(201);
    const [freshLeg] = await legsOf(freshBooking.body.id);
    expect((await setOperator(freshLeg!.id, carrier2.profileId)).status).toBe(201);

    // Now suspend carrier2 - an ordinary administrative hold, not a cutoff.
    const suspend = await post(admin, `admin/logistics/providers/${carrier2.profileId}/suspend`, { reason: 'MDF-527 scratch: routine compliance hold.' });
    expect(suspend.status, JSON.stringify(suspend.body)).toBe(201);

    // CONTROL 1: the same, now-suspended carrier cannot accept that still-
    // pending leg proposal - this is a NEW commitment, not a continuation.
    const newAccept = await post(carrier2.cookies, `shipping/provider/legs/${freshLeg!.id}/accept`, {});
    expect(newAccept.status, JSON.stringify(newAccept.body)).toBe(400);
    expect(newAccept.body.message).toContain('suspended');

    // CONTROL 2: the same carrier cannot claim a brand-new, unclaimed route either.
    const unclaimedRouteId = await makeRoute(hubC, hubA, `MDF527 Suspend Unclaimed Route ${tag}`);
    const claimAttempt = await post(carrier2.cookies, `shipping/provider/routes/${unclaimedRouteId}/claim`, {});
    expect(claimAttempt.status, JSON.stringify(claimAttempt.body)).toBe(400);

    // CONTINUATION: leg2, already accepted before the suspension, still departs and arrives.
    const departLeg2 = await post(carrier2.cookies, `shipping/provider/legs/${leg2!.id}/depart`, {});
    expect(departLeg2.status, JSON.stringify(departLeg2.body)).toBe(201);
    const arriveLeg2 = await post(carrier2.cookies, `shipping/provider/legs/${leg2!.id}/arrive`, {});
    expect(arriveLeg2.status, JSON.stringify(arriveLeg2.body)).toBe(201);

    // Nothing stranded: the chain reaches its real terminal state.
    const pin2 = await get(admin, `admin/logistics/legs/${leg2!.id}/handoff-pin`);
    expect((await post(admin, `admin/logistics/legs/${leg2!.id}/handoff`, { pin: pin2.body.handoffPin, receivedByName: 'MDF527 Suspend Desk 2' })).status).toBe(201);
    expect((await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: leg2!.id } })).status).toBe('COMPLETED');
    expect((await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })).status).toBe('AWAITING_COLLECTION');

    // RECOVERY: reinstating the carrier restores full operability - the new
    // work both controls above refused is now allowed.
    const reinstate = await post(admin, `admin/logistics/providers/${carrier2.profileId}/reinstate`, { reason: 'MDF-527 scratch: compliance hold lifted.' });
    expect(reinstate.status, JSON.stringify(reinstate.body)).toBe(201);
    expect(reinstate.body.status).toBe('APPROVED');

    const acceptAfterReinstate = await post(carrier2.cookies, `shipping/provider/legs/${freshLeg!.id}/accept`, {});
    expect(acceptAfterReinstate.status, JSON.stringify(acceptAfterReinstate.body)).toBe(201);
    const claimAfterReinstate = await post(carrier2.cookies, `shipping/provider/routes/${unclaimedRouteId}/claim`, {});
    expect(claimAfterReinstate.status, JSON.stringify(claimAfterReinstate.body)).toBe(201);
  });
});
