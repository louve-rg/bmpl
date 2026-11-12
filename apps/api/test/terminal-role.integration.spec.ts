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

/** MDF-716: a real two-hub network + a funded sender, same shape
 *  terminal-queue.integration.spec.ts already established, needed here
 *  only for the one test that proves a MANAGER can actually perform a
 *  WRITE action (not just the two reads the superset test above covers). */
async function makeNetwork() {
  const tag = uniq().slice(-9);
  const originCity = `RN ${tag}`;
  const destinationCity = `RD ${tag}`;
  const origin = await post(admin, 'admin/logistics/hubs', {
    code: `${tag}O`, name: `Origin ${tag}`, type: 'WATER_TAXI_TERMINAL', district: 'BELIZE', city: originCity, modes: ['LAND', 'SEA'], courierFeeMinor: 1500,
  });
  const destination = await post(admin, 'admin/logistics/hubs', {
    code: `${tag}D`, name: `Destination ${tag}`, type: 'WATER_TAXI_TERMINAL', district: 'BELIZE', city: destinationCity, modes: ['LAND', 'SEA'], courierFeeMinor: 1000,
  });
  expect(origin.status).toBe(201);
  expect(destination.status).toBe(201);
  const route = await post(admin, 'admin/logistics/routes', {
    originHubId: origin.body.id, destinationHubId: destination.body.id, mode: 'SEA', durationMinutes: 90, priceMinor: 3000, carrierName: 'UAT Water Taxi',
  });
  expect(route.status).toBe(201);
  return { originHubId: origin.body.id as string, destinationHubId: destination.body.id as string, originCity, destinationCity };
}

async function fundedSender() {
  const email = `sender_${uniq()}@example.com`;
  const reg = await request(ctx.server).post('/api/auth/register').send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  await post(admin, 'admin/wallet/test-credit', { userId: user.id, amountMinor: 100_000, reason: 'MDF-716 test fixture.' });
  return cookiesOf(reg);
}

async function bookDoorToHub(cookies: string[], net: { originCity: string; destinationHubId: string }) {
  const r = await post(cookies, 'shipping', {
    service: 'DOOR_TO_HUB',
    origin: { district: 'BELIZE', city: net.originCity, address: '10 Barrier Reef Drive', name: 'Sender', phone: '501-2223333' },
    destination: { hubId: net.destinationHubId, name: 'Recipient', phone: '501-4445555' },
    preferredMode: 'SEA',
    description: 'One box',
    payWithWallet: true,
  });
  expect(r.status).toBe(201);
  return r.body;
}

const legsOf = (shipmentId: string) => ctx.prisma.shipmentLeg.findMany({ where: { shipmentId }, orderBy: { sequence: 'asc' } });
async function pinOf(legId: string) {
  return (await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId }, select: { handoffPin: true } })).handoffPin!;
}
async function completeFirstMileAsAdmin(legId: string) {
  expect((await post(admin, `admin/logistics/legs/${legId}/start`, {})).status).toBe(201);
  const r = await post(admin, `admin/logistics/legs/${legId}/handoff`, { pin: await pinOf(legId), receivedByName: 'Counter staff' });
  expect(r.status).toBe(201);
  return r.body;
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
    // MDF-716 (Stanley): a bare 403 does not distinguish "no membership at
    // all" from "a real member, wrong role" — assertActiveMemberRole's two
    // ForbiddenExceptions already use different text; assert it, so a
    // regression that collapsed them back to one message would be caught
    // here rather than only noticed by someone reading an error in the UI.
    expect(res.body.message).toBe('This action requires the terminal manager role.');
  });

  it('a plain customer with no terminal membership gets 403, not a crash — a DIFFERENT message than the wrong-role case above', async () => {
    const cookies = await registerCustomer(`plain_${uniq()}@example.com`);
    const res = await get(cookies, 'terminal/staff');
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('No active terminal company membership.');
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

  /**
   * MDF-716 (Stanley): the test above is a regression guard, not proof —
   * it would have passed before this card existed, and it never exercises
   * a WRITE action as MANAGER at all. This one drives a real shipment to
   * AWAITING_COLLECTION and has the MANAGER themself call `collect`,
   * proving the superset claim actually extends to the five physical
   * actions, not only the two reads already covered.
   */
  it('a MANAGER can perform a real write action (collect), not only read /me and /queue', async () => {
    const net = await makeNetwork();
    const company = (await post(admin, 'admin/terminal/companies', { businessName: `Write Co ${uniq()}`, contactEmail: `writeco_${uniq()}@example.com` })).body;
    const loc = (await post(admin, `admin/terminal/companies/${company.id}/locations`, { hubId: net.destinationHubId })).body;
    const manager = await inviteAndAccept(company.id, [loc.id], 'MANAGER');

    const booked = await bookDoorToHub(await fundedSender(), net);
    const rows = await legsOf(booked.id);
    await completeFirstMileAsAdmin(rows.find((l) => l.kind === 'FIRST_MILE')!.id);
    const lineHaul = (await legsOf(booked.id)).find((l) => l.kind === 'LINE_HAUL')!;
    await post(admin, `admin/logistics/legs/${lineHaul.id}/depart`, {});
    await post(admin, `admin/logistics/legs/${lineHaul.id}/arrive`);
    await post(admin, `admin/logistics/legs/${lineHaul.id}/handoff`, { pin: await pinOf(lineHaul.id), receivedByName: 'Counter staff' });

    const code = (await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: booked.id }, select: { collectionPin: true } })).collectionPin;
    const collected = await post(manager.cookies, `terminal/shipments/${booked.id}/collect`, { collectedByName: 'Maria Cruz', code });
    expect(collected.status).toBe(201);
    expect((await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: booked.id } })).status).toBe('DELIVERED');
  });
});

/**
 * MDF-716, the structural fix Stanley asked for: `assertActiveMemberRole`
 * is OPT-IN per endpoint — a new MANAGER-only route is protected only if
 * its author remembers to call it, so it FAILS OPEN. A hand-maintained
 * list of "which routes need which role" can drift the exact same way;
 * the fix is to make the list's staleness a test failure, not a silent
 * gap, by deriving the EXPECTED count from the live source file rather
 * than trusting a human to keep both in sync.
 *
 * Chosen over a declarative decorator/guard (the other option raised):
 * cheaper, ships today, and does not touch `assertStaffLocationAccess` or
 * any of the eight already-working routes it gates — a guard would need a
 * retrofitted decorator on every one of them to avoid becoming a second
 * fail-open surface itself (silence would have to mean "refuse", which
 * breaks today's intentionally role-blind routes unless every single one
 * is annotated first). This is the tripwire: add a 10th route to any of
 * the three terminal-staff controllers without extending ROLE_MATRIX below,
 * and this test fails — forcing an explicit, reviewed role decision rather
 * than a silent default.
 */
describe('MDF-716: every terminal-staff route is accounted for here — a new one must extend this table', () => {
  // The current, exhaustive set. One entry per @Get/@Post/@Delete/@Patch on
  // TerminalController, TerminalLegsController and TerminalShipmentsController
  // — deliberately NOT AdminTerminalController (a different axis entirely:
  // terminals.manage/terminals.read) and NOT TerminalInviteController
  // (@Public(), no session, so "role" does not apply).
  const ROLE_MATRIX = [
    { controller: 'TerminalController', route: 'GET /terminal/me', roles: 'ANY' },
    { controller: 'TerminalController', route: 'GET /terminal/staff', roles: 'MANAGER' },
    { controller: 'TerminalController', route: 'GET /terminal/queue', roles: 'ANY' },
    { controller: 'TerminalLegsController', route: 'POST /terminal/legs/:id/handoff', roles: 'ANY' },
    { controller: 'TerminalLegsController', route: 'POST /terminal/legs/:id/release-to-courier', roles: 'ANY' },
    { controller: 'TerminalLegsController', route: 'POST /terminal/legs/:id/depart', roles: 'ANY' },
    { controller: 'TerminalLegsController', route: 'POST /terminal/legs/:id/arrive', roles: 'ANY' },
    { controller: 'TerminalShipmentsController', route: 'POST /terminal/shipments/:id/collect', roles: 'ANY' },
    { controller: 'TerminalShipmentsController', route: 'GET /terminal/shipments/:reference', roles: 'ANY' },
  ] as const;

  it('terminal.controller.ts declares exactly as many routes on these three classes as ROLE_MATRIX lists', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'terminal', 'terminal.controller.ts'), 'utf8');

    const classNames = ['TerminalController', 'TerminalLegsController', 'TerminalShipmentsController'];
    let total = 0;
    for (const name of classNames) {
      const marker = `export class ${name}`;
      const start = src.indexOf(marker);
      expect(start, `could not find ${marker} in terminal.controller.ts — did it get renamed?`).toBeGreaterThan(-1);
      const nextClassStart = src.indexOf('\n@Controller(', start + marker.length);
      const block = src.slice(start, nextClassStart === -1 ? src.length : nextClassStart);
      const matches = block.match(/@(Get|Post|Delete|Patch)\(/g) ?? [];
      total += matches.length;
    }

    expect(
      total,
      `terminal.controller.ts now declares ${total} routes across TerminalController/TerminalLegsController/` +
        `TerminalShipmentsController, but ROLE_MATRIX above only accounts for ${ROLE_MATRIX.length}. A route was ` +
        `added or removed — extend (or trim) ROLE_MATRIX with an explicit ANY/MANAGER decision for it before ` +
        `trusting this test again.`,
    ).toBe(ROLE_MATRIX.length);
  });
});
