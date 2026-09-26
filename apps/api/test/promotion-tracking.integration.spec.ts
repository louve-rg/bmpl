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

describe('promotion metric daily bucket', () => {
  it('buckets a click on the Belize calendar day, even at an instant already tomorrow in UTC', async () => {
    const s = uniq();
    const owner = await ctx.prisma.user.create({ data: { email: `promo_${s}@example.bz`, passwordHash: 'x', firstName: 'P', lastName: 'O' } });
    const promo = await ctx.prisma.promotion.create({ data: { ownerUserId: owner.id, type: 'HOMEPAGE_BANNER', title: `Promo ${s}` } });

    // 2026-09-26T20:00:00 Belize local = 2026-09-27T02:00:00.000Z - already
    // "tomorrow" (the 27th) by UTC, still "today" (the 26th) in Belize.
    // Only Date is faked - setTimeout/setInterval stay real so the HTTP
    // server and supertest's own request handling are unaffected.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-27T02:00:00.000Z'));

    // placement is set explicitly - a pre-existing, unrelated defect means
    // track() throws internally (caught; it never surfaces to the client)
    // when placement is omitted/null, because the compound unique index
    // [promotionId, day, placement] can't be queried with a null placement
    // via Prisma's generated compound-key input. Reported separately; not a
    // timezone/date defect, and not this test's concern.
    const res = await request(ctx.server).post(`/api/marketing/promotions/${promo.id}/track`).send({ event: 'click', placement: 'HOMEPAGE_HERO' });
    expect(res.status).toBe(204);

    const rows = await ctx.prisma.promotionMetricDaily.findMany({ where: { promotionId: promo.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.day.toISOString()).toBe('2026-09-26T00:00:00.000Z');
    expect(rows[0]!.clicks).toBe(1);
  });
});
