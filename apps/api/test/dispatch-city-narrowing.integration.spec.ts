/**
 * BMPL-194: dispatch honours a driver's declared city, not just district.
 *
 * The declaration side already existed (DriverServiceCity — BMPL-176): a
 * driver narrows a district they serve down to specific free-text places.
 * Dispatch never checked it — matching stayed district-only, so a driver who
 * declared "San Pedro only" was still offered Belize City work, because both
 * share the Belize District. This proves the fix on BOTH dispatch surfaces
 * that funnel through DriverService.eligibleDriversForDistrict /
 * assignmentEligibility: marketplace delivery dispatch and shipment
 * courier-leg dispatch.
 *
 * Real Belize places only (root CLAUDE.md §5 — no fabricated geography):
 * Belize City and San Pedro, both in the Belize District, both already used
 * elsewhere in this suite (dispatch-engine.integration.spec.ts,
 * shipment-hub-hours-dispatch.integration.spec.ts).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';
import { DispatchEngineService } from '../src/dispatch/dispatch-engine.service';
import { ShipmentDispatchService } from '../src/shipping/shipment-dispatch.service';

let ctx: TestContext;
let engine: DispatchEngineService;
let shipmentDispatch: ShipmentDispatchService;
let adminCookies: string[];
let categoryId: string;
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);

async function registerCustomer(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

async function makeVendor() {
  const s = uniq();
  const { userId } = await registerCustomer(`vend_${s}@example.bz`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'VENDOR' } },
    create: { userId, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const vp = await ctx.prisma.vendorProfile.create({
    data: {
      userId,
      businessName: `Store ${s}`,
      slug: `store-${s}`,
      contactEmail: `v${s}@x.bz`,
      approvalStatus: 'APPROVED',
      storeStatus: 'OPEN',
      settings: { create: { deliveryEnabled: true, pickupEnabled: true } },
      locations: { create: { label: 'Main', addressLine1: '1 St', city: 'Belize City', district: 'BELIZE', isPrimary: true } },
    },
  });
  const product = await ctx.prisma.product.create({
    data: { vendorProfileId: vp.id, categoryId, title: `Prod ${s}`, slug: `prod-${s}`, sku: `SKU-${s}`, status: 'PUBLISHED', priceMinor: 1000n, currency: 'BZD', inventory: { create: { quantity: 10, reserved: 0 } } },
  });
  return { vendorProfileId: vp.id, productId: product.id };
}

/** A ready-to-dispatch delivery to a chosen district/city. */
async function readyDelivery(vendor: { vendorProfileId: string; productId: string }, opts: { district?: string; city?: string } = {}) {
  const district = opts.district ?? 'BELIZE';
  const city = opts.city ?? 'Belize City';
  const s = uniq();
  const { userId: customerId } = await registerCustomer(`cust_${s}@example.bz`);
  const num = `ORD-${s}`;
  const order = await ctx.prisma.order.create({
    data: {
      orderNumber: num,
      userId: customerId,
      status: 'PENDING',
      itemCount: 1,
      subtotalMinor: 1000n,
      deliveryFeeMinor: 500n,
      totalMinor: 1500n,
      addresses: { create: { type: 'SHIPPING', fullName: 'Cust Omer', addressLine1: '5 Ave', city, district: district as never } },
      vendorOrders: {
        create: {
          orderNumber: `${num}-1`,
          vendorProfileId: vendor.vendorProfileId,
          status: 'READY_FOR_PICKUP',
          readyForPickupAt: new Date(),
          deliveryMethod: 'DELIVERY',
          itemCount: 1,
          subtotalMinor: 1000n,
          items: { create: { productId: vendor.productId, productTitle: 'Prod', unitPriceMinor: 1000n, quantity: 1, subtotalMinor: 1000n } },
          delivery: { create: { status: 'PENDING_ASSIGNMENT', feeMinor: 500n, readyForDispatchAt: new Date() } },
        },
      },
    },
    include: { vendorOrders: { include: { delivery: true } } },
  });
  return { deliveryId: order.vendorOrders[0]!.delivery!.id, customerId };
}

/** A driver serving `district`, optionally narrowed to specific cities within it. */
async function makeDriver(opts: { district?: string; cities?: string[] } = {}) {
  const district = opts.district ?? 'BELIZE';
  const s = uniq();
  const { userId } = await registerCustomer(`drv_${s}@example.bz`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId,
      legalName: 'D River',
      displayName: `Drv${s}`,
      phone: '+5016000000',
      homeDistrict: district as never,
      licenceNumber: `DL-${s}`,
      licenceExpiry: FUTURE,
      vehicleOwnership: 'OWNED',
      availability: 'ONLINE',
      isActive: true,
    },
  });
  await ctx.prisma.driverVehicle.create({
    data: {
      driverProfileId: profile.id,
      type: 'CAR',
      make: 'Toyota',
      model: 'Corolla',
      licencePlate: `BZ-${s}`.slice(0, 18),
      registrationExpiry: FUTURE,
      insuranceExpiry: FUTURE,
      isActive: true,
      isPrimary: true,
      approvalStatus: 'APPROVED',
    },
  });
  await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: district as never, isActive: true } });
  for (const city of opts.cities ?? []) {
    await ctx.prisma.driverServiceCity.create({ data: { driverProfileId: profile.id, district: district as never, city, isActive: true } });
  }
  return { userId, driverProfileId: profile.id };
}

async function enableDispatch(over: Record<string, unknown> = {}) {
  const existing = await ctx.prisma.platformSetting.findFirst();
  const data = {
    dispatchAutomatic: true,
    dispatchOfferTimeoutSeconds: 90,
    dispatchMaxOffers: 5,
    dispatchMaxConcurrentPerDriver: 3,
    // A same-town DOOR_TO_DOOR run is priced from this platform setting, not
    // a hub (shipment.service.ts#courierFees) — a real, operator-configured
    // rate, not a fabricated one, standing in for whatever ops has actually
    // set on production.
    localCourierFeeMinor: 500n,
    localCourierFeeTestMinor: 500n,
    localCourierMinutes: 30,
    ...over,
  };
  if (existing) await ctx.prisma.platformSetting.update({ where: { id: existing.id }, data });
  else await ctx.prisma.platformSetting.create({ data });
}

const deliveryOf = (id: string) => ctx.prisma.orderDelivery.findUniqueOrThrow({ where: { id } });

/** A same-town DOOR_TO_DOOR shipment: exactly one DIRECT leg, no hub or lane
 *  needed (isLocalDoorToDoor), whose "where the driver has to BE" is the
 *  shipment's own origin district/city — the field this card wires up. */
async function bookLocalDirect(cookies: string[], place: { district: string; city: string }) {
  const r = await post(cookies, 'shipping', {
    service: 'DOOR_TO_DOOR',
    origin: { district: place.district, city: place.city, address: '1 Front St', name: 'Sender', phone: '501-2223333', latitude: 17.9, longitude: -88.0 },
    destination: { district: place.district, city: place.city, address: '2 Back St', name: 'Recipient', phone: '501-4445555', latitude: 17.9, longitude: -88.0 },
    description: 'One envelope',
    payWithWallet: true,
  });
  expect(r.status).toBe(201);
  const leg = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId: r.body.id } });
  expect(leg.kind).toBe('DIRECT');
  expect(leg.assignedDriverProfileId).toBeNull();
  return { shipmentId: r.body.id as string, legId: leg.id as string };
}

async function fundedSender() {
  const { cookies, userId } = await registerCustomer(`sender_${uniq()}@example.bz`);
  const r = await post(adminCookies, 'admin/wallet/test-credit', { userId, amountMinor: 100_000, reason: 'BMPL-194 test fixture.' });
  expect(r.status).toBe(201);
  return { cookies, userId };
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  const login = await request(ctx.server).post('/api/auth/login').send({ email: admin.email, password: admin.password });
  expect(login.status).toBe(201);
  adminCookies = cookiesOf(login);
  const cat = await ctx.prisma.category.create({ data: { name: `Cat ${uniq()}`, slug: `cat-${uniq()}`, isVisible: true } });
  categoryId = cat.id;
  engine = ctx.app.get(DispatchEngineService);
  shipmentDispatch = ctx.app.get(ShipmentDispatchService);
});

afterAll(async () => {
  await ctx.app.close();
});

beforeEach(async () => {
  await enableDispatch();
  // Same isolation trick as dispatch-engine.integration.spec.ts: park every
  // driver from earlier tests so each test's pool is exactly what it created.
  await ctx.prisma.driverProfile.updateMany({ data: { availability: 'OFFLINE' } });
});

describe('BMPL-194: marketplace delivery dispatch honours declared city narrowing', () => {
  it('does not offer a delivery outside a narrowed city, even within a served district', async () => {
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor, { district: 'BELIZE', city: 'Belize City' });
    // Serves BELIZE, but ONLY San Pedro within it — exactly the ruling's own
    // example, in reverse (San Pedro-only, offered Belize City work).
    await makeDriver({ district: 'BELIZE', cities: ['San Pedro'] });

    const outcome = await engine.dispatch(deliveryId);
    expect(outcome.result).toBe('NO_CANDIDATES');
    expect((await deliveryOf(deliveryId)).assignedDriverProfileId).toBeNull();
  });

  it('offers a delivery inside the narrowed city', async () => {
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor, { district: 'BELIZE', city: 'San Pedro' });
    const driver = await makeDriver({ district: 'BELIZE', cities: ['San Pedro'] });

    const outcome = await engine.dispatch(deliveryId);
    expect(outcome.result).toBe('ASSIGNED');
    expect((await deliveryOf(deliveryId)).assignedDriverProfileId).toBe(driver.driverProfileId);
  });

  it('still serves the whole district when no city narrowing is declared (unchanged default)', async () => {
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor, { district: 'BELIZE', city: 'San Pedro' });
    // No driverServiceCity rows at all — BMPL-176's own stated meaning: the
    // whole district, exactly as every driver worked before this card.
    const driver = await makeDriver({ district: 'BELIZE' });

    const outcome = await engine.dispatch(deliveryId);
    expect(outcome.result).toBe('ASSIGNED');
    expect((await deliveryOf(deliveryId)).assignedDriverProfileId).toBe(driver.driverProfileId);
  });

  it('matches a declared city trimmed and case-insensitively, like every other free-text place comparison', async () => {
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor, { district: 'BELIZE', city: ' san pedro ' });
    const driver = await makeDriver({ district: 'BELIZE', cities: ['San Pedro'] });

    const outcome = await engine.dispatch(deliveryId);
    expect(outcome.result).toBe('ASSIGNED');
    expect((await deliveryOf(deliveryId)).assignedDriverProfileId).toBe(driver.driverProfileId);
  });
});

describe('BMPL-194: shipment courier-leg dispatch honours declared city narrowing', () => {
  it('does not offer a leg outside the narrowed city', async () => {
    const { cookies } = await fundedSender();
    const { legId } = await bookLocalDirect(cookies, { district: 'BELIZE', city: 'Belize City' });
    await makeDriver({ district: 'BELIZE', cities: ['San Pedro'] });

    const outcome = await shipmentDispatch.dispatchLeg(legId);
    expect(outcome.result).toBe('SKIPPED');
    expect((await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId } })).assignedDriverProfileId).toBeNull();
  });

  it('offers a leg inside the narrowed city', async () => {
    const { cookies } = await fundedSender();
    const { legId } = await bookLocalDirect(cookies, { district: 'BELIZE', city: 'San Pedro' });
    const driver = await makeDriver({ district: 'BELIZE', cities: ['San Pedro'] });

    const outcome = await shipmentDispatch.dispatchLeg(legId);
    expect(outcome.result).toBe('OFFERED');
    expect((await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId } })).assignedDriverProfileId).toBe(driver.driverProfileId);
  });
});

describe('BMPL-194: admin manual assignment applies the same narrowing', () => {
  it('assignmentEligibility names the city, not just the district, when a narrowed driver is submitted by hand', async () => {
    const vendor = await makeVendor();
    const { deliveryId } = await readyDelivery(vendor, { district: 'BELIZE', city: 'Belize City' });
    const driver = await makeDriver({ district: 'BELIZE', cities: ['San Pedro'] });
    // Exercised through the real admin HTTP surface, not the service directly
    // — proves the controller actually threads the destination city through,
    // not just that the service function can.
    const vehicle = await ctx.prisma.driverVehicle.findFirstOrThrow({ where: { driverProfileId: driver.driverProfileId } });
    const r = await post(adminCookies, `admin/deliveries/${deliveryId}/assign`, { driverProfileId: driver.driverProfileId, vehicleId: vehicle.id });
    expect(r.status).toBe(400);
    expect(r.body.message).toContain('Belize City');
  });
});
