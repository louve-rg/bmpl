/**
 * A customer could pay for a driver-worked leg (FIRST_MILE/LAST_MILE/DIRECT)
 * that nobody could ever fulfil, and nothing in the system ever told anyone
 * — measured in production as the entire source of courier coverage: one of
 * Belize's six districts, two drivers, both gated on being online right now.
 *
 * Two distinct mechanisms, proven here:
 *  1. Booking time (ShipmentService#runCreate): UNSUPPORTED (nobody has ever
 *     configured coverage for the district) refuses the booking before any
 *     wallet lock. TEMPORARILY_UNAVAILABLE (coverage configured, nobody
 *     online this second) does NOT refuse — an otherwise-valid future
 *     booking must still go through — but carries a `fulfilmentNotices`
 *     field in the response instead of succeeding silently.
 *  2. Dispatch time (ShipmentDispatchService#recordUnavailableIfNew): a leg
 *     stuck with zero eligible drivers is made visible — one admin alert,
 *     one customer notification, one audit row — the first time it is
 *     observed, not on every 20s sweep.
 *
 * TOLEDO is used as the deliberately-unsupported district: `seedRoles`
 * (test/helpers.ts) now seeds a baseline, permanently-OFFLINE courier
 * covering all six districts so the rest of the suite keeps booking
 * unblocked exactly as it always did; this file removes TOLEDO from that
 * baseline's coverage to get a genuinely zero-coverage district to test
 * against, without touching what every other spec relies on.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';
import { ShipmentDispatchService } from '../src/shipping/shipment-dispatch.service';

let ctx: TestContext;
let admin: string[];
let dispatch: ShipmentDispatchService;
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const patch = (c: string[], p: string, b: object = {}) => request(ctx.server).patch(`/api/${p}`).set('Cookie', c).send(b);

const parcel = (district: string, city: string) => ({
  service: 'DOOR_TO_DOOR',
  origin: { district, city, address: '1 Front St', name: 'S', phone: '501-222-3333' },
  destination: { district, city, address: '2 Front St', name: 'R', phone: '501-444-5555' },
  description: 'Documents',
  pieces: 1,
});

async function registerCustomer(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

async function fund(userId: string, amountMinor: number) {
  const r = await post(admin, 'admin/wallet/test-credit', { userId, amountMinor, reason: 'dispatch-feasibility fixture' });
  expect(r.status).toBe(201);
}

async function onlineDriverFor(district: string) {
  const { userId, cookies } = await registerCustomer(`drv_${uniq()}@example.com`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  const s = uniq();
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId, legalName: 'On Line', displayName: `Drv${s}`, phone: '+5016000099',
      homeDistrict: district as never, licenceNumber: `DL-${s}`, licenceExpiry: FUTURE,
      vehicleOwnership: 'OWNED', availability: 'ONLINE', isActive: true,
    },
  });
  await ctx.prisma.driverVehicle.create({
    data: {
      driverProfileId: profile.id, type: 'CAR', make: 'Toyota', model: 'Corolla',
      licencePlate: `BZ-${s}`.slice(0, 18), registrationExpiry: FUTURE, insuranceExpiry: FUTURE,
      isActive: true, isPrimary: true, approvalStatus: 'APPROVED',
    },
  });
  await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: district as never, isActive: true } });
  return { driverProfileId: profile.id, cookies };
}

async function enableDispatch() {
  const row = await ctx.prisma.platformSetting.findFirst();
  const data = { dispatchAutomatic: true, dispatchOfferTimeoutSeconds: 90, dispatchMaxOffers: 3, dispatchMaxConcurrentPerDriver: 3 };
  if (row) await ctx.prisma.platformSetting.update({ where: { id: row.id }, data });
  else await ctx.prisma.platformSetting.create({ data });
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma); // also seeds the all-district baseline courier (OFFLINE, never dispatched)
  const a = await seedSuperAdmin(ctx.prisma);
  admin = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password }));
  await patch(admin, 'admin/ops/settings', { localCourierFeeMinor: 1500, localCourierFeeTestMinor: 1500, localCourierMinutes: 60 });
  await enableDispatch(); // runCreate's own synchronous dispatchLeg call, and dispatch-time escalation below, both need cfg.automatic on.
  dispatch = ctx.app.get(ShipmentDispatchService);
  // The one deliberate gap: remove the baseline's TOLEDO coverage so this
  // file has a genuinely UNSUPPORTED district to test against, without
  // touching the other five districts every other spec's baseline relies on.
  await ctx.prisma.driverServiceArea.deleteMany({
    where: { district: 'TOLEDO', driverProfile: { user: { email: 'it-baseline-courier@example.bz' } } },
  });
});

afterAll(async () => {
  await ctx.app.close();
});

describe('booking-time feasibility (UNSUPPORTED vs TEMPORARILY_UNAVAILABLE)', () => {
  it('refuses a booking into a district with zero configured coverage, before any wallet lock, with no shipment/payment created', async () => {
    const customer = await registerCustomer(`unsup_${uniq()}@example.com`);
    await fund(customer.userId, 10_000);
    const wallet = await ctx.prisma.walletAccount.findFirstOrThrow({ where: { userId: customer.userId, type: 'USER' } });
    const balanceBefore = await ctx.prisma.walletLedgerEntry
      .findMany({ where: { accountId: wallet.id } })
      .then((rows) => rows.reduce((s, e) => s + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor), 0n));

    const r = await post(customer.cookies, 'shipping', { ...parcel('TOLEDO', 'Punta Gorda'), payWithWallet: true });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/do not yet have a courier serving TOLEDO/i);

    expect(await ctx.prisma.shipment.count({ where: { customerUserId: customer.userId } })).toBe(0);
    expect(await ctx.prisma.payment.count({ where: { userId: customer.userId } })).toBe(0);
    const balanceAfter = await ctx.prisma.walletLedgerEntry
      .findMany({ where: { accountId: wallet.id } })
      .then((rows) => rows.reduce((s, e) => s + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor), 0n));
    expect(balanceAfter).toBe(balanceBefore);
  });

  it('books a district with configured coverage but nobody online, and tells the customer plainly instead of promising dispatch', async () => {
    const customer = await registerCustomer(`temp_${uniq()}@example.com`);
    await fund(customer.userId, 10_000);

    // COROZAL: covered only by the baseline (permanently OFFLINE) courier.
    const r = await post(customer.cookies, 'shipping', { ...parcel('COROZAL', 'Corozal Town'), payWithWallet: true });
    expect(r.status).toBe(201);
    expect(r.body.fulfilmentNotices).toEqual([expect.stringMatching(/no courier is currently online in COROZAL/i)]);
    expect(await ctx.prisma.shipment.count({ where: { id: r.body.id } })).toBe(1);
  });

  it('books a district with an online eligible driver and carries no fulfilmentNotices field at all', async () => {
    await onlineDriverFor('CAYO');
    const customer = await registerCustomer(`ok_${uniq()}@example.com`);
    await fund(customer.userId, 10_000);

    const r = await post(customer.cookies, 'shipping', { ...parcel('CAYO', 'San Ignacio'), payWithWallet: true });
    expect(r.status).toBe(201);
    expect(r.body.fulfilmentNotices).toBeUndefined();
  });
});

describe('dispatch-time escalation (ShipmentDispatchService#recordUnavailableIfNew)', () => {
  it('alerts admin and the customer exactly once per episode, not once per sweep tick', async () => {
    // Scoped by delta, not an absolute count: other tests in this file also
    // book into a TEMPORARILY_UNAVAILABLE district (COROZAL) and trigger this
    // same alert on their own unrelated leg.
    const auditBefore = await ctx.prisma.auditLog.count({ where: { action: 'SHIPMENT_LEG_DISPATCH_UNAVAILABLE' } });
    const notifBefore = await ctx.prisma.notification.count({ where: { event: 'SHIPMENT_COURIER_UNAVAILABLE' } });

    const customer = await registerCustomer(`escalate_${uniq()}@example.com`);
    await fund(customer.userId, 10_000);
    const r = await post(customer.cookies, 'shipping', { ...parcel('STANN_CREEK', 'Dangriga'), payWithWallet: true });
    expect(r.status).toBe(201);
    const leg = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId: r.body.id } });

    // Booking itself already dispatched once (runCreate's own synchronous
    // dispatchLeg call for a paid FIRST_MILE/DIRECT first leg) — confirm the
    // alert already landed from that alone, exactly once: one Notification
    // row from notifyAdmins, one more from notifyUsers (the customer) — two
    // separate fan-outs, not one shared row.
    expect(await ctx.prisma.auditLog.count({ where: { action: 'SHIPMENT_LEG_DISPATCH_UNAVAILABLE' } })).toBe(auditBefore + 1);
    expect(await ctx.prisma.notification.count({ where: { event: 'SHIPMENT_COURIER_UNAVAILABLE' } })).toBe(notifBefore + 2);

    // A second sweep tick on the same still-unavailable leg must NOT alert again.
    await dispatch.dispatchLeg(leg.id);
    await dispatch.dispatchLeg(leg.id);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'SHIPMENT_LEG_DISPATCH_UNAVAILABLE' } })).toBe(auditBefore + 1);
    expect(await ctx.prisma.notification.count({ where: { event: 'SHIPMENT_COURIER_UNAVAILABLE' } })).toBe(notifBefore + 2);

    const recipients = await ctx.prisma.notificationRecipient.findMany({
      where: {
        notification: {
          event: 'SHIPMENT_COURIER_UNAVAILABLE',
          data: { path: ['reference'], equals: r.body.reference },
        },
      },
      include: { notification: true },
    });
    // One admin (every logistics.read holder) and the customer who paid.
    const recipientUserIds = new Set(recipients.map((r2) => r2.userId));
    expect(recipientUserIds.has(customer.userId)).toBe(true);
  });

  it('resets the dedup once a driver comes online and offers the leg, so a LATER unavailable episode alerts again', async () => {
    const customer = await registerCustomer(`reset_${uniq()}@example.com`);
    await fund(customer.userId, 10_000);
    const r = await post(customer.cookies, 'shipping', { ...parcel('ORANGE_WALK', 'Orange Walk Town'), payWithWallet: true });
    expect(r.status).toBe(201);
    const leg = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId: r.body.id } });
    expect(await ctx.prisma.auditLog.count({ where: { action: 'SHIPMENT_LEG_DISPATCH_UNAVAILABLE' } })).toBeGreaterThanOrEqual(1);
    const before = await ctx.prisma.auditLog.count({ where: { action: 'SHIPMENT_LEG_DISPATCH_UNAVAILABLE' } });

    const { driverProfileId, cookies: driverCookies } = await onlineDriverFor('ORANGE_WALK');
    const outcome = await dispatch.dispatchLeg(leg.id);
    expect(outcome.result).toBe('OFFERED');

    // Take the driver offline BEFORE declining: decline() re-dispatches
    // internally (shipment-driver.service.ts "straight to the next driver,
    // same as a declined delivery"), and rankFor ranks a prior-decliner LAST
    // rather than dropping them — so declining while still online with only
    // one driver in the district would just re-offer the same driver to
    // themselves. Offline first is what makes decline's own internal
    // re-dispatch find nobody and raise the new episode.
    await ctx.prisma.driverProfile.update({ where: { id: driverProfileId }, data: { availability: 'OFFLINE' } });
    expect((await post(driverCookies, `driver/shipping-jobs/${leg.id}/decline`, { reason: 'Too far.' })).status).toBe(201);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'SHIPMENT_LEG_DISPATCH_UNAVAILABLE' } })).toBe(before + 1);
  });
});

describe('CLOSE-20: dispatchUnavailableAt — a persistent marker, mirroring dispatchExhaustedAt', () => {
  it('is set the first time a leg has zero eligible drivers, distinct from (and alongside) dispatchExhaustedAt', async () => {
    const customer = await registerCustomer(`unavailset_${uniq()}@example.com`);
    await fund(customer.userId, 10_000);
    // STANN_CREEK: covered only by the baseline (permanently OFFLINE) courier
    // — same zero-eligible-pool condition the escalation describe above uses.
    const r = await post(customer.cookies, 'shipping', { ...parcel('STANN_CREEK', 'Dangriga'), payWithWallet: true });
    expect(r.status).toBe(201);
    const leg = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId: r.body.id } });

    const row = await ctx.prisma.shipmentLeg.findUniqueOrThrow({
      where: { id: leg.id },
      select: { dispatchUnavailableAt: true, dispatchExhaustedAt: true },
    });
    // Unavailable (nobody was ever eligible to ask) is not exhausted (everyone
    // eligible already declined) — the two columns record different causes,
    // and only the first should be set here.
    expect(row.dispatchUnavailableAt).not.toBeNull();
    expect(row.dispatchExhaustedAt).toBeNull();

    // A second tick on the same still-unavailable leg does not move the
    // timestamp — same conditional-update contract as markExhausted's own
    // dispatchExhaustedAt, so an admin can trust it as "when this episode
    // started," not "when a sweep last looked at it."
    const first = row.dispatchUnavailableAt!;
    await dispatch.dispatchLeg(leg.id);
    const after = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: leg.id }, select: { dispatchUnavailableAt: true } });
    expect(after.dispatchUnavailableAt).toEqual(first);
  });

  it('clears the moment an offer is actually created for the leg — the half that matters', async () => {
    const customer = await registerCustomer(`unavailclear_${uniq()}@example.com`);
    await fund(customer.userId, 10_000);
    // A fresh district-context (COROZAL, baseline-only coverage) so this is
    // independent of the other COROZAL/STANN_CREEK/ORANGE_WALK tests above.
    const r = await post(customer.cookies, 'shipping', { ...parcel('COROZAL', 'Corozal Town'), payWithWallet: true });
    expect(r.status).toBe(201);
    const leg = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId: r.body.id } });
    expect(
      (await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: leg.id }, select: { dispatchUnavailableAt: true } }))
        .dispatchUnavailableAt,
    ).not.toBeNull();

    // A genuinely new, untried driver comes online in the same district —
    // dispatchLeg must both offer the leg AND clear the stale marker in the
    // same write, not leave it to a separate cleanup pass.
    await onlineDriverFor('COROZAL');
    const outcome = await dispatch.dispatchLeg(leg.id);
    expect(outcome.result).toBe('OFFERED');

    const cleared = await ctx.prisma.shipmentLeg.findUniqueOrThrow({
      where: { id: leg.id },
      select: { dispatchUnavailableAt: true },
    });
    expect(cleared.dispatchUnavailableAt).toBeNull();
  });

  it('surfaces as needsDriverReason on the admin ops board, with EXHAUSTED taking precedence when both are set', async () => {
    const customer = await registerCustomer(`unavailreason_${uniq()}@example.com`);
    await fund(customer.userId, 10_000);
    const r = await post(customer.cookies, 'shipping', { ...parcel('STANN_CREEK', 'Dangriga'), payWithWallet: true });
    expect(r.status).toBe(201);
    const leg = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId: r.body.id } });

    const rowOf = async () => {
      const list = await get(admin, 'admin/logistics/shipments?pageSize=100');
      expect(list.status).toBe(200);
      const shipment = list.body.rows.find((s: { id: string }) => s.id === r.body.id);
      return shipment.legs.find((l: { id: string }) => l.id === leg.id);
    };

    expect((await rowOf()).needsDriverReason).toBe('UNAVAILABLE');

    // Simulate the leg later also reaching EXHAUSTED (both columns now set) —
    // the read-side precedence must resolve to EXHAUSTED, not UNAVAILABLE,
    // so the board never shows the wrong one of the two markers.
    await ctx.prisma.shipmentLeg.update({ where: { id: leg.id }, data: { dispatchExhaustedAt: new Date() } });
    expect((await rowOf()).needsDriverReason).toBe('EXHAUSTED');
  });
});

describe('CLOSE-21: the needsDriver filter on the ops board', () => {
  it('filters to shipments with an exhausted OR unavailable leg; omitting it shows everything; pagination stays correct under the filter', async () => {
    // Baseline, delta-scoped: other tests in this file also create
    // unavailable/exhausted legs before this one runs.
    const baseline = await get(admin, 'admin/logistics/shipments?needsDriver=true&pageSize=1');
    expect(baseline.status).toBe(200);
    const totalBefore = baseline.body.total;

    // A shipment that will NOT need a driver — CAYO already has an online
    // driver from the booking-time describe above.
    const fineCustomer = await registerCustomer(`needsdriverfilter_fine_${uniq()}@example.com`);
    await fund(fineCustomer.userId, 10_000);
    const fine = await post(fineCustomer.cookies, 'shipping', { ...parcel('CAYO', 'San Ignacio'), payWithWallet: true });
    expect(fine.status).toBe(201);

    // Three separate stranded shipments (zero-coverage-but-configured
    // district), so pagination with pageSize=1 has three real pages to walk.
    const strandedIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const c = await registerCustomer(`needsdriverfilter_stranded_${uniq()}@example.com`);
      await fund(c.userId, 10_000);
      const r = await post(c.cookies, 'shipping', { ...parcel('STANN_CREEK', 'Dangriga'), payWithWallet: true });
      expect(r.status).toBe(201);
      strandedIds.push(r.body.id);
    }

    // Omitting the filter: both the fine shipment and the three stranded
    // ones are findable — it restricts nothing.
    const unfiltered = await get(admin, 'admin/logistics/shipments?pageSize=100');
    const unfilteredIds = new Set(unfiltered.body.rows.map((row: { id: string }) => row.id));
    expect(unfilteredIds.has(fine.body.id)).toBe(true);
    for (const id of strandedIds) expect(unfilteredIds.has(id)).toBe(true);

    // Filtered on, one page at a time: total grows by exactly 3, the fine
    // shipment never appears, and walking every page (pageSize=1) returns
    // each of the three stranded shipments exactly once — no duplicate, no
    // omission, proving the filter is applied consistently across pages,
    // not just to the first one.
    const page1 = await get(admin, 'admin/logistics/shipments?needsDriver=true&pageSize=1&page=1');
    expect(page1.body.total).toBe(totalBefore + 3);
    const seen = new Set<string>();
    for (let page = 1; page <= 3; page++) {
      const r = await get(admin, `admin/logistics/shipments?needsDriver=true&pageSize=1&page=${page}`);
      expect(r.status).toBe(200);
      expect(r.body.rows).toHaveLength(1);
      expect(r.body.rows[0].id).not.toBe(fine.body.id);
      seen.add(r.body.rows[0].id);
    }
    expect(seen.size).toBe(3);
    for (const id of strandedIds) expect(seen.has(id)).toBe(true);
  });
});

describe('CLOSE-22: a CANCELLED leg stops counting toward needsDriver — read-time, markers never cleared', () => {
  it('cancelling a leg with dispatchUnavailableAt or dispatchExhaustedAt set flips needsDriver/needsDriverReason to false/null everywhere, without erasing the stored timestamp', async () => {
    // Leg 1: naturally goes UNAVAILABLE (STANN_CREEK, baseline-only coverage).
    const unavailCustomer = await registerCustomer(`close22_unavail_${uniq()}@example.com`);
    await fund(unavailCustomer.userId, 10_000);
    const unavailShip = await post(unavailCustomer.cookies, 'shipping', { ...parcel('STANN_CREEK', 'Dangriga'), payWithWallet: true });
    expect(unavailShip.status).toBe(201);
    const unavailLeg = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId: unavailShip.body.id } });
    expect(
      (await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: unavailLeg.id }, select: { dispatchUnavailableAt: true } }))
        .dispatchUnavailableAt,
    ).not.toBeNull();

    // Leg 2: EXHAUSTED, forced directly the same way the CLOSE-20 precedence
    // test above does — CAYO already has an online driver so this is purely
    // a simulated marker, independent of real dispatch state.
    const exhaustedCustomer = await registerCustomer(`close22_exhausted_${uniq()}@example.com`);
    await fund(exhaustedCustomer.userId, 10_000);
    const exhaustedShip = await post(exhaustedCustomer.cookies, 'shipping', { ...parcel('CAYO', 'San Ignacio'), payWithWallet: true });
    expect(exhaustedShip.status).toBe(201);
    const exhaustedLeg = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId: exhaustedShip.body.id } });
    await ctx.prisma.shipmentLeg.update({ where: { id: exhaustedLeg.id }, data: { dispatchExhaustedAt: new Date() } });

    // Both cancelled before they move — the exact path Oscar's live fixture hit.
    expect((await post(unavailCustomer.cookies, `shipping/${unavailShip.body.id}/cancel`, { reason: 'test' })).status).toBe(201);
    expect((await post(exhaustedCustomer.cookies, `shipping/${exhaustedShip.body.id}/cancel`, { reason: 'test' })).status).toBe(201);

    // THE BOUNDARY: cancellation must NOT clear or null the stored marker —
    // it is audit history of what dispatch actually did (CLOSE-20), not a
    // live status. This fix is read-time only.
    const unavailAfter = await ctx.prisma.shipmentLeg.findUniqueOrThrow({
      where: { id: unavailLeg.id },
      select: { dispatchUnavailableAt: true, status: true },
    });
    expect(unavailAfter.status).toBe('CANCELLED');
    expect(unavailAfter.dispatchUnavailableAt).not.toBeNull();
    const exhaustedAfter = await ctx.prisma.shipmentLeg.findUniqueOrThrow({
      where: { id: exhaustedLeg.id },
      select: { dispatchExhaustedAt: true, status: true },
    });
    expect(exhaustedAfter.status).toBe('CANCELLED');
    expect(exhaustedAfter.dispatchExhaustedAt).not.toBeNull();

    // But the read side — the boolean AND the reason, at both the shipment
    // level and the leg level — must no longer report either as needing a
    // driver, since the leg is no longer open.
    const board = await get(admin, 'admin/logistics/shipments?pageSize=100');
    expect(board.status).toBe(200);
    const unavailRow = board.body.rows.find((s: { id: string }) => s.id === unavailShip.body.id);
    const exhaustedRow = board.body.rows.find((s: { id: string }) => s.id === exhaustedShip.body.id);
    expect(unavailRow.needsDriver).toBe(false);
    const unavailLegRow = unavailRow.legs.find((l: { id: string }) => l.id === unavailLeg.id);
    expect(unavailLegRow.needsDriver).toBe(false);
    expect(unavailLegRow.needsDriverReason).toBeNull();
    expect(exhaustedRow.needsDriver).toBe(false);
    const exhaustedLegRow = exhaustedRow.legs.find((l: { id: string }) => l.id === exhaustedLeg.id);
    expect(exhaustedLegRow.needsDriver).toBe(false);
    expect(exhaustedLegRow.needsDriverReason).toBeNull();

    // And the needsDriver filter — the other path that reads the same
    // columns — must exclude both. CLOSE-21's own near-miss was exactly one
    // path silently keeping a condition the other lost; this is that same
    // check for CLOSE-22's fix.
    const filtered = await get(admin, 'admin/logistics/shipments?needsDriver=true&pageSize=100');
    expect(filtered.status).toBe(200);
    const filteredIds = new Set(filtered.body.rows.map((s: { id: string }) => s.id));
    expect(filteredIds.has(unavailShip.body.id)).toBe(false);
    expect(filteredIds.has(exhaustedShip.body.id)).toBe(false);
  });

  it('the needsDriver filter still composes with the carrier (operatedByProviderId) filter after this fix', async () => {
    const customer = await registerCustomer(`close22_compose_${uniq()}@example.com`);
    await fund(customer.userId, 10_000);
    const ship = await post(customer.cookies, 'shipping', { ...parcel('STANN_CREEK', 'Dangriga'), payWithWallet: true });
    expect(ship.status).toBe(201);
    const leg = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId: ship.body.id } });
    expect(
      (await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: leg.id }, select: { dispatchUnavailableAt: true } }))
        .dispatchUnavailableAt,
    ).not.toBeNull();

    const op = await registerCustomer(`close22_carrier_${uniq()}@example.com`);
    const provider = await ctx.prisma.shippingProviderProfile.create({
      data: { userId: op.userId, businessName: 'CLOSE-22 Synthetic Carrier', contactEmail: `close22_carrier_${uniq()}@example.com` },
    });
    await ctx.prisma.shipmentLeg.update({ where: { id: leg.id }, data: { operatedByProviderId: provider.id } });

    // Both filters at once, same shipment: still open AND on this carrier.
    const both = await get(admin, `admin/logistics/shipments?needsDriver=true&operatedByProviderId=${provider.id}&pageSize=100`);
    expect(both.status).toBe(200);
    expect(both.body.rows.map((s: { id: string }) => s.id)).toContain(ship.body.id);

    // A different carrier id: the carrier half of the AND fails, so it drops out.
    const otherOp = await registerCustomer(`close22_othercarrier_${uniq()}@example.com`);
    const otherProvider = await ctx.prisma.shippingProviderProfile.create({
      data: { userId: otherOp.userId, businessName: 'CLOSE-22 Other Carrier', contactEmail: `close22_othercarrier_${uniq()}@example.com` },
    });
    const mismatched = await get(admin, `admin/logistics/shipments?needsDriver=true&operatedByProviderId=${otherProvider.id}&pageSize=100`);
    expect(mismatched.body.rows.map((s: { id: string }) => s.id)).not.toContain(ship.body.id);

    // Cancel it: needsDriver now excludes it even though the carrier filter alone would still find it.
    expect((await post(customer.cookies, `shipping/${ship.body.id}/cancel`, { reason: 'test' })).status).toBe(201);
    const afterCancel = await get(admin, `admin/logistics/shipments?needsDriver=true&operatedByProviderId=${provider.id}&pageSize=100`);
    expect(afterCancel.body.rows.map((s: { id: string }) => s.id)).not.toContain(ship.body.id);
    const carrierOnly = await get(admin, `admin/logistics/shipments?operatedByProviderId=${provider.id}&pageSize=100`);
    expect(carrierOnly.body.rows.map((s: { id: string }) => s.id)).toContain(ship.body.id);
  });
});

/**
 * DISPATCH-2 (god's card): three defects in `shipment-dispatch.service.ts`,
 * all verified against `origin/main` before carding, all fixed here.
 */
describe('DISPATCH-2: the undispatched sweep has no orderBy at all', () => {
  async function setAutomatic(value: boolean) {
    const row = await ctx.prisma.platformSetting.findFirstOrThrow();
    await ctx.prisma.platformSetting.update({ where: { id: row.id }, data: { dispatchAutomatic: value } });
  }

  it('sweepUndispatched processes waiting legs oldest-first, not in whatever order the database happens to return them (DISPATCH-2)', async () => {
    // Dispatch OFF for booking only: these four legs must land PENDING_ASSIGNMENT
    // and stay there — CAYO already carries the baseline's (OFFLINE) coverage
    // from beforeAll, so booking succeeds as TEMPORARILY_UNAVAILABLE and no
    // auto-offer fires regardless, with automatic dispatch off as a second,
    // belt-and-suspenders guarantee that nothing else moves these legs before
    // the sweep under test gets to them.
    await setAutomatic(false);
    const legIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const customer = await registerCustomer(`fifo${i}_${uniq()}@example.com`);
      await fund(customer.userId, 10_000);
      const r = await post(customer.cookies, 'shipping', { ...parcel('CAYO', 'San Ignacio'), payWithWallet: true });
      expect(r.status).toBe(201);
      legIds.push((await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId: r.body.id } })).id);
    }
    await setAutomatic(true);

    // Backdate createdAt to the EXACT REVERSE of creation order — leg[0]
    // (created first) gets the newest timestamp, leg[3] (created last) gets
    // the oldest. If the fix merely happened to match natural row-insertion
    // order this would catch it; the only way to pass is a real `orderBy`.
    const base = Date.now() - 60 * 60 * 1000;
    for (let i = 0; i < legIds.length; i++) {
      await ctx.prisma.shipmentLeg.update({
        where: { id: legIds[i] },
        data: { createdAt: new Date(base + (legIds.length - 1 - i) * 60_000) },
      });
    }
    const expectedOldestFirst = [...legIds].reverse(); // leg[3] is now oldest, leg[0] is now newest

    const spy = vi.spyOn(dispatch, 'dispatchLeg');
    spy.mockClear();
    await dispatch.sweepUndispatched();

    // The sweep also touches every OTHER waiting leg this file's earlier
    // tests left behind — filter to just these four and check their
    // RELATIVE order, which is all a shared `take: 50` scan can promise.
    const calledOrder = spy.mock.calls.map((c) => c[0] as string).filter((id) => legIds.includes(id));
    expect(calledOrder).toEqual(expectedOldestFirst);
    spy.mockRestore();
  });
});

describe('DISPATCH-2: the untried-driver re-arm is bounded on offerCount, not unbounded by every new driver signup', () => {
  async function onlineDriverWithVehicle(district: string) {
    const d = await onlineDriverFor(district);
    const vehicle = await ctx.prisma.driverVehicle.findFirstOrThrow({ where: { driverProfileId: d.driverProfileId } });
    return { ...d, vehicleId: vehicle.id };
  }

  it('an EXHAUSTED leg stays exhausted once offerCount reaches dispatchMaxOffers, even though a brand-new untried driver then appears (DISPATCH-2)', async () => {
    // TOLEDO: beforeAll strips the baseline's coverage here specifically so
    // this district starts with ZERO drivers — the three created below are
    // the entire pool, with no residue from any earlier test in this file to
    // confuse who gets offered what.
    const drivers = [await onlineDriverWithVehicle('TOLEDO'), await onlineDriverWithVehicle('TOLEDO'), await onlineDriverWithVehicle('TOLEDO')];
    const cookiesFor = (id: string) => drivers.find((d) => d.driverProfileId === id)!.cookies;

    const customer = await registerCustomer(`maxoffers_${uniq()}@example.com`);
    await fund(customer.userId, 10_000);
    const r = await post(customer.cookies, 'shipping', { ...parcel('TOLEDO', 'Punta Gorda'), payWithWallet: true });
    expect(r.status).toBe(201);
    const legId = (await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId: r.body.id } })).id;

    // enableDispatch() (beforeAll) set dispatchMaxOffers: 3 — decline through
    // all three known drivers, whichever order dispatchLeg offers them in.
    for (let i = 0; i < 3; i++) {
      const row = await ctx.prisma.shipmentLeg.findUniqueOrThrow({
        where: { id: legId },
        select: { assignedDriverProfileId: true, courierStatus: true },
      });
      expect(row.courierStatus).toBe('ASSIGNED');
      const declined = await post(cookiesFor(row.assignedDriverProfileId!), `driver/shipping-jobs/${legId}/decline`, {
        reason: 'DISPATCH-2 fixture decline',
      });
      expect(declined.status).toBe(201);
    }

    const afterThree = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId } });
    expect(afterThree.offerCount).toBe(3);
    expect(afterThree.dispatchExhaustedAt).not.toBeNull();
    expect(afterThree.assignedDriverProfileId).toBeNull();

    // Before this fix: `rankFor`'s untried filter is scoped to THIS leg's
    // own offer history, so a never-before-seen driver always counts as
    // "untried" for it — `sweepExhaustedRecovery` would clear
    // `dispatchExhaustedAt` and `dispatchLeg` would offer them, pushing
    // offerCount to 4 and past the configured budget. The fix excludes any
    // leg already at `offerCount >= cfg.maxOffers` from recovery entirely.
    await onlineDriverWithVehicle('TOLEDO');
    await dispatch.sweepExhaustedRecovery();
    const afterRecovery = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId } });
    expect(afterRecovery.dispatchExhaustedAt).not.toBeNull();
    expect(afterRecovery.offerCount).toBe(3);
    expect(afterRecovery.assignedDriverProfileId).toBeNull();

    // Same bound at dispatchLeg's own call site, directly — not only via the
    // sweeper that calls it.
    const direct = await dispatch.dispatchLeg(legId);
    expect(direct.result).toBe('EXHAUSTED');
    expect((await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId } })).offerCount).toBe(3);
  });
});

describe('DISPATCH-2: a human assignment\'s silent wait is made visible on the ops board, not auto-expired', () => {
  async function onlineDriverWithVehicle(district: string) {
    const d = await onlineDriverFor(district);
    const vehicle = await ctx.prisma.driverVehicle.findFirstOrThrow({ where: { driverProfileId: d.driverProfileId } });
    return { ...d, vehicleId: vehicle.id };
  }
  async function setAutomatic(value: boolean) {
    const row = await ctx.prisma.platformSetting.findFirstOrThrow();
    await ctx.prisma.platformSetting.update({ where: { id: row.id }, data: { dispatchAutomatic: value } });
  }
  async function legRowOnBoard(shipmentId: string, legId: string) {
    const list = await get(admin, 'admin/logistics/shipments?pageSize=100');
    expect(list.status).toBe(200);
    const shipment = list.body.rows.find((s: { id: string }) => s.id === shipmentId);
    return shipment.legs.find((l: { id: string }) => l.id === legId);
  }

  it('a manually-assigned leg shows manualAssignmentPendingSince (= its own assignedAt) until the driver accepts, then it clears (DISPATCH-2)', async () => {
    // Dispatch OFF for booking only, so this leg lands PENDING_ASSIGNMENT —
    // untouched by any automatic offer — before the manual assignment below.
    await setAutomatic(false);
    const customer = await registerCustomer(`manualpending_${uniq()}@example.com`);
    await fund(customer.userId, 10_000);
    const r = await post(customer.cookies, 'shipping', { ...parcel('CAYO', 'San Ignacio'), payWithWallet: true });
    expect(r.status).toBe(201);
    const leg = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId: r.body.id } });
    await setAutomatic(true);
    expect((await legRowOnBoard(r.body.id, leg.id)).manualAssignmentPendingSince).toBeNull();

    const driver = await onlineDriverWithVehicle('CAYO');
    const assigned = await post(admin, `admin/logistics/legs/${leg.id}/assign`, {
      driverProfileId: driver.driverProfileId,
      vehicleId: driver.vehicleId,
    });
    expect(assigned.status).toBe(201);

    const row = await legRowOnBoard(r.body.id, leg.id);
    expect(row.manualAssignmentPendingSince).not.toBeNull();
    const dbLeg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: leg.id }, select: { assignedAt: true } });
    expect(new Date(row.manualAssignmentPendingSince).getTime()).toBe(dbLeg.assignedAt!.getTime());

    expect((await post(driver.cookies, `driver/shipping-jobs/${leg.id}/accept`)).status).toBe(201);
    expect((await legRowOnBoard(r.body.id, leg.id)).manualAssignmentPendingSince).toBeNull();
  });

  it('an AUTOMATIC offer never shows as a pending manual assignment, even while unaccepted (DISPATCH-2)', async () => {
    // COROZAL already carries an online driver from an earlier test in this
    // file — dispatch stays ON (the file default) so booking auto-offers.
    const customer = await registerCustomer(`autopending_${uniq()}@example.com`);
    await fund(customer.userId, 10_000);
    const r = await post(customer.cookies, 'shipping', { ...parcel('COROZAL', 'Corozal Town'), payWithWallet: true });
    expect(r.status).toBe(201);
    const leg = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId: r.body.id } });
    const dbLeg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({
      where: { id: leg.id },
      select: { courierStatus: true, offerExpiresAt: true },
    });
    expect(dbLeg.courierStatus).toBe('ASSIGNED');
    expect(dbLeg.offerExpiresAt).not.toBeNull(); // the tell: a real offer always carries a timeout

    expect((await legRowOnBoard(r.body.id, leg.id)).manualAssignmentPendingSince).toBeNull();
  });

  it('the shipment DETAIL page carries the same field, not a two-clause approximation that cannot see offerExpiresAt (MDF-624)', async () => {
    async function legRowOnDetail(reference: string, legId: string) {
      const detail = await get(admin, `admin/logistics/shipments/${reference}`);
      expect(detail.status).toBe(200);
      return detail.body.legs.find((l: { id: string }) => l.id === legId);
    }

    // Manual, still unaccepted: the detail page must show the assign instant,
    // the same `listForOps` expression — not a re-derivation that can drift.
    await setAutomatic(false);
    const manualCustomer = await registerCustomer(`manualdetail_${uniq()}@example.com`);
    await fund(manualCustomer.userId, 10_000);
    const manual = await post(manualCustomer.cookies, 'shipping', { ...parcel('ORANGE_WALK', 'Orange Walk Town'), payWithWallet: true });
    expect(manual.status).toBe(201);
    const manualLeg = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId: manual.body.id } });
    await setAutomatic(true);
    const manualDriver = await onlineDriverWithVehicle('ORANGE_WALK');
    expect((await post(admin, `admin/logistics/legs/${manualLeg.id}/assign`, {
      driverProfileId: manualDriver.driverProfileId,
      vehicleId: manualDriver.vehicleId,
    })).status).toBe(201);

    const manualOnDetail = await legRowOnDetail(manual.body.reference, manualLeg.id);
    expect(manualOnDetail.manualAssignmentPendingSince).not.toBeNull();
    const dbManualLeg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: manualLeg.id }, select: { assignedAt: true } });
    expect(new Date(manualOnDetail.manualAssignmentPendingSince).getTime()).toBe(dbManualLeg.assignedAt!.getTime());

    // Automatic, still unaccepted: this is the whole point. courierStatus is
    // ASSIGNED and acceptedAt is null, exactly like the manual leg above —
    // the two-clause approximation Oscar's page used could not tell these
    // apart. Only offerExpiresAt (never serialized before this card) does.
    await onlineDriverFor('STANN_CREEK');
    const autoCustomer = await registerCustomer(`autodetail_${uniq()}@example.com`);
    await fund(autoCustomer.userId, 10_000);
    const auto = await post(autoCustomer.cookies, 'shipping', { ...parcel('STANN_CREEK', 'Dangriga'), payWithWallet: true });
    expect(auto.status).toBe(201);
    const autoLeg = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId: auto.body.id } });
    const dbAutoLeg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: autoLeg.id }, select: { courierStatus: true, offerExpiresAt: true } });
    expect(dbAutoLeg.courierStatus).toBe('ASSIGNED');
    expect(dbAutoLeg.offerExpiresAt).not.toBeNull();

    const autoOnDetail = await legRowOnDetail(auto.body.reference, autoLeg.id);
    expect(autoOnDetail.manualAssignmentPendingSince).toBeNull();
  });
});

describe('a blocked leg is still safely cancellable and refundable', () => {
  it('cancels a TEMPORARILY_UNAVAILABLE shipment before it moves and refunds in full', async () => {
    const customer = await registerCustomer(`cancel_${uniq()}@example.com`);
    await fund(customer.userId, 10_000);
    const wallet = await ctx.prisma.walletAccount.findFirstOrThrow({ where: { userId: customer.userId, type: 'USER' } });
    const balanceOf = async () =>
      ctx.prisma.walletLedgerEntry
        .findMany({ where: { accountId: wallet.id } })
        .then((rows) => rows.reduce((s, e) => s + (e.direction === 'CREDIT' ? e.amountMinor : -e.amountMinor), 0n));
    const before = await balanceOf();

    const r = await post(customer.cookies, 'shipping', { ...parcel('COROZAL', 'Corozal Town'), payWithWallet: true });
    expect(r.status).toBe(201);
    const afterCharge = await balanceOf();
    expect(afterCharge).toBeLessThan(before);

    const c = await post(customer.cookies, `shipping/${r.body.id}/cancel`, { reason: 'Changed my mind.' });
    expect(c.status).toBe(201);
    expect(await balanceOf()).toBe(before);
  });
});
