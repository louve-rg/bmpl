/**
 * SHIPPING-E2E-CLOSE, item 1 (combined, per the frozen plan): automatic
 * dispatch, hub-hours deferral, proof-of-delivery photo capture, and the
 * sibling-leg-PENDING regression — all against the SAME two-line-haul
 * PLA -> MUN -> SPA network `shipment-journey-two-line-haul.integration.spec
 * .ts` already seeds, reused verbatim rather than reinvented. One file
 * because building that fixture once is most of the cost of each claim below.
 *
 * (a) ENGINE EVIDENCE. Automatic dispatch (`dispatchAutomatic=true`) has
 *     never been exercised past a single courier leg anywhere in this suite
 *     — every existing multi-leg shipping spec calls disableDispatch() and
 *     drives manual assignment only. Proves `dispatchLeg`/
 *     `offerNewlyReadyCourierLeg` auto-offers LAST_MILE the instant the
 *     SECOND line-haul completes, not the first, with no admin `assign()`
 *     call anywhere in the test. The driver/vehicle candidate pool is
 *     isTest-filtered (`shipment-dispatch.service.ts`'s `rankFor`/
 *     `pickVehicle`), so a green result proves the auto-offer/release
 *     mechanism fires correctly in sequence — it says nothing about who a
 *     real shipment would actually be matched to.
 *
 * (b) ENGINE EVIDENCE, narrower than first scoped. Hub-hours deferral
 *     (`shipment-hub-hours-dispatch.integration.spec.ts`, BMPL-273) only
 *     ever gates a FIRST_MILE leg's destination hub — `dispatchLeg`'s own
 *     comment: "Only FIRST_MILE has a hub as its destination ... neither
 *     [LAST_MILE nor DIRECT] has an arrival-at-a-terminal instant to
 *     evaluate here" (BMPL-260). There is no SECOND hub-hours check
 *     anywhere in the chain, however many line-hauls follow, so this does
 *     NOT prove "defers at either hop" — it proves the one existing check
 *     still defers and self-corrects correctly, and the rest of the chain
 *     (both line-hauls + LAST_MILE) stays untouched, when the shipment has
 *     two line-haul hops downstream instead of the existing spec's one.
 *     Same isTest inheritance as (a): engine evidence, not customer evidence.
 *
 * (c) CUSTOMER-REPRESENTATIVE EVIDENCE. `handoffPhotoKeys`/pickup-photo
 *     (`shipping-pickup-photo.integration.spec.ts`, BMPL-178) is asserted
 *     only on FIRST_MILE anywhere in this suite, including that file's own
 *     multi-leg test. Proves the identical upload/confirm path works at the
 *     actual LAST_MILE delivery handoff, and that it is per-leg, not pooled
 *     with FIRST_MILE's own photo on the same shipment. `confirmPickupPhoto`
 *     has zero `isTest` references — confirmed by reading it in full — so
 *     this generalizes to a real delivery exactly as written.
 *
 * (d) CUSTOMER-REPRESENTATIVE EVIDENCE. The #552 residual, upgraded from a
 *     review comment to an assertion now that this fixture already builds a
 *     two-line-haul shipment and drives an exception/resume cycle for (a):
 *     LINE_HAUL#2 stays PENDING for the entire time LINE_HAUL#1 sits in
 *     EXCEPTION and through its RESUME, never promoted early.
 *     `shipment-exception-recovery.integration.spec.ts`'s own line-haul test
 *     flags and resumes exactly one of the two line-hauls this same network
 *     produces and never checks the other one at all. `resolveException` has
 *     zero `isTest` references — confirmed by reading the full method.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedBaselineCourierCoverage, seedSuperAdmin, type TestContext } from './helpers';
import { ShipmentDispatchService } from '../src/shipping/shipment-dispatch.service';

let ctx: TestContext;
let dispatch: ShipmentDispatchService;
let admin: string[];
let hub: Record<string, string> = {};
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** Belize is a fixed UTC-6, no DST (belize-time.ts). 2026-11-02 is a Monday. */
const belizeInstant = (year: number, month: number, day: number, hour = 12, minute = 0) =>
  new Date(Date.UTC(year, month - 1, day, hour + 6, minute, 0));

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const put = (c: string[], p: string, b: object = {}) => request(ctx.server).put(`/api/${p}`).set('Cookie', c).send(b);
const uploadRaw = (c: string[], p: string, buf: Buffer) =>
  request(ctx.server).post(`/api/${p}`).set('Cookie', c).set('Content-Type', 'image/png').send(buf);

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
  await post(admin, 'admin/wallet/test-credit', { userId, amountMinor: 100_000, reason: 'Multi-leg dispatch fixture.' });
  return { cookies, userId };
}

/** An approved, online driver serving one district, matching shipment-journey-two-line-haul.spec.ts's own helper. */
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

/** Three airstrips, two AIR line-hauls: PLA -> MUN -> SPA. Verbatim from shipment-journey-two-line-haul.spec.ts. */
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

async function enableDispatch() {
  const row = await ctx.prisma.platformSetting.findFirst();
  const data = { dispatchAutomatic: true, dispatchOfferTimeoutSeconds: 90, dispatchMaxOffers: 3, dispatchMaxConcurrentPerDriver: 3 };
  if (row) await ctx.prisma.platformSetting.update({ where: { id: row.id }, data });
  else await ctx.prisma.platformSetting.create({ data });
}

async function disableDispatch() {
  const row = await ctx.prisma.platformSetting.findFirst();
  const data = { dispatchAutomatic: false };
  if (row) await ctx.prisma.platformSetting.update({ where: { id: row.id }, data });
  else await ctx.prisma.platformSetting.create({ data });
}

/** All 7 days, the same window — only the time-of-day boundary matters here. */
async function setHubHours(hubId: string, openTime: string, closeTime: string) {
  const days = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, isClosed: false, openTime, closeTime }));
  expect((await put(admin, `admin/logistics/hubs/${hubId}/hours`, { days })).status).toBe(200);
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
const depart = (legId: string, body: object = {}) => post(admin, `admin/logistics/legs/${legId}/depart`, body);
const arrive = (legId: string) => post(admin, `admin/logistics/legs/${legId}/arrive`);
const adminHandoff = (legId: string, pin: string) => post(admin, `admin/logistics/legs/${legId}/handoff`, { pin, receivedByName: 'Counter staff' });
const flag = (legId: string, reason = 'Aircraft diverted by weather.') => post(admin, `admin/logistics/legs/${legId}/exception`, { reason });
const resolve = (legId: string, body: object) => post(admin, `admin/logistics/legs/${legId}/resolve-exception`, body);

async function uploadPickupPhoto(courier: { cookies: string[] }, legId: string) {
  const r = await uploadRaw(courier.cookies, `driver/shipping-jobs/${legId}/pickup-photo/upload`, PNG);
  expect(r.status).toBe(201);
  return r.body.key as string;
}
const confirmPickupPhoto = (courier: { cookies: string[] }, legId: string, keys: string[]) =>
  post(courier.cookies, `driver/shipping-jobs/${legId}/pickup-photo/confirm`, { photoKeys: keys });

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
  await ctx.prisma.idempotencyKey.deleteMany({ where: { scope: 'shipping' } });
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
  await ctx.prisma.hubHoursException.deleteMany();
  await ctx.prisma.hubOpeningDay.deleteMany();
  await ctx.prisma.logisticsHub.deleteMany();
  await ctx.prisma.driverServiceArea.deleteMany();
  await ctx.prisma.driverVehicle.deleteMany();
  await ctx.prisma.driverProfile.deleteMany();
  await disableDispatch();
  await seedNetwork();
});

describe('automatic dispatch releases LAST_MILE across two line-haul hops, with no admin assign() call (a)', () => {
  it('auto-offers FIRST_MILE at booking and LAST_MILE the instant LINE_HAUL#2 completes, and captures a per-leg delivery photo (c)', async () => {
    await enableDispatch();
    const sender = await fundedSender();
    const firstCourier = await makeCourier('STANN_CREEK');
    const lastCourier = await makeCourier('BELIZE');

    const shipment = await book(sender.cookies);
    const rows = await legsOf(shipment.id);
    expect(rows.map((l) => l.kind)).toEqual(['FIRST_MILE', 'LINE_HAUL', 'LINE_HAUL', 'LAST_MILE']);
    const [firstMile, lineHaul1, lineHaul2, lastMile] = rows as [
      (typeof rows)[number], (typeof rows)[number], (typeof rows)[number], (typeof rows)[number],
    ];

    // Booking-time auto-dispatch: no admin assign() anywhere in this test.
    const afterBooking = await legRow(firstMile.id);
    expect(afterBooking.assignedDriverProfileId).toBe(firstCourier.driverProfileId);
    expect(afterBooking.courierStatus).toBe('ASSIGNED');

    expect((await post(firstCourier.cookies, `driver/shipping-jobs/${firstMile.id}/accept`)).status).toBe(201);
    const pickupPin = (await legRow(firstMile.id)).pickupPin!;
    expect((await post(firstCourier.cookies, `driver/shipping-jobs/${firstMile.id}/pickup`, { pin: pickupPin })).status).toBe(201);

    // (c) a pickup-side photo on FIRST_MILE, so the LAST_MILE photo below has
    // a sibling to prove it is NOT pooled with.
    const firstMileKey = await uploadPickupPhoto(firstCourier, firstMile.id);
    expect((await confirmPickupPhoto(firstCourier, firstMile.id, [firstMileKey])).status).toBe(201);

    expect((await post(firstCourier.cookies, `driver/shipping-jobs/${firstMile.id}/in-transit`)).status).toBe(201);
    expect((await post(firstCourier.cookies, `driver/shipping-jobs/${firstMile.id}/arriving`)).status).toBe(201);
    const firstMileHandoffPin = (await legRow(firstMile.id)).handoffPin!;
    expect((await post(firstCourier.cookies, `driver/shipping-jobs/${firstMile.id}/handoff`, {
      pin: firstMileHandoffPin, receivedByName: 'Placencia desk',
    })).status).toBe(201);

    // LINE_HAUL legs are carrier-operated — never auto-offered to a driver,
    // always admin-driven. dispatchAutomatic being on changes nothing here.
    expect((await legRow(lineHaul1.id)).status).toBe('READY');
    expect((await depart(lineHaul1.id, { carrierName: 'Tropic Air', carrierBookingRef: 'TA-PLA-MUN' })).status).toBe(201);
    expect((await arrive(lineHaul1.id)).status).toBe(201);
    expect((await adminHandoff(lineHaul1.id, (await legRow(lineHaul1.id)).handoffPin!)).status).toBe(201);
    expect((await legRow(lineHaul1.id)).status).toBe('COMPLETED');

    expect((await legRow(lineHaul2.id)).status).toBe('READY');
    // THE claim this test exists to prove is about what happens on LINE_HAUL#2's
    // own completion, not before it — assert LAST_MILE is untouched right up
    // to that moment.
    expect((await legRow(lastMile.id)).assignedDriverProfileId).toBeNull();
    expect((await depart(lineHaul2.id, { carrierName: 'Tropic Air', carrierBookingRef: 'TA-MUN-SPA' })).status).toBe(201);
    expect((await arrive(lineHaul2.id)).status).toBe(201);
    expect((await adminHandoff(lineHaul2.id, (await legRow(lineHaul2.id)).handoffPin!)).status).toBe(201);
    expect((await legRow(lineHaul2.id)).status).toBe('COMPLETED');

    // (a) THE assertion: auto-offered the instant the SECOND line-haul
    // completed — no admin assign() call for this leg anywhere above.
    const lastMileAfterRelease = await legRow(lastMile.id);
    expect(lastMileAfterRelease.status).toBe('READY');
    expect(lastMileAfterRelease.assignedDriverProfileId).toBe(lastCourier.driverProfileId);
    expect(lastMileAfterRelease.courierStatus).toBe('ASSIGNED');

    expect((await post(lastCourier.cookies, `driver/shipping-jobs/${lastMile.id}/accept`)).status).toBe(201);
    expect((await post(lastCourier.cookies, `driver/shipping-jobs/${lastMile.id}/pickup`)).status).toBe(201);
    expect((await post(lastCourier.cookies, `driver/shipping-jobs/${lastMile.id}/in-transit`)).status).toBe(201);
    expect((await post(lastCourier.cookies, `driver/shipping-jobs/${lastMile.id}/arriving`)).status).toBe(201);

    // (c) the actual delivery-handoff photo, attached before the final PIN
    // handoff — same upload/confirm path shipping-pickup-photo.integration
    // .spec.ts proves only for FIRST_MILE.
    const lastMileKey = await uploadPickupPhoto(lastCourier, lastMile.id);
    expect((await confirmPickupPhoto(lastCourier, lastMile.id, [lastMileKey])).status).toBe(201);
    expect((await legRow(lastMile.id)).handoffPhotoKeys).toEqual([lastMileKey]);
    // Per-leg, not pooled: FIRST_MILE keeps its own distinct key, unaffected.
    expect((await legRow(firstMile.id)).handoffPhotoKeys).toEqual([firstMileKey]);
    expect(lastMileKey).not.toBe(firstMileKey);

    const lastMilePin = (await legRow(lastMile.id)).handoffPin!;
    expect((await post(lastCourier.cookies, `driver/shipping-jobs/${lastMile.id}/handoff`, {
      pin: lastMilePin, receivedByName: 'Recipient',
    })).status).toBe(201);
    expect((await legRow(lastMile.id)).status).toBe('COMPLETED');
    expect((await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } })).status).toBe('DELIVERED');

    // The sender's own view shows the delivery photo on LAST_MILE specifically.
    const senderView = await get(sender.cookies, `shipping/${shipment.reference}`);
    expect(senderView.status).toBe(200);
    const lastMileView = senderView.body.legs.find((l: { id: string }) => l.id === lastMile.id);
    expect(lastMileView.pickupPhotoUrls).toHaveLength(1);
    const firstMileView = senderView.body.legs.find((l: { id: string }) => l.id === firstMile.id);
    expect(firstMileView.pickupPhotoUrls).toHaveLength(1);
  });
});

describe('hub-hours deferral still defers/self-corrects at FIRST_MILE when two line-hauls follow, and the rest of the chain is untouched while deferred (b)', () => {
  it('defers at PLA\'s destination hub, self-corrects on a later `now`, and the two line-hauls + LAST_MILE stay PENDING throughout', async () => {
    await setHubHours(hub.PLA!, '08:00', '17:00');
    await enableDispatch();
    const sender = await fundedSender();
    const shipment = await book(sender.cookies);
    const rows = await legsOf(shipment.id);
    const [firstMile, lineHaul1, lineHaul2, lastMile] = rows as [
      (typeof rows)[number], (typeof rows)[number], (typeof rows)[number], (typeof rows)[number],
    ];
    // No driver online yet, so the booking-time dispatch attempt at the real
    // wall clock is a no-op regardless — the test drives `now` itself below.
    expect((await legRow(firstMile.id)).assignedDriverProfileId).toBeNull();
    const courier = await makeCourier('STANN_CREEK');

    // Monday 19:00 Belize local — two hours after PLA locks up.
    const outsideHours = belizeInstant(2026, 11, 2, 19, 0);
    const deferred = await dispatch.dispatchLeg(firstMile.id, outsideHours);
    expect(deferred.result).toBe('DEFERRED');

    const stillWaiting = await legRow(firstMile.id);
    expect(stillWaiting.assignedDriverProfileId).toBeNull();
    // Genuinely new relative to the single-line-haul spec: the whole
    // downstream chain is untouched by a deferral at the top of it.
    expect((await legRow(lineHaul1.id)).status).toBe('PENDING');
    expect((await legRow(lineHaul2.id)).status).toBe('PENDING');
    expect((await legRow(lastMile.id)).status).toBe('PENDING');

    // Tuesday 09:00 Belize local — inside the same configured window.
    const insideHours = belizeInstant(2026, 11, 3, 9, 0);
    const offered = await dispatch.dispatchLeg(firstMile.id, insideHours);
    expect(offered.result).toBe('OFFERED');
    expect((offered as { driverProfileId: string }).driverProfileId).toBe(courier.driverProfileId);
    expect((await legRow(firstMile.id)).assignedDriverProfileId).toBe(courier.driverProfileId);
  });
});

describe('LINE_HAUL#2 stays PENDING across an EXCEPTION/RESUME cycle on LINE_HAUL#1 — the #552 residual, now an assertion (d)', () => {
  it('never promotes the sibling line-haul early, through flag, RESUME, and the normal completion that follows', async () => {
    const sender = await fundedSender();
    const firstCourier = await makeCourier('STANN_CREEK');
    const shipment = await book(sender.cookies);
    const rows = await legsOf(shipment.id);
    const [firstMile, lineHaul1, lineHaul2, lastMile] = rows as [
      (typeof rows)[number], (typeof rows)[number], (typeof rows)[number], (typeof rows)[number],
    ];

    expect((await assign(firstMile.id, firstCourier)).status).toBe(201);
    expect((await post(firstCourier.cookies, `driver/shipping-jobs/${firstMile.id}/accept`)).status).toBe(201);
    expect((await post(firstCourier.cookies, `driver/shipping-jobs/${firstMile.id}/pickup`, { pin: (await legRow(firstMile.id)).pickupPin! })).status).toBe(201);
    expect((await post(firstCourier.cookies, `driver/shipping-jobs/${firstMile.id}/in-transit`)).status).toBe(201);
    expect((await post(firstCourier.cookies, `driver/shipping-jobs/${firstMile.id}/arriving`)).status).toBe(201);
    expect((await post(firstCourier.cookies, `driver/shipping-jobs/${firstMile.id}/handoff`, {
      pin: (await legRow(firstMile.id)).handoffPin!, receivedByName: 'Placencia desk',
    })).status).toBe(201);

    expect((await legRow(lineHaul1.id)).status).toBe('READY');
    expect((await legRow(lineHaul2.id)).status).toBe('PENDING'); // baseline, before any exception

    expect((await depart(lineHaul1.id, { carrierName: 'Tropic Air', carrierBookingRef: 'TA-PLA-MUN' })).status).toBe(201);
    expect((await legRow(lineHaul2.id)).status).toBe('PENDING');

    expect((await flag(lineHaul1.id, 'Aircraft diverted by weather.')).status).toBe(201);
    expect((await legRow(lineHaul1.id)).status).toBe('EXCEPTION');
    // THE assertion, moment one: the sibling must not move while LINE_HAUL#1
    // sits in EXCEPTION.
    expect((await legRow(lineHaul2.id)).status).toBe('PENDING');

    const resumed = await resolve(lineHaul1.id, { resolution: 'RESUME', note: 'Flight resumed after the front passed.' });
    expect(resumed.status).toBe(201);
    expect((await legRow(lineHaul1.id)).status).toBe('IN_PROGRESS');
    // THE assertion, moment two — the one that is new: immediately after
    // RESUME, before LINE_HAUL#1 actually completes, the sibling is still
    // PENDING. This is exactly the combination the #552 review comment named
    // as the residual (`releaseNextLeg` gaining a skip-ahead path at the same
    // time `isLegActionable`'s `.every()` is simplified to a
    // predecessor-only check) and accepted as documentation rather than an
    // assertion at the time.
    expect((await legRow(lineHaul2.id)).status).toBe('PENDING');

    expect((await arrive(lineHaul1.id)).status).toBe(201);
    expect((await legRow(lineHaul2.id)).status).toBe('PENDING'); // still not released — not yet COMPLETED

    expect((await adminHandoff(lineHaul1.id, (await legRow(lineHaul1.id)).handoffPin!)).status).toBe(201);
    expect((await legRow(lineHaul1.id)).status).toBe('COMPLETED');
    // Only NOW — normal release still works after the exception/resume cycle.
    expect((await legRow(lineHaul2.id)).status).toBe('READY');

    expect((await depart(lineHaul2.id, { carrierName: 'Tropic Air', carrierBookingRef: 'TA-MUN-SPA' })).status).toBe(201);
    expect((await arrive(lineHaul2.id)).status).toBe(201);
    expect((await adminHandoff(lineHaul2.id, (await legRow(lineHaul2.id)).handoffPin!)).status).toBe(201);
    expect((await legRow(lastMile.id)).status).toBe('READY');
  });
});
