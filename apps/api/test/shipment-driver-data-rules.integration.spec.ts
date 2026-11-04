/**
 * SHIPPING-E2E-CLOSE, item 2: the three driver-facing data rules, one shared
 * fix pattern.
 *
 * All three are already correctly implemented in
 * `shipment-driver.service.ts`'s hand-written `serialize()`/`getJob()` — no
 * `...leg` spread, no `exceptionReason`, no `note`, no `pickupPin` reference
 * anywhere in that file (confirmed by reading it in full) — but today only
 * one sibling leak (`handoffPin`, `shipping-driver.integration.spec.ts`'s
 * "never returns the handoff code to the driver who has to produce it") is
 * actually ASSERTED. This closes the assertion gap on the other three named
 * rules, reusing that same test's own `containsExactValue` deterministic
 * exact-value scan (a substring scan is not deterministic here: a fixture
 * phone number or timestamp can coincidentally contain the same digits as a
 * PIN, which is exactly why that file switched to this pattern already).
 *
 * The three rules:
 *  1. `pickupPin` (the SENDER's own code) never appears in the driver's own
 *     `GET driver/shipping-jobs/:id` response — only `handoffPin` had this
 *     asserted before.
 *  2. The raw STAFF-ONLY `exceptionReason` a flag is recorded with never
 *     reaches the courier whose own leg was flagged — the driver's own GET
 *     already correctly surfaces `legStatus: 'EXCEPTION'` as a signal to act
 *     on (`shipment-exception-recovery.integration.spec.ts`), but nothing
 *     asserts the raw reason text itself stays off that same payload.
 *  3. A STAFF/admin resolution note (`resolveException`'s own `note` input,
 *     which `resolveException` writes only into `AuditLog.reason` — an
 *     admin-only record, confirmed by reading the method in full) never
 *     reaches the driver's GET either, before or after the exception clears.
 *
 * Evidence kind: representative of real customers. The driver serializer
 * reads `isTest` only to display it as a tag (`shipment-driver.service.ts
 * :627`), never to gate which fields are included — confirmed by reading the
 * function. A test shipment's driver payload is shaped exactly like a real
 * one's, so a green result here generalizes to a real courier as written.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedBaselineCourierCoverage, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let customer: string[];
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;
const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
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

/** An approved, online driver with a vehicle, serving both fixture districts. Verbatim from shipment-exception-recovery.spec.ts. */
async function makeDriver() {
  const s = uniq();
  const { cookies, userId } = await registerUser(`ddrv_${s}@example.com`);
  await ctx.prisma.userRole.upsert({
    where: { userId_roleCode: { userId, roleCode: 'DELIVERY_DRIVER' } },
    create: { userId, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
    update: { status: 'APPROVED', approvedAt: new Date() },
  });
  const profile = await ctx.prisma.driverProfile.create({
    data: {
      userId, legalName: 'D River', displayName: `Ddv${s}`, phone: '+5016000000',
      homeDistrict: 'BELIZE', licenceNumber: `DDL-${s}`, licenceExpiry: FUTURE,
      vehicleOwnership: 'OWNED', availability: 'ONLINE', isActive: true,
    },
  });
  const vehicle = await ctx.prisma.driverVehicle.create({
    data: {
      driverProfileId: profile.id, type: 'CAR', make: 'Toyota', model: 'Corolla',
      licencePlate: `DZ-${s}`.slice(0, 18), registrationExpiry: FUTURE, insuranceExpiry: FUTURE,
      isActive: true, isPrimary: true, approvalStatus: 'APPROVED',
    },
  });
  for (const district of ['BELIZE', 'STANN_CREEK']) {
    await ctx.prisma.driverServiceArea.create({ data: { driverProfileId: profile.id, district: district as never, isActive: true } });
  }
  return { cookies, userId, driverProfileId: profile.id, vehicleId: vehicle.id };
}

/** Three airstrips, two AIR line-hauls: PLA -> MUN -> SPA. Verbatim from the rest of this suite — no new geography. */
async function seedNetwork() {
  hub = {};
  for (const h of [
    { code: 'MUN', name: 'Belize City Municipal Airstrip', district: 'BELIZE', city: 'Belize City', fee: 1000 },
    { code: 'SPA', name: 'San Pedro Airstrip', district: 'BELIZE', city: 'San Pedro', fee: 1500 },
    { code: 'PLA', name: 'Placencia Airstrip', district: 'STANN_CREEK', city: 'Placencia', fee: 1200 },
  ]) {
    const r = await post(admin, 'admin/logistics/hubs', {
      code: h.code, name: h.name, type: 'AIRSTRIP', district: h.district, city: h.city, modes: ['LAND', 'AIR'],
      courierFeeMinor: h.fee,
    });
    expect(r.status).toBe(201);
    hub[h.code] = r.body.id;
  }
  for (const r of [
    { from: 'PLA', to: 'MUN', minutes: 45, price: 8000 },
    { from: 'MUN', to: 'SPA', minutes: 20, price: 6000 },
  ]) {
    expect((await post(admin, 'admin/logistics/routes', {
      originHubId: hub[r.from], destinationHubId: hub[r.to], mode: 'AIR',
      durationMinutes: r.minutes, priceMinor: r.price, carrierName: 'Tropic Air',
    })).status).toBe(201);
  }
}

/** Automatic dispatch stays OFF, matching shipment-exception-recovery.spec.ts: manual assignment is the path an operator actually has. */
async function disableDispatch() {
  const row = await ctx.prisma.platformSetting.findFirst();
  const data = { dispatchAutomatic: false };
  if (row) await ctx.prisma.platformSetting.update({ where: { id: row.id }, data });
  else await ctx.prisma.platformSetting.create({ data });
}

const doorToDoor = () => ({
  service: 'DOOR_TO_DOOR',
  origin: { district: 'STANN_CREEK', city: 'Placencia', address: '1 Sidewalk', name: 'Sender', phone: '501-2223333' },
  destination: { district: 'BELIZE', city: 'San Pedro', address: '5 Barrier Reef Drive', name: 'Recipient', phone: '501-4445555' },
  preferredMode: 'AIR',
  description: 'One box',
});

async function book() {
  const r = await post(customer, 'shipping', { ...doorToDoor(), payWithWallet: true });
  expect(r.status).toBe(201);
  return r.body;
}

const legs = (shipmentId: string) =>
  ctx.prisma.shipmentLeg.findMany({ where: { shipmentId }, orderBy: { sequence: 'asc' } });

async function pickupPinFor(legId: string) {
  return (await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId }, select: { pickupPin: true } })).pickupPin!;
}

const assign = (legId: string, d: { driverProfileId: string; vehicleId: string }) =>
  post(admin, `admin/logistics/legs/${legId}/assign`, { driverProfileId: d.driverProfileId, vehicleId: d.vehicleId });

const flag = (legId: string, reason: string) => post(admin, `admin/logistics/legs/${legId}/exception`, { reason });
const resolve = (legId: string, body: object) => post(admin, `admin/logistics/legs/${legId}/resolve-exception`, body);

/** Book, manually assign the first mile, and return shipment + that leg. Verbatim pattern from shipment-exception-recovery.spec.ts. */
async function bookedWithAssignedFirstMile(driver: { driverProfileId: string; vehicleId: string }) {
  const s = await book();
  const first = (await legs(s.id)).find((l) => l.kind === 'FIRST_MILE')!;
  expect((await assign(first.id, driver)).status).toBe(201);
  return { shipment: s, legId: first.id };
}

/**
 * Deterministic replacement for a substring scan — walks the whole payload
 * and reports true only if some field's EXACT value equals `needle`.
 * Verbatim from shipping-driver.integration.spec.ts's own helper, reused
 * rather than reinvented; see that file's comment for why exact-match beats
 * substring-scan here (a fixture phone number or timestamp can coincidentally
 * contain the same digits as a PIN).
 */
function containsExactValue(node: unknown, needle: string): boolean {
  if (node == null) return false;
  if (typeof node === 'string') return node === needle;
  if (Array.isArray(node)) return node.some((n) => containsExactValue(n, needle));
  if (typeof node === 'object') return Object.values(node as Record<string, unknown>).some((v) => containsExactValue(v, needle));
  return false;
}

const getJob = (driver: { cookies: string[] }, legId: string) => get(driver.cookies, `driver/shipping-jobs/${legId}`);

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

beforeEach(async () => {
  await ctx.prisma.shipmentLegOffer.deleteMany();
  await ctx.prisma.custodyEvent.deleteMany();
  await ctx.prisma.driverEarning.deleteMany();
  await ctx.prisma.shipmentLeg.deleteMany();
  await ctx.prisma.shipment.deleteMany();
  await ctx.prisma.logisticsRoute.deleteMany();
  await ctx.prisma.logisticsHub.deleteMany();
  await ctx.prisma.driverServiceArea.deleteMany();
  await ctx.prisma.driverVehicle.deleteMany();
  await ctx.prisma.driverProfile.deleteMany();
  const c = await registerUser(`ddcust_${uniq()}@example.com`);
  customer = c.cookies;
  await post(admin, 'admin/wallet/test-credit', { userId: c.userId, amountMinor: 100_000, reason: 'Driver data-rules fixture.' });
  await disableDispatch();
  await seedNetwork();
});

describe('driver-facing data rules: pickupPin, raw staff exceptionReason, and staff resolution notes never leak into the driver payload (SHIPPING-E2E-CLOSE, item 2)', () => {
  it('1 · the SENDER\'s own pickupPin never appears in the assigned courier\'s own GET', async () => {
    const driver = await makeDriver();
    const { legId } = await bookedWithAssignedFirstMile(driver);
    expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/accept`)).status).toBe(201);

    const job = await getJob(driver, legId);
    expect(job.status).toBe(200);
    expect(job.body).not.toHaveProperty('pickupPin');
    expect(containsExactValue(job.body, await pickupPinFor(legId))).toBe(false);
  });

  it('2 · a raw STAFF-ONLY exceptionReason never reaches the courier whose own leg was flagged with it', async () => {
    const driver = await makeDriver();
    const { legId } = await bookedWithAssignedFirstMile(driver);
    expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/accept`)).status).toBe(201);

    const rawReason = 'INTERNAL OPS ONLY: alternator failed near Mile 12, Southern Highway — flagged by dispatch supervisor Q. Pacheco.';
    expect((await flag(legId, rawReason)).status).toBe(201);

    const job = await getJob(driver, legId);
    expect(job.status).toBe(200);
    expect(job.body.legStatus).toBe('EXCEPTION'); // the correct signal the driver IS meant to see
    expect(job.body).not.toHaveProperty('exceptionReason');
    expect(containsExactValue(job.body, rawReason)).toBe(false);
  });

  it('3 · a STAFF resolution note never reaches the driver\'s GET, before or after the exception clears', async () => {
    const driver = await makeDriver();
    const { legId } = await bookedWithAssignedFirstMile(driver);
    expect((await post(driver.cookies, `driver/shipping-jobs/${legId}/accept`)).status).toBe(201);
    expect((await flag(legId, 'Flagged for the resolution note test.')).status).toBe(201);

    const staffNote = 'INTERNAL OPS ONLY: confirmed by phone with the recipient at the San Pedro counter — alternate vehicle dispatched, driver cleared to proceed.';
    const resolved = await resolve(legId, { resolution: 'RESUME', note: staffNote });
    expect(resolved.status).toBe(201);
    // The note lands only in AuditLog.reason, an admin-only record — confirmed
    // by reading resolveException in full.
    expect((await ctx.prisma.auditLog.findFirst({ where: { action: 'SHIPMENT_LEG_EXCEPTION_RESOLVED', reason: staffNote } }))).not.toBeNull();

    const job = await getJob(driver, legId);
    expect(job.status).toBe(200);
    expect(job.body.legStatus).toBe('READY');
    expect(containsExactValue(job.body, staffNote)).toBe(false);
  });
});
