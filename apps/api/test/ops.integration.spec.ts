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
const uniq = () => `${Date.now()}_${(seq += 1)}`;

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const patch = (c: string[], p: string, b: unknown) => request(ctx.server).patch(`/api/${p}`).set('Cookie', c).send(b);

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
