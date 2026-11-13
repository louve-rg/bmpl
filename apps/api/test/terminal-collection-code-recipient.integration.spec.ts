/**
 * MDF-709 (TERM-CODE-API), critical: without this, the collection journey
 * cannot be completed by a real person no matter how good the terminal
 * screen is — the recipient had no way to obtain the code a terminal
 * operator asks them for. `serialize()`'s own `collectionCode` field
 * already reaches a CUSTOMER audience (never STAFF), but `track()`'s
 * CUSTOMER check is the SENDER only; a linked recipient got the same 404 a
 * stranger would, and an unlinked recipient (holding only the public
 * tracking token) had no reveal path at all — there was never a handoff
 * code for a shipment that ends at a hub.
 *
 * Four pieces, four groups of tests below: the linked recipient's own
 * read; the unlinked two-step request/reveal; the AWAITING_COLLECTION
 * notification; and that STAFF still never sees the code (unchanged,
 * re-asserted rather than assumed).
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
const postPublic = (p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).send(b);

async function registerUser(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

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

async function fundedSenderWithId() {
  const { cookies, userId } = await registerUser(`sender_${uniq()}@example.com`);
  await post(admin, 'admin/wallet/test-credit', { userId, amountMinor: 100_000, reason: 'MDF-709 test fixture.' });
  return { cookies, userId };
}
async function fundedSender() {
  return (await fundedSenderWithId()).cookies;
}

/** Ends AT the destination hub — no LAST_MILE, so the journey closes with
 *  recordCollection, never a door handoff. The one shape this card's gap
 *  actually concerns. An optional `destinationEmail` lets the
 *  email-on-file tests exercise the real send, same as every other
 *  optional destination field. */
async function bookDoorToHub(cookies: string[], net: { originCity: string; destinationHubId: string }, destinationEmail?: string) {
  const r = await post(cookies, 'shipping', {
    service: 'DOOR_TO_HUB',
    origin: { district: 'BELIZE', city: net.originCity, address: '10 Barrier Reef Drive', name: 'Sender', phone: '501-2223333' },
    destination: { hubId: net.destinationHubId, name: 'Recipient', phone: '501-4445555', ...(destinationEmail ? { email: destinationEmail } : {}) },
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

/** Drives an already-BOOKED DOOR_TO_HUB shipment all the way to
 *  AWAITING_COLLECTION. Separate from booking so a test can claim the
 *  recipient in between, the way a real sender shares the link before the
 *  parcel ever arrives. */
async function driveToAwaitingCollection(shipmentId: string) {
  const rows = await legsOf(shipmentId);
  await completeFirstMileAsAdmin(rows.find((l) => l.kind === 'FIRST_MILE')!.id);
  const lineHaul = (await legsOf(shipmentId)).find((l) => l.kind === 'LINE_HAUL')!;
  expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/depart`, {})).status).toBe(201);
  expect((await post(admin, `admin/logistics/legs/${lineHaul.id}/arrive`)).status).toBe(201);
  const done = await post(admin, `admin/logistics/legs/${lineHaul.id}/handoff`, { pin: await pinOf(lineHaul.id), receivedByName: 'Counter staff' });
  expect(done.status).toBe(201);
  expect(done.body.status).toBe('AWAITING_COLLECTION');
  return done.body;
}

async function bookedAwaitingCollection(cookies: string[], net: { originCity: string; destinationHubId: string }) {
  const booked = await bookDoorToHub(cookies, net);
  return driveToAwaitingCollection(booked.id);
}

/** A registered account genuinely linked as the shipment's recipient via
 *  the real claim endpoint — same matching-by-phone pattern
 *  shipment-availability-windows.integration.spec.ts already established. */
async function claimedRecipient(shipment: { recipientTrackingToken: string }, email: string) {
  const r = await registerUser(email);
  await ctx.prisma.user.update({ where: { id: r.userId }, data: { phone: '501-4445555' } });
  const claimed = await post(r.cookies, `shipping/track/${shipment.recipientTrackingToken}/claim`, {});
  expect(claimed.status).toBe(201);
  return r;
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

describe('MDF-709 piece 1: GET shipping/incoming/:reference/collection-code — the linked recipient', () => {
  it('a genuinely linked recipient reads the real code once AWAITING_COLLECTION, matching the DB row', async () => {
    const net = await makeNetwork();
    const senderCookies = await fundedSender();
    const booked = await bookDoorToHub(senderCookies, net);
    const recipient = await claimedRecipient(booked, `recip_${uniq()}@example.com`);
    await driveToAwaitingCollection(booked.id);

    const res = await get(recipient.cookies, `shipping/incoming/${booked.reference}/collection-code`);
    expect(res.status).toBe(200);
    expect(res.body.reference).toBe(booked.reference);
    const row = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: booked.id }, select: { collectionPin: true } });
    expect(res.body.collectionCode).toBe(row.collectionPin);
    expect(res.body.collectionCode).not.toBeNull();
  });

  it('returns null, not an error, before the shipment reaches AWAITING_COLLECTION', async () => {
    const net = await makeNetwork();
    const senderCookies = await fundedSender();
    const booked = await bookDoorToHub(senderCookies, net);
    const recipient = await claimedRecipient(booked, `recipearly_${uniq()}@example.com`);

    const res = await get(recipient.cookies, `shipping/incoming/${booked.reference}/collection-code`);
    expect(res.status).toBe(200);
    expect(res.body.collectionCode).toBeNull();
  });

  it('a stranger (not the linked recipient) gets 404, not the code', async () => {
    const net = await makeNetwork();
    const senderCookies = await fundedSender();
    const shipment = await bookedAwaitingCollection(senderCookies, net);
    const stranger = await registerUser(`strangercc_${uniq()}@example.com`);

    const res = await get(stranger.cookies, `shipping/incoming/${shipment.reference}/collection-code`);
    expect(res.status).toBe(404);
  });

  it('the sender themself (not the recipient) also gets 404 from this route', async () => {
    const net = await makeNetwork();
    const senderCookies = await fundedSender();
    const shipment = await bookedAwaitingCollection(senderCookies, net);

    const res = await get(senderCookies, `shipping/incoming/${shipment.reference}/collection-code`);
    expect(res.status).toBe(404);
  });
});

describe('MDF-709 piece 2: the unlinked recipient, token-gated request/reveal', () => {
  it('with no destinationEmail on file, request still answers {requested:true} and leaves no reveal token to use', async () => {
    const net = await makeNetwork();
    const senderCookies = await fundedSender();
    const shipment = await bookedAwaitingCollection(senderCookies, net);

    const reqRes = await postPublic(`shipping/track/${shipment.recipientTrackingToken}/collection-code/request`);
    expect(reqRes.status).toBe(201);
    expect(reqRes.body).toEqual({ requested: true });

    const row = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id }, select: { collectionCodeRevealToken: true } });
    expect(row.collectionCodeRevealToken).toBeNull();
  });

  it('with a destinationEmail on file, the request emails a working reveal token that is single-use', async () => {
    const net = await makeNetwork();
    const senderCookies = await fundedSender();
    const destEmail = `dest_${uniq()}@example.com`;
    const booked = await bookDoorToHub(senderCookies, net, destEmail);
    await driveToAwaitingCollection(booked.id);

    const reqRes = await postPublic(`shipping/track/${booked.recipientTrackingToken}/collection-code/request`);
    expect(reqRes.status).toBe(201);

    const inbox = await request(ctx.server).get('/api/dev/emails/latest').query({ email: destEmail });
    expect(inbox.status).toBe(200);
    const revealToken = /: ([A-Z0-9]{10})/.exec(inbox.body.body)?.[1];
    expect(revealToken).toBeDefined();

    // URGENT fix, Stanley: the token is NOT the collection code — a
    // recipient told to give it "at the counter" would walk the clerk
    // into a wrong-code refusal, burning one of DELIVERY_PIN_MAX_ATTEMPTS
    // with no terminal-side unlock at all. The email must say to use the
    // token on the tracking page, never at a counter or with staff.
    const emailBody = (inbox.body.body as string).toLowerCase();
    expect(emailBody).not.toContain('counter');
    expect(emailBody).not.toContain('give this code');
    expect(emailBody).not.toContain('give this to');
    expect(emailBody).toContain('tracking page');

    const revealRes = await postPublic(`shipping/track/${booked.recipientTrackingToken}/collection-code/reveal`, { revealToken });
    expect(revealRes.status).toBe(201);
    const row = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: booked.id }, select: { collectionPin: true } });
    expect(revealRes.body.collectionCode).toBe(row.collectionPin);

    // Single-use: the same token again is refused.
    const reuse = await postPublic(`shipping/track/${booked.recipientTrackingToken}/collection-code/reveal`, { revealToken });
    expect(reuse.status).toBe(400);
  });

  it('an invalid or made-up reveal token is refused', async () => {
    const net = await makeNetwork();
    const senderCookies = await fundedSender();
    const shipment = await bookedAwaitingCollection(senderCookies, net);
    const res = await postPublic(`shipping/track/${shipment.recipientTrackingToken}/collection-code/reveal`, { revealToken: 'NOTAREALTOKN' });
    expect(res.status).toBe(400);
  });

  it('a nonexistent tracking token gets 404 on both request and reveal', async () => {
    const res1 = await postPublic('shipping/track/NOSUCHTOKEN00/collection-code/request');
    expect(res1.status).toBe(404);
    const res2 = await postPublic('shipping/track/NOSUCHTOKEN00/collection-code/reveal', { revealToken: 'WHATEVER123' });
    expect(res2.status).toBe(404);
  });
});

describe('MDF-709 piece 3: the linked recipient is notified at AWAITING_COLLECTION', () => {
  it('fires an in-app notification to the recipient, and it never contains the actual code', async () => {
    const net = await makeNetwork();
    const senderCookies = await fundedSender();
    const booked = await bookDoorToHub(senderCookies, net);
    const recipient = await claimedRecipient(booked, `recipnotif_${uniq()}@example.com`);
    await driveToAwaitingCollection(booked.id);

    const recipientNotif = await ctx.prisma.notificationRecipient.findFirst({
      where: { userId: recipient.userId },
      include: { notification: true },
      orderBy: { id: 'desc' },
    });
    expect(recipientNotif).not.toBeNull();
    expect(recipientNotif!.notification.event).toBe('SHIPMENT_STATUS');

    const code = (await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: booked.id }, select: { collectionPin: true } })).collectionPin!;
    expect(findPinLeak(recipientNotif!.notification, code)).toBeNull();
  });

  it('does not crash and sends only the sender-side notification when there is no linked recipient at all', async () => {
    const net = await makeNetwork();
    const { cookies: senderCookies, userId: senderId } = await fundedSenderWithId();
    await bookedAwaitingCollection(senderCookies, net);

    const senderNotif = await ctx.prisma.notificationRecipient.findFirst({
      where: { userId: senderId },
      orderBy: { id: 'desc' },
    });
    expect(senderNotif).not.toBeNull();
  });
});

describe('MDF-719 (TERM-UNLINKED-NOTIFY): an unlinked recipient with an email on file is told by email', () => {
  it('emails the on-file destinationEmail at AWAITING_COLLECTION, pointing at the tracking page, never the code', async () => {
    const net = await makeNetwork();
    const senderCookies = await fundedSender();
    const destEmail = `unlinked_${uniq()}@example.com`;
    const booked = await bookDoorToHub(senderCookies, net, destEmail);

    await driveToAwaitingCollection(booked.id);

    const inbox = await request(ctx.server).get('/api/dev/emails/latest').query({ email: destEmail });
    expect(inbox.status).toBe(200);
    expect(inbox.body.subject).toContain(booked.reference);

    const emailBody = inbox.body.body as string;
    expect(emailBody).toContain(`/track/${booked.recipientTrackingToken}`);
    const code = (await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: booked.id }, select: { collectionPin: true } })).collectionPin!;
    expect(emailBody).not.toContain(code);

    const auditRow = await ctx.prisma.auditLog.findFirst({
      where: { action: 'SHIPMENT_COLLECTION_READY_EMAIL_SENT' },
      orderBy: { id: 'desc' },
    });
    expect(auditRow).not.toBeNull();
    expect((auditRow!.newValue as { reference: string }).reference).toBe(booked.reference);
  });

  it('with no destinationEmail on file, still just a no-op — no crash, no email, no audit row', async () => {
    const net = await makeNetwork();
    const senderCookies = await fundedSender();
    const before = await ctx.prisma.auditLog.count({ where: { action: 'SHIPMENT_COLLECTION_READY_EMAIL_SENT' } });

    await bookedAwaitingCollection(senderCookies, net);

    const after = await ctx.prisma.auditLog.count({ where: { action: 'SHIPMENT_COLLECTION_READY_EMAIL_SENT' } });
    expect(after).toBe(before);
  });

  it('a LINKED recipient gets the in-app nudge, not this email — no audit row fires for a linked recipient', async () => {
    const net = await makeNetwork();
    const senderCookies = await fundedSender();
    const destEmail = `linkedignored_${uniq()}@example.com`;
    const booked = await bookDoorToHub(senderCookies, net, destEmail);
    await claimedRecipient(booked, `reciplinked_${uniq()}@example.com`);
    const before = await ctx.prisma.auditLog.count({ where: { action: 'SHIPMENT_COLLECTION_READY_EMAIL_SENT' } });

    await driveToAwaitingCollection(booked.id);

    const after = await ctx.prisma.auditLog.count({ where: { action: 'SHIPMENT_COLLECTION_READY_EMAIL_SENT' } });
    expect(after).toBe(before);
  });
});

describe('MDF-709 piece 4: STAFF still never sees the collection code (re-asserted, not assumed)', () => {
  it('a staff track() read keeps collectionCode null at AWAITING_COLLECTION', async () => {
    const net = await makeNetwork();
    const senderCookies = await fundedSender();
    const shipment = await bookedAwaitingCollection(senderCookies, net);

    const staffRead = await get(admin, `admin/logistics/shipments/${shipment.reference}`);
    expect(staffRead.status).toBe(200);
    expect(staffRead.body.collectionCode).toBeNull();
    const code = (await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id }, select: { collectionPin: true } })).collectionPin!;
    expect(findPinLeak(staffRead.body, code)).toBeNull();
  });
});

