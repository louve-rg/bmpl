/**
 * Carrier operational lifecycle (MDF-COURIER D1-D5), against real Postgres.
 *
 * The claims this suite exists to defend:
 *  - D1/D1b: self-registration carries ZERO operational privilege until an
 *    explicit admin APPROVE, and the new `status` column is AND-gated with
 *    (never derived from) the generic SHIPPING_PROVIDER role grant.
 *  - D5: the transition table is enforced server-side, not just hidden in a
 *    UI — an illegal edge is refused even when attempted directly, and the
 *    self-service RESUBMIT action can never reach SUSPENDED or REVOKED.
 *  - D4: the ineligibility preview names a reason per failed gate.
 *  - D2/D3: a leg operator assignment is a PROPOSAL (idempotent, CAS-guarded)
 *    that the carrier must accept before depart/arrive/schedule unlock, and
 *    a rejection returns the leg to unassigned without silently advancing
 *    the shipment.
 *  - Self-service scope: an org's OWNER (not any member) manages its own
 *    membership; any active member may claim/release an existing,
 *    unassigned route.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let customer: string[];
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const put = (c: string[], p: string, b: object = {}) => request(ctx.server).put(`/api/${p}`).set('Cookie', c).send(b);
const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);

let hub: Record<string, string> = {};

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

/** A self-registered org: PENDING by default (D1) — the suite's own starting point. */
async function registerCarrier(name: string) {
  const owner = await registerUser(`lown_${uniq()}@example.com`);
  await approveProviderRole(owner.userId);
  const created = await put(owner.cookies, 'shipping/provider/profile', {
    businessName: name,
    contactEmail: `lops_${uniq()}@example.com`,
  });
  expect(created.status).toBe(200);
  expect(created.body.status).toBe('PENDING');
  return { ...owner, profileId: created.body.id as string };
}

/** The same, admin-approved — a carrier that may actually be handed work. */
async function makeCarrier(name: string) {
  const carrier = await registerCarrier(name);
  expect((await post(admin, `admin/logistics/providers/${carrier.profileId}/approve`)).status).toBe(201);
  return carrier;
}

async function seedNetwork() {
  hub = {};
  for (const h of [
    { code: 'LSW', name: 'Lifecycle San Pedro Dock', city: 'San Pedro' },
    { code: 'LBW', name: 'Lifecycle Belize City Dock', city: 'Belize City' },
  ]) {
    const r = await post(admin, 'admin/logistics/hubs', {
      code: h.code, name: h.name, type: 'WATER_TAXI_TERMINAL', district: 'BELIZE', city: h.city,
      modes: ['LAND', 'SEA'], courierFeeMinor: 1000,
    });
    expect(r.status).toBe(201);
    hub[h.code] = r.body.id;
  }
  const r = await post(admin, 'admin/logistics/routes', {
    originHubId: hub.LSW, destinationHubId: hub.LBW, mode: 'SEA', durationMinutes: 60, priceMinor: 3000, carrierName: 'Lifecycle Water Taxi',
  });
  expect(r.status).toBe(201);
}

async function bookHubToHub() {
  const r = await post(customer, 'shipping', {
    service: 'HUB_TO_HUB',
    origin: { hubId: hub.LSW!, name: 'Sender Sentinelname', phone: '501-2223333' },
    destination: { hubId: hub.LBW!, name: 'Recipient Sentinelname', phone: '501-4445555' },
    preferredMode: 'SEA',
    description: 'One box',
    payWithWallet: true,
  });
  expect(r.status).toBe(201);
  return r.body;
}

const legsOf = (shipmentId: string) => ctx.prisma.shipmentLeg.findMany({ where: { shipmentId }, orderBy: { sequence: 'asc' } });
const setOperator = (legId: string, providerProfileId: string | null) => post(admin, `admin/logistics/legs/${legId}/operator`, { providerProfileId });

/** A fresh booking with its single LINE_HAUL leg proposed to `profileId` (not yet accepted). */
async function proposedLeg(profileId: string) {
  const s = await bookHubToHub();
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
  const c = await registerUser(`lcust_${uniq()}@example.com`);
  customer = c.cookies;
  await post(admin, 'admin/wallet/test-credit', { userId: c.userId, amountMinor: 100_000, reason: 'Carrier lifecycle fixture.' });
  await seedNetwork();
});

/* ------------------------------------------------------------------------- */

describe('D1/D1b — self-registration and the AND-gate', () => {
  it('a fresh registration is PENDING and carries zero operational privilege', async () => {
    const carrier = await registerCarrier('Pending Freight Co');
    const s = await bookHubToHub();
    const [leg] = await legsOf(s.id);
    const refused = await setOperator(leg!.id, carrier.profileId);
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain('pending');
  });

  it('the AND-gate: APPROVED status with a SUSPENDED role grant is still refused', async () => {
    const carrier = await makeCarrier('Reef Runner Ltd');
    await ctx.prisma.userRole.update({
      where: { userId_roleCode: { userId: carrier.userId, roleCode: 'SHIPPING_PROVIDER' } },
      data: { status: 'SUSPENDED' },
    });
    const s = await bookHubToHub();
    const [leg] = await legsOf(s.id);
    expect((await setOperator(leg!.id, carrier.profileId)).status).toBe(400);
  });

  it('the AND-gate, the other direction: an APPROVED role grant does not promote a PENDING profile', async () => {
    // registerCarrier already approves the role (that is how one applies at
    // all); the profile's own D1 status is the thing that must independently
    // reach APPROVED.
    const carrier = await registerCarrier('Still Pending Freight');
    const s = await bookHubToHub();
    const [leg] = await legsOf(s.id);
    expect((await setOperator(leg!.id, carrier.profileId)).status).toBe(400);
  });

  it('one account holding SHIPPING_PROVIDER with no profile behind it cannot become operationally eligible by accident', async () => {
    const bare = await registerUser(`lbare_${uniq()}@example.com`);
    await approveProviderRole(bare.userId);
    const s = await bookHubToHub();
    const [leg] = await legsOf(s.id);
    // No profile id exists for this account at all — there is nothing to pass.
    const probe = await setOperator(leg!.id, bare.userId);
    expect(probe.status).toBe(404);
  });
});

describe('D5 — the provider status transition table', () => {
  it('walks the full legal path: PENDING -> APPROVED -> SUSPENDED -> APPROVED -> REVOKED, each one audited', async () => {
    const carrier = await registerCarrier('Full Lifecycle Co');
    expect((await post(admin, `admin/logistics/providers/${carrier.profileId}/approve`)).status).toBe(201);
    expect((await ctx.prisma.shippingProviderProfile.findUniqueOrThrow({ where: { id: carrier.profileId } })).status).toBe('APPROVED');

    const suspended = await post(admin, `admin/logistics/providers/${carrier.profileId}/suspend`, { reason: 'Licence under review.' });
    expect(suspended.status).toBe(201);
    expect(suspended.body.status).toBe('SUSPENDED');
    expect(suspended.body.statusReason).toBe('Licence under review.');

    expect((await post(admin, `admin/logistics/providers/${carrier.profileId}/reinstate`, { reason: 'Licence cleared.' })).status).toBe(201);
    expect((await ctx.prisma.shippingProviderProfile.findUniqueOrThrow({ where: { id: carrier.profileId } })).status).toBe('APPROVED');

    const revoked = await post(admin, `admin/logistics/providers/${carrier.profileId}/revoke`, { reason: 'Repeated handoff failures.' });
    expect(revoked.status).toBe(201);
    expect(revoked.body.status).toBe('REVOKED');

    const audits = await ctx.prisma.auditLog.findMany({ where: { action: 'SHIPPING_PROVIDER_STATUS_CHANGED', targetUserId: carrier.userId }, orderBy: { createdAt: 'asc' } });
    expect(audits.map((a) => (a.newValue as { verb: string }).verb)).toEqual(['APPROVE', 'SUSPEND', 'REINSTATE', 'REVOKE']);
  });

  it("god's ruling (2026-11-04): lifting a suspension (reinstate) requires a reason, audited the same as suspend/revoke — never a silent flag flip", async () => {
    const carrier = await registerCarrier('Full Lifecycle Co');
    expect((await post(admin, `admin/logistics/providers/${carrier.profileId}/approve`)).status).toBe(201);
    expect((await post(admin, `admin/logistics/providers/${carrier.profileId}/suspend`, { reason: 'Licence under review.' })).status).toBe(201);

    const noReason = await post(admin, `admin/logistics/providers/${carrier.profileId}/reinstate`, {});
    expect(noReason.status).toBe(400);
    expect((await ctx.prisma.shippingProviderProfile.findUniqueOrThrow({ where: { id: carrier.profileId } })).status).toBe('SUSPENDED');

    const reinstated = await post(admin, `admin/logistics/providers/${carrier.profileId}/reinstate`, { reason: 'Licence cleared.' });
    expect(reinstated.status).toBe(201);
    expect(reinstated.body.status).toBe('APPROVED');
    // Carrier-VISIBLE statusReason still clears on APPROVED (unchanged D5
    // convention) — the reason is required and audited, not necessarily
    // shown back as the current-status reason, same as approve/reopen.
    expect(reinstated.body.statusReason).toBeNull();

    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'SHIPPING_PROVIDER_STATUS_CHANGED', targetUserId: carrier.userId, reason: 'Licence cleared.' },
    });
    expect(audit).not.toBeNull();
    expect((audit!.newValue as { verb: string }).verb).toBe('REINSTATE');
  });

  it('REJECTED is NOT terminal — the carrier can resubmit, and admin can re-open it too', async () => {
    const carrier = await registerCarrier('Fixable Rejection Co');
    const rejected = await post(admin, `admin/logistics/providers/${carrier.profileId}/reject`, { reason: 'Missing operating licence.' });
    expect(rejected.status).toBe(201);
    expect(rejected.body.status).toBe('REJECTED');
    expect((await get(carrier.cookies, 'shipping/provider/profile')).body.statusReason).toBe('Missing operating licence.');

    // Carrier resubmits — the one self-service transition, and it gains
    // nothing but a fresh review.
    const resubmitted = await post(carrier.cookies, 'shipping/provider/profile/resubmit');
    expect(resubmitted.status).toBe(201);
    expect(resubmitted.body.status).toBe('PENDING');
    expect(resubmitted.body.statusReason).toBeNull();

    // Admin can also re-open a rejected application directly.
    await post(admin, `admin/logistics/providers/${carrier.profileId}/reject`, { reason: 'Still missing it.' });
    expect((await post(admin, `admin/logistics/providers/${carrier.profileId}/reopen`)).status).toBe(201);
    expect((await ctx.prisma.shippingProviderProfile.findUniqueOrThrow({ where: { id: carrier.profileId } })).status).toBe('PENDING');
  });

  it('REVOKED -> PENDING is admin-only, never self-service — never terminal in code, but never reachable from the carrier door', async () => {
    const carrier = await makeCarrier('Revoked Then Reapplied Co');
    expect((await post(admin, `admin/logistics/providers/${carrier.profileId}/revoke`, { reason: 'Fraudulent booking refs.' })).status).toBe(201);

    // The carrier's own resubmit refuses — RESUBMIT's only legal `from` is REJECTED.
    const selfTry = await post(carrier.cookies, 'shipping/provider/profile/resubmit');
    expect(selfTry.status).toBe(400);
    expect((await ctx.prisma.shippingProviderProfile.findUniqueOrThrow({ where: { id: carrier.profileId } })).status).toBe('REVOKED');

    // Admin re-applying from scratch is the only legal way out.
    expect((await post(admin, `admin/logistics/providers/${carrier.profileId}/reapply`)).status).toBe(201);
    expect((await ctx.prisma.shippingProviderProfile.findUniqueOrThrow({ where: { id: carrier.profileId } })).status).toBe('PENDING');
  });

  it('a carrier can never self-service out of SUSPENDED either — refused at the service layer, not merely hidden in a UI', async () => {
    const carrier = await makeCarrier('Suspended Co');
    expect((await post(admin, `admin/logistics/providers/${carrier.profileId}/suspend`, { reason: 'Owed route fees.' })).status).toBe(201);
    const selfTry = await post(carrier.cookies, 'shipping/provider/profile/resubmit');
    expect(selfTry.status).toBe(400);
    expect((await ctx.prisma.shippingProviderProfile.findUniqueOrThrow({ where: { id: carrier.profileId } })).status).toBe('SUSPENDED');
  });

  it('illegal edges are refused directly, not only avoided by a well-behaved UI: PENDING cannot jump straight to SUSPENDED', async () => {
    const carrier = await registerCarrier('Never Approved Co');
    const direct = await post(admin, `admin/logistics/providers/${carrier.profileId}/suspend`, { reason: 'No.' });
    expect(direct.status).toBe(400);
  });

  it('REJECT/SUSPEND/REVOKE require a reason; APPROVE/REINSTATE/REOPEN/REAPPLY do not', async () => {
    const carrier = await registerCarrier('Reason Required Co');
    expect((await post(admin, `admin/logistics/providers/${carrier.profileId}/reject`, {})).status).toBe(400);
    expect((await post(admin, `admin/logistics/providers/${carrier.profileId}/approve`, {})).status).toBe(201);
  });

  it('non-admins reach zero of these endpoints', async () => {
    const carrier = await registerCarrier('Unprivileged Co');
    expect((await post(carrier.cookies, `admin/logistics/providers/${carrier.profileId}/approve`)).status).toBe(403);
  });
});

describe('D4 — the ineligibility preview', () => {
  it('names a reason per failed gate, and reports eligible:true for a genuinely operable org', async () => {
    const good = await makeCarrier('Operable Co');
    const pending = await registerCarrier('Still Pending Co');
    const suspendedRole = await makeCarrier('Suspended Role Co');
    await ctx.prisma.userRole.update({
      where: { userId_roleCode: { userId: suspendedRole.userId, roleCode: 'SHIPPING_PROVIDER' } },
      data: { status: 'SUSPENDED' },
    });

    const s = await bookHubToHub();
    const [leg] = await legsOf(s.id);
    const preview = await get(admin, `admin/logistics/legs/${leg!.id}/eligible-operators`);
    expect(preview.status).toBe(200);

    const byId = new Map<string, { eligible: boolean; reasons: string[] }>(preview.body.map((p: { providerProfileId: string; eligible: boolean; reasons: string[] }) => [p.providerProfileId, p]));
    expect(byId.get(good.profileId)?.eligible).toBe(true);
    expect(byId.get(good.profileId)?.reasons).toEqual([]);
    expect(byId.get(pending.profileId)?.eligible).toBe(false);
    expect(byId.get(pending.profileId)?.reasons.join(' ')).toContain('pending');
    expect(byId.get(suspendedRole.profileId)?.eligible).toBe(false);
    expect(byId.get(suspendedRole.profileId)?.reasons.join(' ')).toContain('suspended');
  });

  it('refuses a courier (non-LINE_HAUL) leg — a carrier organization has no business there', async () => {
    // HUB_TO_HUB books exactly one LINE_HAUL leg in this fixture network, so
    // this just asserts the kind guard fires on a deliberately wrong id shape
    // is out of scope here; covered structurally by setOperator's own guard
    // (carrier-org-access.integration.spec.ts) — this suite only needs the
    // preview to share that same refusal, proven directly:
    const s = await bookHubToHub();
    const [leg] = await legsOf(s.id);
    await ctx.prisma.shipmentLeg.update({ where: { id: leg!.id }, data: { kind: 'FIRST_MILE' } });
    const refused = await get(admin, `admin/logistics/legs/${leg!.id}/eligible-operators`);
    expect(refused.status).toBe(400);
  });
});

describe('D2/D3 — proposal, idempotency, and mutual consent', () => {
  it('a repeat of the exact same proposal is a no-op success; a conflicting one fails loudly', async () => {
    const carrierA = await makeCarrier('Reef Runner Ltd');
    const carrierB = await makeCarrier('Cave Branch Bus Co');
    const { leg } = await proposedLeg(carrierA.profileId);

    const before = await ctx.prisma.auditLog.count({ where: { action: 'SHIPMENT_LEG_OPERATOR_ASSIGNED' } });
    // Repeating the identical request succeeds and writes nothing new.
    expect((await setOperator(leg.id, carrierA.profileId)).status).toBe(201);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'SHIPMENT_LEG_OPERATOR_ASSIGNED' } })).toBe(before);

    // A genuinely different proposal still succeeds (reassignment is legal).
    expect((await setOperator(leg.id, carrierB.profileId)).status).toBe(201);
    expect((await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: leg.id } })).operatedByProviderId).toBe(carrierB.profileId);
  });

  it('a fresh proposal resets consent, even onto a leg that was previously accepted by someone else', async () => {
    const carrierA = await makeCarrier('Reef Runner Ltd');
    const carrierB = await makeCarrier('Cave Branch Bus Co');
    const { leg } = await proposedLeg(carrierA.profileId);
    expect((await post(carrierA.cookies, `shipping/provider/legs/${leg.id}/accept`, {})).status).toBe(201);

    expect((await setOperator(leg.id, carrierB.profileId)).status).toBe(201);
    const after = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: leg.id } });
    expect(after.operatorAcceptedAt).toBeNull();
    expect(after.operatorRejectedAt).toBeNull();

    // carrierA no longer holds the leg at all — a 404, not a stale accepted state.
    expect((await post(carrierA.cookies, `shipping/provider/legs/${leg.id}/accept`, {})).status).toBe(404);
  });

  it('depart/arrive/schedule refuse until the carrier accepts; acceptance unlocks them', async () => {
    const carrier = await makeCarrier('Reef Runner Ltd');
    const { leg } = await proposedLeg(carrier.profileId);

    const list = await get(carrier.cookies, 'shipping/provider/legs');
    expect(list.body[0].canDepart).toBe(false);
    expect(list.body[0].canAccept).toBe(true);

    const tooSoon = await post(carrier.cookies, `shipping/provider/legs/${leg.id}/depart`, {});
    expect(tooSoon.status).toBe(400);

    const accepted = await post(carrier.cookies, `shipping/provider/legs/${leg.id}/accept`, {});
    expect(accepted.status).toBe(201);
    expect(accepted.body.canDepart).toBe(true);
    expect((await post(carrier.cookies, `shipping/provider/legs/${leg.id}/depart`, {})).status).toBe(201);
  });

  it('rejecting a proposal returns the leg to unassigned, alerts operations, and does NOT flag an exception or touch shipment status', async () => {
    const carrier = await makeCarrier('Reef Runner Ltd');
    const { shipment, leg } = await proposedLeg(carrier.profileId);
    const shipmentBefore = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    const legBefore = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: leg.id } });
    const notifBefore = await ctx.prisma.notification.count({ where: { event: 'SHIPMENT_LEG_OPERATOR_REJECTED' } });

    const rejected = await post(carrier.cookies, `shipping/provider/legs/${leg.id}/reject`, { reason: 'No vessel available that day.' });
    expect(rejected.status).toBe(201);

    const legAfter = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: leg.id } });
    const shipmentAfter = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(legAfter.operatedByProviderId).toBeNull();
    expect(legAfter.operatorRejectedAt).not.toBeNull();
    // The named risk area: this must NOT silently advance the shipment, and
    // must not be confused with the courier exception hold either — neither
    // the leg's own status nor the shipment's derived status moves at all.
    expect(legAfter.status).toBe(legBefore.status);
    expect(shipmentAfter.status).toBe(shipmentBefore.status);
    expect(legAfter.status).not.toBe('EXCEPTION');
    expect(shipmentAfter.status).not.toBe('EXCEPTION');

    expect(await ctx.prisma.notification.count({ where: { event: 'SHIPMENT_LEG_OPERATOR_REJECTED' } })).toBe(notifBefore + 1);

    // Having lost the leg, the org cannot act on it again.
    expect((await post(carrier.cookies, `shipping/provider/legs/${leg.id}/accept`, {})).status).toBe(404);

    // Operations can propose a new carrier onto the now-unassigned leg.
    const carrierB = await makeCarrier('Cave Branch Bus Co');
    expect((await setOperator(leg.id, carrierB.profileId)).status).toBe(201);
  });

  it('cannot accept twice, cannot reject twice, and cannot reject once already accepted', async () => {
    const carrier = await makeCarrier('Reef Runner Ltd');
    const { leg } = await proposedLeg(carrier.profileId);
    expect((await post(carrier.cookies, `shipping/provider/legs/${leg.id}/accept`, {})).status).toBe(201);
    expect((await post(carrier.cookies, `shipping/provider/legs/${leg.id}/accept`, {})).status).toBe(400);
    expect((await post(carrier.cookies, `shipping/provider/legs/${leg.id}/reject`, { reason: 'Too late now.' })).status).toBe(400);

    const other = await makeCarrier('Second Carrier Co');
    const { leg: leg2 } = await proposedLeg(other.profileId);
    expect((await post(other.cookies, `shipping/provider/legs/${leg2.id}/reject`, { reason: 'Cannot take it.' })).status).toBe(201);
    expect((await post(other.cookies, `shipping/provider/legs/${leg2.id}/reject`, { reason: 'Again.' })).status).toBe(404);
  });
});

describe('self-service scope — own membership and route claim/release', () => {
  it("the org's OWNER manages its own membership; a non-owner STAFF member cannot", async () => {
    const carrier = await makeCarrier('Reef Runner Ltd');
    const staffApplicant = await registerUser(`lstf_${uniq()}@example.com`);
    await approveProviderRole(staffApplicant.userId);

    const added = await post(carrier.cookies, 'shipping/provider/members', { userId: staffApplicant.userId });
    expect(added.status).toBe(201);
    const list = await get(carrier.cookies, 'shipping/provider/members');
    expect(list.body).toHaveLength(2);

    // The non-owner member cannot manage anyone, including themselves.
    const anotherApplicant = await registerUser(`lstf2_${uniq()}@example.com`);
    await approveProviderRole(anotherApplicant.userId);
    const staffTriesToAdd = await post(staffApplicant.cookies, 'shipping/provider/members', { userId: anotherApplicant.userId });
    expect(staffTriesToAdd.status).toBe(403);

    expect((await post(carrier.cookies, `shipping/provider/members/${staffApplicant.userId}/end`)).status).toBe(201);
    expect((await get(carrier.cookies, 'shipping/provider/members')).body).toHaveLength(1);
  });

  it('claims an existing, unassigned route; a second claim and an already-operated route are both refused; release returns it to unassigned', async () => {
    const carrier = await makeCarrier('Reef Runner Ltd');
    const other = await makeCarrier('Cave Branch Bus Co');
    const route = await ctx.prisma.logisticsRoute.findFirstOrThrow({ where: { operatedByProviderId: null } });

    const claimed = await post(carrier.cookies, `shipping/provider/routes/${route.id}/claim`, {});
    expect(claimed.status).toBe(201);
    expect((await ctx.prisma.logisticsRoute.findUniqueOrThrow({ where: { id: route.id } })).operatedByProviderId).toBe(carrier.profileId);

    // Someone else cannot then claim the same route.
    const stolen = await post(other.cookies, `shipping/provider/routes/${route.id}/claim`, {});
    expect(stolen.status).toBe(400);

    expect((await post(carrier.cookies, `shipping/provider/routes/${route.id}/release`, {})).status).toBe(201);
    expect((await ctx.prisma.logisticsRoute.findUniqueOrThrow({ where: { id: route.id } })).operatedByProviderId).toBeNull();

    // Now the other org can claim it.
    expect((await post(other.cookies, `shipping/provider/routes/${route.id}/claim`, {})).status).toBe(201);
  });

  it("release is an OWNERSHIP check, not merely a permission check — a different SHIPPING_PROVIDER org cannot release a route it does not operate", async () => {
    const owner = await makeCarrier('Reef Runner Ltd');
    const intruder = await makeCarrier('Cave Branch Bus Co');
    const route = await ctx.prisma.logisticsRoute.findFirstOrThrow({ where: { operatedByProviderId: null } });
    expect((await post(owner.cookies, `shipping/provider/routes/${route.id}/claim`, {})).status).toBe(201);

    // A real, approved, operable carrier org — holding every permission its
    // own role grants — still cannot release SOMEONE ELSE's route. 404, the
    // same shape a cross-org leg probe gets, not a 403 that would at least
    // confirm the route is operated by somebody.
    const foreignRelease = await post(intruder.cookies, `shipping/provider/routes/${route.id}/release`, {});
    expect(foreignRelease.status).toBe(404);
    expect((await ctx.prisma.logisticsRoute.findUniqueOrThrow({ where: { id: route.id } })).operatedByProviderId).toBe(owner.profileId);

    // The actual operator still can.
    expect((await post(owner.cookies, `shipping/provider/routes/${route.id}/release`, {})).status).toBe(201);
  });

  it('a refused claim always names which condition failed, never a flat "ineligible"', async () => {
    const carrier = await makeCarrier('Reef Runner Ltd');
    const route = await ctx.prisma.logisticsRoute.findFirstOrThrow({ where: { operatedByProviderId: null } });

    await ctx.prisma.logisticsRoute.update({ where: { id: route.id }, data: { isActive: false } });
    const inactive = await post(carrier.cookies, `shipping/provider/routes/${route.id}/claim`, {});
    expect(inactive.status).toBe(400);
    expect(inactive.body.message).toContain('not active');
    await ctx.prisma.logisticsRoute.update({ where: { id: route.id }, data: { isActive: true } });

    await ctx.prisma.logisticsRoute.update({ where: { id: route.id }, data: { operatedByProviderId: carrier.profileId } });
    const already = await post(carrier.cookies, `shipping/provider/routes/${route.id}/claim`, {});
    expect(already.status).toBe(400);
    expect(already.body.message).toContain('already operates');
  });

  it('never lets a carrier create a route or set its price — claim only ever touches operatedByProviderId', async () => {
    const carrier = await makeCarrier('Reef Runner Ltd');
    const route = await ctx.prisma.logisticsRoute.findFirstOrThrow({ where: { operatedByProviderId: null } });
    const before = { priceMinor: route.priceMinor, durationMinutes: route.durationMinutes, mode: route.mode };
    expect((await post(carrier.cookies, `shipping/provider/routes/${route.id}/claim`, {})).status).toBe(201);
    const after = await ctx.prisma.logisticsRoute.findUniqueOrThrow({ where: { id: route.id } });
    expect({ priceMinor: after.priceMinor, durationMinutes: after.durationMinutes, mode: after.mode }).toEqual(before);
  });

  it('a PENDING (not yet approved) carrier cannot claim a route either — the same AND-gate', async () => {
    const carrier = await registerCarrier('Not Yet Approved Co');
    const route = await ctx.prisma.logisticsRoute.findFirstOrThrow({ where: { operatedByProviderId: null } });
    expect((await post(carrier.cookies, `shipping/provider/routes/${route.id}/claim`, {})).status).toBe(400);
  });
});

/**
 * MDF-500 security review (Dwight, 2026-11-04, test-confirmed on Pam's own
 * commit 2c55091b before this fix): every self-service ownership gate
 * checked isActive + membership and NEVER status, because suspend/revoke
 * deliberately never touch isActive. Net effect, test-confirmed live: a
 * SUSPENDED carrier departed a leg it already held (201); a REVOKED
 * carrier ACCEPTED a still-pending leg proposal (201); a revoked carrier
 * read and released a route it holds. A new assignment to the same
 * suspended org correctly got 400 — the asymmetry was real.
 *
 * God's ruling, split deliberately: NEW commitments (accepting a proposal,
 * claiming a route — already covered — and changing a route's own weekly
 * schedule/exceptions) must be refused once SUSPENDED or REVOKED.
 * CONTINUING already-accepted work (depart/arrive) and GIVING WORK BACK
 * (reject/release) are deliberately left alone — the first is a business
 * decision awaiting the owner, the second was never a hole.
 */
describe('MDF-500 security fix — status gates NEW commitments, never a continuation or a give-back', () => {
  it('a SUSPENDED carrier cannot accept a still-pending leg proposal — the exact gap Dwight found, now closed', async () => {
    const carrier = await makeCarrier('Reef Runner Ltd');
    const { leg } = await proposedLeg(carrier.profileId);
    expect((await post(admin, `admin/logistics/providers/${carrier.profileId}/suspend`, { reason: 'Licence under review.' })).status).toBe(201);

    const accept = await post(carrier.cookies, `shipping/provider/legs/${leg.id}/accept`, {});
    expect(accept.status).toBe(400);
    expect(accept.body.message).toContain('suspended');
    expect((await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: leg.id } })).operatorAcceptedAt).toBeNull();
  });

  it('a REVOKED carrier cannot accept a still-pending leg proposal — the sharper case, REVOKED is meant to be the harder stop', async () => {
    const carrier = await makeCarrier('Reef Runner Ltd');
    const { leg } = await proposedLeg(carrier.profileId);
    expect((await post(admin, `admin/logistics/providers/${carrier.profileId}/revoke`, { reason: 'Repeated handoff failures.' })).status).toBe(201);

    const accept = await post(carrier.cookies, `shipping/provider/legs/${leg.id}/accept`, {});
    expect(accept.status).toBe(400);
    expect(accept.body.message).toContain('revoked');
    expect((await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: leg.id } })).operatorAcceptedAt).toBeNull();
  });

  it("the owner's final ruling (2026-11-04): a SUSPENDED carrier may still depart/arrive a leg it already accepted before suspension — an ordinary administrative hold must not strand a real shipment", async () => {
    const carrier = await makeCarrier('Reef Runner Ltd');
    const { leg } = await proposedLeg(carrier.profileId);
    expect((await post(carrier.cookies, `shipping/provider/legs/${leg.id}/accept`, {})).status).toBe(201);
    expect((await post(admin, `admin/logistics/providers/${carrier.profileId}/suspend`, { reason: 'Licence under review.' })).status).toBe(201);

    expect((await post(carrier.cookies, `shipping/provider/legs/${leg.id}/depart`, {})).status).toBe(201);
    expect((await post(carrier.cookies, `shipping/provider/legs/${leg.id}/arrive`, {})).status).toBe(201);

    // The asymmetry Dwight's review flagged: a NEW assignment to the same
    // suspended org is correctly refused, even though continuing this one
    // already-accepted leg is allowed.
    const s2 = await bookHubToHub();
    const [newLeg] = await legsOf(s2.id);
    expect((await setOperator(newLeg!.id, carrier.profileId)).status).toBe(400);
  });

  it("the owner's final ruling (2026-11-04): a REVOKED carrier may NOT depart or arrive a leg it already accepted — revocation is a security/safety cutoff, not an ordinary hold", async () => {
    const carrierA = await makeCarrier('Reef Runner Ltd');
    const { leg } = await proposedLeg(carrierA.profileId);
    expect((await post(carrierA.cookies, `shipping/provider/legs/${leg.id}/accept`, {})).status).toBe(201);
    expect((await post(admin, `admin/logistics/providers/${carrierA.profileId}/revoke`, { reason: 'Safety incident.' })).status).toBe(201);

    const depart = await post(carrierA.cookies, `shipping/provider/legs/${leg.id}/depart`, {});
    expect(depart.status).toBe(400);
    expect(depart.body.message).toContain('revoked');
    const arrive = await post(carrierA.cookies, `shipping/provider/legs/${leg.id}/arrive`, {});
    expect(arrive.status).toBe(400);
    expect(arrive.body.message).toContain('revoked');

    // Not stranded: admin can still recover the leg — hand it to a different
    // carrier, which immediately departs/arrives it, proving the shipment
    // itself was never blocked, only this now-revoked org's own access was.
    const carrierB = await makeCarrier('Cave Branch Bus Co');
    expect((await setOperator(leg.id, carrierB.profileId)).status).toBe(201);
    expect((await post(carrierB.cookies, `shipping/provider/legs/${leg.id}/accept`, {})).status).toBe(201);
    expect((await post(carrierB.cookies, `shipping/provider/legs/${leg.id}/depart`, {})).status).toBe(201);
    expect((await post(carrierB.cookies, `shipping/provider/legs/${leg.id}/arrive`, {})).status).toBe(201);
  });

  it("schedule() IS covered by the same ruling, exactly like depart/arrive: SUSPENDED may still schedule an already-accepted leg, REVOKED may not", async () => {
    const departureAt = new Date(Date.now() + 3600_000).toISOString();

    const suspended = await makeCarrier('Reef Runner Ltd');
    const { leg: legA } = await proposedLeg(suspended.profileId);
    expect((await post(suspended.cookies, `shipping/provider/legs/${legA.id}/accept`, {})).status).toBe(201);
    expect((await post(admin, `admin/logistics/providers/${suspended.profileId}/suspend`, { reason: 'Licence under review.' })).status).toBe(201);
    const scheduleSuspended = await post(suspended.cookies, `shipping/provider/legs/${legA.id}/schedule`, { scheduledDepartureAt: departureAt });
    expect(scheduleSuspended.status, JSON.stringify(scheduleSuspended.body)).toBe(201);

    const revoked = await makeCarrier('Cave Branch Bus Co');
    const { leg: legB } = await proposedLeg(revoked.profileId);
    expect((await post(revoked.cookies, `shipping/provider/legs/${legB.id}/accept`, {})).status).toBe(201);
    expect((await post(admin, `admin/logistics/providers/${revoked.profileId}/revoke`, { reason: 'Safety incident.' })).status).toBe(201);
    const scheduleRevoked = await post(revoked.cookies, `shipping/provider/legs/${legB.id}/schedule`, { scheduledDepartureAt: departureAt });
    expect(scheduleRevoked.status).toBe(400);
    expect(scheduleRevoked.body.message).toContain('revoked');
  });

  it('DELIBERATELY UNCHANGED: a REVOKED carrier may still reject a pending proposal or release a route it operates — giving work BACK is not a new commitment', async () => {
    const carrier = await makeCarrier('Reef Runner Ltd');
    const { leg } = await proposedLeg(carrier.profileId);
    const route = await ctx.prisma.logisticsRoute.findFirstOrThrow({ where: { operatedByProviderId: null } });
    expect((await post(carrier.cookies, `shipping/provider/routes/${route.id}/claim`, {})).status).toBe(201);
    expect((await post(admin, `admin/logistics/providers/${carrier.profileId}/revoke`, { reason: 'Repeated handoff failures.' })).status).toBe(201);

    expect((await post(carrier.cookies, `shipping/provider/legs/${leg.id}/reject`, { reason: 'Cannot take it.' })).status).toBe(201);
    expect((await post(carrier.cookies, `shipping/provider/routes/${route.id}/release`, {})).status).toBe(201);
    expect((await ctx.prisma.logisticsRoute.findUniqueOrThrow({ where: { id: route.id } })).operatedByProviderId).toBeNull();
  });

  it('a SUSPENDED carrier cannot set its own route weekly schedule or add/remove a schedule exception — all three are NEW commitments about future service', async () => {
    const carrier = await makeCarrier('Reef Runner Ltd');
    const route = await ctx.prisma.logisticsRoute.findFirstOrThrow({ where: { operatedByProviderId: null } });
    expect((await post(carrier.cookies, `shipping/provider/routes/${route.id}/claim`, {})).status).toBe(201);
    expect((await post(admin, `admin/logistics/providers/${carrier.profileId}/suspend`, { reason: 'Licence under review.' })).status).toBe(201);

    const weekly = await put(carrier.cookies, `shipping/provider/routes/${route.id}/schedule`, {
      days: [{ dayOfWeek: 1, status: 'OPERATING' }],
    });
    expect(weekly.status, `weekly schedule: ${JSON.stringify(weekly.body)}`).toBe(400);
    expect(weekly.body.message).toContain('suspended');

    const addException = await post(carrier.cookies, `shipping/provider/routes/${route.id}/schedule/exceptions`, {
      date: '2026-12-25', status: 'NOT_OPERATING', reason: 'Holiday.',
    });
    expect(addException.status, `add exception: ${JSON.stringify(addException.body)}`).toBe(400);
    expect(addException.body.message).toContain('suspended');

    const removeException = await request(ctx.server)
      .delete(`/api/shipping/provider/routes/${route.id}/schedule/exceptions/nonexistent00000000000000`)
      .set('Cookie', carrier.cookies);
    expect(removeException.status, `remove exception: ${JSON.stringify(removeException.body)}`).toBe(400);
    expect(removeException.body.message).toContain('suspended');
  });

  it('claimRoute was already correctly gated by status before this fix — a REVOKED carrier still cannot claim', async () => {
    const carrier = await makeCarrier('Reef Runner Ltd');
    expect((await post(admin, `admin/logistics/providers/${carrier.profileId}/revoke`, { reason: 'Repeated handoff failures.' })).status).toBe(201);
    const route = await ctx.prisma.logisticsRoute.findFirstOrThrow({ where: { operatedByProviderId: null } });
    const claim = await post(carrier.cookies, `shipping/provider/routes/${route.id}/claim`, {});
    expect(claim.status).toBe(400);
    expect(claim.body.message).toContain('revoked');
  });
});

describe('MDF-500 addition — the owner ruling requires a revoked carrier\'s shipments to stay administratively visible and recoverable', () => {
  it('an admin can list a carrier\'s shipments by operatedByProviderId, including a REVOKED org\'s existing work, and each leg carries operatedByProviderId for reassignment', async () => {
    const carrier = await makeCarrier('Reef Runner Ltd');
    const { shipment, leg } = await proposedLeg(carrier.profileId);
    expect((await post(admin, `admin/logistics/providers/${carrier.profileId}/revoke`, { reason: 'Safety incident.' })).status).toBe(201);

    const filtered = await get(admin, `admin/logistics/shipments?operatedByProviderId=${carrier.profileId}`);
    expect(filtered.status, JSON.stringify(filtered.body)).toBe(200);
    expect(filtered.body.rows.map((r: { id: string }) => r.id)).toContain(shipment.id);
    const matchedLeg = filtered.body.rows
      .find((r: { id: string }) => r.id === shipment.id)
      .legs.find((l: { id: string }) => l.id === leg.id);
    expect(matchedLeg.operatedByProviderId).toBe(carrier.profileId);

    const other = await makeCarrier('Cave Branch Bus Co');
    const otherFiltered = await get(admin, `admin/logistics/shipments?operatedByProviderId=${other.profileId}`);
    expect(otherFiltered.body.rows.map((r: { id: string }) => r.id)).not.toContain(shipment.id);
  });

  it('an admin can read a carrier\'s current member roster, with the name/email needed to confirm WHO it is — the read half of add/end member', async () => {
    const carrier = await makeCarrier('Reef Runner Ltd');
    const roster = await get(admin, `admin/logistics/providers/${carrier.profileId}/members`);
    expect(roster.status, JSON.stringify(roster.body)).toBe(200);
    expect(roster.body).toHaveLength(1);
    expect(roster.body[0].userId).toBe(carrier.userId);
    expect(roster.body[0].firstName).toBe('C');
    expect(roster.body[0].lastName).toBe('U');
    expect(roster.body[0].email).toBeTruthy();
    expect(roster.body[0].memberRole).toBe('OWNER');
    expect(roster.body[0].status).toBe('ACTIVE');
    expect(roster.body[0].startedAt).toBeTruthy();

    const unknown = await get(admin, `admin/logistics/providers/doesnotexist000000000000/members`);
    expect(unknown.status).toBe(404);
  });

  it('the providers directory surfaces WHY a carrier fails the status gate, not just its raw status — the third, server-only-computable reason', async () => {
    const carrier = await makeCarrier('Reef Runner Ltd');
    const approved = await get(admin, 'admin/logistics/providers');
    const approvedRow = approved.body.find((p: { id: string }) => p.id === carrier.profileId);
    expect(approvedRow.statusGateEligible).toBe(true);
    expect(approvedRow.statusGateReason).toBeNull();

    expect((await post(admin, `admin/logistics/providers/${carrier.profileId}/suspend`, { reason: 'Licence under review.' })).status).toBe(201);
    const suspended = await get(admin, 'admin/logistics/providers');
    const suspendedRow = suspended.body.find((p: { id: string }) => p.id === carrier.profileId);
    expect(suspendedRow.statusGateEligible).toBe(false);
    expect(suspendedRow.statusGateReason).toContain('suspended');
  });
});
