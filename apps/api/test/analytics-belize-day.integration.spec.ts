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
});
