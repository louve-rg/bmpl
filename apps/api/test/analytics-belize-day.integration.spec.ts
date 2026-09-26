/**
 * Admin sales time-series day bucket (BMPL-197) — a payment must be attributed
 * to the Belize calendar day it happened on, not the UTC one. Pins the system
 * clock so "now" is safely past the boundary in both timezones, and seeds a
 * payment at an instant that is already tomorrow (the 27th) in UTC but still
 * today (the 26th) in Belize.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { bootApp, resetDb, seedRoles, type TestContext } from './helpers';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { OwnershipService } from '../src/products/ownership.service';
import type { PrismaService } from '../src/prisma/prisma.service';

let ctx: TestContext;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
});
afterAll(async () => {
  await ctx.app.close();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('AnalyticsService.adminSales day bucket', () => {
  it('attributes a payment to the Belize calendar day, not the UTC one', async () => {
    const s = uniq();
    const buyer = await ctx.prisma.user.create({ data: { email: `buy_${s}@example.bz`, passwordHash: 'x', firstName: 'B', lastName: 'U' } });
    // 2026-09-27T02:00:00Z = 2026-09-26T20:00 Belize local - already the 27th
    // in UTC, still the 26th (in the 18:00-midnight evening window) in Belize.
    const createdAt = new Date('2026-09-27T02:00:00.000Z');
    const order = await ctx.prisma.order.create({
      data: { orderNumber: `ORD-${s}`, userId: buyer.id, status: 'PENDING', itemCount: 1, subtotalMinor: 1000n, deliveryFeeMinor: 0n, totalMinor: 1000n },
    });
    await ctx.prisma.payment.create({
      data: { paymentNumber: `PAY-${s}`, orderId: order.id, userId: buyer.id, amountMinor: 1000n, status: 'SETTLED', createdAt },
    });

    // "now": comfortably past the boundary in both timezones, so windowStart
    // itself isn't the thing under test here - only the day bucket is.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-28T12:00:00.000Z'));

    const service = new AnalyticsService(ctx.prisma as unknown as PrismaService, new OwnershipService(ctx.prisma as unknown as PrismaService));
    const result = await service.adminSales(3);

    const day26 = result.series.find((p) => p.date === '2026-09-26');
    const day27 = result.series.find((p) => p.date === '2026-09-27');
    expect(day26?.orders).toBe(1);
    expect(day26?.grossMinor).toBe(1000);
    expect(day27?.orders).toBe(0);
  });

  // The test above pins its payment four hours away from the real boundary in
  // both directions (2026-09-27T02:00Z is neither near 00:00Z nor near
  // 06:00Z), so it cannot tell a correct six-hour offset from a wrong
  // five-hour one - both would bucket it identically. These two pin the SQL
  // side at the exact boundary the way belize-time.test.ts already pins the
  // JS side: 05:59:59.999Z is the last instant of the OLD Belize day,
  // 06:00:00.000Z is the first instant of the NEW one.
  it('rolls the SQL day bucket exactly at Belize midnight (06:00 UTC), not one hour early or late', async () => {
    const s = uniq();
    const buyer = await ctx.prisma.user.create({ data: { email: `buy_${s}@example.bz`, passwordHash: 'x', firstName: 'B', lastName: 'U' } });

    // A different calendar date from the test above (adminSales aggregates
    // platform-wide with no per-test isolation beyond beforeAll's resetDb,
    // so reusing 2026-09-26/27 here would double-count against that test's
    // own day-26 row).
    const justBeforeMidnight = new Date('2026-11-04T05:59:59.999Z'); // 2026-11-03T23:59:59.999 Belize
    const exactlyMidnight = new Date('2026-11-04T06:00:00.000Z'); // 2026-11-04T00:00:00.000 Belize

    const orderA = await ctx.prisma.order.create({
      data: { orderNumber: `ORD-${s}-A`, userId: buyer.id, status: 'PENDING', itemCount: 1, subtotalMinor: 1000n, deliveryFeeMinor: 0n, totalMinor: 1000n },
    });
    await ctx.prisma.payment.create({
      data: { paymentNumber: `PAY-${s}-A`, orderId: orderA.id, userId: buyer.id, amountMinor: 1000n, status: 'SETTLED', createdAt: justBeforeMidnight },
    });
    const orderB = await ctx.prisma.order.create({
      data: { orderNumber: `ORD-${s}-B`, userId: buyer.id, status: 'PENDING', itemCount: 1, subtotalMinor: 2000n, deliveryFeeMinor: 0n, totalMinor: 2000n },
    });
    await ctx.prisma.payment.create({
      data: { paymentNumber: `PAY-${s}-B`, orderId: orderB.id, userId: buyer.id, amountMinor: 2000n, status: 'SETTLED', createdAt: exactlyMidnight },
    });

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T12:00:00.000Z'));

    const service = new AnalyticsService(ctx.prisma as unknown as PrismaService, new OwnershipService(ctx.prisma as unknown as PrismaService));
    const result = await service.adminSales(3);

    const day03 = result.series.find((p) => p.date === '2026-11-03');
    const day04 = result.series.find((p) => p.date === '2026-11-04');
    expect(day03?.orders).toBe(1);
    expect(day03?.grossMinor).toBe(1000);
    expect(day04?.orders).toBe(1);
    expect(day04?.grossMinor).toBe(2000);
  });
});

describe('AnalyticsService.vendorSales day bucket', () => {
  it('rolls the SQL day bucket exactly at Belize midnight (06:00 UTC), not one hour early or late', async () => {
    const s = uniq();
    const vendorUser = await ctx.prisma.user.create({ data: { email: `vend_${s}@example.bz`, passwordHash: 'x', firstName: 'V', lastName: 'U' } });
    const vp = await ctx.prisma.vendorProfile.create({
      data: { userId: vendorUser.id, businessName: `Store ${s}`, slug: `store-${s}`, contactEmail: `v${s}@x.bz`, approvalStatus: 'APPROVED', storeStatus: 'OPEN' },
    });
    const buyer = await ctx.prisma.user.create({ data: { email: `buy_${s}@example.bz`, passwordHash: 'x', firstName: 'B', lastName: 'U' } });

    const justBeforeMidnight = new Date('2026-09-27T05:59:59.999Z'); // 2026-09-26T23:59:59.999 Belize
    const exactlyMidnight = new Date('2026-09-27T06:00:00.000Z'); // 2026-09-27T00:00:00.000 Belize

    async function seedVendorOrder(tag: string, subtotal: bigint, vendorOrderCreatedAt: Date) {
      const order = await ctx.prisma.order.create({
        data: { orderNumber: `ORD-${s}-${tag}`, userId: buyer.id, status: 'PENDING', itemCount: 1, subtotalMinor: subtotal, deliveryFeeMinor: 0n, totalMinor: subtotal },
      });
      await ctx.prisma.payment.create({
        data: { paymentNumber: `PAY-${s}-${tag}`, orderId: order.id, userId: buyer.id, amountMinor: subtotal, status: 'SETTLED', authorizedAt: new Date() },
      });
      // The bucketed column is the VendorOrder's own createdAt, not the
      // payment's - vendorSales groups by vo."createdAt" (see analytics.service.ts).
      await ctx.prisma.vendorOrder.create({
        data: {
          orderNumber: `ORD-${s}-${tag}-1`, orderId: order.id, vendorProfileId: vp.id, deliveryMethod: 'DELIVERY', itemCount: 1, subtotalMinor: subtotal,
          createdAt: vendorOrderCreatedAt,
        },
      });
    }
    await seedVendorOrder('A', 1000n, justBeforeMidnight);
    await seedVendorOrder('B', 2000n, exactlyMidnight);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-28T12:00:00.000Z'));

    const service = new AnalyticsService(ctx.prisma as unknown as PrismaService, new OwnershipService(ctx.prisma as unknown as PrismaService));
    const result = await service.vendorSales(vendorUser.id, 3);

    const day26 = result.series.find((p) => p.date === '2026-09-26');
    const day27 = result.series.find((p) => p.date === '2026-09-27');
    expect(day26?.orders).toBe(1);
    expect(day26?.grossMinor).toBe(1000);
    expect(day27?.orders).toBe(1);
    expect(day27?.grossMinor).toBe(2000);
  });
});
