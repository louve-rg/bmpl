/**
 * Terminal operating-hours CONFIGURATION (BMPL-260/262/263), against real
 * Postgres. Read/write/replace/delete only — nothing in this suite, or in
 * the code it exercises, consumes these rows to gate or warn about
 * anything. That is a separate, not-yet-decided consumer.
 *
 * No real hub hours appear anywhere in this file — every day/time/date/
 * reason below is a synthetic fixture, never a real BML terminal's hours.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedLimitedAdmin, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const put = (c: string[], p: string, b: object = {}) => request(ctx.server).put(`/api/${p}`).set('Cookie', c).send(b);
const del = (c: string[], p: string) => request(ctx.server).delete(`/api/${p}`).set('Cookie', c);
const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);

async function loginAs(email: string, password: string) {
  const res = await request(ctx.server).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(201);
  return cookiesOf(res);
}

/** One synthetic terminal, no hours configured yet. */
async function makeHub() {
  const suffix = uniq();
  const r = await post(admin, 'admin/logistics/hubs', {
    code: `HH${suffix}`.slice(0, 12),
    name: `Synthetic Hours Terminal ${suffix}`,
    type: 'BUS_TERMINAL',
    district: 'BELIZE',
    city: 'Synthetic Town',
    modes: ['LAND'],
    courierFeeMinor: 300,
  });
  expect(r.status).toBe(201);
  return r.body.id as string;
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = await loginAs(a.email, a.password);
});

afterAll(async () => {
  await ctx.app.close();
});

beforeEach(async () => {
  await ctx.prisma.hubHoursException.deleteMany();
  await ctx.prisma.hubOpeningDay.deleteMany();
  await ctx.prisma.logisticsHub.deleteMany();
});

describe('admin hub hours', () => {
  it('an unconfigured hub has no weekly pattern and no exceptions', async () => {
    const hubId = await makeHub();
    const hours = await get(admin, `admin/logistics/hubs/${hubId}/hours`);
    expect(hours.status).toBe(200);
    expect(hours.body.days).toEqual([]);
    expect(hours.body.exceptions).toEqual([]);
  });

  it('sets the whole weekly pattern in one call, and a resubmit REPLACES it rather than merging', async () => {
    const hubId = await makeHub();
    const first = await put(admin, `admin/logistics/hubs/${hubId}/hours`, {
      days: [
        { dayOfWeek: 0, isClosed: true },
        { dayOfWeek: 1, isClosed: false, openTime: '08:00', closeTime: '17:00' },
      ],
    });
    expect(first.status).toBe(200);
    expect(first.body.days).toHaveLength(2);

    // A second submission with only ONE day removes the other - no stale row survives.
    const second = await put(admin, `admin/logistics/hubs/${hubId}/hours`, {
      days: [{ dayOfWeek: 2, isClosed: false, openTime: '09:00', closeTime: '16:00' }],
    });
    expect(second.status).toBe(200);
    expect(second.body.days).toEqual([{ dayOfWeek: 2, isClosed: false, openTime: '09:00', closeTime: '16:00' }]);

    // LATEST-ROW ASSUMPTION (BMPL-243): filtered by action only, not by this
    // hub's id -- safe only because this is the only/first query for
    // HUB_HOURS_CHANGED in this file. See route-schedule.integration.spec.ts's
    // identical caveat on the same precedent, and categories.integration.
    // spec.ts's CATEGORY_CREATED check for the full explanation.
    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'HUB_HOURS_CHANGED' }, orderBy: { createdAt: 'desc' } });
    expect(audit).toBeTruthy();
  });

  it('refuses a duplicate day-of-week and an out-of-range one', async () => {
    const hubId = await makeHub();
    expect(
      (
        await put(admin, `admin/logistics/hubs/${hubId}/hours`, {
          days: [
            { dayOfWeek: 2, isClosed: false, openTime: '08:00', closeTime: '17:00' },
            { dayOfWeek: 2, isClosed: true },
          ],
        })
      ).status,
    ).toBe(400);
    expect((await put(admin, `admin/logistics/hubs/${hubId}/hours`, { days: [{ dayOfWeek: 9, isClosed: true }] })).status).toBe(400);
  });

  it('refuses an open day with no open/close time, or close before open', async () => {
    const hubId = await makeHub();
    expect((await put(admin, `admin/logistics/hubs/${hubId}/hours`, { days: [{ dayOfWeek: 1, isClosed: false }] })).status).toBe(400);
    expect(
      (
        await put(admin, `admin/logistics/hubs/${hubId}/hours`, {
          days: [{ dayOfWeek: 1, isClosed: false, openTime: '17:00', closeTime: '08:00' }],
        })
      ).status,
    ).toBe(400);
  });

  it('adds, lists and removes a CLOSED date-specific exception', async () => {
    const hubId = await makeHub();
    const added = await post(admin, `admin/logistics/hubs/${hubId}/hours/exceptions`, {
      date: '2026-12-25',
      status: 'CLOSED',
      reason: 'Synthetic test holiday - not a real BML closure',
    });
    expect(added.status).toBe(201);
    const exceptionId = added.body.id as string;

    const hours = await get(admin, `admin/logistics/hubs/${hubId}/hours`);
    expect(hours.body.exceptions).toEqual([
      { id: exceptionId, date: '2026-12-25', status: 'CLOSED', openTime: null, closeTime: null, reason: 'Synthetic test holiday - not a real BML closure' },
    ]);

    // Re-submitting the same date REPLACES it rather than duplicating.
    const replaced = await post(admin, `admin/logistics/hubs/${hubId}/hours/exceptions`, {
      date: '2026-12-25',
      status: 'MODIFIED',
      openTime: '10:00',
      closeTime: '13:00',
      reason: 'Synthetic: revised plan',
    });
    expect(replaced.status).toBe(201);
    expect(replaced.body.id).toBe(exceptionId);
    expect(await ctx.prisma.hubHoursException.count({ where: { hubId } })).toBe(1);

    expect((await del(admin, `admin/logistics/hubs/${hubId}/hours/exceptions/${exceptionId}`)).status).toBe(200);
    expect((await get(admin, `admin/logistics/hubs/${hubId}/hours`)).body.exceptions).toEqual([]);
  });

  it('adds a MODIFIED exception with both times, and it round-trips exactly', async () => {
    const hubId = await makeHub();
    const added = await post(admin, `admin/logistics/hubs/${hubId}/hours/exceptions`, {
      date: '2026-11-19',
      status: 'MODIFIED',
      openTime: '11:00',
      closeTime: '14:00',
      reason: 'Synthetic: half day for a public event',
    });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ status: 'MODIFIED', openTime: '11:00', closeTime: '14:00' });
  });

  // THE REJECTION CASES (the whole reason this card asked for them): a bad
  // combination must come back as a real validation error, not a 500 from
  // the database CHECK (hub_hours_exceptions_times_match_status).
  describe('rejects an incoherent exception before it reaches the database', () => {
    it('MODIFIED with only openTime set', async () => {
      const hubId = await makeHub();
      const res = await post(admin, `admin/logistics/hubs/${hubId}/hours/exceptions`, {
        date: '2026-12-01', status: 'MODIFIED', openTime: '11:00',
      });
      expect(res.status).toBe(400);
      expect(await ctx.prisma.hubHoursException.count({ where: { hubId } })).toBe(0);
    });

    it('MODIFIED with neither time set', async () => {
      const hubId = await makeHub();
      const res = await post(admin, `admin/logistics/hubs/${hubId}/hours/exceptions`, { date: '2026-12-01', status: 'MODIFIED' });
      expect(res.status).toBe(400);
      expect(await ctx.prisma.hubHoursException.count({ where: { hubId } })).toBe(0);
    });

    it('MODIFIED with closeTime before openTime', async () => {
      const hubId = await makeHub();
      const res = await post(admin, `admin/logistics/hubs/${hubId}/hours/exceptions`, {
        date: '2026-12-01', status: 'MODIFIED', openTime: '14:00', closeTime: '11:00',
      });
      expect(res.status).toBe(400);
      expect(await ctx.prisma.hubHoursException.count({ where: { hubId } })).toBe(0);
    });

    it('CLOSED with a time set anyway', async () => {
      const hubId = await makeHub();
      const res = await post(admin, `admin/logistics/hubs/${hubId}/hours/exceptions`, {
        date: '2026-12-01', status: 'CLOSED', openTime: '09:00',
      });
      expect(res.status).toBe(400);
      expect(await ctx.prisma.hubHoursException.count({ where: { hubId } })).toBe(0);
    });
  });

  it('a missing hub 404s on every hours operation', async () => {
    const missingId = 'nonexistent00000000000000';
    expect((await get(admin, `admin/logistics/hubs/${missingId}/hours`)).status).toBe(404);
    expect((await put(admin, `admin/logistics/hubs/${missingId}/hours`, { days: [] })).status).toBe(404);
    expect((await post(admin, `admin/logistics/hubs/${missingId}/hours/exceptions`, { date: '2026-12-01', status: 'CLOSED' })).status).toBe(404);
  });

  it('removing a nonexistent exception 404s', async () => {
    const hubId = await makeHub();
    expect((await del(admin, `admin/logistics/hubs/${hubId}/hours/exceptions/nonexistent00000000000000`)).status).toBe(404);
  });

  it('logistics.read may view but not write; logistics.manage may do both', async () => {
    const hubId = await makeHub();
    const reader = await seedLimitedAdmin(ctx.prisma, `hreader_${uniq()}@example.bz`, ['logistics.read']);
    const readerCookies = await loginAs(reader.email, reader.password);
    expect((await get(readerCookies, `admin/logistics/hubs/${hubId}/hours`)).status).toBe(200);
    expect((await put(readerCookies, `admin/logistics/hubs/${hubId}/hours`, { days: [{ dayOfWeek: 0, isClosed: true }] })).status).toBe(403);
    expect((await post(readerCookies, `admin/logistics/hubs/${hubId}/hours/exceptions`, { date: '2026-12-01', status: 'CLOSED' })).status).toBe(403);

    const manager = await seedLimitedAdmin(ctx.prisma, `hmanager_${uniq()}@example.bz`, ['logistics.read', 'logistics.manage']);
    const managerCookies = await loginAs(manager.email, manager.password);
    expect((await put(managerCookies, `admin/logistics/hubs/${hubId}/hours`, { days: [{ dayOfWeek: 0, isClosed: true }] })).status).toBe(200);
  });
});
