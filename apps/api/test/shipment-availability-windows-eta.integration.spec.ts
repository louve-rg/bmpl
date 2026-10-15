/**
 * Edward requirement 12, owner priority: changing a shipment's availability
 * windows must trigger the appropriate ETA recalculation and notification.
 *
 * The gap (confirmed by Toby, independently re-confirmed here): `noticeEtaChange`
 * (shipment.service.ts) had exactly two callers — `scheduleLeg()` and the
 * private `transition()` choke point. `setAvailabilityWindows()` called
 * neither, yet `estimateShipmentEta` (packages/shared/src/shipment-eta.ts)
 * anchors LAST_MILE and DIRECT to that same stored window
 * (`projectLastMile`/`projectDirect`) — so a window replace-all could move
 * the real ETA while the baseline, and any notification, stayed silent.
 *
 * Reuses `localDoorToDoor()`'s own shape from
 * shipment-availability-windows-dispatch.integration.spec.ts: a single
 * DIRECT leg governs BOTH roles, so one booking is enough to move the ETA
 * from either side. `durationMinutes` is pinned to 0 so the projected
 * instant is exactly "whichever instant the sender/recipient windows allow",
 * with no fixed offset to account for.
 *
 * Windows are "HH:MM" Belize-local TIME OF DAY (availability-windows.ts), not
 * an absolute instant, and `setAvailabilityWindows` always computes its own
 * ETA against the real wall clock (no injectable `now` on this write path,
 * unlike `ShipmentDispatchService.dispatchLeg`). Every window below is
 * therefore positioned RELATIVE to the real "now" captured immediately
 * before the request that needs it — far enough away (five hours) to move
 * the ETA by many multiples of `SHIPMENT_ETA_CHANGE_THRESHOLD_MINUTES`
 * (default 30) regardless of exactly when in the test run "now" lands, and
 * never close enough to the day boundary to make the wrap ambiguous.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let admin: string[];
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const put = (c: string[], p: string, b: object = {}) => request(ctx.server).put(`/api/${p}`).set('Cookie', c).send(b);

async function registerUser(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

async function fundedSender() {
  const { cookies, userId } = await registerUser(`awe_sender_${uniq()}@example.com`);
  await post(admin, 'admin/wallet/test-credit', { userId, amountMinor: 100_000, reason: 'Requirement-12 ETA baseline fixture.' });
  return { cookies, userId };
}

async function disableDispatch() {
  const row = await ctx.prisma.platformSetting.findFirst();
  // `localCourierFeeMinor`/`localCourierMinutes` price the local DIRECT leg
  // `localDoorToDoor()` books — absent, booking itself is refused as
  // unpriced, matching shipment-availability-windows-dispatch.integration.
  // spec.ts's own `enableDispatch()` fixture values.
  const data = { dispatchAutomatic: false, localCourierFeeMinor: 1000n, localCourierMinutes: 45 };
  if (row) await ctx.prisma.platformSetting.update({ where: { id: row.id }, data });
  else await ctx.prisma.platformSetting.create({ data });
}

/** Same district, same town — `isLocalDoorToDoor` gives a single DIRECT leg
 *  governing both the sender's pickup and the recipient's delivery. */
const localDoorToDoor = () => ({
  service: 'DOOR_TO_DOOR',
  origin: { district: 'ORANGE_WALK', city: 'Orange Walk Town', address: '1 Main St', name: 'Sender', phone: '501-2223333', latitude: 18.0833, longitude: -88.5667 },
  destination: { district: 'ORANGE_WALK', city: 'Orange Walk Town', address: '2 Main St', name: 'Recipient', phone: '501-4445555', latitude: 18.084, longitude: -88.567 },
  description: 'Requirement-12 fixture parcel',
});

async function book(cookies: string[]) {
  const r = await post(cookies, 'shipping', { ...localDoorToDoor(), payWithWallet: true });
  expect(r.status).toBe(201);
  return r.body as { id: string; reference: string };
}

const legsOf = (shipmentId: string) => ctx.prisma.shipmentLeg.findMany({ where: { shipmentId }, orderBy: { sequence: 'asc' } });

async function setWindows(shipmentId: string, cookies: string[], windows: Array<{ role: string; startTime: string; endTime: string }>) {
  const r = await put(cookies, `shipping/${shipmentId}/availability-windows`, { windows });
  expect(r.status).toBe(200);
  return r.body;
}

interface Delivered { event: string | null; userId: string; data: Record<string, unknown> }

/** Run `step`, then return ONLY the notifications it produced — an id-set
 *  diff, not a timestamp, matching shipment-eta-notification.integration.
 *  spec.ts's own `capture()` so a notification from setup can never be
 *  mistaken for the one under test. */
async function capture(step: () => Promise<unknown>): Promise<Delivered[]> {
  const before = new Set((await ctx.prisma.notificationRecipient.findMany({ select: { id: true } })).map((r) => r.id));
  await step();
  const rows = (await ctx.prisma.notificationRecipient.findMany({ include: { notification: true }, orderBy: { id: 'asc' } }))
    .filter((r) => !before.has(r.id));
  return rows.map((r) => ({ event: r.notification.event, userId: r.userId, data: (r.notification.data ?? {}) as Record<string, unknown> }));
}

const etaChanges = (all: Delivered[]) => all.filter((n) => n.event === 'SHIPMENT_ETA_CHANGED');

/** Belize is a fixed UTC-6, no DST (belize-time.ts) — replicated here only
 *  to turn "now" into a Belize-local HH:MM for crafting a window, never to
 *  decide pass/fail some other way. */
function belizeMinutesOfDay(d: Date): number {
  const local = new Date(d.getTime() - 6 * 60 * 60_000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}
function hhmm(minutesOfDay: number): string {
  const m = ((minutesOfDay % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** A real, non-empty window that still contains "now" — wide enough (three
 *  hours either side) that network latency between capturing `now` here and
 *  the server computing its own `new Date()` can never push the real
 *  instant outside it. */
function windowContainingNow(role: 'SENDER' | 'RECIPIENT') {
  const now = belizeMinutesOfDay(new Date());
  return { role, startTime: hhmm(now - 180), endTime: hhmm(now + 180) };
}

/** A real, ten-minute window positioned five hours away from "now" — far
 *  enough that it can never overlap `now` by construction, and far enough
 *  past the default 30-minute `SHIPMENT_ETA_CHANGE_THRESHOLD_MINUTES` that
 *  sub-minute timing jitter cannot put the resulting move under threshold. */
function windowFarFromNow(role: 'SENDER' | 'RECIPIENT') {
  const now = belizeMinutesOfDay(new Date());
  const start = (now + 300) % 1440;
  return { role, startTime: hhmm(start), endTime: hhmm(start + 10) };
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = cookiesOf(await request(ctx.server).post('/api/auth/login').send({ email: a.email, password: a.password }));
});
afterAll(async () => { await ctx.app.close(); });

beforeEach(async () => {
  await ctx.prisma.notificationRecipient.deleteMany();
  await ctx.prisma.notification.deleteMany();
  await ctx.prisma.shipmentAvailabilityWindow.deleteMany();
  await ctx.prisma.custodyEvent.deleteMany();
  await ctx.prisma.shipmentLeg.deleteMany();
  await ctx.prisma.shipment.deleteMany();
  await disableDispatch();
});

describe('an availability-window change recomputes the ETA baseline (Edward requirement 12)', () => {
  it('a RECIPIENT window moved far from "now" DOES move the ETA, and notifies the sender', async () => {
    const sender = await fundedSender();
    const shipment = await book(sender.cookies);
    const [direct] = await legsOf(shipment.id);
    await ctx.prisma.shipmentLeg.update({ where: { id: direct!.id }, data: { durationMinutes: 0 } });

    // First write: no window at all — establishes the baseline silently,
    // the same "nothing to compare a first value against" rule
    // shipment-eta-notification.integration.spec.ts already proves for
    // scheduleLeg/transition. Proves the fix reaches this write path at
    // all before the second write tries to prove it moves anything.
    const first = await capture(async () => {
      const body = await setWindows(shipment.id, sender.cookies, []);
      expect(body.eta.confidence).not.toBe('UNKNOWN');
    });
    expect(etaChanges(first)).toHaveLength(0);
    const baseline = (await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } })).etaBaselineAt;
    expect(baseline).not.toBeNull();

    // Second write: a genuinely different RECIPIENT window, positioned far
    // enough from "now" that the recipient is no longer available at the
    // previously-projected instant — a real, material move.
    const delivered = await capture(async () => {
      const body = await setWindows(shipment.id, sender.cookies, [windowFarFromNow('RECIPIENT')]);
      expect(body.eta.confidence).not.toBe('UNKNOWN');
    });

    const changes = etaChanges(delivered);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.userId).toBe(sender.userId);
    const row = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(row.etaBaselineAt!.getTime()).not.toBe(baseline!.getTime());
  });

  it('a SENDER window that still covers "now" correctly does NOT move the ETA, and does not notify — proves this does not just fire on every write', async () => {
    const sender = await fundedSender();
    const shipment = await book(sender.cookies);
    const [direct] = await legsOf(shipment.id);
    await ctx.prisma.shipmentLeg.update({ where: { id: direct!.id }, data: { durationMinutes: 0 } });

    // Same baseline-establishing first write as the positive case above.
    await capture(async () => {
      await setWindows(shipment.id, sender.cookies, []);
    });
    const baseline = (await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } })).etaBaselineAt;
    expect(baseline).not.toBeNull();

    // Second write: a REAL, non-empty SENDER window (zero rows -> one row
    // persisted — genuinely different stored state), but one that still
    // contains "now", so the leg's own projected instant is unchanged. The
    // write must still go through (replace-all persisted the new row) —
    // only the ETA comparison must come back a no-op.
    const delivered = await capture(async () => {
      const body = await setWindows(shipment.id, sender.cookies, [windowContainingNow('SENDER')]);
      expect(body.eta.confidence).not.toBe('UNKNOWN');
    });

    expect(etaChanges(delivered)).toHaveLength(0);
    const row = await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
    expect(row.etaBaselineAt!.getTime()).toBe(baseline!.getTime());
    const stored = await ctx.prisma.shipmentAvailabilityWindow.findMany({ where: { shipmentId: shipment.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.role).toBe('SENDER');
  });
});
