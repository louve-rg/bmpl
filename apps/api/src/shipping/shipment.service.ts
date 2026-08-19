import { randomInt } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  deriveShipmentStatus,
  isLegActionable,
  needsFirstMile,
  needsLastMile,
  planRoute,
  SHIPMENT_STATUS_LABELS,
  SHIPPING_SERVICE_DESCRIPTIONS,
  SHIPPING_SERVICE_LABELS,
  TRANSPORT_MODE_LABELS,
  type Endpoint,
  type LegView,
  type PlannedLeg,
  type PlannerHub,
} from '@bmpl/shared';
import type {
  CancelShipmentInput,
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
  ) {}

  /* -------------------------------------------------------------- quoting */

  /**
   * One journey, one price.
   *
   * The transport comes from the configured route rows and the door legs from the
   * hub's configured courier fee. Nothing here invents money: if a hub's courier
   * fee has not been set, the quote says so rather than quietly shipping for free.
   */
  async quote(input: ShipmentQuoteInput) {
    const { hubs, routes } = await this.network.plannerInputs();
    const hubById = new Map(hubs.map((h) => [h.id, h]));

    const origin = this.toEndpoint(input, 'origin');
    const destination = this.toEndpoint(input, 'destination');

    // Price the door legs BEFORE planning, because the planner sums what it is
    // given rather than working out what a courier costs.
    const fees = await this.courierFees(input, origin, destination, hubs);
    const plan = planRoute(
      { origin, destination, service: input.service, preferredMode: input.preferredMode ?? null },
      hubs,
      routes,
      { firstMileMinor: fees.firstMileMinor, lastMileMinor: fees.lastMileMinor, firstMileMinutes: 0, lastMileMinutes: 0 },
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
   * A door leg is a BMPL courier run between a terminal and an address in its
   * town, and what BMPL charges for that is the owner's decision, configured per
   * hub. This code reads the number; it does not decide it.
   */
  private async courierFees(
    input: ShipmentQuoteInput,
    origin: Endpoint,
    destination: Endpoint,
    hubs: readonly PlannerHub[],
  ) {
    const wantsFirst = needsFirstMile(input.service);
    const wantsLast = needsLastMile(input.service);
    if (!wantsFirst && !wantsLast) return { firstMileMinor: 0, lastMileMinor: 0, unpricedHubs: [] as string[] };

    // Ask the planner where each door attaches by planning with zero fees first;
    // that keeps hub-attachment logic in exactly one place.
    const { routes } = await this.network.plannerInputs();
    const dry = planRoute({ origin, destination, service: input.service, preferredMode: input.preferredMode ?? null }, hubs, routes);
    if (!dry.ok) return { firstMileMinor: 0, lastMileMinor: 0, unpricedHubs: [] as string[] };

    const firstHubId = dry.legs.find((l) => l.kind === 'FIRST_MILE')?.destinationHubId ?? null;
    const lastHubId = dry.legs.find((l) => l.kind === 'LAST_MILE')?.originHubId ?? null;
    const ids = [firstHubId, lastHubId].filter((v): v is string => v != null);
    const rows = ids.length
      ? await this.prisma.logisticsHub.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, courierFeeMinor: true } })
      : [];
    const feeOf = (id: string | null) => (id ? Number(rows.find((r) => r.id === id)?.courierFeeMinor ?? 0n) : 0);

    const unpricedHubs = rows.filter((r) => r.courierFeeMinor === 0n).map((r) => r.name);
    return { firstMileMinor: feeOf(firstHubId), lastMileMinor: feeOf(lastHubId), unpricedHubs };
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
  async create(userId: string, input: CreateShipmentInput, isTest = false) {
    const quote = await this.quote(input);
    if (!quote.available) {
      throw new BadRequestException(quote.message ?? 'We cannot ship that route at the moment.');
    }

    const { hubs, routes } = await this.network.plannerInputs();
    const origin = this.toEndpoint(input, 'origin');
    const destination = this.toEndpoint(input, 'destination');
    const fees = await this.courierFees(input, origin, destination, hubs);
    const plan = planRoute({ origin, destination, service: input.service, preferredMode: input.preferredMode ?? null }, hubs, routes, {
      firstMileMinor: fees.firstMileMinor,
      lastMileMinor: fees.lastMileMinor,
      firstMileMinutes: 0,
      lastMileMinutes: 0,
    });
    if (!plan.ok) throw new BadRequestException(plan.explanation);

    const endsAtHub = !needsLastMile(input.service);
    const originHubId = plan.legs.find((l) => l.kind === 'LINE_HAUL')?.originHubId ?? null;
    const destinationHubId = [...plan.legs].reverse().find((l) => l.kind === 'LINE_HAUL')?.destinationHubId ?? null;

    const shipment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.shipment.create({
        data: {
          reference: await this.uniqueReference(tx),
          service: input.service,
          isTest,
          customerUserId: userId,
          originHubId,
          destinationHubId,
          originName: input.origin.name ?? null,
          originPhone: input.origin.phone ?? null,
          originAddress: input.origin.address ?? null,
          originCity: input.origin.city ?? null,
          originDistrict: input.origin.district ?? null,
          originLatitude: input.origin.latitude ?? null,
          originLongitude: input.origin.longitude ?? null,
          originInstructions: input.origin.instructions ?? null,
          destinationName: input.destination.name ?? null,
          destinationPhone: input.destination.phone ?? null,
          destinationAddress: input.destination.address ?? null,
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
          legs: { create: plan.legs.map((l) => this.legData(l)) },
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

      const status = this.statusFrom(created.legs, endsAtHub);
      return tx.shipment.update({ where: { id: created.id }, data: { status }, include: SHIPMENT_INCLUDE });
    });

    await this.audit.record({
      action: 'SHIPMENT_CREATED',
      actorId: userId,
      newValue: { shipmentId: shipment.id, reference: shipment.reference, service: shipment.service, legs: shipment.legs.length, isTest },
    });
    return this.serialize(shipment, { audience: 'CUSTOMER' });
  }

  /** The first leg is immediately workable; the rest wait their turn. */
  private legData(l: PlannedLeg) {
    return {
      sequence: l.sequence,
      kind: l.kind,
      mode: l.mode,
      status: (l.sequence === 1 ? 'READY' : 'PENDING') as LegStatus,
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
      const reference = `BMPL-${body}`;
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
    // The code is checked BEFORE the transition transaction, in its own write.
    // A failed attempt recorded inside the transaction is rolled back when that
    // transaction throws, so the counter would never climb and the lockout below
    // would be unreachable — the code could be guessed forever.
    await this.verifyHandoffPin(legId, input.pin, actor);

    return this.transition(legId, actor, async (tx, leg, shipment) => {
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
      return { action: 'SHIPMENT_LEG_HANDOFF' as const, note: input.note ?? null };
    });
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
    const fresh = await this.prisma.shipment.findUniqueOrThrow({ where: { id: result.shipmentId }, include: SHIPMENT_INCLUDE });
    return this.serialize(fresh, { audience: 'STAFF' });
  }

  /** PENDING → READY for the leg whose turn it now is. */
  private async releaseNext(tx: Prisma.TransactionClient, shipmentId: string) {
    const legs = await tx.shipmentLeg.findMany({ where: { shipmentId }, orderBy: { sequence: 'asc' }, select: { id: true, sequence: true, kind: true, mode: true, status: true } });
    const next = legs.find((l) => l.status === 'PENDING' && isLegActionable(legs as LegView[], l.sequence));
    if (next) await tx.shipmentLeg.update({ where: { id: next.id }, data: { status: 'READY' } });
  }

  /** Recompute the shipment's status from its legs and persist it. */
  private async recompute(tx: Prisma.TransactionClient, shipmentId: string): Promise<ShipmentStatus> {
    const s = await tx.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
      select: { service: true, legs: { select: { sequence: true, kind: true, mode: true, status: true } } },
    });
    const status = this.statusFrom(s.legs, !needsLastMile(s.service));
    const done = status === 'DELIVERED' ? { deliveredAt: new Date() } : status === 'AWAITING_COLLECTION' ? { collectedAt: null } : {};
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

  /* ---------------------------------------------------------- cancellation */

  /**
   * Cancel what has not happened yet. Completed legs stay completed — a parcel
   * that genuinely flew to San Pedro did fly to San Pedro, and rewriting that to
   * tidy up a cancellation would put a lie in the custody chain.
   */
  async cancel(id: string, input: CancelShipmentInput, actor: { userId: string; isStaff: boolean }) {
    const shipment = await this.prisma.$transaction(async (tx) => {
      const s = await tx.shipment.findUnique({ where: { id }, include: { legs: true } });
      if (!s) throw new NotFoundException('Shipment not found.');
      if (!actor.isStaff && s.customerUserId !== actor.userId) throw new NotFoundException('Shipment not found.');
      if (s.cancelledAt) throw new BadRequestException('That shipment is already cancelled.');
      if (s.legs.some((l) => l.status === 'IN_PROGRESS') && !actor.isStaff) {
        throw new BadRequestException('This shipment is already moving. Contact support to stop it.');
      }

      await tx.shipmentLeg.updateMany({
        where: { shipmentId: id, status: { in: ['PENDING', 'READY', 'IN_PROGRESS'] } },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      return tx.shipment.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: input.reason },
        include: SHIPMENT_INCLUDE,
      });
    });

    await this.audit.record({
      action: 'SHIPMENT_CANCELLED',
      actorId: actor.userId,
      reason: input.reason,
      newValue: { shipmentId: shipment.id, reference: shipment.reference },
    });
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
    if (endsAtHub || l.kind !== 'LAST_MILE') return null;
    if (l.status === 'COMPLETED' || l.status === 'CANCELLED') return null;
    return l.handoffPin;
  }
}
