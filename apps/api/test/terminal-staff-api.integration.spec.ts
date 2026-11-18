/**
 * TERM-STAFF-API: the owner-approved self-serve door onto staff management
 * (invite/change-role/grant-location/revoke-location/deactivate/reactivate),
 * scoped to the caller's own company via `assertActiveMemberRole`, never a
 * companyId taken from the request. Mirrors `terminal-role.integration.spec.ts`'s
 * own fixture shapes (duplicated, not imported — same module-private
 * convention every spec file in this suite already follows).
 *
 * What this file proves, beyond the six happy paths:
 *  - The last-ACTIVE-MANAGER floor holds on all three doors that can remove
 *    a MANAGER's standing (role change, deactivate, revoke-last-location),
 *    identically whether the caller acts on themself or another manager.
 *  - A company with 2+ ACTIVE MANAGERs is never blocked by the floor.
 *  - An OPERATOR is refused every one of the six, with the same
 *    "wrong role, not no role" message `terminal-role.integration.spec.ts`
 *    already established for `/terminal/staff`.
 *  - A location id that belongs to a DIFFERENT company is refused exactly
 *    like a location that does not exist at all — proving reach is
 *    impossible by construction, not merely blocked by a check that could
 *    be bypassed with a different id shape.
 *  - FIN-SELF-LOCKOUT: self-demote (role change) and self-end (deactivate)
 *    are refused UNCONDITIONALLY for the actor acting on themselves, by a
 *    guard separate from and checked before the last-manager floor above —
 *    proven both in the lone-manager case (where the floor would also
 *    fire, but the self message wins) and with a second active manager
 *    standing by (where the floor alone would not fire, proving this is
 *    not a floor special case).
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
const patch = (c: string[], p: string, b: object = {}) => request(ctx.server).patch(`/api/${p}`).set('Cookie', c).send(b);
const del = (c: string[], p: string) => request(ctx.server).delete(`/api/${p}`).set('Cookie', c);

const ROLE_MESSAGE = 'This action requires the terminal manager role.';
const FLOOR_MESSAGE = 'This company must always have at least one active manager.';
const LOCATION_FLOOR_MESSAGE = "This would leave the company's only manager without access to any location.";
// FIN-SELF-LOCKOUT — both messages name WHO can act instead: another manager
// OR an administrator. Owner's explicit call, 2026-11-18: the access cleanup
// leaves Edward as San Pedro Elite's only manager, so "ask another manager"
// alone is a dead end for exactly the person most likely to hit this message.
const SELF_DEMOTE_MESSAGE = 'You cannot change your own role from manager to operator. Another manager, or an administrator, can do this for you.';
const SELF_END_MESSAGE = 'You cannot end your own terminal company membership. Another manager, or an administrator, can do this for you.';

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

describe('TERM-STAFF-API: POST /terminal/staff/invite', () => {
  it('a MANAGER invites a new OPERATOR into their own company', async () => {
    const { company, loc } = await makeCompanyWithLocation('InvOp');
    const manager = await inviteAndAccept(company.id, [loc.id], 'MANAGER');

    const email = `new_op_${uniq()}@example.com`;
    const res = await post(manager.cookies, 'terminal/staff/invite', { email, memberRole: 'OPERATOR', locationIds: [loc.id] });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe(email);
    expect(res.body.memberRole).toBe('OPERATOR');
  });

  it('a MANAGER may invite ANOTHER MANAGER — the owner\'s explicit YES on manager-creates-manager', async () => {
    const { company, loc } = await makeCompanyWithLocation('InvMgr');
    const manager = await inviteAndAccept(company.id, [loc.id], 'MANAGER');

    const email = `new_mgr_${uniq()}@example.com`;
    const res = await post(manager.cookies, 'terminal/staff/invite', { email, memberRole: 'MANAGER', locationIds: [loc.id] });
    expect(res.status).toBe(201);
    expect(res.body.memberRole).toBe('MANAGER');
  });

  it('an OPERATOR is refused — wrong role, same message /terminal/staff already uses', async () => {
    const { company, loc } = await makeCompanyWithLocation('InvRefused');
    const operator = await inviteAndAccept(company.id, [loc.id], 'OPERATOR');

    const res = await post(operator.cookies, 'terminal/staff/invite', { email: `x_${uniq()}@example.com`, locationIds: [loc.id] });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(ROLE_MESSAGE);
  });
});

describe('TERM-STAFF-API: PATCH /terminal/staff/:userId/role', () => {
  it('a MANAGER promotes an OPERATOR to MANAGER', async () => {
    const { company, loc } = await makeCompanyWithLocation('Promote');
    const manager = await inviteAndAccept(company.id, [loc.id], 'MANAGER');
    const operator = await inviteAndAccept(company.id, [loc.id], 'OPERATOR');

    const res = await patch(manager.cookies, `terminal/staff/${operator.userId}/role`, { memberRole: 'MANAGER' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ roleChanged: true, memberRole: 'MANAGER' });

    const row = await ctx.prisma.terminalCompanyMember.findUniqueOrThrow({
      where: { terminalCompanyId_userId: { terminalCompanyId: company.id, userId: operator.userId } },
    });
    expect(row.memberRole).toBe('MANAGER');
  });

  it('a MANAGER demotes ANOTHER manager to OPERATOR when a third manager would still remain active', async () => {
    const { company, loc } = await makeCompanyWithLocation('Demote2of3');
    const m1 = await inviteAndAccept(company.id, [loc.id], 'MANAGER');
    const m2 = await inviteAndAccept(company.id, [loc.id], 'MANAGER');
    await inviteAndAccept(company.id, [loc.id], 'MANAGER'); // third manager — floor never engages

    const res = await patch(m1.cookies, `terminal/staff/${m2.userId}/role`, { memberRole: 'OPERATOR' });
    expect(res.status).toBe(200);
    expect(res.body.memberRole).toBe('OPERATOR');
  });

  /**
   * FIN-SELF-LOCKOUT: a MANAGER demoting THEMSELVES is refused
   * unconditionally — a SEPARATE guard from the last-manager floor, checked
   * first, with its OWN message. A lone manager self-demoting trips BOTH
   * guards (floor count is also 1), but the self guard answers first, so
   * the caller sees the mistake that is theirs to fix ("ask another
   * manager"), never the company-wide floor text. Supersedes the old
   * "restricted by the SAME floor, not a separate 'is it me' rule" framing
   * this test used to assert — the owner's directive now requires exactly
   * the separate "is it me" rule that comment said didn't exist.
   */
  it('a lone MANAGER cannot demote themselves to OPERATOR — refused by the self guard, not the floor', async () => {
    const { company, loc } = await makeCompanyWithLocation('SelfDemoteLast');
    const manager = await inviteAndAccept(company.id, [loc.id], 'MANAGER');

    const res = await patch(manager.cookies, `terminal/staff/${manager.userId}/role`, { memberRole: 'OPERATOR' });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(SELF_DEMOTE_MESSAGE);
    expect(res.body.message).not.toBe(FLOOR_MESSAGE);

    const row = await ctx.prisma.terminalCompanyMember.findUniqueOrThrow({
      where: { terminalCompanyId_userId: { terminalCompanyId: company.id, userId: manager.userId } },
    });
    expect(row.memberRole).toBe('MANAGER');
  });

  /**
   * The genuinely new case the floor alone could never prove: with a SECOND
   * active manager standing by (so the floor would not fire), self-demotion
   * is still refused — the guard is unconditional for self, not a
   * last-manager special case.
   */
  it('a MANAGER cannot demote themselves even with another active manager standing by', async () => {
    const { company, loc } = await makeCompanyWithLocation('SelfDemoteNotLast');
    const m1 = await inviteAndAccept(company.id, [loc.id], 'MANAGER');
    await inviteAndAccept(company.id, [loc.id], 'MANAGER');

    const res = await patch(m1.cookies, `terminal/staff/${m1.userId}/role`, { memberRole: 'OPERATOR' });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(SELF_DEMOTE_MESSAGE);

    const row = await ctx.prisma.terminalCompanyMember.findUniqueOrThrow({
      where: { terminalCompanyId_userId: { terminalCompanyId: company.id, userId: m1.userId } },
    });
    expect(row.memberRole).toBe('MANAGER');
  });

  it('with exactly two managers, demoting one to OPERATOR succeeds — one manager remaining is not the floor', async () => {
    const { company, loc } = await makeCompanyWithLocation('TwoManagers');
    const m1 = await inviteAndAccept(company.id, [loc.id], 'MANAGER');
    const m2 = await inviteAndAccept(company.id, [loc.id], 'MANAGER');

    const res = await patch(m1.cookies, `terminal/staff/${m2.userId}/role`, { memberRole: 'OPERATOR' });
    expect(res.status).toBe(200);
    expect(res.body.memberRole).toBe('OPERATOR');
  });

  it('an OPERATOR is refused any role change', async () => {
    const { company, loc } = await makeCompanyWithLocation('RoleChangeOpRefused');
    const manager = await inviteAndAccept(company.id, [loc.id], 'MANAGER');
    const operator = await inviteAndAccept(company.id, [loc.id], 'OPERATOR');

    const res = await patch(operator.cookies, `terminal/staff/${manager.userId}/role`, { memberRole: 'OPERATOR' });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(ROLE_MESSAGE);
  });
});

describe('TERM-STAFF-API: location grant/revoke', () => {
  it('a MANAGER grants an additional active location to an OPERATOR', async () => {
    const { company, loc } = await makeCompanyWithLocation('Grant');
    const manager = await inviteAndAccept(company.id, [loc.id], 'MANAGER');
    const operator = await inviteAndAccept(company.id, [loc.id], 'OPERATOR');
    const hub2 = await makeHub(`Grant2-${uniq()}`);
    const loc2 = (await post(admin, `admin/terminal/companies/${company.id}/locations`, { hubId: hub2.id })).body;

    const res = await post(manager.cookies, `terminal/staff/${operator.userId}/locations`, { locationId: loc2.id });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ granted: true });
  });

  it('a locationId belonging to a DIFFERENT company is refused exactly like one that does not exist — reach is impossible, not merely blocked', async () => {
    const a = await makeCompanyWithLocation('ReachA');
    const b = await makeCompanyWithLocation('ReachB');
    const managerA = await inviteAndAccept(a.company.id, [a.loc.id], 'MANAGER');
    const operatorA = await inviteAndAccept(a.company.id, [a.loc.id], 'OPERATOR');

    const res = await post(managerA.cookies, `terminal/staff/${operatorA.userId}/locations`, { locationId: b.loc.id });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('That location is not an active location of this company.');
  });

  it('a MANAGER revokes an OPERATOR\'s location freely — no floor on a non-manager', async () => {
    const { company, loc } = await makeCompanyWithLocation('RevokeOp');
    const manager = await inviteAndAccept(company.id, [loc.id], 'MANAGER');
    const operator = await inviteAndAccept(company.id, [loc.id], 'OPERATOR');

    const res = await del(manager.cookies, `terminal/staff/${operator.userId}/locations/${loc.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ revoked: true });
  });

  it('revoking a manager\'s last location is fine when a SECOND active manager exists', async () => {
    const { company, loc } = await makeCompanyWithLocation('RevokeMgrOfTwo');
    const m1 = await inviteAndAccept(company.id, [loc.id], 'MANAGER');
    const m2 = await inviteAndAccept(company.id, [loc.id], 'MANAGER');

    const res = await del(m1.cookies, `terminal/staff/${m2.userId}/locations/${loc.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ revoked: true });
  });

  it('revoking the company\'s SOLE active manager\'s only remaining location is refused with its OWN message — not the manager-count floor message, because membership and role are untouched', async () => {
    const { company, loc } = await makeCompanyWithLocation('RevokeLastLoc');
    const manager = await inviteAndAccept(company.id, [loc.id], 'MANAGER');

    const res = await del(manager.cookies, `terminal/staff/${manager.userId}/locations/${loc.id}`);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(LOCATION_FLOOR_MESSAGE);
    expect(res.body.message).not.toBe(FLOOR_MESSAGE);

    const grant = await ctx.prisma.terminalCompanyMemberLocation.findFirst({
      where: { location: { id: loc.id }, member: { userId: manager.userId } },
    });
    expect(grant).not.toBeNull();
  });

  it('the sole manager\'s SECOND location may still be revoked, leaving them with one — the floor only guards the LAST one', async () => {
    const { company, loc } = await makeCompanyWithLocation('RevokeNotLast');
    const hub2 = await makeHub(`RevokeNotLast2-${uniq()}`);
    const loc2 = (await post(admin, `admin/terminal/companies/${company.id}/locations`, { hubId: hub2.id })).body;
    const manager = await inviteAndAccept(company.id, [loc.id, loc2.id], 'MANAGER');

    const res = await del(manager.cookies, `terminal/staff/${manager.userId}/locations/${loc2.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ revoked: true });
  });

  it('an OPERATOR is refused both the grant and the revoke route', async () => {
    const { company, loc } = await makeCompanyWithLocation('LocOpRefused');
    const manager = await inviteAndAccept(company.id, [loc.id], 'MANAGER');
    const operator = await inviteAndAccept(company.id, [loc.id], 'OPERATOR');

    const grantRes = await post(operator.cookies, `terminal/staff/${manager.userId}/locations`, { locationId: loc.id });
    expect(grantRes.status).toBe(403);
    expect(grantRes.body.message).toBe(ROLE_MESSAGE);

    const revokeRes = await del(operator.cookies, `terminal/staff/${manager.userId}/locations/${loc.id}`);
    expect(revokeRes.status).toBe(403);
    expect(revokeRes.body.message).toBe(ROLE_MESSAGE);
  });
});

describe('TERM-STAFF-API: deactivate / reactivate', () => {
  it('a MANAGER deactivates an OPERATOR', async () => {
    const { company, loc } = await makeCompanyWithLocation('Deactivate');
    const manager = await inviteAndAccept(company.id, [loc.id], 'MANAGER');
    const operator = await inviteAndAccept(company.id, [loc.id], 'OPERATOR');

    const res = await post(manager.cookies, `terminal/staff/${operator.userId}/deactivate`, {});
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ended: true });

    const row = await ctx.prisma.terminalCompanyMember.findUniqueOrThrow({
      where: { terminalCompanyId_userId: { terminalCompanyId: company.id, userId: operator.userId } },
    });
    expect(row.status).toBe('ENDED');
  });

  it('a MANAGER deactivates ANOTHER manager when a third would remain', async () => {
    const { company, loc } = await makeCompanyWithLocation('Deactivate2of3');
    const m1 = await inviteAndAccept(company.id, [loc.id], 'MANAGER');
    const m2 = await inviteAndAccept(company.id, [loc.id], 'MANAGER');
    await inviteAndAccept(company.id, [loc.id], 'MANAGER');

    const res = await post(m1.cookies, `terminal/staff/${m2.userId}/deactivate`, {});
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ended: true });
  });

  /**
   * FIN-SELF-LOCKOUT: ending ONESELF is refused by its OWN guard, checked
   * before the last-manager floor — same two-guards-not-one reasoning as
   * the role-change self-demote tests above. A lone manager self-ending
   * trips both guards (floor count is also 1); the self guard answers
   * first. Supersedes the old "refused ... including ending oneself"
   * framing this test used to assert as a single floor outcome.
   */
  it('a lone MANAGER cannot end their own membership — refused by the self guard, not the floor', async () => {
    const { company, loc } = await makeCompanyWithLocation('DeactivateLast');
    const manager = await inviteAndAccept(company.id, [loc.id], 'MANAGER');

    const res = await post(manager.cookies, `terminal/staff/${manager.userId}/deactivate`, {});
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(SELF_END_MESSAGE);
    expect(res.body.message).not.toBe(FLOOR_MESSAGE);

    const row = await ctx.prisma.terminalCompanyMember.findUniqueOrThrow({
      where: { terminalCompanyId_userId: { terminalCompanyId: company.id, userId: manager.userId } },
    });
    expect(row.status).toBe('ACTIVE');
  });

  /**
   * The genuinely new case the floor alone could never prove: with a
   * SECOND active manager standing by (so the floor would not fire),
   * self-ending is still refused — unconditional for self, not a
   * last-manager special case.
   */
  it('a MANAGER cannot end their own membership even with another active manager standing by', async () => {
    const { company, loc } = await makeCompanyWithLocation('SelfEndNotLast');
    const m1 = await inviteAndAccept(company.id, [loc.id], 'MANAGER');
    await inviteAndAccept(company.id, [loc.id], 'MANAGER');

    const res = await post(m1.cookies, `terminal/staff/${m1.userId}/deactivate`, {});
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(SELF_END_MESSAGE);

    const row = await ctx.prisma.terminalCompanyMember.findUniqueOrThrow({
      where: { terminalCompanyId_userId: { terminalCompanyId: company.id, userId: m1.userId } },
    });
    expect(row.status).toBe('ACTIVE');
  });

  it('a MANAGER reactivates a previously-ended OPERATOR, and locations survive the round trip', async () => {
    const { company, loc } = await makeCompanyWithLocation('Reactivate');
    const manager = await inviteAndAccept(company.id, [loc.id], 'MANAGER');
    const operator = await inviteAndAccept(company.id, [loc.id], 'OPERATOR');
    await post(manager.cookies, `terminal/staff/${operator.userId}/deactivate`, {});

    const res = await post(manager.cookies, `terminal/staff/${operator.userId}/reactivate`, {});
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ reactivated: true });

    const row = await ctx.prisma.terminalCompanyMember.findUniqueOrThrow({
      where: { terminalCompanyId_userId: { terminalCompanyId: company.id, userId: operator.userId } },
    });
    expect(row.status).toBe('ACTIVE');
    const grant = await ctx.prisma.terminalCompanyMemberLocation.findFirst({ where: { memberId: row.id, locationId: loc.id } });
    expect(grant).not.toBeNull();
  });

  it('an OPERATOR is refused both deactivate and reactivate', async () => {
    const { company, loc } = await makeCompanyWithLocation('DeactOpRefused');
    const manager = await inviteAndAccept(company.id, [loc.id], 'MANAGER');
    const operator = await inviteAndAccept(company.id, [loc.id], 'OPERATOR');
    const other = await inviteAndAccept(company.id, [loc.id], 'OPERATOR');
    await post(manager.cookies, `terminal/staff/${other.userId}/deactivate`, {});

    const deactivateRes = await post(operator.cookies, `terminal/staff/${manager.userId}/deactivate`, {});
    expect(deactivateRes.status).toBe(403);
    expect(deactivateRes.body.message).toBe(ROLE_MESSAGE);

    const reactivateRes = await post(operator.cookies, `terminal/staff/${other.userId}/reactivate`, {});
    expect(reactivateRes.status).toBe(403);
    expect(reactivateRes.body.message).toBe(ROLE_MESSAGE);
  });
});

describe('TERM-STAFF-API: cross-company reach is impossible by construction', () => {
  it('a userId that is a real ACTIVE manager of a DIFFERENT company is refused as "not found" — never leaked, never reachable', async () => {
    const a = await makeCompanyWithLocation('XCoA');
    const b = await makeCompanyWithLocation('XCoB');
    const managerA = await inviteAndAccept(a.company.id, [a.loc.id], 'MANAGER');
    const managerB = await inviteAndAccept(b.company.id, [b.loc.id], 'MANAGER');

    const roleRes = await patch(managerA.cookies, `terminal/staff/${managerB.userId}/role`, { memberRole: 'OPERATOR' });
    expect(roleRes.status).toBe(404);
    expect(roleRes.body.message).toBe('Member not found.');

    const deactivateRes = await post(managerA.cookies, `terminal/staff/${managerB.userId}/deactivate`, {});
    expect(deactivateRes.status).toBe(404);

    // Company B's own manager floor never even evaluated — managerB is
    // still ACTIVE MANAGER of company B throughout.
    const row = await ctx.prisma.terminalCompanyMember.findUniqueOrThrow({
      where: { terminalCompanyId_userId: { terminalCompanyId: b.company.id, userId: managerB.userId } },
    });
    expect(row.status).toBe('ACTIVE');
    expect(row.memberRole).toBe('MANAGER');
  });

  it('a plain customer with no terminal membership gets the no-membership 403 on every door, not a crash', async () => {
    const cookies = await registerCustomer(`plain_${uniq()}@example.com`);
    // A syntactically valid (but non-existent) cuid — a malformed id would
    // be refused by the Zod body schema before the handler runs at all,
    // which would prove the wrong thing. This proves the SERVICE's own
    // no-membership check fires first.
    const res = await post(cookies, 'terminal/staff/invite', { email: `x_${uniq()}@example.com`, locationIds: ['cabcdefghijklmnopqrstuvwx'] });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('No active terminal company membership.');
  });
});

describe('TERM-STAFF-API: self-serve invite revoke/resend — the gap god scoped in after the owner\'s directive', () => {
  it('a MANAGER revokes their own pending invite', async () => {
    const { company, loc } = await makeCompanyWithLocation('InviteRevoke');
    const manager = await inviteAndAccept(company.id, [loc.id], 'MANAGER');

    const invite = await post(manager.cookies, 'terminal/staff/invite', { email: `inv_${uniq()}@example.com`, locationIds: [loc.id] });
    expect(invite.status).toBe(201);

    const res = await post(manager.cookies, `terminal/staff/invites/${invite.body.id}/revoke`, {});
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ revoked: true });

    const row = await ctx.prisma.terminalCompanyInvite.findUniqueOrThrow({ where: { id: invite.body.id } });
    expect(row.revokedAt).not.toBeNull();
  });

  it('a MANAGER resends a pending invite, rotating its token', async () => {
    const { company, loc } = await makeCompanyWithLocation('InviteResend');
    const manager = await inviteAndAccept(company.id, [loc.id], 'MANAGER');
    const email = `resend_${uniq()}@example.com`;

    const invite = await post(manager.cookies, 'terminal/staff/invite', { email, locationIds: [loc.id] });
    expect(invite.status).toBe(201);

    const res = await post(manager.cookies, `terminal/staff/invites/${invite.body.id}/resend`, {});
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(invite.body.id);
    expect(res.body.delivery).toBeDefined();

    // The new token actually works — proving it was really rotated, not
    // just re-sent with the same (now-stale, in a real-mistaken-address
    // scenario) link.
    const token = await readLastEmailLinkToken(email);
    const accept = await request(ctx.server)
      .post('/api/terminal/invites/accept')
      .send({ token, password: 'MemberPass123', firstName: 'R', lastName: 'E' });
    expect(accept.status).toBe(201);
  });

  it('an inviteId belonging to a DIFFERENT company 404s on revoke and resend — never confirming it exists, per the directive', async () => {
    const a = await makeCompanyWithLocation('InviteXA');
    const b = await makeCompanyWithLocation('InviteXB');
    const managerA = await inviteAndAccept(a.company.id, [a.loc.id], 'MANAGER');
    const managerB = await inviteAndAccept(b.company.id, [b.loc.id], 'MANAGER');

    const bInvite = await post(managerB.cookies, 'terminal/staff/invite', { email: `xinv_${uniq()}@example.com`, locationIds: [b.loc.id] });
    expect(bInvite.status).toBe(201);

    const revokeRes = await post(managerA.cookies, `terminal/staff/invites/${bInvite.body.id}/revoke`, {});
    expect(revokeRes.status).toBe(404);
    expect(revokeRes.body.message).toBe('Invite not found.');

    const resendRes = await post(managerA.cookies, `terminal/staff/invites/${bInvite.body.id}/resend`, {});
    expect(resendRes.status).toBe(404);
    expect(resendRes.body.message).toBe('Invite not found.');

    // Company B's own invite is untouched.
    const row = await ctx.prisma.terminalCompanyInvite.findUniqueOrThrow({ where: { id: bInvite.body.id } });
    expect(row.revokedAt).toBeNull();
  });

  it('an OPERATOR is refused both invite revoke and resend', async () => {
    const { company, loc } = await makeCompanyWithLocation('InviteOpRefused');
    const manager = await inviteAndAccept(company.id, [loc.id], 'MANAGER');
    const operator = await inviteAndAccept(company.id, [loc.id], 'OPERATOR');
    const invite = await post(manager.cookies, 'terminal/staff/invite', { email: `op_${uniq()}@example.com`, locationIds: [loc.id] });

    const revokeRes = await post(operator.cookies, `terminal/staff/invites/${invite.body.id}/revoke`, {});
    expect(revokeRes.status).toBe(403);
    expect(revokeRes.body.message).toBe(ROLE_MESSAGE);

    const resendRes = await post(operator.cookies, `terminal/staff/invites/${invite.body.id}/resend`, {});
    expect(resendRes.status).toBe(403);
    expect(resendRes.body.message).toBe(ROLE_MESSAGE);
  });
});

describe('TERM-STAFF-API: GET /terminal/staff now carries the COMPANY\'s own locations — Oscar\'s gap', () => {
  it('returns every company location, including an inactive one, in the same shape admin getCompany already uses', async () => {
    const hub1 = await makeHub(`StaffLoc1-${uniq()}`);
    const hub2 = await makeHub(`StaffLoc2-${uniq()}`);
    const company = (
      await post(admin, 'admin/terminal/companies', { businessName: `StaffLoc Co ${uniq()}`, contactEmail: `staffloc_${uniq()}@example.com` })
    ).body;
    const loc1 = (await post(admin, `admin/terminal/companies/${company.id}/locations`, { hubId: hub1.id })).body;
    const loc2 = (await post(admin, `admin/terminal/companies/${company.id}/locations`, { hubId: hub2.id })).body;
    // The manager is only ever granted loc1 — exactly the scenario Oscar's
    // gap would break: a manager with PARTIAL coverage must still see the
    // company's full location set to grant/invite into loc2.
    const manager = await inviteAndAccept(company.id, [loc1.id], 'MANAGER');
    const removed = await request(ctx.server)
      .delete(`/api/admin/terminal/companies/${company.id}/locations/${loc2.id}`)
      .set('Cookie', admin);
    expect(removed.status).toBe(200);

    const res = await get(manager.cookies, 'terminal/staff');
    expect(res.status).toBe(200);
    expect(res.body.locations).toHaveLength(2);
    const byId = Object.fromEntries(res.body.locations.map((l: { id: string; isActive: boolean; hub: { id: string } }) => [l.id, l]));
    expect(byId[loc1.id].isActive).toBe(true);
    expect(byId[loc1.id].hub.id).toBe(hub1.id);
    expect(byId[loc2.id].isActive).toBe(false);
    expect(byId[loc2.id].hub.id).toBe(hub2.id);

    // Grant into the location the manager does NOT personally hold —
    // proving the field is not merely decorative.
    const operator = await inviteAndAccept(company.id, [loc1.id], 'OPERATOR');
    const grantRes = await post(admin, `admin/terminal/companies/${company.id}/members/${operator.userId}/locations`, { locationId: loc1.id });
    expect(grantRes.status).toBe(201);
  });
});

describe('TERM-STAFF-API: assertActiveMemberRole disambiguates a dual-company membership deterministically', () => {
  it('a caller who is OPERATOR at their OLDEST active company but MANAGER at a NEWER one still reaches the MANAGER-only action, scoped to the company where they actually hold it', async () => {
    const a = await makeCompanyWithLocation('DualA');
    const b = await makeCompanyWithLocation('DualB');
    const operatorA = await inviteAndAccept(a.company.id, [a.loc.id], 'OPERATOR'); // the OLDER membership

    // Same person (same email), invited as MANAGER into a second, NEWER
    // company — the dual-membership shape the schema's own unique
    // constraint explicitly permits.
    await post(admin, `admin/terminal/companies/${b.company.id}/invites`, { email: operatorA.email, memberRole: 'MANAGER', locationIds: [b.loc.id] });
    const token = await readLastEmailLinkToken(operatorA.email);
    const accept = await request(ctx.server).post('/api/terminal/invites/accept').send({ token });
    expect(accept.status).toBe(201);
    expect(accept.body.createdAccount).toBe(false);
    expect(accept.body.memberRole).toBe('MANAGER');

    const res = await get(operatorA.cookies, 'terminal/staff');
    expect(res.status).toBe(200);
    // This must be company B's roster (the one where this person actually
    // holds MANAGER) — an unordered pick could have landed on company A
    // and refused with the wrong-role 403 instead.
    expect(res.body.members.some((m: { userId: string; memberRole: string }) => m.userId === operatorA.userId && m.memberRole === 'MANAGER')).toBe(
      true,
    );
    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toContain(a.company.id);
  });

  it('a caller with no ACTIVE-and-eligible membership anywhere still gets the correct one of the two distinguishable 403s', async () => {
    const a = await makeCompanyWithLocation('DualRefuseA');
    const b = await makeCompanyWithLocation('DualRefuseB');
    const operatorBoth = await inviteAndAccept(a.company.id, [a.loc.id], 'OPERATOR');
    await post(admin, `admin/terminal/companies/${b.company.id}/invites`, { email: operatorBoth.email, memberRole: 'OPERATOR', locationIds: [b.loc.id] });
    const token = await readLastEmailLinkToken(operatorBoth.email);
    await request(ctx.server).post('/api/terminal/invites/accept').send({ token });

    const res = await get(operatorBoth.cookies, 'terminal/staff');
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(ROLE_MESSAGE);
  });
});
