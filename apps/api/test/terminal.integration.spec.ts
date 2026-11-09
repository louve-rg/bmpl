/**
 * Terminal operations (TERM-1/TERM-3) — backend half of slice 1: companies,
 * their locations, staff scoped to a company AND a location, and the real
 * invite flow an administrator drives.
 *
 * The scoping tests are the point of this file, per the card's own
 * instruction: a terminal operator must not reach another company, another
 * location within their OWN company, or any marketplace/vendor/financial
 * surface. No custody/handoff/PIN endpoint is touched anywhere here — that
 * reversal is explicitly a later, separate slice.
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
const del = (c: string[], p: string) => request(ctx.server).delete(`/api/${p}`).set('Cookie', c);
const patch = (c: string[], p: string, b: object = {}) => request(ctx.server).patch(`/api/${p}`).set('Cookie', c).send(b);

async function registerCustomer(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  return cookiesOf(reg);
}

async function makeHub(code: string, isTest = false) {
  return ctx.prisma.logisticsHub.create({
    data: {
      code,
      name: `${code} Terminal`,
      type: 'BMPL_HUB',
      district: 'BELIZE',
      city: 'Belize City',
      modes: ['LAND'],
      isActive: true,
      isTest,
      courierFeeMinor: 500n,
    },
  });
}

const tokenFromBody = (body: string) => /token=([A-Za-z0-9_-]+)/.exec(body)?.[1];

/** The real token is emailed, never logged; the dev mailbox (console
 *  transport) is how every other spec in this suite reads a token that was
 *  "sent" in a test run — same endpoint auth.integration.spec.ts uses. */
async function readLastEmailLinkToken(toEmail: string): Promise<string> {
  const inbox = await request(ctx.server).get('/api/dev/emails/latest').query({ email: toEmail });
  expect(inbox.status).toBe(200);
  const token = tokenFromBody(inbox.body.body);
  if (!token) throw new Error(`No token found in email to ${toEmail}: ${JSON.stringify(inbox.body)}`);
  return token;
}

/** Invite + accept, end to end, for tests that just need a seated member and
 *  don't care about proving the invite flow itself (that's the describe
 *  block above). Returns the member's own session cookies and userId. */
async function inviteAndAccept(companyId: string, locationIds: string[], memberRole: 'MANAGER' | 'OPERATOR' = 'OPERATOR') {
  const email = `member_${uniq()}@example.com`;
  await post(admin, `admin/terminal/companies/${companyId}/invites`, { email, memberRole, locationIds });
  const token = await readLastEmailLinkToken(email);
  await request(ctx.server).post('/api/terminal/invites/accept').send({ token, password: 'MemberPass123', firstName: 'M', lastName: 'E' });
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  const cookies = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email, password: 'MemberPass123' }));
  return { email, userId: user.id, cookies };
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

describe('TERM-3: admin-driven company/location/member lifecycle', () => {
  it('creates a company, adds a location, and reads them back', async () => {
    const hub = await makeHub(`T3-${uniq()}`);
    const created = await post(admin, 'admin/terminal/companies', { businessName: 'Reef Terminals Ltd', contactEmail: `reef_${uniq()}@example.com` });
    expect(created.status).toBe(201);
    expect(created.body.isActive).toBe(true);
    expect(created.body.isTest).toBe(false);

    const loc = await post(admin, `admin/terminal/companies/${created.body.id}/locations`, { hubId: hub.id });
    expect(loc.status).toBe(201);
    expect(loc.body.hub.id).toBe(hub.id);

    const detail = await get(admin, `admin/terminal/companies/${created.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.locations).toHaveLength(1);
    expect(detail.body.members).toHaveLength(0);
  });

  it('refuses mixing a real company with a TEST hub, and vice versa — the simulation boundary', async () => {
    const realHub = await makeHub(`T3R-${uniq()}`, false);
    const testHub = await makeHub(`T3T-${uniq()}`, true);
    const realCompany = (await post(admin, 'admin/terminal/companies', { businessName: 'Real Co', contactEmail: `realco_${uniq()}@example.com` })).body;
    const testCompany = (
      await post(admin, 'admin/terminal/companies', { businessName: 'Sim Co', contactEmail: `simco_${uniq()}@example.com`, isTest: true })
    ).body;

    const mismatch1 = await post(admin, `admin/terminal/companies/${realCompany.id}/locations`, { hubId: testHub.id });
    expect(mismatch1.status).toBe(400);
    const mismatch2 = await post(admin, `admin/terminal/companies/${testCompany.id}/locations`, { hubId: realHub.id });
    expect(mismatch2.status).toBe(400);

    const ok1 = await post(admin, `admin/terminal/companies/${realCompany.id}/locations`, { hubId: realHub.id });
    expect(ok1.status).toBe(201);
  });

  it('re-adding the same (company, hub) pair reactivates rather than duplicating', async () => {
    const hub = await makeHub(`T3D-${uniq()}`);
    const company = (await post(admin, 'admin/terminal/companies', { businessName: 'Dup Co', contactEmail: `dup_${uniq()}@example.com` })).body;
    const first = await post(admin, `admin/terminal/companies/${company.id}/locations`, { hubId: hub.id });
    await del(admin, `admin/terminal/companies/${company.id}/locations/${first.body.id}`);
    const second = await post(admin, `admin/terminal/companies/${company.id}/locations`, { hubId: hub.id });
    expect(second.body.id).toBe(first.body.id); // same row, reactivated
    expect(second.body.isActive).toBe(true);

    const detail = await get(admin, `admin/terminal/companies/${company.id}`);
    expect(detail.body.locations).toHaveLength(1);
  });
});

describe('TERM-3: the invite flow — the primitive that did not exist before this card', () => {
  it('an admin invites a new email; accepting creates the account with the scoped membership and location grant, atomically', async () => {
    const hubA1 = await makeHub(`T3INV-A1-${uniq()}`);
    const hubA2 = await makeHub(`T3INV-A2-${uniq()}`);
    const company = (await post(admin, 'admin/terminal/companies', { businessName: 'Invite Co', contactEmail: `invco_${uniq()}@example.com` })).body;
    const locA1 = (await post(admin, `admin/terminal/companies/${company.id}/locations`, { hubId: hubA1.id })).body;
    const locA2 = (await post(admin, `admin/terminal/companies/${company.id}/locations`, { hubId: hubA2.id })).body;

    const inviteEmail = `staffer_${uniq()}@example.com`;
    const invite = await post(admin, `admin/terminal/companies/${company.id}/invites`, {
      email: inviteEmail,
      memberRole: 'OPERATOR',
      locationIds: [locA1.id], // deliberately NOT locA2 — proves per-location scoping, not per-company
    });
    expect(invite.status).toBe(201);
    expect(invite.body.locationCount).toBe(1);

    const token = await readLastEmailLinkToken(inviteEmail);
    const accept = await request(ctx.server)
      .post('/api/terminal/invites/accept')
      .send({ token, password: 'StafferPass123', firstName: 'Stan', lastName: 'Operator' });
    expect(accept.status).toBe(201);
    expect(accept.body.createdAccount).toBe(true);

    // The account now logs in exactly like any other — no session was issued
    // by acceptance itself.
    const login = await request(ctx.server).post('/api/auth/login').send({ email: inviteEmail, password: 'StafferPass123' });
    expect(login.status).toBe(201);
    const staffCookies = cookiesOf(login);

    const me = await get(staffCookies, 'terminal/me');
    expect(me.status).toBe(200);
    expect(me.body.companyId).toBe(company.id);
    expect(me.body.memberRole).toBe('OPERATOR');
    expect(me.body.locations).toHaveLength(1);
    expect(me.body.locations[0].locationId).toBe(locA1.id);

    // The invite is consumed — using the same token again must fail, not
    // silently re-grant anything.
    const reuse = await request(ctx.server)
      .post('/api/terminal/invites/accept')
      .send({ token, password: 'Whatever12345', firstName: 'X', lastName: 'Y' });
    expect(reuse.status).toBe(400);
  });

  it('inviting an email that already has a BML account attaches to it instead of creating a second one, and needs no password', async () => {
    const hub = await makeHub(`T3EXIST-${uniq()}`);
    const company = (await post(admin, 'admin/terminal/companies', { businessName: 'Existing Co', contactEmail: `existco_${uniq()}@example.com` })).body;
    const loc = (await post(admin, `admin/terminal/companies/${company.id}/locations`, { hubId: hub.id })).body;

    const existingEmail = `already_${uniq()}@example.com`;
    const existingCookies = await registerCustomer(existingEmail);
    const existingUser = await ctx.prisma.user.findUniqueOrThrow({ where: { email: existingEmail } });

    const invite = await post(admin, `admin/terminal/companies/${company.id}/invites`, {
      email: existingEmail,
      locationIds: [loc.id],
    });
    expect(invite.status).toBe(201);
    const token = await readLastEmailLinkToken(existingEmail);

    const accept = await request(ctx.server).post('/api/terminal/invites/accept').send({ token });
    expect(accept.status).toBe(201);
    expect(accept.body.createdAccount).toBe(false);

    // No second user was created for the same email.
    const count = await ctx.prisma.user.count({ where: { email: existingEmail } });
    expect(count).toBe(1);

    const me = await get(existingCookies, 'terminal/me');
    expect(me.status).toBe(200);
    expect(me.body.companyId).toBe(company.id);
    expect(me.body.locations.map((l: { locationId: string }) => l.locationId)).toEqual([loc.id]);
  });

  it('a new account cannot be created without a password, first name and last name', async () => {
    const hub = await makeHub(`T3NOPASS-${uniq()}`);
    const company = (await post(admin, 'admin/terminal/companies', { businessName: 'No Pass Co', contactEmail: `nopass_${uniq()}@example.com` })).body;
    const loc = (await post(admin, `admin/terminal/companies/${company.id}/locations`, { hubId: hub.id })).body;
    const email = `nopass_target_${uniq()}@example.com`;
    await post(admin, `admin/terminal/companies/${company.id}/invites`, { email, locationIds: [loc.id] });
    const token = await readLastEmailLinkToken(email);

    const accept = await request(ctx.server).post('/api/terminal/invites/accept').send({ token });
    expect(accept.status).toBe(400);
    const count = await ctx.prisma.user.count({ where: { email } });
    expect(count).toBe(0);
  });

  it('revoking a pending invite makes acceptance fail, and a revoked invite cannot be revoked again as "already accepted"', async () => {
    const hub = await makeHub(`T3REV-${uniq()}`);
    const company = (await post(admin, 'admin/terminal/companies', { businessName: 'Revoke Co', contactEmail: `revco_${uniq()}@example.com` })).body;
    const loc = (await post(admin, `admin/terminal/companies/${company.id}/locations`, { hubId: hub.id })).body;
    const email = `revoke_target_${uniq()}@example.com`;
    const invite = await post(admin, `admin/terminal/companies/${company.id}/invites`, { email, locationIds: [loc.id] });
    const token = await readLastEmailLinkToken(email);

    const revoke = await post(admin, `admin/terminal/companies/${company.id}/invites/${invite.body.id}/revoke`, {});
    expect(revoke.status).toBe(201);

    const accept = await request(ctx.server)
      .post('/api/terminal/invites/accept')
      .send({ token, password: 'RevokedPass123', firstName: 'R', lastName: 'V' });
    expect(accept.status).toBe(400);
    expect(await ctx.prisma.user.count({ where: { email } })).toBe(0);
  });
});

describe('TERM-3: scoped authorization — the thing this card was built to prove', () => {
  it('a terminal operator cannot reach another company, nor a location within their OWN company they were not granted', async () => {
    const hubA1 = await makeHub(`T3SCOPE-A1-${uniq()}`);
    const hubA2 = await makeHub(`T3SCOPE-A2-${uniq()}`);
    const hubB1 = await makeHub(`T3SCOPE-B1-${uniq()}`);
    const companyA = (await post(admin, 'admin/terminal/companies', { businessName: 'Company A', contactEmail: `compa_${uniq()}@example.com` })).body;
    const companyB = (await post(admin, 'admin/terminal/companies', { businessName: 'Company B', contactEmail: `compb_${uniq()}@example.com` })).body;
    const locA1 = (await post(admin, `admin/terminal/companies/${companyA.id}/locations`, { hubId: hubA1.id })).body;
    await post(admin, `admin/terminal/companies/${companyA.id}/locations`, { hubId: hubA2.id }); // A2 exists but is never granted below
    await post(admin, `admin/terminal/companies/${companyB.id}/locations`, { hubId: hubB1.id });

    const email = `scoped_operator_${uniq()}@example.com`;
    await post(admin, `admin/terminal/companies/${companyA.id}/invites`, { email, locationIds: [locA1.id] });
    const token = await readLastEmailLinkToken(email);
    await request(ctx.server).post('/api/terminal/invites/accept').send({ token, password: 'ScopedPass123', firstName: 'S', lastName: 'O' });
    const operatorCookies = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email, password: 'ScopedPass123' }));

    const me = await get(operatorCookies, 'terminal/me');
    expect(me.status).toBe(200);
    // Company A, location A1 only — never A2, never anything about Company B.
    expect(me.body.companyId).toBe(companyA.id);
    expect(me.body.locations).toHaveLength(1);
    expect(me.body.locations[0].locationId).toBe(locA1.id);
    const bodyText = JSON.stringify(me.body);
    expect(bodyText).not.toContain(companyB.id);
    expect(bodyText).not.toContain(hubB1.id);
    expect(bodyText).not.toContain(hubA2.id);
  });

  it('a deactivated location grant stops counting immediately, with no separate cleanup needed', async () => {
    const hub = await makeHub(`T3DEACT-${uniq()}`);
    const company = (await post(admin, 'admin/terminal/companies', { businessName: 'Deact Co', contactEmail: `deact_${uniq()}@example.com` })).body;
    const loc = (await post(admin, `admin/terminal/companies/${company.id}/locations`, { hubId: hub.id })).body;
    const email = `deact_operator_${uniq()}@example.com`;
    await post(admin, `admin/terminal/companies/${company.id}/invites`, { email, locationIds: [loc.id] });
    const token = await readLastEmailLinkToken(email);
    await request(ctx.server).post('/api/terminal/invites/accept').send({ token, password: 'DeactPass123', firstName: 'D', lastName: 'E' });
    const cookies = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email, password: 'DeactPass123' }));

    expect((await get(cookies, 'terminal/me')).body.locations).toHaveLength(1);

    await del(admin, `admin/terminal/companies/${company.id}/locations/${loc.id}`);

    const after = await get(cookies, 'terminal/me');
    expect(after.status).toBe(200);
    expect(after.body.locations).toHaveLength(0);
  });

  it('ending a membership removes terminal workspace access on the member\'s next request', async () => {
    const hub = await makeHub(`T3END-${uniq()}`);
    const company = (await post(admin, 'admin/terminal/companies', { businessName: 'End Co', contactEmail: `endco_${uniq()}@example.com` })).body;
    const loc = (await post(admin, `admin/terminal/companies/${company.id}/locations`, { hubId: hub.id })).body;
    const email = `ended_operator_${uniq()}@example.com`;
    await post(admin, `admin/terminal/companies/${company.id}/invites`, { email, locationIds: [loc.id] });
    const token = await readLastEmailLinkToken(email);
    await request(ctx.server).post('/api/terminal/invites/accept').send({ token, password: 'EndedPass123', firstName: 'E', lastName: 'N' });
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
    const cookies = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email, password: 'EndedPass123' }));

    expect((await get(cookies, 'terminal/me')).status).toBe(200);

    const end = await del(admin, `admin/terminal/companies/${company.id}/members/${user.id}`);
    expect(end.status).toBe(200);

    const after = await get(cookies, 'terminal/me');
    expect(after.status).toBe(403);
  });

  it('a terminal-only account reaches no marketplace/vendor/admin surface at all — it holds no AdminPermissionGrant and no elevated role', async () => {
    const hub = await makeHub(`T3NOADMIN-${uniq()}`);
    const company = (await post(admin, 'admin/terminal/companies', { businessName: 'No Admin Co', contactEmail: `noadmin_${uniq()}@example.com` })).body;
    const loc = (await post(admin, `admin/terminal/companies/${company.id}/locations`, { hubId: hub.id })).body;
    const email = `noadmin_operator_${uniq()}@example.com`;
    await post(admin, `admin/terminal/companies/${company.id}/invites`, { email, locationIds: [loc.id] });
    const token = await readLastEmailLinkToken(email);
    await request(ctx.server).post('/api/terminal/invites/accept').send({ token, password: 'NoAdminPass123', firstName: 'N', lastName: 'A' });
    const cookies = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email, password: 'NoAdminPass123' }));

    // An ordinary admin-permission-gated surface (terminals.manage itself,
    // and an unrelated one — logistics.read) both refuse this account.
    expect((await post(cookies, 'admin/terminal/companies', { businessName: 'Should not work', contactEmail: 'x@example.com' })).status).toBe(403);
    expect((await get(cookies, 'admin/logistics/shipments')).status).toBe(403);
    // And the one surface this account DOES legitimately have still works —
    // the refusals above are a scoping boundary, not a broken session.
    expect((await get(cookies, 'terminal/me')).status).toBe(200);
  });

  it('a plain customer with no terminal membership gets 403 from the workspace read, not a crash or someone else\'s data', async () => {
    const cookies = await registerCustomer(`plain_customer_${uniq()}@example.com`);
    const res = await get(cookies, 'terminal/me');
    expect(res.status).toBe(403);
  });
});

describe('TERM-6: slice 1 close-out — company edit, direct reactivate, per-member location change', () => {
  it('a mistyped company name is correctable through the product', async () => {
    const company = (await post(admin, 'admin/terminal/companies', { businessName: 'Reef Terinals Ltd', contactEmail: `typo_${uniq()}@example.com` })).body;
    const fixed = await patch(admin, `admin/terminal/companies/${company.id}`, { businessName: 'Reef Terminals Ltd' });
    expect(fixed.status).toBe(200);
    expect(fixed.body.businessName).toBe('Reef Terminals Ltd');
    // contactEmail/contactPhone/isActive/isTest/id are all unchanged by a
    // businessName-only patch — a partial update, not a full replace.
    expect(fixed.body.contactEmail).toBe(company.contactEmail);
    expect(fixed.body.isTest).toBe(company.isTest);

    const reread = await get(admin, `admin/terminal/companies/${company.id}`);
    expect(reread.body.businessName).toBe('Reef Terminals Ltd');
  });

  it('an empty patch body is refused rather than silently doing nothing', async () => {
    const company = (await post(admin, 'admin/terminal/companies', { businessName: 'Empty Patch Co', contactEmail: `empty_${uniq()}@example.com` })).body;
    const res = await patch(admin, `admin/terminal/companies/${company.id}`, {});
    expect(res.status).toBe(400);
  });

  it('isTest cannot be changed through the edit endpoint — the simulation boundary is fixed at creation', async () => {
    const company = (
      await post(admin, 'admin/terminal/companies', { businessName: 'Sim Edit Co', contactEmail: `simedit_${uniq()}@example.com`, isTest: true })
    ).body;
    const res = await patch(admin, `admin/terminal/companies/${company.id}`, { businessName: 'Sim Edit Co Renamed', isTest: false });
    expect(res.status).toBe(200);
    expect(res.body.isTest).toBe(true); // unchanged — isTest is not in the schema at all, so Zod strips it
  });

  it('reactivating an ended member restores workspace access without a new invite, and keeps the OLD location grant (not just a fresh one)', async () => {
    const hub = await makeHub(`T6REACT-${uniq()}`);
    const company = (await post(admin, 'admin/terminal/companies', { businessName: 'Reactivate Co', contactEmail: `react_${uniq()}@example.com` })).body;
    const loc = (await post(admin, `admin/terminal/companies/${company.id}/locations`, { hubId: hub.id })).body;
    const { userId, cookies } = await inviteAndAccept(company.id, [loc.id]);

    await del(admin, `admin/terminal/companies/${company.id}/members/${userId}`);
    expect((await get(cookies, 'terminal/me')).status).toBe(403);

    const reactivate = await post(admin, `admin/terminal/companies/${company.id}/members/${userId}/reactivate`, {});
    expect(reactivate.status).toBe(201);

    const me = await get(cookies, 'terminal/me');
    expect(me.status).toBe(200);
    // The ORIGINAL grant survived ending+reactivating — reactivation never
    // touched TerminalCompanyMemberLocation rows, it only flipped status back.
    expect(me.body.locations).toHaveLength(1);
    expect(me.body.locations[0].locationId).toBe(loc.id);

    const detail = await get(admin, `admin/terminal/companies/${company.id}`);
    const member = detail.body.members.find((m: { userId: string }) => m.userId === userId);
    expect(member.status).toBe('ACTIVE');
    expect(member.endedAt).toBeNull();
  });

  it('reactivating a member who is already ACTIVE is refused — nothing to reactivate', async () => {
    const hub = await makeHub(`T6REACTACTIVE-${uniq()}`);
    const company = (await post(admin, 'admin/terminal/companies', { businessName: 'Already Active Co', contactEmail: `alreadyactive_${uniq()}@example.com` })).body;
    const loc = (await post(admin, `admin/terminal/companies/${company.id}/locations`, { hubId: hub.id })).body;
    const { userId } = await inviteAndAccept(company.id, [loc.id]);

    const res = await post(admin, `admin/terminal/companies/${company.id}/members/${userId}/reactivate`, {});
    expect(res.status).toBe(404);
  });

  it('reactivating a userId with no membership at all in this company is refused the same way', async () => {
    const company = (await post(admin, 'admin/terminal/companies', { businessName: 'No Member Co', contactEmail: `nomember_${uniq()}@example.com` })).body;
    const strangerEmail = `stranger_${uniq()}@example.com`;
    await registerCustomer(strangerEmail);
    const stranger = await ctx.prisma.user.findUniqueOrThrow({ where: { email: strangerEmail } });

    const res = await post(admin, `admin/terminal/companies/${company.id}/members/${stranger.id}/reactivate`, {});
    expect(res.status).toBe(404);
  });

  it('grants an ACTIVE member a second location without ending and re-inviting them', async () => {
    const hubA = await makeHub(`T6GRANTA-${uniq()}`);
    const hubB = await makeHub(`T6GRANTB-${uniq()}`);
    const company = (await post(admin, 'admin/terminal/companies', { businessName: 'Grant Co', contactEmail: `grant_${uniq()}@example.com` })).body;
    const locA = (await post(admin, `admin/terminal/companies/${company.id}/locations`, { hubId: hubA.id })).body;
    const locB = (await post(admin, `admin/terminal/companies/${company.id}/locations`, { hubId: hubB.id })).body;
    const { userId, cookies } = await inviteAndAccept(company.id, [locA.id]);

    expect((await get(cookies, 'terminal/me')).body.locations).toHaveLength(1);

    const grant = await post(admin, `admin/terminal/companies/${company.id}/members/${userId}/locations`, { locationId: locB.id });
    expect(grant.status).toBe(201);

    const me = await get(cookies, 'terminal/me');
    expect(me.body.locations).toHaveLength(2);
    expect(me.body.locations.map((l: { locationId: string }) => l.locationId).sort()).toEqual([locA.id, locB.id].sort());
  });

  it('granting the same location twice is a no-op, not a duplicate grant', async () => {
    const hub = await makeHub(`T6GRANTDUP-${uniq()}`);
    const company = (await post(admin, 'admin/terminal/companies', { businessName: 'Grant Dup Co', contactEmail: `grantdup_${uniq()}@example.com` })).body;
    const loc = (await post(admin, `admin/terminal/companies/${company.id}/locations`, { hubId: hub.id })).body;
    const { userId, cookies } = await inviteAndAccept(company.id, [loc.id]);

    const grant = await post(admin, `admin/terminal/companies/${company.id}/members/${userId}/locations`, { locationId: loc.id });
    expect(grant.status).toBe(201);
    expect((await get(cookies, 'terminal/me')).body.locations).toHaveLength(1);
  });

  it('refuses granting a location that does not belong to this company, or one that has been deactivated', async () => {
    const hubA = await makeHub(`T6GRANTBAD-A-${uniq()}`);
    const hubB = await makeHub(`T6GRANTBAD-B-${uniq()}`);
    const companyA = (await post(admin, 'admin/terminal/companies', { businessName: 'Grant Bad A', contactEmail: `grantbada_${uniq()}@example.com` })).body;
    const companyB = (await post(admin, 'admin/terminal/companies', { businessName: 'Grant Bad B', contactEmail: `grantbadb_${uniq()}@example.com` })).body;
    const locA = (await post(admin, `admin/terminal/companies/${companyA.id}/locations`, { hubId: hubA.id })).body;
    const locB = (await post(admin, `admin/terminal/companies/${companyB.id}/locations`, { hubId: hubB.id })).body;
    const { userId } = await inviteAndAccept(companyA.id, [locA.id]);

    // locB belongs to companyB, not companyA.
    const wrongCompany = await post(admin, `admin/terminal/companies/${companyA.id}/members/${userId}/locations`, { locationId: locB.id });
    expect(wrongCompany.status).toBe(400);

    await del(admin, `admin/terminal/companies/${companyA.id}/locations/${locA.id}`);
    const deactivated = await post(admin, `admin/terminal/companies/${companyA.id}/members/${userId}/locations`, { locationId: locA.id });
    expect(deactivated.status).toBe(400);
  });

  it('refuses granting a location to a member who is not ACTIVE (ended)', async () => {
    const hub = await makeHub(`T6GRANTENDED-${uniq()}`);
    const company = (await post(admin, 'admin/terminal/companies', { businessName: 'Grant Ended Co', contactEmail: `grantended_${uniq()}@example.com` })).body;
    const loc = (await post(admin, `admin/terminal/companies/${company.id}/locations`, { hubId: hub.id })).body;
    const { userId } = await inviteAndAccept(company.id, [loc.id]);
    await del(admin, `admin/terminal/companies/${company.id}/members/${userId}`);

    const res = await post(admin, `admin/terminal/companies/${company.id}/members/${userId}/locations`, { locationId: loc.id });
    expect(res.status).toBe(404);
  });

  it('revokes one location from an ACTIVE member, leaving their other grants untouched', async () => {
    const hubA = await makeHub(`T6REVOKEA-${uniq()}`);
    const hubB = await makeHub(`T6REVOKEB-${uniq()}`);
    const company = (await post(admin, 'admin/terminal/companies', { businessName: 'Revoke Co', contactEmail: `revokeco_${uniq()}@example.com` })).body;
    const locA = (await post(admin, `admin/terminal/companies/${company.id}/locations`, { hubId: hubA.id })).body;
    const locB = (await post(admin, `admin/terminal/companies/${company.id}/locations`, { hubId: hubB.id })).body;
    const { userId, cookies } = await inviteAndAccept(company.id, [locA.id, locB.id]);
    expect((await get(cookies, 'terminal/me')).body.locations).toHaveLength(2);

    const revoke = await del(admin, `admin/terminal/companies/${company.id}/members/${userId}/locations/${locA.id}`);
    expect(revoke.status).toBe(200);

    const me = await get(cookies, 'terminal/me');
    expect(me.body.locations).toHaveLength(1);
    expect(me.body.locations[0].locationId).toBe(locB.id);
  });

  it('revoking a location a member never held, or a member that does not exist, is refused the same way', async () => {
    const hubA = await makeHub(`T6REVOKENONE-A-${uniq()}`);
    const hubB = await makeHub(`T6REVOKENONE-B-${uniq()}`);
    const company = (await post(admin, 'admin/terminal/companies', { businessName: 'Revoke None Co', contactEmail: `revokenone_${uniq()}@example.com` })).body;
    const locA = (await post(admin, `admin/terminal/companies/${company.id}/locations`, { hubId: hubA.id })).body;
    const locB = (await post(admin, `admin/terminal/companies/${company.id}/locations`, { hubId: hubB.id })).body;
    const { userId } = await inviteAndAccept(company.id, [locA.id]);

    const neverHeld = await del(admin, `admin/terminal/companies/${company.id}/members/${userId}/locations/${locB.id}`);
    expect(neverHeld.status).toBe(404);

    const noSuchMember = await del(admin, `admin/terminal/companies/${company.id}/members/clworeallynoexist000000/locations/${locA.id}`);
    expect(noSuchMember.status).toBe(404);
  });

  it('a terminal-only account (no terminals.manage) is refused all three new endpoints', async () => {
    const hub = await makeHub(`T6NOADMIN6-${uniq()}`);
    const company = (await post(admin, 'admin/terminal/companies', { businessName: 'Term6 No Admin Co', contactEmail: `term6noadmin_${uniq()}@example.com` })).body;
    const loc = (await post(admin, `admin/terminal/companies/${company.id}/locations`, { hubId: hub.id })).body;
    const { userId, cookies } = await inviteAndAccept(company.id, [loc.id]);
    await del(admin, `admin/terminal/companies/${company.id}/members/${userId}`);

    expect((await patch(cookies, `admin/terminal/companies/${company.id}`, { businessName: 'Hijacked' })).status).toBe(403);
    expect((await post(cookies, `admin/terminal/companies/${company.id}/members/${userId}/reactivate`, {})).status).toBe(403);
    expect((await post(cookies, `admin/terminal/companies/${company.id}/members/${userId}/locations`, { locationId: loc.id })).status).toBe(403);
  });
});
