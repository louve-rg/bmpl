/**
 * Driver delivery VIEWS + QUEUE (M26.3 client feedback) — integration vs real
 * Postgres.
 *
 * The client asked My Deliveries for Assigned / Available / Active / Completed
 * and for a reorderable multi-delivery queue. Both are presentation layers over
 * the existing delivery state machine, and the risk in both is the same: that a
 * display concern quietly becomes an authorization or lifecycle change. So this
 * suite spends most of its assertions on what must NOT happen — a driver seeing
 * another driver's work, an unaccepted offer being treated as assigned work, a
 * reorder touching status or ownership.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let adminCookies: string[];
let categoryId: string;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;

const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: unknown = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const put = (c: string[], p: string, b: unknown = {}) => request(ctx.server).put(`/api/${p}`).set('Cookie', c).send(b);

async function registerCustomer(email: string): Promise<{ cookies: string[]; userId: string }> {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

interface Vendor {
  vendorProfileId: string;
  productId: string;
  inventoryId: string;
}
async function makeVendor(district = 'BELIZE'): Promise<Vendor> {
  const s = uniq();
  const { userId } = await registerCustomer(`qvend_${s}@example.bz`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'VENDOR' } },
    create: { userId, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const vp = await ctx.prisma.vendorProfile.create({
    data: {
      userId,
      businessName: `Queue Store ${s}`,
      slug: `queue-store-${s}`,
      contactEmail: `qv${s}@x.bz`,
      approvalStatus: 'APPROVED',
      storeStatus: 'OPEN',
      settings: { create: { deliveryEnabled: true, pickupEnabled: true } },
      locations: {
        create: { label: 'Main', addressLine1: '1 St', city: 'Belize City', district: district as never, isPrimary: true },
      },
    },
  });
  const product = await ctx.prisma.product.create({
    data: {
      vendorProfileId: vp.id,
      categoryId,
      title: `QProd ${s}`,
      slug: `qprod-${s}`,
      sku: `QSKU-${s}`,
      status: 'PUBLISHED',
      priceMinor: 1000n,
      currency: 'BZD',
      inventory: { create: { quantity: 50, reserved: 0 } },
    },
  });
  const inv = await ctx.prisma.inventory.findFirstOrThrow({ where: { productId: product.id } });
  return { vendorProfileId: vp.id, productId: product.id, inventoryId: inv.id };
}

async function makeDelivery(vendor: Vendor, district = 'BELIZE'): Promise<string> {
  const s = uniq();
  const { userId: customerId } = await registerCustomer(`qcust_${s}@example.bz`);
  await ctx.prisma.inventory.update({ where: { id: vendor.inventoryId }, data: { reserved: { increment: 1 } } });
  const num = `QORD-${s}`;
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
          fullName: 'Cust Omer',
          phone: '+5017770000',
          addressLine1: '5 Ave',
          city: 'Belize City',
          district: district as never,
        },
      },
      vendorOrders: {
        create: {
          orderNumber: `${num}-1`,
          vendorProfileId: vendor.vendorProfileId,
          status: 'PENDING',
          deliveryMethod: 'DELIVERY',
          itemCount: 1,
          subtotalMinor: 1000n,
          items: { create: { productId: vendor.productId, productTitle: 'QProd', unitPriceMinor: 1000n, quantity: 1, subtotalMinor: 1000n } },
          delivery: { create: { status: 'PENDING_ASSIGNMENT', feeMinor: 500n } },
        },
      },
    },
    include: { vendorOrders: { include: { delivery: true } } },
  });
  return order.vendorOrders[0]!.delivery!.id;
}

interface Driver {
  cookies: string[];
  userId: string;
  driverProfileId: string;
  vehicleId: string;
}
async function makeDriver(districts: string[] = ['BELIZE']): Promise<Driver> {
  const s = uniq();
  const { cookies, userId } = await registerCustomer(`qdrv_${s}@example.bz`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId,
      legalName: 'D River',
      displayName: `QDrv${s}`,
      phone: '+5016000000',
      homeDistrict: 'BELIZE',
      licenceNumber: `QDL-${s}`,
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
      licencePlate: `QZ-${s}`.slice(0, 18),
      registrationExpiry: FUTURE,
      insuranceExpiry: FUTURE,
      isActive: true,
      isPrimary: true,
      approvalStatus: 'APPROVED',
    },
  });
  for (const d of districts) {
    await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: d as never, isActive: true } });
  }
  return { cookies, userId, driverProfileId: profile.id, vehicleId: vehicle.id };
}

/** Admin-assign a fresh delivery to `driver`, leaving it as an unanswered OFFER. */
async function offerTo(driver: Driver, district = 'BELIZE'): Promise<string> {
  const vendor = await makeVendor(district);
  const deliveryId = await makeDelivery(vendor, district);
  const res = await post(adminCookies, `admin/deliveries/${deliveryId}/assign`, {
    driverProfileId: driver.driverProfileId,
    vehicleId: driver.vehicleId,
  });
  expect(res.status).toBe(201);
  return deliveryId;
}

/** Offer + accept — the driver now HAS the job but has not collected it. */
async function acceptedBy(driver: Driver, district = 'BELIZE'): Promise<string> {
  const deliveryId = await offerTo(driver, district);
  expect((await post(driver.cookies, `driver/jobs/${deliveryId}/accept`)).status).toBe(201);
  return deliveryId;
}

/** Accepted + collected — the job is on the road. */
async function pickedUpBy(driver: Driver, district = 'BELIZE'): Promise<string> {
  const deliveryId = await acceptedBy(driver, district);
  const row = await ctx.prisma.orderDelivery.findUniqueOrThrow({ where: { id: deliveryId }, select: { pickupPin: true } });
  const res = await post(driver.cookies, `driver/jobs/${deliveryId}/confirm-pickup`, { pin: row.pickupPin });
  expect(res.status).toBe(201);
  return deliveryId;
}

const ids = (body: Array<{ id: string }>) => body.map((j) => j.id).sort();

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  const res = await request(ctx.server).post('/api/auth/login').send({ email: admin.email, password: admin.password });
  expect(res.status).toBe(201);
  adminCookies = cookiesOf(res);
  const cat = await ctx.prisma.category.create({ data: { name: 'Queue', slug: `queue-${uniq()}` } });
  categoryId = cat.id;
});
afterAll(async () => {
  await ctx.app.close();
});

/* ------------------------------------------------------------- the views */

describe('driver delivery views', () => {
  it('puts an unanswered offer in AVAILABLE and nowhere else', async () => {
    const driver = await makeDriver();
    const offered = await offerTo(driver);

    const available = await get(driver.cookies, 'driver/jobs?scope=available');
    expect(available.status).toBe(200);
    expect(ids(available.body)).toContain(offered);
    expect(available.body[0].view).toBe('available');

    for (const scope of ['assigned', 'active', 'completed']) {
      const res = await get(driver.cookies, `driver/jobs?scope=${scope}`);
      expect(ids(res.body), scope).not.toContain(offered);
    }
  });

  it('moves a job from AVAILABLE to ASSIGNED the moment it is accepted', async () => {
    const driver = await makeDriver();
    const id = await acceptedBy(driver);

    expect(ids((await get(driver.cookies, 'driver/jobs?scope=available')).body)).not.toContain(id);
    const assigned = await get(driver.cookies, 'driver/jobs?scope=assigned');
    expect(ids(assigned.body)).toContain(id);
    expect(assigned.body.find((j: { id: string }) => j.id === id).view).toBe('assigned');
  });

  it('moves a job to ACTIVE once it is collected', async () => {
    const driver = await makeDriver();
    const id = await pickedUpBy(driver);

    expect(ids((await get(driver.cookies, 'driver/jobs?scope=assigned')).body)).not.toContain(id);
    const active = await get(driver.cookies, 'driver/jobs?scope=active');
    expect(ids(active.body)).toContain(id);
    expect(active.body.find((j: { id: string }) => j.id === id).view).toBe('active');
  });

  it('lands a delivered job in COMPLETED', async () => {
    const driver = await makeDriver();
    const id = await pickedUpBy(driver);
    expect((await post(driver.cookies, `driver/jobs/${id}/in-transit`)).status).toBe(201);
    expect((await post(driver.cookies, `driver/jobs/${id}/arriving`)).status).toBe(201);
    const row = await ctx.prisma.orderDelivery.findUniqueOrThrow({ where: { id }, select: { deliveryPin: true } });
    expect((await post(driver.cookies, `driver/jobs/${id}/confirm-delivery`, { pin: row.deliveryPin, recipientName: 'Test Recipient' })).status).toBe(201);

    const completed = await get(driver.cookies, 'driver/jobs?scope=completed');
    expect(ids(completed.body)).toContain(id);
    expect(ids((await get(driver.cookies, 'driver/jobs?scope=active')).body)).not.toContain(id);
  });

  it('counts each job under exactly one view', async () => {
    const driver = await makeDriver();
    await offerTo(driver);
    await acceptedBy(driver);
    await pickedUpBy(driver);

    const counts = await get(driver.cookies, 'driver/jobs/counts');
    expect(counts.status).toBe(200);
    expect(counts.body).toMatchObject({ available: 1, assigned: 1, active: 1, completed: 0 });
  });

  it('falls back to every open job for an unknown scope, so an older client still works', async () => {
    const driver = await makeDriver();
    const offered = await offerTo(driver);
    const accepted = await acceptedBy(driver);
    const res = await get(driver.cookies, 'driver/jobs?scope=not-a-scope');
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual([offered, accepted].sort());
  });

  it('never shows one driver another driver’s work', async () => {
    const a = await makeDriver();
    const b = await makeDriver();
    const aJob = await acceptedBy(a);

    for (const scope of ['available', 'assigned', 'active', 'completed']) {
      expect(ids((await get(b.cookies, `driver/jobs?scope=${scope}`)).body), scope).not.toContain(aJob);
    }
    expect((await get(b.cookies, `driver/jobs/${aJob}`)).status).toBe(404);
  });

  it('exposes the destination AREA but no customer name, phone or street in the list', async () => {
    const driver = await makeDriver();
    await offerTo(driver);
    const res = await get(driver.cookies, 'driver/jobs?scope=available');
    const job = res.body[0];
    expect(job.city).toBe('Belize City');
    expect(job.district).toBe('BELIZE');
    const serialized = JSON.stringify(job);
    expect(serialized).not.toContain('Cust Omer');
    expect(serialized).not.toContain('+5017770000');
    expect(serialized).not.toContain('5 Ave');
    // Coordinates are read server-side for routing and must not leave the API.
    expect(job).not.toHaveProperty('latitude');
    expect(job).not.toHaveProperty('longitude');
  });
});

/* -------------------------------------------------------------- the queue */

describe('delivery queue + route recommendation', () => {
  it('returns one queue entry per open delivery with a next action and a stop', async () => {
    const driver = await makeDriver(['BELIZE', 'CAYO']);
    const collect = await acceptedBy(driver);
    const drop = await pickedUpBy(driver, 'CAYO');

    const res = await get(driver.cookies, 'driver/jobs/queue');
    expect(res.status).toBe(200);
    expect(ids(res.body.items)).toEqual([collect, drop].sort());

    const collectItem = res.body.items.find((i: { id: string }) => i.id === collect);
    const dropItem = res.body.items.find((i: { id: string }) => i.id === drop);
    // The lifecycle guarantee: a job contributes its STORE until collected and
    // its CUSTOMER after, so a drop-off can never be routed before its pickup.
    expect(collectItem.stopKind).toBe('PICKUP');
    expect(dropItem.stopKind).toBe('DROPOFF');
    expect(collectItem.nextAction.kind).toBe('CONFIRM_PICKUP');
    expect(dropItem.nextAction.kind).toBe('IN_TRANSIT');
  });

  it('recommends an order over exactly the routable jobs, and labels the estimate', async () => {
    const driver = await makeDriver(['BELIZE', 'CAYO']);
    const a = await acceptedBy(driver);
    const b = await acceptedBy(driver, 'CAYO');
    const offered = await offerTo(driver);

    const res = await get(driver.cookies, 'driver/jobs/queue');
    expect(res.body.route.recommendedOrder.sort()).toEqual([a, b].sort());
    // An unaccepted offer is visible but NOT routed — it is not yet the driver's
    // work to plan around.
    expect(res.body.route.recommendedOrder).not.toContain(offered);
    expect(res.body.items.find((i: { id: string }) => i.id === offered).recommendedPosition).toBeNull();
    // No live traffic data exists, and the payload must say so.
    expect(res.body.route.disclosure).toMatch(/not live traffic|unavailable/i);
    expect(['EXACT', 'DISTRICT', 'UNKNOWN']).toContain(res.body.route.precision);
  });

  it('excludes completed and cancelled deliveries from the queue', async () => {
    const driver = await makeDriver();
    const open = await acceptedBy(driver);
    const cancelled = await offerTo(driver);
    expect((await post(adminCookies, `admin/deliveries/${cancelled}/cancel`, { reason: 'test cancellation' })).status).toBe(201);

    const res = await get(driver.cookies, 'driver/jobs/queue');
    expect(ids(res.body.items)).toEqual([open]);
  });
});

/* ------------------------------------------------------------- reordering */

describe('queue reordering', () => {
  it('persists the driver’s order without touching status or ownership', async () => {
    const driver = await makeDriver();
    const first = await acceptedBy(driver);
    const second = await acceptedBy(driver);

    const before = await ctx.prisma.orderDelivery.findMany({
      where: { id: { in: [first, second] } },
      select: { id: true, status: true, assignedDriverProfileId: true, acceptedAt: true },
      orderBy: { id: 'asc' },
    });

    const res = await put(driver.cookies, 'driver/jobs/queue', { deliveryIds: [second, first] });
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([second, first]);

    const after = await ctx.prisma.orderDelivery.findMany({
      where: { id: { in: [first, second] } },
      select: { id: true, status: true, assignedDriverProfileId: true, acceptedAt: true, driverQueuePosition: true },
      orderBy: { id: 'asc' },
    });
    // ONLY driverQueuePosition changed.
    expect(after.map(({ driverQueuePosition, ...rest }) => rest)).toEqual(before);
    expect(after.find((d) => d.id === second)!.driverQueuePosition).toBe(1);
    expect(after.find((d) => d.id === first)!.driverQueuePosition).toBe(2);
  });

  it('orders the list endpoint by the driver’s queue position', async () => {
    const driver = await makeDriver();
    const first = await acceptedBy(driver);
    const second = await acceptedBy(driver);
    expect((await put(driver.cookies, 'driver/jobs/queue', { deliveryIds: [second, first] })).status).toBe(200);

    const listed = await get(driver.cookies, 'driver/jobs?scope=assigned');
    expect(listed.body.map((j: { id: string }) => j.id)).toEqual([second, first]);
  });

  it('refuses to reorder another driver’s delivery, and changes nothing', async () => {
    const a = await makeDriver();
    const b = await makeDriver();
    const mine = await acceptedBy(b);
    const theirs = await acceptedBy(a);

    // 404, not 403 — a driver must not be able to probe which ids exist.
    const res = await put(b.cookies, 'driver/jobs/queue', { deliveryIds: [theirs, mine] });
    expect(res.status).toBe(404);

    const rows = await ctx.prisma.orderDelivery.findMany({
      where: { id: { in: [mine, theirs] } },
      select: { id: true, driverQueuePosition: true },
    });
    expect(rows.every((r) => r.driverQueuePosition === null)).toBe(true);
  });

  it('refuses to reorder an offer the driver has not accepted', async () => {
    const driver = await makeDriver();
    const accepted = await acceptedBy(driver);
    const offered = await offerTo(driver);

    const res = await put(driver.cookies, 'driver/jobs/queue', { deliveryIds: [offered, accepted] });
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toMatch(/accept this offer/i);
  });

  it('rejects a duplicated id rather than writing an ambiguous order', async () => {
    const driver = await makeDriver();
    const id = await acceptedBy(driver);
    const res = await put(driver.cookies, 'driver/jobs/queue', { deliveryIds: [id, id] });
    expect(res.status).toBe(400);
  });

  it('is closed to a non-driver', async () => {
    const { cookies } = await registerCustomer(`qshopper_${uniq()}@example.bz`);
    expect((await get(cookies, 'driver/jobs/queue')).status).toBe(403);
    expect((await put(cookies, 'driver/jobs/queue', { deliveryIds: [] })).status).toBe(403);
  });

  it('records an audit row for the reorder', async () => {
    const driver = await makeDriver();
    const first = await acceptedBy(driver);
    const second = await acceptedBy(driver);
    expect((await put(driver.cookies, 'driver/jobs/queue', { deliveryIds: [second, first] })).status).toBe(200);

    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'DRIVER_QUEUE_REORDERED', actorId: driver.userId },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
  });
});
