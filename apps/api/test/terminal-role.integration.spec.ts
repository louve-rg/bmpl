/**
 * MDF-698 (TERM-ROLE): `memberRole` (MANAGER | OPERATOR) was invited, stored
 * and serialized but never enforced anywhere — `grep "'MANAGER'"
 * apps/api/src` (excluding specs) returned nothing before this card. This
 * file proves the one enforcement point this card adds:
 * `TerminalService.assertActiveMemberRole`, consumed by the one MANAGER-only
 * endpoint this card wires up, `GET /terminal/staff`.
 *
 * By design, MANAGER is a strict superset of OPERATOR — there are only the
 * two roles, and the split gives MANAGER additional capabilities without
 * taking anything away from OPERATOR. So this file also proves the negative
 * of that: a MANAGER is never blocked from an OPERATOR-level read either.
 * The five existing physical-operation endpoints (depart/arrive/handoff/
 * release-to-courier/collect) are deliberately NOT touched by this card —
 * every one of them is already exercised by an OPERATOR-role fixture in
 * terminal-queue.integration.spec.ts and shipping-handoff-reversal.
 * integration.spec.ts, and this file does not re-test them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);

async function registerCustomer(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  return cookiesOf(reg);
}

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

const tokenFromBody = (body: string) => /token=([A-Za-z0-9_-]+)/.exec(body)?.[1];

async function readLastEmailLinkToken(toEmail: string): Promise<string> {
  const inbox = await request(ctx.server).get('/api/dev/emails/latest').query({ email: toEmail });
  expect(inbox.status).toBe(200);
  const token = tokenFromBody(inbox.body.body);
  if (!token) throw new Error(`No token found in email to ${toEmail}: ${JSON.stringify(inbox.body)}`);
  return token;
}

/** Invite + accept, end to end — same helper `terminal.integration.spec.ts`
 *  uses, duplicated here (not imported) because that file keeps its helpers
 *  module-private, same as every other spec file in this suite. */
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

describe('MDF-698 (TERM-ROLE): GET /terminal/staff is MANAGER-only', () => {
  it('a MANAGER reads their own company\'s staff roster, including themself and a pending invite, but never an invite token', async () => {
    const { company, loc } = await makeCompanyWithLocation('Staff');
    const manager = await inviteAndAccept(company.id, [loc.id], 'MANAGER');

    const pendingEmail = `pending_${uniq()}@example.com`;
    const pendingInvite = await post(admin, `admin/terminal/companies/${company.id}/invites`, {
      email: pendingEmail,
      memberRole: 'OPERATOR',
      locationIds: [loc.id],
    });
    expect(pendingInvite.status).toBe(201);

    const res = await get(manager.cookies, 'terminal/staff');
    expect(res.status).toBe(200);

    expect(res.body.members).toHaveLength(1);
    expect(res.body.members[0].userId).toBe(manager.userId);
    expect(res.body.members[0].memberRole).toBe('MANAGER');
    expect(res.body.members[0].email).toBe(manager.email);

    expect(res.body.pendingInvites).toHaveLength(1);
    expect(res.body.pendingInvites[0].email).toBe(pendingEmail);
    expect(res.body.pendingInvites[0].memberRole).toBe('OPERATOR');
    // Never the raw token or its hash — only existence and metadata.
    const inviteKeys = Object.keys(res.body.pendingInvites[0]);
    expect(inviteKeys).not.toContain('token');
    expect(inviteKeys).not.toContain('tokenHash');
    expect(JSON.stringify(res.body)).not.toMatch(/token/i);
  });

  it('an OPERATOR is refused the staff roster — the enforcement this card adds', async () => {
    const { company, loc } = await makeCompanyWithLocation('OpRefused');
    const operator = await inviteAndAccept(company.id, [loc.id], 'OPERATOR');

    const res = await get(operator.cookies, 'terminal/staff');
    expect(res.status).toBe(403);
  });

  it('a plain customer with no terminal membership gets 403, not a crash', async () => {
    const cookies = await registerCustomer(`plain_${uniq()}@example.com`);
    const res = await get(cookies, 'terminal/staff');
    expect(res.status).toBe(403);
  });

  it('a MANAGER sees only their own company\'s staff, never another company\'s', async () => {
    const a = await makeCompanyWithLocation('StaffA');
    const b = await makeCompanyWithLocation('StaffB');
    const managerA = await inviteAndAccept(a.company.id, [a.loc.id], 'MANAGER');
    await inviteAndAccept(b.company.id, [b.loc.id], 'OPERATOR'); // seeds company B with its own staff

    const res = await get(managerA.cookies, 'terminal/staff');
    expect(res.status).toBe(200);
    expect(res.body.members).toHaveLength(1);
    expect(res.body.members[0].userId).toBe(managerA.userId);
    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toContain(b.company.id);
  });
});

describe('MDF-698 (TERM-ROLE): MANAGER is a strict superset of OPERATOR', () => {
  it('a MANAGER can still read the OPERATOR-level workspace and queue — the split never takes anything away', async () => {
    const { company, loc } = await makeCompanyWithLocation('Superset');
    const manager = await inviteAndAccept(company.id, [loc.id], 'MANAGER');

    const me = await get(manager.cookies, 'terminal/me');
    expect(me.status).toBe(200);
    expect(me.body.memberRole).toBe('MANAGER');

    const queue = await get(manager.cookies, 'terminal/queue');
    expect(queue.status).toBe(200);
  });
});
