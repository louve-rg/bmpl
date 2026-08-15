/**
 * M26.3 FINAL GATE — integration vs real Postgres.
 *
 * Three things the milestone sign-off turns on, none of which can be proved
 * safely in production:
 *
 *  1. RE-OFFER (Part 6). `systemAssign` was changed to use REASSIGN when a
 *     delivery sits in DRIVER_DECLINED. That is a dispatch change on a system
 *     that has already caused two production incidents, so it is verified end to
 *     end here — including the things a re-offer must NOT duplicate.
 *  2. CANCELLED ORDER (Part 7). The 3a2181e invariant shipped with no test at
 *     all; the commit changed only payments.service.ts and a migration. A
 *     regression would silently refill the dispatch queue with orders nobody is
 *     ever going to fulfil, which is exactly the incident it fixed.
 *  3. DRIVER PRIVACY + OWNERSHIP (Part 11), with the emphasis on what a driver
 *     must not be able to see or do.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';
import { DispatchEngineService } from '../src/dispatch/dispatch-engine.service';

let ctx: TestContext;
let engine: DispatchEngineService;
let adminCookies: string[];
let categoryId: string;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object | string = {}) =>
  request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const put = (c: string[], p: string, b: object | string = {}) =>
  request(ctx.server).put(`/api/${p}`).set('Cookie', c).send(b);

async function registerCustomer(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

interface Vendor {
  vendorProfileId: string;
  vendorUserId: string;
  vendorCookies: string[];
  productId: string;
  inventoryId: string;
}
async function makeVendor(): Promise<Vendor> {
  const s = uniq();
  const { userId, cookies } = await registerCustomer(`fgvend_${s}@example.bz`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'VENDOR' } },
    create: { userId, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const vp = await ctx.prisma.vendorProfile.create({
    data: {
      userId,
      businessName: `FG Store ${s}`,
      slug: `fg-store-${s}`,
      contactEmail: `fgv${s}@x.bz`,
      approvalStatus: 'APPROVED',
      storeStatus: 'OPEN',
      settings: { create: { deliveryEnabled: true, pickupEnabled: true } },
      locations: { create: { label: 'Main', addressLine1: '1 St', city: 'Belize City', district: 'BELIZE', isPrimary: true } },
    },
  });
  const product = await ctx.prisma.product.create({
    data: {
      vendorProfileId: vp.id,
      categoryId,
      title: `FGProd ${s}`,
      slug: `fgprod-${s}`,
      sku: `FGSKU-${s}`,
      status: 'PUBLISHED',
      priceMinor: 1000n,
      currency: 'BZD',
      inventory: { create: { quantity: 50, reserved: 0 } },
    },
  });
  const inv = await ctx.prisma.inventory.findFirstOrThrow({ where: { productId: product.id } });
  return { vendorProfileId: vp.id, vendorUserId: userId, vendorCookies: cookies, productId: product.id, inventoryId: inv.id };
}

/** Distinctive PII so a leak is unambiguous in an assertion. */
const CUSTOMER_NAME = 'Aurelia Pennyworth';
const CUSTOMER_PHONE = '+5010001111';
const CUSTOMER_STREET = '77 Secret Lane';

interface MadeOrder {
  deliveryId: string;
  vendorOrderId: string;
  orderId: string;
  customerId: string;
  customerCookies: string[];
}
async function makeOrder(vendor: Vendor, opts: { ready?: boolean } = {}): Promise<MadeOrder> {
  const ready = opts.ready ?? true;
  const s = uniq();
  const { userId: customerId, cookies: customerCookies } = await registerCustomer(`fgcust_${s}@example.bz`);
  await ctx.prisma.inventory.update({ where: { id: vendor.inventoryId }, data: { reserved: { increment: 1 } } });
  const num = `FGORD-${s}`;
  const order = await ctx.prisma.order.create({
    data: {
      orderNumber: num,
      userId: customerId,
      status: 'PENDING',
      itemCount: 1,
      subtotalMinor: 1000n,
      deliveryFeeMinor: 500n,
      totalMinor: 1500n,
      addresses: {
        create: {
          type: 'SHIPPING',
          fullName: CUSTOMER_NAME,
          phone: CUSTOMER_PHONE,
          addressLine1: CUSTOMER_STREET,
          city: 'Belize City',
          district: 'BELIZE',
        },
      },
      vendorOrders: {
        create: {
          orderNumber: `${num}-1`,
          vendorProfileId: vendor.vendorProfileId,
          status: ready ? 'READY_FOR_PICKUP' : 'PENDING',
          readyForPickupAt: ready ? new Date() : null,
          deliveryMethod: 'DELIVERY',
          itemCount: 1,
          subtotalMinor: 1000n,
          items: { create: { productId: vendor.productId, productTitle: 'FGProd', unitPriceMinor: 1000n, quantity: 1, subtotalMinor: 1000n } },
          delivery: { create: { status: 'PENDING_ASSIGNMENT', feeMinor: 500n, readyForDispatchAt: ready ? new Date() : null } },
        },
      },
    },
    include: { vendorOrders: { include: { delivery: true } } },
  });
  const vo = order.vendorOrders[0]!;
  return { deliveryId: vo.delivery!.id, vendorOrderId: vo.id, orderId: order.id, customerId, customerCookies };
}

interface Driver {
  cookies: string[];
  userId: string;
  driverProfileId: string;
  vehicleId: string;
}
async function makeDriver(): Promise<Driver> {
  const s = uniq();
  const { cookies, userId } = await registerCustomer(`fgdrv_${s}@example.bz`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId,
      legalName: 'D River',
      displayName: `FGDrv${s}`,
      phone: '+5016000000',
      homeDistrict: 'BELIZE',
      licenceNumber: `FGDL-${s}`,
      licenceExpiry: FUTURE,
      vehicleOwnership: 'OWNED',
      availability: 'ONLINE',
      isActive: true,
    },
  });
  const vehicle = await ctx.prisma.driverVehicle.create({
    data: {
      driverProfileId: profile.id,
      type: 'CAR',
      make: 'Toyota',
      model: 'Corolla',
      licencePlate: `FZ-${s}`.slice(0, 18),
      registrationExpiry: FUTURE,
      insuranceExpiry: FUTURE,
      isActive: true,
      isPrimary: true,
      approvalStatus: 'APPROVED',
    },
  });
  await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: 'BELIZE', isActive: true } });
  return { cookies, userId, driverProfileId: profile.id, vehicleId: vehicle.id };
}

async function enableDispatch(over: Record<string, unknown> = {}) {
  const existing = await ctx.prisma.platformSetting.findFirst();
  const data = {
    dispatchAutomatic: true,
    dispatchOfferTimeoutSeconds: 90,
    dispatchMaxOffers: 5,
    dispatchMaxConcurrentPerDriver: 3,
    ...over,
  };
  if (existing) await ctx.prisma.platformSetting.update({ where: { id: existing.id }, data });
  else await ctx.prisma.platformSetting.create({ data });
}

const deliveryOf = (id: string) => ctx.prisma.orderDelivery.findUniqueOrThrow({ where: { id } });

/**
 * Walk a payload and report anywhere a PIN is exposed.
 *
 * Deliberately NOT `JSON.stringify(body).includes(pin)`. A PIN is four digits,
 * and a serialized delivery is full of cuids, ISO timestamps and money amounts —
 * so a random four-digit run collides by chance often enough to fail roughly one
 * CI run in fifteen. That is worse than no test at all here: a red check suite
 * makes Railway SKIP the deploy silently, which has already frozen this API for
 * days once.
 *
 * The real property is structural: no key called *Pin, and no field whose VALUE
 * is exactly the PIN.
 */
function pinLeaks(node: unknown, pins: string[], path = '$'): string[] {
  if (node === null || node === undefined) return [];
  if (Array.isArray(node)) return node.flatMap((v, i) => pinLeaks(v, pins, `${path}[${i}]`));
  if (typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
      /pin$/i.test(k) && typeof v === 'string' && pins.includes(v)
        ? [`${path}.${k}`]
        : pinLeaks(v, pins, `${path}.${k}`),
    );
  }
  return typeof node === 'string' && pins.includes(node) ? [path] : [];
}
const conversationsFor = (deliveryId: string) =>
  ctx.prisma.conversation.findMany({
    where: { contextType: 'DELIVERY', contextId: deliveryId },
    include: { participants: true },
  });

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  const login = await request(ctx.server).post('/api/auth/login').send({ email: admin.email, password: admin.password });
  expect(login.status).toBe(201);
  adminCookies = cookiesOf(login);
  const cat = await ctx.prisma.category.create({ data: { name: 'FinalGate', slug: `fg-${uniq()}` } });
  categoryId = cat.id;
  engine = ctx.app.get(DispatchEngineService);
});
afterAll(async () => {
  await ctx.app.close();
});

beforeEach(async () => {
  await enableDispatch();
  // Only the drivers a test creates itself may be candidates — see the same
  // guard in dispatch-engine.integration.spec.ts.
  await ctx.prisma.driverProfile.updateMany({ data: { availability: 'OFFLINE' } });
});

/* ============================ PART 6 — RE-OFFER ========================== */

describe('Part 6 — decline re-offers to the next driver, exactly once', () => {
  it('closes A out, offers B, and duplicates nothing', async () => {
    const vendor = await makeVendor();
    const order = await makeOrder(vendor);
    const a = await makeDriver();

    expect((await engine.dispatch(order.deliveryId)).result).toBe('ASSIGNED');
    expect((await deliveryOf(order.deliveryId)).assignedDriverProfileId).toBe(a.driverProfileId);

    const b = await makeDriver();
    expect((await post(a.cookies, `driver/jobs/${order.deliveryId}/decline`, { reason: 'Too far right now' })).status).toBe(201);

    // The decline re-dispatches immediately (DriverJobService.decline), which is
    // the path that was broken: systemAssign refused ASSIGN from DRIVER_DECLINED.
    const d = await deliveryOf(order.deliveryId);
    expect(d.status).toBe('ASSIGNED');
    expect(d.assignedDriverProfileId).toBe(b.driverProfileId);
    expect(d.offerCount).toBe(2);
    // Per-attempt verification state is reissued, not carried over from A.
    expect(d.acceptedAt).toBeNull();
    expect(d.declinedAt).toBeNull();

    // A's assignment is CLOSED, not deleted; exactly one is live.
    const assignments = await ctx.prisma.deliveryAssignment.findMany({
      where: { orderDeliveryId: order.deliveryId },
      orderBy: { assignedAt: 'asc' },
    });
    expect(assignments).toHaveLength(2);
    expect(assignments[0]!.driverProfileId).toBe(a.driverProfileId);
    expect(assignments[0]!.status).toBe('DECLINED');
    expect(assignments[1]!.driverProfileId).toBe(b.driverProfileId);
    expect(assignments.filter((x) => x.status === 'ACTIVE')).toHaveLength(1);

    // A cannot accept the stale offer, and cannot even confirm it exists.
    expect((await post(a.cookies, `driver/jobs/${order.deliveryId}/accept`)).status).toBe(404);
    expect((await get(a.cookies, `driver/jobs/${order.deliveryId}`)).status).toBe(404);
    expect((await deliveryOf(order.deliveryId)).assignedDriverProfileId).toBe(b.driverProfileId);

    // B can accept.
    expect((await post(b.cookies, `driver/jobs/${order.deliveryId}/accept`)).status).toBe(201);
    const accepted = await deliveryOf(order.deliveryId);
    expect(accepted.status).toBe('DRIVER_ACCEPTED');
    expect(accepted.assignedDriverProfileId).toBe(b.driverProfileId);

    const afterAccept = await ctx.prisma.deliveryAssignment.findMany({ where: { orderDeliveryId: order.deliveryId } });
    expect(afterAccept.filter((x) => x.status === 'ACCEPTED')).toHaveLength(1);
    expect(afterAccept.filter((x) => x.status === 'ACTIVE')).toHaveLength(0);

    // No duplicate timeline events: each transition appears once.
    const timeline = await ctx.prisma.deliveryTimelineEvent.findMany({ where: { orderDeliveryId: order.deliveryId } });
    const counts = timeline.reduce<Record<string, number>>((acc, t) => ({ ...acc, [t.event]: (acc[t.event] ?? 0) + 1 }), {});
    expect(counts.DECLINE).toBe(1);
    expect(counts.REASSIGN).toBe(1); // the re-offer to B
    expect(counts.ACCEPT).toBe(1);
    expect(counts.ASSIGN).toBe(1); // the original offer to A

    // No duplicate notifications for the acceptance.
    const acceptNotes = await ctx.prisma.notification.findMany({ where: { title: 'Driver accepted' } });
    expect(acceptNotes).toHaveLength(1);

    // No earnings anywhere near this — nothing has been delivered.
    expect(await ctx.prisma.driverEarning.count({ where: { orderDeliveryId: order.deliveryId } })).toBe(0);

    // Still the same vendor order; the re-offer never detached the delivery.
    expect(accepted.vendorOrderId).toBe(order.vendorOrderId);
  });

  it('an expired offer re-offers on the same safe path', async () => {
    const vendor = await makeVendor();
    const order = await makeOrder(vendor);
    const a = await makeDriver();
    expect((await engine.dispatch(order.deliveryId)).result).toBe('ASSIGNED');

    const b = await makeDriver();
    await ctx.prisma.orderDelivery.update({
      where: { id: order.deliveryId },
      data: { offerExpiresAt: new Date(Date.now() - 1000) },
    });

    const swept = await engine.sweepExpiredOffers();
    expect(swept).toEqual({ expired: 1, reassigned: 1 });

    const d = await deliveryOf(order.deliveryId);
    expect(d.status).toBe('ASSIGNED');
    expect(d.assignedDriverProfileId).toBe(b.driverProfileId);
    expect(d.vendorOrderId).toBe(order.vendorOrderId);

    const timeline = await ctx.prisma.deliveryTimelineEvent.findMany({ where: { orderDeliveryId: order.deliveryId } });
    expect(timeline.filter((t) => t.event === 'OFFER_EXPIRED')).toHaveLength(1);

    expect((await post(a.cookies, `driver/jobs/${order.deliveryId}/accept`)).status).toBe(404);
    expect((await post(b.cookies, `driver/jobs/${order.deliveryId}/accept`)).status).toBe(201);
    const assignments = await ctx.prisma.deliveryAssignment.findMany({ where: { orderDeliveryId: order.deliveryId } });
    expect(assignments.filter((x) => x.status === 'ACCEPTED')).toHaveLength(1);
  });

  it('a re-offered delivery still settles exactly one earning when delivered', async () => {
    const vendor = await makeVendor();
    const order = await makeOrder(vendor);
    const a = await makeDriver();
    expect((await engine.dispatch(order.deliveryId)).result).toBe('ASSIGNED');
    const b = await makeDriver();
    await post(a.cookies, `driver/jobs/${order.deliveryId}/decline`, { reason: 'Busy' });
    await post(b.cookies, `driver/jobs/${order.deliveryId}/accept`);

    const pins = await ctx.prisma.orderDelivery.findUniqueOrThrow({
      where: { id: order.deliveryId },
      select: { pickupPin: true, deliveryPin: true },
    });
    await post(b.cookies, `driver/jobs/${order.deliveryId}/confirm-pickup`, { pin: pins.pickupPin });
    await post(b.cookies, `driver/jobs/${order.deliveryId}/in-transit`);
    await post(b.cookies, `driver/jobs/${order.deliveryId}/arriving`);
    expect(
      (await post(b.cookies, `driver/jobs/${order.deliveryId}/confirm-delivery`, { pin: pins.deliveryPin, recipientName: 'R' })).status,
    ).toBe(201);

    // At most one earning, and it can only belong to the driver who delivered.
    const earnings = await ctx.prisma.driverEarning.findMany({ where: { orderDeliveryId: order.deliveryId } });
    expect(earnings.length).toBeLessThanOrEqual(1);
    for (const e of earnings) expect(e.driverProfileId).toBe(b.driverProfileId);
    expect(await ctx.prisma.driverEarning.count({ where: { driverProfileId: a.driverProfileId } })).toBe(0);

    // The declining driver's completion counter is untouched.
    const aProfile = await ctx.prisma.driverProfile.findUniqueOrThrow({ where: { id: a.driverProfileId } });
    expect(aProfile.completedDeliveries).toBe(0);
  });
});

/* ==================== PART 7 — CANCELLED ORDER LIFECYCLE ================= */

describe('Part 7 — a cancelled order takes its delivery with it', () => {
  /**
   * Drive the REAL authorization-failure path — `PaymentsService.authorize` with
   * a customer who has no wallet account. That is the production sequence that
   * left orphaned deliveries behind, so the test exercises it rather than poking
   * the private rollback helper.
   */
  async function failAuthorization(order: MadeOrder) {
    const payment = await ctx.prisma.payment.create({
      data: {
        orderId: order.orderId,
        userId: order.customerId,
        paymentNumber: `PAY-${uniq()}`,
        methodType: 'WALLET',
        status: 'PENDING',
        amountMinor: 1500n,
        currency: 'BZD',
      },
    });
    const payments = ctx.app.get((await import('../src/payments/payments.service')).PaymentsService);
    // authorize() throws ConflictException AFTER rolling the order back.
    await expect(payments.authorize({ userId: order.customerId }, payment.id)).rejects.toThrow();
  }

  it('cancels the order, the vendor order AND the pre-pickup delivery', async () => {
    const vendor = await makeVendor();
    const order = await makeOrder(vendor);

    await failAuthorization(order);

    expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: order.orderId } })).status).toBe('CANCELLED');
    expect((await ctx.prisma.vendorOrder.findUniqueOrThrow({ where: { id: order.vendorOrderId } })).status).toBe('CANCELLED');

    const d = await deliveryOf(order.deliveryId);
    expect(d.status).toBe('CANCELLED');
    // The two fields that decide whether dispatch can still reach it.
    expect(d.readyForDispatchAt).toBeNull();
    expect(d.offerExpiresAt).toBeNull();
    expect(d.assignedDriverProfileId).toBeNull();
    expect(d.cancelledAt).not.toBeNull();
  });

  it('leaves nothing the dispatch engine can pick up, by either route', async () => {
    const vendor = await makeVendor();
    const order = await makeOrder(vendor);
    await makeDriver(); // an eligible driver is standing by
    await failAuthorization(order);

    // Direct dispatch refuses it...
    expect((await engine.dispatch(order.deliveryId)).result).toBe('SKIPPED');
    // ...and the safety-net sweep does not find it at all.
    await engine.sweepUndispatched();
    const d = await deliveryOf(order.deliveryId);
    expect(d.status).toBe('CANCELLED');
    expect(d.assignedDriverProfileId).toBeNull();

    // It is not in anyone's queue or feed either.
    const driver = await makeDriver();
    expect((await get(driver.cookies, 'driver/jobs/queue')).body.items).toHaveLength(0);
    for (const scope of ['available', 'assigned', 'active', 'completed']) {
      expect((await get(driver.cookies, `driver/jobs?scope=${scope}`)).body, scope).toHaveLength(0);
    }
  });

  it('does NOT rewrite a delivery whose goods have already been collected', async () => {
    // The guard that stops this cleanup path being used to erase work in
    // progress. Payment failure happens long before pickup in practice, so this
    // asserts the guard rather than a reachable flow.
    const vendor = await makeVendor();
    const order = await makeOrder(vendor);
    const driver = await makeDriver();
    expect((await engine.dispatch(order.deliveryId)).result).toBe('ASSIGNED');
    await post(driver.cookies, `driver/jobs/${order.deliveryId}/accept`);
    const pins = await ctx.prisma.orderDelivery.findUniqueOrThrow({
      where: { id: order.deliveryId },
      select: { pickupPin: true },
    });
    await post(driver.cookies, `driver/jobs/${order.deliveryId}/confirm-pickup`, { pin: pins.pickupPin });
    expect((await deliveryOf(order.deliveryId)).status).toBe('PICKUP_CONFIRMED');

    await failAuthorization(order);

    const d = await deliveryOf(order.deliveryId);
    expect(d.status).toBe('PICKUP_CONFIRMED'); // untouched
    expect(d.assignedDriverProfileId).toBe(driver.driverProfileId);
    expect(d.cancelledAt).toBeNull();
  });
});

/* ================= PART 11 — DRIVER PRIVACY AND OWNERSHIP ================ */

describe('Part 11 — what a driver may see and do', () => {
  it('keeps PINs out of every driver-facing payload', async () => {
    const vendor = await makeVendor();
    const order = await makeOrder(vendor);
    const driver = await makeDriver();
    expect((await engine.dispatch(order.deliveryId)).result).toBe('ASSIGNED');
    await post(driver.cookies, `driver/jobs/${order.deliveryId}/accept`);

    const row = await ctx.prisma.orderDelivery.findUniqueOrThrow({
      where: { id: order.deliveryId },
      select: { pickupPin: true, deliveryPin: true },
    });

    for (const path of [`driver/jobs/${order.deliveryId}`, 'driver/jobs?scope=assigned', 'driver/jobs/queue']) {
      const body = (await get(driver.cookies, path)).body;
      expect(pinLeaks(body, [row.pickupPin!, row.deliveryPin!]), path).toEqual([]);
    }

    // The driver is told a code is REQUIRED, never what it is.
    const detail = (await get(driver.cookies, `driver/jobs/${order.deliveryId}`)).body;
    expect(detail.requiresPickupPin).toBe(true);
    expect(detail).not.toHaveProperty('pickupPin');
    expect(detail).not.toHaveProperty('deliveryPin');
  });

  it('gives an accepting driver the fulfilment details they need', async () => {
    const vendor = await makeVendor();
    const order = await makeOrder(vendor);
    const driver = await makeDriver();
    expect((await engine.dispatch(order.deliveryId)).result).toBe('ASSIGNED');
    await post(driver.cookies, `driver/jobs/${order.deliveryId}/accept`);

    const body = (await get(driver.cookies, `driver/jobs/${order.deliveryId}`)).body;
    expect(body.deliveryAddress.fullName).toBe(CUSTOMER_NAME);
    expect(body.deliveryAddress.addressLine1).toBe(CUSTOMER_STREET);
    expect(body.deliveryAddress.phone).toBe(CUSTOMER_PHONE);
  });

  it('never leaks customer PII through the LIST or QUEUE, at any stage', async () => {
    // The list is the screen a driver browses before deciding. Whatever the
    // detail view exposes to an assignee, the feed must stay area-only.
    const vendor = await makeVendor();
    const order = await makeOrder(vendor);
    const driver = await makeDriver();
    expect((await engine.dispatch(order.deliveryId)).result).toBe('ASSIGNED');

    for (const path of ['driver/jobs?scope=available', 'driver/jobs/queue']) {
      const payload = JSON.stringify((await get(driver.cookies, path)).body);
      expect(payload, path).not.toContain(CUSTOMER_NAME);
      expect(payload, path).not.toContain(CUSTOMER_PHONE);
      expect(payload, path).not.toContain(CUSTOMER_STREET);
      expect(payload, path).toContain('Belize City'); // area IS provided
    }

    await post(driver.cookies, `driver/jobs/${order.deliveryId}/accept`);
    for (const path of ['driver/jobs?scope=assigned', 'driver/jobs/queue']) {
      const payload = JSON.stringify((await get(driver.cookies, path)).body);
      expect(payload, path).not.toContain(CUSTOMER_PHONE);
      expect(payload, path).not.toContain(CUSTOMER_STREET);
    }
  });

  it('refuses a queue reorder that names another driver’s delivery, and writes nothing', async () => {
    const vendor = await makeVendor();
    const mineOrder = await makeOrder(vendor);
    const theirsOrder = await makeOrder(vendor);
    const me = await makeDriver();
    expect((await engine.dispatch(mineOrder.deliveryId)).result).toBe('ASSIGNED');
    await post(me.cookies, `driver/jobs/${mineOrder.deliveryId}/accept`);

    await ctx.prisma.driverProfile.updateMany({ data: { availability: 'OFFLINE' } });
    const them = await makeDriver();
    expect((await engine.dispatch(theirsOrder.deliveryId)).result).toBe('ASSIGNED');
    await post(them.cookies, `driver/jobs/${theirsOrder.deliveryId}/accept`);

    const res = await put(me.cookies, 'driver/jobs/queue', {
      deliveryIds: [theirsOrder.deliveryId, mineOrder.deliveryId],
    });
    expect(res.status).toBe(404);

    const rows = await ctx.prisma.orderDelivery.findMany({
      where: { id: { in: [mineOrder.deliveryId, theirsOrder.deliveryId] } },
      select: { id: true, driverQueuePosition: true, assignedDriverProfileId: true, status: true },
    });
    // Nothing written — not even to the caller's own row.
    expect(rows.every((r) => r.driverQueuePosition === null)).toBe(true);
    expect(rows.find((r) => r.id === theirsOrder.deliveryId)!.assignedDriverProfileId).toBe(them.driverProfileId);
  });

  it('cannot reorder completed work', async () => {
    const vendor = await makeVendor();
    const order = await makeOrder(vendor);
    const driver = await makeDriver();
    expect((await engine.dispatch(order.deliveryId)).result).toBe('ASSIGNED');
    await post(driver.cookies, `driver/jobs/${order.deliveryId}/accept`);
    const pins = await ctx.prisma.orderDelivery.findUniqueOrThrow({
      where: { id: order.deliveryId },
      select: { pickupPin: true, deliveryPin: true },
    });
    await post(driver.cookies, `driver/jobs/${order.deliveryId}/confirm-pickup`, { pin: pins.pickupPin });
    await post(driver.cookies, `driver/jobs/${order.deliveryId}/in-transit`);
    await post(driver.cookies, `driver/jobs/${order.deliveryId}/arriving`);
    await post(driver.cookies, `driver/jobs/${order.deliveryId}/confirm-delivery`, { pin: pins.deliveryPin, recipientName: 'R' });

    // DELIVERED is outside the open set, so it is not "in your queue" at all.
    expect((await put(driver.cookies, 'driver/jobs/queue', { deliveryIds: [order.deliveryId] })).status).toBe(404);
    expect((await deliveryOf(order.deliveryId)).status).toBe('DELIVERED');
  });

  it('a reorder changes position and nothing else about the delivery', async () => {
    const vendor = await makeVendor();
    const first = await makeOrder(vendor);
    const second = await makeOrder(vendor);
    const driver = await makeDriver();
    for (const o of [first, second]) {
      expect((await engine.dispatch(o.deliveryId)).result).toBe('ASSIGNED');
      await post(driver.cookies, `driver/jobs/${o.deliveryId}/accept`);
    }

    const before = await ctx.prisma.orderDelivery.findMany({
      where: { id: { in: [first.deliveryId, second.deliveryId] } },
      orderBy: { id: 'asc' },
      select: {
        id: true, status: true, assignedDriverProfileId: true, assignedVehicleId: true, acceptedAt: true,
        feeMinor: true, vendorOrderId: true, pickupPin: true, deliveryPin: true, pickupVerificationStatus: true,
      },
    });
    const timelineBefore = await ctx.prisma.deliveryTimelineEvent.count({
      where: { orderDeliveryId: { in: [first.deliveryId, second.deliveryId] } },
    });

    expect((await put(driver.cookies, 'driver/jobs/queue', { deliveryIds: [second.deliveryId, first.deliveryId] })).status).toBe(200);

    const after = await ctx.prisma.orderDelivery.findMany({
      where: { id: { in: [first.deliveryId, second.deliveryId] } },
      orderBy: { id: 'asc' },
      select: {
        id: true, status: true, assignedDriverProfileId: true, assignedVehicleId: true, acceptedAt: true,
        feeMinor: true, vendorOrderId: true, pickupPin: true, deliveryPin: true, pickupVerificationStatus: true,
      },
    });
    expect(after).toEqual(before);
    // Reordering is not a lifecycle event and must not write one.
    expect(
      await ctx.prisma.deliveryTimelineEvent.count({ where: { orderDeliveryId: { in: [first.deliveryId, second.deliveryId] } } }),
    ).toBe(timelineBefore);
    // And it moves no money.
    expect(await ctx.prisma.driverEarning.count()).toBe(0);
  });

  it('an unrelated driver cannot discover a delivery thread', async () => {
    const vendor = await makeVendor();
    const order = await makeOrder(vendor);
    const holder = await makeDriver();
    expect((await engine.dispatch(order.deliveryId)).result).toBe('ASSIGNED');
    await post(holder.cookies, `driver/jobs/${order.deliveryId}/accept`);

    const convs = await conversationsFor(order.deliveryId);
    expect(convs.length).toBeGreaterThan(0);

    const stranger = await makeDriver();
    for (const c of convs) {
      expect((await get(stranger.cookies, `conversations/${c.id}`)).status).toBe(404);
      expect((await post(stranger.cookies, `conversations/${c.id}/messages`, { body: 'hello' })).status).toBe(404);
    }
  });

  it('a driver who was only OFFERED the job is never enrolled in its threads', async () => {
    const vendor = await makeVendor();
    const order = await makeOrder(vendor);
    const offered = await makeDriver();
    expect((await engine.dispatch(order.deliveryId)).result).toBe('ASSIGNED');

    // Threads open on ACCEPTANCE, not assignment (c1a34b4).
    expect(await conversationsFor(order.deliveryId)).toHaveLength(0);

    const taker = await makeDriver();
    await post(offered.cookies, `driver/jobs/${order.deliveryId}/decline`, { reason: 'No' });
    await post(taker.cookies, `driver/jobs/${order.deliveryId}/accept`);

    const convs = await conversationsFor(order.deliveryId);
    expect(convs.length).toBeGreaterThan(0);
    for (const c of convs) {
      expect(c.participants.some((p) => p.userId === offered.userId)).toBe(false);
      expect((await get(offered.cookies, `conversations/${c.id}`)).status).toBe(404);
    }
  });
});

/* ============ PART 11 (cont.) — PII BEFORE vs AFTER ACCEPTANCE =========== */

describe('Part 11 — the customer’s details are earned by accepting', () => {
  it('withholds name, phone and street from a driver who has only been OFFERED the job', async () => {
    // Automatic dispatch offers ONE delivery to up to five drivers in turn. If
    // being offered a job handed over the customer's full name, phone number and
    // street address, a single order would spread that to five strangers who
    // never took it and have no relationship with the customer. The AREA is what
    // a driver needs to judge the job; the rest is fulfilment data.
    const vendor = await makeVendor();
    const order = await makeOrder(vendor);
    const driver = await makeDriver();
    expect((await engine.dispatch(order.deliveryId)).result).toBe('ASSIGNED');

    const offered = await get(driver.cookies, `driver/jobs/${order.deliveryId}`);
    expect(offered.status).toBe(200);
    const payload = JSON.stringify(offered.body);
    expect(payload).not.toContain(CUSTOMER_NAME);
    expect(payload).not.toContain(CUSTOMER_PHONE);
    expect(payload).not.toContain(CUSTOMER_STREET);
    // Enough to decide: where it is going, and what it is worth.
    expect(offered.body.deliveryAddress.city).toBe('Belize City');
    expect(offered.body.deliveryAddress.district).toBe('BELIZE');
    expect(offered.body.feeMinor).toBe(500);

    // Accepting is what unlocks the rest.
    expect((await post(driver.cookies, `driver/jobs/${order.deliveryId}/accept`)).status).toBe(201);
    const accepted = await get(driver.cookies, `driver/jobs/${order.deliveryId}`);
    expect(accepted.body.deliveryAddress.fullName).toBe(CUSTOMER_NAME);
    expect(accepted.body.deliveryAddress.phone).toBe(CUSTOMER_PHONE);
    expect(accepted.body.deliveryAddress.addressLine1).toBe(CUSTOMER_STREET);
  });

  it('takes the details back from a driver who declined', async () => {
    const vendor = await makeVendor();
    const order = await makeOrder(vendor);
    const a = await makeDriver();
    expect((await engine.dispatch(order.deliveryId)).result).toBe('ASSIGNED');
    await post(a.cookies, `driver/jobs/${order.deliveryId}/accept`);
    // A has the details at this point.
    expect((await get(a.cookies, `driver/jobs/${order.deliveryId}`)).body.deliveryAddress.phone).toBe(CUSTOMER_PHONE);

    const b = await makeDriver();
    // An admin moves the job on — the realistic way an accepted job leaves a driver.
    expect(
      (await post(adminCookies, `admin/deliveries/${order.deliveryId}/reassign`, {
        driverProfileId: b.driverProfileId,
        vehicleId: b.vehicleId,
        reason: 'Driver unreachable',
      })).status,
    ).toBe(201);

    // The job is no longer A's, so neither is the customer.
    expect((await get(a.cookies, `driver/jobs/${order.deliveryId}`)).status).toBe(404);
    // And B, holding only an unanswered offer, gets the area — not the person.
    const bView = await get(b.cookies, `driver/jobs/${order.deliveryId}`);
    expect(bView.status).toBe(200);
    expect(bView.body.addressUnlocked).toBe(false);
    expect(JSON.stringify(bView.body)).not.toContain(CUSTOMER_PHONE);
  });

  it('keeps the address locked when a declined job comes back round to the same driver', async () => {
    // Dispatch ranks a driver who already passed LAST, but does not drop them —
    // a job everyone declined can still return. When it does it is a fresh
    // OFFER, so the details stay locked however many times it cycles.
    const vendor = await makeVendor();
    const order = await makeOrder(vendor);
    const only = await makeDriver();
    expect((await engine.dispatch(order.deliveryId)).result).toBe('ASSIGNED');
    expect((await get(only.cookies, `driver/jobs/${order.deliveryId}`)).body.addressUnlocked).toBe(false);

    expect((await post(only.cookies, `driver/jobs/${order.deliveryId}/decline`, { reason: 'Not now' })).status).toBe(201);

    const after = await get(only.cookies, `driver/jobs/${order.deliveryId}`);
    if (after.status === 200) {
      expect(after.body.addressUnlocked).toBe(false);
      expect(JSON.stringify(after.body)).not.toContain(CUSTOMER_PHONE);
      expect(JSON.stringify(after.body)).not.toContain(CUSTOMER_STREET);
    } else {
      expect(after.status).toBe(404);
    }
  });

  it('will not let a driver decline work they already accepted', async () => {
    // The lifecycle rule behind the previous test: DECLINE is legal only from
    // ASSIGNED. Walking away from an accepted job is an admin reassignment, so a
    // driver cannot quietly hand back a delivery a customer is waiting on.
    const vendor = await makeVendor();
    const order = await makeOrder(vendor);
    const driver = await makeDriver();
    expect((await engine.dispatch(order.deliveryId)).result).toBe('ASSIGNED');
    await post(driver.cookies, `driver/jobs/${order.deliveryId}/accept`);

    const res = await post(driver.cookies, `driver/jobs/${order.deliveryId}/decline`, { reason: 'Changed my mind' });
    expect(res.status).toBe(400);
    const d = await deliveryOf(order.deliveryId);
    expect(d.status).toBe('DRIVER_ACCEPTED');
    expect(d.assignedDriverProfileId).toBe(driver.driverProfileId);
  });
});
