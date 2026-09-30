import { randomInt } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  belizeCalendarDateKey,
  belizeMidday,
  deriveShipmentStatus,
  isLegActionable,
  needsFirstMile,
  needsLastMile,
  findCourierLane,
  isLocalDoorToDoor,
  planRoute,
  resolveScheduleStatus,
  userInitials,
  LEG_KIND_LABELS,
  SHIPMENT_STATUS_LABELS,
  SHIPPING_SERVICE_DESCRIPTIONS,
  SHIPPING_SERVICE_LABELS,
  TRANSPORT_MODE_LABELS,
  type AvailabilityWindowRole,
  type Endpoint,
  type PlannerHub,
  type PlannerLane,
  type PlannerPricing,
  type PlannerRoute,
  type LegView,
  type PlannedLeg,
  type PlanRequest,
  type PlanResult,
} from '@bmpl/shared';
import type {
  CancelShipmentInput,
  ShipmentListInput,
  CreateShipmentInput,
  LegDepartInput,
  LegExceptionInput,
  LegHandoffInput,
  ResolveLegExceptionInput,
  SetAvailabilityWindowsInput,
  ShipmentQuoteInput,
} from '@bmpl/validation';
import type { CustodyHolder, LegStatus, Prisma, ShipmentStatus } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LogisticsNetworkService } from './logistics-network.service';
import { PaymentsService } from '../payments/payments.service';
import { SettlementService } from '../settlement/settlement.service';
import { ShipmentDispatchService } from './shipment-dispatch.service';
import { assertOperableProvider } from './provider-eligibility';
import { StorageService } from '../storage/storage.service';
import { AVATAR_SELECT, publicAvatarUrl } from '../common/avatar-url';

/** Minor units go out as numbers; see the note in logistics-network.service.ts. */
const money = (v: bigint) => Number(v);

/** How many failed handoff codes before the leg stops accepting them. */
const MAX_PIN_ATTEMPTS = 5;
const PIN_LENGTH = 4;

/**
 * How many failed matching-signal attempts before a shipment's claim link
 * stops accepting them at all — same number, same shape as MAX_PIN_ATTEMPTS,
 * applied to `claimAsRecipient` instead of `verifyHandoffPin`. Per-shipment
 * (stored on the shipment itself), not per-account, so the limit cannot be
 * laundered by registering a fresh account for each guess.
 */
const MAX_RECIPIENT_CLAIM_ATTEMPTS = 5;

/** Case/whitespace only — an account's own email is not typed twice. */
function normalizeEmail(email: string | null | undefined): string | null {
  const v = email?.trim().toLowerCase();
  return v ? v : null;
}

/**
 * Digits only, with the `+501` country code folded away so `+501 444-5555`,
 * `501-4445555` and a bare local `444-5555` all normalize to the same
 * 7-digit string — exactly the shapes `phoneSchema` (packages/validation)
 * already accepts as one valid Belize number, never a looser match than
 * that schema already allows.
 */
function normalizePhone(phone: string | null | undefined): string | null {
  const digits = phone?.replace(/\D/g, '') ?? '';
  if (!digits) return null;
  const local = digits.length === 10 && digits.startsWith('501') ? digits.slice(3) : digits;
  return local.length === 7 ? local : null;
}

const SHIPMENT_INCLUDE = {
  legs: {
    orderBy: { sequence: 'asc' },
    include: {
      originHub: { select: { id: true, code: true, name: true, city: true, instructions: true, latitude: true, longitude: true } },
      destinationHub: { select: { id: true, code: true, name: true, city: true, instructions: true, latitude: true, longitude: true } },
      route: { select: { id: true, carrierName: true, carrierPhone: true, scheduleNote: true } },
      // Who is actually going to show up (BMPL-180). The same DriverVehicle link
      // the driver app already uses to run the leg — no new record, just a
      // customer-safe read of it. See courierSummary()/courierVehicleSummary()
      // for exactly which fields survive into the customer-facing payload.
      assignedDriver: {
        select: {
          displayName: true,
          ratingAverage: true,
          completedDeliveries: true,
          user: { select: { firstName: true, lastName: true, ...AVATAR_SELECT } },
        },
      },
      assignedVehicle: {
        select: { type: true, make: true, model: true, color: true, licencePlate: true, photoKeys: true, approvalStatus: true },
      },
    },
  },
  custodyEvents: { orderBy: { occurredAt: 'asc' } },
  // BMPL-285: storage and the sender write surface only — nothing reads
  // this list to gate or warn about anything yet, so it rides along in the
  // same include as everything else the shipment owner already sees.
  availabilityWindows: { orderBy: [{ role: 'asc' }, { startTime: 'asc' }] },
} satisfies Prisma.ShipmentInclude;

type ShipmentWithGraph = Prisma.ShipmentGetPayload<{ include: typeof SHIPMENT_INCLUDE }>;

/**
 * The recipient allowlist's data needs, shared by `trackPublic` (by token),
 * `trackAsRecipient` and `listIncoming` (by `recipientUserId`) — one query
 * shape for the one view, so the allowlist cannot drift between callers.
 */
const RECIPIENT_VIEW_INCLUDE = {
  legs: { orderBy: { sequence: 'asc' } },
  destinationHub: { select: { name: true, city: true, addressLine1: true, instructions: true } },
} satisfies Prisma.ShipmentInclude;

type RecipientViewGraph = Prisma.ShipmentGetPayload<{ include: typeof RECIPIENT_VIEW_INCLUDE }>;

/**
 * Multi-leg shipment orchestration.
 *
 * The rule that governs everything here is that SEQUENCE IS AUTHORITY. A leg may
 * only be worked once every earlier live leg has completed, so a courier is never
 * sent to a terminal the parcel has not reached. Shipment status is never set by
 * hand — it is recomputed from the legs after every transition, because two
 * writable sources for one fact is how they drift apart.
 *
 * Custody is append-only. The answer to "who had it when it went missing" is only
 * worth having if nothing in this file can rewrite it.
 */
@Injectable()
export class ShipmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly network: LogisticsNetworkService,
    private readonly dispatch: ShipmentDispatchService,
    private readonly payments: PaymentsService,
    private readonly settlement: SettlementService,
    private readonly storage: StorageService,
  ) {}

  /* -------------------------------------------------------------- quoting */

  /**
   * One journey, one price.
   *
   * The transport comes from the configured route rows and the door legs from the
   * hub's configured courier fee. Nothing here invents money: if a hub's courier
   * fee has not been set, the quote says so rather than quietly shipping for free.
   */
  async quote(input: ShipmentQuoteInput, opts: { isTest?: boolean } = {}) {
    const simulated = opts.isTest ?? false;
    const { hubs, routes, lanes } = await this.network.plannerInputs({ isTest: simulated });
    const hubById = new Map(hubs.map((h) => [h.id, h]));

    const origin = this.toEndpoint(input, 'origin');
    const destination = this.toEndpoint(input, 'destination');

    // Price the door legs BEFORE planning, because the planner sums what it is
    // given rather than working out what a courier costs.
    const fees = await this.courierFees(input, origin, destination, hubs, lanes, simulated);
    const requestedDate = this.travelDate(input.requestedDate);
    const journey: PlanRequest = {
      origin,
      destination,
      service: input.service,
      preferredMode: input.preferredMode ?? null,
      date: requestedDate,
    };
    const pricing: PlannerPricing = {
      firstMileMinor: fees.firstMileMinor,
      lastMileMinor: fees.lastMileMinor,
      firstMileMinutes: 0,
      lastMileMinutes: 0,
      directMinor: fees.directMinor,
      directMinutes: fees.directMinutes,
    };
    const plan = planRoute(journey, hubs, routes, pricing, lanes);

    if (!plan.ok) {
      const availability = this.dateAvailability(journey, hubs, routes, pricing, lanes, plan);
      return {
        available: false,
        reason: plan.reason,
        // The planner's own words, extended with the date finding when one
        // applies. LOCAL_DELIVERY is not a failure the customer caused — it
        // means the ordinary courier flow already covers this.
        message: availability.message,
        useLocalDelivery: plan.reason === 'LOCAL_DELIVERY',
        requestedDate: belizeCalendarDateKey(requestedDate),
        dateUnavailable: availability.dateUnavailable,
        nextAvailableDate: availability.nextAvailableDate,
      };
    }

    const unpriced = fees.unpricedHubs;
    return {
      available: true,
      service: input.service,
      serviceLabel: SHIPPING_SERVICE_LABELS[input.service],
      serviceDescription: SHIPPING_SERVICE_DESCRIPTIONS[input.service],
      totalMinor: plan.totalMinor,
      transportMinutes: plan.totalMinutes,
      explanation: plan.explanation,
      requestedDate: belizeCalendarDateKey(requestedDate),
      // Flagged, not hidden: an operator has to set these before this is sellable.
      pricingIncomplete: unpriced.length > 0,
      pricingNote: unpriced.length > 0 ? `No courier fee is configured for ${unpriced.join(' or ')}.` : null,
      legs: plan.legs.map((l) => ({
        sequence: l.sequence,
        kind: l.kind,
        mode: l.mode,
        modeLabel: TRANSPORT_MODE_LABELS[l.mode],
        description: l.description,
        priceMinor: l.priceMinor,
        durationMinutes: l.durationMinutes,
        originHub: l.originHubId ? this.hubBrief(hubById.get(l.originHubId)) : null,
        destinationHub: l.destinationHubId ? this.hubBrief(hubById.get(l.destinationHubId)) : null,
      })),
    };
  }

  private hubBrief(h?: { id: string; code: string; name: string; city: string }) {
    return h ? { id: h.id, code: h.code, name: h.name, city: h.city } : null;
  }

  /**
   * The date a journey being quoted or booked right now would travel on.
   *
   * BMPL-283: the customer may now name one (`requestedDate` on the shared
   * quote/create schema). When they do not, "as soon as possible" is still
   * the only honest default, so an omitted date falls back to now exactly as
   * it always has — this method's contract to every existing caller is
   * unchanged. A route's schedule is resolved per calendar day, not per
   * instant, so the few milliseconds between a quote's dry-run fee
   * calculation and its real plan can never land on different days in
   * practice.
   *
   * `requested` arrives as a PURE calendar date (`z.coerce.date()` on the
   * customer's "YYYY-MM-DD" picker value, UTC-midnight-normalized) — it must
   * be re-anchored via `belizeMidday` before reaching `resolveScheduleStatus`
   * downstream, which treats its date argument as a real instant and derives
   * the Belize calendar day by shifting it. Handed the raw midnight value,
   * that shift walks it onto the PREVIOUS calendar day — confirmed the wrong
   * way empirically before this landed, not assumed from the docs.
   */
  private travelDate(requested?: Date): Date {
    return requested ? belizeMidday(requested) : new Date();
  }

  /**
   * When a plan fails, say whether the REQUESTED DATE is the reason, and —
   * only when the configured schedule can answer without guessing — name the
   * next date this exact journey is confirmed to work (BMPL-283, owner
   * ruling: never hide the route as though it does not exist, never pretend
   * it operates, offer a next date only when the schedule really supports
   * one).
   *
   * NEVER FABRICATES A DATE: the "next" date offered is not derived from the
   * schedule rows by this method — it is the first later date for which
   * `planRoute`, run for real against the same origin/destination/service/
   * mode/pricing/lanes, itself comes back `ok`. So nothing is ever claimed
   * that the planner has not independently verified.
   *
   * Two checks, in order:
   *  1. Re-run the SAME journey with schedule filtering switched off (no
   *     `date`). If it still fails, the date was never the problem — no hub,
   *     no route, no mode — and naming a "next date" would misdirect the
   *     customer toward a wait that would not fix anything. `dateUnavailable`
   *     is false and the planner's own explanation is returned unchanged.
   *  2. Otherwise the requested date is genuinely why this failed. Search
   *     forward one calendar day at a time, for real, up to a fixed horizon.
   *     A corridor that cannot be shown to run again within two schedule
   *     cycles has not "provided enough information" to name a date — the
   *     owner was explicit that a confident wrong date is worse than none, so
   *     this degrades cleanly to plain unavailability instead of guessing
   *     further out.
   */
  private dateAvailability(
    journey: PlanRequest,
    hubs: readonly PlannerHub[],
    routes: readonly PlannerRoute[],
    pricing: PlannerPricing,
    lanes: readonly PlannerLane[],
    datedFailure: Extract<PlanResult, { ok: false }>,
  ): { dateUnavailable: boolean; nextAvailableDate: string | null; message: string } {
    const undated = planRoute({ ...journey, date: undefined }, hubs, routes, pricing, lanes);
    if (!undated.ok) {
      return { dateUnavailable: false, nextAvailableDate: null, message: datedFailure.explanation };
    }

    const requestedDate = journey.date ?? new Date();
    const SEARCH_HORIZON_DAYS = 14;
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    for (let offset = 1; offset <= SEARCH_HORIZON_DAYS; offset++) {
      const candidate = new Date(requestedDate.getTime() + offset * ONE_DAY_MS);
      const attempt = planRoute({ ...journey, date: candidate }, hubs, routes, pricing, lanes);
      if (attempt.ok) {
        const key = belizeCalendarDateKey(candidate);
        return {
          dateUnavailable: true,
          nextAvailableDate: key,
          message: `${datedFailure.explanation} The next date this route is confirmed to run is ${key}.`,
        };
      }
    }

    return { dateUnavailable: true, nextAvailableDate: null, message: datedFailure.explanation };
  }

  /** Turn a validated endpoint into what the planner understands. */
  private toEndpoint(input: ShipmentQuoteInput, side: 'origin' | 'destination'): Endpoint {
    const e = input[side];
    const isDoor = side === 'origin' ? needsFirstMile(input.service) : needsLastMile(input.service);
    if (isDoor) {
      // The schema guarantees a district on a door end, so this is a type
      // narrowing rather than a runtime possibility.
      if (!e.district) throw new BadRequestException('That end of the journey is missing its district.');
      return { kind: 'DOOR', district: e.district, city: e.city ?? null };
    }
    if (!e.hubId) throw new BadRequestException('That end of the journey is missing its terminal.');
    return { kind: 'HUB', hubId: e.hubId };
  }

  /**
   * What the door legs cost, read from the hub the door attaches to.
   *
   * A door leg is a BML courier run between a terminal and an address in its
   * town, and what BML charges for that is the owner's decision, configured per
   * hub. This code reads the number; it does not decide it.
   */
  private async courierFees(
    input: ShipmentQuoteInput,
    origin: Endpoint,
    destination: Endpoint,
    hubs: readonly PlannerHub[],
    lanes: readonly PlannerLane[],
    simulated = false,
  ) {
    const wantsFirst = needsFirstMile(input.service);
    const wantsLast = needsLastMile(input.service);
    if (!wantsFirst && !wantsLast) {
      return { firstMileMinor: 0, lastMileMinor: 0, directMinor: 0, directMinutes: 0, unpricedHubs: [] as string[] };
    }

    // The SAME predicate the planner uses, imported rather than restated. When
    // this was a separate district check and the planner had moved on to towns,
    // the two disagreed: the planner produced first-mile and last-mile legs
    // while pricing insisted the journey was a single local run, and the courier
    // legs came out free.
    const journey = {
      origin,
      destination,
      service: input.service,
      preferredMode: input.preferredMode ?? null,
      // Same date as the real plan below (BMPL-196/283), so a hub this dry run
      // attaches a door to is one the actual plan can still reach.
      date: this.travelDate(input.requestedDate),
    };

    /**
     * A configured lane carries its own price and duration.
     *
     * A run up the Northern Highway is not the same job as a run across town,
     * so it must not be quoted at the local rate. Like a hub courier fee, an
     * unset price is REPORTED rather than quoted as free — an operator has to
     * decide what the lane costs before it is sellable.
     */
    const lane = findCourierLane(journey, lanes);
    if (lane) {
      return {
        firstMileMinor: 0,
        lastMileMinor: 0,
        directMinor: lane.priceMinor,
        directMinutes: lane.durationMinutes,
        unpricedHubs: lane.priceMinor === 0 ? [`the ${lane.originCity} to ${lane.destinationCity} courier run`] : [],
      };
    }

    // A local door-to-door run has no terminal, so no hub fee describes it. It
    // is priced by its own platform setting, and an unset price is reported
    // rather than quoted as free.
    if (isLocalDoorToDoor(journey)) {
      const settings = await this.prisma.platformSetting.findFirst({ orderBy: { createdAt: 'asc' } });
      // A simulation booking is priced by the simulation rate, so a number set
      // to exercise the workflow never becomes what a real customer is charged.
      const directMinor = Number(
        (simulated ? settings?.localCourierFeeTestMinor : settings?.localCourierFeeMinor) ?? 0n,
      );
      return {
        firstMileMinor: 0,
        lastMileMinor: 0,
        directMinor,
        directMinutes: settings?.localCourierMinutes ?? 0,
        unpricedHubs: directMinor === 0 ? ['local door-to-door delivery'] : [],
      };
    }

    // Ask the planner where each door attaches by planning with zero fees first;
    // that keeps hub-attachment logic in exactly one place.
    const { routes } = await this.network.plannerInputs({ isTest: simulated });
    // No lanes passed: this branch is only reached when no lane covers the
    // journey, and re-offering them here would send it back down the direct
    // path it has already been ruled out of.
    const dry = planRoute(journey, hubs, routes);
    if (!dry.ok) return { firstMileMinor: 0, lastMileMinor: 0, directMinor: 0, directMinutes: 0, unpricedHubs: [] as string[] };

    const firstHubId = dry.legs.find((l) => l.kind === 'FIRST_MILE')?.destinationHubId ?? null;
    const lastHubId = dry.legs.find((l) => l.kind === 'LAST_MILE')?.originHubId ?? null;
    const ids = [firstHubId, lastHubId].filter((v): v is string => v != null);
    const rows = ids.length
      ? await this.prisma.logisticsHub.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, courierFeeMinor: true } })
      : [];
    const feeOf = (id: string | null) => (id ? Number(rows.find((r) => r.id === id)?.courierFeeMinor ?? 0n) : 0);

    const unpricedHubs = rows.filter((r) => r.courierFeeMinor === 0n).map((r) => r.name);
    return { firstMileMinor: feeOf(firstHubId), lastMileMinor: feeOf(lastHubId), directMinor: 0, directMinutes: 0, unpricedHubs };
  }

  /* -------------------------------------------------------------- booking */

  /**
   * Book a shipment: freeze the plan into legs, and hand the parcel's first
   * custody record to the sender.
   *
   * Addresses are snapshotted. A shipment in flight must not change shape because
   * somebody edited a saved address afterwards, and the driver working leg 3 has
   * to see what was agreed at booking.
   */
  async create(userId: string, input: CreateShipmentInput, isTest?: boolean) {
    // Booking without paying exists only for the paths that predate shipment
    // payments; the customer-facing form always pays. An unpaid shipment is
    // created but never dispatched, so it cannot become work for a driver.
    const payNow = input.payWithWallet === true;
    // DERIVED from the account, never taken from the request — the same rule
    // checkout already applies to orders. Left as a hard-coded `false`, a
    // shipment booked by a designated test account was filed as real work: it
    // could never be offered to a test driver (the dispatch boundary correctly
    // refuses to mix them), so the parcel simply sat there, and it counted as
    // real volume in reporting.
    const simulated =
      isTest ??
      (await this.prisma.user.findUnique({ where: { id: userId }, select: { isTest: true } }))?.isTest ??
      false;
    const quote = await this.quote(input, { isTest: simulated });
    if (!quote.available) {
      throw new BadRequestException(quote.message ?? 'We cannot ship that route at the moment.');
    }

    const { hubs, routes, lanes } = await this.network.plannerInputs({ isTest: simulated });
    const origin = this.toEndpoint(input, 'origin');
    const destination = this.toEndpoint(input, 'destination');
    const fees = await this.courierFees(input, origin, destination, hubs, lanes, simulated);
    const plan = planRoute(
      { origin, destination, service: input.service, preferredMode: input.preferredMode ?? null, date: this.travelDate(input.requestedDate) },
      hubs,
      routes,
      {
        firstMileMinor: fees.firstMileMinor,
        lastMileMinor: fees.lastMileMinor,
        firstMileMinutes: 0,
        lastMileMinutes: 0,
        directMinor: fees.directMinor,
        directMinutes: fees.directMinutes,
      },
      lanes,
    );
    if (!plan.ok) throw new BadRequestException(plan.explanation);

    // ZERO IS NOT A PRICE — it is the absence of one. The quote already says
    // this out loud ("an operator has to set these before this is sellable"),
    // but nothing stopped the booking: a zero total sailed on into the wallet,
    // whose ledger rightly refuses a zero-amount escrow, and the customer got a
    // bare 500 for an operator's missing configuration. Refuse cleanly instead.
    // Keyed on the TOTAL, deliberately not on pricingIncomplete: a zero-fee hub
    // on a journey with priced transport books fine today and must keep doing
    // so, while an unpriced local run and a zero-priced courier lane are both
    // caught here by the same rule. Booking a deliberate free shipment, if the
    // product ever wants one, is an explicit opt-in on top of this — not a
    // loosening of it.
    if (plan.totalMinor <= 0) {
      throw new BadRequestException(
        'This journey has not been priced yet, so it cannot be booked. Please try again later or contact support.',
      );
    }

    const endsAtHub = !needsLastMile(input.service);
    const originHubId = plan.legs.find((l) => l.kind === 'LINE_HAUL')?.originHubId ?? null;
    const destinationHubId = [...plan.legs].reverse().find((l) => l.kind === 'LINE_HAUL')?.destinationHubId ?? null;

    // The standing carrier organization of each planned route, copied onto the
    // leg at booking (snapshot rule, like every other planner output): the leg
    // is then operable by that carrier's own surface from the moment it exists,
    // and a later route re-assignment never silently re-scopes an in-flight
    // journey. Overridable per leg by admin (setLegOperator).
    //
    // Eligibility is RE-CHECKED at the copy (BMPL-152): snapshot semantics are
    // right for a leg that already exists, and wrong for one created after
    // the org went inactive or lost its approval — such a leg would land where
    // nobody can act on it and only stall until a human noticed. An ineligible
    // org's route books with the leg UNASSIGNED, which surfaces it in the
    // existing manual-assignment path rather than inventing a new one. The
    // booking itself never fails over a lapsed carrier.
    const plannedRouteIds = plan.legs.map((l) => l.routeId).filter((id): id is string => id != null);
    const routeRows = plannedRouteIds.length
      ? await this.prisma.logisticsRoute.findMany({
          where: { id: { in: plannedRouteIds } },
          select: { id: true, operatedByProviderId: true },
        })
      : [];
    const eligibleOperators = new Set<string>();
    for (const pid of new Set(routeRows.map((r) => r.operatedByProviderId).filter((id): id is string => id != null))) {
      try {
        await assertOperableProvider(this.prisma, pid, simulated);
        eligibleOperators.add(pid);
      } catch {
        // Leave every leg of this org's routes unassigned — the one shared
        // rule decides, and the refusal reasons stay its own.
      }
    }
    const routeOperators = new Map<string, string | null>(
      routeRows.map((r) => [r.id, r.operatedByProviderId && eligibleOperators.has(r.operatedByProviderId) ? r.operatedByProviderId : null]),
    );

    const shipment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.shipment.create({
        data: {
          reference: await this.uniqueReference(tx),
          // The recipient's capability link, minted at booking. The sender
          // shares it; holding it grants the minimal public view and nothing
          // else. Never derived from the reference — a reference is short
          // enough to guess at, and guessing a URL must never find a parcel.
          recipientToken: await this.uniqueRecipientToken(tx),
          service: input.service,
          isTest: simulated,
          customerUserId: userId,
          originHubId,
          destinationHubId,
          originName: input.origin.name ?? null,
          originPhone: input.origin.phone ?? null,
          originEmail: input.origin.email ?? null,
          originCompany: input.origin.company ?? null,
          originAddress: input.origin.address ?? null,
          originAddress2: input.origin.address2 ?? null,
          originCity: input.origin.city ?? null,
          originDistrict: input.origin.district ?? null,
          originLatitude: input.origin.latitude ?? null,
          originLongitude: input.origin.longitude ?? null,
          originInstructions: input.origin.instructions ?? null,
          destinationName: input.destination.name ?? null,
          destinationPhone: input.destination.phone ?? null,
          destinationEmail: input.destination.email ?? null,
          destinationCompany: input.destination.company ?? null,
          destinationAddress: input.destination.address ?? null,
          destinationAddress2: input.destination.address2 ?? null,
          destinationCity: input.destination.city ?? null,
          destinationDistrict: input.destination.district ?? null,
          destinationLatitude: input.destination.latitude ?? null,
          destinationLongitude: input.destination.longitude ?? null,
          destinationInstructions: input.destination.instructions ?? null,
          preferredMode: input.preferredMode ?? null,
          quotedTotalMinor: BigInt(plan.totalMinor),
          quotedMinutes: plan.totalMinutes,
          planExplanation: plan.explanation,
          description: input.description ?? null,
          weightGrams: input.weightGrams ?? null,
          pieces: input.pieces,
          bookedAt: new Date(),
          legs: { create: plan.legs.map((l) => this.legData(l, payNow, routeOperators)) },
        },
        include: SHIPMENT_INCLUDE,
      });

      // The sender holds it until somebody collects it. Recording this at booking
      // means the chain has no gap at its start.
      await tx.custodyEvent.create({
        data: {
          shipmentId: created.id,
          shipmentLegId: created.legs[0]?.id ?? null,
          fromHolder: null,
          toHolder: 'SENDER',
          actorUserId: userId,
          note: 'Shipment booked.',
        },
      });

      // Money, in the same transaction that created the shipment.
      //
      // If the customer cannot afford it the whole thing rolls back and NO
      // shipment exists — the same guarantee marketplace checkout gives. A
      // half-booked parcel with an unpayable price is worse than a refusal,
      // because somebody eventually has to work out what to do with it.
      if (payNow) {
        const payment = await this.payments.createForShipment(
          tx,
          {
            id: created.id,
            reference: created.reference,
            userId,
            totalMinor: BigInt(plan.totalMinor),
            currency: 'BZD',
          },
          { userId },
        );
        await this.payments.escrowInTx(tx, payment.id, { userId });
      }

      const status = this.statusFrom(created.legs, endsAtHub);
      return tx.shipment.update({ where: { id: created.id }, data: { status }, include: SHIPMENT_INCLUDE });
    });

    await this.audit.record({
      action: 'SHIPMENT_CREATED',
      actorId: userId,
      newValue: { shipmentId: shipment.id, reference: shipment.reference, service: shipment.service, legs: shipment.legs.length, isTest: simulated },
    });

    // If the journey starts at a door, a driver has to go and collect it. Offer
    // that leg now rather than waiting up to twenty seconds for the sweeper —
    // the customer has just pressed Book and is watching the screen.
    //
    // Only once it is paid for. An unpaid shipment's legs are left PENDING, so
    // neither this call nor the sweeper can turn one into a driver's job.
    const firstLeg = shipment.legs.find((l) => l.sequence === 1);
    if (payNow && (firstLeg?.kind === 'FIRST_MILE' || firstLeg?.kind === 'DIRECT')) {
      await this.dispatch.dispatchLeg(firstLeg.id);
    }

    return this.serialize(shipment, { audience: 'CUSTOMER' });
  }

  /**
   * The first leg is immediately workable; the rest wait their turn.
   *
   * Unless the shipment has not been paid for, in which case nothing is workable
   * — a driver must never be sent for a parcel nobody has committed money to.
   */
  private legData(l: PlannedLeg, paid: boolean, routeOperators?: Map<string, string | null>) {
    return {
      sequence: l.sequence,
      kind: l.kind,
      mode: l.mode,
      status: (l.sequence === 1 && paid ? 'READY' : 'PENDING') as LegStatus,
      originHubId: l.originHubId,
      destinationHubId: l.destinationHubId,
      routeId: l.routeId,
      // The route's standing carrier org, snapshotted (BMPL-137). Courier legs
      // have no route and stay null — they are BML driver work.
      operatedByProviderId: l.routeId ? (routeOperators?.get(l.routeId) ?? null) : null,
      durationMinutes: l.durationMinutes,
      priceMinor: BigInt(l.priceMinor),
      description: l.description,
      handoffPin: this.genPin(),
    };
  }

  private genPin(): string {
    return String(randomInt(0, 10 ** PIN_LENGTH)).padStart(PIN_LENGTH, '0');
  }

  /** Short, unambiguous, and checked for collision rather than assumed unique. */
  private async uniqueReference(tx: Prisma.TransactionClient): Promise<string> {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
    for (let attempt = 0; attempt < 8; attempt++) {
      const body = Array.from({ length: 8 }, () => alphabet[randomInt(0, alphabet.length)]).join('');
      // New references use the current abbreviation. Existing BML- references
      // stay valid: tracking looks a reference up, it never parses the prefix.
      const reference = `BML-${body}`;
      if (!(await tx.shipment.findUnique({ where: { reference }, select: { id: true } }))) return reference;
    }
    throw new BadRequestException('Could not allocate a tracking reference. Please try again.');
  }

  /**
   * The recipient link's capability token.
   *
   * 24 characters from a 32-symbol alphabet is ~120 bits of entropy — holding
   * the token IS the authorisation, so the token has to be beyond enumeration,
   * not merely unique. Same collision discipline as the reference: checked,
   * never assumed (the unique index is the backstop for the race).
   */
  private async uniqueRecipientToken(tx: Prisma.TransactionClient): Promise<string> {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
    for (let attempt = 0; attempt < 8; attempt++) {
      const token = Array.from({ length: 24 }, () => alphabet[randomInt(0, alphabet.length)]).join('');
      if (!(await tx.shipment.findUnique({ where: { recipientToken: token }, select: { id: true } }))) return token;
    }
    throw new BadRequestException('Could not allocate a tracking link. Please try again.');
  }

  /* ------------------------------------------------------------- tracking */

  /** One journey, whoever is asking. Customers see their own; staff see any. */
  async track(reference: string, viewer: { userId: string; isStaff: boolean }) {
    const shipment = await this.prisma.shipment.findUnique({ where: { reference }, include: SHIPMENT_INCLUDE });
    if (!shipment) throw new NotFoundException('No shipment with that reference.');
    if (!viewer.isStaff && shipment.customerUserId !== viewer.userId) {
      // Deliberately the same message as a miss: a tracking reference that
      // answers "wrong customer" instead of "not found" is a way to enumerate.
      throw new NotFoundException('No shipment with that reference.');
    }
    return this.serialize(shipment, { audience: viewer.isStaff ? 'STAFF' : 'CUSTOMER' });
  }

  /**
   * The RECIPIENT's view: unauthenticated, capability-addressed, minimal.
   *
   * Anyone holding the link is the audience, so this is an ALLOWLIST built by
   * hand — it deliberately does not reuse `serialize()`, whose job is to tell
   * the whole story to people entitled to it. A field appears here only
   * because the recipient needs it to act:
   *
   *   - reference: what they quote at a collection desk;
   *   - status and step progress, in the customer-language labels;
   *   - the collection terminal, once the parcel is waiting there — terminal
   *     details are already public via /shipping/hubs;
   *   - the destination town, so the link is recognisably "coming to me".
   *
   * What a holder never sees, and why: the sender's identity and address
   * (privacy — the sender typed it for delivery, not for publication), all
   * money (the price is the customer's business), the parcel description
   * (customer-typed, can be sensitive), the handoff PIN (the two-party
   * handoff survives a leaked link only if the link cannot complete one),
   * custody actor names, driver identity, and operator-typed exception or
   * cancellation reasons (label only).
   *
   * A miss is one fixed 404 whatever the cause — wrong token, deleted row,
   * never existed — so a guessed URL cannot confirm a real shipment exists.
   *
   * This is the SAME allowlist a legitimately linked recipient sees in their
   * own account (`trackAsRecipient`/`listIncoming`) — linking does not widen
   * it, it only lets an account reach it without holding the raw token.
   */
  async trackPublic(token: string) {
    const s = await this.prisma.shipment.findUnique({
      where: { recipientToken: token },
      include: RECIPIENT_VIEW_INCLUDE,
    });
    if (!s) throw new NotFoundException('No shipment for that link.');
    return this.recipientView(s);
  }

  private recipientView(s: RecipientViewGraph) {
    const endsAtHub = !needsLastMile(s.service);
    const live = s.legs.filter((l) => l.status !== 'CANCELLED');
    const current = live.find((l) => l.status !== 'COMPLETED') ?? null;

    return {
      reference: s.reference,
      status: s.status,
      statusLabel: SHIPMENT_STATUS_LABELS[s.status] ?? s.status,
      serviceLabel: SHIPPING_SERVICE_LABELS[s.service],
      bookedAt: s.bookedAt,
      deliveredAt: s.deliveredAt,
      destination: { city: s.destinationCity, district: s.destinationDistrict },
      // Where to collect, only once there is genuinely something to collect.
      collectionHub:
        endsAtHub && s.status === 'AWAITING_COLLECTION' && s.destinationHub
          ? {
              name: s.destinationHub.name,
              city: s.destinationHub.city,
              address: s.destinationHub.addressLine1,
              instructions: s.destinationHub.instructions,
            }
          : null,
      steps: live.map((l) => ({
        sequence: l.sequence,
        kindLabel: LEG_KIND_LABELS[l.kind],
        modeLabel: TRANSPORT_MODE_LABELS[l.mode],
        // The planner's own description — generated from terminal names only,
        // never from an address or a person.
        description: l.description,
        completed: l.status === 'COMPLETED',
        isCurrent: current?.id === l.id,
        completedAt: l.completedAt,
      })),
    };
  }

  /**
   * A legitimately linked recipient's own copy of the tracking view.
   *
   * Scoped by `recipientUserId`, never by reference or id alone — a reference
   * is customer-facing and effectively guessable-adjacent (sequential-ish,
   * shared at a collection desk out loud), so it must never double as a
   * lookup key for someone else's shipment. A miss reads identically whether
   * the reference does not exist or simply was never claimed by this
   * account, for the same enumeration-resistance reason `trackPublic` uses
   * one fixed 404.
   */
  async trackAsRecipient(reference: string, userId: string) {
    const s = await this.prisma.shipment.findUnique({ where: { reference }, include: RECIPIENT_VIEW_INCLUDE });
    if (!s || s.recipientUserId !== userId) throw new NotFoundException('No shipment with that reference.');
    return this.recipientView(s);
  }

  /** Every shipment this account has claimed as recipient, newest first. */
  async listIncoming(userId: string) {
    const rows = await this.prisma.shipment.findMany({
      where: { recipientUserId: userId },
      orderBy: { createdAt: 'desc' },
      include: RECIPIENT_VIEW_INCLUDE,
      take: 50,
    });
    return rows.map((s) => this.recipientView(s));
  }

  /**
   * The claim itself — the one action that turns "holds the tracking link"
   * into "is the shipment's recipient of record".
   *
   * Keyed on the SAME unguessable `recipientToken` the public view uses —
   * never a reference or id — PLUS a matching signal: the claiming account's
   * OWN email or phone, already on file, must equal `destinationEmail` or
   * `destinationPhone` (normalized — see `normalizeEmail`/`normalizePhone`).
   * Owner decision, 2026-09-30, forced by two rulings together: ruling 12
   * says a tracking token proves possession of a link, never authorization,
   * which rules out "holds the token, first authenticated account to click
   * wins"; ruling 7 already contemplates an account that has "CLAIMED" a
   * shipment, so a real claim step is expected to exist. A matching signal
   * is the minimum authorization consistent with both — no sender
   * round-trip, and strictly more than link possession alone.
   *
   * NEVER A SENDER ROUND-TRIP, AND NEVER AN ORACLE. The caller is never
   * asked to type the email/phone themselves (that would just move the
   * guess into a form field), and a failed match never says which of
   * email/phone didn't match, or what the real value was — one generic
   * message either way. Matching on the account's OWN fields, read from its
   * own row rather than accepted in the request body, is what keeps this
   * from becoming exactly the "does this email/phone belong to an account"
   * probe account linking was told to avoid: nothing about a stranger's
   * email or phone can be tested without actually holding an account
   * registered under it.
   *
   * RATE-LIMITED, NOT SILENTLY UNLIMITED: `recipientClaimAttempts` is
   * `ShipmentLeg.handoffPinAttempts`' own precedent, applied here — a failed
   * match increments it and is audited (`SHIPMENT_RECIPIENT_CLAIM_FAILED`),
   * and `MAX_RECIPIENT_CLAIM_ATTEMPTS` failures lock the shipment's claim
   * link for good (an administrator has to intervene), exactly mirroring
   * `verifyHandoffPin`'s lockout rather than inventing a second shape. The
   * counter lives on the SHIPMENT, not the account, so the limit cannot be
   * laundered by registering a fresh account per guess.
   *
   * Idempotent for the same account (a retried tap does not error, and never
   * touches the match/attempt logic), and race-safe against a second
   * account: the write is a conditional `updateMany` guarded on
   * `recipientUserId: null`, so only one of two concurrent claims can land —
   * the lock-then-check-in-the-write-clause pattern already used by
   * `resolveException`'s exception-claim race.
   *
   * ACCEPTED, NOT OVERLOOKED: a real-but-already-claimed token answers 400
   * here, while a nonexistent one answers 404 above — a distinguishable
   * failure that would normally be an oracle (BMPL-140's own standard is one
   * fixed answer for "missing" and "not yours"). It is accepted as a
   * deliberate tradeoff because it tells the caller nothing they could not
   * already learn: anyone holding this token can call the anonymous
   * `trackPublic` route right now and get back 200 with the shipment's live
   * status, which already proves the shipment exists. The 400/404 split adds
   * no information to a token holder that the read path does not already
   * give away for free. REVISIT THIS if `recipientToken` ever stops being an
   * independently unguessable, opaque value — e.g. if it is ever derived
   * from the reference, a sequence, or anything else a caller could produce
   * without having first received the real token — because at that point the
   * split would tell an attacker "this token exists" without them needing
   * the anonymous route to already know it. An already-claimed-by-someone-
   * else shipment is refused BEFORE the match/attempt logic ever runs and
   * regardless of whether this caller's own details would have matched —
   * there is nothing left to claim, and "someone already claimed this" is
   * not new information about the real recipient's identity.
   */
  async claimAsRecipient(token: string, userId: string) {
    const s = await this.prisma.shipment.findUnique({
      where: { recipientToken: token },
      select: {
        id: true,
        reference: true,
        isTest: true,
        recipientUserId: true,
        recipientClaimAttempts: true,
        destinationEmail: true,
        destinationPhone: true,
      },
    });
    if (!s) throw new NotFoundException('No shipment for that link.');
    if (s.recipientUserId === userId) {
      return { reference: s.reference, linked: true };
    }
    if (s.recipientUserId != null) {
      throw new BadRequestException('This shipment has already been linked to another account.');
    }

    // KNOWN LIMITATION (accepted, not solved, by owner review 2026-09-30):
    // the counter lives on the SHIPMENT so the limit cannot be laundered by
    // registering a fresh account per guess (see this method's own top
    // comment) — but that same property means anyone merely holding the
    // tracking link can deliberately burn all five attempts and permanently
    // lock out the genuine recipient. A locked-out recipient here and a
    // locked-out handoff PIN (verifyHandoffPin) are the same unanswered
    // question, and it is already in front of the owner as BMPL-13. Do not
    // invent a reset path here — that would decide BMPL-13 by
    // implementation rather than by the owner actually deciding it.
    if (s.recipientClaimAttempts >= MAX_RECIPIENT_CLAIM_ATTEMPTS) {
      throw new ForbiddenException('Too many attempts to link this account to this shipment. Contact support for help.');
    }

    const me = await this.prisma.user.findUnique({ where: { id: userId }, select: { isTest: true, email: true, phone: true } });
    // Simulation and real shipments never mix, in either direction — the
    // same boundary money, network and dispatch already enforce. Not a
    // matching-signal failure, so it is never counted as an attempt.
    if (!me || me.isTest !== s.isTest) {
      throw new BadRequestException('This shipment cannot be linked to this account.');
    }

    const myEmail = normalizeEmail(me.email);
    const myPhone = normalizePhone(me.phone);
    const matches =
      (myEmail != null && myEmail === normalizeEmail(s.destinationEmail)) ||
      (myPhone != null && myPhone === normalizePhone(s.destinationPhone));

    if (!matches) {
      const updated = await this.prisma.shipment.update({
        where: { id: s.id },
        data: { recipientClaimAttempts: { increment: 1 } },
        select: { recipientClaimAttempts: true },
      });
      await this.audit.record({
        action: 'SHIPMENT_RECIPIENT_CLAIM_FAILED',
        actorId: userId,
        newValue: { shipmentId: s.id },
      });
      const left = MAX_RECIPIENT_CLAIM_ATTEMPTS - updated.recipientClaimAttempts;
      throw new BadRequestException(
        left > 0
          ? `We couldn't confirm this parcel is addressed to you. Check that your account's email or phone matches what the sender used, then try again. ${left} ${left === 1 ? 'try' : 'tries'} left.`
          : `We couldn't confirm this parcel is addressed to you, and that was the last try.`,
      );
    }

    const claimed = await this.prisma.shipment.updateMany({
      where: { id: s.id, recipientUserId: null },
      data: { recipientUserId: userId, recipientClaimedAt: new Date() },
    });
    if (claimed.count === 0) {
      // Someone else's claim landed between the read above and this write.
      throw new BadRequestException('This shipment has already been linked to another account.');
    }

    await this.audit.record({
      action: 'SHIPMENT_RECIPIENT_LINKED',
      actorId: userId,
      newValue: { reference: s.reference },
    });
    return { reference: s.reference, linked: true };
  }

  async listMine(userId: string) {
    const rows = await this.prisma.shipment.findMany({
      where: { customerUserId: userId },
      orderBy: { createdAt: 'desc' },
      include: SHIPMENT_INCLUDE,
      take: 50,
    });
    // One lookup for every leg across every shipment in the page, not one per
    // shipment (`serialize` would otherwise re-run it per call) and not one per
    // leg — up to 50 shipments here, each with several legs.
    const conversationIds = await this.legConversationIds(rows.flatMap((s) => s.legs.map((l) => l.id)));
    return Promise.all(rows.map((s) => this.serialize(s, { audience: 'CUSTOMER', conversationIds })));
  }

  /**
   * The operations board.
   *
   * Ordered by "needs a human first": exceptions, then anything stalled waiting
   * for a driver nobody could find, then everything else newest-first. An
   * operations list sorted purely by date makes the one shipment in trouble as
   * hard to find as the ninety that are fine.
   */
  async listForOps(input: ShipmentListInput) {
    const where: Prisma.ShipmentWhereInput = {
      ...(input.status ? { status: input.status as ShipmentStatus } : {}),
      ...(input.service ? { service: input.service } : {}),
      // Test shipments are hidden by default so the board reflects real work.
      ...(input.includeTest ? {} : { isTest: false }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.shipment.findMany({
        where,
        orderBy: [{ exceptionAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        include: {
          customer: { select: { firstName: true, lastName: true, email: true } },
          legs: {
            orderBy: { sequence: 'asc' },
            select: {
              id: true, sequence: true, kind: true, mode: true, status: true, courierStatus: true,
              dispatchExhaustedAt: true,
              originHub: { select: { code: true, name: true } },
              destinationHub: { select: { code: true, name: true } },
              assignedDriver: { select: { displayName: true } },
              carrierName: true,
            },
          },
        },
      }),
      this.prisma.shipment.count({ where }),
    ]);

    return {
      total,
      page: input.page,
      pageSize: input.pageSize,
      rows: rows.map((s) => ({
        id: s.id,
        reference: s.reference,
        service: s.service,
        serviceLabel: SHIPPING_SERVICE_LABELS[s.service],
        status: s.status,
        statusLabel: SHIPMENT_STATUS_LABELS[s.status] ?? s.status,
        isTest: s.isTest,
        customer: s.customer ? `${s.customer.firstName} ${s.customer.lastName}`.trim() || s.customer.email : null,
        origin: [s.originCity, s.originDistrict?.replace(/_/g, ' ')].filter(Boolean).join(', ') || null,
        destination: [s.destinationCity, s.destinationDistrict?.replace(/_/g, ' ')].filter(Boolean).join(', ') || null,
        totalMinor: money(s.quotedTotalMinor),
        exceptionReason: s.exceptionReason,
        // The two things an operator scans for.
        needsAttention: s.status === 'EXCEPTION',
        needsDriver: s.legs.some((l) => l.dispatchExhaustedAt != null),
        createdAt: s.createdAt,
        legs: s.legs.map((l) => ({
          id: l.id,
          sequence: l.sequence,
          kind: l.kind,
          mode: l.mode,
          status: l.status,
          courierStatus: l.courierStatus,
          from: l.originHub?.name ?? 'Door',
          to: l.destinationHub?.name ?? 'Door',
          operator: l.assignedDriver?.displayName ?? l.carrierName ?? null,
          needsDriver: l.dispatchExhaustedAt != null,
        })),
      })),
    };
  }

  /**
   * Terminals expecting a parcel, for the hub handoff desk.
   *
   * BMPL-247: this used to also select and return the courier's personal
   * application phone (`DriverProfile.phone`) — visible to every holder of
   * `logistics.read`, a platform-wide, cross-hub permission, with no scoping
   * to "staff at this terminal" and no narrower gate of its own. The owner's
   * ruling: that number is sensitive identity data and stays private by
   * default; least privilege applies to whatever staff access legitimately
   * remains. `broughtBy` (display name) already identifies who is bringing
   * the parcel — the same minimum-operational-identity line this codebase
   * already draws for a customer's own tracking view (BMPL-180,
   * `courierSummary()` below) applies here too, for a different audience.
   * The desk display never used the phone as a tel: link or otherwise acted
   * on it — plain text only — so nothing operational is lost by not
   * selecting it in the first place; the fix belongs at the query, not at
   * hiding a returned field in the UI.
   */
  async expectedAtHub(hubId: string) {
    const legs = await this.prisma.shipmentLeg.findMany({
      where: {
        destinationHubId: hubId,
        status: { in: ['READY', 'IN_PROGRESS'] },
      },
      orderBy: [{ arrivedAt: { sort: 'desc', nulls: 'last' } }, { sequence: 'asc' }],
      take: 100,
      include: {
        shipment: { select: { reference: true, description: true, pieces: true, destinationName: true } },
        originHub: { select: { name: true } },
        assignedDriver: { select: { displayName: true } },
      },
    });
    return legs.map((l) => ({
      legId: l.id,
      reference: l.shipment.reference,
      kind: l.kind,
      // Who is bringing it: a BML driver on a first mile, a carrier on a flight.
      broughtBy: l.assignedDriver?.displayName ?? l.carrierName ?? 'Carrier',
      from: l.originHub?.name ?? 'Door collection',
      parcel: l.shipment.description || `${l.shipment.pieces} ${l.shipment.pieces === 1 ? 'parcel' : 'parcels'}`,
      // Whether it is actually here yet, or still on its way.
      arrived: l.arrivedAt != null || l.courierStatus === 'ARRIVING',
      departedAt: l.departedAt,
      arrivedAt: l.arrivedAt,
      forRecipient: l.shipment.destinationName,
    }));
  }

  /* --------------------------------------------------------- leg operation */

  /**
   * Start a courier leg (FIRST_MILE/LAST_MILE/DIRECT): a driver now has the
   * parcel.
   *
   * A transport leg (LINE_HAUL) NEVER starts here — it leaves READY only
   * through `departLeg`, which is the one place that consults the route's
   * BMPL-186 schedule (BMPL-196). Before this guard, `assignedDriverProfileId`
   * being null for a LINE_HAUL leg made the owner check below a silent no-op,
   * so `POST admin/logistics/legs/:id/start` — gated only on
   * `logistics.operate`, with no schedule check of its own — could advance a
   * LINE_HAUL leg straight to IN_PROGRESS on a route the carrier had marked
   * NOT_OPERATING for today, bypassing the very check `departLeg` enforces on
   * the exact same leg. Automatic dispatch and admin manual assignment both
   * already refuse to put a driver on a LINE_HAUL leg
   * (`shipment-dispatch.service.ts`), so nothing legitimate ever reaches this
   * method with one — this closes the gap rather than changing any real path.
   *
   * Same owner rule as `verifyHandoffPin` (BMPL-174), applied to the OTHER end
   * of a courier's custody: picking up. There is no code to check here — the
   * sender and the terminal desk do not hold one — but the actor recording the
   * pickup still has to BE the courier the parcel is credited to, or an ops
   * account with `logistics.operate` could mark a pickup as done by a driver
   * who never touched the parcel. The driver's own path (`confirmPickup`)
   * already asserts this via `ownedLeg` before reaching here; this closes the
   * same gap for the admin desk, the way BMPL-174 closed it for handoff.
   */
  async startLeg(legId: string, actor: { userId: string; label?: string }) {
    return this.transition(legId, actor, async (tx, leg, shipment) => {
      if (leg.kind === 'LINE_HAUL') {
        throw new BadRequestException('A transport leg does not start here — record its departure instead.');
      }
      if (leg.status !== 'READY') {
        throw new BadRequestException(`This leg is ${leg.status.toLowerCase()}, so it cannot be started.`);
      }
      if (leg.assignedDriverProfileId != null) {
        const profile = await tx.driverProfile.findUnique({ where: { userId: actor.userId }, select: { id: true } });
        if (profile?.id !== leg.assignedDriverProfileId) {
          throw new ForbiddenException('You are not the courier assigned to this leg.');
        }
      }
      await tx.shipmentLeg.update({ where: { id: leg.id }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });
      await this.appendCustody(tx, shipment.id, leg.id, {
        fromHolder: leg.sequence === 1 ? 'SENDER' : 'HUB',
        // Never CARRIER: the LINE_HAUL guard above means only a driver leg
        // (FIRST_MILE/LAST_MILE/DIRECT) reaches this point.
        toHolder: 'DRIVER',
        hubId: leg.originHubId,
        actorUserId: actor.userId,
        actorLabel: actor.label,
        note: 'Collected.',
      });
      return { action: 'SHIPMENT_LEG_STARTED' as const, note: null };
    });
  }

  /**
   * A line-haul left the terminal. Carrier details are recorded as given.
   *
   * Gated on the route's own BMPL-186 schedule for today (BMPL-196): a
   * carrier who has told BML this route does not run today cannot then
   * confirm a departure on it. REDUCED still departs — operations said
   * thinner, not stopped — and a route with no schedule configured at all
   * (every real route today) resolves OPERATING, so this changes nothing for
   * the unconfigured network. Both the staff desk and the carrier's own
   * surface (ShippingProviderService.depart) call this same method, so the
   * gate applies identically to each.
   */
  async departLeg(legId: string, input: LegDepartInput, actor: { userId: string; label?: string }) {
    return this.transition(legId, actor, async (tx, leg, shipment) => {
      if (leg.kind !== 'LINE_HAUL') throw new BadRequestException('Only a transport leg departs from a terminal.');
      if (leg.status !== 'READY' && leg.status !== 'IN_PROGRESS') {
        throw new BadRequestException(`This leg is ${leg.status.toLowerCase()}, so it cannot depart.`);
      }
      // ShipmentLeg.routeId is nullable on the column, but a LINE_HAUL leg is
      // only ever created by the route planner (route-planner.ts), which
      // unconditionally sets it to the real route it planned — so this branch
      // is structurally unreachable today. It stays a loud refusal rather
      // than a silent skip on purpose: the schedule check just below cannot
      // run without a route to look up, and a future second leg-creation path
      // that forgot to set routeId would otherwise depart unchecked with
      // nothing failing anywhere — a quiet way to disable BMPL-196 enforcement
      // that nobody adding that path would have reason to suspect.
      if (!leg.routeId) {
        throw new BadRequestException('This transport leg has no route on record, so its schedule cannot be checked. Contact operations.');
      }
      const [days, exceptions] = await Promise.all([
        tx.routeOperatingDay.findMany({ where: { routeId: leg.routeId } }),
        tx.routeScheduleException.findMany({ where: { routeId: leg.routeId } }),
      ]);
      const resolution = resolveScheduleStatus(
        this.travelDate(),
        days.map((d) => ({ dayOfWeek: d.dayOfWeek, status: d.status, note: d.note })),
        exceptions.map((e) => ({ date: e.date, status: e.status, reason: e.reason })),
      );
      if (resolution.status === 'NOT_OPERATING') {
        throw new BadRequestException(
          `This route is configured as not operating today${resolution.note ? ` (${resolution.note})` : ''}. Update the schedule before recording a departure, or contact operations.`,
        );
      }
      await tx.shipmentLeg.update({
        where: { id: leg.id },
        data: {
          status: 'IN_PROGRESS',
          startedAt: leg.startedAt ?? new Date(),
          departedAt: new Date(),
          carrierName: input.carrierName ?? leg.carrierName,
          carrierBookingRef: input.carrierBookingRef ?? leg.carrierBookingRef,
        },
      });
      await this.appendCustody(tx, shipment.id, leg.id, {
        fromHolder: 'HUB',
        toHolder: 'CARRIER',
        hubId: leg.originHubId,
        actorUserId: actor.userId,
        actorLabel: input.carrierName ?? actor.label,
        note: input.note ?? 'Departed.',
      });
      return { action: 'SHIPMENT_LEG_DEPARTED' as const, note: input.note ?? null };
    });
  }

  /** A line-haul reached the far terminal but has not been handed over yet. */
  async arriveLeg(legId: string, actor: { userId: string; label?: string }) {
    return this.transition(legId, actor, async (tx, leg) => {
      if (leg.kind !== 'LINE_HAUL') throw new BadRequestException('Only a transport leg arrives at a terminal.');
      if (leg.status !== 'IN_PROGRESS') throw new BadRequestException('That leg is not in transit.');
      await tx.shipmentLeg.update({ where: { id: leg.id }, data: { arrivedAt: new Date() } });
      return { action: 'SHIPMENT_LEG_ARRIVED' as const, note: null };
    });
  }

  /** Complete a leg: verify the handoff, then hand custody to whoever now holds it. */
  async completeLeg(legId: string, input: LegHandoffInput, actor: { userId: string; label?: string }) {
    let released = false;
    // The code is checked BEFORE the transition transaction, in its own write.
    // A failed attempt recorded inside the transaction is rolled back when that
    // transaction throws, so the counter would never climb and the lockout below
    // would be unreachable — the code could be guessed forever.
    await this.verifyHandoffPin(legId, input.pin, actor);

    const result = await this.transition(legId, actor, async (tx, leg, shipment) => {
      await tx.shipmentLeg.update({
        where: { id: leg.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          arrivedAt: leg.arrivedAt ?? (leg.kind === 'LINE_HAUL' ? new Date() : null),
          handoffVerifiedAt: new Date(),
          handoffVerificationStatus: 'VERIFIED',
          handoffReceivedByName: input.receivedByName,
        },
      });

      // Who holds it now depends on where this leg ended, not on who was carrying.
      const toHolder: CustodyHolder = leg.destinationHubId ? 'HUB' : 'RECIPIENT';
      await this.appendCustody(tx, shipment.id, leg.id, {
        fromHolder: leg.kind === 'LINE_HAUL' ? 'CARRIER' : 'DRIVER',
        toHolder,
        hubId: leg.destinationHubId,
        actorUserId: actor.userId,
        actorLabel: input.receivedByName,
        latitude: input.latitude,
        longitude: input.longitude,
        verification: 'VERIFIED',
        note: input.note ?? `Handed over to ${input.receivedByName}.`,
      });

      // Release the next leg. THIS is the moment a last-mile courier becomes
      // dispatchable, and not one moment before.
      await this.releaseNext(tx, shipment.id);
      // Offering happens AFTER the transaction commits (see below) — a driver
      // must never be told about a leg whose release could still roll back.
      released = true;
      return { action: 'SHIPMENT_LEG_HANDOFF' as const, note: input.note ?? null };
    });

    // The parcel has physically moved, so a leg that was impossible a moment ago
    // may now be workable. Offering it here — after the commit — is what makes
    // "the last mile becomes dispatchable when the line-haul arrives" true in
    // seconds rather than on the next sweeper tick.
    if (released) await this.offerNewlyReadyCourierLeg(legId);
    return result;
  }

  /** Offer whichever courier leg this shipment has just unlocked, if any. */
  private async offerNewlyReadyCourierLeg(completedLegId: string) {
    const completed = await this.prisma.shipmentLeg.findUnique({
      where: { id: completedLegId },
      select: { shipmentId: true },
    });
    if (!completed) return;
    const next = await this.prisma.shipmentLeg.findFirst({
      where: {
        shipmentId: completed.shipmentId,
        kind: { in: ['FIRST_MILE', 'LAST_MILE'] },
        status: 'READY',
        assignedDriverProfileId: null,
      },
      orderBy: { sequence: 'asc' },
      select: { id: true },
    });
    if (next) await this.dispatch.dispatchLeg(next.id);
  }

  /**
   * Prove the handoff before anything moves.
   *
   * The PIN is held by whoever RECEIVES the parcel, so the person handing it over
   * has to produce it. Same shape as the delivery PIN that already works, and the
   * same lockout after repeated failures — a code that can be guessed forever is
   * not a verification.
   *
   * A code is necessary but is not sufficient. When a leg has an assigned
   * courier (`assignedDriverProfileId` — FIRST_MILE, LAST_MILE, DIRECT), only
   * the CURRENTLY assigned driver may complete it, even with the right code:
   * a code overheard, read off a screen or otherwise learned by someone else
   * with handoff-completing access must not let them stand in for the courier.
   * Reassignment already updates `assignedDriverProfileId`, so checking the
   * live column (not who was assigned when the PIN was minted) is what makes a
   * legitimate reassignment work for the newly assigned driver with no special
   * case. A leg with no assigned courier — terminal-to-terminal movement inside
   * a carrier's own operated leg (`LINE_HAUL`) — DOES still reach this method:
   * `ShippingProviderLegsController` exposes depart/arrive only (handoff is
   * deliberately left to the receiving desk's `logistics.operate` route, the
   * same one courier legs use), so a `LINE_HAUL` leg's handoff is completed
   * right here too. It has nothing to check by construction, not by never
   * arriving: `assignedDriverProfileId` is only ever set for a driver-carried
   * leg (FIRST_MILE/LAST_MILE/DIRECT), so it stays null for every LINE_HAUL leg
   * regardless of who completes the handoff, and the check above is correctly
   * a no-op for it — the same code-only proof the receiving desk always did.
   *
   * The wrong-courier and wrong-code cases are folded into ONE failure path on
   * purpose: same message shape, same shared attempt counter. Telling the two
   * apart from the outside — "the code would have worked" vs "you're not the
   * courier" — is exactly the leak the fix exists to close, and a separate,
   * uncounted wrong-courier path would let anyone with the code (right or
   * wrong) probe for who the assigned courier is without ever touching the
   * lockout.
   */
  private async verifyHandoffPin(legId: string, pin: string, actor: { userId: string }) {
    const leg = await this.prisma.shipmentLeg.findUnique({
      where: { id: legId },
      select: { id: true, shipmentId: true, status: true, handoffPin: true, handoffPinAttempts: true, assignedDriverProfileId: true },
    });
    if (!leg) throw new NotFoundException('Leg not found.');
    if (leg.status !== 'IN_PROGRESS') {
      throw new BadRequestException('That leg has not started, so there is nothing to hand over.');
    }
    if (leg.handoffPinAttempts >= MAX_PIN_ATTEMPTS) {
      throw new ForbiddenException('Too many incorrect codes. An administrator has to confirm this handoff.');
    }

    const isAssignedCourier =
      leg.assignedDriverProfileId == null ||
      (await this.prisma.driverProfile.findUnique({ where: { userId: actor.userId }, select: { id: true } }))?.id ===
        leg.assignedDriverProfileId;
    const codeMatches = !!leg.handoffPin && pin === leg.handoffPin;

    if (!isAssignedCourier || !codeMatches) {
      await this.prisma.shipmentLeg.update({ where: { id: leg.id }, data: { handoffPinAttempts: { increment: 1 } } });
      await this.audit.record({
        action: 'SHIPMENT_LEG_HANDOFF_PIN_FAILED',
        actorId: actor.userId,
        newValue: { legId: leg.id, shipmentId: leg.shipmentId, wrongCourier: !isAssignedCourier },
      });
      const left = MAX_PIN_ATTEMPTS - leg.handoffPinAttempts - 1;
      throw new BadRequestException(
        left > 0
          ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.`
          : 'That code is not right, and that was the last try.',
      );
    }
  }

  /** Something went wrong on a leg. The shipment stops and a human is told. */
  async flagException(legId: string, input: LegExceptionInput, actor: { userId: string; label?: string }) {
    return this.transition(legId, actor, async (tx, leg, shipment) => {
      await tx.shipmentLeg.update({
        where: { id: leg.id },
        data: { status: 'EXCEPTION', exceptionAt: new Date(), exceptionReason: input.reason },
      });
      await tx.shipment.update({ where: { id: shipment.id }, data: { exceptionAt: new Date(), exceptionReason: input.reason } });
      await this.notifications.notifyAdmins(
        'logistics.read',
        {
          type: 'SECURITY',
          category: 'ADMIN_ALERT',
          event: 'SHIPMENT_EXCEPTION',
          title: `Shipment ${shipment.reference} needs attention`,
          body: input.reason,
          data: { shipmentId: shipment.id, reference: shipment.reference, legId: leg.id },
        },
        tx,
      );
      return { action: 'SHIPMENT_LEG_EXCEPTION' as const, note: input.reason };
    });
  }

  /**
   * The way back out of an exception (delivery-lifecycle gap #4: EXCEPTION was
   * one-way, and the only exit was cancelling the whole shipment).
   *
   * Deliberately NOT routed through `transition()`: that helper's first rule is
   * `isLegActionable`, which refuses EXCEPTION legs — the very state this
   * method exists to leave. Everything else transition() guarantees (one
   * transaction, conditional write, status recomputation, an audit row) is
   * reproduced here by hand.
   *
   * Two resolutions, both restoring states the lifecycle already defines:
   *
   *  RESUME — the problem was dealt with where the parcel stands and the same
   *  actors continue. `startedAt` decides what "back" means: a leg that had
   *  started goes back to IN_PROGRESS, one that had not goes back to READY
   *  (an EXCEPTION leg was actionable when it was flagged, so READY is the
   *  only other state it can have come from). Custody is untouched — nothing
   *  moved, so there is nothing to record.
   *
   *  RELEASE_DRIVER — the assigned driver cannot do the job, so the leg goes
   *  back to the dispatch pool. Only legal while the parcel has NOT moved
   *  (`startedAt`/`pickedUpAt` both null): once a driver is carrying the
   *  parcel, releasing them is not a state edit — where the parcel physically
   *  goes, who pays for the interrupted run and what the customer is owed are
   *  policy decisions nobody has written, and inventing them here is exactly
   *  what the fare-gate rule forbids. Mid-carry, the outs are RESUME or a
   *  staff cancellation.
   */
  async resolveException(legId: string, input: ResolveLegExceptionInput, actor: { userId: string }) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const leg = await tx.shipmentLeg.findUnique({
        where: { id: legId },
        include: { shipment: { select: { id: true, reference: true, customerUserId: true, cancelledAt: true } } },
      });
      if (!leg) throw new NotFoundException('Leg not found.');
      if (leg.status !== 'EXCEPTION') {
        throw new BadRequestException('This leg is not in exception, so there is nothing to resolve.');
      }
      if (leg.shipment.cancelledAt) {
        throw new BadRequestException('That shipment was cancelled; a cancelled journey is not resumed.');
      }

      let restored: LegStatus;
      let releasedDriverProfileId: string | null = null;

      if (input.resolution === 'RESUME') {
        restored = leg.startedAt ? 'IN_PROGRESS' : 'READY';
        // Conditional, not an update by id: two operators can both be looking
        // at the same exception, and exactly one resolution may land.
        const claimed = await tx.shipmentLeg.updateMany({
          where: { id: leg.id, status: 'EXCEPTION' },
          data: { status: restored, exceptionAt: null, exceptionReason: null },
        });
        if (claimed.count === 0) throw new BadRequestException('This exception was already resolved by someone else.');
      } else {
        // RELEASE_DRIVER
        if (leg.kind === 'LINE_HAUL') {
          throw new BadRequestException('A transport leg is operated by a carrier, not a driver — there is no driver to release.');
        }
        if (!leg.assignedDriverProfileId) {
          throw new BadRequestException('No driver holds this leg. Resolve it with "resume" instead.');
        }
        // THE policy line. A parcel in a driver's hands cannot be "released"
        // by clearing columns — custody is append-only and real. What should
        // happen to a parcel stranded mid-carry is an owner decision that does
        // not exist yet; until it does, this fails closed.
        if (leg.startedAt != null || leg.pickedUpAt != null) {
          throw new BadRequestException(
            'This driver has already collected the parcel, so they cannot be released here. Resume the leg, or cancel the shipment through support.',
          );
        }
        restored = 'READY';
        releasedDriverProfileId = leg.assignedDriverProfileId;
        const claimed = await tx.shipmentLeg.updateMany({
          where: { id: leg.id, status: 'EXCEPTION' },
          data: {
            status: 'READY',
            exceptionAt: null,
            exceptionReason: null,
            // Back to the pool, exactly as cancel() clears the courier half —
            // except the destination is dispatchable, not terminal.
            courierStatus: 'PENDING_ASSIGNMENT',
            assignedDriverProfileId: null,
            assignedVehicleId: null,
            offerExpiresAt: null,
            driverQueuePosition: null,
            acceptedAt: null,
            declinedAt: null,
            declineReason: null,
          },
        });
        if (claimed.count === 0) throw new BadRequestException('This exception was already resolved by someone else.');
        // History closes with the assignment; the audit row below says why.
        // (declineReason stays empty — a release is not a decline.)
        await tx.shipmentLegOffer.updateMany({
          where: { shipmentLegId: leg.id, status: { in: ['ACTIVE', 'ACCEPTED'] } },
          data: { status: 'CANCELLED', endedAt: new Date() },
        });
      }

      // The shipment-level flag mirrors the legs: clear it only when no leg is
      // still exceptional. (The lifecycle can only produce one EXCEPTION leg at
      // a time, but this reads the truth rather than assuming it.)
      const stillExceptional = await tx.shipmentLeg.count({
        where: { shipmentId: leg.shipmentId, status: 'EXCEPTION' },
      });
      if (stillExceptional === 0) {
        await tx.shipment.update({
          where: { id: leg.shipmentId },
          data: { exceptionAt: null, exceptionReason: null },
        });
      }

      const status = await this.recompute(tx, leg.shipmentId);
      await this.audit.record(
        {
          action: 'SHIPMENT_LEG_EXCEPTION_RESOLVED',
          actorId: actor.userId,
          reason: input.note,
          newValue: {
            legId: leg.id,
            shipmentId: leg.shipmentId,
            reference: leg.shipment.reference,
            resolution: input.resolution,
            restoredStatus: restored,
            releasedDriverProfileId,
          },
        },
        tx,
      );
      return {
        shipmentId: leg.shipmentId,
        customerUserId: leg.shipment.customerUserId,
        reference: leg.shipment.reference,
        status,
        restored,
        releasedDriverProfileId,
        legKind: leg.kind,
      };
    });

    // Everything after the commit, so nothing below can announce a resolution
    // that rolled back — the same ordering completeLeg uses for its dispatch.
    await this.notifyCustomer(outcome);

    if (outcome.releasedDriverProfileId) {
      const profile = await this.prisma.driverProfile.findUnique({
        where: { id: outcome.releasedDriverProfileId },
        select: { userId: true },
      });
      if (profile) {
        await this.notifications.notifyUsers([profile.userId], {
          type: 'MARKETPLACE',
          category: 'DELIVERY',
          event: 'SHIPMENT_LEG_CANCELLED',
          title: 'Job cancelled',
          body: `Shipment ${outcome.reference}: the job has been removed from your queue.`,
          data: { shipmentId: outcome.shipmentId },
        });
      }
    }

    // A READY courier leg with nobody on it is dispatchable again — offer it
    // now rather than waiting for the sweeper. dispatchLeg re-reads state and
    // re-checks payment, sequence and the simulation boundary itself, and
    // no-ops when automatic dispatch is off (manual assignment then takes over,
    // as everywhere else).
    if (outcome.restored === 'READY' && outcome.legKind !== 'LINE_HAUL') {
      const fresh = await this.prisma.shipmentLeg.findUnique({
        where: { id: legId },
        select: { assignedDriverProfileId: true },
      });
      if (fresh && fresh.assignedDriverProfileId === null) await this.dispatch.dispatchLeg(legId);
    }

    const shipment = await this.prisma.shipment.findUniqueOrThrow({ where: { id: outcome.shipmentId }, include: SHIPMENT_INCLUDE });
    return this.serialize(shipment, { audience: 'STAFF' });
  }

  /**
   * Every leg transition goes through here, so the sequencing rule, the status
   * recomputation and the audit trail cannot be forgotten by a new caller.
   */
  private async transition(
    legId: string,
    actor: { userId: string; label?: string },
    work: (
      tx: Prisma.TransactionClient,
      leg: Prisma.ShipmentLegGetPayload<Record<string, never>>,
      shipment: { id: string; reference: string; service: string; customerUserId: string | null },
    ) => Promise<{ action: 'SHIPMENT_LEG_STARTED' | 'SHIPMENT_LEG_DEPARTED' | 'SHIPMENT_LEG_ARRIVED' | 'SHIPMENT_LEG_HANDOFF' | 'SHIPMENT_LEG_EXCEPTION'; note: string | null }>,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const leg = await tx.shipmentLeg.findUnique({ where: { id: legId } });
      if (!leg) throw new NotFoundException('Leg not found.');
      const shipment = await tx.shipment.findUniqueOrThrow({
        where: { id: leg.shipmentId },
        select: { id: true, reference: true, service: true, customerUserId: true, legs: { select: { sequence: true, kind: true, mode: true, status: true } } },
      });

      if (shipment.legs.some((l) => l.status === 'CANCELLED') && leg.status === 'CANCELLED') {
        throw new BadRequestException('That leg was cancelled.');
      }
      // Sequence is authority. Nothing may jump the queue.
      if (!isLegActionable(shipment.legs as LegView[], leg.sequence)) {
        throw new BadRequestException(
          'The parcel has not reached this leg yet. Each step has to finish before the next one can start.',
        );
      }

      const outcome = await work(tx, leg, shipment);
      const status = await this.recompute(tx, shipment.id);
      await this.audit.record(
        { action: outcome.action, actorId: actor.userId, newValue: { legId, shipmentId: shipment.id, reference: shipment.reference, status }, reason: outcome.note },
        tx,
      );
      return { shipmentId: shipment.id, customerUserId: shipment.customerUserId, reference: shipment.reference, status };
    });

    await this.notifyCustomer(result);

    // The journey finished, so the money can stop being held. Outside the
    // transaction above deliberately: settlement posts its own balanced
    // transaction keyed by a reference unique to the shipment, so a retry is
    // absorbed by the ledger rather than needing this one to succeed or fail
    // as a unit with the leg transition.
    if (this.isDelivered(result.status)) {
      await this.settlement.settleShipment(result.shipmentId, actor.userId);
    }

    const fresh = await this.prisma.shipment.findUniqueOrThrow({ where: { id: result.shipmentId }, include: SHIPMENT_INCLUDE });
    return this.serialize(fresh, { audience: 'STAFF' });
  }

  /** PENDING → READY for the leg whose turn it now is. */
  private async releaseNext(tx: Prisma.TransactionClient, shipmentId: string) {
    const legs = await tx.shipmentLeg.findMany({ where: { shipmentId }, orderBy: { sequence: 'asc' }, select: { id: true, sequence: true, kind: true, mode: true, status: true } });
    const next = legs.find((l) => l.status === 'PENDING' && isLegActionable(legs as LegView[], l.sequence));
    if (next) await tx.shipmentLeg.update({ where: { id: next.id }, data: { status: 'READY' } });
  }

  /**
   * Recompute the shipment's status from its legs and persist it.
   *
   * The one thing the legs cannot tell us is whether a recipient has walked into
   * a terminal and picked their parcel up — no leg moves when that happens. So a
   * recorded collection is layered on top: once `collectedAt` is set, a journey
   * that would otherwise sit at AWAITING_COLLECTION forever reads as DELIVERED.
   */
  private async recompute(tx: Prisma.TransactionClient, shipmentId: string): Promise<ShipmentStatus> {
    const s = await tx.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
      select: { service: true, collectedAt: true, legs: { select: { sequence: true, kind: true, mode: true, status: true } } },
    });
    let status = this.statusFrom(s.legs, !needsLastMile(s.service));
    if (status === 'AWAITING_COLLECTION' && s.collectedAt) status = 'DELIVERED';
    const done = status === 'DELIVERED' ? { deliveredAt: new Date() } : {};
    await tx.shipment.update({ where: { id: shipmentId }, data: { status, ...done } });
    return status;
  }

  private statusFrom(legs: Array<{ sequence: number; kind: string; mode: string; status: string }>, endsAtHub: boolean): ShipmentStatus {
    return deriveShipmentStatus(legs as LegView[], endsAtHub) as ShipmentStatus;
  }

  /**
   * BMPL-300: true once the journey has actually finished — the same
   * predicate `transition()` uses to decide whether to call
   * `settlement.settleShipment()`, reused (not re-derived) by `cancel()` so
   * the two can never disagree. `status` here is always what `recompute()`
   * last wrote from `deriveShipmentStatus()` — the schema's own single
   * source for this fact ("never set independently") — never a second,
   * hand-written list of terminal statuses.
   */
  private isDelivered(status: ShipmentStatus): boolean {
    return status === 'DELIVERED' || status === 'AWAITING_COLLECTION';
  }

  private async appendCustody(
    tx: Prisma.TransactionClient,
    shipmentId: string,
    shipmentLegId: string | null,
    e: {
      fromHolder?: CustodyHolder | null;
      toHolder: CustodyHolder;
      hubId?: string | null;
      actorUserId?: string | null;
      actorLabel?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      verification?: 'PENDING' | 'VERIFIED';
      note?: string | null;
    },
  ) {
    await tx.custodyEvent.create({
      data: {
        shipmentId,
        shipmentLegId,
        fromHolder: e.fromHolder ?? null,
        toHolder: e.toHolder,
        hubId: e.hubId ?? null,
        actorUserId: e.actorUserId ?? null,
        actorLabel: e.actorLabel ?? null,
        latitude: e.latitude ?? null,
        longitude: e.longitude ?? null,
        verification: e.verification ?? 'PENDING',
        note: e.note ?? null,
      },
    });
  }

  private async notifyCustomer(r: { customerUserId: string | null; reference: string; status: ShipmentStatus; shipmentId: string }) {
    if (!r.customerUserId) return;
    await this.notifications.notifyUsers(
      [r.customerUserId],
      {
        type: 'MARKETPLACE',
        category: 'DELIVERY',
        event: 'SHIPMENT_STATUS',
        title: `Shipment ${r.reference}`,
        body: SHIPMENT_STATUS_LABELS[r.status] ?? r.status,
        data: { shipmentId: r.shipmentId, reference: r.reference, status: r.status },
      },
    );
  }

  /**
   * The recipient collected their parcel from the terminal.
   *
   * Without this a hub-ending shipment reaches "Ready to collect" and stays
   * there forever: no leg moves when somebody walks into a counter and picks a
   * box up, so nothing in the leg-derived status could ever close it out.
   */
  async recordCollection(id: string, collectedByName: string, actor: { userId: string }) {
    const shipment = await this.prisma.$transaction(async (tx) => {
      const s = await tx.shipment.findUnique({
        where: { id },
        select: { id: true, reference: true, status: true, collectedAt: true, customerUserId: true, legs: { select: { id: true, sequence: true, destinationHubId: true } } },
      });
      if (!s) throw new NotFoundException('Shipment not found.');
      if (s.collectedAt) throw new BadRequestException('That shipment has already been collected.');
      if (s.status !== 'AWAITING_COLLECTION') {
        throw new BadRequestException('That shipment is not waiting to be collected yet.');
      }

      await tx.shipment.update({ where: { id }, data: { collectedAt: new Date() } });
      const finalLeg = [...s.legs].sort((a, b) => b.sequence - a.sequence)[0];
      await this.appendCustody(tx, s.id, finalLeg?.id ?? null, {
        fromHolder: 'HUB',
        toHolder: 'RECIPIENT',
        hubId: finalLeg?.destinationHubId ?? null,
        actorUserId: actor.userId,
        actorLabel: collectedByName,
        verification: 'VERIFIED',
        note: `Collected by ${collectedByName}.`,
      });
      await this.recompute(tx, s.id);
      return tx.shipment.findUniqueOrThrow({ where: { id }, include: SHIPMENT_INCLUDE });
    });

    await this.audit.record({
      action: 'SHIPMENT_LEG_HANDOFF',
      actorId: actor.userId,
      newValue: { shipmentId: shipment.id, reference: shipment.reference, collectedBy: collectedByName },
    });
    await this.notifyCustomer({
      customerUserId: shipment.customerUserId,
      reference: shipment.reference,
      status: shipment.status,
      shipmentId: shipment.id,
    });
    return this.serialize(shipment, { audience: 'STAFF' });
  }

  /* ---------------------------------------------------------- cancellation */

  /**
   * Cancel what has not happened yet. Completed legs stay completed — a parcel
   * that genuinely flew to San Pedro did fly to San Pedro, and rewriting that to
   * tidy up a cancellation would put a lie in the custody chain. A shipment
   * that has already reached DELIVERED/AWAITING_COLLECTION is refused
   * outright (BMPL-300) — by then every leg finished and it has already been
   * settled, so "cancelling" it would falsify a delivered, paid shipment's
   * own record rather than stop anything.
   *
   * The DRIVER's half of every live courier job closes with the shipment's
   * half. A leg row carries two views of one fact — `status` for the shipment,
   * `courierStatus` for the driver — and cancelling only the first left a
   * phantom job in the driver's queue: still listed (the feed filters on
   * `courierStatus` alone), impossible to decline (only legal from ASSIGNED)
   * and impossible to work (pickup fails the sequencing rule against a
   * CANCELLED leg). So the assignment is cleared, the offer history is closed,
   * and the driver is told — exactly what DispatchService.cancel already does
   * for a marketplace delivery.
   *
   * BMPL-183 (owner rule, given verbatim): acceptance is not pickup, and
   * cancellation before ACTUAL custody transfer does not incur the delivery
   * fee. "Actual custody" is read from the custody trail itself
   * (`appendCustody`'s own rows), not inferred from leg status — a leg status
   * is a second, derived source for the same fact, and this method already
   * had one bug from trusting a status snapshot instead of the ledger of what
   * really happened (see the class comment on `isDelivered`/BMPL-300 for the
   * same lesson applied to a different guard). A courier merely accepting an
   * offer (`courierStatus: DRIVER_ACCEPTED`) writes no custody row and leaves
   * `status` at READY — no fee is withheld. The first row with a real
   * `fromHolder` (`startLeg` SENDER/HUB -> DRIVER, or `departLeg` HUB ->
   * CARRIER for a hub-only leg) is the moment somebody actually took the
   * parcel; from then on the fee already earned stands and is not released.
   * What happens to that parcel next — an exception state, a hub hold, a
   * fresh return-to-sender charge — is deliberately NOT built here: the
   * return leg is a new transport service with its own disclosed fee, and no
   * fee has been given by the owner to build it with.
   */
  async cancel(id: string, input: CancelShipmentInput, actor: { userId: string; isStaff: boolean }) {
    const { shipment, releasedDriverProfileIds, custodyTransferred } = await this.prisma.$transaction(async (tx) => {
      const s = await tx.shipment.findUnique({ where: { id }, include: { legs: true } });
      if (!s) throw new NotFoundException('Shipment not found.');
      if (!actor.isStaff && s.customerUserId !== actor.userId) throw new NotFoundException('Shipment not found.');
      if (s.cancelledAt) throw new BadRequestException('That shipment is already cancelled.');
      // BMPL-300: a shipment that has already delivered has already been
      // settled (see `transition()` below) — drivers and the platform were
      // already paid out of escrow. Refusing here for staff too: nothing
      // about being staff makes it correct to relabel a delivered, paid
      // shipment as cancelled. `s.status` is `isDelivered`'s only input, and
      // it is always what the last `recompute()` wrote — this can never
      // disagree with the fact that decided whether settlement already ran.
      if (this.isDelivered(s.status)) {
        throw new BadRequestException('This shipment has already been delivered and cannot be cancelled.');
      }
      // An exception on a leg that had STARTED is a moving shipment with a
      // problem, not a stationary one: the parcel is in somebody's hands and a
      // self-service cancellation would release the full escrow while it is.
      // Same rule as IN_PROGRESS, because it is the same fact — the flag
      // changed the leg's status, not where the parcel physically is.
      const moving = s.legs.some(
        (l) => l.status === 'IN_PROGRESS' || (l.status === 'EXCEPTION' && l.startedAt != null),
      );
      if (moving && !actor.isStaff) {
        throw new BadRequestException('This shipment is already moving. Contact support to stop it.');
      }

      // BMPL-183: has anyone ACTUALLY taken the parcel — not merely accepted
      // the job. Read from the custody trail itself rather than derived from
      // `moving` above: `moving` only sees a leg that is IN_PROGRESS *right
      // now*, so it misses a shipment sitting at a hub between two legs (the
      // first already COMPLETED, the next not yet started) — custody has
      // already passed to BML in that gap even though nothing is currently
      // "moving". A real transfer is any custody row with a non-null
      // `fromHolder`; the one row every shipment starts with (`null` ->
      // `SENDER`, written at booking) is not a transfer, just the parcel's
      // starting point.
      const custodyTransferred =
        (await tx.custodyEvent.count({ where: { shipmentId: id, fromHolder: { not: null } } })) > 0;

      // Who is being released. Read BEFORE the rows are rewritten — afterwards
      // there is nobody left on the leg to notify. Covers a driver who merely
      // holds the offer (ASSIGNED) as well as one who accepted: both have the
      // job in their feed, so both must see it leave.
      const released = s.legs.filter(
        (l) => l.assignedDriverProfileId != null && l.status !== 'COMPLETED' && l.status !== 'CANCELLED',
      );

      // Close the driver's half of any leg a driver has ever seen: the courier
      // view goes terminal, the assignment and the offer window are cleared.
      // EXCEPTION is in both lists deliberately. It is a live state, not
      // history: a leg stuck in exception still has a driver's half that must
      // close with the shipment's, and leaving it out stranded exactly the
      // phantom job this block exists to prevent — listed in the driver's feed
      // (which filters on courierStatus alone), impossible to work, impossible
      // to decline. Completed legs stay completed, as ever.
      await tx.shipmentLeg.updateMany({
        where: {
          shipmentId: id,
          status: { in: ['PENDING', 'READY', 'IN_PROGRESS', 'EXCEPTION'] },
          OR: [{ assignedDriverProfileId: { not: null } }, { courierStatus: { not: null } }],
        },
        data: {
          courierStatus: 'CANCELLED',
          assignedDriverProfileId: null,
          assignedVehicleId: null,
          offerExpiresAt: null,
          driverQueuePosition: null,
        },
      });

      await tx.shipmentLeg.updateMany({
        where: { shipmentId: id, status: { in: ['PENDING', 'READY', 'IN_PROGRESS', 'EXCEPTION'] } },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });

      // History closes with the leg, as the delivery side already does for its
      // DeliveryAssignment rows. `endedAt` says when; the audit row below says
      // why. (ShipmentLegOffer has no endReason column; declineReason is left
      // alone because a cancellation is not a decline.)
      await tx.shipmentLegOffer.updateMany({
        where: { shipmentLeg: { shipmentId: id }, status: { in: ['ACTIVE', 'ACCEPTED'] } },
        data: { status: 'CANCELLED', endedAt: new Date() },
      });

      // Give the money back — but only when nobody actually took the parcel
      // yet (BMPL-183). Before custody, the release is idempotent and returns
      // the whole amount, exactly as it always has. Once custody has
      // transferred, the fee already earned stands: this is not a second
      // charge and not a settlement, it is simply the absence of a release —
      // no wallet mutation happens on this branch at all, staff or customer.
      // Reversing it later (or charging a new fee for a return trip) is the
      // still-blocked return-leg work, not this one.
      if (!custodyTransferred) {
        await this.payments.releaseForShipment(tx, id, actor.userId);
      }
      const updated = await tx.shipment.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: input.reason },
        include: SHIPMENT_INCLUDE,
      });
      return {
        shipment: updated,
        releasedDriverProfileIds: [...new Set(released.map((l) => l.assignedDriverProfileId!))],
        custodyTransferred,
      };
    });

    await this.audit.record({
      action: 'SHIPMENT_CANCELLED',
      actorId: actor.userId,
      reason: input.reason,
      newValue: {
        shipmentId: shipment.id,
        reference: shipment.reference,
        releasedDriverProfileIds,
        // BMPL-183: whether the delivery fee was released (false) or stands
        // because custody had already transferred (true) — the fact this
        // whole card exists to get right, worth being able to read back.
        custodyTransferred,
      },
    });

    // Tell the released drivers, after the commit — a notification for a
    // cancellation that rolled back would be a lie. The payload deliberately
    // carries no driverJobId and no reference: the job no longer resolves for
    // this driver, and a notification that deep-links to a 404 is worse than
    // one that links nowhere. The reference lives in the words instead.
    if (releasedDriverProfileIds.length > 0) {
      const profiles = await this.prisma.driverProfile.findMany({
        where: { id: { in: releasedDriverProfileIds } },
        select: { userId: true },
      });
      await this.notifications.notifyUsers(
        profiles.map((p) => p.userId),
        {
          type: 'MARKETPLACE',
          category: 'DELIVERY',
          event: 'SHIPMENT_LEG_CANCELLED',
          title: 'Job cancelled',
          body: `Shipment ${shipment.reference} was cancelled. The job has been removed from your queue.`,
          data: { shipmentId: shipment.id },
        },
      );
    }
    return this.serialize(shipment, { audience: actor.isStaff ? 'STAFF' : 'CUSTOMER' });
  }

  /**
   * BMPL-284/285/288 + Edward requirement 11 (unblocked by BMPL-179): replace
   * the CALLER's own role(s)' availability windows in one call — same
   * "replace all, not patch one row" shape as setHubWeeklyHours: a window no
   * longer submitted is gone, never a stale row sitting beside new ones.
   *
   * WHO MAY TOUCH WHOSE WINDOW is the authorization rule, not merely "who
   * may call this at all" — that was the bug (BMPL-288's own deferred
   * decision, recorded on that card): the whole call used to 404 on anyone
   * but the sender before it ever looked at which role's window was being
   * set, so a recipient with a genuine BML account still could not set
   * their own.
   *   - The booking customer (SENDER) may set or clear EITHER role's window
   *     — unchanged. They book for a recipient who may never hold an
   *     account, so they remain the fallback authority for both.
   *   - A genuinely LINKED recipient (`shipment.recipientUserId ===
   *     actor.userId`, set only by the audited `claimAsRecipient` step) may
   *     set or clear ONLY the RECIPIENT role's window. Never derived from
   *     holding the tracking token: a token holder who has not claimed is
   *     not a recipient for this purpose (owner ruling 12) — checking the
   *     LINK rather than the token is the one thing that makes exposing
   *     this to an unauthenticated-by-role caller safe at all.
   *   - Anyone else gets the same neutral 404 the rest of this file uses
   *     for "not yours", never a 403 that would confirm the shipment
   *     exists to a stranger.
   *
   * THE WRITE ITSELF is scoped to the caller's own allowed role(s) —
   * deleting only `{shipmentId, role: IN allowedRoles}`, never the whole
   * shipment's rows — so a recipient setting their own window can never
   * wipe the sender's, and vice versa. For the sender this changes nothing
   * observable (their allowed roles are still both, so the delete still
   * spans the same two rows it always did); for a recipient it is the only
   * thing that makes a second, independent caller safe to add to a
   * replace-all endpoint at all.
   *
   * GATING, per BMPL-284's own authorization finding, UNCHANGED and applied
   * identically regardless of who is calling — a recipient gets the same
   * rule as the sender, not a softer one: a role's window may only be set
   * or changed while the leg that role governs has not started (SENDER ->
   * FIRST_MILE or, on a door-to-door DIRECT leg, that leg; RECIPIENT ->
   * LAST_MILE or that same DIRECT leg). CLEARING is exempt from this:
   * dropping a role from the submitted set only widens back toward "no
   * constraint", which is always safe, so a role whose leg has already
   * started may still be cleared (by simply not including it), just never
   * newly set.
   *
   * DELIVERY LOCATION IS DELIBERATELY NOT HERE. Ruling 11 permits a
   * recipient-updated availability window explicitly; it permits a changed
   * delivery location only "where policy permits", and no policy has been
   * given for changing a destination address after booking — a different
   * address can mean a different district, a different fee and a different
   * courier. That is custody and pricing territory this card does not
   * decide.
   */
  async setAvailabilityWindows(id: string, input: SetAvailabilityWindowsInput, actor: { userId: string }) {
    const shipment = await this.prisma.shipment.findUnique({ where: { id }, include: { legs: true } });
    if (!shipment) throw new NotFoundException('Shipment not found.');

    const isSender = shipment.customerUserId === actor.userId;
    const isRecipient = !isSender && shipment.recipientUserId === actor.userId;
    if (!isSender && !isRecipient) throw new NotFoundException('Shipment not found.');

    const allowedRoles: AvailabilityWindowRole[] = isSender ? ['SENDER', 'RECIPIENT'] : ['RECIPIENT'];
    const submittedRoles = new Set(input.windows.map((w) => w.role));
    for (const role of submittedRoles) {
      if (!allowedRoles.includes(role)) {
        throw new BadRequestException(
          role === 'SENDER'
            ? "Only the sender's own account can set the pickup window."
            : 'You can only set the delivery window for your own account.',
        );
      }
    }

    const NOT_STARTED: LegStatus[] = ['PENDING', 'READY'];
    const direct = shipment.legs.find((l) => l.kind === 'DIRECT');
    const firstMile = shipment.legs.find((l) => l.kind === 'FIRST_MILE');
    const lastMile = shipment.legs.find((l) => l.kind === 'LAST_MILE');

    if (submittedRoles.has('SENDER')) {
      const leg = direct ?? firstMile;
      if (!leg) throw new BadRequestException('This shipment has no pickup leg for a sender window to apply to.');
      if (!NOT_STARTED.includes(leg.status)) {
        throw new BadRequestException('The pickup has already started; its window can no longer be changed.');
      }
    }
    if (submittedRoles.has('RECIPIENT')) {
      const leg = direct ?? lastMile;
      if (!leg) throw new BadRequestException('This shipment has no delivery leg for a recipient window to apply to.');
      if (!NOT_STARTED.includes(leg.status)) {
        throw new BadRequestException('The delivery has already started; its window can no longer be changed.');
      }
    }

    await this.prisma.$transaction([
      this.prisma.shipmentAvailabilityWindow.deleteMany({ where: { shipmentId: id, role: { in: allowedRoles } } }),
      this.prisma.shipmentAvailabilityWindow.createMany({
        data: input.windows.map((w) => ({ shipmentId: id, role: w.role, startTime: w.startTime, endTime: w.endTime })),
      }),
    ]);
    await this.audit.record({
      action: 'SHIPMENT_AVAILABILITY_WINDOWS_SET',
      actorId: actor.userId,
      newValue: {
        shipmentId: id,
        reference: shipment.reference,
        actorRole: isSender ? 'SENDER' : 'RECIPIENT',
        windows: input.windows,
      },
    });

    if (isSender) {
      const fresh = await this.prisma.shipment.findUniqueOrThrow({ where: { id }, include: SHIPMENT_INCLUDE });
      return this.serialize(fresh, { audience: 'CUSTOMER' });
    }

    // The recipient's own ack: exactly what is now stored for THEIR role,
    // never the sender's row or any other shipment field. A write
    // confirmation, not a widened read — deliberately NOT routed through
    // `recipientView()`, whose allowlist is pinned identical whether reached
    // by token or by account (recipient-tracking.integration.spec.ts); an
    // authenticated-only field like this one would break that parity rather
    // than extend it.
    const myWindows = await this.prisma.shipmentAvailabilityWindow.findMany({
      where: { shipmentId: id, role: 'RECIPIENT' },
      orderBy: { startTime: 'asc' },
      select: { startTime: true, endTime: true },
    });
    return { reference: shipment.reference, windows: myWindows };
  }

  /**
   * The thin recipient-facing entry point: resolves the shipment's public
   * `reference` to its internal id (the recipient does not otherwise know
   * or need it) and defers the REAL authorization check — is this account
   * genuinely linked as recipient? — to `setAvailabilityWindows` itself, so
   * there is exactly one place that decision is made.
   */
  async setRecipientAvailabilityWindows(reference: string, input: SetAvailabilityWindowsInput, actor: { userId: string }) {
    const s = await this.prisma.shipment.findUnique({ where: { reference }, select: { id: true } });
    if (!s) throw new NotFoundException('No shipment with that reference.');
    return this.setAvailabilityWindows(s.id, input, actor);
  }

  /**
   * A linked recipient's own currently-stored delivery window — read-only,
   * scoped to their own RECIPIENT-role rows, never the sender's. Same
   * genuinely-linked gate as the write path: `recipientUserId`, never the
   * token.
   */
  async recipientAvailabilityWindow(reference: string, userId: string) {
    const s = await this.prisma.shipment.findUnique({ where: { reference }, select: { id: true, recipientUserId: true } });
    if (!s || s.recipientUserId !== userId) throw new NotFoundException('No shipment with that reference.');
    const windows = await this.prisma.shipmentAvailabilityWindow.findMany({
      where: { shipmentId: s.id, role: 'RECIPIENT' },
      orderBy: { startTime: 'asc' },
      select: { startTime: true, endTime: true },
    });
    return { reference, windows };
  }

  /* ------------------------------------------------------------- reading */

  /**
   * One journey, told once.
   *
   * The handoff PIN is the only field that differs by audience, and it never
   * appears for a customer except on the leg that ends at their own door — that
   * is the code THEY hold, and the driver has to produce it.
   */
  private async serialize(s: ShipmentWithGraph, opts: { audience: 'CUSTOMER' | 'STAFF'; conversationIds?: Map<string, string> }) {
    const endsAtHub = !needsLastMile(s.service);
    const live = s.legs.filter((l) => l.status !== 'CANCELLED');
    const current = live.find((l) => l.status !== 'COMPLETED') ?? null;
    // Callers serving a LIST (listMine) resolve this once across every shipment
    // on the page and pass it in; a single-shipment caller has none to pass, so
    // it is resolved here, bounded to this one shipment's own legs.
    const conversationIds = opts.conversationIds ?? (await this.legConversationIds(s.legs.map((l) => l.id)));
    // The sender and staff both already see the whole story here (ownership /
    // permission was checked before `serialize` was ever called) — the pickup
    // photo needs no extra gate on top, same as every other leg field below.
    const legs = await Promise.all(
      s.legs.map(async (l) => ({
        id: l.id,
        sequence: l.sequence,
        kind: l.kind,
        mode: l.mode,
        modeLabel: TRANSPORT_MODE_LABELS[l.mode],
        status: l.status,
        description: l.description,
        priceMinor: money(l.priceMinor),
        durationMinutes: l.durationMinutes,
        isCurrent: current?.id === l.id,
        originHub: l.originHub,
        destinationHub: l.destinationHub,
        carrier: l.carrierName ?? l.route?.carrierName ?? null,
        carrierBookingRef: opts.audience === 'STAFF' ? l.carrierBookingRef : null,
        // Ops must be able to see whether a courier leg already has a driver
        // before acting on it; the courier pipeline is staff-facing detail.
        courierStatus: opts.audience === 'STAFF' ? l.courierStatus : null,
        assignedDriverProfileId: opts.audience === 'STAFF' ? l.assignedDriverProfileId : null,
        // Who is actually showing up, once someone is (BMPL-180). Same shape and
        // same privacy line as the marketplace delivery card in
        // delivery-core.service.ts: face + first name + rating, never legal
        // name, phone, or documents. Null before a courier is assigned.
        courier: this.courierSummary(l.assignedDriver),
        courierVehicle: await this.courierVehicleSummary(l.assignedVehicle),
        // BMPL-290: the customer<->courier thread for THIS leg, or null before
        // one exists (the driver hasn't accepted yet). Resolved on the same
        // compound key ensureShipmentLegThread writes on — SHIPMENT_LEG plus
        // this leg's own id plus the CUSTOMER_DRIVER pairing — never matched on
        // context alone, which would silently pick the wrong thread the day a
        // second pairing exists on a leg. Never a fabricated id: a leg with no
        // thread yet returns null, not a placeholder a link could follow.
        conversationId: conversationIds.get(l.id) ?? null,
        scheduleNote: l.route?.scheduleNote ?? null,
        scheduledDepartureAt: l.scheduledDepartureAt,
        departedAt: l.departedAt,
        arrivedAt: l.arrivedAt,
        startedAt: l.startedAt,
        completedAt: l.completedAt,
        handoffReceivedByName: l.handoffReceivedByName,
        exceptionReason: l.exceptionReason,
        // The customer's own door code, and nothing else.
        handoffPin: this.pinFor(l, opts.audience, endsAtHub),
        // Per-leg, never pooled: a pickup photo belongs to the leg it was taken
        // on and must not appear on any sibling leg of the same shipment.
        pickupPhotoUrls: await this.photoUrls(l.handoffPhotoKeys),
      })),
    );

    return {
      id: s.id,
      reference: s.reference,
      service: s.service,
      serviceLabel: SHIPPING_SERVICE_LABELS[s.service],
      status: s.status,
      statusLabel: SHIPMENT_STATUS_LABELS[s.status] ?? s.status,
      isTest: s.isTest,
      endsAtHub,
      quotedTotalMinor: money(s.quotedTotalMinor),
      quotedMinutes: s.quotedMinutes,
      explanation: s.planExplanation,
      // The recipient's share link, as a token: the sender forwards it (or the
      // web app renders it as a copyable URL). Support can re-read it for a
      // customer, so both audiences carry it. Null on shipments booked before
      // the token existed.
      recipientTrackingToken: s.recipientToken,
      description: s.description,
      pieces: s.pieces,
      weightGrams: s.weightGrams,
      bookedAt: s.bookedAt,
      deliveredAt: s.deliveredAt,
      cancelledAt: s.cancelledAt,
      cancellationReason: s.cancellationReason,
      exceptionReason: s.exceptionReason,
      origin: {
        name: s.originName,
        phone: s.originPhone,
        address: s.originAddress,
        city: s.originCity,
        district: s.originDistrict,
        latitude: s.originLatitude,
        longitude: s.originLongitude,
        instructions: s.originInstructions,
      },
      destination: {
        name: s.destinationName,
        phone: s.destinationPhone,
        address: s.destinationAddress,
        city: s.destinationCity,
        district: s.destinationDistrict,
        latitude: s.destinationLatitude,
        longitude: s.destinationLongitude,
        instructions: s.destinationInstructions,
      },
      currentLegSequence: current?.sequence ?? null,
      legs,
      custody: s.custodyEvents.map((c) => ({
        id: c.id,
        fromHolder: c.fromHolder,
        toHolder: c.toHolder,
        hubId: c.hubId,
        actorLabel: c.actorLabel,
        note: c.note,
        verification: c.verification,
        occurredAt: c.occurredAt,
      })),
      // BMPL-285: empty means unconstrained — attempt pickup/delivery at any
      // time, exactly as every shipment behaves today. Not a default this
      // serializer invents: the absence of a row already means that with no
      // code change here at all, the same way an absent field always has.
      availabilityWindows: s.availabilityWindows.map((w) => ({
        id: w.id,
        role: w.role,
        startTime: w.startTime,
        endTime: w.endTime,
      })),
    };
  }

  /**
   * BMPL-290: legId -> conversation id, for every SHIPMENT_LEG/CUSTOMER_DRIVER
   * thread among the given legs. One query for however many legs are passed in
   * — callers serving a list batch across every shipment's legs up front rather
   * than calling this per shipment. A leg with no accepted driver yet simply
   * has no row and is absent from the map; the caller reads that as null.
   */
  private async legConversationIds(legIds: string[]): Promise<Map<string, string>> {
    if (legIds.length === 0) return new Map();
    const rows = await this.prisma.conversation.findMany({
      where: { contextType: 'SHIPMENT_LEG', contextId: { in: legIds }, pairing: 'CUSTOMER_DRIVER' },
      select: { id: true, contextId: true },
    });
    return new Map(rows.map((r) => [r.contextId, r.id]));
  }

  /**
   * Who is showing up (BMPL-180). Display name + rating only — never legal
   * name, phone, or licence/document fields, mirroring driverSummary() in
   * delivery-core.service.ts. The face is the same APPROVED + moderated user
   * avatar the marketplace delivery card already uses, not
   * DriverProfile.profilePhotoKey (an unmoderated verification document).
   * Null whenever no driver is assigned yet.
   */
  private courierSummary(d: ShipmentWithGraph['legs'][number]['assignedDriver']) {
    if (!d) return null;
    return {
      displayName: d.displayName,
      ratingAverage: d.ratingAverage,
      completedDeliveries: d.completedDeliveries,
      initials: userInitials(d.user.firstName, d.user.lastName),
      avatarUrl: publicAvatarUrl(d.user),
    };
  }

  /**
   * What they are driving. Type/make/model/colour/plate are shown whenever a
   * vehicle is assigned; the photo is shown only once the vehicle itself has
   * cleared admin review (`approvalStatus === 'APPROVED'`) — the same
   * "verified before it's shown" line the avatar uses, applied to the one
   * DriverVehicle field with no existing moderation gate of its own.
   */
  private async courierVehicleSummary(v: ShipmentWithGraph['legs'][number]['assignedVehicle']) {
    if (!v) return null;
    const key = v.approvalStatus === 'APPROVED' ? v.photoKeys[0] : undefined;
    const photoUrl = key
      ? await this.storage
          .presignDownload(key, 'private')
          .then((r) => r.url)
          .catch(() => null)
      : null;
    return { type: v.type, make: v.make, model: v.model, color: v.color, licencePlate: v.licencePlate, photoUrl };
  }

  private pinFor(l: { kind: string; status: string; handoffPin: string | null }, audience: 'CUSTOMER' | 'STAFF', endsAtHub: boolean): string | null {
    if (audience === 'STAFF') return null; // staff reveal it deliberately, not by listing
    // A DIRECT leg is last-mile-equivalent: it ends at the RECIPIENT's door, not
    // a counter, so the recipient is the party who must hold the code. Before
    // this, a local door-to-door parcel had a PIN nobody could obtain and the
    // handoff could never legitimately complete.
    if (endsAtHub || (l.kind !== 'LAST_MILE' && l.kind !== 'DIRECT')) return null;
    if (l.status === 'COMPLETED' || l.status === 'CANCELLED') return null;
    return l.handoffPin;
  }

  /** Short-lived signed URLs for stored pickup-photo keys. A dangling/deleted
   *  key is dropped rather than surfaced as an error — same as delivery POD. */
  private async photoUrls(keys: string[]): Promise<string[]> {
    const urls = await Promise.all(
      keys.map(async (k) => {
        try {
          return (await this.storage.presignDownload(k, 'private')).url;
        } catch {
          return null;
        }
      }),
    );
    return urls.filter((u): u is string => !!u);
  }

  /**
   * The deliberate STAFF reveal the serializer's null promises. FIRST_MILE and
   * line-haul handoffs end at a counter, and the code the deliverer must produce
   * is held by the RECEIVING side — terminal staff — who until now had no way to
   * obtain it (finding 2 of the delivery audit: those handoffs could not
   * legitimately complete). Mirrors the delivery console's PIN reveal, with one
   * deliberate difference: EVERY reveal writes an audit row, because this module
   * already audits failed PIN attempts and an unaudited reveal would be below
   * its own standard. The audit records THAT the code was revealed and by whom —
   * never the code itself.
   */
  async revealHandoffPin(legId: string, actor: { userId: string }) {
    const leg = await this.prisma.shipmentLeg.findUnique({
      where: { id: legId },
      select: {
        id: true,
        shipmentId: true,
        kind: true,
        status: true,
        handoffPin: true,
        handoffPinAttempts: true,
        handoffVerificationStatus: true,
        assignedDriver: { select: { userId: true } },
        shipment: { select: { reference: true } },
      },
    });
    if (!leg) throw new NotFoundException('Leg not found.');
    // Only a code held at a DESK is staff's to reveal. A LAST_MILE or DIRECT
    // leg ends at the recipient's door, and that code belongs to the recipient
    // — the serializer already shows it to them, and staff have no business
    // reading it out.
    if (leg.kind !== 'FIRST_MILE' && leg.kind !== 'LINE_HAUL') {
      throw new BadRequestException('This code is held by the recipient, not at a terminal, and cannot be revealed to staff.');
    }
    // A completed or cancelled leg's code is dead — the same rule pinFor
    // applies to the customer's own view.
    if (leg.status === 'COMPLETED' || leg.status === 'CANCELLED') {
      throw new BadRequestException('This leg is finished; its handoff code is no longer valid.');
    }
    // The self-delivery invariant, in reveal form: the driver who must PRODUCE
    // the code never obtains it from us, whatever permissions their other hats
    // hold. Matched on the USER id, never the active role, exactly as every
    // other conflict-of-interest check in this codebase.
    if (leg.assignedDriver && leg.assignedDriver.userId === actor.userId) {
      throw new ForbiddenException('You are the assigned driver for this leg; the receiving side holds the code.');
    }
    await this.audit.record({
      action: 'SHIPMENT_HANDOFF_PIN_REVEALED',
      actorId: actor.userId,
      newValue: { legId: leg.id, shipmentId: leg.shipmentId, reference: leg.shipment.reference, kind: leg.kind, legStatus: leg.status },
    });
    return {
      handoffPin: leg.handoffPin,
      handoffPinAttempts: leg.handoffPinAttempts,
      handoffVerificationStatus: leg.handoffVerificationStatus,
    };
  }
}
