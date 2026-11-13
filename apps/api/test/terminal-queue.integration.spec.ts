/**
 * TERM-8: the terminal operator's own work queue, plus the three custody
 * steps PART 1 of this card found with no terminal-scoped route at all —
 * departure from the origin terminal, arrival confirmation, and collection
 * at the destination terminal (`departLeg`/`arriveLeg`/`recordCollection`,
 * previously reachable only through `admin/logistics`'s `logistics.operate`
 * gate). `GET terminal/queue` and the three new `POST terminal/legs/:id/
 * {depart,arrive}` / `POST terminal/shipments/:id/collect` routes mirror
 * their admin equivalents exactly, under `TerminalService.
 * assertStaffLocationAccess` instead.
 *
 * The scoping tests are the point, same as TERM-3/TERM-5 before it: a leg
 * or shipment at a location a staff member was not granted must not appear
 * in the queue — not merely be refused if they try to act on it — covering
 * another company, another location inside the SAME company, a deactivated
 * location, and an ended membership.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const del = (c: string[], p: string) => request(ctx.server).delete(`/api/${p}`).set('Cookie', c);

async function registerUser(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

/** A fresh two-hub water-taxi network (SEA), unique per call — mirrors
 *  transport-leg-operations.integration.spec.ts's own Edward fixture.
 *  LogisticsHub.code is capped at 12 characters, so the tag is just enough
 *  to keep two calls colliding — not a description. The CITY names are
 *  unique too, not just the codes: `shipping`'s booking endpoint plans by
 *  district/city, not by hub id, so two networks reusing "San Pedro" would
 *  leave the planner free to route a later test's booking across an
 *  EARLIER test's hubs the moment more than one SEA route serves the same
 *  city pair — exactly the kind of cross-test leak this card's own
 *  location-scoping tests exist to catch, just one layer up in the
 *  fixture rather than in the product. */
async function makeNetwork() {
  const tag = uniq().slice(-9);
  const originCity = `SP ${tag}`;
  const destinationCity = `BC ${tag}`;
  const origin = await post(admin, 'admin/logistics/hubs', {
    code: `${tag}O`, name: `San Pedro Water Taxi ${tag}`, type: 'WATER_TAXI_TERMINAL',
    district: 'BELIZE', city: originCity, modes: ['LAND', 'SEA'], courierFeeMinor: 1500,
  });
  const destination = await post(admin, 'admin/logistics/hubs', {
    code: `${tag}D`, name: `Belize City Water Taxi ${tag}`, type: 'WATER_TAXI_TERMINAL',
    district: 'BELIZE', city: destinationCity, modes: ['LAND', 'SEA'], courierFeeMinor: 1000,
  });
  expect(origin.status).toBe(201);
  expect(destination.status).toBe(201);
  const route = await post(admin, 'admin/logistics/routes', {
    originHubId: origin.body.id, destinationHubId: destination.body.id, mode: 'SEA',
    durationMinutes: 90, priceMinor: 3000, carrierName: 'UAT Water Taxi',
  });
  expect(route.status).toBe(201);
  return { originHubId: origin.body.id as string, destinationHubId: destination.body.id as string, originCity, destinationCity };
}

async function fundedSender() {
  const { cookies, userId } = await registerUser(`sender_${uniq()}@example.com`);
  await post(admin, 'admin/wallet/test-credit', { userId, amountMinor: 100_000, reason: 'TERM-8 test fixture.' });
  return cookies;
}

/** Door-to-door across the SEA network above: plans as FIRST_MILE /
 *  LINE_HAUL / LAST_MILE. */
async function bookDoorToDoor(cookies: string[], net: { originCity: string; destinationCity: string }) {
  const r = await post(cookies, 'shipping', {
    service: 'DOOR_TO_DOOR',
    origin: { district: 'BELIZE', city: net.originCity, address: '10 Barrier Reef Drive', name: 'Sender', phone: '501-2223333' },
    destination: { district: 'BELIZE', city: net.destinationCity, address: '2 Albert Street', name: 'Recipient', phone: '501-4445555' },
    preferredMode: 'SEA',
    description: 'One box',
    payWithWallet: true,
  });
  expect(r.status).toBe(201);
  return r.body;
}

/** Door-to-hub, ending AT the destination terminal — no LAST_MILE, so the
 *  journey closes with `recordCollection`, not a door handoff. */
async function bookDoorToHub(cookies: string[], net: { originCity: string; destinationHubId: string }) {
  const r = await post(cookies, 'shipping', {
    service: 'DOOR_TO_HUB',
    origin: { district: 'BELIZE', city: net.originCity, address: '10 Barrier Reef Drive', name: 'Sender', phone: '501-2223333' },
    destination: { hubId: net.destinationHubId, name: 'Recipient', phone: '501-4445555' },
    preferredMode: 'SEA',
    description: 'One box',
    payWithWallet: true,
  });
  expect(r.status).toBe(201);
  return r.body;
}

const legsOf = (shipmentId: string) => ctx.prisma.shipmentLeg.findMany({ where: { shipmentId }, orderBy: { sequence: 'asc' } });
async function pinOf(legId: string) {
  return (await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId }, select: { handoffPin: true } })).handoffPin!;
}

/** Completes a FIRST_MILE leg with no courier identity presented at all —
 *  the plain code-only path every completion already supports (BMPL-174),
 *  so this needs no driver assigned. Mirrors shipping.integration.spec.ts's
 *  own `completeLeg(id, pin, false)` helper: `start` first (no assigned
 *  driver means the ownership check inside it is a no-op), then `handoff`. */
async function completeFirstMileAsAdmin(legId: string) {
  expect((await post(admin, `admin/logistics/legs/${legId}/start`, {})).status).toBe(201);
  const r = await post(admin, `admin/logistics/legs/${legId}/handoff`, { pin: await pinOf(legId), receivedByName: 'Counter staff' });
  expect(r.status).toBe(201);
  return r.body;
}

/** Completes a LINE_HAUL leg already arrived — the far-terminal handoff. */
async function completeLineHaulAsAdmin(legId: string) {
  const r = await post(admin, `admin/logistics/legs/${legId}/handoff`, { pin: await pinOf(legId), receivedByName: 'Counter staff' });
  expect(r.status).toBe(201);
  return r.body;
}

/** Books, completes the first mile directly, and returns the LINE_HAUL leg
 *  now sitting READY to depart from the origin terminal. */
async function bookedReadyToDepart(cookies: string[], net: { originCity: string; destinationCity: string }) {
  const s = await bookDoorToDoor(cookies, net);
  const rows = await legsOf(s.id);
  const firstMile = rows.find((l) => l.kind === 'FIRST_MILE')!;
  await completeFirstMileAsAdmin(firstMile.id);
  const lineHaul = (await legsOf(s.id)).find((l) => l.kind === 'LINE_HAUL')!;
  expect(lineHaul.status).toBe('READY');
  return { shipment: s, lineHaul };
}

/** An approved, online driver serving BELIZE district, for the one step
 *  (release-to-courier) that genuinely needs an assigned, accepted courier. */
async function makeDriver() {
  const s = uniq();
  const { cookies, userId } = await registerUser(`tdrv_${s}@example.com`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId, legalName: 'T Driver', displayName: `Tdr${s}`, phone: '+5016000000',
      homeDistrict: 'BELIZE', licenceNumber: `TDL-${s}`, licenceExpiry: FUTURE,
      vehicleOwnership: 'OWNED', availability: 'ONLINE', isActive: true,
    },
  });
  const vehicle = await ctx.prisma.driverVehicle.create({
    data: {
      driverProfileId: profile.id, type: 'CAR', make: 'Toyota', model: 'Hilux',
      licencePlate: `TL-${s}`.slice(0, 18), registrationExpiry: FUTURE, insuranceExpiry: FUTURE,
      isActive: true, isPrimary: true, approvalStatus: 'APPROVED',
    },
  });
  await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: 'BELIZE', isActive: true } });
  return { cookies, userId, driverProfileId: profile.id, vehicleId: vehicle.id };
}

/** A terminal company staff member, created the direct way (no invite-email
 *  round trip — TERM-3's own suite covers that flow), scoped to exactly the
 *  hub ids given. Returns enough to also exercise the negative cases. */
async function makeTerminalStaff(hubIds: string[]) {
  const s = uniq();
  const { cookies, userId } = await registerUser(`staff_${s}@example.com`);
  const company = await ctx.prisma.terminalCompanyProfile.create({
    data: { businessName: `Reef Terminals ${s}`, contactEmail: `reef_${s}@example.com`, isActive: true, isTest: false },
  });
  const member = await ctx.prisma.terminalCompanyMember.create({
    data: { terminalCompanyId: company.id, userId, memberRole: 'OPERATOR', status: 'ACTIVE' },
  });
  const locationIds: string[] = [];
  for (const hubId of hubIds) {
    const location = await ctx.prisma.terminalCompanyLocation.create({ data: { terminalCompanyId: company.id, hubId, isActive: true } });
    await ctx.prisma.terminalCompanyMemberLocation.create({ data: { memberId: member.id, locationId: location.id } });
    locationIds.push(location.id);
  }
  return { cookies, userId, companyId: company.id, memberId: member.id, locationIds };
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

describe('TERM-8: departure from the origin terminal — previously admin-only', () => {
  it('appears in the queue at the origin terminal, and a granted operator can record it', async () => {
    const net = await makeNetwork();
    const staff = await makeTerminalStaff([net.originHubId]);
    const { lineHaul } = await bookedReadyToDepart(await fundedSender(), net);

    const queue = await get(staff.cookies, 'terminal/queue');
    expect(queue.status).toBe(200);
    const item = queue.body.find((i: { action: string; legId: string }) => i.action === 'DEPART' && i.legId === lineHaul.id);
    expect(item).toBeDefined();
    expect(item.hubId).toBe(net.originHubId);

    const departed = await post(staff.cookies, `terminal/legs/${lineHaul.id}/depart`, { carrierName: 'UAT Water Taxi' });
    expect(departed.status).toBe(201);
    const row = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: lineHaul.id } });
    expect(row.status).toBe('IN_PROGRESS');
    expect(row.departedAt).not.toBeNull();

    const after = await get(staff.cookies, 'terminal/queue');
    expect(after.body.some((i: { action: string; legId: string }) => i.action === 'DEPART' && i.legId === lineHaul.id)).toBe(false);
  });

  it('refuses a leg this operator does not hold the origin location for, and never lists it either', async () => {
    const net = await makeNetwork();
    const otherNet = await makeNetwork();
    const { lineHaul } = await bookedReadyToDepart(await fundedSender(), net);

    // Another company entirely — its own real grant, just on a different
    // hub, so this leg's origin was never granted to this staff member.
    const neverGranted = await makeTerminalStaff([otherNet.originHubId]);
    expect((await get(neverGranted.cookies, 'terminal/queue')).body.some((i: { legId: string }) => i.legId === lineHaul.id)).toBe(false);
    expect((await post(neverGranted.cookies, `terminal/legs/${lineHaul.id}/depart`, {})).status).toBe(403);

    // Another location inside their OWN company (granted the DESTINATION hub, not the origin).
    const wrongLocationSameCompany = await makeTerminalStaff([net.destinationHubId]);
    expect((await get(wrongLocationSameCompany.cookies, 'terminal/queue')).body.some((i: { legId: string }) => i.legId === lineHaul.id)).toBe(false);
    expect((await post(wrongLocationSameCompany.cookies, `terminal/legs/${lineHaul.id}/depart`, {})).status).toBe(403);

    // A deactivated location — granted correctly, then the location itself deactivated.
    const deactivated = await makeTerminalStaff([net.originHubId]);
    await ctx.prisma.terminalCompanyLocation.update({ where: { id: deactivated.locationIds[0] }, data: { isActive: false } });
    expect((await get(deactivated.cookies, 'terminal/queue')).body.some((i: { legId: string }) => i.legId === lineHaul.id)).toBe(false);
    expect((await post(deactivated.cookies, `terminal/legs/${lineHaul.id}/depart`, {})).status).toBe(403);

    // An ended membership — granted correctly, then the membership itself ended.
    const ended = await makeTerminalStaff([net.originHubId]);
    await ctx.prisma.terminalCompanyMember.update({ where: { id: ended.memberId }, data: { status: 'ENDED', endedAt: new Date() } });
    // An ended membership holds no active grant anywhere, same as `terminal/me` — 403, not an empty list.
    expect((await get(ended.cookies, 'terminal/queue')).status).toBe(403);
    expect((await post(ended.cookies, `terminal/legs/${lineHaul.id}/depart`, {})).status).toBe(403);

    // Proves the leg itself was genuinely actionable all along — a correctly
    // granted operator still succeeds after four refusals above.
    const staff = await makeTerminalStaff([net.originHubId]);
    expect((await post(staff.cookies, `terminal/legs/${lineHaul.id}/depart`, {})).status).toBe(201);
  });
});

describe('TERM-8: arrival confirmation — distinct from handoff, previously admin-only', () => {
  it('appears in the queue at the destination terminal only once departed, and a granted operator can record it', async () => {
    const net = await makeNetwork();
    const originStaff = await makeTerminalStaff([net.originHubId]);
    const destStaff = await makeTerminalStaff([net.destinationHubId]);
    const { lineHaul } = await bookedReadyToDepart(await fundedSender(), net);

    // Not departed yet: arrival is not pending anywhere.
    expect((await get(destStaff.cookies, 'terminal/queue')).body.some((i: { action: string }) => i.action === 'ARRIVE')).toBe(false);

    expect((await post(originStaff.cookies, `terminal/legs/${lineHaul.id}/depart`, {})).status).toBe(201);

    const queue = await get(destStaff.cookies, 'terminal/queue');
    const item = queue.body.find((i: { action: string; legId: string }) => i.action === 'ARRIVE' && i.legId === lineHaul.id);
    expect(item).toBeDefined();
    expect(item.hubId).toBe(net.destinationHubId);
    // The origin desk has no arrival to confirm — that is the far terminal's job.
    expect((await get(originStaff.cookies, 'terminal/queue')).body.some((i: { action: string; legId: string }) => i.legId === lineHaul.id && i.action === 'ARRIVE')).toBe(false);

    const arrived = await post(destStaff.cookies, `terminal/legs/${lineHaul.id}/arrive`);
    expect(arrived.status).toBe(201);
    const row = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: lineHaul.id } });
    expect(row.arrivedAt).not.toBeNull();
    expect(row.status).toBe('IN_PROGRESS'); // arrival alone does not complete the leg — handoff does

    const after = await get(destStaff.cookies, 'terminal/queue');
    expect(after.body.some((i: { action: string; legId: string }) => i.action === 'ARRIVE' && i.legId === lineHaul.id)).toBe(false);
    // Arrival moved it straight into the HANDOFF queue instead — the next
    // custody step this card's part 1 confirmed is NOT the same event.
    const handoffRow = after.body.find((i: { action: string; legId: string }) => i.action === 'HANDOFF' && i.legId === lineHaul.id);
    expect(handoffRow).toBeDefined();
    // MDF-747: a LINE_HAUL leg is carrier-operated and never has a BML
    // courier assigned, by design — `courier: null` here is the NORMAL
    // case, not a reason to hide the Hand off form. `kind` is what tells
    // a client the difference between this and a FIRST_MILE row that
    // genuinely has no one to hand off to yet (next test).
    expect(handoffRow.kind).toBe('LINE_HAUL');
    expect(handoffRow.courier).toBeNull();
  });

  it('MDF-747: a FIRST_MILE row with no courier assigned reports courier: null, not a display fallback — and kind distinguishes it from a LINE_HAUL row', async () => {
    const net = await makeNetwork();
    const staff = await makeTerminalStaff([net.originHubId]);
    const s = await bookDoorToDoor(await fundedSender(), net);
    const firstMile = (await legsOf(s.id)).find((l) => l.kind === 'FIRST_MILE')!;

    const queue = await get(staff.cookies, 'terminal/queue');
    const item = queue.body.find((i: { action: string; legId: string }) => i.action === 'HANDOFF' && i.legId === firstMile.id);
    expect(item).toBeDefined();
    expect(item.kind).toBe('FIRST_MILE');
    expect(item.courier).toBeNull();
    // `broughtBy` still falls back to the literal "Carrier" for display —
    // this is exactly the string a real carrier named "Carrier" would also
    // produce, which is why `courier`/`kind` exist as the actual signal.
    expect(item.broughtBy).toBe('Carrier');

    // completeLeg's own guard (shipment.service.ts ~2135-2138) agrees: a
    // staff submission naming the assigned courier is refused outright for
    // this exact leg, because none is assigned.
    const refused = await post(staff.cookies, `terminal/legs/${firstMile.id}/handoff`, {
      pin: await pinOf(firstMile.id),
      receivedByName: 'Counter staff',
      presentedByAssignedCourier: true,
    });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/no courier is assigned/i);
  });

  it('refuses an operator holding only the origin location for this leg', async () => {
    const net = await makeNetwork();
    const originStaff = await makeTerminalStaff([net.originHubId]);
    const { lineHaul } = await bookedReadyToDepart(await fundedSender(), net);
    expect((await post(originStaff.cookies, `terminal/legs/${lineHaul.id}/depart`, {})).status).toBe(201);

    expect((await post(originStaff.cookies, `terminal/legs/${lineHaul.id}/arrive`)).status).toBe(403);
  });
});

describe('TERM-8: the existing handoff door still agrees with the queue', () => {
  it('a LINE_HAUL arrival moves it into the HANDOFF queue, and completing it clears both', async () => {
    const net = await makeNetwork();
    const destStaff = await makeTerminalStaff([net.destinationHubId]);
    const { lineHaul } = await bookedReadyToDepart(await fundedSender(), net);
    expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/depart`, {})).status).toBe(201);
    expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/arrive`)).status).toBe(201);

    expect((await get(destStaff.cookies, 'terminal/queue')).body.some((i: { action: string; legId: string }) => i.action === 'HANDOFF' && i.legId === lineHaul.id)).toBe(true);

    const handed = await post(destStaff.cookies, `terminal/legs/${lineHaul.id}/handoff`, { pin: await pinOf(lineHaul.id), receivedByName: 'Desk' });
    expect(handed.status).toBe(201);

    expect((await get(destStaff.cookies, 'terminal/queue')).body.some((i: { legId: string }) => i.legId === lineHaul.id)).toBe(false);
  });
});

describe('TERM-8: release to courier — the existing door, now also surfaced in the queue', () => {
  it('a LAST_MILE leg a courier has accepted appears at the hub they are collecting from', async () => {
    const net = await makeNetwork();
    const destStaff = await makeTerminalStaff([net.destinationHubId]);
    const { shipment, lineHaul } = await bookedReadyToDepart(await fundedSender(), net);
    expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/depart`, {})).status).toBe(201);
    expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/arrive`)).status).toBe(201);
    expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/handoff`, { pin: await pinOf(lineHaul.id), receivedByName: 'Desk' })).status).toBe(201);

    const lastMile = (await legsOf(shipment.id)).find((l) => l.kind === 'LAST_MILE')!;
    expect(lastMile.status).toBe('READY');
    const driver = await makeDriver();
    expect((await post(admin, `admin/logistics/legs/${lastMile.id}/assign`, { driverProfileId: driver.driverProfileId, vehicleId: driver.vehicleId })).status).toBe(201);
    expect((await post(driver.cookies, `driver/shipping-jobs/${lastMile.id}/accept`)).status).toBe(201);

    const queue = await get(destStaff.cookies, 'terminal/queue');
    const item = queue.body.find((i: { action: string; legId: string }) => i.action === 'RELEASE_TO_COURIER' && i.legId === lastMile.id);
    expect(item).toBeDefined();
    expect(item.hubId).toBe(net.destinationHubId);

    const pickupPin = (await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: lastMile.id }, select: { pickupPin: true } })).pickupPin!;
    const released = await post(destStaff.cookies, `terminal/legs/${lastMile.id}/release-to-courier`, { pin: pickupPin });
    expect(released.status).toBe(201);

    expect((await get(destStaff.cookies, 'terminal/queue')).body.some((i: { legId: string }) => i.legId === lastMile.id)).toBe(false);
  });
});

describe('TERM-8: collection at the destination terminal — previously admin-only', () => {
  it('a shipment ending at a hub, with no last mile, appears in the queue and can be collected', async () => {
    const net = await makeNetwork();
    const destStaff = await makeTerminalStaff([net.destinationHubId]);
    const s = await bookDoorToHub(await fundedSender(), net);
    const rows = await legsOf(s.id);
    expect(rows.map((l) => l.kind)).toEqual(['FIRST_MILE', 'LINE_HAUL']); // ends AT the hub — no LAST_MILE
    await completeFirstMileAsAdmin(rows.find((l) => l.kind === 'FIRST_MILE')!.id);
    const lineHaul = (await legsOf(s.id)).find((l) => l.kind === 'LINE_HAUL')!;
    expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/depart`, {})).status).toBe(201);
    expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/arrive`)).status).toBe(201);
    const done = await completeLineHaulAsAdmin(lineHaul.id);
    expect(done.status).toBe('AWAITING_COLLECTION');

    const queue = await get(destStaff.cookies, 'terminal/queue');
    const item = queue.body.find((i: { action: string; shipmentId: string }) => i.action === 'COLLECT' && i.shipmentId === s.id);
    expect(item).toBeDefined();
    expect(item.hubId).toBe(net.destinationHubId);

    const code = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: s.id }, select: { collectionPin: true } }).then((r) => r.collectionPin);
    const collected = await post(destStaff.cookies, `terminal/shipments/${s.id}/collect`, { collectedByName: 'Maria Cruz', code });
    expect(collected.status).toBe(201);
    expect((await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('DELIVERED');

    expect((await get(destStaff.cookies, 'terminal/queue')).body.some((i: { shipmentId: string }) => i.shipmentId === s.id)).toBe(false);
  });

  it('refuses an operator who was never granted the hub this shipment ends at', async () => {
    const net = await makeNetwork();
    const wrongStaff = await makeTerminalStaff([net.originHubId]);
    const s = await bookDoorToHub(await fundedSender(), net);
    const rows = await legsOf(s.id);
    await completeFirstMileAsAdmin(rows.find((l) => l.kind === 'FIRST_MILE')!.id);
    const lineHaul = (await legsOf(s.id)).find((l) => l.kind === 'LINE_HAUL')!;
    expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/depart`, {})).status).toBe(201);
    expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/arrive`)).status).toBe(201);
    await completeLineHaulAsAdmin(lineHaul.id);

    expect((await get(wrongStaff.cookies, 'terminal/queue')).body.some((i: { shipmentId: string }) => i.shipmentId === s.id)).toBe(false);
    expect((await post(wrongStaff.cookies, `terminal/shipments/${s.id}/collect`, { collectedByName: 'Nope' })).status).toBe(403);
  });

  it('does not let a plain customer reach either route', async () => {
    const net = await makeNetwork();
    const customer = await fundedSender();
    const s = await bookDoorToHub(customer, net);
    expect((await get(customer, 'terminal/queue')).status).toBe(403);
    expect((await post(customer, `terminal/shipments/${s.id}/collect`, { collectedByName: 'Me' })).status).toBe(403);
  });
});

describe('TERM-8: the queue itself is per-caller, not per-hub-id-you-ask-for', () => {
  it('a brand-new terminal operator with no grants anywhere sees an empty queue, not an error', async () => {
    const staff = await makeTerminalStaff([]);
    const res = await get(staff.cookies, 'terminal/queue');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('a plain customer with no terminal membership is refused, not shown an empty queue', async () => {
    const cookies = await fundedSender();
    expect((await get(cookies, 'terminal/queue')).status).toBe(403);
  });
});

/**
 * TERM-QUEUE-TRUNCATION: the body stays the flat array `apps/web`'s shipped
 * queue tab already reads (unchanged below — a normal-sized queue returns
 * exactly the same shape and the same rows it always did). The truth about
 * completeness rides the `X-BMPL-Queue-Has-More` response header instead, so
 * these two tests prove the header both tells the truth when nothing was cut
 * (`false`) and flips to `true` the moment one category alone exceeds its own
 * cap — here, DEPART's `take: 100` — without needing any OTHER category to
 * overflow too.
 */
describe('TERM-QUEUE-TRUNCATION: X-BMPL-Queue-Has-More tells the truth about completeness', () => {
  it('reports false when nothing in the queue was cut', async () => {
    const net = await makeNetwork();
    const staff = await makeTerminalStaff([net.originHubId]);
    await bookedReadyToDepart(await fundedSender(), net);

    const res = await get(staff.cookies, 'terminal/queue');
    expect(res.status).toBe(200);
    expect(res.headers['x-bmpl-queue-has-more']).toBe('false');
  });

  it('reports true, and still caps the body at 100 DEPART rows, once 101 legs are waiting at one hub', async () => {
    const net = await makeNetwork();
    const staff = await makeTerminalStaff([net.originHubId]);
    const tag = uniq();

    // Inserted directly, not via the booking API — 101 real door-to-door
    // bookings would make this test itself the slow thing on the floor.
    // Every field relevant to terminalQueue's DEPART predicate (kind,
    // originHubId, departedAt, status) is real; everything else is the
    // minimum Shipment/ShipmentLeg actually require.
    const shipments = Array.from({ length: 101 }, (_, i) => ({
      id: `ovf_s_${tag}_${i}`,
      reference: `OVF-${tag}-${i}`,
      service: 'DOOR_TO_DOOR' as const,
    }));
    await ctx.prisma.shipment.createMany({ data: shipments });
    await ctx.prisma.shipmentLeg.createMany({
      data: shipments.map((s, i) => ({
        id: `ovf_l_${tag}_${i}`,
        shipmentId: s.id,
        sequence: 1,
        kind: 'LINE_HAUL' as const,
        mode: 'SEA' as const,
        status: 'READY' as const,
        originHubId: net.originHubId,
        destinationHubId: net.destinationHubId,
      })),
    });

    const res = await get(staff.cookies, 'terminal/queue');
    expect(res.status).toBe(200);
    expect(res.headers['x-bmpl-queue-has-more']).toBe('true');
    const departRows = res.body.filter((i: { action: string; legId: string }) => i.action === 'DEPART' && i.legId.startsWith(`ovf_l_${tag}_`));
    expect(departRows.length).toBe(100);
  });
});
