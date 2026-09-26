/**
 * Recipient account linking, against real Postgres.
 *
 * The owner's boundary, restated because it decides every test here:
 * POSSESSING A PUBLIC OR SHAREABLE TRACKING LINK IS NOT AUTHORIZATION. The
 * capability token (`recipientToken`) only ever authorises reading the
 * anonymous status-only view (`recipient-tracking.integration.spec.ts`
 * proves that payload never widens). Becoming the shipment's linked
 * recipient is a second, deliberate, authenticated step — this suite proves
 * that step is: keyed on the token and nothing else (never a reference or
 * id); race-safe against two accounts; idempotent for the same account;
 * open to any signed-in account regardless of role (account creation stays
 * optional, and the recipient need not hold CUSTOMER); and that it changes
 * nothing about what the anonymous link itself returns.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let customer: string[];
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
/** Anonymous on purpose — the same surface `recipient-tracking` pins. */
const publicTrack = (token: string) => request(ctx.server).get(`/api/shipping/track/${token}`);
const claim = (c: string[], token: string) => request(ctx.server).post(`/api/shipping/track/${token}/claim`).set('Cookie', c).send({});
const claimAnon = (token: string) => request(ctx.server).post(`/api/shipping/track/${token}/claim`).send({});

let hub: Record<string, string> = {};

async function registerUser(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

async function seedNetwork() {
  hub = {};
  for (const h of [
    { code: 'RMUN', name: 'Belize City Municipal Airstrip', district: 'BELIZE', city: 'Belize City', fee: 1000 },
    { code: 'RSPA', name: 'San Pedro Airstrip', district: 'BELIZE', city: 'San Pedro', fee: 1500 },
    { code: 'RPLA', name: 'Placencia Airstrip', district: 'STANN_CREEK', city: 'Placencia', fee: 1200 },
  ]) {
    const r = await post(admin, 'admin/logistics/hubs', {
      code: h.code, name: h.name, type: 'AIRSTRIP', district: h.district, city: h.city, modes: ['LAND', 'AIR'],
      courierFeeMinor: h.fee, instructions: 'Counter beside the departure gate.',
    });
    expect(r.status).toBe(201);
    hub[h.code] = r.body.id;
  }
  for (const r of [
    { from: 'RPLA', to: 'RMUN', minutes: 45, price: 8000 },
    { from: 'RMUN', to: 'RSPA', minutes: 20, price: 6000 },
  ]) {
    expect((await post(admin, 'admin/logistics/routes', {
      originHubId: hub[r.from], destinationHubId: hub[r.to], mode: 'AIR',
      durationMinutes: r.minutes, priceMinor: r.price, carrierName: 'Tropic Air',
    })).status).toBe(201);
  }
}

let testHub: Record<string, string> = {};

/** The mirror network a TEST-mode booking needs — the boundary refuses to
 *  route a simulation customer over the real network at all. */
async function seedTestNetwork() {
  testHub = {};
  for (const h of [
    { code: 'TMUN', name: 'Test Belize City Municipal Airstrip', district: 'BELIZE', city: 'Belize City', fee: 1000 },
    { code: 'TSPA', name: 'Test San Pedro Airstrip', district: 'BELIZE', city: 'San Pedro', fee: 1500 },
    { code: 'TPLA', name: 'Test Placencia Airstrip', district: 'STANN_CREEK', city: 'Placencia', fee: 1200 },
  ]) {
    const r = await post(admin, 'admin/logistics/hubs', {
      code: h.code, name: h.name, type: 'AIRSTRIP', district: h.district, city: h.city, modes: ['LAND', 'AIR'],
      courierFeeMinor: h.fee, instructions: 'Counter beside the departure gate.', isTest: true,
    });
    expect(r.status).toBe(201);
    testHub[h.code] = r.body.id;
  }
  for (const r of [
    { from: 'TPLA', to: 'TMUN', minutes: 45, price: 8000 },
    { from: 'TMUN', to: 'TSPA', minutes: 20, price: 6000 },
  ]) {
    expect((await post(admin, 'admin/logistics/routes', {
      originHubId: testHub[r.from], destinationHubId: testHub[r.to], mode: 'AIR',
      durationMinutes: r.minutes, priceMinor: r.price, carrierName: 'Tropic Air Test', isTest: true,
    })).status).toBe(201);
  }
}

async function disableDispatch() {
  const row = await ctx.prisma.platformSetting.findFirst();
  const data = { dispatchAutomatic: false };
  if (row) await ctx.prisma.platformSetting.update({ where: { id: row.id }, data });
  else await ctx.prisma.platformSetting.create({ data });
}

const SENDER = { district: 'STANN_CREEK', city: 'Placencia', address: '1 Sidewalk Street', name: 'Sonia Sender', phone: '501-2223333' };
const RECIPIENT = { district: 'BELIZE', city: 'San Pedro', address: '5 Barrier Reef Drive', name: 'Rory Recipient', phone: '501-4445555' };

async function book(as: string[] = customer) {
  const r = await post(as, 'shipping', {
    service: 'DOOR_TO_DOOR',
    origin: { ...SENDER },
    destination: { ...RECIPIENT },
    preferredMode: 'AIR',
    description: 'Prescription refill',
    payWithWallet: true,
  });
  expect(r.status).toBe(201);
  return r.body;
}

async function fundWallet(userId: string, reason: string) {
  expect((await post(admin, 'admin/wallet/test-credit', { userId, amountMinor: 100_000, reason })).status).toBe(201);
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

beforeEach(async () => {
  await ctx.prisma.shipmentLegOffer.deleteMany();
  await ctx.prisma.custodyEvent.deleteMany();
  await ctx.prisma.driverEarning.deleteMany();
  await ctx.prisma.shipmentLeg.deleteMany();
  await ctx.prisma.shipment.deleteMany();
  await ctx.prisma.logisticsRoute.deleteMany();
  await ctx.prisma.logisticsHub.deleteMany();
  const c = await registerUser(`rlcust_${uniq()}@example.com`);
  customer = c.cookies;
  await fundWallet(c.userId, 'Recipient linking fixture.');
  await disableDispatch();
  await seedNetwork();
});

/* ------------------------------------------------------------------------- */

describe('claiming the link', () => {
  it('a signed-in account claims via the token, and the shipment shows up in its own account', async () => {
    const s = await book();
    const recipient = await registerUser(`rlrec_${uniq()}@example.com`);

    const claimed = await claim(recipient.cookies, s.recipientTrackingToken);
    expect(claimed.status).toBe(201);
    expect(claimed.body.reference).toBe(s.reference);
    expect(claimed.body.linked).toBe(true);

    const mine = await get(recipient.cookies, 'shipping/incoming');
    expect(mine.status).toBe(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].reference).toBe(s.reference);

    const one = await get(recipient.cookies, `shipping/incoming/${s.reference}`);
    expect(one.status).toBe(200);
    expect(one.body.reference).toBe(s.reference);
  });

  it('the linked account sees EXACTLY the same allowlisted payload the anonymous link would — linking never widens it', async () => {
    const s = await book();
    const recipient = await registerUser(`rlparity_${uniq()}@example.com`);
    expect((await claim(recipient.cookies, s.recipientTrackingToken)).status).toBe(201);

    const viaToken = await publicTrack(s.recipientTrackingToken);
    const viaAccount = await get(recipient.cookies, `shipping/incoming/${s.reference}`);
    expect(viaToken.status).toBe(200);
    expect(viaAccount.status).toBe(200);
    expect(viaAccount.body).toEqual(viaToken.body);

    const list = await get(recipient.cookies, 'shipping/incoming');
    expect(list.body[0]).toEqual(viaToken.body);
  });

  it('claiming requires a real signed-in session — holding the token alone is not enough', async () => {
    const s = await book();
    const anon = await claimAnon(s.recipientTrackingToken);
    expect(anon.status).toBe(401);

    const row = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: s.id }, select: { recipientUserId: true } });
    expect(row.recipientUserId).toBeNull();
  });

  it('claiming needs no BML role at all — the recipient need not be a CUSTOMER', async () => {
    const s = await book();
    const recipient = await registerUser(`rlnorole_${uniq()}@example.com`);
    // Every account is born CUSTOMER (auth.service.ts); suspend it so this
    // account genuinely holds no APPROVED role, then prove the linking
    // surface still works while the CUSTOMER-gated one correctly refuses.
    await ctx.prisma.userRole.update({
      where: { userId_roleCode: { userId: recipient.userId, roleCode: 'CUSTOMER' } },
      data: { status: 'SUSPENDED' },
    });

    expect((await get(recipient.cookies, 'shipping')).status).toBe(403);
    expect((await claim(recipient.cookies, s.recipientTrackingToken)).status).toBe(201);
    expect((await get(recipient.cookies, 'shipping/incoming')).status).toBe(200);
  });
});

describe('required negative: an unclaimed shipment stays invisible', () => {
  it('an account that never claimed sees nothing — empty list, 404 on direct read', async () => {
    const s = await book();
    const stranger = await registerUser(`rlstranger_${uniq()}@example.com`);

    const list = await get(stranger.cookies, 'shipping/incoming');
    expect(list.status).toBe(200);
    expect(list.body).toEqual([]);

    const one = await get(stranger.cookies, `shipping/incoming/${s.reference}`);
    expect(one.status).toBe(404);
  });

  it('an account that claimed a DIFFERENT shipment cannot read this one by reference', async () => {
    const s1 = await book();
    const s2 = await book();
    const recipient = await registerUser(`rlother_${uniq()}@example.com`);
    expect((await claim(recipient.cookies, s1.recipientTrackingToken)).status).toBe(201);

    const wrongOne = await get(recipient.cookies, `shipping/incoming/${s2.reference}`);
    expect(wrongOne.status).toBe(404);
    const list = await get(recipient.cookies, 'shipping/incoming');
    expect(list.body.map((x: { reference: string }) => x.reference)).toEqual([s1.reference]);
  });
});

describe('required negative: a claim cannot be made from a guessable value', () => {
  it('the shipment reference does not work as a claim token', async () => {
    const s = await book();
    const recipient = await registerUser(`rlrefclaim_${uniq()}@example.com`);
    const attempt = await claim(recipient.cookies, s.reference);
    expect(attempt.status).toBe(404);

    const row = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: s.id }, select: { recipientUserId: true } });
    expect(row.recipientUserId).toBeNull();
  });

  it('the shipment id does not work as a claim token', async () => {
    const s = await book();
    const recipient = await registerUser(`rlidclaim_${uniq()}@example.com`);
    const attempt = await claim(recipient.cookies, s.id);
    expect(attempt.status).toBe(404);
  });

  it('a syntactically plausible but wrong token behaves exactly like a miss', async () => {
    const s = await book();
    const recipient = await registerUser(`rlmissclaim_${uniq()}@example.com`);
    const near = s.recipientTrackingToken as string;
    const flipped = (near[0] === 'A' ? 'B' : 'A') + near.slice(1);
    const attempt = await claim(recipient.cookies, flipped);
    expect(attempt.status).toBe(404);
  });
});

describe('required negative: one account cannot claim what another already legitimately claimed', () => {
  it('a second account is refused, and the DATABASE keeps the first claimant — not just the response code', async () => {
    const s = await book();
    const first = await registerUser(`rlfirst_${uniq()}@example.com`);
    const second = await registerUser(`rlsecond_${uniq()}@example.com`);

    expect((await claim(first.cookies, s.recipientTrackingToken)).status).toBe(201);
    const rejected = await claim(second.cookies, s.recipientTrackingToken);
    expect(rejected.status).toBe(400);
    expect(rejected.body.message).toContain('already been linked to another account');

    // State, not status: re-read the row directly, and re-read the FIRST
    // account's own list, so a bug that flips ownership silently (a later
    // read producing a clean 404/200 pair by coincidence) cannot pass.
    const row = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: s.id }, select: { recipientUserId: true } });
    expect(row.recipientUserId).toBe(first.userId);
    const secondsList = await get(second.cookies, 'shipping/incoming');
    expect(secondsList.body).toEqual([]);
    const firstsList = await get(first.cookies, 'shipping/incoming');
    expect(firstsList.body[0].reference).toBe(s.reference);
  });

  it('the same account re-claiming its own shipment is idempotent, not an error', async () => {
    const s = await book();
    const recipient = await registerUser(`rlreplay_${uniq()}@example.com`);
    expect((await claim(recipient.cookies, s.recipientTrackingToken)).status).toBe(201);

    const replay = await claim(recipient.cookies, s.recipientTrackingToken);
    expect(replay.status).toBe(201);
    expect(replay.body.linked).toBe(true);

    const row = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: s.id }, select: { recipientUserId: true } });
    expect(row.recipientUserId).toBe(recipient.userId);
  });
});

describe('the simulation boundary governs linking too', () => {
  it('a real account cannot claim a TEST shipment', async () => {
    await seedTestNetwork();
    const testCustomer = await registerUser(`rltestcust_${uniq()}@example.com`);
    await ctx.prisma.user.update({ where: { id: testCustomer.userId }, data: { isTest: true } });
    await fundWallet(testCustomer.userId, 'Recipient linking simulation fixture.');
    const s = await book(testCustomer.cookies);
    expect(s.isTest).toBe(true);

    const realRecipient = await registerUser(`rlrealrec_${uniq()}@example.com`);
    const attempt = await claim(realRecipient.cookies, s.recipientTrackingToken);
    expect(attempt.status).toBe(400);

    const row = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: s.id }, select: { recipientUserId: true } });
    expect(row.recipientUserId).toBeNull();
  });

  it('a TEST account cannot claim a real shipment', async () => {
    const s = await book();
    const testRecipient = await registerUser(`rltestrec_${uniq()}@example.com`);
    await ctx.prisma.user.update({ where: { id: testRecipient.userId }, data: { isTest: true } });

    const attempt = await claim(testRecipient.cookies, s.recipientTrackingToken);
    expect(attempt.status).toBe(400);

    const row = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: s.id }, select: { recipientUserId: true } });
    expect(row.recipientUserId).toBeNull();
  });
});

describe('required negative: the anonymous tracking view is unchanged', () => {
  it('claiming a shipment changes nothing about what the public link returns', async () => {
    const s = await book();
    const before = await publicTrack(s.recipientTrackingToken);
    expect(before.status).toBe(200);

    const recipient = await registerUser(`rlanon_${uniq()}@example.com`);
    expect((await claim(recipient.cookies, s.recipientTrackingToken)).status).toBe(201);

    const after = await publicTrack(s.recipientTrackingToken);
    expect(after.status).toBe(200);
    expect(after.body).toEqual(before.body);
    const raw = JSON.stringify(after.body);
    expect(raw).not.toContain('recipientUserId');
    expect(raw).not.toContain('recipientClaimedAt');
    expect(raw).not.toContain('linked');
  });

  it('the public link still needs no account and still accepts no claim-only fields', async () => {
    const s = await book();
    // A GET against the public surface never accepts or reflects a claim.
    const r = await publicTrack(s.recipientTrackingToken);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body)).not.toContain('recipientUserId');
  });
});
