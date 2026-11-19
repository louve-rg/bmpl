/**
 * FIN-REGRESSION: the end-to-end cross-company layer the owner named by
 * hand, distinct from `terminal-staff-api.integration.spec.ts`'s own
 * unit-shaped coverage (lines 360-393, 434-449) in what it actually checks.
 * Pam's spec asserts each refusal against a literal expected string. This
 * file never hardcodes the refusal text at all — it fires BOTH triggers in
 * the same test (a real member/invite belonging to a DIFFERENT company, and
 * a syntactically-valid id that was never created) and asserts the two live
 * HTTP responses are byte-identical to EACH OTHER: same status, same body,
 * key-for-key. That identity is the entire protection this card is about —
 * a caller must never be able to tell "that id belongs to someone else" from
 * "that id was never real." A test that only checked the status code would
 * keep passing even if someone made the two messages diverge, or added a
 * field to one branch and not the other; this one would not.
 *
 * Mirrors `terminal-staff-api.integration.spec.ts`'s own fixture shapes
 * (duplicated, not imported — same module-private convention every spec
 * file in this suite already follows).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const patch = (c: string[], p: string, b: object = {}) => request(ctx.server).patch(`/api/${p}`).set('Cookie', c).send(b);
const del = (c: string[], p: string) => request(ctx.server).delete(`/api/${p}`).set('Cookie', c);

// Syntactically valid (cuid-shaped) but never created — same convention
// `terminal-staff-api.integration.spec.ts` already uses for this exact
// purpose (its own `'cabcdefghijklmnopqrstuvwx'` for a locationId), just
// generated fresh per call so two made-up-id assertions never collide.
const fakeCuid = () => `c${uniq().padEnd(24, '0')}`.slice(0, 25);

const tokenFromBody = (body: string) => /token=([A-Za-z0-9_-]+)/.exec(body)?.[1];

async function makeHub(code: string) {
  return ctx.prisma.logisticsHub.create({
    data: {
      code,
      name: `${code} Terminal`,
      type: 'BMPL_HUB',
      district: 'BELIZE',
      city: 'Belize City',
      modes: ['LAND'],
      isActive: true,
      isTest: false,
      courierFeeMinor: 500n,
    },
  });
}

async function readLastEmailLinkToken(toEmail: string): Promise<string> {
  const inbox = await request(ctx.server).get('/api/dev/emails/latest').query({ email: toEmail });
  expect(inbox.status).toBe(200);
  const token = tokenFromBody(inbox.body.body);
  if (!token) throw new Error(`No token found in email to ${toEmail}: ${JSON.stringify(inbox.body)}`);
  return token;
}

async function inviteAndAccept(companyId: string, locationIds: string[], memberRole: 'MANAGER' | 'OPERATOR') {
  const email = `member_${uniq()}@example.com`;
  await post(admin, `admin/terminal/companies/${companyId}/invites`, { email, memberRole, locationIds });
  const token = await readLastEmailLinkToken(email);
  await request(ctx.server).post('/api/terminal/invites/accept').send({ token, password: 'MemberPass123', firstName: 'M', lastName: 'E' });
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  const cookies = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email, password: 'MemberPass123' }));
  return { email, userId: user.id, cookies };
}

async function makeCompanyWithLocation(prefix: string) {
  const hub = await makeHub(`${prefix}-${uniq()}`);
  const company = (
    await post(admin, 'admin/terminal/companies', { businessName: `${prefix} Co`, contactEmail: `${prefix.toLowerCase()}_${uniq()}@example.com` })
  ).body;
  const loc = (await post(admin, `admin/terminal/companies/${company.id}/locations`, { hubId: hub.id })).body;
  return { hub, company, loc };
}

/** The one assertion this whole file exists to make: two live responses
 *  must be indistinguishable, not merely each individually plausible. */
function expectIdenticalRefusals(real: request.Response, madeUp: request.Response) {
  expect(real.status).toBe(madeUp.status);
  expect(real.body).toEqual(madeUp.body);
  expect(Object.keys(real.body).sort()).toEqual(Object.keys(madeUp.body).sort());
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password }));
});

afterAll(async () => {
  await ctx.app.close();
});

describe('FIN-REGRESSION: cross-company member-id refusal is byte-identical to a made-up-id refusal', () => {
  it('PATCH /terminal/staff/:userId/role', async () => {
    const a = await makeCompanyWithLocation('XRoleA');
    const b = await makeCompanyWithLocation('XRoleB');
    const managerA = await inviteAndAccept(a.company.id, [a.loc.id], 'MANAGER');
    const managerB = await inviteAndAccept(b.company.id, [b.loc.id], 'MANAGER');

    const real = await patch(managerA.cookies, `terminal/staff/${managerB.userId}/role`, { memberRole: 'OPERATOR' });
    const madeUp = await patch(managerA.cookies, `terminal/staff/${fakeCuid()}/role`, { memberRole: 'OPERATOR' });
    expectIdenticalRefusals(real, madeUp);
    expect(real.status).toBe(404);

    // Company B's own manager is untouched — the refusal happened before
    // company B's row was ever reached, not after a reversible write.
    const row = await ctx.prisma.terminalCompanyMember.findUniqueOrThrow({
      where: { terminalCompanyId_userId: { terminalCompanyId: b.company.id, userId: managerB.userId } },
    });
    expect(row.memberRole).toBe('MANAGER');
  });

  it('POST /terminal/staff/:userId/deactivate', async () => {
    const a = await makeCompanyWithLocation('XDeactA');
    const b = await makeCompanyWithLocation('XDeactB');
    const managerA = await inviteAndAccept(a.company.id, [a.loc.id], 'MANAGER');
    const managerB = await inviteAndAccept(b.company.id, [b.loc.id], 'MANAGER');

    const real = await post(managerA.cookies, `terminal/staff/${managerB.userId}/deactivate`, {});
    const madeUp = await post(managerA.cookies, `terminal/staff/${fakeCuid()}/deactivate`, {});
    expectIdenticalRefusals(real, madeUp);
    expect(real.status).toBe(404);

    const row = await ctx.prisma.terminalCompanyMember.findUniqueOrThrow({
      where: { terminalCompanyId_userId: { terminalCompanyId: b.company.id, userId: managerB.userId } },
    });
    expect(row.status).toBe('ACTIVE');
  });

  it('POST /terminal/staff/:userId/locations (grant)', async () => {
    const a = await makeCompanyWithLocation('XGrantA');
    const b = await makeCompanyWithLocation('XGrantB');
    const managerA = await inviteAndAccept(a.company.id, [a.loc.id], 'MANAGER');
    const managerB = await inviteAndAccept(b.company.id, [b.loc.id], 'MANAGER');

    // a.loc.id is a real, valid-shaped location id (company A's own) —
    // irrelevant to the outcome either way, since the target-member lookup
    // is keyed on userId and fails before the locationId is ever read.
    const real = await post(managerA.cookies, `terminal/staff/${managerB.userId}/locations`, { locationId: a.loc.id });
    const madeUp = await post(managerA.cookies, `terminal/staff/${fakeCuid()}/locations`, { locationId: a.loc.id });
    expectIdenticalRefusals(real, madeUp);
    expect(real.status).toBe(404);
  });

  it('DELETE /terminal/staff/:userId/locations/:locationId (revoke)', async () => {
    const a = await makeCompanyWithLocation('XRevokeA');
    const b = await makeCompanyWithLocation('XRevokeB');
    const managerA = await inviteAndAccept(a.company.id, [a.loc.id], 'MANAGER');
    const managerB = await inviteAndAccept(b.company.id, [b.loc.id], 'MANAGER');

    const real = await del(managerA.cookies, `terminal/staff/${managerB.userId}/locations/${a.loc.id}`);
    const madeUp = await del(managerA.cookies, `terminal/staff/${fakeCuid()}/locations/${a.loc.id}`);
    expectIdenticalRefusals(real, madeUp);
    expect(real.status).toBe(404);

    const grant = await ctx.prisma.terminalCompanyMemberLocation.findFirst({
      where: { location: { id: b.loc.id }, member: { userId: managerB.userId } },
    });
    expect(grant).not.toBeNull();
  });
});

describe('FIN-REGRESSION: cross-company invite-id refusal is byte-identical to a made-up-id refusal', () => {
  it('POST /terminal/staff/invites/:inviteId/revoke', async () => {
    const a = await makeCompanyWithLocation('XInvRevA');
    const b = await makeCompanyWithLocation('XInvRevB');
    const managerA = await inviteAndAccept(a.company.id, [a.loc.id], 'MANAGER');
    const managerB = await inviteAndAccept(b.company.id, [b.loc.id], 'MANAGER');
    const bInvite = await post(managerB.cookies, 'terminal/staff/invite', { email: `xinv_${uniq()}@example.com`, locationIds: [b.loc.id] });
    expect(bInvite.status).toBe(201);

    const real = await post(managerA.cookies, `terminal/staff/invites/${bInvite.body.id}/revoke`, {});
    const madeUp = await post(managerA.cookies, `terminal/staff/invites/${fakeCuid()}/revoke`, {});
    expectIdenticalRefusals(real, madeUp);
    expect(real.status).toBe(404);

    const row = await ctx.prisma.terminalCompanyInvite.findUniqueOrThrow({ where: { id: bInvite.body.id } });
    expect(row.revokedAt).toBeNull();
  });

  it('POST /terminal/staff/invites/:inviteId/resend', async () => {
    const a = await makeCompanyWithLocation('XInvResA');
    const b = await makeCompanyWithLocation('XInvResB');
    const managerA = await inviteAndAccept(a.company.id, [a.loc.id], 'MANAGER');
    const managerB = await inviteAndAccept(b.company.id, [b.loc.id], 'MANAGER');
    const email = `xinvres_${uniq()}@example.com`;
    const bInvite = await post(managerB.cookies, 'terminal/staff/invite', { email, locationIds: [b.loc.id] });
    expect(bInvite.status).toBe(201);

    const real = await post(managerA.cookies, `terminal/staff/invites/${bInvite.body.id}/resend`, {});
    const madeUp = await post(managerA.cookies, `terminal/staff/invites/${fakeCuid()}/resend`, {});
    expectIdenticalRefusals(real, madeUp);
    expect(real.status).toBe(404);

    // Company B's own invite was never rotated by the refused attempt.
    const before = await ctx.prisma.terminalCompanyInvite.findUniqueOrThrow({ where: { id: bInvite.body.id } });
    expect(before.revokedAt).toBeNull();
  });
});
