/**
 * MDF-701 (TERM-HISTORY): the owner's required "Shipment lookup, tracking,
 * and history" section had no third leg anywhere in the product —
 * `terminalQueue`/`terminalInbound`/`terminalOutbound`/`terminalCustody`
 * all answer "what needs my attention right now", and `lookupForTerminal`
 * only ever answers for one reference at a time. `GET terminal/history` is
 * the missing past-shipments list, scoped to the locations the caller is
 * actually authorized for — same hub-touch predicate `lookupForTerminal`
 * already uses, same cursor-pagination shape `NotificationsService.
 * listForUser` already established.
 *
 * MANAGER-only: `TerminalService.myStaff`'s own doc comment already names
 * "history/reporting" as one of the owner's MANAGER-only capabilities,
 * alongside "staff view" (`GET terminal/staff`, proven MANAGER-only by
 * terminal-role.integration.spec.ts). This file does not re-prove the
 * role-gate mechanism itself — `assertActiveMemberRole` is the exact same
 * function `/staff` already exercises for OPERATOR-refused/no-membership,
 * and re-testing an unchanged function through a second call site would
 * not exercise anything `/staff`'s own suite hasn't already proven.
 *
 * The three scoping cases below are the actual point, same discipline as
 * TERM-3/TERM-5/TERM-8 before it: a shipment at a location the caller was
 * not granted must not appear in the list at all — not merely be refused
 * if they try to act on it.
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

async function registerUser(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

const tokenFromBody = (body: string) => /token=([A-Za-z0-9_-]+)/.exec(body)?.[1];
async function readLastEmailLinkToken(toEmail: string): Promise<string> {
  const inbox = await request(ctx.server).get('/api/dev/emails/latest').query({ email: toEmail });
  expect(inbox.status).toBe(200);
  const token = tokenFromBody(inbox.body.body);
  if (!token) throw new Error(`No token found in email to ${toEmail}: ${JSON.stringify(inbox.body)}`);
  return token;
}

/** Same invite+accept shape terminal-role.integration.spec.ts uses,
 *  duplicated here per this suite's own convention. */
async function inviteAndAccept(companyId: string, locationIds: string[], memberRole: 'MANAGER' | 'OPERATOR') {
  const email = `member_${uniq()}@example.com`;
  await post(admin, `admin/terminal/companies/${companyId}/invites`, { email, memberRole, locationIds });
  const token = await readLastEmailLinkToken(email);
  await request(ctx.server).post('/api/terminal/invites/accept').send({ token, password: 'MemberPass123', firstName: 'M', lastName: 'E' });
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  const cookies = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email, password: 'MemberPass123' }));
  return { email, userId: user.id, cookies };
}

/** Fresh two-hub water-taxi network, unique per call — same shape every
 *  other terminal spec file in this suite uses (unique city names too, not
 *  just hub codes, so the planner cannot cross-route two tests' networks). */
async function makeNetwork() {
  const tag = uniq().slice(-9);
  const originCity = `SP ${tag}`;
  const destinationCity = `BC ${tag}`;
  const origin = await post(admin, 'admin/logistics/hubs', {
    code: `${tag}O`, name: `San Pedro Water Taxi ${tag}`, type: 'WATER_TAXI_TERMINAL',
    district: 'BELIZE', city: originCity, modes: ['LAND', 'SEA'], courierFeeMinor: 1500,
  });
  const destination = await post(admin, 'admin/logistics/hubs', {
    code: `${tag}D`, name: `Belize City Water Taxi ${tag}`, type: 'WATER_TAXI_TERMINAL',
    district: 'BELIZE', city: destinationCity, modes: ['LAND', 'SEA'], courierFeeMinor: 1000,
  });
  expect(origin.status).toBe(201);
  expect(destination.status).toBe(201);
  const route = await post(admin, 'admin/logistics/routes', {
    originHubId: origin.body.id, destinationHubId: destination.body.id, mode: 'SEA',
    durationMinutes: 90, priceMinor: 3000, carrierName: 'UAT Water Taxi',
  });
  expect(route.status).toBe(201);
  return { originHubId: origin.body.id as string, destinationHubId: destination.body.id as string, originCity, destinationCity };
}

async function fundedSender() {
  const { cookies, userId } = await registerUser(`sender_${uniq()}@example.com`);
  await post(admin, 'admin/wallet/test-credit', { userId, amountMinor: 100_000, reason: 'TERM-HISTORY test fixture.' });
  return cookies;
}

async function bookDoorToDoor(cookies: string[], net: { originCity: string; destinationCity: string }, description: string) {
  const r = await post(cookies, 'shipping', {
    service: 'DOOR_TO_DOOR',
    origin: { district: 'BELIZE', city: net.originCity, address: '10 Barrier Reef Drive', name: 'Sender', phone: '501-2223333' },
    destination: { district: 'BELIZE', city: net.destinationCity, address: '2 Albert Street', name: 'Recipient', phone: '501-4445555' },
    preferredMode: 'SEA',
    description,
    payWithWallet: true,
  });
  expect(r.status).toBe(201);
  return r.body;
}

/** Touches ONLY the destination hub — no origin-hub leg at all. */
async function bookDoorToHub(cookies: string[], net: { originCity: string; destinationHubId: string }, description: string) {
  const r = await post(cookies, 'shipping', {
    service: 'DOOR_TO_HUB',
    origin: { district: 'BELIZE', city: net.originCity, address: '10 Barrier Reef Drive', name: 'Sender', phone: '501-2223333' },
    destination: { hubId: net.destinationHubId, name: 'Recipient', phone: '501-4445555' },
    preferredMode: 'SEA',
    description,
    payWithWallet: true,
  });
  expect(r.status).toBe(201);
  return r.body;
}

async function makeCompany(businessName: string) {
  return (await post(admin, 'admin/terminal/companies', { businessName, contactEmail: `${businessName.toLowerCase().replace(/\s+/g, '')}_${uniq()}@example.com` })).body;
}

async function addLocation(companyId: string, hubId: string) {
  return (await post(admin, `admin/terminal/companies/${companyId}/locations`, { hubId })).body;
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

describe('MDF-701 (TERM-HISTORY): GET /terminal/history', () => {
  it('a MANAGER sees their own granted location\'s past shipments, newest first, cursor-paginated', async () => {
    const net = await makeNetwork();
    const company = await makeCompany(`History Co ${uniq()}`);
    const loc = await addLocation(company.id, net.originHubId);
    const manager = await inviteAndAccept(company.id, [loc.id], 'MANAGER');

    const older = await bookDoorToDoor(await fundedSender(), net, 'First parcel');
    const newer = await bookDoorToDoor(await fundedSender(), net, 'Second parcel');

    const page1 = await get(manager.cookies, 'terminal/history?limit=1');
    expect(page1.status).toBe(200);
    expect(page1.body.items).toHaveLength(1);
    expect(page1.body.items[0].shipmentId).toBe(newer.id); // newest first
    expect(page1.body.items[0].reference).toBe(newer.reference);
    expect(page1.body.items[0].touchedHubs).toHaveLength(1);
    expect(page1.body.items[0].touchedHubs[0]).toMatch(/^San Pedro Water Taxi /);
    expect(page1.body.nextCursor).toBe(newer.id);

    const page2 = await get(manager.cookies, `terminal/history?limit=1&cursor=${page1.body.nextCursor}`);
    expect(page2.status).toBe(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.items[0].shipmentId).toBe(older.id);
    expect(page2.body.nextCursor).toBeNull(); // exactly two shipments exist for this hub

    // Fact-only shape: no pin/code/token, no contact detail.
    const bodyText = JSON.stringify(page1.body) + JSON.stringify(page2.body);
    expect(bodyText).not.toContain('501-2223333');
    expect(bodyText).not.toContain('501-4445555');
    expect(bodyText.toLowerCase()).not.toMatch(/pin|token/);
  });

  it('a MANAGER of a different company sees none of another company\'s history', async () => {
    const netA = await makeNetwork();
    const companyA = await makeCompany(`Owner Co ${uniq()}`);
    await addLocation(companyA.id, netA.originHubId);
    await bookDoorToDoor(await fundedSender(), netA, 'Belongs to company A');

    const netB = await makeNetwork();
    const companyB = await makeCompany(`Outsider Co ${uniq()}`);
    const locB = await addLocation(companyB.id, netB.originHubId);
    const managerB = await inviteAndAccept(companyB.id, [locB.id], 'MANAGER');

    const res = await get(managerB.cookies, 'terminal/history');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });

  it('a MANAGER sees nothing for a second location of their OWN company they were not granted', async () => {
    const net = await makeNetwork();
    const company = await makeCompany(`Split Co ${uniq()}`);
    const locGranted = await addLocation(company.id, net.originHubId);
    await addLocation(company.id, net.destinationHubId); // same company, second location — never granted below
    const manager = await inviteAndAccept(company.id, [locGranted.id], 'MANAGER');

    // Touches ONLY the ungranted hub. A THIRD hub, routed only to the
    // ungranted one, is required to get this right:
    //   - Picking up from the GRANTED hub's own city would route the
    //     FIRST_MILE leg straight to the granted hub before line-hauling on
    //     — a real touch, correctly surfaced (this was an earlier, wrong
    //     version of this fixture, caught by the CI failure it produced).
    //   - Picking up from the UNGRANTED hub's own city collapses origin and
    //     destination onto the SAME hub, which planRoute (packages/shared/
    //     src/route-planner.ts:241-248) refuses outright as LOCAL_DELIVERY
    //     ("no transport leg is needed") — not a usable fixture either.
    const tag = uniq().slice(-9);
    const thirdCity = `TH ${tag}`;
    const third = await post(admin, 'admin/logistics/hubs', {
      code: `${tag}T`, name: `Third Hub ${tag}`, type: 'WATER_TAXI_TERMINAL',
      district: 'BELIZE', city: thirdCity, modes: ['LAND', 'SEA'], courierFeeMinor: 1200,
    });
    expect(third.status).toBe(201);
    const thirdRoute = await post(admin, 'admin/logistics/routes', {
      originHubId: third.body.id, destinationHubId: net.destinationHubId, mode: 'SEA',
      durationMinutes: 60, priceMinor: 2000, carrierName: 'UAT Water Taxi',
    });
    expect(thirdRoute.status).toBe(201);
    const ungranted = await bookDoorToHub(await fundedSender(), { originCity: thirdCity, destinationHubId: net.destinationHubId }, 'At the hub I do not hold');

    const res = await get(manager.cookies, 'terminal/history');
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { shipmentId: string }) => i.shipmentId)).not.toContain(ungranted.id);
    expect(res.body.items).toHaveLength(0);
  });

  it('an OPERATOR is refused, same as GET /terminal/staff', async () => {
    const net = await makeNetwork();
    const company = await makeCompany(`Op Co ${uniq()}`);
    const loc = await addLocation(company.id, net.originHubId);
    const operator = await inviteAndAccept(company.id, [loc.id], 'OPERATOR');

    const res = await get(operator.cookies, 'terminal/history');
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('This action requires the terminal manager role.');
  });
});
