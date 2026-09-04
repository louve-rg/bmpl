import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import type {
  PassengerBookingCreateInput,
  PassengerTripAssignInput,
} from '@bmpl/validation';
import { PassengerBookingStatus } from '@bmpl/database';
import type { PassengerBooking, PassengerCancellationParty, Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

interface Actor {
  userId: string;
  ipAddress?: string | null;
  sessionId?: string | null;
}

/** Trip states a rider may still join or leave. Movement means the doors closed. */
const BOOKABLE_TRIP_STATUSES = ['SCHEDULED', 'ASSIGNED'] as const;

/**
 * Passenger booking & movement (S3), behind the fare gate.
 *
 * THE FARE GATE (the product owner's ruling — #13 applied to passengers):
 * a booking can be neither CREATED nor CONFIRMED unless the route carries a
 * configured fare. Zero is not a price and null is not a price; the refusal
 * is a plain-words "pricing unavailable" state. Nothing here computes,
 * quotes or charges an amount — fareQuotedMinor stays null, because whether
 * baseFareMinor is per seat or per booking is commercial policy nobody has
 * set, and a guessed multiplication becomes a real charge to a real person.
 *
 * SEATS ARE HELD AT CONFIRMATION, NOT AT REQUEST (Michael's decision,
 * flagged to the product owner): a request reserves nothing; confirmation
 * fails closed if capacity is unknown (no vehicle assigned yet) or spent.
 * The capacity check runs under a row lock on the trip so two confirmations
 * cannot both sell the last seat.
 *
 * NOT HERE, on purpose — their product questions are unanswered: the
 * ON_DEMAND request flow (EXPIRED timing), NO_SHOW (who may say it), and
 * any auto-confirmation rule.
 */
@Injectable()
export class PassengerOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ----------------------------------------------------------- scoping */

  private async providerOf(userId: string) {
    // isActive is selected AND honoured here (the S2 review's F5): a
    // suspended operator neither confirms seats nor staffs departures.
    const p = await this.prisma.passengerProviderProfile.findUnique({
      where: { userId },
      select: { id: true, userId: true, isTest: true, isActive: true, businessName: true },
    });
    if (!p) throw new NotFoundException('Start your transport-operator application first.');
    return p;
  }

  private async driverProfileOf(userId: string) {
    const d = await this.prisma.passengerDriverProfile.findUnique({
      where: { userId },
      select: { id: true, userId: true, isTest: true, isActive: true, displayName: true },
    });
    if (!d) throw new NotFoundException('No passenger-driver profile found.');
    return d;
  }

  private fareGate(baseFareMinor: bigint | null) {
    // Null is no fare; zero is not a price. Same principle as shipping's
    // zero-total refusal — the gate holds until an operator configures one.
    if (baseFareMinor == null || baseFareMinor <= 0n) {
      throw new BadRequestException(
        'Pricing for this service is not available yet. Seats cannot be booked until the operator publishes a fare — please check back.',
      );
    }
  }

  /* ------------------------------------------------------ rider surface */

  /** Departures a rider may browse: their side of the boundary, active services only. */
  async listDepartures(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { isTest: true } });
    const trips = await this.prisma.passengerTrip.findMany({
      where: {
        kind: 'SCHEDULED',
        status: { in: [...BOOKABLE_TRIP_STATUSES] },
        isTest: user.isTest,
        scheduledDepartureAt: { gt: new Date() },
        route: { isActive: true },
        providerProfile: { isActive: true },
      },
      orderBy: { scheduledDepartureAt: 'asc' },
      take: 100,
      include: {
        route: {
          select: {
            name: true, originDistrict: true, originCity: true, destinationDistrict: true,
            destinationCity: true, scheduleNote: true, durationMinutes: true, baseFareMinor: true,
          },
        },
        providerProfile: { select: { businessName: true } },
      },
    });
    const seatCounts = await this.prisma.passengerBooking.groupBy({
      by: ['tripId'],
      where: { tripId: { in: trips.map((t) => t.id) }, status: 'CONFIRMED' },
      _sum: { seats: true },
    });
    const confirmedBy = new Map(seatCounts.map((s) => [s.tripId, s._sum.seats ?? 0]));
    return trips.map((t) => ({
      id: t.id,
      reference: t.reference,
      status: t.status,
      scheduledDepartureAt: t.scheduledDepartureAt,
      scheduledArrivalAt: t.scheduledArrivalAt,
      route: {
        name: t.route!.name,
        originDistrict: t.route!.originDistrict,
        originCity: t.route!.originCity,
        destinationDistrict: t.route!.destinationDistrict,
        destinationCity: t.route!.destinationCity,
        scheduleNote: t.route!.scheduleNote,
        durationMinutes: t.route!.durationMinutes,
      },
      operator: t.providerProfile?.businessName ?? null,
      // The operator's configured figure, reported verbatim — never computed on.
      baseFareMinor: t.route!.baseFareMinor == null ? null : Number(t.route!.baseFareMinor),
      fareConfigured: t.route!.baseFareMinor != null && t.route!.baseFareMinor > 0n,
      seatCapacity: t.seatCapacity,
      seatsConfirmed: confirmedBy.get(t.id) ?? 0,
    }));
  }

  async createBooking(actor: Actor, dto: PassengerBookingCreateInput) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { id: true, isTest: true } });
    const trip = await this.prisma.passengerTrip.findUnique({
      where: { id: dto.tripId },
      include: {
        route: { select: { isActive: true, baseFareMinor: true, name: true } },
        providerProfile: { select: { userId: true, isActive: true } },
        driverProfile: { select: { userId: true } },
      },
    });
    // Cross-boundary is answered exactly like nonexistent: a real rider is
    // never told a rehearsal departure exists, and vice versa.
    if (!trip || trip.kind !== 'SCHEDULED' || trip.isTest !== user.isTest) {
      throw new NotFoundException('Departure not found.');
    }
    if (!(BOOKABLE_TRIP_STATUSES as readonly string[]).includes(trip.status)) {
      throw new BadRequestException('This departure is no longer taking bookings.');
    }
    if (!trip.scheduledDepartureAt || trip.scheduledDepartureAt.getTime() <= Date.now()) {
      throw new BadRequestException('This departure has already left.');
    }
    if (!trip.route?.isActive || trip.providerProfile?.isActive === false) {
      throw new BadRequestException('This service is not currently operating.');
    }
    this.fareGate(trip.route.baseFareMinor);
    // The self-service invariant, on userId as always: the person driving a
    // departure does not ride it as a passenger.
    if (trip.driverProfile?.userId === user.id) {
      throw new BadRequestException('You are assigned to drive this departure.');
    }
    const existing = await this.prisma.passengerBooking.count({
      where: { tripId: trip.id, passengerUserId: user.id, status: { in: ['REQUESTED', 'CONFIRMED'] } },
    });
    if (existing > 0) {
      throw new BadRequestException('You already have a booking on this departure.');
    }

    const booking = await this.prisma.$transaction(async (tx) => {
      return tx.passengerBooking.create({
        data: {
          reference: await this.uniqueBookingReference(tx),
          // Snapshot of the rider's side of the boundary; the rider's flag is
          // guarded against flips while this booking is open (admin.service).
          isTest: user.isTest,
          passengerUserId: user.id,
          tripId: trip.id,
          seats: dto.seats,
          status: 'REQUESTED',
          // fareQuotedMinor deliberately untouched: no pricing policy exists.
        },
      });
    });
    if (trip.providerProfile) {
      await this.notifications.createInApp({
        userId: trip.providerProfile.userId,
        type: 'ACCOUNT',
        title: 'New seat request',
        body: `${dto.seats} seat(s) requested on ${trip.route.name} (${trip.reference}).`,
        data: { bookingId: booking.id, tripId: trip.id },
      });
    }
    return this.serializeBooking(booking);
  }

  async listOwnBookings(userId: string) {
    const rows = await this.prisma.passengerBooking.findMany({
      where: { passengerUserId: userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { trip: { include: { route: { select: { name: true, originCity: true, destinationCity: true } } } } },
    });
    return rows.map((b) => this.serializeBooking(b));
  }

  async cancelOwnBooking(actor: Actor, bookingId: string, reason?: string) {
    const b = await this.prisma.passengerBooking.findUnique({
      where: { id: bookingId },
      include: { trip: { select: { status: true } } },
    });
    if (!b || b.passengerUserId !== actor.userId) throw new NotFoundException('Booking not found.');
    return this.cancelBooking(actor, b, 'PASSENGER', reason);
  }

  /* --------------------------------------------------- provider surface */

  async listProviderBookings(userId: string, filter: { tripId?: string; status?: string } = {}) {
    const p = await this.providerOf(userId);
    return this.listBookings({ ...filter, providerProfileId: p.id });
  }

  async confirmBookingAsProvider(actor: Actor, bookingId: string) {
    const p = await this.providerOf(actor.userId);
    if (!p.isActive) throw new BadRequestException('This operator account is suspended.');
    const b = await this.bookingOnProviderTrip(bookingId, p.id);
    return this.confirmBooking(actor, b);
  }

  async cancelBookingAsProvider(actor: Actor, bookingId: string, reason?: string) {
    const p = await this.providerOf(actor.userId);
    const b = await this.bookingOnProviderTrip(bookingId, p.id);
    return this.cancelBooking(actor, b, 'PROVIDER', reason);
  }

  async assignTripAsProvider(actor: Actor, tripId: string, dto: PassengerTripAssignInput) {
    const p = await this.providerOf(actor.userId);
    if (!p.isActive) throw new BadRequestException('This operator account is suspended.');
    const trip = await this.prisma.passengerTrip.findUnique({
      where: { id: tripId },
      include: { providerProfile: { select: { id: true, userId: true, isActive: true } }, route: { select: { name: true } } },
    });
    if (!trip || trip.providerProfileId !== p.id) throw new NotFoundException('Trip not found.');
    return this.assignTrip(actor, trip, dto);
  }

  /* ------------------------------------------------------ admin surface */

  async listAllBookings(filter: { tripId?: string; status?: string } = {}) {
    return this.listBookings(filter);
  }

  async confirmBookingAsAdmin(actor: Actor, bookingId: string) {
    const b = await this.bookingOrThrow(bookingId);
    return this.confirmBooking(actor, b);
  }

  async cancelBookingAsAdmin(actor: Actor, bookingId: string, reason?: string) {
    const b = await this.bookingOrThrow(bookingId);
    return this.cancelBooking(actor, b, 'ADMIN', reason);
  }

  async assignTripAsAdmin(actor: Actor, tripId: string, dto: PassengerTripAssignInput) {
    const trip = await this.prisma.passengerTrip.findUnique({
      where: { id: tripId },
      include: { providerProfile: { select: { id: true, userId: true, isActive: true } }, route: { select: { name: true } } },
    });
    if (!trip) throw new NotFoundException('Trip not found.');
    return this.assignTrip(actor, trip, dto);
  }

  /* ------------------------------------------------------ driver surface */

  async listDriverTrips(userId: string) {
    const d = await this.driverProfileOf(userId);
    const rows = await this.prisma.passengerTrip.findMany({
      where: { driverProfileId: d.id, status: { in: ['ASSIGNED', 'IN_PROGRESS'] } },
      orderBy: { scheduledDepartureAt: 'asc' },
      take: 100,
      include: { route: { select: { name: true, originCity: true, destinationCity: true } }, providerProfile: { select: { businessName: true } } },
    });
    return rows.map((t) => ({
      id: t.id,
      reference: t.reference,
      status: t.status,
      scheduledDepartureAt: t.scheduledDepartureAt,
      routeName: t.route?.name ?? null,
      from: t.route?.originCity ?? null,
      to: t.route?.destinationCity ?? null,
      operator: t.providerProfile?.businessName ?? null,
      seatCapacity: t.seatCapacity,
    }));
  }

  async startTrip(actor: Actor, tripId: string) {
    const d = await this.driverProfileOf(actor.userId);
    const trip = await this.prisma.passengerTrip.findUnique({ where: { id: tripId }, select: { id: true, status: true, driverProfileId: true } });
    if (!trip || trip.driverProfileId !== d.id) throw new NotFoundException('Trip not found.');
    if (trip.status !== 'ASSIGNED') throw new BadRequestException('Only an assigned departure can start.');
    const updated = await this.prisma.passengerTrip.update({
      where: { id: trip.id },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
      select: { id: true, reference: true, status: true, startedAt: true },
    });
    return updated;
  }

  async completeTrip(actor: Actor, tripId: string) {
    const d = await this.driverProfileOf(actor.userId);
    const trip = await this.prisma.passengerTrip.findUnique({
      where: { id: tripId },
      include: { providerProfile: { select: { userId: true } } },
    });
    if (!trip || trip.driverProfileId !== d.id) throw new NotFoundException('Trip not found.');
    if (trip.status !== 'IN_PROGRESS') throw new BadRequestException('Only a departure in progress can be completed.');
    const updated = await this.prisma.$transaction(async (tx) => {
      const t = await tx.passengerTrip.update({
        where: { id: trip.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
        select: { id: true, reference: true, status: true, completedAt: true },
      });
      // Confirmed riders travelled; their bookings become history. REQUESTED
      // bookings are left untouched — what an unanswered request becomes when
      // the bus leaves is an open product question (EXPIRED timing), not a
      // default to invent here.
      await tx.passengerBooking.updateMany({
        where: { tripId: trip.id, status: 'CONFIRMED' },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      await tx.passengerTripAssignment.updateMany({
        where: { tripId: trip.id, status: 'ACTIVE' },
        data: { status: 'COMPLETED', endedAt: new Date() },
      });
      await tx.passengerDriverProfile.update({ where: { id: d.id }, data: { completedTrips: { increment: 1 } } });
      await this.audit.record(
        {
          action: 'PASSENGER_TRIP_COMPLETED',
          actorId: actor.userId,
          targetUserId: trip.providerProfile?.userId ?? null,
          ipAddress: actor.ipAddress ?? null,
          sessionId: actor.sessionId ?? null,
          newValue: { tripId: trip.id, reference: trip.reference },
        },
        tx,
      );
      return t;
    });
    return updated;
  }

  /* ----------------------------------------------------------- core ops */

  private async bookingOrThrow(bookingId: string) {
    const b = await this.prisma.passengerBooking.findUnique({
      where: { id: bookingId },
      include: { trip: { select: { status: true } } },
    });
    if (!b) throw new NotFoundException('Booking not found.');
    return b;
  }

  private async bookingOnProviderTrip(bookingId: string, providerProfileId: string) {
    const b = await this.prisma.passengerBooking.findUnique({
      where: { id: bookingId },
      include: { trip: { select: { status: true, providerProfileId: true } } },
    });
    if (!b || b.trip?.providerProfileId !== providerProfileId) throw new NotFoundException('Booking not found.');
    return b;
  }

  /**
   * Confirmation is the moment a seat is actually held. Fails closed three
   * ways: no configured fare, no assigned vehicle (capacity unknowable), or
   * not enough seats left. The capacity check runs under a row lock on the
   * trip so concurrent confirmations serialize instead of overselling.
   */
  private async confirmBooking(actor: Actor, b: PassengerBooking & { trip: { status: string } | null }) {
    if (b.status !== 'REQUESTED') throw new BadRequestException('Only a requested booking can be confirmed.');
    if (!b.tripId || !b.trip || !(BOOKABLE_TRIP_STATUSES as readonly string[]).includes(b.trip.status)) {
      throw new BadRequestException('This departure is no longer taking confirmations.');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM passenger_trips WHERE id = ${b.tripId} FOR UPDATE`;
      const trip = await tx.passengerTrip.findUniqueOrThrow({
        where: { id: b.tripId! },
        include: { route: { select: { baseFareMinor: true } }, providerProfile: { select: { userId: true } } },
      });
      // The gate holds at confirmation too: a fare unset since the request
      // was made means the seat cannot be sold now.
      this.fareGate(trip.route?.baseFareMinor ?? null);
      if (trip.seatCapacity == null) {
        throw new BadRequestException('Assign a vehicle to this departure first — confirmations sell its seats.');
      }
      const sold = await tx.passengerBooking.aggregate({
        where: { tripId: b.tripId!, status: 'CONFIRMED' },
        _sum: { seats: true },
      });
      const taken = sold._sum.seats ?? 0;
      if (taken + b.seats > trip.seatCapacity) {
        throw new BadRequestException(
          `Not enough seats left: ${trip.seatCapacity - taken} available, ${b.seats} requested.`,
        );
      }
      const row = await tx.passengerBooking.update({
        where: { id: b.id },
        data: { status: 'CONFIRMED', confirmedAt: new Date() },
      });
      await this.audit.record(
        {
          action: 'PASSENGER_BOOKING_CONFIRMED',
          actorId: actor.userId,
          targetUserId: b.passengerUserId,
          ipAddress: actor.ipAddress ?? null,
          sessionId: actor.sessionId ?? null,
          newValue: { bookingId: b.id, reference: b.reference, tripId: b.tripId, seats: b.seats },
        },
        tx,
      );
      return row;
    });
    if (b.passengerUserId) {
      await this.notifications.createInApp({
        userId: b.passengerUserId,
        type: 'ACCOUNT',
        title: 'Seats confirmed',
        body: `Your booking ${b.reference} is confirmed (${b.seats} seat(s)).`,
        data: { bookingId: b.id },
      });
    }
    return this.serializeBooking(updated);
  }

  private async cancelBooking(
    actor: Actor,
    b: PassengerBooking & { trip: { status: string } | null },
    party: PassengerCancellationParty,
    reason?: string,
  ) {
    if (b.status !== 'REQUESTED' && b.status !== 'CONFIRMED') {
      throw new BadRequestException('This booking is already settled.');
    }
    // A rider may always withdraw their own UNANSWERED request, even after the
    // departure has left or been cancelled — completion deliberately leaves
    // REQUESTED bookings untouched (the EXPIRED question is open), and without
    // this exit the request would sit in their list forever. Withdrawing holds
    // no seat and harms nobody; it decides nothing about what an unanswered
    // request BECOMES automatically, which stays an open product question.
    const ownWithdrawal = party === 'PASSENGER' && b.status === 'REQUESTED';
    if (!ownWithdrawal && b.trip && !['SCHEDULED', 'ASSIGNED'].includes(b.trip.status)) {
      throw new BadRequestException('This departure has already begun; the booking can no longer be cancelled.');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.passengerBooking.update({
        where: { id: b.id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: party, cancellationReason: reason ?? null },
      });
      await this.audit.record(
        {
          action: 'PASSENGER_BOOKING_CANCELLED',
          actorId: actor.userId,
          targetUserId: b.passengerUserId,
          ipAddress: actor.ipAddress ?? null,
          sessionId: actor.sessionId ?? null,
          newValue: { bookingId: b.id, reference: b.reference, cancelledBy: party, reason: reason ?? null },
        },
        tx,
      );
      return row;
    });
    if (party !== 'PASSENGER' && b.passengerUserId) {
      await this.notifications.createInApp({
        userId: b.passengerUserId,
        type: 'ACCOUNT',
        title: 'Booking cancelled',
        body: `Your booking ${b.reference} was cancelled${reason ? `: ${reason}` : '.'}`,
        data: { bookingId: b.id },
      });
    }
    return this.serializeBooking(updated);
  }

  /**
   * Manual staffing only — the delivery lesson; no automatic dispatch exists
   * for passengers. Fleet drivers only: whether an INDEPENDENT driver may be
   * put on an operator's route is the unresolved affiliation-consent
   * question, so it fails closed rather than defaulting to yes.
   */
  private async assignTrip(
    actor: Actor,
    trip: { id: string; reference: string; status: string; isTest: boolean; providerProfileId: string | null; providerProfile: { userId: string; isActive: boolean } | null; route: { name: string } | null },
    dto: PassengerTripAssignInput,
  ) {
    if (trip.status !== 'SCHEDULED') {
      throw new BadRequestException('Only an unstaffed scheduled departure can be assigned.');
    }
    if (trip.providerProfile?.isActive === false) {
      throw new BadRequestException('This operator account is suspended.');
    }
    const driver = await this.prisma.passengerDriverProfile.findUnique({
      where: { id: dto.driverProfileId },
      select: { id: true, userId: true, isTest: true, isActive: true, providerProfileId: true, displayName: true },
    });
    if (!driver) throw new BadRequestException('That driver does not exist.');
    if (!driver.isActive) throw new BadRequestException('That driver profile is deactivated.');
    if (driver.isTest !== trip.isTest) {
      throw new BadRequestException('That driver is on the other side of the test boundary.');
    }
    if (driver.providerProfileId !== trip.providerProfileId) {
      throw new BadRequestException("Only the operator's own fleet drivers can staff this departure.");
    }
    const role = await this.prisma.userRole.findUnique({
      where: { userId_roleCode: { userId: driver.userId, roleCode: 'PASSENGER_DRIVER' } },
      select: { status: true },
    });
    if (role?.status !== 'APPROVED') {
      throw new BadRequestException('That driver is not approved to carry passengers.');
    }
    // The self-service invariant on userId: a person with a seat on this
    // departure cannot also be put behind its wheel.
    const riding = await this.prisma.passengerBooking.count({
      where: { tripId: trip.id, passengerUserId: driver.userId, status: { in: ['REQUESTED', 'CONFIRMED'] } },
    });
    if (riding > 0) {
      throw new BadRequestException('That person holds a booking on this departure and cannot drive it.');
    }
    const vehicle = await this.prisma.passengerVehicle.findUnique({
      where: { id: dto.vehicleId },
      select: { id: true, isTest: true, isActive: true, approvalStatus: true, seatCapacity: true, providerProfileId: true, ownerDriverProfileId: true, make: true, model: true },
    });
    if (!vehicle) throw new BadRequestException('That vehicle does not exist.');
    if (!vehicle.isActive || vehicle.approvalStatus !== 'APPROVED') {
      throw new BadRequestException('That vehicle is not approved for passenger transport.');
    }
    if (vehicle.isTest !== trip.isTest) {
      throw new BadRequestException('That vehicle is on the other side of the test boundary.');
    }
    const ownedByFleet = vehicle.providerProfileId != null && vehicle.providerProfileId === trip.providerProfileId;
    const ownedByDriver = vehicle.ownerDriverProfileId != null && vehicle.ownerDriverProfileId === driver.id;
    if (!ownedByFleet && !ownedByDriver) {
      throw new BadRequestException("Use one of the operator's vehicles, or the assigned driver's own.");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const t = await tx.passengerTrip.update({
        where: { id: trip.id },
        data: {
          status: 'ASSIGNED',
          driverProfileId: driver.id,
          vehicleId: vehicle.id,
          // Capacity is snapshotted HERE — it is what confirmations sell.
          seatCapacity: vehicle.seatCapacity,
          assignedAt: new Date(),
        },
        select: { id: true, reference: true, status: true, driverProfileId: true, vehicleId: true, seatCapacity: true, assignedAt: true },
      });
      await tx.passengerTripAssignment.create({
        data: {
          tripId: trip.id,
          driverProfileId: driver.id,
          vehicleId: vehicle.id,
          assignedByUserId: actor.userId,
          status: 'ACTIVE',
        },
      });
      await this.audit.record(
        {
          action: 'PASSENGER_TRIP_ASSIGNED',
          actorId: actor.userId,
          targetUserId: driver.userId,
          ipAddress: actor.ipAddress ?? null,
          sessionId: actor.sessionId ?? null,
          newValue: { tripId: trip.id, reference: trip.reference, driverProfileId: driver.id, vehicleId: vehicle.id, seatCapacity: vehicle.seatCapacity },
        },
        tx,
      );
      return t;
    });
    await this.notifications.createInApp({
      userId: driver.userId,
      type: 'ACCOUNT',
      title: 'You have a departure',
      body: `${trip.route?.name ?? 'A route'} (${trip.reference}) — ${vehicle.make} ${vehicle.model}.`,
      data: { tripId: trip.id },
    });
    return updated;
  }

  private async listBookings(filter: { providerProfileId?: string; tripId?: string; status?: string }) {
    const where: Prisma.PassengerBookingWhereInput = {};
    if (filter.tripId) where.tripId = filter.tripId;
    if (filter.providerProfileId) where.trip = { providerProfileId: filter.providerProfileId };
    if (filter.status && filter.status in PassengerBookingStatus) where.status = filter.status as PassengerBookingStatus;
    const rows = await this.prisma.passengerBooking.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: {
        trip: { include: { route: { select: { name: true, originCity: true, destinationCity: true } } } },
        passenger: { select: { firstName: true, lastName: true } },
      },
    });
    return rows.map((b) => ({
      ...this.serializeBooking(b),
      passengerName: b.passenger ? `${b.passenger.firstName} ${b.passenger.lastName}` : null,
    }));
  }

  /** Booking codes share the reference discipline: unique across every table a BML-… code could name. */
  private async uniqueBookingReference(tx: Prisma.TransactionClient): Promise<string> {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
    for (let attempt = 0; attempt < 8; attempt++) {
      const body = Array.from({ length: 7 }, () => alphabet[randomInt(0, alphabet.length)]).join('');
      const reference = `BML-B${body}`;
      const [asBooking, asShipment] = await Promise.all([
        tx.passengerBooking.findUnique({ where: { reference }, select: { id: true } }),
        tx.shipment.findUnique({ where: { reference }, select: { id: true } }),
      ]);
      if (!asBooking && !asShipment) return reference;
    }
    throw new BadRequestException('Could not allocate a booking reference. Please try again.');
  }

  serializeBooking(
    b: PassengerBooking & { trip?: ({ reference: string; scheduledDepartureAt: Date | null; status: string; route?: { name: string; originCity: string; destinationCity: string } | null }) | null },
  ) {
    return {
      id: b.id,
      reference: b.reference,
      status: b.status,
      seats: b.seats,
      isTest: b.isTest,
      tripId: b.tripId,
      tripReference: b.trip?.reference ?? null,
      tripStatus: b.trip?.status ?? null,
      scheduledDepartureAt: b.trip?.scheduledDepartureAt ?? null,
      routeName: b.trip?.route?.name ?? null,
      from: b.trip?.route?.originCity ?? null,
      to: b.trip?.route?.destinationCity ?? null,
      confirmedAt: b.confirmedAt,
      completedAt: b.completedAt,
      cancelledAt: b.cancelledAt,
      cancelledBy: b.cancelledBy,
      cancellationReason: b.cancellationReason,
      createdAt: b.createdAt,
    };
  }
}
