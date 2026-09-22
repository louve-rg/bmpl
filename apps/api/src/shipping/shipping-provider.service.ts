import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { TRANSPORT_MODE_LABELS } from '@bmpl/shared';
import type {
  AddProviderMemberInput,
  LegDepartInput,
  SetLegOperatorInput,
  ShippingProviderProfileInput,
  ShippingProviderProfileUpdateInput,
} from '@bmpl/validation';
import type { Prisma, ShippingProviderProfile } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ShipmentService } from './shipment.service';
import { assertOperableProvider } from './provider-eligibility';

/** What the carrier-operator projection is allowed to read. Nothing more is loaded. */
const PROVIDER_LEG_INCLUDE = {
  originHub: { select: { name: true, city: true } },
  destinationHub: { select: { name: true, city: true } },
  shipment: { select: { reference: true, pieces: true, description: true, isTest: true } },
} satisfies Prisma.ShipmentLegInclude;

type ProviderLegRow = Prisma.ShipmentLegGetPayload<{ include: typeof PROVIDER_LEG_INCLUDE }>;

/**
 * Carrier organizations (BMPL-137).
 *
 * The profile is the ORG — the operating organization behind an approved
 * SHIPPING_PROVIDER role, created by self-service upsert exactly as
 * PassengerProviderProfile is. Membership is who may act for it: the OWNER
 * row is born with the profile, STAFF rows are admin-managed in phase 1, and
 * every provider-surface read and write scopes on the requesting USER ID
 * having an ACTIVE membership — never on the active role. Ending a membership
 * ends that person's access on their next request; the organization keeps its
 * legs and its history.
 */
@Injectable()
export class ShippingProviderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly shipments: ShipmentService,
  ) {}

  /* ---- profile (self-service; the passenger mirror) ---------------------- */

  async getProfile(userId: string) {
    const p = await this.prisma.shippingProviderProfile.findUnique({ where: { userId } });
    return p ? this.serializeProfile(p) : null;
  }

  async upsertProfile(userId: string, dto: ShippingProviderProfileInput) {
    const data = {
      businessName: dto.businessName,
      description: dto.description ?? null,
      contactEmail: dto.contactEmail,
      contactPhone: dto.contactPhone ?? null,
      district: dto.district ?? null,
      city: dto.city ?? null,
      addressLine1: dto.addressLine1 ?? null,
      operatingLicenceNumber: dto.operatingLicenceNumber ?? null,
      operatingLicenceExpiry: dto.operatingLicenceExpiry ?? null,
    };
    // isTest deliberately absent: admin-set only.
    const p = await this.prisma.$transaction(async (tx) => {
      const profile = await tx.shippingProviderProfile.upsert({
        where: { userId },
        create: { userId, ...data },
        update: data,
      });
      // The OWNER membership is born with the profile: the org always has at
      // least one person who may act for it, and scoping never special-cases
      // "the owner" against "a member".
      await tx.shippingProviderMember.upsert({
        where: { providerProfileId_userId: { providerProfileId: profile.id, userId } },
        create: { providerProfileId: profile.id, userId, memberRole: 'OWNER' },
        update: {},
      });
      return profile;
    });
    return this.serializeProfile(p);
  }

  async updateProfile(userId: string, dto: ShippingProviderProfileUpdateInput) {
    const existing = await this.prisma.shippingProviderProfile.findUnique({ where: { userId } });
    if (!existing) throw new NotFoundException('Start your carrier application first.');
    const data: Prisma.ShippingProviderProfileUpdateInput = {};
    if (dto.businessName !== undefined) data.businessName = dto.businessName;
    if (dto.contactEmail !== undefined) data.contactEmail = dto.contactEmail;
    for (const k of ['description', 'contactPhone', 'district', 'city', 'addressLine1', 'operatingLicenceNumber'] as const) {
      if (dto[k] !== undefined) (data as Record<string, unknown>)[k] = dto[k] ?? null;
    }
    if (dto.operatingLicenceExpiry !== undefined) data.operatingLicenceExpiry = dto.operatingLicenceExpiry ?? null;
    const p = await this.prisma.shippingProviderProfile.update({ where: { userId }, data });
    return this.serializeProfile(p);
  }

  /* ---- membership (admin-managed, phase 1) ------------------------------- */

  /** The carrier directory for the console: pick an operator, manage its staff. */
  async listProviders() {
    const rows = await this.prisma.shippingProviderProfile.findMany({
      orderBy: [{ isActive: 'desc' }, { businessName: 'asc' }],
      include: { _count: { select: { members: { where: { status: 'ACTIVE' } } } } },
      take: 200,
    });
    return rows.map((p) => ({ ...this.serializeProfile(p), activeMembers: p._count.members }));
  }

  async addMember(actorId: string, providerProfileId: string, dto: AddProviderMemberInput) {
    const profile = await this.prisma.shippingProviderProfile.findUnique({ where: { id: providerProfileId } });
    if (!profile) throw new NotFoundException('That carrier does not exist.');
    const user = await this.prisma.user.findUnique({ where: { id: dto.userId }, select: { id: true } });
    if (!user) throw new NotFoundException('That account does not exist.');

    const existing = await this.prisma.shippingProviderMember.findUnique({
      where: { providerProfileId_userId: { providerProfileId, userId: dto.userId } },
    });
    // A GUARD, not a convention (BMPL-151): an OWNER row's role never changes
    // through this endpoint. Without this line, re-adding the owner as STAFF
    // quietly demoted them — after which endMember, whose owner-protection
    // matches on memberRole, would happily end them and leave the organization
    // with nobody who may act for it. Admin-only and audited is a mitigation;
    // this is the design.
    if (existing?.memberRole === 'OWNER' && dto.memberRole === 'STAFF') {
      throw new BadRequestException("The owner cannot be demoted by re-adding them. The owner's role ends with the organization.");
    }
    // One row per person per org: re-adding reactivates rather than growing a
    // second row for the same pair.
    const member = existing
      ? await this.prisma.shippingProviderMember.update({
          where: { id: existing.id },
          data: { status: 'ACTIVE', endedAt: null, ...(dto.memberRole ? { memberRole: dto.memberRole } : {}) },
        })
      : await this.prisma.shippingProviderMember.create({
          data: { providerProfileId, userId: dto.userId, memberRole: dto.memberRole ?? 'STAFF' },
        });
    await this.audit.record({
      action: 'SHIPPING_PROVIDER_MEMBER_CHANGED',
      actorId,
      targetUserId: dto.userId,
      previousValue: existing ? { status: existing.status, memberRole: existing.memberRole } : null,
      newValue: { verb: existing ? 'REACTIVATED' : 'ADDED', providerProfileId, memberRole: member.memberRole },
    });
    return this.serializeMember(member);
  }

  async endMember(actorId: string, providerProfileId: string, userId: string) {
    const existing = await this.prisma.shippingProviderMember.findUnique({
      where: { providerProfileId_userId: { providerProfileId, userId } },
    });
    if (!existing || existing.status !== 'ACTIVE') throw new NotFoundException('No active membership to end.');
    // The owner's membership ends with the organization, not here: ending it
    // would leave a live org whose anchoring account cannot act for it.
    // Deactivate the profile instead.
    if (existing.memberRole === 'OWNER') {
      throw new BadRequestException("The owner's membership ends with the organization. Deactivate the carrier instead.");
    }
    const member = await this.prisma.shippingProviderMember.update({
      where: { id: existing.id },
      data: { status: 'ENDED', endedAt: new Date() },
    });
    await this.audit.record({
      action: 'SHIPPING_PROVIDER_MEMBER_CHANGED',
      actorId,
      targetUserId: userId,
      previousValue: { status: existing.status, memberRole: existing.memberRole },
      newValue: { verb: 'ENDED', providerProfileId },
    });
    return this.serializeMember(member);
  }

  /* ---- leg operator assignment (admin) ----------------------------------- */

  /**
   * Admin sets (or clears, with null) the carrier ORGANIZATION operating a
   * transport leg. Validation lives with the facts: LINE_HAUL only, not
   * finished, and the org active + approved + on the shipment's side of the
   * simulation boundary.
   */
  async setLegOperator(legId: string, input: SetLegOperatorInput, actorId: string) {
    const leg = await this.prisma.shipmentLeg.findUnique({
      where: { id: legId },
      select: {
        id: true,
        kind: true,
        status: true,
        operatedByProviderId: true,
        shipment: { select: { id: true, reference: true, isTest: true } },
      },
    });
    if (!leg) throw new NotFoundException('Leg not found.');
    if (leg.kind !== 'LINE_HAUL') {
      throw new BadRequestException('Only a transport leg has a carrier operator. Courier legs are worked by BML drivers.');
    }
    if (leg.status === 'COMPLETED' || leg.status === 'CANCELLED') {
      throw new BadRequestException(`This leg is ${leg.status.toLowerCase()}; there is nothing left for an operator to do on it.`);
    }
    if (input.providerProfileId) {
      await assertOperableProvider(this.prisma, input.providerProfileId, leg.shipment.isTest);
    }
    await this.prisma.shipmentLeg.update({ where: { id: leg.id }, data: { operatedByProviderId: input.providerProfileId } });
    await this.audit.record({
      action: 'SHIPMENT_LEG_OPERATOR_ASSIGNED',
      actorId,
      previousValue: { legId: leg.id, operatedByProviderId: leg.operatedByProviderId },
      newValue: { legId: leg.id, shipmentId: leg.shipment.id, reference: leg.shipment.reference, operatedByProviderId: input.providerProfileId },
    });
    return { legId: leg.id, operatedByProviderId: input.providerProfileId };
  }

  /* ---- the carrier's own surface ------------------------------------------ */

  /**
   * The org ids this person may currently act for: an ACTIVE membership in an
   * ACTIVE organization, resolved fresh per request so an ended membership or
   * a deactivated org cuts access immediately, not at next login.
   */
  private async myOrgIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.shippingProviderMember.findMany({
      where: { userId, status: 'ACTIVE', providerProfile: { isActive: true } },
      select: { providerProfileId: true },
    });
    if (rows.length === 0) throw new ForbiddenException('No active carrier membership.');
    return rows.map((r) => r.providerProfileId);
  }

  /** Every transport leg on my organizations, newest first. */
  async myLegs(userId: string) {
    const orgIds = await this.myOrgIds(userId);
    const legs = await this.prisma.shipmentLeg.findMany({
      where: { operatedByProviderId: { in: orgIds }, kind: 'LINE_HAUL' },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: PROVIDER_LEG_INCLUDE,
    });
    return legs.map((l) => this.providerLegOut(l));
  }

  async myLeg(userId: string, legId: string) {
    await this.assertMyLeg(userId, legId);
    const leg = await this.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId }, include: PROVIDER_LEG_INCLUDE });
    return this.providerLegOut(leg);
  }

  /**
   * Carrier confirms their org's leg departed. Ownership asserted first; the
   * transition itself — sequencing, custody, audit, customer notification —
   * is the SAME departLeg staff use. One state machine, two doors. The
   * staff-audience shipment payload departLeg returns is deliberately
   * discarded: a carrier gets back their own leg shape, never the customer's
   * details.
   */
  async depart(userId: string, legId: string, input: LegDepartInput) {
    await this.assertMyLeg(userId, legId);
    await this.shipments.departLeg(legId, input, { userId });
    return this.myLeg(userId, legId);
  }

  async arrive(userId: string, legId: string) {
    await this.assertMyLeg(userId, legId);
    await this.shipments.arriveLeg(legId, { userId });
    return this.myLeg(userId, legId);
  }

  /** 404 on a cross-org id: one carrier must not be able to probe another's legs. */
  private async assertMyLeg(userId: string, legId: string) {
    const orgIds = await this.myOrgIds(userId);
    const leg = await this.prisma.shipmentLeg.findUnique({ where: { id: legId }, select: { operatedByProviderId: true } });
    if (!leg || !leg.operatedByProviderId || !orgIds.includes(leg.operatedByProviderId)) {
      throw new NotFoundException('Leg not found.');
    }
  }

  /* ---- shaping ------------------------------------------------------------ */

  private serializeProfile(p: ShippingProviderProfile) {
    return {
      id: p.id,
      businessName: p.businessName,
      description: p.description,
      contactEmail: p.contactEmail,
      contactPhone: p.contactPhone,
      district: p.district,
      city: p.city,
      addressLine1: p.addressLine1,
      operatingLicenceNumber: p.operatingLicenceNumber,
      operatingLicenceExpiry: p.operatingLicenceExpiry,
      isActive: p.isActive,
      isTest: p.isTest,
      createdAt: p.createdAt,
    };
  }

  private serializeMember(m: { id: string; providerProfileId: string; userId: string; memberRole: string; status: string; endedAt: Date | null }) {
    return { id: m.id, providerProfileId: m.providerProfileId, userId: m.userId, memberRole: m.memberRole, status: m.status, endedAt: m.endedAt };
  }

  /**
   * The carrier-safe projection. A hand-written ALLOWLIST, not a filtered
   * serialize(): nothing appears here by default. Deliberately absent: sender
   * and recipient names, phones and addresses, door coordinates, every PIN,
   * the customer's price, and operator-typed exception prose from other legs.
   */
  private providerLegOut(l: ProviderLegRow) {
    return {
      id: l.id,
      reference: l.shipment.reference,
      status: l.status,
      mode: l.mode,
      modeLabel: TRANSPORT_MODE_LABELS[l.mode],
      from: l.originHub ? { name: l.originHub.name, city: l.originHub.city } : null,
      to: l.destinationHub ? { name: l.destinationHub.name, city: l.destinationHub.city } : null,
      pieces: l.shipment.pieces,
      description: l.shipment.description || null,
      scheduledDepartureAt: l.scheduledDepartureAt,
      scheduledArrivalAt: l.scheduledArrivalAt,
      departedAt: l.departedAt,
      arrivedAt: l.arrivedAt,
      carrierName: l.carrierName,
      carrierBookingRef: l.carrierBookingRef,
      isTest: l.shipment.isTest,
      // What the operator can do right now, so the UI carries no second copy
      // of the state machine. PENDING means an earlier leg has not finished.
      canDepart: (l.status === 'READY' || l.status === 'IN_PROGRESS') && l.departedAt == null,
      canArrive: l.status === 'IN_PROGRESS' && l.arrivedAt == null,
    };
  }
}
