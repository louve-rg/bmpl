import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import type {
  AdminPassengerRouteInput,
  PassengerRouteInput,
  PassengerRouteStopsInput,
  PassengerRouteUpdateInput,
  PassengerTripCreateInput,
} from '@bmpl/validation';
import { PassengerTripStatus } from '@bmpl/database';
import type { PassengerCancellationParty, PassengerRoute, PassengerRouteStop, PassengerTrip, Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

interface Actor {
  userId: string;
  ipAddress?: string | null;
  sessionId?: string | null;
}

/** See logistics-network.service: BigInt leaves the API as a number; the JSON patch lives in main.ts only. */
const money = (v: bigint | null) => (v == null ? null : Number(v));

/**
 * The passenger transport network (S2): routes an operator runs, the ordered
 * stops along them, and SCHEDULED trips — published departures of a route.
 *
 * Ownership model mirrors vendors-and-products: a provider manages their OWN
 * routes; admin acts across all of them under passengers.read / .moderate.
 * There is no approval workflow for a route — the schema has none (isActive
 * only), and none is authorized.
 *
 * isTest is DERIVED from the owning operator's profile, never from a request —
 * the S1 rule (a vehicle inherits its owner's flag), not the A6 one (hubs are
 * admin-asserted because a hub has no owner to derive from). A route always
 * has an owner, and deriving makes it impossible for a rehearsal service to
 * sit on the real side of the boundary. Trips inherit from the route.
 * Derivation happens at WRITE time from a source that stays mutable, so it is
 * only half the invariant: the other half is setProviderTestMode
 * (admin-passenger.service), which re-derives every owned route and vehicle
 * in the same transaction when the operator's flag flips.
 *
 * Fares do not exist in this phase: baseFareMinor is never written and stays
 * null. No request can set it and nothing here defaults it.
 */
@Injectable()
export class PassengerNetworkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /* ------------------------------------------------------------ scoping */

  private async providerOf(userId: string) {
    // isActive is selected so PUBLISH paths can honour suspension (S3 review
    // F2 — S2 and S3 must tell the same suspension story). Reads, edits and
    // cancellations deliberately still work for a suspended operator:
    // cleanup survives suspension.
    const p = await this.prisma.passengerProviderProfile.findUnique({
      where: { userId },
      select: { id: true, userId: true, isTest: true, isActive: true, businessName: true },
    });
    if (!p) throw new NotFoundException('Start your transport-operator application first.');
    return p;
  }

  /** Same 404 for "does not exist" and "not yours" — a route id is not a probe. */
  private async routeOrThrow(routeId: string, providerProfileId?: string) {
    const r = await this.prisma.passengerRoute.findUnique({
      where: { id: routeId },
      include: {
        stops: { orderBy: { sequence: 'asc' } },
        providerProfile: { select: { id: true, userId: true, isActive: true, businessName: true } },
      },
    });
    if (!r || (providerProfileId && r.providerProfileId !== providerProfileId)) {
      throw new NotFoundException('Route not found.');
    }
    return r;
  }

  private async tripOrThrow(tripId: string, providerProfileId?: string) {
    const t = await this.prisma.passengerTrip.findUnique({
      where: { id: tripId },
      include: { providerProfile: { select: { userId: true } }, route: { select: { name: true } } },
    });
    if (!t || (providerProfileId && t.providerProfileId !== providerProfileId)) {
      throw new NotFoundException('Trip not found.');
    }
    return t;
  }

  /* ------------------------------------------------------------- routes */

  async listRoutesForProvider(userId: string) {
    const p = await this.providerOf(userId);
    const rows = await this.prisma.passengerRoute.findMany({
      where: { providerProfileId: p.id },
      orderBy: { createdAt: 'desc' },
      include: { stops: { orderBy: { sequence: 'asc' } }, _count: { select: { trips: true } } },
    });
    return rows.map((r) => this.serializeRoute(r));
  }

  async getRouteForProvider(userId: string, routeId: string) {
    const p = await this.providerOf(userId);
    return this.serializeRoute(await this.routeOrThrow(routeId, p.id));
  }

  async createRouteForProvider(actor: Actor, dto: PassengerRouteInput) {
    const p = await this.providerOf(actor.userId);
    return this.createRoute(actor, p, dto);
  }

  async updateRouteForProvider(actor: Actor, routeId: string, dto: PassengerRouteUpdateInput) {
    const p = await this.providerOf(actor.userId);
    return this.updateRoute(actor, await this.routeOrThrow(routeId, p.id), dto);
  }

  async replaceStopsForProvider(actor: Actor, routeId: string, stops: PassengerRouteStopsInput) {
    const p = await this.providerOf(actor.userId);
    return this.replaceStops(actor, await this.routeOrThrow(routeId, p.id), stops);
  }

  async listAllRoutes(filter: { isTest?: boolean } = {}) {
    const rows = await this.prisma.passengerRoute.findMany({
      where: filter.isTest === undefined ? {} : { isTest: filter.isTest },
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: {
        stops: { orderBy: { sequence: 'asc' } },
        providerProfile: { select: { id: true, businessName: true } },
        _count: { select: { trips: true } },
      },
    });
    return rows.map((r) => this.serializeRoute(r));
  }

  async getRouteAdmin(routeId: string) {
    return this.serializeRoute(await this.routeOrThrow(routeId));
  }

  async createRouteAdmin(actor: Actor, dto: AdminPassengerRouteInput) {
    const p = await this.prisma.passengerProviderProfile.findUnique({
      where: { id: dto.providerProfileId },
      select: { id: true, userId: true, isTest: true, isActive: true, businessName: true },
    });
    if (!p) throw new NotFoundException('Transport operator not found.');
    const { providerProfileId: _ignored, ...route } = dto;
    return this.createRoute(actor, p, route);
  }

  async updateRouteAdmin(actor: Actor, routeId: string, dto: PassengerRouteUpdateInput) {
    return this.updateRoute(actor, await this.routeOrThrow(routeId), dto);
  }

  async replaceStopsAdmin(actor: Actor, routeId: string, stops: PassengerRouteStopsInput) {
    return this.replaceStops(actor, await this.routeOrThrow(routeId), stops);
  }

  private async createRoute(
    actor: Actor,
    provider: { id: string; userId: string; isTest: boolean; isActive: boolean },
    dto: PassengerRouteInput,
  ) {
    // Publishing is gated on suspension; whoever is typing (S3 review F2).
    if (!provider.isActive) {
      throw new BadRequestException('This operator account is suspended.');
    }
    const route = await this.prisma.$transaction(async (tx) => {
      const r = await tx.passengerRoute.create({
        data: {
          providerProfileId: provider.id,
          // Derived from the operator's side of the simulation boundary.
          isTest: provider.isTest,
          name: dto.name,
          description: dto.description ?? null,
          originDistrict: dto.originDistrict,
          originCity: dto.originCity,
          destinationDistrict: dto.destinationDistrict,
          destinationCity: dto.destinationCity,
          scheduleNote: dto.scheduleNote ?? null,
          durationMinutes: dto.durationMinutes ?? null,
          // The operator's number, verbatim (S3 fare ruling). Null/0 keep the
          // booking gate closed; nothing computes with it.
          baseFareMinor: dto.baseFareMinor != null ? BigInt(dto.baseFareMinor) : null,
          stops: dto.stops?.length
            ? { create: dto.stops.map((s, i) => this.stopData(s, i + 1)) }
            : undefined,
        },
        include: { stops: { orderBy: { sequence: 'asc' } } },
      });
      await this.audit.record(
        {
          action: 'PASSENGER_ROUTE_CREATED',
          actorId: actor.userId,
          targetUserId: provider.userId,
          ipAddress: actor.ipAddress ?? null,
          sessionId: actor.sessionId ?? null,
          newValue: {
            routeId: r.id,
            name: r.name,
            origin: `${r.originCity}, ${r.originDistrict}`,
            destination: `${r.destinationCity}, ${r.destinationDistrict}`,
            stops: r.stops.length,
            baseFareMinor: r.baseFareMinor == null ? null : Number(r.baseFareMinor),
            isTest: r.isTest,
          },
        },
        tx,
      );
      return r;
    });
    return this.serializeRoute(route);
  }

  private async updateRoute(
    actor: Actor,
    route: PassengerRoute & { stops: PassengerRouteStop[]; providerProfile: { userId: string } },
    dto: PassengerRouteUpdateInput,
  ) {
    // The endpoints are what a published departure MEANS — a scheduled trip
    // carries its geography on the route. Once departures exist, changing where
    // the route goes would silently rewrite them; the operator creates a new
    // route instead.
    const endpointKeys = ['originDistrict', 'originCity', 'destinationDistrict', 'destinationCity'] as const;
    const movesEndpoints = endpointKeys.some((k) => dto[k] !== undefined && dto[k] !== route[k]);
    if (movesEndpoints) await this.refuseIfDeparturesPublished(route.id);
    const data: Prisma.PassengerRouteUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    // Fare is money configuration, not geography: it stays editable after
    // departures exist (no charge has occurred; bookings snapshot nothing),
    // and every change lands in the ROUTE_UPDATED audit row below.
    if (dto.baseFareMinor !== undefined) data.baseFareMinor = BigInt(dto.baseFareMinor);
    if (dto.originDistrict !== undefined) data.originDistrict = dto.originDistrict;
    if (dto.originCity !== undefined) data.originCity = dto.originCity;
    if (dto.destinationDistrict !== undefined) data.destinationDistrict = dto.destinationDistrict;
    if (dto.destinationCity !== undefined) data.destinationCity = dto.destinationCity;
    for (const k of ['description', 'scheduleNote', 'durationMinutes'] as const) {
      if (dto[k] !== undefined) (data as Record<string, unknown>)[k] = dto[k] ?? null;
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const r = await tx.passengerRoute.update({
        where: { id: route.id },
        data,
        include: { stops: { orderBy: { sequence: 'asc' } } },
      });
      await this.audit.record(
        {
          action: 'PASSENGER_ROUTE_UPDATED',
          actorId: actor.userId,
          targetUserId: route.providerProfile.userId,
          ipAddress: actor.ipAddress ?? null,
          sessionId: actor.sessionId ?? null,
          previousValue: this.auditableRoute(route),
          newValue: this.auditableRoute(r),
        },
        tx,
      );
      return r;
    });
    return this.serializeRoute(updated);
  }

  /**
   * The freeze deliberately counts CANCELLED departures too: a trip row —
   * even a retracted one — is history that reconstructs against the route's
   * geography (the schema Restricts route deletion for the same reason).
   * The message says "published" rather than "has", because an operator who
   * cancelled their only departure sees none outstanding — and the refusal
   * must still be telling them the truth.
   */
  private async refuseIfDeparturesPublished(routeId: string) {
    const departures = await this.prisma.passengerTrip.count({ where: { routeId } });
    if (departures > 0) {
      throw new BadRequestException(
        'Departures have been published on this route (including any since cancelled), so where and how it runs cannot change. Deactivate it and create a new route instead.',
      );
    }
  }

  private async replaceStops(
    actor: Actor,
    route: PassengerRoute & { stops: PassengerRouteStop[]; providerProfile: { userId: string } },
    stops: PassengerRouteStopsInput,
  ) {
    // The ordered stop list is as much "what riders were promised" as the
    // endpoints are — the same freeze applies once departures exist.
    await this.refuseIfDeparturesPublished(route.id);
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.passengerRouteStop.deleteMany({ where: { routeId: route.id } });
      if (stops.length) {
        await tx.passengerRouteStop.createMany({
          data: stops.map((s, i) => ({ routeId: route.id, ...this.stopData(s, i + 1) })),
        });
      }
      await this.audit.record(
        {
          action: 'PASSENGER_ROUTE_UPDATED',
          actorId: actor.userId,
          targetUserId: route.providerProfile.userId,
          ipAddress: actor.ipAddress ?? null,
          sessionId: actor.sessionId ?? null,
          previousValue: { routeId: route.id, stops: route.stops.map((s) => `${s.city}, ${s.district}`) },
          newValue: { routeId: route.id, stops: stops.map((s) => `${s.city}, ${s.district}`) },
        },
        tx,
      );
      return tx.passengerRoute.findUniqueOrThrow({
        where: { id: route.id },
        include: { stops: { orderBy: { sequence: 'asc' } } },
      });
    });
    return this.serializeRoute(updated);
  }

  /* -------------------------------------------------------------- trips */

  async listTripsForProvider(userId: string, filter: { routeId?: string; status?: string } = {}) {
    const p = await this.providerOf(userId);
    return this.listTrips({ ...filter, providerProfileId: p.id });
  }

  async listAllTrips(filter: { routeId?: string; status?: string } = {}) {
    return this.listTrips(filter);
  }

  private async listTrips(filter: { providerProfileId?: string; routeId?: string; status?: string }) {
    const where: Prisma.PassengerTripWhereInput = {};
    if (filter.providerProfileId) where.providerProfileId = filter.providerProfileId;
    if (filter.routeId) where.routeId = filter.routeId;
    // A free-text ?status= must not reach Prisma unvalidated.
    if (filter.status && filter.status in PassengerTripStatus) where.status = filter.status as PassengerTripStatus;
    const rows = await this.prisma.passengerTrip.findMany({
      where,
      orderBy: { scheduledDepartureAt: 'desc' },
      take: 300,
      include: {
        route: { select: { name: true } },
        providerProfile: { select: { businessName: true } },
        driverProfile: { select: { displayName: true } },
        vehicle: { select: { make: true, model: true, licencePlate: true } },
      },
    });
    // Same capacity rule as confirmation and the rider feed: only CONFIRMED
    // bookings spend seats.
    const seatCounts = await this.prisma.passengerBooking.groupBy({
      by: ['tripId'],
      where: { tripId: { in: rows.map((t) => t.id) }, status: 'CONFIRMED' },
      _sum: { seats: true },
    });
    const confirmedBy = new Map(seatCounts.map((s) => [s.tripId, s._sum.seats ?? 0]));
    return rows.map((t) => this.serializeTrip(t, { seatsConfirmed: confirmedBy.get(t.id) ?? 0 }));
  }

  async createTripForProvider(actor: Actor, dto: PassengerTripCreateInput) {
    const p = await this.providerOf(actor.userId);
    return this.createTrip(actor, await this.routeOrThrow(dto.routeId, p.id), dto);
  }

  async createTripAdmin(actor: Actor, dto: PassengerTripCreateInput) {
    return this.createTrip(actor, await this.routeOrThrow(dto.routeId), dto);
  }

  async cancelTripForProvider(actor: Actor, tripId: string, reason?: string) {
    const p = await this.providerOf(actor.userId);
    return this.cancelTrip(actor, await this.tripOrThrow(tripId, p.id), 'PROVIDER', reason);
  }

  async cancelTripAdmin(actor: Actor, tripId: string, reason?: string) {
    return this.cancelTrip(actor, await this.tripOrThrow(tripId), 'ADMIN', reason);
  }

  /**
   * Publish one departure of a route. Driver, vehicle and seat snapshot belong
   * to the assignment phase, not here. Audited: the trip row alone cannot say
   * WHO published it — providerProfileId comes from the route, so without the
   * audit an admin publishing on an operator's behalf would be
   * indistinguishable from the operator themselves.
   */
  private async createTrip(
    actor: Actor,
    route: PassengerRoute & { providerProfile: { userId: string; isActive?: boolean } },
    dto: PassengerTripCreateInput,
  ) {
    if (!route.isActive) {
      throw new BadRequestException('This route is inactive. Reactivate it before publishing departures.');
    }
    // Suspension gates publishing here too (S3 review F2) — a suspended
    // operator's routes stay readable and cancellable, but publish nothing.
    if (route.providerProfile?.isActive === false) {
      throw new BadRequestException('This operator account is suspended.');
    }
    if (dto.scheduledDepartureAt.getTime() <= Date.now()) {
      throw new BadRequestException('That departure time has already passed.');
    }
    const trip = await this.prisma.$transaction(async (tx) => {
      const t = await tx.passengerTrip.create({
        data: {
          reference: await this.uniqueReference(tx),
          kind: 'SCHEDULED',
          status: 'SCHEDULED',
          // Inherited through the route from the operator; never from a request.
          isTest: route.isTest,
          routeId: route.id,
          providerProfileId: route.providerProfileId,
          scheduledDepartureAt: dto.scheduledDepartureAt,
          scheduledArrivalAt: dto.scheduledArrivalAt ?? null,
        },
        include: { route: { select: { name: true } }, providerProfile: { select: { businessName: true } } },
      });
      await this.audit.record(
        {
          action: 'PASSENGER_TRIP_CREATED',
          actorId: actor.userId,
          targetUserId: route.providerProfile.userId,
          ipAddress: actor.ipAddress ?? null,
          sessionId: actor.sessionId ?? null,
          newValue: {
            tripId: t.id,
            reference: t.reference,
            routeId: route.id,
            scheduledDepartureAt: t.scheduledDepartureAt?.toISOString() ?? null,
            isTest: t.isTest,
          },
        },
        tx,
      );
      return t;
    });
    return this.serializeTrip(trip);
  }

  /**
   * Retract a published departure that has not begun. Only SCHEDULED trips
   * qualify — everything past assignment is movement, which is a later phase
   * with its own rules.
   */
  private async cancelTrip(
    actor: Actor,
    trip: PassengerTrip & { providerProfile: { userId: string } | null; route: { name: string } | null },
    party: PassengerCancellationParty,
    reason?: string,
  ) {
    // S3 widened this from SCHEDULED-only: a staffed departure that has not
    // begun is still normal ops to cancel. Anything IN_PROGRESS or later is
    // people on a vehicle, and that is not a cancellation, it is an exception.
    if (trip.status !== 'SCHEDULED' && trip.status !== 'ASSIGNED') {
      throw new BadRequestException('Only a departure that has not begun can be cancelled here.');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const t = await tx.passengerTrip.update({
        where: { id: trip.id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledBy: party,
          cancellationReason: reason ?? null,
        },
        include: { route: { select: { name: true } }, providerProfile: { select: { businessName: true } } },
      });
      // Riders on the departure are cancelled WITH it, attributed to the same
      // party — a booking on a cancelled trip is not a booking anyone can honour.
      await tx.passengerBooking.updateMany({
        where: { tripId: trip.id, status: { in: ['REQUESTED', 'CONFIRMED'] } },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: party, cancellationReason: 'The departure was cancelled.' },
      });
      // And the staffing record is closed truthfully rather than left ACTIVE.
      await tx.passengerTripAssignment.updateMany({
        where: { tripId: trip.id, status: 'ACTIVE' },
        data: { status: 'CANCELLED', endedAt: new Date(), endReason: 'Departure cancelled.' },
      });
      await this.audit.record(
        {
          action: 'PASSENGER_TRIP_CANCELLED',
          actorId: actor.userId,
          targetUserId: trip.providerProfile?.userId ?? null,
          ipAddress: actor.ipAddress ?? null,
          sessionId: actor.sessionId ?? null,
          newValue: { tripId: t.id, reference: t.reference, cancelledBy: party, reason: reason ?? null },
        },
        tx,
      );
      return t;
    });
    return this.serializeTrip(updated);
  }

  /**
   * Rider-facing reference, same alphabet and collision discipline as a
   * shipment's tracking code. BML-T… is lexically a valid BML-… shipment
   * reference (the S2 review's F4), so uniqueness is checked against BOTH
   * tables: a reference names exactly one thing anywhere in the product, and
   * a support agent pasting it into the wrong lookup gets a miss, never a
   * different customer's shipment.
   */
  private async uniqueReference(tx: Prisma.TransactionClient): Promise<string> {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
    for (let attempt = 0; attempt < 8; attempt++) {
      const body = Array.from({ length: 7 }, () => alphabet[randomInt(0, alphabet.length)]).join('');
      const reference = `BML-T${body}`;
      const [asTrip, asShipment] = await Promise.all([
        tx.passengerTrip.findUnique({ where: { reference }, select: { id: true } }),
        tx.shipment.findUnique({ where: { reference }, select: { id: true } }),
      ]);
      if (!asTrip && !asShipment) return reference;
    }
    throw new BadRequestException('Could not allocate a trip reference. Please try again.');
  }

  /* ------------------------------------------------------------ shaping */

  private auditableRoute(r: PassengerRoute) {
    return {
      routeId: r.id,
      name: r.name,
      origin: `${r.originCity}, ${r.originDistrict}`,
      destination: `${r.destinationCity}, ${r.destinationDistrict}`,
      scheduleNote: r.scheduleNote,
      durationMinutes: r.durationMinutes,
      baseFareMinor: r.baseFareMinor == null ? null : Number(r.baseFareMinor),
      isActive: r.isActive,
    };
  }

  serializeRoute(
    r: PassengerRoute & {
      stops?: PassengerRouteStop[];
      providerProfile?: { id: string; businessName: string };
      _count?: { trips: number };
    },
  ) {
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      originDistrict: r.originDistrict,
      originCity: r.originCity,
      destinationDistrict: r.destinationDistrict,
      destinationCity: r.destinationCity,
      scheduleNote: r.scheduleNote,
      durationMinutes: r.durationMinutes,
      baseFareMinor: money(r.baseFareMinor),
      isActive: r.isActive,
      isTest: r.isTest,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      ...(r.stops
        ? {
            stops: r.stops.map((s) => ({
              id: s.id,
              sequence: s.sequence,
              district: s.district,
              city: s.city,
              name: s.name,
              latitude: s.latitude,
              longitude: s.longitude,
            })),
          }
        : {}),
      ...(r.providerProfile ? { provider: { id: r.providerProfile.id, businessName: r.providerProfile.businessName } } : {}),
      ...(r._count ? { tripCount: r._count.trips } : {}),
    };
  }

  serializeTrip(
    t: PassengerTrip & {
      route?: { name: string } | null;
      providerProfile?: { businessName: string } | null;
      driverProfile?: { displayName: string } | null;
      vehicle?: { make: string; model: string; licencePlate: string } | null;
    },
    opts?: { seatsConfirmed?: number },
  ) {
    return {
      id: t.id,
      reference: t.reference,
      kind: t.kind,
      status: t.status,
      isTest: t.isTest,
      routeId: t.routeId,
      routeName: t.route?.name ?? null,
      providerProfileId: t.providerProfileId,
      providerName: t.providerProfile?.businessName ?? null,
      // Assignment is act-able through the console, so it must be see-able:
      // once a trip leaves SCHEDULED, these say who is driving and in what.
      driverProfileId: t.driverProfileId,
      driverName: t.driverProfile?.displayName ?? null,
      vehicleId: t.vehicleId,
      vehicle: t.vehicle ? { make: t.vehicle.make, model: t.vehicle.model, licencePlate: t.vehicle.licencePlate } : null,
      seatCapacity: t.seatCapacity,
      ...(opts?.seatsConfirmed !== undefined
        ? {
            seatsConfirmed: opts.seatsConfirmed,
            seatsRemaining: t.seatCapacity == null ? null : t.seatCapacity - opts.seatsConfirmed,
          }
        : {}),
      scheduledDepartureAt: t.scheduledDepartureAt,
      scheduledArrivalAt: t.scheduledArrivalAt,
      cancelledAt: t.cancelledAt,
      cancelledBy: t.cancelledBy,
      cancellationReason: t.cancellationReason,
      createdAt: t.createdAt,
    };
  }

  private stopData(s: PassengerRouteStopsInput[number], sequence: number) {
    return {
      sequence,
      district: s.district,
      city: s.city,
      name: s.name ?? null,
      latitude: s.latitude ?? null,
      longitude: s.longitude ?? null,
    };
  }
}
