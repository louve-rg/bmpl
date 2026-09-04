import { randomInt } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  deriveShipmentStatus,
  isLegActionable,
  needsFirstMile,
  needsLastMile,
  findCourierLane,
  isLocalDoorToDoor,
  planRoute,
  SHIPMENT_STATUS_LABELS,
  SHIPPING_SERVICE_DESCRIPTIONS,
  SHIPPING_SERVICE_LABELS,
  TRANSPORT_MODE_LABELS,
  type Endpoint,
  type PlannerLane,
  type LegView,
  type PlannedLeg,
  type PlannerHub,
} from '@bmpl/shared';
import type {
  CancelShipmentInput,
  ShipmentListInput,
  CreateShipmentInput,
  LegDepartInput,
  LegExceptionInput,
  LegHandoffInput,
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

/** Minor units go out as numbers; see the note in logistics-network.service.ts. */
const money = (v: bigint) => Number(v);

/** How many failed handoff codes before the leg stops accepting them. */
const MAX_PIN_ATTEMPTS = 5;
const PIN_LENGTH = 4;

const SHIPMENT_INCLUDE = {
  legs: {
    orderBy: { sequence: 'asc' },
    include: {
      originHub: { select: { id: true, code: true, name: true, city: true, instructions: true, latitude: true, longitude: true } },
      destinationHub: { select: { id: true, code: true, name: true, city: true, instructions: true, latitude: true, longitude: true } },
      route: { select: { id: true, carrierName: true, carrierPhone: true, scheduleNote: true } },
    },
  },
  custodyEvents: { orderBy: { occurredAt: 'asc' } },
} satisfies Prisma.ShipmentInclude;

type ShipmentWithGraph = Prisma.ShipmentGetPayload<{ include: typeof SHIPMENT_INCLUDE }>;

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
    const plan = planRoute(
      { origin, destination, service: input.service, preferredMode: input.preferredMode ?? null },
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

    if (!plan.ok) {
      return {
        available: false,
        reason: plan.reason,
        // The planner's own words. LOCAL_DELIVERY is not a failure the customer
        // caused — it means the ordinary courier flow already covers this.
        message: plan.explanation,
        useLocalDelivery: plan.reason === 'LOCAL_DELIVERY',
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
      { origin, destination, service: input.service, preferredMode: input.preferredMode ?? null },
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

    const shipment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.shipment.create({
        data: {
          reference: await this.uniqueReference(tx),
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
          legs: { create: plan.legs.map((l) => this.legData(l, payNow)) },
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
  private legData(l: PlannedLeg, paid: boolean) {
    return {
      sequence: l.sequence,
      kind: l.kind,
      mode: l.mode,
      status: (l.sequence === 1 && paid ? 'READY' : 'PENDING') as LegStatus,
      originHubId: l.originHubId,
      destinationHubId: l.destinationHubId,
      routeId: l.routeId,
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

  async listMine(userId: string) {
    const rows = await this.prisma.shipment.findMany({
      where: { customerUserId: userId },
      orderBy: { createdAt: 'desc' },
      include: SHIPMENT_INCLUDE,
      take: 50,
    });
    return rows.map((s) => this.serialize(s, { audience: 'CUSTOMER' }));
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

  /** Terminals expecting a parcel, for the hub handoff desk. */
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
        assignedDriver: { select: { displayName: true, phone: true } },
      },
    });
    return legs.map((l) => ({
      legId: l.id,
      reference: l.shipment.reference,
      kind: l.kind,
      // Who is bringing it: a BML driver on a first mile, a carrier on a flight.
      broughtBy: l.assignedDriver?.displayName ?? l.carrierName ?? 'Carrier',
      contactPhone: l.assignedDriver?.phone ?? null,
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

  /** Start a leg: the parcel is now moving on it. */
  async startLeg(legId: string, actor: { userId: string; label?: string }) {
    return this.transition(legId, actor, async (tx, leg, shipment) => {
      if (leg.status !== 'READY') {
        throw new BadRequestException(`This leg is ${leg.status.toLowerCase()}, so it cannot be started.`);
      }
      await tx.shipmentLeg.update({ where: { id: leg.id }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });
      await this.appendCustody(tx, shipment.id, leg.id, {
        fromHolder: leg.sequence === 1 ? 'SENDER' : 'HUB',
        toHolder: leg.kind === 'LINE_HAUL' ? 'CARRIER' : 'DRIVER',
        hubId: leg.originHubId,
        actorUserId: actor.userId,
        actorLabel: actor.label,
        note: 'Collected.',
      });
      return { action: 'SHIPMENT_LEG_STARTED' as const, note: null };
    });
  }

  /** A line-haul left the terminal. Carrier details are recorded as given. */
  async departLeg(legId: string, input: LegDepartInput, actor: { userId: string; label?: string }) {
    return this.transition(legId, actor, async (tx, leg, shipment) => {
      if (leg.kind !== 'LINE_HAUL') throw new BadRequestException('Only a transport leg departs from a terminal.');
      if (leg.status !== 'READY' && leg.status !== 'IN_PROGRESS') {
        throw new BadRequestException(`This leg is ${leg.status.toLowerCase()}, so it cannot depart.`);
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
   */
  private async verifyHandoffPin(legId: string, pin: string, actor: { userId: string }) {
    const leg = await this.prisma.shipmentLeg.findUnique({
      where: { id: legId },
      select: { id: true, shipmentId: true, status: true, handoffPin: true, handoffPinAttempts: true },
    });
    if (!leg) throw new NotFoundException('Leg not found.');
    if (leg.status !== 'IN_PROGRESS') {
      throw new BadRequestException('That leg has not started, so there is nothing to hand over.');
    }
    if (leg.handoffPinAttempts >= MAX_PIN_ATTEMPTS) {
      throw new ForbiddenException('Too many incorrect codes. An administrator has to confirm this handoff.');
    }
    if (!leg.handoffPin || pin !== leg.handoffPin) {
      await this.prisma.shipmentLeg.update({ where: { id: leg.id }, data: { handoffPinAttempts: { increment: 1 } } });
      await this.audit.record({
        action: 'SHIPMENT_LEG_HANDOFF_PIN_FAILED',
        actorId: actor.userId,
        newValue: { legId: leg.id, shipmentId: leg.shipmentId },
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
    if (result.status === 'DELIVERED' || result.status === 'AWAITING_COLLECTION') {
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
   * tidy up a cancellation would put a lie in the custody chain.
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
   */
  async cancel(id: string, input: CancelShipmentInput, actor: { userId: string; isStaff: boolean }) {
    const { shipment, releasedDriverProfileIds } = await this.prisma.$transaction(async (tx) => {
      const s = await tx.shipment.findUnique({ where: { id }, include: { legs: true } });
      if (!s) throw new NotFoundException('Shipment not found.');
      if (!actor.isStaff && s.customerUserId !== actor.userId) throw new NotFoundException('Shipment not found.');
      if (s.cancelledAt) throw new BadRequestException('That shipment is already cancelled.');
      if (s.legs.some((l) => l.status === 'IN_PROGRESS') && !actor.isStaff) {
        throw new BadRequestException('This shipment is already moving. Contact support to stop it.');
      }

      // Who is being released. Read BEFORE the rows are rewritten — afterwards
      // there is nobody left on the leg to notify. Covers a driver who merely
      // holds the offer (ASSIGNED) as well as one who accepted: both have the
      // job in their feed, so both must see it leave.
      const released = s.legs.filter(
        (l) => l.assignedDriverProfileId != null && l.status !== 'COMPLETED' && l.status !== 'CANCELLED',
      );

      // Close the driver's half of any leg a driver has ever seen: the courier
      // view goes terminal, the assignment and the offer window are cleared.
      await tx.shipmentLeg.updateMany({
        where: {
          shipmentId: id,
          status: { in: ['PENDING', 'READY', 'IN_PROGRESS'] },
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
        where: { shipmentId: id, status: { in: ['PENDING', 'READY', 'IN_PROGRESS'] } },
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

      // Give the money back. Nobody has started work — the guard above refuses a
      // customer cancellation once a leg is IN_PROGRESS — so the whole amount is
      // returned. The release is idempotent: it only picks up holds that are
      // still live, and its ledger reference is unique per payment.
      await this.payments.releaseForShipment(tx, id, actor.userId);
      const updated = await tx.shipment.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: input.reason },
        include: SHIPMENT_INCLUDE,
      });
      return {
        shipment: updated,
        releasedDriverProfileIds: [...new Set(released.map((l) => l.assignedDriverProfileId!))],
      };
    });

    await this.audit.record({
      action: 'SHIPMENT_CANCELLED',
      actorId: actor.userId,
      reason: input.reason,
      newValue: { shipmentId: shipment.id, reference: shipment.reference, releasedDriverProfileIds },
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

  /* ------------------------------------------------------------- reading */

  /**
   * One journey, told once.
   *
   * The handoff PIN is the only field that differs by audience, and it never
   * appears for a customer except on the leg that ends at their own door — that
   * is the code THEY hold, and the driver has to produce it.
   */
  private serialize(s: ShipmentWithGraph, opts: { audience: 'CUSTOMER' | 'STAFF' }) {
    const endsAtHub = !needsLastMile(s.service);
    const live = s.legs.filter((l) => l.status !== 'CANCELLED');
    const current = live.find((l) => l.status !== 'COMPLETED') ?? null;

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
      legs: s.legs.map((l) => ({
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
      })),
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
    };
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
