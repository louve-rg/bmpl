/**
 * Notifications & Event System (Phase 4 · M16) — integration vs real Postgres.
 * The notification CENTER mechanics: per-user scoping, list + unread count,
 * mark-read / mark-all-read, soft delete, category + unread filters, cursor
 * pagination, per-category preferences, and the normalized event→recipient
 * fan-out (independent read state per recipient). End-to-end event emission
 * (orders/delivery/roles/vendor) is covered by the respective module specs.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const patch = (c: string[], p: string) => request(ctx.server).patch(`/api/${p}`).set('Cookie', c);
const del = (c: string[], p: string) => request(ctx.server).delete(`/api/${p}`).set('Cookie', c);
const put = (c: string[], p: string, b: unknown) => request(ctx.server).put(`/api/${p}`).set('Cookie', c).send(b);

async function registerCustomer(email: string): Promise<{ cookies: string[]; userId: string }> {
  const reg = await request(ctx.server).post('/api/auth/register').send({ email, password: 'CustomerPass123', firstName: 'N', lastName: 'C', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

/** Seed one notification event delivered to a single user; returns recipient id. */
async function seedFor(userId: string, over: { category?: string; event?: string; title?: string } = {}) {
  const n = await ctx.prisma.notification.create({
    data: {
      type: 'MARKETPLACE',
      category: (over.category ?? 'ORDER') as never,
      event: over.event ?? 'ORDER_PLACED',
      title: over.title ?? 'Order placed',
      body: 'body',
      recipients: { create: { userId } },
    },
    include: { recipients: true },
  });
  return n.recipients[0]!.id;
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  await seedSuperAdmin(ctx.prisma);
});
afterAll(async () => {
  await ctx.app.close();
});

describe('notification center', () => {
  it('guest is 401', async () => {
    await request(ctx.server).get('/api/notifications').expect(401);
  });

  it('lists a user\'s own notifications with an unread count; scoped per user', async () => {
    const a = await registerCustomer(`nc_a_${uniq()}@example.bz`);
    const b = await registerCustomer(`nc_b_${uniq()}@example.bz`);
    await seedFor(a.userId);
    await seedFor(a.userId);
    const listA = await get(a.cookies, 'notifications');
    expect(listA.status).toBe(200);
    expect(listA.body.items).toHaveLength(2);
    expect(listA.body.unreadCount).toBe(2);
    // B sees none of A's
    const listB = await get(b.cookies, 'notifications');
    expect(listB.body.items).toHaveLength(0);
    expect((await get(b.cookies, 'notifications/unread-count')).body.count).toBe(0);
  });

  it('marks one read, then all read', async () => {
    const a = await registerCustomer(`nc_read_${uniq()}@example.bz`);
    const id1 = await seedFor(a.userId);
    await seedFor(a.userId);
    expect((await patch(a.cookies, `notifications/${id1}/read`)).status).toBe(200);
    expect((await get(a.cookies, 'notifications/unread-count')).body.count).toBe(1);
    expect((await patch(a.cookies, 'notifications/read-all')).status).toBe(200);
    expect((await get(a.cookies, 'notifications/unread-count')).body.count).toBe(0);
  });

  it('soft-deletes (dismiss) so it drops from the list', async () => {
    const a = await registerCustomer(`nc_del_${uniq()}@example.bz`);
    const id1 = await seedFor(a.userId);
    await seedFor(a.userId);
    expect((await del(a.cookies, `notifications/${id1}`)).status).toBe(200);
    const list = await get(a.cookies, 'notifications');
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items.some((n: { id: string }) => n.id === id1)).toBe(false);
  });

  it('filters by category and unread', async () => {
    const a = await registerCustomer(`nc_filter_${uniq()}@example.bz`);
    await seedFor(a.userId, { category: 'ORDER' });
    const payId = await seedFor(a.userId, { category: 'PAYMENT', event: 'PAYMENT_AUTHORIZED', title: 'Paid' });
    const pay = await get(a.cookies, 'notifications?category=PAYMENT');
    expect(pay.body.items).toHaveLength(1);
    expect(pay.body.items[0].category).toBe('PAYMENT');
    await patch(a.cookies, `notifications/${payId}/read`);
    const unread = await get(a.cookies, 'notifications?unread=true');
    expect(unread.body.items.every((n: { read: boolean }) => !n.read)).toBe(true);
    expect(unread.body.items).toHaveLength(1); // only the ORDER one remains unread
  });

  it('paginates with a cursor', async () => {
    const a = await registerCustomer(`nc_page_${uniq()}@example.bz`);
    for (let i = 0; i < 25; i += 1) await seedFor(a.userId);
    const p1 = await get(a.cookies, 'notifications?limit=10');
    expect(p1.body.items).toHaveLength(10);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await get(a.cookies, `notifications?limit=10&cursor=${p1.body.nextCursor}`);
    expect(p2.body.items).toHaveLength(10);
    // no overlap between pages
    const ids1 = new Set(p1.body.items.map((n: { id: string }) => n.id));
    expect(p2.body.items.some((n: { id: string }) => ids1.has(n.id))).toBe(false);
  });

  it('reads and updates per-category preferences', async () => {
    const a = await registerCustomer(`nc_pref_${uniq()}@example.bz`);
    const prefs = await get(a.cookies, 'notifications/preferences');
    expect(prefs.status).toBe(200);
    expect(prefs.body.length).toBeGreaterThanOrEqual(10); // one per category
    expect(prefs.body.every((p: { inApp: boolean }) => p.inApp === true)).toBe(true);
    const upd = await put(a.cookies, 'notifications/preferences', { category: 'ORDER', email: true, inApp: false });
    expect(upd.status).toBe(200);
    const order = upd.body.find((p: { category: string }) => p.category === 'ORDER');
    expect(order).toMatchObject({ email: true, inApp: false });
  });

  it('fan-out: one event to many recipients has independent read state', async () => {
    const a = await registerCustomer(`nc_fan_a_${uniq()}@example.bz`);
    const b = await registerCustomer(`nc_fan_b_${uniq()}@example.bz`);
    const event = await ctx.prisma.notification.create({
      data: { type: 'SECURITY', category: 'ADMIN_ALERT', event: 'ADMIN_ROLE_APPLICATION', title: 'Alert', body: 'x', recipients: { create: [{ userId: a.userId }, { userId: b.userId }] } },
      include: { recipients: true },
    });
    expect(event.recipients).toHaveLength(2);
    const aRecip = event.recipients.find((r) => r.userId === a.userId)!;
    // A marks read → B still unread; both still see the same event
    await patch(a.cookies, `notifications/${aRecip.id}/read`);
    expect((await get(a.cookies, 'notifications/unread-count')).body.count).toBe(0);
    expect((await get(b.cookies, 'notifications/unread-count')).body.count).toBe(1);
    expect((await get(b.cookies, 'notifications')).body.items[0].notificationId).toBe(event.id);
  });

  it('cannot mark or delete another user\'s notification', async () => {
    const a = await registerCustomer(`nc_x_a_${uniq()}@example.bz`);
    const b = await registerCustomer(`nc_x_b_${uniq()}@example.bz`);
    const aId = await seedFor(a.userId);
    // B attempts to read/delete A's recipient — no-op (200 but A's state unchanged)
    await patch(b.cookies, `notifications/${aId}/read`);
    await del(b.cookies, `notifications/${aId}`);
    expect((await get(a.cookies, 'notifications/unread-count')).body.count).toBe(1);
    expect((await get(a.cookies, 'notifications')).body.items).toHaveLength(1);
  });
});
