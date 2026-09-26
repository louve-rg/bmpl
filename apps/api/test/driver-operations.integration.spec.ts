/**
 * Driver Operations Center summary (BMPL-197) — "delivered today" must be a
 * Belize calendar day, not the host process's own local timezone. Seeds a
 * delivery directly (bypassing the dispatch state machine, which is not what
 * this test is about) and calls the service directly with a fixed `now`, so
 * the boundary is pinned rather than dependent on whatever day it is when
 * the suite happens to run.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, resetDb, seedRoles, type TestContext } from './helpers';
import { DriverOperationsService } from '../src/driver/driver-operations.service';
import type { PrismaService } from '../src/prisma/prisma.service';

let ctx: TestContext;
let categoryId: string;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const category = await ctx.prisma.category.create({ data: { name: `Cat ${uniq()}`, slug: `cat-${uniq()}` } });
  categoryId = category.id;
});
afterAll(async () => {
  await ctx.app.close();
});

async function makeDriverProfile() {
  const s = uniq();
  const user = await ctx.prisma.user.create({ data: { email: `drv_${s}@example.bz`, passwordHash: 'x', firstName: 'D', lastName: 'River' } });
  await ctx.prisma.userRole.create({ data: { userId: user.id, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() } });
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId: user.id, legalName: 'D River', displayName: `Drv${s}`, phone: '+5016000000', homeDistrict: 'BELIZE',
      licenceNumber: `DL-${s}`, licenceExpiry: new Date(Date.now() + 365 * 86_400_000), vehicleOwnership: 'OWNED', availability: 'ONLINE', isActive: true,
    },
  });
  return { userId: user.id, driverProfileId: profile.id };
}

/** A delivered `OrderDelivery` row, seeded directly — the state machine is not under test here. */
async function seedDeliveredOrder(driverProfileId: string, deliveredAt: Date) {
  const s = uniq();
  const buyer = await ctx.prisma.user.create({ data: { email: `buy_${s}@example.bz`, passwordHash: 'x', firstName: 'C', lastName: 'U' } });
  const vendorUser = await ctx.prisma.user.create({ data: { email: `vend_${s}@example.bz`, passwordHash: 'x', firstName: 'V', lastName: 'S' } });
  const vp = await ctx.prisma.vendorProfile.create({ data: { userId: vendorUser.id, businessName: `Store ${s}`, slug: `store-${s}`, contactEmail: `v${s}@x.bz`, approvalStatus: 'APPROVED', storeStatus: 'OPEN' } });
  const product = await ctx.prisma.product.create({ data: { vendorProfileId: vp.id, categoryId, title: `Prod ${s}`, slug: `prod-${s}`, sku: `SKU-${s}`, status: 'PUBLISHED', priceMinor: 1000n, currency: 'BZD' } });
  await ctx.prisma.order.create({
    data: {
      orderNumber: `ORD-${s}`, userId: buyer.id, status: 'PENDING', itemCount: 1, subtotalMinor: 1000n, deliveryFeeMinor: 500n, totalMinor: 1500n,
      vendorOrders: {
        create: {
          orderNumber: `ORD-${s}-1`, vendorProfileId: vp.id, deliveryMethod: 'DELIVERY', itemCount: 1, subtotalMinor: 1000n, status: 'PICKED_UP',
          items: { create: { productId: product.id, productTitle: product.title, sku: `SK-${s}`, unitPriceMinor: 1000n, quantity: 1, subtotalMinor: 1000n } },
          delivery: { create: { status: 'DELIVERED', feeMinor: 500n, assignedDriverProfileId: driverProfileId, deliveredAt } },
        },
      },
    },
  });
}

describe('DriverOperationsService.summary "delivered today"', () => {
  it('counts a delivery from earlier the same Belize calendar day, even when "now" is in the 18:00-midnight Belize evening window', async () => {
    const driver = await makeDriverProfile();
    // "now": 2026-09-26T20:00:00 Belize local = 2026-09-27T02:00:00.000Z.
    const now = new Date('2026-09-27T02:00:00.000Z');
    // Delivered earlier the SAME Belize calendar day (2026-09-26T00:30 Belize local = 2026-09-26T06:30:00.000Z) - just after Belize midnight.
    const deliveredAt = new Date('2026-09-26T06:30:00.000Z');
    // A delivery from the PREVIOUS Belize day (2026-09-25T23:00 Belize local = 2026-09-26T05:00:00.000Z), just before Belize midnight - must NOT count.
    const deliveredAtYesterday = new Date('2026-09-26T05:00:00.000Z');
    await seedDeliveredOrder(driver.driverProfileId, deliveredAt);
    await seedDeliveredOrder(driver.driverProfileId, deliveredAtYesterday);

    const service = new DriverOperationsService(ctx.prisma as unknown as PrismaService);
    const summary = await service.summary(driver.driverProfileId, driver.userId, now);

    expect(summary.counts.deliveredToday).toBe(1);
  });
});
