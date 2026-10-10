/**
 * Platform Operations (Phase 4 · M23) — integration vs real Postgres. The ops
 * console overview (aggregated cross-domain action queues), the announcement /
 * maintenance banner (ops.manage to edit, public read, display-only), and the audit
 * CSV export — all permission-gated. No business state is mutated.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedLimitedAdmin, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let adminCookies: string[];
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const patch = (c: string[], p: string, b: object | string) => request(ctx.server).patch(`/api/${p}`).set('Cookie', c).send(b);

async function login(email: string, password: string) {
  const r = await request(ctx.server).post('/api/auth/login').send({ email, password });
  expect(r.status).toBe(201);
  return cookiesOf(r);
}
async function register(email: string) {
  const reg = await request(ctx.server).post('/api/auth/register').send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  return { cookies: cookiesOf(reg), userId: (await ctx.prisma.user.findUniqueOrThrow({ where: { email } })).id };
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  adminCookies = await login(admin.email, admin.password);
});
afterAll(async () => {
  await ctx.app.close();
});

describe('operations overview (ops.read)', () => {
  it('aggregates cross-domain action queues and reflects seeded pending work', async () => {
    // Seed some actionable work: a PENDING vendor application + a suspended user.
    const s = uniq();
    const v = await register(`v_${s}@example.bz`);
    await ctx.prisma.vendorProfile.create({ data: { userId: v.userId, businessName: `Store ${s}`, slug: `store-${s}`, contactEmail: `v${s}@x.bz`, approvalStatus: 'PENDING' } });
    const sus = await register(`sus_${s}@example.bz`);
    await ctx.prisma.user.update({ where: { id: sus.userId }, data: { status: 'SUSPENDED' } });

    const res = await get(adminCookies, 'admin/ops/overview');
    expect(res.status).toBe(200);
    expect(res.body.queues.pendingVendorApplications).toBeGreaterThanOrEqual(1);
    expect(res.body.queues.suspendedUsers).toBeGreaterThanOrEqual(1);
    // every documented queue key is present
    for (const k of ['pendingProductModeration', 'pendingDriverVehicles', 'openReviewReports', 'openSupportCases', 'failedSettlements', 'deliveriesPendingAssignment', 'awaitingPickupCollection']) {
      expect(res.body.queues).toHaveProperty(k);
    }
    expect(typeof res.body.totalActionable).toBe('number');
    expect(res.body.settings).toHaveProperty('announcementActive');
  });

  it('gates the ops console (customer 403, guest 401, admin without ops.read 403)', async () => {
    const cust = await register(`c_${uniq()}@example.bz`);
    expect((await get(cust.cookies, 'admin/ops/overview')).status).toBe(403);
    expect((await request(ctx.server).get('/api/admin/ops/overview')).status).toBe(401);
    const limited = await seedLimitedAdmin(ctx.prisma, `la_${uniq()}@example.bz`, ['users.read']);
    const lc = await login(limited.email, limited.password);
    expect((await get(lc, 'admin/ops/overview')).status).toBe(403);
  });
});

describe('automatic dispatch status (BMPL-293)', () => {
  /** A marketplace delivery in exactly the state DispatchEngineService.sweepUndispatched acts on. */
  async function waitingDelivery(deliveryStatus: 'PENDING_ASSIGNMENT' | 'DRIVER_DECLINED' = 'PENDING_ASSIGNMENT') {
    const s = uniq();
    const cat = await ctx.prisma.category.create({ data: { name: `Cat ${s}`, slug: `cat-${s}`, isVisible: true } });
    const { userId: vendorUserId } = await register(`v293_${s}@example.bz`);
    const vp = await ctx.prisma.vendorProfile.create({
      data: {
        userId: vendorUserId, businessName: `Store ${s}`, slug: `store-${s}`, contactEmail: `v293${s}@x.bz`,
        approvalStatus: 'APPROVED', storeStatus: 'OPEN',
        settings: { create: { deliveryEnabled: true, pickupEnabled: true } },
        locations: { create: { label: 'Main', addressLine1: '1 St', city: 'Belize City', district: 'BELIZE', isPrimary: true } },
      },
    });
    const product = await ctx.prisma.product.create({
      data: { vendorProfileId: vp.id, categoryId: cat.id, title: `Prod ${s}`, slug: `prod-${s}`, sku: `SKU293-${s}`, status: 'PUBLISHED', priceMinor: 1000n, currency: 'BZD', inventory: { create: { quantity: 10, reserved: 0 } } },
    });
    const { userId: customerId } = await register(`c293_${s}@example.bz`);
    const order = await ctx.prisma.order.create({
      data: {
        orderNumber: `ORD293-${s}`, userId: customerId, status: 'PENDING', itemCount: 1,
        subtotalMinor: 1000n, deliveryFeeMinor: 500n, totalMinor: 1500n,
        addresses: { create: { type: 'SHIPPING', fullName: 'Cust Omer', addressLine1: '5 Ave', city: 'Belize City', district: 'BELIZE' } },
        vendorOrders: {
          create: {
            orderNumber: `ORD293-${s}-1`, vendorProfileId: vp.id, status: 'READY_FOR_PICKUP', readyForPickupAt: new Date(),
            deliveryMethod: 'DELIVERY', itemCount: 1, subtotalMinor: 1000n,
            items: { create: { productId: product.id, productTitle: 'Prod', unitPriceMinor: 1000n, quantity: 1, subtotalMinor: 1000n } },
            delivery: { create: { status: deliveryStatus, feeMinor: 500n, readyForDispatchAt: new Date() } },
          },
        },
      },
      include: { vendorOrders: { include: { delivery: true } } },
    });
    return order.vendorOrders[0]!.delivery!.id;
  }

  /** A shipment leg in exactly the state ShipmentDispatchService.sweepUndispatched acts on. */
  async function waitingLeg() {
    const s = uniq();
    const shipment = await ctx.prisma.shipment.create({ data: { reference: `BML293-${s}`, service: 'DOOR_TO_DOOR' } });
    const leg = await ctx.prisma.shipmentLeg.create({
      data: { shipmentId: shipment.id, sequence: 1, kind: 'FIRST_MILE', mode: 'LAND', status: 'READY' },
    });
    return leg.id;
  }

  it('counts exactly the rows the sweepers themselves would act on, whichever way the switch is set', async () => {
    const before = await get(adminCookies, 'admin/ops/overview');
    expect(before.status).toBe(200);
    expect(before.body.dispatch).toHaveProperty('automatic');
    const baseLegs = before.body.dispatch.waitingShipmentLegs;
    const baseDeliveries = before.body.dispatch.waitingDeliveries;

    await waitingLeg();
    await waitingDelivery();

    const after = await get(adminCookies, 'admin/ops/overview');
    expect(after.status).toBe(200);
    // Exactly one more of each — proves the count tracks the real predicate
    // rather than being coincidentally nonzero.
    expect(after.body.dispatch.waitingShipmentLegs).toBe(baseLegs + 1);
    expect(after.body.dispatch.waitingDeliveries).toBe(baseDeliveries + 1);
  });

  it('reports the same counts whether automatic dispatch is on or off — absence of the flag must not read as absence of work', async () => {
    const row = await ctx.prisma.platformSetting.findFirst();
    const settingId = row?.id ?? (await ctx.prisma.platformSetting.create({ data: {} })).id;

    await ctx.prisma.platformSetting.update({ where: { id: settingId }, data: { dispatchAutomatic: false } });
    const off = await get(adminCookies, 'admin/ops/overview');
    expect(off.body.dispatch.automatic).toBe(false);
    const waitingWhenOff = off.body.dispatch.waitingShipmentLegs;

    await waitingLeg();

    await ctx.prisma.platformSetting.update({ where: { id: settingId }, data: { dispatchAutomatic: true } });
    const on = await get(adminCookies, 'admin/ops/overview');
    expect(on.body.dispatch.automatic).toBe(true);
    // The new leg is still waiting and still counted — turning automatic ON
    // does not make the fact disappear, and it was never conditional on OFF.
    expect(on.body.dispatch.waitingShipmentLegs).toBe(waitingWhenOff + 1);

    await ctx.prisma.platformSetting.update({ where: { id: settingId }, data: { dispatchAutomatic: false } });
  });

  it('counts a DRIVER_DECLINED delivery in queues.deliveriesPendingAssignment (BMPL-295) — it was excluded before, even though the dispatch console it links to already listed it', async () => {
    const before = await get(adminCookies, 'admin/ops/overview');
    expect(before.status).toBe(200);
    const base = before.body.queues.deliveriesPendingAssignment;
    const baseWaiting = before.body.dispatch.waitingDeliveries;

    await waitingDelivery('DRIVER_DECLINED');

    const after = await get(adminCookies, 'admin/ops/overview');
    // The fix: a declined delivery is real pending work and must show up
    // here, same as it already does in dispatch.waitingDeliveries and in
    // the admin dispatch console's own list.
    expect(after.body.queues.deliveriesPendingAssignment).toBe(base + 1);
    expect(after.body.dispatch.waitingDeliveries).toBe(baseWaiting + 1);
  });
});

describe('migration state (ops.read) — MDF-100', () => {
  it('reports the single most-recently-applied migration name + timestamp', async () => {
    const res = await get(adminCookies, 'admin/ops/migrations');
    expect(res.status).toBe(200);
    // globalSetup runs `prisma migrate deploy` against the test database before
    // any spec file runs, so by the time this test executes at least one
    // migration is always applied — this is never null in CI/local integration.
    expect(typeof res.body.latestMigration).toBe('string');
    expect(res.body.latestMigration.length).toBeGreaterThan(0);
    expect(res.body.appliedAt).not.toBeNull();
    expect(new Date(res.body.appliedAt).toString()).not.toBe('Invalid Date');
  });

  it('gates the migration check (customer 403, guest 401, admin without ops.read 403)', async () => {
    const cust = await register(`mig_${uniq()}@example.bz`);
    expect((await get(cust.cookies, 'admin/ops/migrations')).status).toBe(403);
    expect((await request(ctx.server).get('/api/admin/ops/migrations')).status).toBe(401);
    const limited = await seedLimitedAdmin(ctx.prisma, `mla_${uniq()}@example.bz`, ['users.read']);
    const lc = await login(limited.email, limited.password);
    expect((await get(lc, 'admin/ops/migrations')).status).toBe(403);
    // ops.read alone is sufficient — same tier as overview/settings reads.
    const readOnly = await seedLimitedAdmin(ctx.prisma, `mro_${uniq()}@example.bz`, ['ops.read']);
    const rc = await login(readOnly.email, readOnly.password);
    expect((await get(rc, 'admin/ops/migrations')).status).toBe(200);
  });
});

describe('announcement / maintenance banner', () => {
  it('lets ops.manage edit the banner and surfaces active notices publicly (display-only)', async () => {
    // initially nothing active
    const before = await request(ctx.server).get('/api/marketplace/announcement');
    expect(before.status).toBe(200);
    expect(before.body).toEqual({ announcement: null, maintenance: null });

    // publish an announcement + maintenance notice
    const upd = await patch(adminCookies, 'admin/ops/settings', {
      announcementActive: true, announcementLevel: 'WARNING', announcementMessage: 'Holiday shipping delays expected.',
      maintenanceMode: true, maintenanceMessage: 'Maintenance Sunday 2am.',
    });
    expect(upd.status).toBe(200);
    expect(upd.body.announcementLevel).toBe('WARNING');

    const pub = await request(ctx.server).get('/api/marketplace/announcement');
    expect(pub.body.announcement).toEqual({ level: 'WARNING', message: 'Holiday shipping delays expected.' });
    expect(pub.body.maintenance).toEqual({ message: 'Maintenance Sunday 2am.' });

    // deactivating hides it from the public banner
    await patch(adminCookies, 'admin/ops/settings', { announcementActive: false, maintenanceMode: false });
    const after = await request(ctx.server).get('/api/marketplace/announcement');
    expect(after.body).toEqual({ announcement: null, maintenance: null });

    // the update was audited
    const audit = await ctx.prisma.auditLog.count({ where: { action: 'PLATFORM_SETTING_UPDATED' } });
    expect(audit).toBeGreaterThanOrEqual(1);
  });

  it('requires ops.manage to edit (ops.read alone is refused) and validates input', async () => {
    const readOnly = await seedLimitedAdmin(ctx.prisma, `ro_${uniq()}@example.bz`, ['ops.read']);
    const rc = await login(readOnly.email, readOnly.password);
    expect((await get(rc, 'admin/ops/overview')).status).toBe(200); // can read
    expect((await patch(rc, 'admin/ops/settings', { maintenanceMode: true })).status).toBe(403); // cannot write
    // empty body rejected
    expect((await patch(adminCookies, 'admin/ops/settings', {})).status).toBe(400);
    // bad level rejected
    expect((await patch(adminCookies, 'admin/ops/settings', { announcementLevel: 'BOGUS' })).status).toBe(400);
  });
});

describe('audit CSV export (audit.read)', () => {
  it('exports the audit log as CSV with the right headers', async () => {
    const res = await get(adminCookies, 'admin/ops/audit.csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('audit-log.csv');
    expect(res.text.split('\r\n')[0]).toBe('createdAt,action,actorEmail,targetEmail,targetRole,reason,ipAddress');
    // a customer without audit.read cannot export
    const cust = await register(`c2_${uniq()}@example.bz`);
    expect((await get(cust.cookies, 'admin/ops/audit.csv')).status).toBe(403);
  });
});
