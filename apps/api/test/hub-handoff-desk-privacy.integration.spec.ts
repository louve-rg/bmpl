/**
 * BMPL-247 — a live privacy exposure: `GET admin/logistics/hubs/:id/expected`
 * (the hub handoff desk) used to also return the assigned courier's personal
 * application phone (`DriverProfile.phone`) to any holder of `logistics.read`
 * — a platform-wide, cross-hub admin permission, not scoped to "staff at this
 * terminal". The owner ruled that number private by default; a display name
 * is the minimum operational identity the desk needs to hand a parcel to the
 * right person, matching the line already drawn for a customer's own
 * tracking view (BMPL-180).
 *
 * This suite proves the phone is genuinely gone from the wire, not merely
 * hidden in the UI: it checks the raw response body for the field AND for
 * the literal phone string, so a future rename (e.g. `driverPhone` instead
 * of `contactPhone`) cannot slip the same exposure back in unnoticed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedLimitedAdmin, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let reader: string[]; // logistics.read only — the support-agent/hub-staff persona this card is about
let admin: string[]; // super admin, used only to create the hub fixture
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;

const COURIER_PHONE = '+501-600-9876';

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);

async function registerCustomer(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { userId: user.id };
}

async function makeDriver() {
  const s = uniq();
  const { userId } = await registerCustomer(`courier_${s}@example.bz`);
  await ctx.prisma.userRole.create({ data: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() } });
  return ctx.prisma.driverProfile.create({
    data: {
      userId,
      legalName: 'Real Name',
      displayName: `Courier ${s}`,
      phone: COURIER_PHONE,
      homeDistrict: 'BELIZE',
      licenceNumber: `DL-${s}`,
      licenceExpiry: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      vehicleOwnership: 'OWNED',
      availability: 'ONLINE',
      isActive: true,
    },
  });
}

async function makeHub() {
  const s = uniq();
  const r = await post(admin, 'admin/logistics/hubs', {
    code: `HD${s}`.slice(0, 10),
    name: `Handoff Desk Terminal ${s}`,
    type: 'BUS_TERMINAL',
    district: 'BELIZE',
    city: 'Belize City',
    modes: ['LAND'],
  });
  expect(r.status).toBe(201);
  return r.body.id as string;
}

/** A leg already sitting at the handoff desk, worked by a real courier. */
async function makeLegExpectedAtHub(hubId: string, driverProfileId: string) {
  const s = uniq();
  const shipment = await ctx.prisma.shipment.create({
    data: { reference: `HD-${s}`, service: 'DOOR_TO_HUB', status: 'IN_TRANSIT', description: 'One box', pieces: 1 },
  });
  await ctx.prisma.shipmentLeg.create({
    data: {
      shipmentId: shipment.id,
      sequence: 1,
      kind: 'FIRST_MILE',
      mode: 'LAND',
      status: 'IN_PROGRESS',
      destinationHubId: hubId,
      assignedDriverProfileId: driverProfileId,
      courierStatus: 'ARRIVING',
    },
  });
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password }));
  const ro = await seedLimitedAdmin(ctx.prisma, `handoff_reader_${uniq()}@example.com`, ['logistics.read']);
  reader = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: ro.email, password: ro.password }));
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await ctx.prisma.shipmentLeg.deleteMany();
  await ctx.prisma.shipment.deleteMany();
});

describe('hub handoff desk does not expose the courier personal phone (BMPL-247)', () => {
  it('a logistics.read holder sees who is bringing the parcel but never their phone number', async () => {
    const driver = await makeDriver();
    const hubId = await makeHub();
    await makeLegExpectedAtHub(hubId, driver.id);

    const res = await get(reader, `admin/logistics/hubs/${hubId}/expected`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].broughtBy).toBe(driver.displayName);

    // Not merely null under some key — the field itself is gone, and the
    // literal number does not appear anywhere in the response body under
    // any name.
    expect(res.body[0]).not.toHaveProperty('contactPhone');
    expect(JSON.stringify(res.body)).not.toContain(COURIER_PHONE);
  });
});
