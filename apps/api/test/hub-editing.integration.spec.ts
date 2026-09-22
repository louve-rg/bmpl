/**
 * Editing an existing terminal (BMPL-139), against real Postgres.
 *
 * The API has accepted every operational-metadata field since updateHubSchema
 * became hubBase.partial() — but only the courier fee ever had a test. This
 * suite pins what the admin console is about to rely on:
 *
 *  - the non-fee fields round-trip, are audited, and touch nothing they did
 *    not name — including isTest and courierFeeMinor;
 *  - the hub's IDENTITY survives an edit: legs and routes still resolve, the
 *    handoff code minted before the edit still verifies, and an in-flight
 *    leg's planner-frozen description does NOT rewrite, while a fresh quote
 *    speaks the new name;
 *  - logistics.manage edits and logistics.read is refused — the limited-admin
 *    PAIR, because a super-admin-only test proves nothing about the gate;
 *  - an empty PATCH is refused out loud.
 *
 * The phone rule is deliberately NOT re-asserted here: it lives once, in
 * packages/validation/src/shipping.test.ts, where API and browser share it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedLimitedAdmin, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let manager: string[];
let managerId: string;
let reader: string[];
let customer: string[];
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const patch = (c: string[], p: string, b: object = {}) => request(ctx.server).patch(`/api/${p}`).set('Cookie', c).send(b);
const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);

let hub: Record<string, string> = {};

async function registerUser(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

/** Two water-taxi terminals and the SEA route between them. */
async function seedNetwork() {
  hub = {};
  for (const h of [
    { code: 'SPW', name: 'San Pedro Water Taxi Terminal', city: 'San Pedro', fee: 1500 },
    { code: 'BZW', name: 'Belize City Water Taxi Terminal', city: 'Belize City', fee: 1000 },
  ]) {
    const r = await post(admin, 'admin/logistics/hubs', {
      code: h.code, name: h.name, type: 'WATER_TAXI_TERMINAL', district: 'BELIZE', city: h.city,
      modes: ['LAND', 'SEA'], courierFeeMinor: h.fee,
      contactName: 'Front Desk', contactPhone: '+5012262194', instructions: 'Counter 1.',
    });
    expect(r.status).toBe(201);
    hub[h.code] = r.body.id;
  }
  expect((await post(admin, 'admin/logistics/routes', {
    originHubId: hub.SPW, destinationHubId: hub.BZW, mode: 'SEA',
    durationMinutes: 90, priceMinor: 3000, carrierName: 'UAT Water Taxi',
  })).status).toBe(201);
}

/** Terminal to terminal: one LINE_HAUL, READY the moment it is paid. */
async function bookHubToHub() {
  const r = await post(customer, 'shipping', {
    service: 'HUB_TO_HUB',
    origin: { hubId: hub.SPW, name: 'Sender', phone: '501-2223333' },
    destination: { hubId: hub.BZW, name: 'Recipient', phone: '501-4445555' },
    preferredMode: 'SEA',
    description: 'One box',
    payWithWallet: true,
  });
  expect(r.status).toBe(201);
  return r.body;
}

const legsOf = (shipmentId: string) =>
  ctx.prisma.shipmentLeg.findMany({ where: { shipmentId }, orderBy: { sequence: 'asc' } });

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password }));
  const m = await seedLimitedAdmin(ctx.prisma, `hub_manager_${uniq()}@example.com`, ['logistics.read', 'logistics.manage']);
  managerId = m.id;
  manager = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: m.email, password: m.password }));
  const ro = await seedLimitedAdmin(ctx.prisma, `hub_reader_${uniq()}@example.com`, ['logistics.read']);
  reader = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: ro.email, password: ro.password }));
});

afterAll(async () => {
  await ctx.app.close();
});

beforeEach(async () => {
  await ctx.prisma.shipmentLegOffer.deleteMany();
  await ctx.prisma.custodyEvent.deleteMany();
  await ctx.prisma.shipmentLeg.deleteMany();
  await ctx.prisma.shipment.deleteMany();
  await ctx.prisma.logisticsRoute.deleteMany();
  await ctx.prisma.logisticsHub.deleteMany();
  const c = await registerUser(`hcust_${uniq()}@example.com`);
  customer = c.cookies;
  await post(admin, 'admin/wallet/test-credit', { userId: c.userId, amountMinor: 100_000, reason: 'Hub editing fixture.' });
  await seedNetwork();
});

/* ------------------------------------------------------------------------- */

describe('operational metadata edits', () => {
  it('round-trips the non-fee fields, audits the change, and touches nothing unsent', async () => {
    // A standalone simulation hub so the test can prove isTest survives too.
    const made = await post(admin, 'admin/logistics/hubs', {
      code: 'EDT', name: 'Edit Target Depot', type: 'WAREHOUSE', district: 'CAYO', city: 'Belmopan',
      modes: ['LAND'], courierFeeMinor: 1500, isTest: true, instructions: 'Ring the bell.',
      contactName: 'Old Contact', contactPhone: '+5018001111', addressLine1: '1 Old Road',
    });
    expect(made.status).toBe(201);
    const id = made.body.id;

    const edited = await patch(manager, `admin/logistics/hubs/${id}`, {
      name: 'Belmopan Freight Depot',
      contactName: 'New Contact',
      contactPhone: '+5018002222',
      addressLine1: '2 New Road',
      instructions: 'Use the side gate.',
    });
    expect(edited.status).toBe(200);
    expect(edited.body.name).toBe('Belmopan Freight Depot');

    const row = await ctx.prisma.logisticsHub.findUniqueOrThrow({ where: { id } });
    expect(row.name).toBe('Belmopan Freight Depot');
    expect(row.contactName).toBe('New Contact');
    expect(row.contactPhone).toBe('+5018002222');
    expect(row.addressLine1).toBe('2 New Road');
    expect(row.instructions).toBe('Use the side gate.');
    // Everything the PATCH did not name is exactly as created.
    expect(row.code).toBe('EDT');
    expect(row.type).toBe('WAREHOUSE');
    expect(row.district).toBe('CAYO');
    expect(row.city).toBe('Belmopan');
    expect(row.modes).toEqual(['LAND']);
    expect(row.courierFeeMinor).toBe(1500n);
    expect(row.isTest).toBe(true);
    expect(row.isActive).toBe(true);

    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'LOGISTICS_HUB_UPDATED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.actorId).toBe(managerId);
  });

  it('refuses an empty PATCH out loud', async () => {
    const r = await patch(manager, `admin/logistics/hubs/${hub.BZW}`, {});
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain('Nothing to update');
  });

  it('logistics.manage edits; logistics.read alone is refused', async () => {
    expect((await patch(reader, `admin/logistics/hubs/${hub.BZW}`, { name: 'Should Not Land' })).status).toBe(403);
    expect((await patch(manager, `admin/logistics/hubs/${hub.BZW}`, { name: 'Belize City Marine Terminal' })).status).toBe(200);
    // The refused edit really did not land.
    const row = await ctx.prisma.logisticsHub.findUniqueOrThrow({ where: { id: hub.BZW } });
    expect(row.name).toBe('Belize City Marine Terminal');
  });
});

describe('identity under edit', () => {
  it('legs and routes still resolve, the old PIN still verifies, the frozen description keeps the old name — and a fresh quote speaks the new one', async () => {
    const shipment = await bookHubToHub();
    const [leg] = await legsOf(shipment.id);
    expect(leg!.kind).toBe('LINE_HAUL');
    expect(leg!.status).toBe('READY');
    const frozenDescription = leg!.description ?? '';
    expect(frozenDescription).toContain('Belize City Water Taxi Terminal');
    const pinBefore = (await ctx.prisma.shipmentLeg.findUniqueOrThrow({
      where: { id: leg!.id }, select: { handoffPin: true },
    })).handoffPin!;

    // The parcel sails, and MID-JOURNEY the terminal is renamed.
    expect((await post(admin, `admin/logistics/legs/${leg!.id}/depart`, {})).status).toBe(201);
    expect((await post(admin, `admin/logistics/legs/${leg!.id}/arrive`)).status).toBe(201);
    expect((await patch(manager, `admin/logistics/hubs/${hub.BZW}`, {
      name: 'Belize City Marine Terminal', contactPhone: '+5012270000',
    })).status).toBe(200);

    // Same id, same relations: the leg still points at the renamed hub, and the
    // ops board still lists the route.
    const legRow = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: leg!.id } });
    expect(legRow.destinationHubId).toBe(hub.BZW);
    const routes = await get(admin, 'admin/logistics/routes');
    expect(routes.status).toBe(200);
    expect(JSON.stringify(routes.body)).toContain('Belize City Marine Terminal');

    // The handoff code minted before the edit still completes the journey.
    const handoff = await post(admin, `admin/logistics/legs/${leg!.id}/handoff`, {
      pin: pinBefore, receivedByName: 'Desk BZW',
    });
    expect(handoff.status).toBe(201);
    expect((await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: leg!.id } })).status).toBe('COMPLETED');

    // The in-flight journey's wording is a snapshot: it does NOT rewrite.
    expect((await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: leg!.id } })).description).toBe(frozenDescription);

    // A fresh quote, though, speaks the new name.
    const quote = await post(customer, 'shipping/quote', {
      service: 'HUB_TO_HUB',
      origin: { hubId: hub.SPW, name: 'Sender', phone: '501-2223333' },
      destination: { hubId: hub.BZW, name: 'Recipient', phone: '501-4445555' },
      preferredMode: 'SEA',
      description: 'Another box',
    });
    expect(quote.status).toBe(201);
    const quoteText = JSON.stringify(quote.body);
    expect(quoteText).toContain('Belize City Marine Terminal');
    expect(quoteText).not.toContain('Belize City Water Taxi Terminal');
  });
});
