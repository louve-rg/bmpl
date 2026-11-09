/**
 * TERM-5: the handoff reversal. Before this, at a hub, staff revealed a
 * FIRST_MILE leg's handoff code and told the assigned courier verbally — the
 * secret travelled staff -> courier, backwards, since whoever staff told
 * would then pass the "proof" regardless of whether they were really the
 * assigned courier. This suite proves the fix: the courier self-reveals
 * their OWN code (never the recipient's), staff SUBMIT a presented identity
 * instead of already knowing the code, and a LAST_MILE hub-to-courier
 * release — previously unverified at all — now goes through the same
 * mechanism.
 *
 * Per the card's own instruction, this proves the REFUSALS, not just the
 * permitted path: a courier presenting a code for a leg that is not theirs;
 * staff submitting for a location they do not hold; the lockout actually
 * engaging; and a courier-facing response proven not to contain a recipient
 * delivery code.
 *
 * NOT in this file: staff being refused a FIRST_MILE reveal. That narrowing
 * (`revealHandoffPin` to LINE_HAUL-only) ships on its own branch, atomically
 * with the handoff-desk UI change that replaces the admin console's call to
 * it (TERM-5-UI) — see `revealHandoffPin`'s own doc comment. Until then
 * staff can still reveal a FIRST_MILE code exactly as before this branch.
 *
 * TERM-7: the staff-submit tests below (6, 8) were rewritten, not just
 * extended — `presentedCourierUserId` stopped being a client-trusted claim
 * and became something `ShipmentService` derives itself from the leg's own
 * assignment (completeLeg's own comment explains why a client-asserted
 * value here never carried information the server didn't already have).
 * The tests that were proving "a wrong claimed identity is refused" no
 * longer describe a reachable failure — there is no longer a claim for an
 * adversary to get wrong — so they were replaced with tests proving the
 * actual remaining protections: the code itself, the lockout, and a new
 * one this card's own audit required — a courier-kind leg with NO assigned
 * courier at all refuses a staff submission outright (6c, 8c), instead of
 * silently falling through the `assignedDriverProfileId == null` check
 * that exists for LINE_HAUL's courier-less handoff.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedLimitedAdmin, seedRoles, seedBaselineCourierCoverage, seedSuperAdmin, type TestContext } from './helpers';
import { ShipmentDispatchService } from '../src/shipping/shipment-dispatch.service';

let ctx: TestContext;
let dispatch: ShipmentDispatchService;
let admin: string[];
let hub: Record<string, string> = {};
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);

async function registerUser(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

async function makeCourier(district: string) {
  const s = uniq();
  const { cookies, userId } = await registerUser(`courier_${s}@example.com`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId, isTest: false, legalName: 'D River', displayName: `Drv${s}`, phone: '+5016000000',
      homeDistrict: district as never, licenceNumber: `HDL-${s}`, licenceExpiry: FUTURE,
      vehicleOwnership: 'OWNED', availability: 'ONLINE', isActive: true,
    },
  });
  await ctx.prisma.driverVehicle.create({
    data: {
      driverProfileId: profile.id, type: 'CAR', make: 'Toyota', model: 'Corolla',
      licencePlate: `HV-${s}`.slice(0, 18), registrationExpiry: FUTURE, insuranceExpiry: FUTURE,
      isActive: true, isPrimary: true, approvalStatus: 'APPROVED',
    },
  });
  await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: district as never, isActive: true } });
  return { cookies, userId, driverProfileId: profile.id };
}

async function seedNetwork() {
  const hubs = [
    { code: 'R5-MUN', name: 'Belize City Municipal Airstrip', district: 'BELIZE', city: 'Belize City', fee: 1000 },
    { code: 'R5-SPA', name: 'San Pedro Airstrip', district: 'BELIZE', city: 'San Pedro', fee: 1500 },
    { code: 'R5-PLA', name: 'Placencia Airstrip', district: 'STANN_CREEK', city: 'Placencia', fee: 1200 },
  ];
  hub = {};
  for (const h of hubs) {
    const r = await post(admin, 'admin/logistics/hubs', {
      code: h.code, name: h.name, type: 'AIRSTRIP', district: h.district, city: h.city, modes: ['LAND', 'AIR'],
      courierFeeMinor: h.fee,
    });
    expect(r.status).toBe(201);
    hub[h.code] = r.body.id;
  }
  for (const r of [
    { from: 'R5-PLA', to: 'R5-MUN', minutes: 45, price: 8000 },
    { from: 'R5-MUN', to: 'R5-SPA', minutes: 20, price: 6000 },
  ]) {
    expect((await post(admin, 'admin/logistics/routes', {
      originHubId: hub[r.from], destinationHubId: hub[r.to], mode: 'AIR',
      durationMinutes: r.minutes, priceMinor: r.price, carrierName: 'Tropic Air',
    })).status).toBe(201);
  }
}

async function enableDispatch(on = true) {
  const row = await ctx.prisma.platformSetting.findFirst();
  const data = { dispatchAutomatic: on, dispatchOfferTimeoutSeconds: 90, dispatchMaxOffers: 3, dispatchMaxConcurrentPerDriver: 3 };
  if (row) await ctx.prisma.platformSetting.update({ where: { id: row.id }, data });
  else await ctx.prisma.platformSetting.create({ data });
}

const doorToDoor = () => ({
  service: 'DOOR_TO_DOOR',
  origin: { district: 'STANN_CREEK', city: 'Placencia', address: '1 Sidewalk', name: 'Sender', phone: '501-2223333', latitude: 16.5122, longitude: -88.3661 },
  destination: { district: 'BELIZE', city: 'San Pedro', address: '5 Barrier Reef Drive', name: 'Recipient', phone: '501-4445555', latitude: 17.9214, longitude: -87.9611 },
  preferredMode: 'AIR',
  description: 'One box',
});

async function fundedSender() {
  const { cookies, userId } = await registerUser(`sender_${uniq()}@example.com`);
  await post(admin, 'admin/wallet/test-credit', { userId, amountMinor: 100_000, reason: 'TERM-5 test fixture.' });
  return { cookies, userId };
}

async function book(cookies: string[]) {
  const r = await post(cookies, 'shipping', { ...doorToDoor(), payWithWallet: true });
  expect(r.status).toBe(201);
  return r.body;
}

const legsOf = (shipmentId: string) => ctx.prisma.shipmentLeg.findMany({ where: { shipmentId }, orderBy: { sequence: 'asc' } });
async function journey(shipmentId: string) {
  const all = await legsOf(shipmentId);
  return {
    firstMile: all.find((l) => l.kind === 'FIRST_MILE')!,
    lineHauls: all.filter((l) => l.kind === 'LINE_HAUL').sort((a, b) => a.sequence - b.sequence),
    lastMile: all.find((l) => l.kind === 'LAST_MILE')!,
  };
}
async function legRow(legId: string) {
  return ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId } });
}

/** An operations account holding the given admin permissions — no driver profile. */
async function makeOperator(permissions: string[]) {
  const email = `op_${uniq()}@example.bz`;
  const a = await seedLimitedAdmin(ctx.prisma, email, permissions);
  const cookies = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password }));
  return { cookies, userId: a.id };
}

/** A terminal company staff member, created the direct way (no invite-email
 *  round trip — that flow is TERM-3's own suite's concern), scoped to
 *  exactly the hub ids given. */
async function makeTerminalStaff(hubIds: string[]) {
  const s = uniq();
  const { cookies, userId } = await registerUser(`staff_${s}@example.com`);
  const company = await ctx.prisma.terminalCompanyProfile.create({
    data: { businessName: `Reef Terminals ${s}`, contactEmail: `reef_${s}@example.com`, isActive: true, isTest: false },
  });
  const member = await ctx.prisma.terminalCompanyMember.create({
    data: { terminalCompanyId: company.id, userId, memberRole: 'OPERATOR', status: 'ACTIVE' },
  });
  for (const hubId of hubIds) {
    const location = await ctx.prisma.terminalCompanyLocation.create({
      data: { terminalCompanyId: company.id, hubId, isActive: true },
    });
    await ctx.prisma.terminalCompanyMemberLocation.create({ data: { memberId: member.id, locationId: location.id } });
  }
  return { cookies, userId, companyId: company.id };
}

/** Drives a FIRST_MILE leg from dispatch through acceptance to IN_PROGRESS
 *  (pickup confirmed), exactly as the pre-existing courier-identity suite
 *  does — right up to, but not through, the handoff this file tests. */
async function driveFirstMileToInProgress(courier: { cookies: string[] }, legId: string) {
  await dispatch.dispatchLeg(legId);
  const leg = await legRow(legId);
  expect(leg.assignedDriverProfileId).not.toBeNull();
  expect((await post(courier.cookies, `driver/shipping-jobs/${legId}/accept`)).status).toBe(201);
  const pickupPin = (await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId }, select: { pickupPin: true } })).pickupPin!;
  expect((await post(courier.cookies, `driver/shipping-jobs/${legId}/pickup`, { pin: pickupPin })).status).toBe(201);
  expect((await post(courier.cookies, `driver/shipping-jobs/${legId}/in-transit`)).status).toBe(201);
  expect((await post(courier.cookies, `driver/shipping-jobs/${legId}/arriving`)).status).toBe(201);
}

/** Carries a shipment all the way to the point a LAST_MILE leg has been
 *  dispatched and its courier has accepted (DRIVER_ACCEPTED) but not yet
 *  picked up — the exact moment this file's release-to-courier tests
 *  exercise. Completes FIRST_MILE and every LINE_HAUL leg on the way using
 *  the plain admin code-only route (no presented-courier identity needed —
 *  LINE_HAUL has no assigned courier, and FIRST_MILE's own courier submits
 *  through their own app here, which is unaffected by this card). */
async function driveToLastMileAccepted(firstCourier: { cookies: string[] }, lastMileCourier: { cookies: string[] }, shipmentId: string) {
  const { firstMile, lineHauls, lastMile } = await journey(shipmentId);
  await driveFirstMileToInProgress(firstCourier, firstMile.id);
  const firstMilePin = (await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: firstMile.id }, select: { handoffPin: true } })).handoffPin!;
  expect((await post(firstCourier.cookies, `driver/shipping-jobs/${firstMile.id}/handoff`, { pin: firstMilePin, receivedByName: 'Terminal desk' })).status).toBe(201);
  for (const lh of lineHauls) {
    expect((await post(admin, `admin/logistics/legs/${lh.id}/depart`, {})).status).toBe(201);
    expect((await post(admin, `admin/logistics/legs/${lh.id}/arrive`, {})).status).toBe(201);
    const lhPin = (await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: lh.id }, select: { handoffPin: true } })).handoffPin!;
    expect((await post(admin, `admin/logistics/legs/${lh.id}/handoff`, { pin: lhPin, receivedByName: 'Receiving desk' })).status).toBe(201);
  }
  await dispatch.dispatchLeg(lastMile.id);
  const assigned = await legRow(lastMile.id);
  expect(assigned.assignedDriverProfileId).not.toBeNull();
  expect((await post(lastMileCourier.cookies, `driver/shipping-jobs/${lastMile.id}/accept`)).status).toBe(201);
  return { firstMile, lastMile };
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password }));
  dispatch = ctx.app.get(ShipmentDispatchService);
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await ctx.prisma.terminalCompanyMemberLocation.deleteMany();
  await ctx.prisma.terminalCompanyMember.deleteMany();
  await ctx.prisma.terminalCompanyLocation.deleteMany();
  await ctx.prisma.terminalCompanyProfile.deleteMany();
  await ctx.prisma.shipmentLegOffer.deleteMany();
  await ctx.prisma.custodyEvent.deleteMany();
  await ctx.prisma.driverEarning.deleteMany();
  await ctx.prisma.shipmentLeg.deleteMany();
  await ctx.prisma.shipment.deleteMany();
  await ctx.prisma.logisticsRoute.deleteMany();
  await ctx.prisma.logisticsHub.deleteMany();
  await ctx.prisma.driverServiceArea.deleteMany();
  await ctx.prisma.driverVehicle.deleteMany();
  await ctx.prisma.driverProfile.deleteMany();
  await enableDispatch(true);
  await seedNetwork();
  await seedBaselineCourierCoverage(ctx.prisma);
});

describe('the courier self-reveal (TERM-5)', () => {
  it('1 · the assigned FIRST_MILE courier reads their own handoff code, and it matches the leg', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const { firstMile } = await journey(shipment.id);
    await driveFirstMileToInProgress(courier, firstMile.id);

    const r = await get(courier.cookies, `driver/shipping-jobs/${firstMile.id}/code`);
    expect(r.status).toBe(200);
    expect(r.body.kind).toBe('handoff');
    const real = (await legRow(firstMile.id)).handoffPin;
    expect(r.body.code).toBe(real);
  });

  it('2 · a courier who is NOT assigned to this leg cannot read its code — 404, not a leaked 403', async () => {
    const sender = await fundedSender();
    const courierA = await makeCourier('STANN_CREEK');
    const courierB = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const { firstMile } = await journey(shipment.id);
    await driveFirstMileToInProgress(courierA, firstMile.id);

    const r = await get(courierB.cookies, `driver/shipping-jobs/${firstMile.id}/code`);
    expect(r.status).toBe(404);
  });

  it('3 · a LAST_MILE courier reads pickupPin, never the leg\'s own handoffPin — the recipient\'s own delivery code never appears in a courier-facing response', async () => {
    const sender = await fundedSender();
    const firstCourier = await makeCourier('STANN_CREEK');
    const lastCourier = await makeCourier('BELIZE');
    const shipment = await book(sender.cookies);
    const { lastMile } = await driveToLastMileAccepted(firstCourier, lastCourier, shipment.id);

    const row = await legRow(lastMile.id);
    const r = await get(lastCourier.cookies, `driver/shipping-jobs/${lastMile.id}/code`);
    expect(r.status).toBe(200);
    expect(r.body.kind).toBe('pickup');
    expect(r.body.code).toBe(row.pickupPin);
    expect(r.body.code).not.toBe(row.handoffPin);
    expect(JSON.stringify(r.body)).not.toContain(row.handoffPin!);
  });

  // Test 4 — "staff can no longer reveal a FIRST_MILE code" — moves to the
  // narrowing's own branch (see revealHandoffPin's doc comment): that
  // behavior change ships atomically with the handoff-desk UI replacement
  // (TERM-5-UI), not here. Until then the pre-existing FIRST_MILE reveal
  // stays exactly as it was — untouched by this branch, so it needs no new
  // test on it.
});

describe('staff submit the presented courier\'s code (TERM-5)', () => {
  it('5 · an ops account submits the right code AND the right presented courier — now succeeds where it used to be structurally impossible', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const { firstMile } = await journey(shipment.id);
    await driveFirstMileToInProgress(courier, firstMile.id);

    const ops = await makeOperator(['logistics.operate']);
    const code = (await get(courier.cookies, `driver/shipping-jobs/${firstMile.id}/code`)).body.code;
    const r = await post(ops.cookies, `admin/logistics/legs/${firstMile.id}/handoff`, {
      pin: code,
      receivedByName: 'Terminal desk',
      presentedCourierUserId: courier.userId,
    });
    expect(r.status).toBe(201);
    expect((await legRow(firstMile.id)).status).toBe('COMPLETED');
  });

  it('6 · the right code but the WRONG presented courier still fails — a presented identity is really checked, not just a correct code', async () => {
    const sender = await fundedSender();
    const courierA = await makeCourier('STANN_CREEK');
    const courierB = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const { firstMile } = await journey(shipment.id);
    await driveFirstMileToInProgress(courierA, firstMile.id);

    const ops = await makeOperator(['logistics.operate']);
    const code = (await get(courierA.cookies, `driver/shipping-jobs/${firstMile.id}/code`)).body.code;
    // TERM-7: a wrong claimed identity (courierB, not the real assignee) is
    // left exactly as given — never silently overwritten with the real
    // assignee — so it is refused by the same isAssignedCourier comparison
    // this always ran, not bypassed by the new derivation.
    const r = await post(ops.cookies, `admin/logistics/legs/${firstMile.id}/handoff`, {
      pin: code,
      receivedByName: 'Terminal desk',
      presentedCourierUserId: courierB.userId,
    });
    expect(r.status).toBe(400);
    const after = await legRow(firstMile.id);
    expect(after.status).toBe('IN_PROGRESS');
    expect(after.handoffPinAttempts).toBe(1);
    const failure = await ctx.prisma.auditLog.findFirst({
      where: { action: 'SHIPMENT_LEG_HANDOFF_PIN_FAILED', actorId: ops.userId },
      orderBy: { createdAt: 'desc' },
    });
    expect((failure!.newValue as { wrongCourier: boolean }).wrongCourier).toBe(true);
  });

  it('6b · TERM-7: presentedByAssignedCourier succeeds with no courier identity sent at all', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const { firstMile } = await journey(shipment.id);
    await driveFirstMileToInProgress(courier, firstMile.id);

    const ops = await makeOperator(['logistics.operate']);
    const code = (await get(courier.cookies, `driver/shipping-jobs/${firstMile.id}/code`)).body.code;
    const r = await post(ops.cookies, `admin/logistics/legs/${firstMile.id}/handoff`, {
      pin: code,
      receivedByName: 'Terminal desk',
      presentedByAssignedCourier: true,
    });
    expect(r.status).toBe(201);
    expect((await legRow(firstMile.id)).status).toBe('COMPLETED');
  });

  it('6c · TERM-7: a staff submission is refused outright when the leg has no assigned courier at all — nobody could have presented anything', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const { firstMile } = await journey(shipment.id);
    await driveFirstMileToInProgress(courier, firstMile.id);
    const code = (await get(courier.cookies, `driver/shipping-jobs/${firstMile.id}/code`)).body.code;
    // Simulates the state the TERM-7 audit found reachable through the
    // pre-existing `assignedDriverProfileId == null` fallback in
    // verifyLegPinOrThrow — meant only for LINE_HAUL's own courier-less
    // handoff, but structurally reachable for a courier-kind leg too.
    await ctx.prisma.shipmentLeg.update({ where: { id: firstMile.id }, data: { assignedDriverProfileId: null } });

    const ops = await makeOperator(['logistics.operate']);
    const r = await post(ops.cookies, `admin/logistics/legs/${firstMile.id}/handoff`, {
      pin: code,
      receivedByName: 'Terminal desk',
      presentedByAssignedCourier: true,
    });
    expect(r.status).toBe(400);
    const after = await legRow(firstMile.id);
    expect(after.status).toBe('IN_PROGRESS');
    // Refused before the code was ever checked — no attempt recorded.
    expect(after.handoffPinAttempts).toBe(0);
  });
});

describe('releasing a LAST_MILE leg to its courier at a terminal (TERM-5)', () => {
  it('7 · staff release the leg with the courier\'s own self-revealed code — the gap confirmPickup never covered', async () => {
    const sender = await fundedSender();
    const firstCourier = await makeCourier('STANN_CREEK');
    const lastCourier = await makeCourier('BELIZE');
    const shipment = await book(sender.cookies);
    const { lastMile } = await driveToLastMileAccepted(firstCourier, lastCourier, shipment.id);

    const code = (await get(lastCourier.cookies, `driver/shipping-jobs/${lastMile.id}/code`)).body.code;
    const ops = await makeOperator(['logistics.operate']);
    const r = await post(ops.cookies, `admin/logistics/legs/${lastMile.id}/release-to-courier`, {
      pin: code,
      presentedCourierUserId: lastCourier.userId,
    });
    expect(r.status).toBe(201);
    const after = await legRow(lastMile.id);
    expect(after.status).toBe('IN_PROGRESS');
    expect(after.courierStatus).toBe('PICKUP_CONFIRMED');
    expect(after.pickupVerificationStatus).toBe('VERIFIED');

    const custody = await ctx.prisma.custodyEvent.findFirst({
      where: { shipmentLegId: lastMile.id, toHolder: 'DRIVER' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(custody?.actorUserId).toBe(lastCourier.userId);
  });

  it('8 · a courier presenting a code for a leg that is not theirs is refused, and the attempt counts (lockout engaging)', async () => {
    const sender = await fundedSender();
    const firstCourier = await makeCourier('STANN_CREEK');
    const lastCourier = await makeCourier('BELIZE');
    const impostor = await makeCourier('BELIZE');
    const shipment = await book(sender.cookies);
    const { lastMile } = await driveToLastMileAccepted(firstCourier, lastCourier, shipment.id);

    const code = (await get(lastCourier.cookies, `driver/shipping-jobs/${lastMile.id}/code`)).body.code;
    const ops = await makeOperator(['logistics.operate']);

    // TERM-7: staffReleaseToCourier now honours an explicit presented
    // identity exactly like completeLeg — left as given, never silently
    // overwritten — so the impostor's claim is refused by the same
    // isAssignedCourier comparison, not ignored.
    for (let i = 1; i <= 5; i += 1) {
      const r = await post(ops.cookies, `admin/logistics/legs/${lastMile.id}/release-to-courier`, {
        pin: code,
        presentedCourierUserId: impostor.userId,
      });
      expect(r.status).toBe(400);
      const after = await legRow(lastMile.id);
      expect(after.pickupPinAttempts).toBe(i);
    }
    // The fifth failure locks it into EXCEPTION — the same shared lockout
    // completeLeg's own verifyLegPinOrThrow already enforces, now reachable
    // from this leg kind for the first time.
    const locked = await legRow(lastMile.id);
    expect(locked.status).toBe('EXCEPTION');

    // The real courier, with the real code, is now ALSO refused — the leg
    // itself is locked, not just the impostor's own attempts.
    const real = await post(ops.cookies, `admin/logistics/legs/${lastMile.id}/release-to-courier`, {
      pin: code,
      presentedCourierUserId: lastCourier.userId,
    });
    expect(real.status).toBe(403);
  });

  it('8b · a WRONG code still fails and locks out normally, this route\'s only remaining protection', async () => {
    const sender = await fundedSender();
    const firstCourier = await makeCourier('STANN_CREEK');
    const lastCourier = await makeCourier('BELIZE');
    const shipment = await book(sender.cookies);
    const { lastMile } = await driveToLastMileAccepted(firstCourier, lastCourier, shipment.id);

    const ops = await makeOperator(['logistics.operate']);
    for (let i = 1; i <= 5; i += 1) {
      const r = await post(ops.cookies, `admin/logistics/legs/${lastMile.id}/release-to-courier`, { pin: '000000' });
      expect(r.status).toBe(400);
      const after = await legRow(lastMile.id);
      expect(after.pickupPinAttempts).toBe(i);
    }
    // The fifth failure locks it into EXCEPTION — the same shared lockout
    // completeLeg's own verifyLegPinOrThrow already enforces, reachable
    // from this leg kind since TERM-5.
    const locked = await legRow(lastMile.id);
    expect(locked.status).toBe('EXCEPTION');

    // Even the real code is now refused — the leg itself is locked.
    const real = await post(ops.cookies, `admin/logistics/legs/${lastMile.id}/release-to-courier`, { pin: '000000' });
    expect(real.status).toBe(403);
  });

  it('8c · release-to-courier refuses outright when no courier is assigned at all', async () => {
    const sender = await fundedSender();
    const firstCourier = await makeCourier('STANN_CREEK');
    const lastCourier = await makeCourier('BELIZE');
    const shipment = await book(sender.cookies);
    const { lastMile } = await driveToLastMileAccepted(firstCourier, lastCourier, shipment.id);
    const code = (await get(lastCourier.cookies, `driver/shipping-jobs/${lastMile.id}/code`)).body.code;
    await ctx.prisma.shipmentLeg.update({ where: { id: lastMile.id }, data: { assignedDriverProfileId: null } });

    const ops = await makeOperator(['logistics.operate']);
    const r = await post(ops.cookies, `admin/logistics/legs/${lastMile.id}/release-to-courier`, { pin: code });
    expect(r.status).toBe(400);
    expect((await legRow(lastMile.id)).pickupPinAttempts).toBe(0);
  });

  it('9 · release-to-courier refuses any leg kind other than LAST_MILE', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const { firstMile } = await journey(shipment.id);
    await driveFirstMileToInProgress(courier, firstMile.id);

    const ops = await makeOperator(['logistics.operate']);
    const code = (await get(courier.cookies, `driver/shipping-jobs/${firstMile.id}/code`)).body.code;
    const r = await post(ops.cookies, `admin/logistics/legs/${firstMile.id}/release-to-courier`, {
      pin: code,
      presentedCourierUserId: courier.userId,
    });
    expect(r.status).toBe(400);
  });
});

describe('a terminal company\'s own staff submitting at their own location (TERM-5)', () => {
  it('10 · a terminal staff member holding the FIRST_MILE hub location can submit a handoff there', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const { firstMile } = await journey(shipment.id);
    await driveFirstMileToInProgress(courier, firstMile.id);
    const hubId = (await legRow(firstMile.id)).destinationHubId!;
    const staff = await makeTerminalStaff([hubId]);

    const code = (await get(courier.cookies, `driver/shipping-jobs/${firstMile.id}/code`)).body.code;
    const r = await post(staff.cookies, `terminal/legs/${firstMile.id}/handoff`, {
      pin: code,
      receivedByName: 'Terminal staff',
      presentedCourierUserId: courier.userId,
    });
    expect(r.status).toBe(201);
    expect((await legRow(firstMile.id)).status).toBe('COMPLETED');
  });

  it('11 · staff submitting for a location they do not hold is refused — even a DIFFERENT location their OWN company operates', async () => {
    const sender = await fundedSender();
    const firstCourier = await makeCourier('STANN_CREEK');
    const lastCourier = await makeCourier('BELIZE');
    const shipment = await book(sender.cookies);
    const { lastMile } = await driveToLastMileAccepted(firstCourier, lastCourier, shipment.id);
    const releaseHubId = (await legRow(lastMile.id)).originHubId!;
    const otherHubId = hub['R5-PLA']!;
    expect(otherHubId).not.toBe(releaseHubId);
    // This staff member's own company holds PLA, not the SPA hub this
    // release actually happens at.
    const staff = await makeTerminalStaff([otherHubId]);

    const code = (await get(lastCourier.cookies, `driver/shipping-jobs/${lastMile.id}/code`)).body.code;
    const r = await post(staff.cookies, `terminal/legs/${lastMile.id}/release-to-courier`, {
      pin: code,
      presentedCourierUserId: lastCourier.userId,
    });
    expect(r.status).toBe(403);
    // Refused before the code was ever checked — no attempt recorded.
    expect((await legRow(lastMile.id)).pickupPinAttempts).toBe(0);
  });

  it('12 · a terminal staff member holding the RIGHT location releases a LAST_MILE leg to its courier', async () => {
    const sender = await fundedSender();
    const firstCourier = await makeCourier('STANN_CREEK');
    const lastCourier = await makeCourier('BELIZE');
    const shipment = await book(sender.cookies);
    const { lastMile } = await driveToLastMileAccepted(firstCourier, lastCourier, shipment.id);
    const hubId = (await legRow(lastMile.id)).originHubId!;
    const staff = await makeTerminalStaff([hubId]);

    const code = (await get(lastCourier.cookies, `driver/shipping-jobs/${lastMile.id}/code`)).body.code;
    const r = await post(staff.cookies, `terminal/legs/${lastMile.id}/release-to-courier`, {
      pin: code,
      presentedCourierUserId: lastCourier.userId,
    });
    expect(r.status).toBe(201);
    expect((await legRow(lastMile.id)).courierStatus).toBe('PICKUP_CONFIRMED');
  });

  it('13 · someone with no terminal membership at all is refused the same way', async () => {
    const sender = await fundedSender();
    const courier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const { firstMile } = await journey(shipment.id);
    await driveFirstMileToInProgress(courier, firstMile.id);
    const bystander = await registerUser(`bystander_${uniq()}@example.com`);

    const code = (await get(courier.cookies, `driver/shipping-jobs/${firstMile.id}/code`)).body.code;
    const r = await post(bystander.cookies, `terminal/legs/${firstMile.id}/handoff`, {
      pin: code,
      receivedByName: 'Nobody',
      presentedCourierUserId: courier.userId,
    });
    expect(r.status).toBe(403);
  });
});
