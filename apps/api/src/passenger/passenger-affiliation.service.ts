import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PassengerAffiliationInviteInput, PassengerAffiliationRequestInput } from '@bmpl/validation';
import { Prisma } from '@bmpl/database';
import type { PassengerFleetAffiliation } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

interface Actor {
  userId: string;
  ipAddress?: string | null;
  sessionId?: string | null;
}

/**
 * Fleet affiliation with MUTUAL CONSENT — the owner's rule,
 * verbatim: neither party may unilaterally create an active affiliation. An
 * operator may INVITE a driver, who must accept; a driver may REQUEST to join
 * a fleet, which the operator must approve.
 *
 * The shape is PropertyListingAssignment's, the existing two-party consent
 * precedent: a PENDING row is an unanswered ask, and only the COUNTERPARTY of
 * `initiatedBy` can turn it ACCEPTED. Acceptance is the one place in the whole
 * API that sets PassengerDriverProfile.providerProfileId — the operational
 * pointer the own-fleet assignment rule reads — and it does so in the same
 * transaction, guarded so a driver can never end up in two fleets.
 *
 * Termination is deliberately unilateral: consent is required to CREATE the
 * relationship, not to leave it. Ending an affiliation nulls the pointer (so
 * NEW assignment refuses immediately) and touches nothing else — departures
 * already assigned stay assigned, exactly as the schema's SetNull rule already
 * decided for a dissolving fleet ("leaves its drivers independent, not
 * deleted").
 *
 * NOT here, on purpose: commissions, employment terms, revenue splits or any
 * other commercial policy (the row has no field to hold one), and no admin
 * creation path — moderation can see affiliations through the driver detail,
 * but no one, admin included, can consent on someone else's behalf.
 */
@Injectable()
export class PassengerAffiliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---- own-profile resolution ---------------------------------------------

  private async ownProviderOrThrow(userId: string) {
    const p = await this.prisma.passengerProviderProfile.findUnique({ where: { userId } });
    if (!p) throw new NotFoundException('Start your transport-operator application first.');
    return p;
  }

  private async ownDriverOrThrow(userId: string) {
    const p = await this.prisma.passengerDriverProfile.findUnique({ where: { userId } });
    if (!p) throw new NotFoundException('Start your passenger-driver application first.');
    return p;
  }

  // ---- reads --------------------------------------------------------------

  async listForProvider(userId: string, status?: string) {
    const p = await this.ownProviderOrThrow(userId);
    const rows = await this.prisma.passengerFleetAffiliation.findMany({
      where: { providerProfileId: p.id, ...(status ? { status: status as never } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { driverProfile: { select: { id: true, displayName: true, homeDistrict: true, availability: true, isActive: true } } },
    });
    return rows.map((a) => ({
      ...this.serialize(a),
      driver: {
        id: a.driverProfile.id,
        displayName: a.driverProfile.displayName,
        homeDistrict: a.driverProfile.homeDistrict,
        availability: a.driverProfile.availability,
        isActive: a.driverProfile.isActive,
      },
    }));
  }

  async listForDriver(userId: string, status?: string) {
    const p = await this.ownDriverOrThrow(userId);
    const rows = await this.prisma.passengerFleetAffiliation.findMany({
      where: { driverProfileId: p.id, ...(status ? { status: status as never } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { providerProfile: { select: { id: true, businessName: true, district: true, isActive: true } } },
    });
    return rows.map((a) => ({
      ...this.serialize(a),
      provider: {
        id: a.providerProfile.id,
        businessName: a.providerProfile.businessName,
        district: a.providerProfile.district,
        isActive: a.providerProfile.isActive,
      },
    }));
  }

  // ---- the two asks -------------------------------------------------------

  /** Operator invites a driver. Creates a PENDING ask — never an ACCEPTED row. */
  async invite(actor: Actor, dto: PassengerAffiliationInviteInput) {
    const provider = await this.ownProviderOrThrow(actor.userId);
    if (!provider.isActive) throw new BadRequestException('This operator account is suspended.');
    const driver = await this.prisma.passengerDriverProfile.findUnique({
      where: { id: dto.driverProfileId },
      select: { id: true, userId: true, isTest: true, isActive: true, providerProfileId: true, displayName: true },
    });
    if (!driver) throw new BadRequestException('That driver does not exist.');
    if (!driver.isActive) throw new BadRequestException('That driver profile is deactivated.');
    if (driver.isTest !== provider.isTest) {
      throw new BadRequestException('That driver is on the other side of the test boundary.');
    }
    const role = await this.prisma.userRole.findUnique({
      where: { userId_roleCode: { userId: driver.userId, roleCode: 'PASSENGER_DRIVER' } },
      select: { status: true },
    });
    if (role?.status !== 'APPROVED') {
      throw new BadRequestException('That driver is not approved to carry passengers.');
    }
    await this.refuseIfTaken(driver.providerProfileId, provider.id);
    await this.refuseIfPending(provider.id, driver.id);
    const row = await this.createAsk({
      providerProfileId: provider.id,
      driverProfileId: driver.id,
      initiatedBy: 'PROVIDER',
      status: 'PENDING',
      message: dto.message ?? null,
      // Both sides were just proven to match; either one is the derivation.
      isTest: provider.isTest,
    });
    await this.record(actor, row, driver.userId, 'invited');
    await this.notifications.createInApp({
      userId: driver.userId,
      type: 'ACCOUNT',
      title: 'Fleet invitation',
      body: `${provider.businessName} invited you to join their fleet.`,
      data: { affiliationId: row.id },
    });
    return this.serialize(row);
  }

  /** Driver asks to join a fleet. Creates a PENDING ask — never an ACCEPTED row. */
  async request(actor: Actor, dto: PassengerAffiliationRequestInput) {
    const driver = await this.ownDriverOrThrow(actor.userId);
    if (!driver.isActive) throw new BadRequestException('This driver profile is deactivated.');
    const provider = await this.prisma.passengerProviderProfile.findUnique({
      where: { id: dto.providerProfileId },
      select: { id: true, userId: true, isTest: true, isActive: true, businessName: true },
    });
    if (!provider) throw new BadRequestException('That operator does not exist.');
    if (!provider.isActive) throw new BadRequestException('That operator account is suspended.');
    if (provider.isTest !== driver.isTest) {
      throw new BadRequestException('That operator is on the other side of the test boundary.');
    }
    const role = await this.prisma.userRole.findUnique({
      where: { userId_roleCode: { userId: provider.userId, roleCode: 'PASSENGER_PROVIDER' } },
      select: { status: true },
    });
    if (role?.status !== 'APPROVED') {
      throw new BadRequestException('That operator is not approved to run a fleet.');
    }
    await this.refuseIfTaken(driver.providerProfileId, provider.id);
    await this.refuseIfPending(provider.id, driver.id);
    const row = await this.createAsk({
      providerProfileId: provider.id,
      driverProfileId: driver.id,
      initiatedBy: 'DRIVER',
      status: 'PENDING',
      message: dto.message ?? null,
      isTest: driver.isTest,
    });
    await this.record(actor, row, provider.userId, 'requested');
    await this.notifications.createInApp({
      userId: provider.userId,
      type: 'ACCOUNT',
      title: 'Fleet join request',
      body: `A driver asked to join your fleet.`,
      data: { affiliationId: row.id },
    });
    return this.serialize(row);
  }

  // ---- the two consents ---------------------------------------------------

  /** Driver accepts an operator's INVITATION. The one driver-side consent. */
  async acceptAsDriver(actor: Actor, affiliationId: string) {
    const driver = await this.ownDriverOrThrow(actor.userId);
    const asn = await this.prisma.passengerFleetAffiliation.findFirst({
      where: { id: affiliationId, driverProfileId: driver.id },
      include: { providerProfile: { select: { userId: true, isTest: true, isActive: true, businessName: true } } },
    });
    if (!asn) throw new NotFoundException('Affiliation not found.');
    if (asn.status !== 'PENDING') throw new BadRequestException('This invitation can no longer be accepted.');
    if (asn.initiatedBy !== 'PROVIDER') {
      // THE consent rule. A driver answering their own ask would make the
      // affiliation unilateral.
      throw new BadRequestException('You asked to join this fleet; the operator must approve it.');
    }
    if (!asn.providerProfile.isActive) throw new BadRequestException('That operator account is suspended.');
    return this.activate(actor, asn, { driverIsTest: driver.isTest, providerIsTest: asn.providerProfile.isTest }, asn.providerProfile.userId);
  }

  /** Operator approves a driver's REQUEST. The one provider-side consent. */
  async approveAsProvider(actor: Actor, affiliationId: string) {
    const provider = await this.ownProviderOrThrow(actor.userId);
    if (!provider.isActive) throw new BadRequestException('This operator account is suspended.');
    const asn = await this.prisma.passengerFleetAffiliation.findFirst({
      where: { id: affiliationId, providerProfileId: provider.id },
      include: { driverProfile: { select: { userId: true, isTest: true, isActive: true } } },
    });
    if (!asn) throw new NotFoundException('Affiliation not found.');
    if (asn.status !== 'PENDING') throw new BadRequestException('This request can no longer be approved.');
    if (asn.initiatedBy !== 'DRIVER') {
      // THE consent rule, mirrored: an operator answering their own invite
      // would put a driver in a fleet the driver never agreed to.
      throw new BadRequestException('You invited this driver; only the driver can accept.');
    }
    if (!asn.driverProfile.isActive) throw new BadRequestException('That driver profile is deactivated.');
    return this.activate(actor, asn, { driverIsTest: asn.driverProfile.isTest, providerIsTest: provider.isTest }, asn.driverProfile.userId);
  }

  /**
   * The single write path to the operational pointer. The conditional
   * updateMany is the race guard: if another fleet accepted this driver
   * between the read and here, the count is 0 and nothing was changed.
   */
  private async activate(actor: Actor, asn: PassengerFleetAffiliation, sides: { driverIsTest: boolean; providerIsTest: boolean }, notifyUserId: string) {
    if (sides.driverIsTest !== sides.providerIsTest) {
      // A test-mode flip since the ask was created; the sides no longer match.
      throw new BadRequestException('The two accounts are on opposite sides of the test boundary.');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      // The OFFER must still be live at the moment of consent — re-checked
      // as a conditional write inside the transaction (the fare gate's
      // re-check-inside-confirmation pattern), so an ask withdrawn or
      // declined concurrently can never be resurrected into ACCEPTED by a
      // consent that read PENDING a moment earlier.
      const consented = await tx.passengerFleetAffiliation.updateMany({
        where: { id: asn.id, status: 'PENDING' },
        // isTest re-derived at the moment the link becomes real, in case both
        // sides were flipped together since the ask was created.
        data: { status: 'ACCEPTED', acceptedAt: new Date(), isTest: sides.driverIsTest },
      });
      if (consented.count !== 1) {
        throw new BadRequestException('This ask can no longer be accepted.');
      }
      // Both profile rows are verified with CONDITIONAL WRITES inside this
      // transaction. A write takes the row lock, so a concurrent admin
      // test-mode flip (whose own affiliation guard runs inside its
      // transaction after updating the same row) SERIALIZES against this
      // consent instead of racing it — whichever commits second sees the
      // other and refuses. The provider write is same-value on purpose: a
      // lock and a check, not a change.
      const providerHeld = await tx.passengerProviderProfile.updateMany({
        where: { id: asn.providerProfileId, isTest: sides.providerIsTest },
        data: { isTest: sides.providerIsTest },
      });
      if (providerHeld.count !== 1) {
        throw new BadRequestException('The two accounts are on opposite sides of the test boundary.');
      }
      const linked = await tx.passengerDriverProfile.updateMany({
        where: { id: asn.driverProfileId, providerProfileId: null, isTest: sides.driverIsTest },
        data: { providerProfileId: asn.providerProfileId },
      });
      if (linked.count !== 1) {
        const d = await tx.passengerDriverProfile.findUniqueOrThrow({ where: { id: asn.driverProfileId }, select: { providerProfileId: true } });
        throw new BadRequestException(
          d.providerProfileId != null ? 'This driver already drives for a fleet.' : 'The two accounts are on opposite sides of the test boundary.',
        );
      }
      const row = await tx.passengerFleetAffiliation.findUniqueOrThrow({ where: { id: asn.id } });
      await this.record(actor, row, notifyUserId, 'accepted', tx);
      return row;
    });
    await this.notifications.createInApp({
      userId: notifyUserId,
      type: 'ACCOUNT',
      title: 'Fleet affiliation active',
      body: 'The fleet affiliation was accepted. Departures can now be staffed.',
      data: { affiliationId: updated.id },
    });
    return this.serialize(updated);
  }

  // ---- refusal, withdrawal, termination -----------------------------------

  /** The counterparty says no to a PENDING ask. */
  async decline(actor: Actor, affiliationId: string, as: 'DRIVER' | 'PROVIDER') {
    const asn = await this.ownAffiliationOrThrow(actor.userId, affiliationId, as);
    if (asn.status !== 'PENDING') throw new BadRequestException('This affiliation can no longer be declined.');
    if (asn.initiatedBy === as) {
      throw new BadRequestException('You initiated this; withdraw it instead of declining it.');
    }
    const row = await this.settle(affiliationId, 'PENDING', { status: 'DECLINED', endedAt: new Date(), endedBy: as }, 'This affiliation can no longer be declined.');
    await this.record(actor, row, this.counterpartyUserId(asn, as), 'declined');
    return this.serialize(row);
  }

  /** The initiator takes back their own PENDING ask. */
  async withdraw(actor: Actor, affiliationId: string, as: 'DRIVER' | 'PROVIDER') {
    const asn = await this.ownAffiliationOrThrow(actor.userId, affiliationId, as);
    if (asn.status !== 'PENDING') throw new BadRequestException('This affiliation can no longer be withdrawn.');
    if (asn.initiatedBy !== as) {
      throw new BadRequestException('Only the side that initiated can withdraw; decline it instead.');
    }
    const row = await this.settle(affiliationId, 'PENDING', { status: 'WITHDRAWN', endedAt: new Date(), endedBy: as }, 'This affiliation can no longer be withdrawn.');
    await this.record(actor, row, this.counterpartyUserId(asn, as), 'withdrawn');
    return this.serialize(row);
  }

  /**
   * Either party ends an ACCEPTED affiliation — consent creates, either side
   * dissolves. The pointer is nulled CONDITIONALLY on still pointing at this
   * fleet, so ending a stale row can never detach a driver from a different,
   * later fleet. Departures already assigned are deliberately untouched.
   */
  async end(actor: Actor, affiliationId: string, as: 'DRIVER' | 'PROVIDER') {
    const asn = await this.ownAffiliationOrThrow(actor.userId, affiliationId, as);
    if (asn.status !== 'ACCEPTED') throw new BadRequestException('Only an active affiliation can be ended.');
    const updated = await this.prisma.$transaction(async (tx) => {
      // Conditional, like every transition: a row the other party ended a
      // moment ago is not ended twice, and its audit trail is not doubled.
      const ending = await tx.passengerFleetAffiliation.updateMany({
        where: { id: affiliationId, status: 'ACCEPTED' },
        data: { status: 'ENDED', endedAt: new Date(), endedBy: as },
      });
      if (ending.count !== 1) {
        throw new BadRequestException('Only an active affiliation can be ended.');
      }
      await tx.passengerDriverProfile.updateMany({
        where: { id: asn.driverProfileId, providerProfileId: asn.providerProfileId },
        data: { providerProfileId: null },
      });
      const row = await tx.passengerFleetAffiliation.findUniqueOrThrow({ where: { id: affiliationId } });
      await this.record(actor, row, this.counterpartyUserId(asn, as), 'ended', tx);
      return row;
    });
    await this.notifications.createInApp({
      userId: this.counterpartyUserId(asn, as),
      type: 'ACCOUNT',
      title: 'Fleet affiliation ended',
      body: 'The fleet affiliation has ended. Existing departures are unaffected.',
      data: { affiliationId: updated.id },
    });
    return this.serialize(updated);
  }

  // ---- shared guards ------------------------------------------------------

  /** Scope a mutation to a row the caller is actually a party to. */
  private async ownAffiliationOrThrow(userId: string, affiliationId: string, as: 'DRIVER' | 'PROVIDER') {
    const own = as === 'DRIVER' ? await this.ownDriverOrThrow(userId) : await this.ownProviderOrThrow(userId);
    const asn = await this.prisma.passengerFleetAffiliation.findFirst({
      where: { id: affiliationId, ...(as === 'DRIVER' ? { driverProfileId: own.id } : { providerProfileId: own.id }) },
      include: {
        driverProfile: { select: { userId: true } },
        providerProfile: { select: { userId: true } },
      },
    });
    if (!asn) throw new NotFoundException('Affiliation not found.');
    return asn;
  }

  private counterpartyUserId(asn: { driverProfile: { userId: string }; providerProfile: { userId: string } }, as: 'DRIVER' | 'PROVIDER') {
    return as === 'DRIVER' ? asn.providerProfile.userId : asn.driverProfile.userId;
  }

  private async refuseIfTaken(currentProviderProfileId: string | null, targetProviderId: string) {
    if (currentProviderProfileId === targetProviderId) {
      throw new BadRequestException('This driver is already in this fleet.');
    }
    if (currentProviderProfileId != null) {
      throw new BadRequestException('This driver already drives for a fleet.');
    }
  }

  /**
   * One live ask per pair, in EITHER direction — decided deliberately, not
   * fallen into: an operator invite and a driver request for the same pair
   * must never coexist, because two half-consents could otherwise be read as
   * one whole one when neither party ever answered the other. The second
   * asker is refused and answers the existing ask with the proper verb
   * (accept / approve / decline) — which is a real consent to the same thing.
   */
  private async refuseIfPending(providerProfileId: string, driverProfileId: string) {
    const pending = await this.prisma.passengerFleetAffiliation.findFirst({
      where: { providerProfileId, driverProfileId, status: 'PENDING' },
      select: { id: true },
    });
    if (pending) throw new BadRequestException('An affiliation between you is already awaiting an answer.');
  }

  /**
   * The one-live-ask rule is a DATABASE fact too: a partial unique index
   * (migration 20261104093000) covers the pair WHERE status = 'PENDING'.
   * refuseIfPending gives the ordinary case its friendly refusal; this
   * converts the index's P2002 — two asks racing past that check — into the
   * same plain words, so the invariant holds without the caller ever seeing
   * a constraint error.
   */
  private async createAsk(data: {
    providerProfileId: string;
    driverProfileId: string;
    initiatedBy: 'DRIVER' | 'PROVIDER';
    status: 'PENDING';
    message: string | null;
    isTest: boolean;
  }) {
    try {
      return await this.prisma.passengerFleetAffiliation.create({ data });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('An affiliation between you is already awaiting an answer.');
      }
      throw e;
    }
  }

  /** A settled row settles once: transition only from the expected status. */
  private async settle(
    affiliationId: string,
    from: 'PENDING',
    data: { status: 'DECLINED' | 'WITHDRAWN'; endedAt: Date; endedBy: 'DRIVER' | 'PROVIDER' },
    refusal: string,
  ) {
    const changed = await this.prisma.passengerFleetAffiliation.updateMany({ where: { id: affiliationId, status: from }, data });
    if (changed.count !== 1) throw new BadRequestException(refusal);
    return this.prisma.passengerFleetAffiliation.findUniqueOrThrow({ where: { id: affiliationId } });
  }

  /** One audit action for the whole lifecycle — the assignment precedent. */
  private record(actor: Actor, row: PassengerFleetAffiliation, targetUserId: string, event: string, tx?: Prisma.TransactionClient) {
    return this.audit.record(
      {
        action: 'PASSENGER_AFFILIATION_CHANGED',
        actorId: actor.userId,
        targetUserId,
        ipAddress: actor.ipAddress ?? null,
        sessionId: actor.sessionId ?? null,
        newValue: {
          affiliationId: row.id,
          providerProfileId: row.providerProfileId,
          driverProfileId: row.driverProfileId,
          initiatedBy: row.initiatedBy,
          status: row.status,
          event,
        },
      },
      tx,
    );
  }

  private serialize(a: PassengerFleetAffiliation) {
    return {
      id: a.id,
      providerProfileId: a.providerProfileId,
      driverProfileId: a.driverProfileId,
      initiatedBy: a.initiatedBy,
      status: a.status,
      message: a.message,
      isTest: a.isTest,
      acceptedAt: a.acceptedAt,
      endedAt: a.endedAt,
      endedBy: a.endedBy,
      createdAt: a.createdAt,
    };
  }
}
