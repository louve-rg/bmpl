/**
 * EDW-P2 (MDF-1173): `POST terminal/legs/lookup-by-code` — the "lead with
 * the code" lookup. A courier is standing at the counter holding a
 * handoff code and nothing else; this is how staff find out which parcel
 * that is, before any leg, reference or shipment id is known.
 *
 * See `ShipmentService.lookupByHandoffCode`'s own doc for the full settled
 * contract this file proves:
 *  - Hub scope is server-derived (`myActiveHubIds`), never request-supplied.
 *  - OPAQUE: no match and a match at a hub the caller does not hold produce
 *    the IDENTICAL response — proven directly below, not assumed.
 *  - 1-5 matches return the candidate list; 6+ refuses and asks for the
 *    shipment reference, because `handoffPin` has no uniqueness constraint
 *    and a collision across many eligible legs is possible by design.
 *  - The candidate shape is exactly seven fields — legId, reference, parcel,
 *    from, hub{code,name}, arrivedAt, locked — and never the raw attempt
 *    count, the code itself, or a courier/driver identity.
 *  - This identifies, never authorizes: a lookup is zero state change, zero
 *    custody event, and never burns `handoffPinAttempts` on any leg.
 *  - Every call is audited, hit or miss, via SHIPMENT_HANDOFF_CODE_LOOKUP.
 *  - The endpoint has its own per-caller rate limit, independent of the
 *    per-leg PIN-attempt counter.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, findPinLeak, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);

async function registerUser(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

/** One hub reachable by one line-haul hop from a Placencia-area door —
 *  the same two-hub/one-route shape shipment-leg-concurrent-writes.
 *  integration.spec.ts already established, duplicated per this suite's
 *  own convention of not sharing fixtures across spec files. */
async function makeNetwork() {
  const tag = uniq().slice(-9);
  const origin = await post(admin, 'admin/logistics/hubs', {
    code: `${tag}O`, name: `Placencia Airstrip ${tag}`, type: 'AIRSTRIP',
    district: 'STANN_CREEK', city: `Placencia ${tag}`, modes: ['LAND', 'AIR'], courierFeeMinor: 1200,
  });
  const destination = await post(admin, 'admin/logistics/hubs', {
    code: `${tag}D`, name: `Belize City Municipal ${tag}`, type: 'AIRSTRIP',
    district: 'BELIZE', city: `Belize City ${tag}`, modes: ['LAND', 'AIR'], courierFeeMinor: 1000,
  });
  expect(origin.status).toBe(201);
  expect(destination.status).toBe(201);
  const route = await post(admin, 'admin/logistics/routes', {
    originHubId: origin.body.id, destinationHubId: destination.body.id, mode: 'AIR',
    durationMinutes: 45, priceMinor: 8000, carrierName: 'UAT Air',
  });
  expect(route.status).toBe(201);
  return {
    originHubId: origin.body.id as string,
    originHubName: `Placencia Airstrip ${tag}`,
    destinationHubId: destination.body.id as string,
    destinationHubCode: destination.body.code as string,
    destinationHubName: `Belize City Municipal ${tag}`,
    originCity: `Placencia ${tag}`,
  };
}

async function fundedSender() {
  const { cookies, userId } = await registerUser(`sender_${uniq()}@example.com`);
  await post(admin, 'admin/wallet/test-credit', { userId, amountMinor: 100_000, reason: 'TERM-LOOKUP-BY-CODE test fixture.' });
  return cookies;
}

/** DOOR_TO_HUB, ending AT the destination hub — FIRST_MILE then exactly one
 *  LINE_HAUL leg, no LAST_MILE. Same shape bookDoorToHub already uses in
 *  shipment-leg-concurrent-writes.integration.spec.ts. */
async function bookDoorToHub(cookies: string[], net: { originCity: string; destinationHubId: string }) {
  const r = await post(cookies, 'shipping', {
    service: 'DOOR_TO_HUB',
    origin: { district: 'STANN_CREEK', city: net.originCity, address: '1 Sidewalk', name: 'Sender Name', phone: '501-2223333' },
    destination: { hubId: net.destinationHubId, name: 'Recipient Name', phone: '501-4445555' },
    preferredMode: 'AIR',
    description: 'One box of mangoes',
    payWithWallet: true,
  });
  expect(r.status).toBe(201);
  return r.body;
}

const legs = (shipmentId: string) => ctx.prisma.shipmentLeg.findMany({ where: { shipmentId }, orderBy: { sequence: 'asc' } });
async function handoffPinFor(legId: string) {
  return (await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId }, select: { handoffPin: true } })).handoffPin!;
}

/** Books a DOOR_TO_HUB shipment and admin-drives the FIRST_MILE leg to
 *  handed-off, returning the one LINE_HAUL leg still READY (not yet
 *  departed). Mirrors bookedAwaitingCollection's own admin-driven setup in
 *  shipment-leg-concurrent-writes.integration.spec.ts, stopping one step
 *  earlier. */
async function bookLineHaulReady(cookies: string[], net: { originCity: string; destinationHubId: string }) {
  const booked = await bookDoorToHub(cookies, net);
  const first = (await legs(booked.id)).find((l) => l.kind === 'FIRST_MILE')!;
  expect((await post(admin, `admin/logistics/legs/${first.id}/start`, {})).status).toBe(201);
  expect((await post(admin, `admin/logistics/legs/${first.id}/handoff`, { pin: await handoffPinFor(first.id), receivedByName: 'Counter staff' })).status).toBe(201);
  const lineHaul = (await legs(booked.id)).find((l) => l.kind === 'LINE_HAUL')!;
  return { shipment: booked, lineHaulLegId: lineHaul.id as string };
}

async function departLineHaul(legId: string) {
  expect((await post(admin, `admin/logistics/legs/${legId}/depart`, {})).status).toBe(201);
}

async function arriveLineHaul(legId: string) {
  expect((await post(admin, `admin/logistics/legs/${legId}/arrive`, {})).status).toBe(201);
}

/** Departs and arrives the given LINE_HAUL leg — the one state this lookup
 *  considers "genuinely eligible": destination reached, handoff pending. */
async function bookLineHaulArrived(cookies: string[], net: { originCity: string; destinationHubId: string }) {
  const { shipment, lineHaulLegId } = await bookLineHaulReady(cookies, net);
  await departLineHaul(lineHaulLegId);
  await arriveLineHaul(lineHaulLegId);
  return { shipment, lineHaulLegId };
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

/** A code guaranteed not to be any real leg's handoffPin right now — the
 *  schema allows 4-8 digits but genPin() only ever produces 4, so an 8-digit
 *  value can never collide with a genuine fixture. */
const BOGUS_CODE = '99999999';

const lookupByCode = (cookies: string[], code: string) => post(cookies, 'terminal/legs/lookup-by-code', { code });

async function setHandoffPin(legId: string, pin: string) {
  await ctx.prisma.shipmentLeg.update({ where: { id: legId }, data: { handoffPin: pin } });
}

async function setHandoffPinAttempts(legId: string, attempts: number) {
  await ctx.prisma.shipmentLeg.update({ where: { id: legId }, data: { handoffPinAttempts: attempts } });
}

function lookupAuditRows(userId: string) {
  return ctx.prisma.auditLog.findMany({ where: { action: 'SHIPMENT_HANDOFF_CODE_LOOKUP' as never, actorId: userId }, orderBy: { createdAt: 'asc' } });
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

describe('EDW-P2 (MDF-1173): POST terminal/legs/lookup-by-code', () => {
  it('1 · an incorrect code matches nothing — empty candidates, no state change, no pin anywhere', async () => {
    const net = await makeNetwork();
    const staff = await makeTerminalStaff([net.destinationHubId]);
    const { lineHaulLegId } = await bookLineHaulArrived(await fundedSender(), net);
    const realCode = await handoffPinFor(lineHaulLegId);

    const res = await lookupByCode(staff.cookies, BOGUS_CODE);
    expect(res.status).toBe(200);
    expect(res.body.candidates).toEqual([]);
    expect(findPinLeak(res.body, realCode)).toBeNull();

    // Zero state change: the real leg's own attempt counter is untouched by
    // a lookup that never matched it.
    const leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: lineHaulLegId } });
    expect(leg.handoffPinAttempts).toBe(0);
    expect(leg.status).not.toBe('EXCEPTION');
  });

  it(
    '2 · an ambiguous match (6+ eligible legs sharing one code) is refused and told to ask for the reference',
    async () => {
      const net = await makeNetwork();
      const staff = await makeTerminalStaff([net.destinationHubId]);
      const sharedCode = '4321';
      const legIds: string[] = [];
      for (let i = 0; i < 6; i += 1) {
        const { lineHaulLegId } = await bookLineHaulArrived(await fundedSender(), net);
        await setHandoffPin(lineHaulLegId, sharedCode);
        legIds.push(lineHaulLegId);
      }

      const res = await lookupByCode(staff.cookies, sharedCode);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Too many parcels match that code. Ask for the shipment reference instead.');
      // Refusing to guess is not a state change either.
      for (const legId of legIds) {
        const leg = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId } });
        expect(leg.handoffPinAttempts).toBe(0);
      }
    },
    60000,
  );

  it('2b · 1-5 legs sharing one code (duplicate submission) are all returned as separate candidates, not collapsed or refused', async () => {
    const net = await makeNetwork();
    const staff = await makeTerminalStaff([net.destinationHubId]);
    const sharedCode = '1357';
    const first = await bookLineHaulArrived(await fundedSender(), net);
    const second = await bookLineHaulArrived(await fundedSender(), net);
    await setHandoffPin(first.lineHaulLegId, sharedCode);
    await setHandoffPin(second.lineHaulLegId, sharedCode);

    const res = await lookupByCode(staff.cookies, sharedCode);
    expect(res.status).toBe(200);
    expect(res.body.candidates).toHaveLength(2);
    const legIds = res.body.candidates.map((c: { legId: string }) => c.legId).sort();
    expect(legIds).toEqual([first.lineHaulLegId, second.lineHaulLegId].sort());
    const references = res.body.candidates.map((c: { reference: string }) => c.reference).sort();
    expect(references).toEqual([first.shipment.reference, second.shipment.reference].sort());
  });

  it('3 · a code belonging to a different terminal than the caller is indistinguishable from an incorrect code', async () => {
    const net = await makeNetwork();
    const otherNet = await makeNetwork();
    const staff = await makeTerminalStaff([net.destinationHubId]); // granted net, NOT otherNet
    const { lineHaulLegId } = await bookLineHaulArrived(await fundedSender(), otherNet);
    const realCode = await handoffPinFor(lineHaulLegId);

    const wrongTerminal = await lookupByCode(staff.cookies, realCode);
    const incorrect = await lookupByCode(staff.cookies, BOGUS_CODE);

    expect(wrongTerminal.status).toBe(incorrect.status);
    expect(wrongTerminal.body).toEqual(incorrect.body);
    expect(wrongTerminal.status).toBe(200);
    expect(wrongTerminal.body.candidates).toEqual([]);
  });

  it('4 · premature arrival: a departed-but-not-yet-arrived line-haul leg is not a candidate, same as an incorrect code', async () => {
    const net = await makeNetwork();
    const staff = await makeTerminalStaff([net.destinationHubId]);
    const { lineHaulLegId } = await bookLineHaulReady(await fundedSender(), net);
    await departLineHaul(lineHaulLegId); // departed, not yet arrived
    const code = await handoffPinFor(lineHaulLegId);

    const premature = await lookupByCode(staff.cookies, code);
    expect(premature.status).toBe(200);
    expect(premature.body.candidates).toEqual([]);

    // The same code becomes a real candidate the moment the leg arrives —
    // proving the empty result above was about arrival, not the code.
    await arriveLineHaul(lineHaulLegId);
    const afterArrival = await lookupByCode(staff.cookies, code);
    expect(afterArrival.status).toBe(200);
    expect(afterArrival.body.candidates).toHaveLength(1);
    expect(afterArrival.body.candidates[0].legId).toBe(lineHaulLegId);
  });

  it('5 · a locked code (five prior wrong handoff attempts) is reported as locked, never with the raw attempt count', async () => {
    const net = await makeNetwork();
    const staff = await makeTerminalStaff([net.destinationHubId]);
    const { lineHaulLegId } = await bookLineHaulArrived(await fundedSender(), net);
    await setHandoffPinAttempts(lineHaulLegId, 5); // DELIVERY_PIN_MAX_ATTEMPTS
    const code = await handoffPinFor(lineHaulLegId);

    const res = await lookupByCode(staff.cookies, code);
    expect(res.status).toBe(200);
    expect(res.body.candidates).toHaveLength(1);
    const candidate = res.body.candidates[0];
    expect(candidate.locked).toBe(true);
    expect(Object.keys(candidate).sort()).toEqual(['arrivedAt', 'from', 'hub', 'legId', 'locked', 'parcel', 'reference'].sort());
    expect(JSON.stringify(candidate)).not.toMatch(/attempts/i);
  });

  it('6 · a real candidate carries exactly the seven settled fields, with the correct hub and no courier identity or kind', async () => {
    const net = await makeNetwork();
    const staff = await makeTerminalStaff([net.destinationHubId]);
    const { shipment, lineHaulLegId } = await bookLineHaulArrived(await fundedSender(), net);
    const code = await handoffPinFor(lineHaulLegId);

    const res = await lookupByCode(staff.cookies, code);
    expect(res.status).toBe(200);
    expect(res.body.candidates).toHaveLength(1);
    const candidate = res.body.candidates[0];
    expect(candidate.legId).toBe(lineHaulLegId);
    expect(candidate.reference).toBe(shipment.reference);
    expect(candidate.from).toBe(net.originHubName);
    expect(candidate.hub).toEqual({ code: net.destinationHubCode, name: net.destinationHubName });
    expect(candidate.arrivedAt).not.toBeNull();
    expect(candidate.locked).toBe(false);
    expect(Object.keys(candidate).sort()).toEqual(['arrivedAt', 'from', 'hub', 'legId', 'locked', 'parcel', 'reference'].sort());
    expect(candidate).not.toHaveProperty('kind');
    expect(candidate).not.toHaveProperty('broughtBy');
    expect(candidate).not.toHaveProperty('courier');
    expect(findPinLeak(res.body, code)).toBeNull();
  });

  it('6b · EDW-P1/P2 (#902) code sharing: the FIRST_MILE leg this code also belongs to never produces a second candidate, or an ambiguous refusal, for the same shipment', async () => {
    // #902 (main, 8e9c6008) seeds a LINE_HAUL leg immediately following a
    // FIRST_MILE leg at the same hub with that SAME handoffPin — "the code
    // that travelled with the parcel". That does NOT create a second
    // candidate here: this endpoint's eligibility is kind: 'LINE_HAUL' only,
    // so the FIRST_MILE row (same code, same shipment) is never in the
    // WHERE clause to begin with — and independently of that filter, the
    // two legs can never BOTH be in this endpoint's eligible window
    // (arrived, not yet handed off) at the same time anyway: `releaseNext`/
    // `isLegActionable` only ever make ONE leg of a shipment actionable at
    // once, so the LINE_HAUL leg cannot even depart, let alone arrive,
    // before the FIRST_MILE leg sharing its code is already COMPLETED.
    // "Ambiguous = more than 5 matching LEGS" and "more than 5 matching
    // SHIPMENTS" are therefore the same count for any shipment, at any
    // point in time, under this query — proven directly below rather than
    // assumed.
    const net = await makeNetwork();
    const staff = await makeTerminalStaff([net.destinationHubId]);
    const booked = await bookDoorToHub(await fundedSender(), net);
    const first = (await legs(booked.id)).find((l) => l.kind === 'FIRST_MILE')!;
    const lineHaul = (await legs(booked.id)).find((l) => l.kind === 'LINE_HAUL')!;
    const sharedCode = await handoffPinFor(first.id);
    expect(await handoffPinFor(lineHaul.id)).toBe(sharedCode); // #902's own guarantee

    expect((await post(admin, `admin/logistics/legs/${first.id}/start`, {})).status).toBe(201);
    expect((await post(admin, `admin/logistics/legs/${first.id}/handoff`, { pin: sharedCode, receivedByName: 'Counter staff' })).status).toBe(201);
    await departLineHaul(lineHaul.id);
    await arriveLineHaul(lineHaul.id);

    const completedFirstMile = await ctx.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: first.id } });
    expect(completedFirstMile.status).toBe('COMPLETED'); // sharing this code does not reopen it

    const res = await lookupByCode(staff.cookies, sharedCode);
    expect(res.status).toBe(200);
    expect(res.body.candidates).toHaveLength(1);
    expect(res.body.candidates[0].legId).toBe(lineHaul.id);
  });

  it('7 · every lookup is audited, hit or miss, and the audit row never carries the submitted code', async () => {
    const net = await makeNetwork();
    const staff = await makeTerminalStaff([net.destinationHubId]);
    const { lineHaulLegId } = await bookLineHaulArrived(await fundedSender(), net);
    const code = await handoffPinFor(lineHaulLegId);

    await lookupByCode(staff.cookies, BOGUS_CODE); // miss
    await lookupByCode(staff.cookies, code); // hit

    const rows = await lookupAuditRows(staff.userId);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.newValue).toMatchObject({ outcome: 'MISS', candidateCount: 0 });
    expect(rows[1]!.newValue).toMatchObject({ outcome: 'HIT', candidateCount: 1 });
    for (const row of rows) {
      expect(JSON.stringify(row.newValue)).not.toContain(code);
      expect(JSON.stringify(row.newValue)).not.toContain(BOGUS_CODE);
    }
  });

  it('8 · this endpoint has its own per-caller rate limit, independent of handoffPinAttempts', async () => {
    const net = await makeNetwork();
    const staff = await makeTerminalStaff([net.destinationHubId]);

    const limit = 20; // TERMINAL_LOOKUP_RATE_LIMIT default
    const results: number[] = [];
    for (let i = 0; i < limit + 1; i += 1) {
      const res = await lookupByCode(staff.cookies, BOGUS_CODE);
      results.push(res.status);
    }
    expect(results.slice(0, limit).every((s) => s === 200)).toBe(true);
    expect(results[limit]).toBe(429);
  });
});
