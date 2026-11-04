/**
 * SHIPPING-E2E-CLOSE, item 3: a shipment's own ETA (BMPL-340) across a
 * journey with TWO LINE_HAUL hops, proven through the real wiring
 * (`ShipmentService.serialize`'s `etaFor`/`toEtaLegInputs` call, loading
 * real Prisma rows), not the pure algorithm — exactly the split
 * shipment-eta.integration.spec.ts's own header already draws ("the pure
 * math itself is exhaustively covered by
 * packages/shared/src/shipment-eta.test.ts; this file proves the WIRING").
 *
 * WHY THIS IS A GENUINE GAP, NOT A RE-TEST. Every existing ETA integration
 * spec (shipment-eta.integration.spec.ts, shipment-eta-notification.
 * integration.spec.ts, shipment-availability-windows-eta.integration.spec.ts)
 * seeds a network with at most ONE LINE_HAUL leg. shipment-eta.integration.
 * spec.ts's own header even says so explicitly: with only one LINE_HAUL hop
 * and no scheduled commitment ever written in that file, "the OVERALL
 * shipment confidence on every booking in this file is UNKNOWN by
 * construction" — it never proves what happens with a SECOND LINE_HAUL leg
 * in the same journey, because its fixture cannot produce one. The pure
 * cursor-cascade logic itself (`estimateShipmentEta`'s `cursor` carry-
 * forward) is unit-tested in packages/shared with hand-built leg arrays,
 * but no integration spec has ever loaded TWO real, independently
 * scheduled LINE_HAUL rows out of Postgres through `toEtaLegInputs` in the
 * same request and checked that the SECOND one's own data — not the
 * first's — is what the wiring actually returns.
 *
 * Network: PLA -> MUN -> SPA, verbatim from shipment-dispatch-multi-leg.
 * integration.spec.ts (itself verbatim from shipment-journey-two-line-haul.
 * spec.ts) — four legs, FIRST_MILE / LINE_HAUL / LINE_HAUL / LAST_MILE.
 * Dispatch disabled throughout (manual assign/depart/arrive/handoff, same
 * admin logistics endpoints shipment-eta-notification.integration.spec.ts
 * already uses for `schedule()`) — this file is about the ETA field, not
 * the dispatch engine item 1 already covers.
 *
 * Both claims below are ENGINE/WIRING EVIDENCE: they prove the real
 * Prisma-backed read path carries real configured data correctly across
 * more than one LINE_HAUL hop. Neither says anything about what a real
 * carrier would actually commit to — `scheduledArrivalAt` here is an
 * admin-entered commitment, same as every other ETA spec in this suite.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedBaselineCourierCoverage, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let hub: Record<string, string> = {};
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);

async function registerUser(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

async function fundedSender() {
  const { cookies, userId } = await registerUser(`sender_${uniq()}@example.com`);
  await post(admin, 'admin/wallet/test-credit', { userId, amountMinor: 100_000, reason: 'Multi-leg ETA fixture.' });
  return { cookies, userId };
}

/** Matches shipment-dispatch-multi-leg.integration.spec.ts's own helper. */
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
  const vehicle = await ctx.prisma.driverVehicle.create({
    data: {
      driverProfileId: profile.id, type: 'CAR', make: 'Toyota', model: 'Corolla',
      licencePlate: `HV-${s}`.slice(0, 18), registrationExpiry: FUTURE, insuranceExpiry: FUTURE,
      isActive: true, isPrimary: true, approvalStatus: 'APPROVED',
    },
  });
  await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: district as never, isActive: true } });
  return { cookies, userId, driverProfileId: profile.id, vehicleId: vehicle.id };
}

/** Three airstrips, two AIR line-hauls: PLA -> MUN -> SPA. Verbatim from
 *  shipment-dispatch-multi-leg.integration.spec.ts's own `seedNetwork`. */
async function seedNetwork() {
  hub = {};
  for (const h of [
    { code: 'MUN', name: 'Belize City Municipal Airstrip', district: 'BELIZE', city: 'Belize City', fee: 1000 },
    { code: 'SPA', name: 'San Pedro Airstrip', district: 'BELIZE', city: 'San Pedro', fee: 1500 },
    { code: 'PLA', name: 'Placencia Airstrip', district: 'STANN_CREEK', city: 'Placencia', fee: 1200 },
  ]) {
    const r = await post(admin, 'admin/logistics/hubs', {
      code: h.code, name: h.name, type: 'AIRSTRIP', district: h.district, city: h.city, modes: ['LAND', 'AIR'],
      courierFeeMinor: h.fee,
    });
    expect(r.status).toBe(201);
    hub[h.code] = r.body.id;
  }
  for (const r of [
    { from: 'PLA', to: 'MUN', minutes: 45, price: 8000 },
    { from: 'MUN', to: 'SPA', minutes: 20, price: 6000 },
  ]) {
    expect((await post(admin, 'admin/logistics/routes', {
      originHubId: hub[r.from], destinationHubId: hub[r.to], mode: 'AIR',
      durationMinutes: r.minutes, priceMinor: r.price, carrierName: 'Tropic Air',
    })).status).toBe(201);
  }
}

async function disableDispatch() {
  const row = await ctx.prisma.platformSetting.findFirst();
  const data = { dispatchAutomatic: false };
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

async function book(cookies: string[]) {
  const r = await post(cookies, 'shipping', { ...doorToDoor(), payWithWallet: true });
  expect(r.status).toBe(201);
  return r.body as { id: string; reference: string };
}

const legsOf = (shipmentId: string) => ctx.prisma.shipmentLeg.findMany({ where: { shipmentId }, orderBy: { sequence: 'asc' } });
const legRow = (legId: string) => ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId } });
const assign = (legId: string, d: { driverProfileId: string; vehicleId: string }) =>
  post(admin, `admin/logistics/legs/${legId}/assign`, { driverProfileId: d.driverProfileId, vehicleId: d.vehicleId });
const depart = (legId: string) => post(admin, `admin/logistics/legs/${legId}/depart`, {});
const arrive = (legId: string) => post(admin, `admin/logistics/legs/${legId}/arrive`);
const adminHandoff = (legId: string, pin: string) => post(admin, `admin/logistics/legs/${legId}/handoff`, { pin, receivedByName: 'Counter staff' });
/** Matches shipment-eta-notification.integration.spec.ts's own `schedule()`. */
const schedule = (legId: string, body: object) => post(admin, `admin/logistics/legs/${legId}/schedule`, body);

async function driveCourierLeg(courier: { cookies: string[] }, legId: string) {
  expect((await post(courier.cookies, `driver/shipping-jobs/${legId}/accept`)).status).toBe(201);
  const pin = (await legRow(legId)).pickupPin!;
  expect((await post(courier.cookies, `driver/shipping-jobs/${legId}/pickup`, { pin })).status).toBe(201);
  expect((await post(courier.cookies, `driver/shipping-jobs/${legId}/in-transit`)).status).toBe(201);
  expect((await post(courier.cookies, `driver/shipping-jobs/${legId}/arriving`)).status).toBe(201);
  const handoffPin = (await legRow(legId)).handoffPin!;
  expect((await post(courier.cookies, `driver/shipping-jobs/${legId}/handoff`, { pin: handoffPin, receivedByName: 'Terminal agent' })).status).toBe(201);
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
  await ctx.prisma.driverEarning.deleteMany();
  await ctx.prisma.walletHold.deleteMany();
  await ctx.prisma.walletLedgerEntry.deleteMany();
  await ctx.prisma.walletTransaction.deleteMany();
  await ctx.prisma.ledgerReference.deleteMany();
  await ctx.prisma.paymentEvent.deleteMany();
  await ctx.prisma.payment.deleteMany();
  await ctx.prisma.shipmentLeg.deleteMany();
  await ctx.prisma.shipment.deleteMany();
  await ctx.prisma.logisticsRoute.deleteMany();
  await ctx.prisma.logisticsHub.deleteMany();
  await ctx.prisma.driverServiceArea.deleteMany();
  await ctx.prisma.driverVehicle.deleteMany();
  await ctx.prisma.driverProfile.deleteMany();
  await disableDispatch();
  await seedNetwork();
  await seedBaselineCourierCoverage(ctx.prisma);
});

describe('shipment ETA across two real LINE_HAUL hops (BMPL-340, item 3)', () => {
  it('an unscheduled SECOND line-haul still poisons the journey past it, and resolving it self-corrects the chain (a)', async () => {
    const sender = await fundedSender();
    const shipment = await book(sender.cookies);
    const rows = await legsOf(shipment.id);
    expect(rows.map((l) => l.kind)).toEqual(['FIRST_MILE', 'LINE_HAUL', 'LINE_HAUL', 'LAST_MILE']);
    const [, lineHaul1, lineHaul2, lastMile] = rows as [
      (typeof rows)[number], (typeof rows)[number], (typeof rows)[number], (typeof rows)[number],
    ];

    const t1 = new Date(Date.now() + 4 * 3600_000);
    expect((await schedule(lineHaul1.id, { scheduledArrivalAt: t1.toISOString() })).status).toBe(201);

    const before = await get(sender.cookies, `shipping/${shipment.reference}`);
    expect(before.status).toBe(200);
    const legEta = (body: typeof before.body, legId: string) => body.legs.find((l: { id: string }) => l.id === legId).eta;
    expect(legEta(before.body, lineHaul1.id)).toMatchObject({ confidence: 'KNOWN' });
    expect(new Date(legEta(before.body, lineHaul1.id).estimatedCompletionAt).getTime()).toBe(t1.getTime());
    // The SECOND line-haul, still unscheduled, is UNKNOWN on its own terms —
    // not because an earlier leg was unknowable (leg 1 just resolved fine).
    expect(legEta(before.body, lineHaul2.id)).toMatchObject({
      confidence: 'UNKNOWN',
      reason: 'no carrier departure has been confirmed for this leg yet',
    });
    // LAST_MILE, two hops downstream of the real gap, is poisoned too — the
    // one no single-LINE_HAUL fixture anywhere else in this suite can prove.
    expect(legEta(before.body, lastMile.id)).toMatchObject({
      confidence: 'UNKNOWN',
      reason: 'an earlier leg cannot be estimated yet',
    });
    expect(before.body.eta).toEqual({ confidence: 'UNKNOWN', estimatedArrivalAt: null });

    const t2 = new Date(Date.now() + 8 * 3600_000);
    expect((await schedule(lineHaul2.id, { scheduledArrivalAt: t2.toISOString() })).status).toBe(201);

    const after = await get(sender.cookies, `shipping/${shipment.reference}`);
    expect(legEta(after.body, lineHaul2.id)).toMatchObject({ confidence: 'KNOWN' });
    expect(new Date(legEta(after.body, lineHaul2.id).estimatedCompletionAt).getTime()).toBe(t2.getTime());
    expect(legEta(after.body, lastMile.id).confidence).not.toBe('UNKNOWN');
    expect(after.body.eta.confidence).not.toBe('UNKNOWN');
  });

  it("LAST_MILE anchors off the SECOND line-haul's own real commitment, not the first's, once the first has actually completed (b)", async () => {
    const sender = await fundedSender();
    const firstCourier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const rows = await legsOf(shipment.id);
    const [firstMile, lineHaul1, lineHaul2, lastMile] = rows as [
      (typeof rows)[number], (typeof rows)[number], (typeof rows)[number], (typeof rows)[number],
    ];

    const t1 = new Date(Date.now() + 4 * 3600_000);
    const t2 = new Date(Date.now() + 8 * 3600_000); // deliberately distinct from t1
    expect((await schedule(lineHaul1.id, { scheduledArrivalAt: t1.toISOString() })).status).toBe(201);
    expect((await schedule(lineHaul2.id, { scheduledArrivalAt: t2.toISOString() })).status).toBe(201);

    // Drive the real journey up to and including LINE_HAUL#1's own actual
    // completion, so its ETA switches from "a scheduled commitment" to "an
    // already-happened fact" while LINE_HAUL#2 sits untouched, merely
    // scheduled — the mixed real state no existing ETA spec combines.
    expect((await assign(firstMile.id, firstCourier)).status).toBe(201);
    await driveCourierLeg(firstCourier, firstMile.id);
    expect((await depart(lineHaul1.id)).status).toBe(201);
    expect((await arrive(lineHaul1.id)).status).toBe(201);
    const line1HandoffPin = (await legRow(lineHaul1.id)).handoffPin!;
    expect((await adminHandoff(lineHaul1.id, line1HandoffPin)).status).toBe(201);

    const line1Row = await legRow(lineHaul1.id);
    expect(line1Row.status).toBe('COMPLETED');
    expect(line1Row.completedAt).not.toBeNull();

    const res = await get(sender.cookies, `shipping/${shipment.reference}`);
    expect(res.status).toBe(200);
    const legEta = (legId: string) => res.body.legs.find((l: { id: string }) => l.id === legId).eta;

    // LINE_HAUL#1: KNOWN from its real completedAt, not the t1 estimate —
    // the leg actually happened, so the walk reports the fact, not a stale
    // projection of it.
    expect(legEta(lineHaul1.id)).toMatchObject({ confidence: 'KNOWN' });
    expect(new Date(legEta(lineHaul1.id).estimatedCompletionAt).getTime()).toBe(line1Row.completedAt!.getTime());

    // LINE_HAUL#2: KNOWN from its OWN real commitment (t2), unaffected by
    // leg 1 having finished — the two real scheduled rows do not bleed into
    // each other through the wiring.
    expect(legEta(lineHaul2.id)).toMatchObject({ confidence: 'KNOWN' });
    expect(new Date(legEta(lineHaul2.id).estimatedCompletionAt).getTime()).toBe(t2.getTime());

    // LAST_MILE: anchored off t2 (leg 2's real commitment) plus its own
    // configured duration — not off t1, and not off `now`. No availability
    // windows are configured, so the provisional instant is used as-is.
    const lastMileDurationMinutes = (await legRow(lastMile.id)).durationMinutes;
    const expectedLastMile = t2.getTime() + lastMileDurationMinutes * 60_000;
    expect(legEta(lastMile.id)).toMatchObject({ confidence: 'PROJECTED' });
    expect(new Date(legEta(lastMile.id).estimatedCompletionAt).getTime()).toBe(expectedLastMile);
    expect(new Date(res.body.eta.estimatedArrivalAt).getTime()).toBe(expectedLastMile);
  });
});
