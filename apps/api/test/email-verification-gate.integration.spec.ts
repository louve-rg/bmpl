/**
 * Verified email gates provider-type roles — against real Postgres.
 *
 * The owner's ruling, both halves: a user must verify their email before
 * APPLYING FOR or ACTIVATING a provider-type role (vendor, drivers,
 * operators, employer, real-estate, marketing) — and ordinary customer use
 * must notice nothing. Both halves are pinned here, because the second is as
 * easy to regress as the first.
 *
 * The gate CONSUMES the existing verification state (User.emailVerifiedAt);
 * the positive path below earns it through the real product flow — register,
 * read the (dev) inbox, follow the link — so this spec would also catch the
 * gate being pointed at some new parallel flag.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, type TestContext } from './helpers';

let ctx: TestContext;
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;
const tokenFromBody = (body: string) => /token=([A-Za-z0-9_-]+)/.exec(body)?.[1];

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);

/** A freshly registered account — unverified BY THE PRODUCT'S OWN STATE. */
async function registerUnverified() {
  const email = `evg_${uniq()}@example.bz`;
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'G', lastName: 'T', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  expect(user.emailVerifiedAt).toBeNull();
  return { cookies: cookiesOf(reg), userId: user.id, email };
}

/** Verify through the real flow: the token delivered to the dev inbox. */
async function verifyThroughTheProduct(email: string) {
  const inbox = await request(ctx.server).get('/api/dev/emails/latest').query({ email });
  expect(inbox.status).toBe(200);
  const token = tokenFromBody(inbox.body.body);
  expect(token).toBeTruthy();
  expect((await request(ctx.server).post('/api/auth/verify-email').send({ token })).status).toBe(201);
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
});

afterAll(async () => {
  await ctx.app.close();
});

describe('applying', () => {
  it('an unverified account cannot apply for a provider-type role — and verifying through the product unlocks it', async () => {
    const u = await registerUnverified();

    // Refused with the reason in place of the action — words a person can act on.
    const refused = await post(u.cookies, 'roles/applications', { roleCode: 'MARKETING_CLIENT', documentKeys: [] });
    expect(refused.status).toBe(403);
    expect(refused.body.message).toMatch(/verify your email/i);
    // Nothing was created: no role row, no application. If the gate were
    // removed, THESE are the assertions that fail.
    expect(await ctx.prisma.userRole.count({ where: { userId: u.userId, roleCode: 'MARKETING_CLIENT' } })).toBe(0);
    expect(await ctx.prisma.roleApplication.count({ where: { userId: u.userId } })).toBe(0);

    // The catalog says so up front, not only at submit.
    const catalog = await get(u.cookies, 'roles/applicable');
    expect(catalog.status).toBe(200);
    const marketing = catalog.body.find((r: { roleCode: string }) => r.roleCode === 'MARKETING_CLIENT');
    expect(marketing.requiresVerifiedEmail).toBe(true);

    // Verify the REAL way — inbox, link, token — and the same submit stands
    // (this role's only listed document requirement is enforced downstream;
    // reaching a non-verification refusal or a success both prove the gate
    // itself has opened).
    await verifyThroughTheProduct(u.email);
    const after = await post(u.cookies, 'roles/applications', { roleCode: 'MARKETING_CLIENT', documentKeys: [] });
    expect(after.status).not.toBe(403);
  });

  it('every provider-type role refuses; the consumer-shaped ones stay open', async () => {
    const u = await registerUnverified();
    for (const roleCode of ['VENDOR', 'DELIVERY_DRIVER', 'SHIPPING_PROVIDER', 'PASSENGER_DRIVER', 'PASSENGER_PROVIDER', 'EMPLOYER', 'REAL_ESTATE_AGENT', 'PROPERTY_OWNER', 'MARKETING_CLIENT']) {
      const r = await post(u.cookies, 'roles/applications', { roleCode, documentKeys: [] });
      expect(r.status, roleCode).toBe(403);
      expect(r.body.message, roleCode).toMatch(/verify your email/i);
    }
    // JOB_SEEKER is a person LOOKING for work — ordinary use of the product,
    // deliberately outside the gate, and auto-approved as before.
    const seeker = await post(u.cookies, 'roles/applications', { roleCode: 'JOB_SEEKER', documentKeys: [] });
    expect(seeker.status).toBe(201);
    expect(seeker.body.autoApproved).toBe(true);
  });

  it('ordinary customer use notices nothing', async () => {
    const u = await registerUnverified();
    // Browsing, cart, own account — the surfaces a plain customer touches —
    // answer an unverified account exactly as before.
    expect((await get(u.cookies, 'cart')).status).toBe(200);
    expect((await get(u.cookies, 'me')).status).toBe(200);
    expect((await get(u.cookies, 'orders')).status).toBe(200);
    expect((await post(u.cookies, 'roles/switch', { roleCode: 'CUSTOMER' })).status).toBe(201);
  });
});

describe('activating', () => {
  it('an approved-but-unverified provider role cannot be ACTIVATED until the email is verified', async () => {
    const u = await registerUnverified();
    // An account approved before this rule existed: the role row is created
    // directly because no product path can produce approved-plus-unverified
    // any more — that is the point of the apply-side gate above.
    await ctx.prisma.userRole.create({ data: { userId: u.userId, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });

    const refused = await post(u.cookies, 'roles/switch', { roleCode: 'VENDOR' });
    expect(refused.status).toBe(403);
    expect(refused.body.message).toMatch(/verify your email/i);
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: u.userId } })).activeRoleCode).not.toBe('VENDOR');

    // Their customer life is untouched while unverified…
    expect((await post(u.cookies, 'roles/switch', { roleCode: 'CUSTOMER' })).status).toBe(201);

    // …and verification, done the real way, unlocks the switch.
    await verifyThroughTheProduct(u.email);
    const after = await post(u.cookies, 'roles/switch', { roleCode: 'VENDOR' });
    expect(after.status).toBe(201);
    expect(after.body.activeRole).toBe('VENDOR');
  });
});
