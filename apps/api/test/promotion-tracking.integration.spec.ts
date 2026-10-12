/**
 * Promotion metric tracking day bucket (BMPL-197) — a click/view/impression
 * bucketed by day must land on the Belize calendar day, not the UTC one.
 * Pins the system clock inside the 18:00-midnight Belize evening window,
 * where UTC has already rolled to tomorrow but Belize has not.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { bootApp, resetDb, seedRoles, type TestContext } from './helpers';

let ctx: TestContext;
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;

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

async function makePromo() {
  const s = uniq();
  const owner = await ctx.prisma.user.create({ data: { email: `promo_${s}@example.bz`, passwordHash: 'x', firstName: 'P', lastName: 'O' } });
  return ctx.prisma.promotion.create({ data: { ownerUserId: owner.id, type: 'HOMEPAGE_BANNER', title: `Promo ${s}` } });
}

describe('promotion metric daily bucket', () => {
  it('buckets a click on the Belize calendar day, even at an instant already tomorrow in UTC', async () => {
    const promo = await makePromo();

    // 2026-09-26T20:00:00 Belize local = 2026-09-27T02:00:00.000Z - already
    // "tomorrow" (the 27th) by UTC, still "today" (the 26th) in Belize.
    // Only Date is faked - setTimeout/setInterval stay real so the HTTP
    // server and supertest's own request handling are unaffected.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-27T02:00:00.000Z'));

    // placement is set explicitly here only because this test is about day
    // bucketing, not placement handling — see the "no placement given"
    // describe block below (MDF-213) for that.
    const res = await request(ctx.server).post(`/api/marketing/promotions/${promo.id}/track`).send({ event: 'click', placement: 'HOMEPAGE_HERO' });
    expect(res.status).toBe(204);

    const rows = await ctx.prisma.promotionMetricDaily.findMany({ where: { promotionId: promo.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.day.toISOString()).toBe('2026-09-26T00:00:00.000Z');
    expect(rows[0]!.clicks).toBe(1);
  });
});

/**
 * BMPL-332: impression/view/click now also write a `PromotionEvent` row
 * carrying the real instant, in the same transaction as the daily-counter
 * upsert (root CLAUDE.md sec 6/apps/api/CLAUDE.md sec 6 — one write
 * producing both facts). `conversion` deliberately does NOT — requirement 9
 * is on hold pending the owner's ruling; it must keep today's behavior
 * exactly (daily counter only, no event row) until that lands.
 */
describe('promotion events (BMPL-332)', () => {
  it('a view writes both an event row with the exact instant and the daily counter, atomically', async () => {
    const promo = await makePromo();
    const instant = new Date('2026-11-04T14:30:00.000Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(instant);

    const res = await request(ctx.server).post(`/api/marketing/promotions/${promo.id}/track`).send({ event: 'view', placement: 'HOMEPAGE_HERO' });
    expect(res.status).toBe(204);

    const events = await ctx.prisma.promotionEvent.findMany({ where: { promotionId: promo.id } });
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('VIEW');
    expect(events[0]!.placement).toBe('HOMEPAGE_HERO');
    // The exact instant is kept — not truncated to a date, unlike the daily bucket.
    expect(events[0]!.occurredAt.toISOString()).toBe(instant.toISOString());

    const daily = await ctx.prisma.promotionMetricDaily.findMany({ where: { promotionId: promo.id } });
    expect(daily).toHaveLength(1);
    expect(daily[0]!.views).toBe(1);
  });

  it('a conversion writes the daily counter only — no event row, matching today\'s behavior exactly (req 9 on hold)', async () => {
    const promo = await makePromo();
    const res = await request(ctx.server).post(`/api/marketing/promotions/${promo.id}/track`).send({ event: 'conversion', placement: 'HOMEPAGE_HERO' });
    expect(res.status).toBe(204);

    const events = await ctx.prisma.promotionEvent.findMany({ where: { promotionId: promo.id } });
    expect(events).toHaveLength(0);

    const daily = await ctx.prisma.promotionMetricDaily.findMany({ where: { promotionId: promo.id } });
    expect(daily).toHaveLength(1);
    expect(daily[0]!.conversions).toBe(1);
  });

  // Requirement 10: same exact boundary pair 1c0ad82's own SQL-side day-bucket
  // tests use, for consistency — one tick either side of Belize midnight
  // (06:00 UTC).
  it('an event one tick before Belize midnight lands on the previous Belize day', async () => {
    const promo = await makePromo();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-04T05:59:59.999Z'));

    const res = await request(ctx.server).post(`/api/marketing/promotions/${promo.id}/track`).send({ event: 'click', placement: 'HOMEPAGE_HERO' });
    expect(res.status).toBe(204);

    const daily = await ctx.prisma.promotionMetricDaily.findMany({ where: { promotionId: promo.id } });
    expect(daily[0]!.day.toISOString()).toBe('2026-11-03T00:00:00.000Z');
  });

  it('an event exactly at Belize midnight lands on the new Belize day', async () => {
    const promo = await makePromo();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-04T06:00:00.000Z'));

    const res = await request(ctx.server).post(`/api/marketing/promotions/${promo.id}/track`).send({ event: 'click', placement: 'HOMEPAGE_HERO' });
    expect(res.status).toBe(204);

    const daily = await ctx.prisma.promotionMetricDaily.findMany({ where: { promotionId: promo.id } });
    expect(daily[0]!.day.toISOString()).toBe('2026-11-04T00:00:00.000Z');
  });

  // Requirement 11.
  it('a single track() call is counted exactly once, not twice, on both tables', async () => {
    const promo = await makePromo();
    const res = await request(ctx.server).post(`/api/marketing/promotions/${promo.id}/track`).send({ event: 'click', placement: 'HOMEPAGE_HERO' });
    expect(res.status).toBe(204);

    const events = await ctx.prisma.promotionEvent.findMany({ where: { promotionId: promo.id } });
    expect(events).toHaveLength(1);
    const daily = await ctx.prisma.promotionMetricDaily.findMany({ where: { promotionId: promo.id } });
    expect(daily[0]!.clicks).toBe(1);
  });

  it('N concurrent track() calls for the same bucket produce exactly N events and N on the daily counter', async () => {
    const promo = await makePromo();
    const N = 10;
    await Promise.all(
      Array.from({ length: N }, () =>
        request(ctx.server).post(`/api/marketing/promotions/${promo.id}/track`).send({ event: 'click', placement: 'HOMEPAGE_HERO' }),
      ),
    );

    const events = await ctx.prisma.promotionEvent.findMany({ where: { promotionId: promo.id } });
    expect(events).toHaveLength(N);
    const daily = await ctx.prisma.promotionMetricDaily.findMany({ where: { promotionId: promo.id } });
    expect(daily).toHaveLength(1);
    expect(daily[0]!.clicks).toBe(N);
  });
});

/**
 * MDF-213: a call that names no placement used to lose BOTH rows. Prisma's
 * generated client rejects `null` inside `PromotionMetricDaily`'s compound
 * unique key (`promotionId_day_placement`) before issuing any SQL, and that
 * throw landed after the paired `promotionEvent.create()` in the same
 * transaction — so the whole transaction rolled back silently. `placement`
 * is optional on the public schema, so this was the default shape for most
 * callers, not an edge case. Fixed by substituting the storage-only
 * `UNSPECIFIED` sentinel for a null placement before the write (see
 * promotion-discovery.service.ts's track() and migration
 * 20261104270000_promotion_metric_no_placement_sentinel). These three tests
 * FAIL on the pre-fix code (0 rows survive) and pass after it.
 */
describe('promotion tracking with no placement given (MDF-213)', () => {
  it('a click with no placement writes both the event row and the daily counter', async () => {
    const promo = await makePromo();
    const res = await request(ctx.server).post(`/api/marketing/promotions/${promo.id}/track`).send({ event: 'click' });
    expect(res.status).toBe(204);

    const events = await ctx.prisma.promotionEvent.findMany({ where: { promotionId: promo.id } });
    expect(events).toHaveLength(1);
    expect(events[0]!.placement).toBeNull(); // the event row keeps the TRUE value — null, not the sentinel.

    const daily = await ctx.prisma.promotionMetricDaily.findMany({ where: { promotionId: promo.id } });
    expect(daily).toHaveLength(1);
    expect(daily[0]!.placement).toBe('UNSPECIFIED');
    expect(daily[0]!.clicks).toBe(1);
  });

  it('a second no-placement call merges into the same daily bucket instead of duplicating', async () => {
    const promo = await makePromo();
    await request(ctx.server).post(`/api/marketing/promotions/${promo.id}/track`).send({ event: 'click' });
    const res = await request(ctx.server).post(`/api/marketing/promotions/${promo.id}/track`).send({ event: 'click' });
    expect(res.status).toBe(204);

    const events = await ctx.prisma.promotionEvent.findMany({ where: { promotionId: promo.id } });
    expect(events).toHaveLength(2);
    const daily = await ctx.prisma.promotionMetricDaily.findMany({ where: { promotionId: promo.id } });
    expect(daily).toHaveLength(1);
    expect(daily[0]!.clicks).toBe(2);
  });

  it('N concurrent no-placement calls produce exactly N events and N on the UNSPECIFIED counter', async () => {
    const promo = await makePromo();
    const N = 10;
    await Promise.all(
      Array.from({ length: N }, () => request(ctx.server).post(`/api/marketing/promotions/${promo.id}/track`).send({ event: 'click' })),
    );

    const events = await ctx.prisma.promotionEvent.findMany({ where: { promotionId: promo.id } });
    expect(events).toHaveLength(N);
    const daily = await ctx.prisma.promotionMetricDaily.findMany({ where: { promotionId: promo.id } });
    expect(daily).toHaveLength(1);
    expect(daily[0]!.placement).toBe('UNSPECIFIED');
    expect(daily[0]!.clicks).toBe(N);
  });
});
