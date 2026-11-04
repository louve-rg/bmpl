import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { canChangeProviderStatus, providerStatusTarget, TRANSPORT_MODE_LABELS, type ShippingProviderStatusAction } from '@bmpl/shared';
import type {
  AddProviderMemberInput,
  AddRouteScheduleExceptionInput,
  ClaimRouteOperatorInput,
  LegDepartInput,
  LegOperatorRejectInput,
  LegScheduleInput,
  SetLegOperatorInput,
  SetRouteWeeklyScheduleInput,
  ShippingProviderProfileInput,
  ShippingProviderProfileUpdateInput,
} from '@bmpl/validation';
import type { Prisma, ShippingProviderProfile } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SCHEDULABLE_LEG_STATUSES, ShipmentService } from './shipment.service';
import { LogisticsNetworkService } from './logistics-network.service';
import {
  assertOperableProvider,
  assertProviderContinuationAllowed,
  assertProviderOperableStatus,
  providerEligibilityReasons,
  providerStatusEligibilityReasons,
} from './provider-eligibility';

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
    private readonly notifications: NotificationsService,
    private readonly shipments: ShipmentService,
    private readonly network: LogisticsNetworkService,
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
    // isTest is never REQUEST input. At CREATE it is DERIVED from the creating
    // account (BMPL-161): the OWNER membership is born with the profile, and
    // the member/org boundary rule below would otherwise be violated at birth —
    // a test account would create a REAL org and hold real work tomorrow.
    // On update the flag is untouched (admin flips it thereafter, as before).
    const creator = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { isTest: true } });
    const p = await this.prisma.$transaction(async (tx) => {
      const profile = await tx.shippingProviderProfile.upsert({
        where: { userId },
        create: { userId, isTest: creator.isTest, ...data },
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

  /**
   * MDF-COURIER D5 — the ONE self-service status transition. May leave
   * REJECTED only, and only to PENDING: not an escalation, since PENDING
   * carries zero operational privilege, so resubmission gains the carrier
   * nothing but a fresh review. Refused at this SERVICE layer for every
   * other status — `canChangeProviderStatus` has no CARRIER-actor edge out
   * of SUSPENDED or REVOKED at all, so there is no bypass to find here, not
   * merely a hidden button in a UI.
   */
  async resubmit(userId: string) {
    const profile = await this.prisma.shippingProviderProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Start your carrier application first.');
    if (!canChangeProviderStatus('RESUBMIT', profile.status)) {
      throw new BadRequestException(`A carrier application cannot be resubmitted from ${profile.status.toLowerCase()}.`);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.shippingProviderProfile.update({
        where: { id: profile.id },
        data: { status: providerStatusTarget('RESUBMIT'), statusReason: null, statusChangedAt: new Date() },
      });
      await this.audit.record(
        {
          action: 'SHIPPING_PROVIDER_STATUS_CHANGED',
          actorId: userId,
          targetUserId: userId,
          previousValue: { providerProfileId: profile.id, status: profile.status },
          newValue: { providerProfileId: profile.id, status: row.status, verb: 'RESUBMITTED', actorType: 'CARRIER' },
        },
        tx,
      );
      return row;
    });
    return this.serializeProfile(updated);
  }

  /* ---- operational status lifecycle (admin; MDF-COURIER D1/D5) ----------- */

  /**
   * One private transition for every admin action in
   * SHIPPING_PROVIDER_STATUS_ACTIONS — mirrors AdminService.changeRoleStatus:
   * the public methods below are named for the action so a caller never
   * passes an arbitrary target status, and the legality of the edge is
   * checked against the shared table (packages/shared/src/
   * shipping-provider-status.ts), never re-derived here.
   */
  private async transitionStatus(action: ShippingProviderStatusAction, actorId: string, providerProfileId: string, reason?: string) {
    const profile = await this.prisma.shippingProviderProfile.findUnique({ where: { id: providerProfileId } });
    if (!profile) throw new NotFoundException('That carrier does not exist.');
    if (!canChangeProviderStatus(action, profile.status)) {
      throw new BadRequestException(`A carrier cannot move from ${profile.status.toLowerCase()} via ${action}.`);
    }
    const to = providerStatusTarget(action);
    // D5: REJECTED/SUSPENDED/REVOKED need a reason the carrier can see —
    // required here, not merely encouraged, because statusReason is the
    // ONLY place that reason is ever shown back to them. REINSTATE is the
    // one addition that does NOT read off its target status (APPROVED is
    // never otherwise reason-required): god's ruling (2026-11-04,
    // MDF-500/MDF-524) — lifting a suspension needs the same audit
    // treatment as suspending it, not a silent flag flip. The controller's
    // Zod schema already enforces this on the only live caller; checked
    // again here, by name rather than by target, as defense in depth for
    // any future caller that reaches this method directly.
    if (((to === 'REJECTED' || to === 'SUSPENDED' || to === 'REVOKED') || action === 'REINSTATE') && !reason?.trim()) {
      throw new BadRequestException('A reason is required.');
    }
    const carrierVisibleReason = to === 'REJECTED' || to === 'SUSPENDED' || to === 'REVOKED' ? reason!.trim() : null;
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.shippingProviderProfile.update({
        where: { id: providerProfileId },
        data: { status: to, statusReason: carrierVisibleReason, statusChangedAt: new Date() },
      });
      await this.audit.record(
        {
          action: 'SHIPPING_PROVIDER_STATUS_CHANGED',
          actorId,
          targetUserId: profile.userId,
          previousValue: { providerProfileId, status: profile.status },
          newValue: { providerProfileId, status: to, verb: action, actorType: 'ADMIN' },
          reason: reason ?? null,
        },
        tx,
      );
      return row;
    });
    // Same type as the generic role-status notifications (ROLE_STATUS /
    // ROLE_STATUS_CHANGED) — this is the same kind of event (an org's
    // standing changed), just for the D1 column rather than UserRole.
    await this.notifications.notifyUsers([profile.userId], {
      type: 'ROLE_STATUS',
      event: 'SHIPPING_PROVIDER_STATUS_CHANGED',
      title: `Your carrier application is now ${to.toLowerCase()}`,
      body: carrierVisibleReason ?? `An administrator moved your carrier status to ${to.toLowerCase()}.`,
      data: { providerProfileId, status: to },
    });
    return this.serializeProfile(updated);
  }

  approveProvider(actorId: string, providerProfileId: string, note?: string) {
    return this.transitionStatus('APPROVE', actorId, providerProfileId, note);
  }
  rejectProvider(actorId: string, providerProfileId: string, reason: string) {
    return this.transitionStatus('REJECT', actorId, providerProfileId, reason);
  }
  suspendProvider(actorId: string, providerProfileId: string, reason: string) {
    return this.transitionStatus('SUSPEND', actorId, providerProfileId, reason);
  }
  reinstateProvider(actorId: string, providerProfileId: string, note?: string) {
    return this.transitionStatus('REINSTATE', actorId, providerProfileId, note);
  }
  revokeProvider(actorId: string, providerProfileId: string, reason: string) {
    return this.transitionStatus('REVOKE', actorId, providerProfileId, reason);
  }
  reopenProvider(actorId: string, providerProfileId: string, note?: string) {
    return this.transitionStatus('REOPEN', actorId, providerProfileId, note);
  }
  reapplyProvider(actorId: string, providerProfileId: string, note?: string) {
    return this.transitionStatus('REAPPLY', actorId, providerProfileId, note);
  }

  /**
   * D4 — the read-only "why is this carrier ineligible" preview the owner
   * required. Every ACTIVE provider org on the leg's own side of the
   * simulation boundary, each with its full list of failed-gate reasons
   * (empty = eligible) — never a flat boolean, and never silently dropping
   * an ineligible org from the list the way a pure eligible-pool query
   * would, because the admin needs exactly the ones that fail and why.
   */
  async eligibleOperatorsForLeg(legId: string) {
    const leg = await this.prisma.shipmentLeg.findUnique({
      where: { id: legId },
      select: { id: true, kind: true, shipment: { select: { isTest: true } } },
    });
    if (!leg) throw new NotFoundException('Leg not found.');
    if (leg.kind !== 'LINE_HAUL') {
      throw new BadRequestException('Only a transport leg has a carrier operator. Courier legs are worked by BML drivers.');
    }
    const orgs = await this.prisma.shippingProviderProfile.findMany({
      where: { isTest: leg.shipment.isTest },
      orderBy: { businessName: 'asc' },
      select: {
        id: true,
        isActive: true,
        isTest: true,
        businessName: true,
        status: true,
        user: { select: { roles: { where: { roleCode: 'SHIPPING_PROVIDER' }, select: { status: true } } } },
      },
    });
    return orgs.map((p) => {
      const reasons = providerEligibilityReasons(p, leg.shipment.isTest);
      return { providerProfileId: p.id, businessName: p.businessName, eligible: reasons.length === 0, reasons };
    });
  }

  /* ---- membership (admin-managed, phase 1) ------------------------------- */

  /**
   * The carrier directory for the console: pick an operator, manage its
   * staff.
   *
   * MDF-500 (Oscar, admin console): `status`/`statusReason` already told a
   * reader WHAT this org's own status is; `statusGateEligible`/
   * `statusGateReason` now tell it whether that status (AND-gated with the
   * org's SHIPPING_PROVIDER role status, D1b) currently blocks new work —
   * the one eligibility gate Oscar's console could not compute client-side
   * the way it already does for `isActive`/`isTest`. Deliberately NOT the
   * full `providerEligibilityReasons` (which needs a per-shipment isTestWork
   * side this directory-level list doesn't have, and would otherwise leak
   * the isActive/isTest reasons this already covers by other fields).
   */
  async listProviders() {
    const rows = await this.prisma.shippingProviderProfile.findMany({
      orderBy: [{ isActive: 'desc' }, { businessName: 'asc' }],
      include: {
        _count: { select: { members: { where: { status: 'ACTIVE' } } } },
        user: { select: { roles: { where: { roleCode: 'SHIPPING_PROVIDER' }, select: { status: true } } } },
      },
      take: 200,
    });
    return rows.map((p) => {
      const [statusGateReason] = providerStatusEligibilityReasons(p);
      return { ...this.serializeProfile(p), activeMembers: p._count.members, statusGateEligible: !statusGateReason, statusGateReason: statusGateReason ?? null };
    });
  }

  /**
   * MDF-500 (Oscar, admin console): the read half of addMember/endMember —
   * ANY carrier's current roster, by id, not just the caller's own
   * (`myMembers` below is the self-service, ownership-scoped equivalent).
   * Oscar deliberately refused to ship a write-only "add member" control
   * with no visible roster to confirm against — the same free-text-with-
   * no-confirmation hazard the wallet cards were corrected away from. Same
   * `logistics.manage` permission as the writes it mirrors, not the
   * coarser `logistics.read` `listProviders` already uses (which only
   * exposes an active-member COUNT) — reading WHO currently acts for an
   * org is the same sensitivity as changing it.
   */
  async listMembers(providerProfileId: string) {
    const profile = await this.prisma.shippingProviderProfile.findUnique({ where: { id: providerProfileId }, select: { id: true } });
    if (!profile) throw new NotFoundException('That carrier does not exist.');
    const rows = await this.prisma.shippingProviderMember.findMany({
      where: { providerProfileId, status: 'ACTIVE' },
      orderBy: [{ memberRole: 'asc' }, { createdAt: 'asc' }],
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
    });
    // Richer than `serializeMember`/`myMembers` on purpose: an admin roster
    // exists so staff can recognize WHO holds a membership before ending
    // it, the same reason `admin/users` search returns a name rather than
    // a bare id — a raw userId told the admin console nothing to confirm
    // against. Matches the admin console's (Oscar, MDF-524) own shape;
    // arbitrary either way, so this side matched his already-working code.
    return rows.map((m) => ({
      userId: m.userId,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      email: m.user.email,
      memberRole: m.memberRole,
      status: m.status,
      startedAt: m.createdAt,
      endedAt: m.endedAt,
    }));
  }

  async addMember(actorId: string, providerProfileId: string, dto: AddProviderMemberInput) {
    const profile = await this.prisma.shippingProviderProfile.findUnique({ where: { id: providerProfileId } });
    if (!profile) throw new NotFoundException('That carrier does not exist.');
    const user = await this.prisma.user.findUnique({ where: { id: dto.userId }, select: { id: true, isTest: true } });
    if (!user) throw new NotFoundException('That account does not exist.');
    // The simulation boundary one level up (BMPL-161): the PERSON must sit on
    // the org's side, refused symmetrically — the same house rule the org
    // itself faces when work is assigned. Checked on reactivation too: it is
    // the same membership-creation moment.
    if (profile.isTest && !user.isTest) {
      throw new BadRequestException('A real account cannot join a simulation carrier.');
    }
    if (!profile.isTest && user.isTest) {
      throw new BadRequestException('A test account cannot join a real carrier.');
    }

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
   * Admin PROPOSES (or clears, with null) the carrier ORGANIZATION operating
   * a transport leg. Validation lives with the facts: LINE_HAUL only, not
   * finished, and the org active + approved + on the shipment's side of the
   * simulation boundary.
   *
   * MDF-COURIER D2/D3: this is a PROPOSAL, not a unilateral assignment — the
   * carrier must still accept (acceptLeg) before the leg is truly theirs.
   * Every (re)proposal resets both consent columns to null, so a fresh
   * offer always starts "awaiting response" again, never carrying over a
   * stale accept/reject from whoever held the leg before.
   *
   * D2's idempotency, chosen instead of a new key table: a conditional
   * `updateMany` compare-and-set, guarded on the operatedByProviderId this
   * call actually READ. A duplicate submission of the exact same request
   * (same new value, same prior value) is a no-op that still reports
   * success; a conflicting request — the leg moved under it, e.g. another
   * admin proposed someone else first — fails loudly with 409 rather than
   * silently overwriting. No separate uniqueness constraint is needed
   * beyond this: operatedByProviderId is already a single nullable column,
   * so "at most one live assignment" is structural, not something a second
   * constraint could add.
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
    // Repeating the EXACT same proposal is a no-op success (D2); anything
    // else requires the leg to still hold what we just read.
    if (leg.operatedByProviderId !== input.providerProfileId) {
      const claimed = await this.prisma.shipmentLeg.updateMany({
        where: { id: leg.id, operatedByProviderId: leg.operatedByProviderId },
        data: { operatedByProviderId: input.providerProfileId, operatorAcceptedAt: null, operatorRejectedAt: null },
      });
      if (claimed.count === 0) {
        throw new ConflictException('This leg already has a different operator proposal in flight — reload and try again.');
      }
      await this.audit.record({
        action: 'SHIPMENT_LEG_OPERATOR_ASSIGNED',
        actorId,
        previousValue: { legId: leg.id, operatedByProviderId: leg.operatedByProviderId },
        newValue: { legId: leg.id, shipmentId: leg.shipment.id, reference: leg.shipment.reference, operatedByProviderId: input.providerProfileId },
      });
    }
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

  /**
   * Self-service member management (owner-only, MDF-COURIER self-service
   * scope): "lift the admin-only constraint for a provider's OWN
   * membership only — ownership check, not a role bypass." A STAFF member
   * may work the org's legs/routes (myOrgIds above), but only the OWNER row
   * may add or end anyone else — the same asymmetry addMember/endMember
   * already enforce for the admin door, now enforced here for who may walk
   * through the self-service one at all.
   */
  private async myOwnedOrgId(userId: string): Promise<string> {
    const row = await this.prisma.shippingProviderMember.findFirst({
      where: { userId, status: 'ACTIVE', memberRole: 'OWNER', providerProfile: { isActive: true } },
      select: { providerProfileId: true },
    });
    if (!row) throw new ForbiddenException('Only an organization owner may manage its members.');
    return row.providerProfileId;
  }

  /** Current members only — an ended one is history, not membership, the
   *  same "current state" convention myOrgIds and listProviders' active
   *  member count already use. */
  async myMembers(userId: string) {
    const providerProfileId = await this.myOwnedOrgId(userId);
    const rows = await this.prisma.shippingProviderMember.findMany({
      where: { providerProfileId, status: 'ACTIVE' },
      orderBy: [{ memberRole: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((m) => this.serializeMember(m));
  }

  /** Delegates to the SAME write `addMember` uses — one implementation, the
   *  admin controller and this self-service one just resolve providerProfileId
   *  differently (an :id path param there, the caller's OWN org here). */
  async addMyMember(userId: string, dto: AddProviderMemberInput) {
    const providerProfileId = await this.myOwnedOrgId(userId);
    return this.addMember(userId, providerProfileId, dto);
  }

  async endMyMember(userId: string, targetUserId: string) {
    const providerProfileId = await this.myOwnedOrgId(userId);
    return this.endMember(userId, providerProfileId, targetUserId);
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
  // MDF-500 — the owner's final ruling (2026-11-04): a SUSPENDED org may
  // still depart/arrive a leg it already accepted before the status change
  // (an ordinary administrative hold must not strand a real shipment
  // mid-journey for a real customer); a REVOKED org may not — revocation is
  // a security/safety cutoff, and an administrator must be able to prevent
  // further carrier access immediately. assertProviderContinuationAllowed
  // is the owner's answer, applied identically here and to schedule().
  // Do not "fix" this by writing isActive=false on suspend/revoke — that
  // overloads a flag that means something else everywhere else in this
  // file and would strand a leg accidentally rather than route it to
  // administrative recovery on purpose.
  async depart(userId: string, legId: string, input: LegDepartInput) {
    const providerProfileId = await this.assertMyAcceptedLeg(userId, legId);
    await assertProviderContinuationAllowed(this.prisma, providerProfileId);
    await this.shipments.departLeg(legId, input, { userId });
    return this.myLeg(userId, legId);
  }

  async arrive(userId: string, legId: string) {
    const providerProfileId = await this.assertMyAcceptedLeg(userId, legId);
    await assertProviderContinuationAllowed(this.prisma, providerProfileId);
    await this.shipments.arriveLeg(legId, { userId });
    return this.myLeg(userId, legId);
  }

  /**
   * MDF-COURIER D3 — mutual consent. setLegOperator only PROPOSES; this is
   * the carrier's own acceptance of that proposal. `assertMyLeg` already
   * refuses a leg this org does not hold (404, not 403 — cross-org probing
   * learns nothing), so the only thing left to check is that there is a
   * live, unanswered proposal at all.
   */
  async acceptLeg(userId: string, legId: string) {
    await this.assertMyLeg(userId, legId);
    const leg = await this.prisma.shipmentLeg.findUniqueOrThrow({
      where: { id: legId },
      select: { id: true, operatedByProviderId: true, operatorAcceptedAt: true, operatorRejectedAt: true, shipment: { select: { id: true, reference: true } } },
    });
    if (leg.operatorAcceptedAt) throw new BadRequestException('This leg was already accepted.');
    if (leg.operatorRejectedAt) throw new BadRequestException('This leg was already rejected and is no longer yours to accept.');
    // MDF-500 security fix: accepting is a NEW commitment, not a
    // continuation of one already made. assertMyLeg above proves OWNERSHIP
    // only — a SUSPENDED/REVOKED org's isActive is untouched by design, so
    // it would otherwise keep passing assertMyLeg and be able to accept a
    // proposal it should never have been able to take on.
    await assertProviderOperableStatus(this.prisma, leg.operatedByProviderId!);
    const claimed = await this.prisma.shipmentLeg.updateMany({
      where: { id: leg.id, operatedByProviderId: leg.operatedByProviderId, operatorAcceptedAt: null, operatorRejectedAt: null },
      data: { operatorAcceptedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new ConflictException('This leg changed before the acceptance could be recorded — reload and try again.');
    }
    await this.audit.record({
      action: 'SHIPMENT_LEG_OPERATOR_ACCEPTED',
      actorId: userId,
      previousValue: { legId: leg.id, operatorAcceptedAt: null },
      newValue: { legId: leg.id, shipmentId: leg.shipment.id, reference: leg.shipment.reference, operatedByProviderId: leg.operatedByProviderId },
    });
    return this.myLeg(userId, legId);
  }

  /**
   * MDF-COURIER D3 — the other half of mutual consent, and the owner's
   * named risk area: a rejected assignment MUST NOT silently advance the
   * shipment. This clears operatedByProviderId back to null (the leg
   * returns to unassigned, exactly like declining a courier job returns a
   * delivery to the dispatch pool) and alerts operations — it does NOT set
   * the leg's own `status` to EXCEPTION. `flagException`/`resolveException`
   * are the customer/driver-facing hold-and-resume machinery for a problem
   * with the PARCEL; nothing is wrong with the parcel here, only with who
   * is carrying it, so the leg stays exactly as actionable as it was and
   * simply needs a NEW operator proposed — the same shape W4's
   * "no eligible driver available" escalation already uses for courier legs
   * with nobody to carry them.
   *
   * MDF-500 security review: NOT status-gated, deliberately. Rejecting —
   * giving a proposal BACK — is not a new commitment the way accepting is;
   * there is nothing here for a suspended/revoked org to be refused. A
   * revoked carrier giving up work it was never going to fulfil is the
   * behaviour this exists for, not a hole.
   */
  async rejectLeg(userId: string, legId: string, input: LegOperatorRejectInput) {
    await this.assertMyLeg(userId, legId);
    const leg = await this.prisma.shipmentLeg.findUniqueOrThrow({
      where: { id: legId },
      select: {
        id: true,
        operatedByProviderId: true,
        operatorAcceptedAt: true,
        operatorRejectedAt: true,
        shipment: { select: { id: true, reference: true } },
      },
    });
    if (leg.operatorRejectedAt) throw new BadRequestException('This leg was already rejected.');
    // Reject answers a PROPOSAL. Once accepted, this org has already
    // committed — backing out from there is an exception/cancellation, not
    // a rejection of an offer that no longer exists. Keeps the write path
    // agreeing with providerLegOut's own canReject flag, which already
    // goes false the instant operatorAcceptedAt is set.
    if (leg.operatorAcceptedAt) throw new BadRequestException('This leg was already accepted; it can no longer be rejected.');
    const claimed = await this.prisma.shipmentLeg.updateMany({
      where: { id: leg.id, operatedByProviderId: leg.operatedByProviderId, operatorAcceptedAt: null, operatorRejectedAt: null },
      data: { operatedByProviderId: null, operatorAcceptedAt: null, operatorRejectedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new ConflictException('This leg changed before the rejection could be recorded — reload and try again.');
    }
    await this.audit.record({
      action: 'SHIPMENT_LEG_OPERATOR_REJECTED',
      actorId: userId,
      previousValue: { legId: leg.id, operatedByProviderId: leg.operatedByProviderId },
      newValue: { legId: leg.id, shipmentId: leg.shipment.id, reference: leg.shipment.reference, operatedByProviderId: null },
      reason: input.reason,
    });
    await this.notifications.notifyAdmins('logistics.read', {
      type: 'SECURITY',
      category: 'ADMIN_ALERT',
      event: 'SHIPMENT_LEG_OPERATOR_REJECTED',
      title: `Shipment ${leg.shipment.reference} needs a new carrier`,
      body: input.reason,
      data: { legId: leg.id, shipmentId: leg.shipment.id, reference: leg.shipment.reference },
    });
    // Returns the CALLER's own leg shape one more time, for symmetry with
    // every other provider action — but the leg no longer belongs to their
    // org, so this is necessarily the last time they can read it this way.
    const after = await this.prisma.shipmentLeg.findUniqueOrThrow({ where: { id: legId }, include: PROVIDER_LEG_INCLUDE });
    return this.providerLegOut(after);
  }

  /**
   * BMPL-346: the carrier's own commitment for their leg's departure and/or
   * arrival — same ownership gate as depart/arrive, same underlying writer
   * the admin desk uses (`ShipmentService.scheduleLeg`).
   *
   * MDF-500 — the owner's final ruling (2026-11-04) resolved the flag this
   * comment used to carry: `schedule()` IS covered by the depart/arrive
   * answer, explicitly, because it runs through the same `assertMyAcceptedLeg`
   * gate on a leg this org already holds, and a carrier permitted to
   * depart/arrive a leg must be able to state when — stating a time on work
   * it may legally perform is part of performing it, not a new commitment.
   * Same continuation gate as depart/arrive: SUSPENDED may still schedule an
   * already-accepted leg, REVOKED may not.
   */
  async schedule(userId: string, legId: string, input: LegScheduleInput) {
    const providerProfileId = await this.assertMyAcceptedLeg(userId, legId);
    await assertProviderContinuationAllowed(this.prisma, providerProfileId);
    await this.shipments.scheduleLeg(legId, input, { userId });
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

  /**
   * MDF-COURIER D3: depart/arrive/schedule assume the org is actually
   * executing on a leg it has consented to. `assertMyLeg` alone is not
   * enough post-D3 — ownership and consent are two different questions
   * (BMPL-137's own precedent for why "is X active" and "may X act" need
   * separate checks) — a leg can be this org's OWN leg (operatedByProviderId
   * matches) while still being an unanswered proposal. Enforced here, not
   * only in the `canDepart`/`canArrive`/`canSchedule` read-side flags, which
   * are advisory for the UI and would otherwise be the only thing stopping
   * a direct POST. Returns the validated providerProfileId (additive —
   * MDF-500, same pattern as `assertMyRoute`'s own return value) so
   * depart/arrive/schedule can run the continuation status gate without a
   * second fetch.
   */
  private async assertMyAcceptedLeg(userId: string, legId: string): Promise<string> {
    const orgIds = await this.myOrgIds(userId);
    const leg = await this.prisma.shipmentLeg.findUnique({
      where: { id: legId },
      select: { operatedByProviderId: true, operatorAcceptedAt: true, operatorRejectedAt: true },
    });
    if (!leg || !leg.operatedByProviderId || !orgIds.includes(leg.operatedByProviderId)) {
      throw new NotFoundException('Leg not found.');
    }
    if (!leg.operatorAcceptedAt) {
      throw new BadRequestException('Accept this leg before recording its departure, arrival or schedule.');
    }
    return leg.operatedByProviderId;
  }

  /* ---- the carrier's own route schedule (BMPL-186) ------------------------ */

  /** Every route the standing operator on this route is one of my organizations. */
  async myRoutes(userId: string) {
    const orgIds = await this.myOrgIds(userId);
    const routes = await this.prisma.logisticsRoute.findMany({
      where: { operatedByProviderId: { in: orgIds } },
      orderBy: { id: 'asc' },
      include: {
        originHub: { select: { id: true, code: true, name: true, city: true } },
        destinationHub: { select: { id: true, code: true, name: true, city: true } },
      },
    });
    return routes.map((r) => ({
      id: r.id,
      mode: r.mode,
      isActive: r.isActive,
      scheduleNote: r.scheduleNote,
      origin: { id: r.originHub.id, code: r.originHub.code, name: r.originHub.name, city: r.originHub.city },
      destination: { id: r.destinationHub.id, code: r.destinationHub.code, name: r.destinationHub.name, city: r.destinationHub.city },
    }));
  }

  /**
   * MDF-526: the self-service list a carrier claims FROM. Without this,
   * `claimRoute` is only reachable by already knowing a route id — there was
   * no read a carrier could use to discover one.
   *
   * Gated by the SAME AND-gate `claimRoute` itself enforces via
   * `assertOperableProvider` (status === APPROVED, AND-ed with the generic
   * SHIPPING_PROVIDER role status) — claiming is a NEW commitment, exactly
   * like accepting a leg proposal, so a SUSPENDED or REVOKED org must not
   * even be able to enumerate what's newly claimable (god's ruling,
   * 2026-11-04). `statusGateEligible`/`statusGateReason` name is deliberately
   * the same one `listProviders` already uses for the identical AND-gate —
   * one vocabulary for "why can't this org take new work," not a second one
   * invented here. Eligible if ANY of the caller's orgs currently passes the
   * gate (the common case is exactly one); `routes` is empty whenever none
   * do, so nothing new is disclosed to an org that cannot act on it anyway.
   *
   * `isActive`/unassigned/`isTest`-matching stay the base filter regardless —
   * this is read-only and advisory. It must never become a read-then-write
   * that pre-reserves a row: `claimRoute`'s own `updateMany` CAS, tested
   * under real concurrency (5 racers -> [201,409,409,409,409]), remains the
   * only authority on who actually gets a route.
   */
  async availableRoutes(userId: string) {
    const orgIds = await this.myOrgIds(userId);
    const profiles = await this.prisma.shippingProviderProfile.findMany({
      where: { id: { in: orgIds } },
      select: {
        isTest: true,
        status: true,
        user: { select: { roles: { where: { roleCode: 'SHIPPING_PROVIDER' }, select: { status: true } } } },
      },
    });
    let statusGateReason: string | null = null;
    const statusGateEligible = profiles.some((p) => {
      const [reason] = providerStatusEligibilityReasons(p);
      if (!reason) return true;
      statusGateReason ??= reason;
      return false;
    });
    if (!statusGateEligible) {
      return { statusGateEligible: false, statusGateReason: statusGateReason ?? 'organization not eligible to take new work', routes: [] };
    }
    const isTest = profiles[0]!.isTest;
    const routes = await this.prisma.logisticsRoute.findMany({
      where: { operatedByProviderId: null, isActive: true, isTest },
      orderBy: { id: 'asc' },
      include: {
        originHub: { select: { id: true, code: true, name: true, city: true } },
        destinationHub: { select: { id: true, code: true, name: true, city: true } },
      },
    });
    return {
      statusGateEligible: true,
      statusGateReason: null,
      routes: routes.map((r) => ({
        id: r.id,
        mode: r.mode,
        isActive: r.isActive,
        scheduleNote: r.scheduleNote,
        origin: { id: r.originHub.id, code: r.originHub.code, name: r.originHub.name, city: r.originHub.city },
        destination: { id: r.destinationHub.id, code: r.destinationHub.code, name: r.destinationHub.name, city: r.destinationHub.city },
      })),
    };
  }

  /**
   * MDF-COURIER self-service scope: "service areas / routes". A carrier
   * CLAIMS an EXISTING, currently-UNASSIGNED route — never creates one, and
   * never touches its price or mode. Those stay admin-entered business
   * configuration (root CLAUDE.md §5); THIS method only records who may now
   * operate infrastructure that already exists, the same boundary
   * `setLegOperator` already draws for a single leg.
   *
   * "Schedule" is deliberately left off that list — a carrier's weekly
   * schedule and date exceptions ARE self-service (`setMyRouteWeeklySchedule`/
   * `addMyRouteScheduleException`/`removeMyRouteScheduleException` below),
   * and that data feeds the pre-existing BMPL-186/196 planner path a real
   * customer quote runs through (`LogisticsNetworkService.plannerInputs` ->
   * `route-planner.ts`'s `cheapestPath`/`routeRunsOn` -> `ShipmentService.
   * quote()`): it can change which route — and therefore which price — is
   * offered on a requested date, or make the journey unavailable. See the
   * MDF-528 migration comment (`packages/database`) for the full trace; whether a
   * carrier should be allowed to move this is a business ruling, not an
   * engineering one, and is open on the owner board.
   *
   * `providerProfileId` is resolved from the caller when they belong to
   * exactly one org (the common case — born as OWNER of their own); it is
   * only required in the input when genuinely ambiguous. Any ACTIVE member
   * may claim on behalf of their org, not owner-only — this is an
   * operational act like depart/arrive/schedule, not a membership change.
   *
   * MDF-500 security review: already correctly status-gated below via
   * assertOperableProvider — test-confirmed safe (a PENDING/SUSPENDED/
   * REVOKED org claiming here gets 400, every time). No change needed;
   * noted so MDF-500-carrier-review.md's write-up has one real line per
   * method, not a guess.
   */
  async claimRoute(userId: string, routeId: string, input: ClaimRouteOperatorInput) {
    const providerProfileId = await this.resolveMyOrgId(userId, input.providerProfileId);
    const route = await this.prisma.logisticsRoute.findUnique({
      where: { id: routeId },
      select: { id: true, operatedByProviderId: true, isActive: true, isTest: true },
    });
    if (!route) throw new NotFoundException('Route not found.');
    if (!route.isActive) throw new BadRequestException('This route is not active.');
    if (route.operatedByProviderId) {
      throw new BadRequestException(route.operatedByProviderId === providerProfileId ? 'Your organization already operates this route.' : 'This route already has an operator.');
    }
    await assertOperableProvider(this.prisma, providerProfileId, route.isTest);
    const claimed = await this.prisma.logisticsRoute.updateMany({
      where: { id: routeId, operatedByProviderId: null },
      data: { operatedByProviderId: providerProfileId },
    });
    if (claimed.count === 0) throw new ConflictException('Another carrier just claimed this route — reload and try again.');
    await this.audit.record({
      action: 'LOGISTICS_ROUTE_OPERATOR_CHANGED',
      actorId: userId,
      previousValue: { routeId, operatedByProviderId: null },
      newValue: { routeId, operatedByProviderId: providerProfileId, verb: 'CLAIMED' },
    });
    return this.myRoutes(userId);
  }

  /** The reverse: a carrier gives up a route it currently operates. Scoped
   *  by assertMyRoute exactly like depart/arrive/schedule — a 404 on a
   *  cross-org id, never a 403 that would confirm the route exists.
   *
   *  MDF-500 security review: NOT status-gated, deliberately — god's
   *  explicit ruling. A revoked carrier GIVING UP a route is arguably the
   *  behaviour wanted, not a hole; there is no new commitment here to
   *  refuse. */
  async releaseRoute(userId: string, routeId: string) {
    const orgIds = await this.myOrgIds(userId);
    const route = await this.prisma.logisticsRoute.findUnique({ where: { id: routeId }, select: { operatedByProviderId: true } });
    if (!route || !route.operatedByProviderId || !orgIds.includes(route.operatedByProviderId)) {
      throw new NotFoundException('Route not found.');
    }
    const released = await this.prisma.logisticsRoute.updateMany({
      where: { id: routeId, operatedByProviderId: route.operatedByProviderId },
      data: { operatedByProviderId: null },
    });
    if (released.count === 0) throw new ConflictException('This route changed before it could be released — reload and try again.');
    await this.audit.record({
      action: 'LOGISTICS_ROUTE_OPERATOR_CHANGED',
      actorId: userId,
      previousValue: { routeId, operatedByProviderId: route.operatedByProviderId },
      newValue: { routeId, operatedByProviderId: null, verb: 'RELEASED' },
    });
    return this.myRoutes(userId);
  }

  /** Resolves which of the caller's orgs an ambiguous self-service action
   *  applies to: the explicit id if given (membership-checked), or the
   *  caller's own org when they belong to exactly one. */
  private async resolveMyOrgId(userId: string, explicit: string | undefined): Promise<string> {
    const orgIds = await this.myOrgIds(userId);
    if (explicit) {
      if (!orgIds.includes(explicit)) throw new ForbiddenException('Not a member of that organization.');
      return explicit;
    }
    if (orgIds.length > 1) throw new BadRequestException('You belong to more than one organization — specify providerProfileId.');
    return orgIds[0]!;
  }

  async myRouteSchedule(userId: string, routeId: string) {
    await this.assertMyRoute(userId, routeId);
    return this.network.routeSchedule(routeId);
  }

  // MDF-500 security fix: setting/changing a route's own weekly schedule or
  // exceptions is a NEW commitment about future service, not a continuation
  // of work already underway — assertMyRoute proves OWNERSHIP only, so a
  // SUSPENDED/REVOKED org (isActive untouched by design) must be refused
  // here by status, the same AND-gate claimRoute already applies to a new
  // claim.
  async setMyRouteWeeklySchedule(userId: string, routeId: string, input: SetRouteWeeklyScheduleInput) {
    const providerProfileId = await this.assertMyRoute(userId, routeId);
    await assertProviderOperableStatus(this.prisma, providerProfileId);
    return this.network.setWeeklySchedule(routeId, input, userId);
  }

  async addMyRouteScheduleException(userId: string, routeId: string, input: AddRouteScheduleExceptionInput) {
    const providerProfileId = await this.assertMyRoute(userId, routeId);
    await assertProviderOperableStatus(this.prisma, providerProfileId);
    return this.network.addScheduleException(routeId, input, userId);
  }

  async removeMyRouteScheduleException(userId: string, routeId: string, exceptionId: string) {
    const providerProfileId = await this.assertMyRoute(userId, routeId);
    await assertProviderOperableStatus(this.prisma, providerProfileId);
    return this.network.removeScheduleException(routeId, exceptionId, userId);
  }

  /**
   * 404 on a cross-org route id, exactly like assertMyLeg: a carrier probing
   * a route id that is real but not theirs learns nothing more than if it did
   * not exist. This is the ONE check that makes the whole schedule surface
   * safe - every method above calls it before touching a row. Returns the
   * validated providerProfileId (additive — existing void-ignoring callers
   * are unaffected) so a write method that also needs the MDF-500 status
   * gate does not have to re-fetch the route a second time.
   */
  private async assertMyRoute(userId: string, routeId: string): Promise<string> {
    const orgIds = await this.myOrgIds(userId);
    const route = await this.prisma.logisticsRoute.findUnique({ where: { id: routeId }, select: { operatedByProviderId: true } });
    if (!route || !route.operatedByProviderId || !orgIds.includes(route.operatedByProviderId)) {
      throw new NotFoundException('Route not found.');
    }
    return route.operatedByProviderId;
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
      // D1/D5. Only ever read by the owning carrier (getProfile) or admin
      // (listProviders) — there is no customer-facing read of this model —
      // so statusReason, deliberately carrier-visible by design, carries no
      // audience leak here.
      status: p.status,
      statusReason: p.statusReason,
      statusChangedAt: p.statusChangedAt,
      canResubmit: p.status === 'REJECTED',
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
      // D3: mutual consent. Both null = a live proposal awaiting this org's
      // response — the UI's cue to show accept/reject instead of the
      // ordinary depart/arrive controls.
      operatorAcceptedAt: l.operatorAcceptedAt,
      operatorRejectedAt: l.operatorRejectedAt,
      canAccept: l.operatorAcceptedAt == null && l.operatorRejectedAt == null,
      canReject: l.operatorAcceptedAt == null && l.operatorRejectedAt == null,
      // What the operator can do right now, so the UI carries no second copy
      // of the state machine. PENDING means an earlier leg has not finished.
      // A proposal not yet accepted is not yet operable — depart/arrive stay
      // false until acceptLeg clears operatorAcceptedAt.
      canDepart: l.operatorAcceptedAt != null && (l.status === 'READY' || l.status === 'IN_PROGRESS') && l.departedAt == null,
      canArrive: l.operatorAcceptedAt != null && l.status === 'IN_PROGRESS' && l.arrivedAt == null,
      // Same "still open" set scheduleLeg itself gates on (BMPL-346) — this
      // carries no second copy of that rule, it just names it for the UI.
      canSchedule: l.operatorAcceptedAt != null && SCHEDULABLE_LEG_STATUSES.includes(l.status),
    };
  }
}
