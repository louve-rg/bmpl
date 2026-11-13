/**
 * MDF-699 (TERM-LOOKUP): `terminal-feature-inventory.md` row 5 — "no search
 * input, no query parameter on GET /terminal/queue... a manager cannot look
 * up a reference" — the single biggest functional hole the audit found.
 * `GET /terminal/shipments/:reference` is the fix. The point of this file,
 * same as TERM-3/TERM-8 before it: a reference belonging to another
 * terminal is REJECTED (403), never silently returned empty, and nothing
 * in the response ever leaks a pin/code/token or the counterparty's
 * contact details — only the shipment's own typed origin/destination name
 * snapshot.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, findPinLeak, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

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

/** Same fixture shape terminal-queue.integration.spec.ts uses, duplicated
 *  per this suite's own convention of not sharing helpers across spec files. */
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
  await post(admin, 'admin/wallet/test-credit', { userId, amountMinor: 100_000, reason: 'TERM-LOOKUP test fixture.' });
  return cookies;
}

async function bookDoorToDoor(cookies: string[], net: { originCity: string; destinationCity: string }) {
  const r = await post(cookies, 'shipping', {
    service: 'DOOR_TO_DOOR',
    origin: { district: 'BELIZE', city: net.originCity, address: '10 Barrier Reef Drive', name: 'Sender Name', phone: '501-2223333' },
    destination: { district: 'BELIZE', city: net.destinationCity, address: '2 Albert Street', name: 'Recipient Name', phone: '501-4445555' },
    preferredMode: 'SEA',
    description: 'One box of mangoes',
    payWithWallet: true,
  });
  expect(r.status).toBe(201);
  return r.body;
}

async function makeTerminalStaff(hubIds: string[]) {
  const s = uniq();
  const { cookies, userId } = await registerUser(`staff_${s}@example.com`);
  const company = await ctx.prisma.terminalCompanyProfile.create({
    data: { businessName: `Reef Terminals ${s}`, contactEmail: `reef_${s}@example.com`, isActive: true, isTest: false },
  });
  const member = await ctx.prisma.terminalCompanyMember.create({
    data: { terminalCompanyId: company.id, userId, memberRole: 'OPERATOR', status: 'ACTIVE' },
  });
  for (const hubId of hubIds) {
    const location = await ctx.prisma.terminalCompanyLocation.create({ data: { terminalCompanyId: company.id, hubId, isActive: true } });
    await ctx.prisma.terminalCompanyMemberLocation.create({ data: { memberId: member.id, locationId: location.id } });
  }
  return { cookies, userId };
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

describe('MDF-699 (TERM-LOOKUP): GET /terminal/shipments/:reference', () => {
  it('a staff member granted the origin hub can look up the shipment, with the right fields and no pin anywhere', async () => {
    const net = await makeNetwork();
    const staff = await makeTerminalStaff([net.originHubId]);
    const shipment = await bookDoorToDoor(await fundedSender(), net);
    const firstMile = await ctx.prisma.shipmentLeg.findFirstOrThrow({ where: { shipmentId: shipment.id, kind: 'FIRST_MILE' } });

    const res = await get(staff.cookies, `terminal/shipments/${shipment.reference}`);
    expect(res.status).toBe(200);
    expect(res.body.shipmentId).toBe(shipment.id);
    expect(res.body.reference).toBe(shipment.reference);
    expect(res.body.senderName).toBe('Sender Name');
    expect(res.body.recipientName).toBe('Recipient Name');
    expect(res.body.isTest).toBe(false); // MDF-707/MDF-700: the simulation-boundary label
    expect(Array.isArray(res.body.legs)).toBe(true);
    expect(res.body.legs.length).toBeGreaterThanOrEqual(2);

    // Never a contact detail, never a pin/code/token.
    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toContain('501-2223333');
    expect(bodyText).not.toContain('501-4445555');
    expect(bodyText.toLowerCase()).not.toContain('email');
    expect(findPinLeak(res.body, firstMile.handoffPin!)).toBeNull();
  });

  it('TERM-SEARCH-CASE: finds the same shipment regardless of how the clerk cases or spaces the reference', async () => {
    const net = await makeNetwork();
    const staff = await makeTerminalStaff([net.originHubId]);
    const shipment = await bookDoorToDoor(await fundedSender(), net);

    const lower = await get(staff.cookies, `terminal/shipments/${shipment.reference.toLowerCase()}`);
    expect(lower.status).toBe(200);
    expect(lower.body.shipmentId).toBe(shipment.id);
    // The reference as returned is always the canonical stored form, not an
    // echo of however the clerk typed it in.
    expect(lower.body.reference).toBe(shipment.reference);

    const padded = await get(staff.cookies, `terminal/shipments/${encodeURIComponent(`  ${shipment.reference}  `)}`);
    expect(padded.status).toBe(200);
    expect(padded.body.shipmentId).toBe(shipment.id);
  });

  it('a staff member granted only the destination hub can also find it (either end counts)', async () => {
    const net = await makeNetwork();
    const staff = await makeTerminalStaff([net.destinationHubId]);
    const shipment = await bookDoorToDoor(await fundedSender(), net);

    const res = await get(staff.cookies, `terminal/shipments/${shipment.reference}`);
    expect(res.status).toBe(200);
    expect(res.body.reference).toBe(shipment.reference);
  });

  it('a shipment that never touches any of my hubs is REJECTED (403), not returned empty', async () => {
    const net = await makeNetwork();
    const otherNet = await makeNetwork();
    const shipment = await bookDoorToDoor(await fundedSender(), net);
    const staff = await makeTerminalStaff([otherNet.originHubId, otherNet.destinationHubId]);

    const res = await get(staff.cookies, `terminal/shipments/${shipment.reference}`);
    expect(res.status).toBe(403);
  });

  it('a reference that does not exist at all gets 404, distinct from the 403 above', async () => {
    const net = await makeNetwork();
    const staff = await makeTerminalStaff([net.originHubId]);
    const res = await get(staff.cookies, `terminal/shipments/BML-NOSUCHREF00`);
    expect(res.status).toBe(404);
  });

  it('a staff member with no location grants anywhere gets 403 for a real shipment, not 404', async () => {
    const net = await makeNetwork();
    const shipment = await bookDoorToDoor(await fundedSender(), net);
    const staff = await makeTerminalStaff([]); // ACTIVE membership, zero grants

    const res = await get(staff.cookies, `terminal/shipments/${shipment.reference}`);
    expect(res.status).toBe(403);
  });

  it('a plain customer with no terminal membership is refused, not shown shipment data', async () => {
    const net = await makeNetwork();
    const customerCookies = await fundedSender();
    const shipment = await bookDoorToDoor(customerCookies, net);

    const res = await get(customerCookies, `terminal/shipments/${shipment.reference}`);
    expect(res.status).toBe(403);
  });
});
