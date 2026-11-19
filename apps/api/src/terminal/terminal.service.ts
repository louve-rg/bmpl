import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { hashPassword, hashToken, issueToken } from '@bmpl/authentication';
import { isSelfAction } from '@bmpl/authorization';
import { templates } from '@bmpl/notifications';
import type {
  AcceptTerminalInviteInput,
  AddTerminalCompanyLocationInput,
  ChangeTerminalCompanyMemberRoleInput,
  CreateTerminalCompanyInput,
  InviteTerminalCompanyMemberInput,
  UpdateTerminalCompanyInput,
} from '@bmpl/validation';
import type { Prisma, TerminalCompanyMemberRole, TerminalCompanyProfile } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — an admin-driven invite, not a login/reset link

/**
 * Terminal operations (TERM-1/TERM-3).
 *
 * Mirrors ShippingProviderService's own shape on purpose (see the schema
 * section comment above TerminalCompanyProfile): company-scoped membership,
 * reactivate-not-duplicate, scope every read/write on an ACTIVE membership
 * never on a role. The one genuinely new axis is LOCATION — every staff-facing
 * read additionally filters to the locations this specific member was granted,
 * which nothing in the carrier module needs because a carrier org has no
 * sub-location concept.
 *
 * Everything under "admin:" below requires terminals.manage/terminals.read —
 * this card is the admin-driven half. There is no self-service door yet (no
 * "a terminal manager invites their own staff" endpoint) — deliberately not
 * built this card; see the TERM-3 report for why.
 *
 * `myWorkspace` is the one staff-facing READ in this card. TERM-5 (the
 * handoff-direction reversal, built later, in ShipmentService) added the one
 * staff-facing WRITE axis this module needed: `assertStaffLocationAccess`,
 * the location-scoped gate TerminalLegsController checks before delegating
 * to ShipmentService's own completeLeg/staffReleaseToCourier. The custody,
 * handoff and PIN logic itself still lives entirely in ShipmentService —
 * this module only ever answers "does this person hold this ONE hub,"
 * never "is this code right" or "what happens to the parcel."
 */
@Injectable()
export class TerminalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /* ---- admin: companies --------------------------------------------------- */

  async createCompany(actorId: string, dto: CreateTerminalCompanyInput) {
    const company = await this.prisma.terminalCompanyProfile.create({
      data: {
        businessName: dto.businessName,
        contactEmail: dto.contactEmail,
        contactPhone: dto.contactPhone ?? null,
        isTest: dto.isTest,
      },
    });
    await this.audit.record({
      action: 'TERMINAL_COMPANY_CREATED',
      actorId,
      newValue: { terminalCompanyId: company.id, businessName: company.businessName, isTest: company.isTest },
    });
    return this.serializeCompany(company);
  }

  async listCompanies() {
    const rows = await this.prisma.terminalCompanyProfile.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map((c) => this.serializeCompany(c));
  }

  async getCompany(companyId: string) {
    const company = await this.companyOrThrow(companyId);
    const companyLocations = await this.prisma.terminalCompanyLocation.findMany({
      where: { terminalCompanyId: companyId },
      include: { hub: { select: { id: true, code: true, name: true, district: true, city: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const members = await this.prisma.terminalCompanyMember.findMany({
      where: { terminalCompanyId: companyId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        locations: { include: { location: { include: { hub: { select: { id: true, code: true, name: true } } } } } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    });
    const invites = await this.prisma.terminalCompanyInvite.findMany({
      where: { terminalCompanyId: companyId, consumedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    return {
      ...this.serializeCompany(company),
      locations: companyLocations.map((l) => this.serializeLocation(l)),
      members: members.map((m) => this.serializeMember(m)),
      pendingInvites: invites.map((i) => this.serializeInvite(i)),
    };
  }

  /**
   * TERM-6: slice 1 is not complete until a mistyped company name is
   * correctable through the product, not just at creation. `isTest` is not
   * in `dto`'s type at all (see the schema's own comment) — the simulation
   * boundary is fixed at creation, never edited after locations/members
   * already exist on one side of it.
   */
  async updateCompany(actorId: string, companyId: string, dto: UpdateTerminalCompanyInput) {
    const before = await this.companyOrThrow(companyId);
    const company = await this.prisma.terminalCompanyProfile.update({
      where: { id: companyId },
      data: {
        businessName: dto.businessName,
        contactEmail: dto.contactEmail,
        contactPhone: dto.contactPhone,
      },
    });
    await this.audit.record({
      action: 'TERMINAL_COMPANY_UPDATED',
      actorId,
      previousValue: { businessName: before.businessName, contactEmail: before.contactEmail, contactPhone: before.contactPhone },
      newValue: { terminalCompanyId: companyId, businessName: company.businessName, contactEmail: company.contactEmail, contactPhone: company.contactPhone },
    });
    return this.serializeCompany(company);
  }

  private async companyOrThrow(companyId: string): Promise<TerminalCompanyProfile> {
    const company = await this.prisma.terminalCompanyProfile.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Terminal company not found.');
    return company;
  }

  /* ---- admin: locations ---------------------------------------------------
   * The location axis TERM-1 confirmed nothing upstream modelled. */

  async addLocation(actorId: string, companyId: string, dto: AddTerminalCompanyLocationInput) {
    const company = await this.companyOrThrow(companyId);
    // Selected, not the bare row: LogisticsHub carries courierFeeMinor
    // (BigInt), which this response would otherwise try to JSON-serialize
    // straight through serializeLocation and fail with a 500 — the exact
    // reason every other hub read in this service already selects a subset.
    const hub = await this.prisma.logisticsHub.findUnique({
      where: { id: dto.hubId },
      select: { id: true, code: true, name: true, district: true, city: true, isTest: true },
    });
    if (!hub) throw new NotFoundException('Hub not found.');
    // The simulation boundary, same rule as every other logistics entity: the
    // two sides never mix.
    if (hub.isTest !== company.isTest) {
      throw new BadRequestException(
        company.isTest
          ? 'A real hub cannot be assigned to a simulation terminal company.'
          : 'A simulation hub cannot be assigned to a real terminal company.',
      );
    }
    const existing = await this.prisma.terminalCompanyLocation.findUnique({
      where: { terminalCompanyId_hubId: { terminalCompanyId: companyId, hubId: dto.hubId } },
    });
    // One row per (company, hub): re-authorizing reactivates rather than
    // growing a second row for the same pair, same convention as membership.
    const location = existing
      ? await this.prisma.terminalCompanyLocation.update({ where: { id: existing.id }, data: { isActive: true } })
      : await this.prisma.terminalCompanyLocation.create({ data: { terminalCompanyId: companyId, hubId: dto.hubId } });
    await this.audit.record({
      action: 'TERMINAL_COMPANY_LOCATION_ADDED',
      actorId,
      newValue: { terminalCompanyId: companyId, hubId: dto.hubId, locationId: location.id },
    });
    return this.serializeLocation({ ...location, hub });
  }

  async removeLocation(actorId: string, companyId: string, locationId: string) {
    const location = await this.prisma.terminalCompanyLocation.findFirst({ where: { id: locationId, terminalCompanyId: companyId } });
    if (!location) throw new NotFoundException('Location not found.');
    // Deactivate, never delete — the same "history survives, access does not"
    // rule LogisticsHub.isActive and ShippingProviderMember.endedAt follow.
    // Existing TerminalCompanyMemberLocation grant rows are left as history;
    // myWorkspace's own read re-checks location.isActive, so a deactivated
    // location stops being usable immediately without touching those rows.
    await this.prisma.terminalCompanyLocation.update({ where: { id: locationId }, data: { isActive: false } });
    await this.audit.record({
      action: 'TERMINAL_COMPANY_LOCATION_REMOVED',
      actorId,
      newValue: { terminalCompanyId: companyId, locationId },
    });
    return { removed: true };
  }

  /* ---- admin: invite — the real missing primitive ------------------------- */

  async inviteMember(actorId: string, companyId: string, dto: InviteTerminalCompanyMemberInput) {
    const company = await this.companyOrThrow(companyId);
    const locations = await this.prisma.terminalCompanyLocation.findMany({
      where: { id: { in: dto.locationIds }, terminalCompanyId: companyId, isActive: true },
    });
    if (locations.length !== dto.locationIds.length) {
      throw new BadRequestException('One or more selected locations are not active locations of this company.');
    }
    const { raw, hash, expiresAt } = issueToken(INVITE_TTL_MS);
    const invite = await this.prisma.terminalCompanyInvite.create({
      data: {
        terminalCompanyId: companyId,
        email: dto.email,
        memberRole: dto.memberRole,
        locationIds: dto.locationIds,
        tokenHash: hash,
        expiresAt,
        invitedById: actorId,
      },
    });
    // Never log or persist the raw token — the audit row records that an
    // invite was sent and to whom, exactly like SHIPMENT_HANDOFF_PIN_REVEALED
    // records that a reveal happened, never the secret itself.
    await this.audit.record({
      action: 'TERMINAL_COMPANY_MEMBER_INVITED',
      actorId,
      newValue: { terminalCompanyId: companyId, inviteId: invite.id, email: dto.email, memberRole: dto.memberRole },
    });
    const link = `${this.env.NEXT_PUBLIC_SITE_URL}/terminal/accept-invite?token=${raw}`;
    const tpl = templates.terminalInvite(link, company.businessName);
    // EmailService directly, not NotificationsService.sendEmail — the
    // invitee has no `userId` yet (that interface's own shape requires one,
    // correctly, for its other callers), and this really is "send a
    // transactional email to an address," not a notification for an
    // existing account. The dev mailbox capture lives inside
    // `EmailService.sendDetailed` itself now (MDF-709 follow-up) — this
    // flow stays observable in dev/test the same way it always was, just
    // without a fourth copy of the same capture logic.
    //
    // W8/INVITE-SILENT-FAIL: `sendDetailed`, not `send`. The boolean form
    // discarded the reason a send failed, so a provider error and a real
    // delivery both left this endpoint returning 201 with nothing to tell
    // them apart — an administrator could not see that an invitation never
    // left the building. The invite row is deliberately still committed
    // before the send (a failed provider must not cost us the invitation),
    // so the outcome travels back in the response instead.
    const delivery = await this.email.sendDetailed({ to: dto.email, subject: tpl.title, body: tpl.body });
    return { ...this.serializeInvite(invite), delivery };
  }

  /**
   * The way back from a failed send. Rotates the token (the raw one was never
   * stored and cannot be recovered — `serializeInvite` has never returned it
   * and still does not), re-sends the same invitation, and reports the real
   * outcome. Rotating rather than re-mailing the old token means a link that
   * did reach someone it should not stops working the moment an admin
   * resends, and the invite stays ONE row rather than accumulating live
   * tokens the way a second `inviteMember` call would.
   */
  async resendInvite(actorId: string, companyId: string, inviteId: string) {
    const company = await this.companyOrThrow(companyId);
    const invite = await this.prisma.terminalCompanyInvite.findFirst({ where: { id: inviteId, terminalCompanyId: companyId } });
    if (!invite) throw new NotFoundException('Invite not found.');
    if (invite.consumedAt) throw new BadRequestException('This invite was already accepted.');
    if (invite.revokedAt) throw new BadRequestException('This invite was revoked. Issue a new one instead.');
    const { raw, hash, expiresAt } = issueToken(INVITE_TTL_MS);
    const updated = await this.prisma.terminalCompanyInvite.update({
      where: { id: inviteId },
      data: { tokenHash: hash, expiresAt },
    });
    // Reuses TERMINAL_COMPANY_MEMBER_INVITED with a `resend` marker rather
    // than adding an audit action: AuditAction is a PRISMA ENUM, so a new
    // value needs a migration, and a migration would run against the
    // production database on deploy. A resend genuinely is "an invitation was
    // sent to this address", and the marker keeps the two distinguishable in
    // the trail without touching the schema.
    await this.audit.record({
      action: 'TERMINAL_COMPANY_MEMBER_INVITED',
      actorId,
      newValue: { terminalCompanyId: companyId, inviteId, email: invite.email, memberRole: invite.memberRole, resend: true },
    });
    const link = `${this.env.NEXT_PUBLIC_SITE_URL}/terminal/accept-invite?token=${raw}`;
    const tpl = templates.terminalInvite(link, company.businessName);
    const delivery = await this.email.sendDetailed({ to: invite.email, subject: tpl.title, body: tpl.body });
    return { ...this.serializeInvite(updated), delivery };
  }

  async revokeInvite(actorId: string, companyId: string, inviteId: string) {
    const invite = await this.prisma.terminalCompanyInvite.findFirst({ where: { id: inviteId, terminalCompanyId: companyId } });
    if (!invite) throw new NotFoundException('Invite not found.');
    if (invite.consumedAt) throw new BadRequestException('This invite was already accepted and cannot be revoked.');
    await this.prisma.terminalCompanyInvite.update({ where: { id: inviteId }, data: { revokedAt: new Date() } });
    await this.audit.record({ action: 'TERMINAL_COMPANY_INVITE_REVOKED', actorId, newValue: { terminalCompanyId: companyId, inviteId } });
    return { revoked: true };
  }

  /**
   * Unauthenticated — the invitee has no session yet. Creates the account
   * (or attaches to an existing one with the same email) and the scoped
   * membership + location grants atomically. Does NOT issue a session: the
   * invitee logs in afterward through the ordinary /auth/login path, same as
   * any other account. No plaintext password, no shared credential, no new
   * provider — the invitee's own password, hashed exactly like every other
   * account's.
   */
  async acceptInvite(dto: AcceptTerminalInviteInput) {
    const record = await this.prisma.terminalCompanyInvite.findUnique({ where: { tokenHash: hashToken(dto.token) } });
    if (!record || record.consumedAt || record.revokedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('This invite link is invalid or has expired.');
    }
    const company = await this.prisma.terminalCompanyProfile.findUniqueOrThrow({ where: { id: record.terminalCompanyId } });
    const existingUser = await this.prisma.user.findUnique({ where: { email: record.email } });
    if (existingUser && existingUser.isTest !== company.isTest) {
      throw new BadRequestException('This account is on the wrong side of the simulation boundary for this terminal company.');
    }
    if (!existingUser && (!dto.password || !dto.firstName || !dto.lastName)) {
      throw new BadRequestException('A password, first name and last name are required to create your account.');
    }

    return this.prisma.$transaction(async (tx) => {
      // Conditional claim, not an unconditional read-then-write — exact mirror
      // of AuthService#resetPassword's own race-closing pattern: two
      // concurrent accept requests for the same token must not both succeed.
      const claimed = await tx.terminalCompanyInvite.updateMany({
        where: { id: record.id, consumedAt: null, revokedAt: null },
        data: { consumedAt: new Date() },
      });
      if (claimed.count !== 1) {
        // MDF-727 (TERM-ACCEPT-MSG): the pre-check above already covers a
        // genuinely dead link (never existed, truly expired, or already
        // consumed/revoked as of that read) with the deliberately
        // non-committal message — an invite token must not become an
        // existence oracle, which is exactly why that case stays vague.
        // Reaching HERE means the pre-check's read saw a live, unconsumed,
        // unrevoked invite, and this transaction's OWN conditional claim
        // still lost — i.e. a second request for this exact token committed
        // first, in the race window between that read and this write. The
        // overwhelmingly common real cause is the invitee double-clicking
        // (or double-submitting) their own valid link, not an attacker
        // probing — so unlike the pre-check, THIS message can and must tell
        // the truth: whichever request wins, "already accepted" is accurate,
        // not an oracle leak, because the caller already proved they hold a
        // token that really was live a moment ago.
        //
        // Re-read rather than assume: a concurrent REVOKE landing in the same
        // narrow window would also fail this claim, and "already accepted"
        // would be a lie in that case — so this only claims it when consumedAt
        // is actually what changed; any other cause falls back to the same
        // non-committal message the pre-check uses, never a new specific lie.
        const current = await tx.terminalCompanyInvite.findUnique({ where: { id: record.id }, select: { consumedAt: true } });
        if (current?.consumedAt != null) {
          throw new BadRequestException('This invite has already been accepted. Please sign in instead.');
        }
        throw new BadRequestException('This invite link is invalid or has expired.');
      }

      const user = existingUser
        ? existingUser
        : await tx.user.create({
            data: {
              email: record.email,
              passwordHash: await hashPassword(dto.password!),
              firstName: dto.firstName!,
              lastName: dto.lastName!,
              // Derived from the invite's own company, never from the
              // invitee's request — the account is created BY this invite,
              // on whichever side of the simulation boundary the inviting
              // company is already fixed to.
              isTest: company.isTest,
              acceptedTermsAt: new Date(),
              // Receiving and using this link already proves control of the
              // address — the same inbox-ownership proof email verification
              // exists for, so there is nothing left for that flow to add.
              emailVerifiedAt: new Date(),
              // Same baseline EVERY account gets at AuthService#register —
              // a terminal invite creates an ordinary account first (CUSTOMER
              // role + empty wallet), with the terminal membership layered on
              // top of it, exactly like a carrier OWNER or a passenger driver
              // is still an ordinary account underneath their own role. A
              // roleless, walletless account would be a genuinely new shape
              // nothing else in this codebase has ever had to handle — not a
              // marketplace privilege (the wallet starts empty, and there is
              // no AdminPermissionGrant or vendor/admin role attached here).
              activeRoleCode: 'CUSTOMER',
              roles: { create: { roleCode: 'CUSTOMER', status: 'APPROVED', approvedAt: new Date() } },
              walletAccounts: { create: { type: 'USER', currency: 'BZD' } },
            },
          });

      const existingMember = await tx.terminalCompanyMember.findUnique({
        where: { terminalCompanyId_userId: { terminalCompanyId: company.id, userId: user.id } },
      });
      const member = existingMember
        ? await tx.terminalCompanyMember.update({
            where: { id: existingMember.id },
            data: { status: 'ACTIVE', endedAt: null, memberRole: record.memberRole },
          })
        : await tx.terminalCompanyMember.create({
            data: { terminalCompanyId: company.id, userId: user.id, memberRole: record.memberRole },
          });

      // Re-validate against CURRENT active locations, not the invite's
      // snapshot blindly — a location deactivated between invite and
      // acceptance must not be grantable just because it was once intended.
      const locations = await tx.terminalCompanyLocation.findMany({
        where: { id: { in: record.locationIds }, terminalCompanyId: company.id, isActive: true },
      });
      for (const loc of locations) {
        await tx.terminalCompanyMemberLocation.upsert({
          where: { memberId_locationId: { memberId: member.id, locationId: loc.id } },
          create: { memberId: member.id, locationId: loc.id },
          update: {},
        });
      }

      await this.audit.record(
        {
          action: 'TERMINAL_COMPANY_INVITE_ACCEPTED',
          actorId: user.id,
          targetUserId: user.id,
          newValue: { terminalCompanyId: company.id, memberId: member.id, locationCount: locations.length },
        },
        tx,
      );
      // TERM-INVITE-COPY: the invite's own role, read-only, so the frontend's
      // success copy can say "manager" or "operator" correctly instead of a
      // role-blind "you were invited to manage a terminal company" that told
      // an OPERATOR they held a permission the Staff tab then 403s them for.
      // Nothing about the accept flow, token handling or membership write
      // above changes — this is one more field on the same return value.
      return { accepted: true as const, createdAccount: !existingUser, memberRole: member.memberRole };
    });
  }

  /* ---- admin: end member --------------------------------------------------- */

  async endMember(actorId: string, companyId: string, userId: string) {
    const existing = await this.prisma.terminalCompanyMember.findUnique({
      where: { terminalCompanyId_userId: { terminalCompanyId: companyId, userId } },
    });
    if (!existing || existing.status === 'ENDED') throw new NotFoundException('Member not found.');
    await this.prisma.terminalCompanyMember.update({ where: { id: existing.id }, data: { status: 'ENDED', endedAt: new Date() } });
    await this.audit.record({
      action: 'TERMINAL_COMPANY_MEMBER_ENDED',
      actorId,
      targetUserId: userId,
      newValue: { terminalCompanyId: companyId },
    });
    return { ended: true };
  }

  /**
   * TERM-6: the direct door. Before this, the only working path for an
   * ended member was ending (already done) then a FRESH INVITE — and
   * `acceptInvite`'s own existing-member branch reactivates on accept
   * (`status: 'ACTIVE', endedAt: null`). This endpoint must mean the same
   * thing that door already means, nothing more: flips those same two
   * fields and stops there. It does NOT touch `memberRole` (the invite
   * path only changes it because it's also carrying a fresh role choice —
   * there is no new role here to carry) and does NOT touch location
   * grants (the invite path never removes old ones either; both doors
   * already auto-restore every surviving `TerminalCompanyMemberLocation`
   * row the moment `status` reads ACTIVE again, via `myWorkspace`'s and
   * `assertStaffLocationAccess`'s own read-time re-check — reactivating
   * here only needs to flip the same switch invite-acceptance flips).
   */
  async reactivateMember(actorId: string, companyId: string, userId: string) {
    const existing = await this.prisma.terminalCompanyMember.findUnique({
      where: { terminalCompanyId_userId: { terminalCompanyId: companyId, userId } },
    });
    if (!existing || existing.status === 'ACTIVE') throw new NotFoundException('Member not found.');
    await this.prisma.terminalCompanyMember.update({
      where: { id: existing.id },
      data: { status: 'ACTIVE', endedAt: null },
    });
    await this.audit.record({
      action: 'TERMINAL_COMPANY_MEMBER_REACTIVATED',
      actorId,
      targetUserId: userId,
      newValue: { terminalCompanyId: companyId },
    });
    return { reactivated: true };
  }

  /**
   * TERM-6: the gap the UI named directly — an ACTIVE member's own
   * locations could only change by ending them and sending a new invite.
   * Scoped to an ACTIVE member on purpose (the card's own instruction):
   * an ended member has no access regardless of grants, so editing one's
   * grants is a question for `reactivateMember` first, not this endpoint.
   */
  async grantMemberLocation(actorId: string, companyId: string, userId: string, locationId: string) {
    const member = await this.prisma.terminalCompanyMember.findUnique({
      where: { terminalCompanyId_userId: { terminalCompanyId: companyId, userId } },
    });
    if (!member || member.status !== 'ACTIVE') throw new NotFoundException('Member not found.');
    const location = await this.prisma.terminalCompanyLocation.findFirst({
      where: { id: locationId, terminalCompanyId: companyId, isActive: true },
    });
    if (!location) throw new BadRequestException('That location is not an active location of this company.');
    // Same upsert convention as acceptInvite's own grant loop: re-granting
    // an already-held location is a no-op, not a duplicate-row error.
    await this.prisma.terminalCompanyMemberLocation.upsert({
      where: { memberId_locationId: { memberId: member.id, locationId } },
      create: { memberId: member.id, locationId },
      update: {},
    });
    await this.audit.record({
      action: 'TERMINAL_COMPANY_MEMBER_LOCATION_GRANTED',
      actorId,
      targetUserId: userId,
      newValue: { terminalCompanyId: companyId, locationId },
    });
    return { granted: true };
  }

  async revokeMemberLocation(actorId: string, companyId: string, userId: string, locationId: string) {
    const member = await this.prisma.terminalCompanyMember.findUnique({
      where: { terminalCompanyId_userId: { terminalCompanyId: companyId, userId } },
    });
    if (!member || member.status !== 'ACTIVE') throw new NotFoundException('Member not found.');
    const grant = await this.prisma.terminalCompanyMemberLocation.findUnique({
      where: { memberId_locationId: { memberId: member.id, locationId } },
    });
    // Unlike TerminalCompanyLocation itself, this join row has no isActive
    // flag to flip (see its schema comment) — there is no handoff/custody
    // history keyed off a grant row the way there is off a location or a
    // membership, so deleting it outright is the correct "remove" here,
    // not a soft-delete this model was never given.
    if (!grant) throw new NotFoundException('This member does not hold that location.');
    await this.prisma.terminalCompanyMemberLocation.delete({ where: { id: grant.id } });
    await this.audit.record({
      action: 'TERMINAL_COMPANY_MEMBER_LOCATION_REVOKED',
      actorId,
      targetUserId: userId,
      newValue: { terminalCompanyId: companyId, locationId },
    });
    return { revoked: true };
  }

  /* ---- staff: the one read this card proves scoping with ------------------
   * Deliberately READ ONLY. No custody, handoff or PIN endpoint lives here —
   * see the class doc comment. */

  /**
   * TERM-5: the gate TerminalLegsController checks before delegating a
   * handoff/pickup submission to ShipmentService. Same ACTIVE-membership +
   * ACTIVE-location discipline as `myWorkspace` (re-checked here, not cached
   * from grant time, for the identical reason: a location or membership
   * deactivated a moment ago must stop authorizing immediately). Checks ONE
   * specific hub, not "does this person hold ANY location" — a terminal
   * company's own staff member authorized for their San Pedro counter must
   * never submit a code for a shipment moving through their company's
   * Belize City counter instead, even though both belong to the same
   * company and the same person.
   */
  async assertStaffLocationAccess(userId: string, hubId: string | null): Promise<void> {
    if (!hubId) throw new ForbiddenException('This leg has no terminal location to authorize against.');
    const grant = await this.prisma.terminalCompanyMemberLocation.findFirst({
      where: {
        location: { hubId, isActive: true, terminalCompany: { isActive: true } },
        member: { userId, status: 'ACTIVE' },
      },
    });
    if (!grant) throw new ForbiddenException('You do not hold this terminal location.');
  }

  /**
   * MDF-698: the one place `memberRole` is actually enforced, not merely
   * displayed. `memberRole` lives on `TerminalCompanyMember` itself (see
   * the schema's own comment) — company-wide, never per-location — so
   * unlike `assertStaffLocationAccess` above, this never takes a hubId.
   *
   * By design, MANAGER is a strict superset of OPERATOR: there are only
   * the two roles, and the owner's split gives MANAGER a set of
   * additional capabilities (staff view, exception/override resolution,
   * post-lockout PIN unlock, history/reporting) without taking anything
   * away that OPERATOR already had (receive/depart/arrive/handoff/
   * release-to-courier/collect/lookup). So `assertStaffLocationAccess`
   * and the five existing operational endpoints it gates deliberately
   * keep checking ONLY location, never role, exactly as before this
   * card — an OPERATOR-level action never calls this method. This is
   * called only by a MANAGER-only capability, e.g. `myStaff` below.
   *
   * TERM-STAFF-API: `findMany`, not the original `findFirst` — the
   * `@@unique([terminalCompanyId, userId])` constraint on
   * `TerminalCompanyMember` explicitly permits the same person holding
   * simultaneous ACTIVE memberships at two different companies, and an
   * unordered `findFirst` picked an arbitrary one of them. Now: every
   * ACTIVE membership is read, ordered oldest-first (the same tie-break
   * convention `getCompany`/`myStaff`'s own member queries already use),
   * and the first one whose role is in `allowed` wins — so a caller who
   * is OPERATOR at their oldest company but MANAGER at a newer one still
   * reaches a MANAGER-only action, scoped correctly to the company where
   * they actually hold it. Only when NO active membership anywhere has an
   * allowed role does this fall back to the two existing, still-
   * distinguishable refusals: no membership at all, or membership but
   * never the right role.
   */
  async assertActiveMemberRole(
    userId: string,
    allowed: TerminalCompanyMemberRole[],
  ): Promise<{ id: string; terminalCompanyId: string; memberRole: TerminalCompanyMemberRole }> {
    const memberships = await this.prisma.terminalCompanyMember.findMany({
      where: { userId, status: 'ACTIVE', terminalCompany: { isActive: true } },
      select: { id: true, terminalCompanyId: true, memberRole: true },
      orderBy: { createdAt: 'asc' },
    });
    if (memberships.length === 0) throw new ForbiddenException('No active terminal company membership.');
    const eligible = memberships.find((m) => allowed.includes(m.memberRole));
    if (!eligible) throw new ForbiddenException('This action requires the terminal manager role.');
    return eligible;
  }

  /**
   * MDF-698: "staff view" — the one MANAGER-only capability in the owner's
   * split that this card builds an endpoint for. Self-scoped exactly like
   * `myWorkspace`: the company comes from the CALLER's own active
   * membership, never a company id taken from the request, so a manager
   * can only ever see their own company's roster. The other three
   * MANAGER-only capabilities the owner named (exception/override
   * resolution, post-lockout PIN unlock requests, history/reporting) have
   * no terminal-facing endpoint anywhere in this codebase yet —
   * history/reporting is MDF-701; the other two are not part of this
   * four-card programme and are not built here.
   *
   * Reuses `serializeMember`/`serializeInvite` and the exact member/invite
   * query shape `getCompany` already uses — this is the same roster an
   * admin already sees, scoped to one company instead of taken by id.
   *
   * TERM-STAFF-API/Oscar: also returns the COMPANY's own locations
   * top-level, the exact gap Oscar found — without it, a manager with
   * partial location coverage could not grant a colleague, or invite a
   * new hire to, a location the company holds but the manager does not
   * personally hold, even though the owner's own ruling is that a
   * manager's authority comes from membership and role, never from which
   * locations they currently hold. Same shape `getCompany` already
   * returns (`serializeLocation`, same hub select) — every location,
   * including an inactive one with `isActive: false`, not pre-filtered —
   * so the invite/grant pickers can show one as unselectable instead of
   * it silently vanishing, exactly like the admin pickers already do.
   */
  async myStaff(userId: string) {
    const member = await this.assertActiveMemberRole(userId, ['MANAGER']);
    const companyLocations = await this.prisma.terminalCompanyLocation.findMany({
      where: { terminalCompanyId: member.terminalCompanyId },
      include: { hub: { select: { id: true, code: true, name: true, district: true, city: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const members = await this.prisma.terminalCompanyMember.findMany({
      where: { terminalCompanyId: member.terminalCompanyId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        locations: { include: { location: { include: { hub: { select: { id: true, code: true, name: true } } } } } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    });
    const invites = await this.prisma.terminalCompanyInvite.findMany({
      where: { terminalCompanyId: member.terminalCompanyId, consumedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    return {
      locations: companyLocations.map((l) => this.serializeLocation(l)),
      members: members.map((m) => this.serializeMember(m)),
      pendingInvites: invites.map((i) => this.serializeInvite(i)),
    };
  }

  /* ---- staff: manager-run staff management (TERM-STAFF-API) ---------------
   *
   * The owner-approved self-serve door onto the same six primitives
   * AdminTerminalController already exposes, scoped to the CALLER's own
   * company instead of a companyId taken from the request — a userId or
   * locationId belonging to another company is unreachable by construction,
   * not merely refused: every lookup below is keyed off `caller.terminalCompanyId`,
   * read from the caller's own ACTIVE membership, never from the request.
   *
   * Authority model, stated once here because every method below depends on
   * it: company membership and terminal-location assignment are SEPARATE.
   * `assertActiveMemberRole` never checks a location, so revoking every
   * location a MANAGER holds does not reduce their authority — only ending
   * their membership does. The three guarded doors below protect the
   * company from ever having zero ACTIVE MANAGERs; they do not, and must
   * not, require the CALLER to hold a location themselves (the owner's
   * confirmed instinct — staff management isn't counter work).
   *
   * Reuses the existing admin-door methods (inviteMember/grantMemberLocation)
   * directly rather than re-deriving their logic — the only new logic here
   * is the caller-derived scoping and the last-ACTIVE-MANAGER floor.
   */

  /**
   * Row-locks the company for the duration of the transaction (the same
   * `SELECT ... FOR UPDATE` pattern `WalletService` uses before reading a
   * balance it is about to act on — apps/api/src/wallet/wallet.service.ts).
   * Without this, two concurrent requests against the same company (e.g.
   * two managers each demoting a DIFFERENT one of the company's exactly-two
   * MANAGERs) could each read "2 active managers" before either writes,
   * and both pass the floor check — leaving zero. Locking the company row
   * first serializes every staff-management write for that one company;
   * unrelated companies are never blocked by each other.
   */
  private async countActiveManagers(tx: Prisma.TransactionClient, companyId: string): Promise<number> {
    await tx.$queryRaw`SELECT id FROM terminal_company_profiles WHERE id = ${companyId} FOR UPDATE`;
    return tx.terminalCompanyMember.count({
      where: { terminalCompanyId: companyId, status: 'ACTIVE', memberRole: 'MANAGER' },
    });
  }

  /**
   * The last-ACTIVE-MANAGER floor, same guard shape on every door that can
   * remove a MANAGER's standing, different trigger per door — applies
   * identically whether the caller is acting on themselves or on another
   * manager: this floor alone never distinguished "is this me," and still
   * doesn't.
   *
   * FIN-SELF-LOCKOUT (2026-11-18) supersedes the owner's EARLIER directive
   * that this comment used to cite verbatim ("there is no separate 'is
   * this me' rule"). That was true of THIS floor and remains true of it —
   * the floor is still one condition, about the COMPANY, blind to who the
   * actor is. What changed is that a SECOND, separate guard now sits in
   * front of it in `staffChangeRole`/`staffDeactivateMember`: the ACTOR
   * may never act on their own standing through those self-service doors
   * at all, regardless of how many managers exist, so the floor below can
   * fire on a self-action but a self-action usually never reaches it
   * anymore — the self guard answers first. Two guards, never merged: do
   * not fold the self check into this method's `wouldRemoveOneManager`
   * condition, and do not delete this comment's history when touching
   * either guard again.
   */
  private async assertManagerFloorHolds(tx: Prisma.TransactionClient, companyId: string, wouldRemoveOneManager: boolean): Promise<void> {
    if (!wouldRemoveOneManager) return;
    const activeManagers = await this.countActiveManagers(tx, companyId);
    if (activeManagers <= 1) {
      throw new ConflictException('This company must always have at least one active manager.');
    }
  }

  /** Self-serve mirror of `inviteMember` — the company comes from the
   *  caller's own MANAGER membership, everything else is identical,
   *  including the role the caller chooses to invite (MANAGER or
   *  OPERATOR — the owner's explicit YES on manager-creates-manager). */
  async staffInvite(actorId: string, dto: InviteTerminalCompanyMemberInput) {
    const caller = await this.assertActiveMemberRole(actorId, ['MANAGER']);
    return this.inviteMember(actorId, caller.terminalCompanyId, dto);
  }

  /**
   * Promote OPERATOR<->MANAGER on an already-ACTIVE member. The one
   * operation the original plan did not have — the directive's own
   * addition. A no-op (new role equals current role) still runs the floor
   * check against the HYPOTHETICAL post-write state before short-circuiting,
   * so a demote-to-the-same-role request against the last manager is
   * refused exactly like a real demote would be, never silently accepted
   * as "nothing changed."
   *
   * FIN-SELF-LOCKOUT (2026-11-18, the owner's reversal of his own earlier
   * "no separate is-this-me rule" — see `assertManagerFloorHolds`'s
   * comment below for that history): a MANAGER demoting THEMSELVES to
   * OPERATOR is refused unconditionally, before the floor check even
   * runs — a different guard from `assertManagerFloorHolds`, not a
   * special case of it. The floor is about the COMPANY (never zero
   * active managers) and fires regardless of who the target is; this is
   * about the ACTOR and fires regardless of how many managers exist —
   * even with a second active manager standing by and zero floor risk,
   * self-demotion is still refused. They CAN both be true of the same
   * request (a lone manager demoting themselves trips the floor too),
   * but the self guard is checked first, so the caller sees the mistake
   * that is actually theirs — they tried to act on their own standing —
   * never the company-wide floor text, which would be true but tell them
   * nothing about why they were actually stopped. The message says who
   * CAN do it: ONLY another manager — never an administrator, and this
   * went through two wrong answers before landing here (2026-11-18), both
   * the owner's, worth recording so the next edit doesn't repeat them.
   * First: no admin-console endpoint writes `memberRole` at all
   * (`endMember`/`reactivateMember` never touch it), so naming an
   * administrator seemed simply false — true, but not the whole
   * reason. Second (reversed, briefly): an administrator CAN reach a
   * role change INDIRECTLY, via `endMember` followed by a fresh invite
   * at the new role — so for a moment the message named one anyway.
   * THAT WAS ALSO WRONG TOO, but on a narrower point — checked against
   * `acceptInvite` (2026-11-18): the member row is reused (updated in
   * place, not duplicated) and existing `TerminalCompanyMemberLocation`
   * grants are upserted, never deleted, so they DO survive the indirect
   * route. The actual principle still holds: a message must not promise
   * a mechanism whose side effects it does not disclose. The indirect
   * route is not the same action under a different hand — it ENDS the
   * member's standing and requires THEM, not the administrator, to accept
   * a brand-new invitation before the role actually changes. "An
   * administrator can do this for you" implies the administrator
   * performs it; here the member must act themselves, and is not a
   * member in between. That gap is what makes this message withhold the
   * administrator, not any loss of data (contrast `staffDeactivateMember`
   * below: `endMember` through the admin door does EXACTLY what the
   * self-service door would have done, no fresh acceptance required of
   * anyone, so that message correctly DOES name an administrator).
   * A sole manager who hits this message has a genuine dead end for a
   * same-standing role change — that is honestly stated here, not
   * hidden behind a workaround with undisclosed consequences; the
   * workaround belongs in Edward's operating guide, where there's room
   * to explain what it actually costs, not in a one-line refusal. There
   * is no ownership-transfer workflow in this codebase, so there is no
   * legitimate case where a manager must be allowed to demote themselves
   * — the refusal has no exception path by design. A MANAGER may still
   * freely promote themselves to MANAGER (a no-op) or be demoted by a
   * DIFFERENT manager; only self-targeted self-demotion is blocked here.
   */
  async staffChangeRole(actorId: string, targetUserId: string, dto: ChangeTerminalCompanyMemberRoleInput) {
    const caller = await this.assertActiveMemberRole(actorId, ['MANAGER']);
    if (isSelfAction(actorId, targetUserId) && dto.memberRole === 'OPERATOR') {
      throw new ForbiddenException('You cannot change your own role from manager to operator. Another manager can do this for you.');
    }
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.terminalCompanyMember.findUnique({
        where: { terminalCompanyId_userId: { terminalCompanyId: caller.terminalCompanyId, userId: targetUserId } },
      });
      if (!target || target.status !== 'ACTIVE') throw new NotFoundException('Member not found.');
      const demotingTheOnlyManager = target.memberRole === 'MANAGER' && dto.memberRole === 'OPERATOR';
      await this.assertManagerFloorHolds(tx, caller.terminalCompanyId, demotingTheOnlyManager);
      if (target.memberRole === dto.memberRole) {
        return { roleChanged: true as const, memberRole: target.memberRole };
      }
      const updated = await tx.terminalCompanyMember.update({ where: { id: target.id }, data: { memberRole: dto.memberRole } });
      // MDF-TERM-STAFF-API: audit action name confirmed with god before this
      // landed — TERMINAL_COMPANY_MEMBER_ROLE_CHANGED, the same
      // one-action-per-lifecycle shape as SHIPPING_PROVIDER_MEMBER_CHANGED/
      // PASSENGER_AFFILIATION_CHANGED, verb carried in newValue.
      await this.audit.record(
        {
          action: 'TERMINAL_COMPANY_MEMBER_ROLE_CHANGED',
          actorId,
          targetUserId,
          newValue: { terminalCompanyId: caller.terminalCompanyId, fromRole: target.memberRole, toRole: updated.memberRole },
        },
        tx,
      );
      return { roleChanged: true as const, memberRole: updated.memberRole };
    });
  }

  /** Self-serve mirror of `grantMemberLocation` — no floor needed, this
   *  door only ever adds. */
  async staffGrantLocation(actorId: string, targetUserId: string, locationId: string) {
    const caller = await this.assertActiveMemberRole(actorId, ['MANAGER']);
    return this.grantMemberLocation(actorId, caller.terminalCompanyId, targetUserId, locationId);
  }

  /**
   * Self-serve mirror of `revokeMemberLocation`, with the floor the
   * directive named explicitly: refusing to revoke the company's sole
   * ACTIVE MANAGER's own last remaining ACTIVE location. A company with
   * two or more ACTIVE MANAGERs may freely revoke any one manager's last
   * location — the floor only ever protects the LAST standing manager,
   * never every manager's own location count.
   *
   * Deliberately its OWN message, never the doors-2/5 "no active manager
   * left" text: this write does not touch membership or role at all, so
   * it cannot be the same failure. `grantMemberLocation` never requires
   * the caller to hold a location, so the manager this refuses is never
   * truly locked out — they could self-grant a location straight back —
   * and the owner's own ruling is that authority comes from membership
   * and role, NOT from holding a location. A message that reused the
   * manager-count wording would teach a reader the opposite of that
   * ruling while the guard quietly agreed with it.
   */
  async staffRevokeLocation(actorId: string, targetUserId: string, locationId: string) {
    const caller = await this.assertActiveMemberRole(actorId, ['MANAGER']);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM terminal_company_profiles WHERE id = ${caller.terminalCompanyId} FOR UPDATE`;
      const target = await tx.terminalCompanyMember.findUnique({
        where: { terminalCompanyId_userId: { terminalCompanyId: caller.terminalCompanyId, userId: targetUserId } },
      });
      if (!target || target.status !== 'ACTIVE') throw new NotFoundException('Member not found.');
      const grant = await tx.terminalCompanyMemberLocation.findUnique({
        where: { memberId_locationId: { memberId: target.id, locationId } },
      });
      if (!grant) throw new NotFoundException('This member does not hold that location.');
      if (target.memberRole === 'MANAGER') {
        const activeManagers = await tx.terminalCompanyMember.count({
          where: { terminalCompanyId: caller.terminalCompanyId, status: 'ACTIVE', memberRole: 'MANAGER' },
        });
        if (activeManagers <= 1) {
          const otherActiveLocations = await tx.terminalCompanyMemberLocation.count({
            where: { memberId: target.id, id: { not: grant.id }, location: { isActive: true } },
          });
          if (otherActiveLocations === 0) {
            throw new ConflictException('This would leave the company\'s only manager without access to any location.');
          }
        }
      }
      await tx.terminalCompanyMemberLocation.delete({ where: { id: grant.id } });
      await this.audit.record(
        {
          action: 'TERMINAL_COMPANY_MEMBER_LOCATION_REVOKED',
          actorId,
          targetUserId,
          newValue: { terminalCompanyId: caller.terminalCompanyId, locationId },
        },
        tx,
      );
      return { revoked: true as const };
    });
  }

  /**
   * Self-serve mirror of `endMember`, guarded by the same last-ACTIVE-MANAGER
   * floor as `staffChangeRole` — ending the company's sole ACTIVE MANAGER is
   * refused regardless of who is ending whom.
   *
   * FIN-SELF-LOCKOUT (2026-11-18): on top of that floor, a MANAGER ending
   * THEIR OWN membership is refused unconditionally, checked first and
   * before the floor — same two-guards-not-one reasoning as
   * `staffChangeRole` above, fires regardless of how many managers exist.
   * A company with several active managers never trips the floor, but a
   * manager still cannot end their own access through this door; only a
   * DIFFERENT manager through this same door, or an administrator through
   * the admin console's `endMember`, can — unlike the role-change guard
   * above, an administrator genuinely can do this one, so the message
   * says so.
   */
  async staffDeactivateMember(actorId: string, targetUserId: string) {
    const caller = await this.assertActiveMemberRole(actorId, ['MANAGER']);
    if (isSelfAction(actorId, targetUserId)) {
      throw new ForbiddenException('You cannot end your own terminal company membership. Another manager, or an administrator, can do this for you.');
    }
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.terminalCompanyMember.findUnique({
        where: { terminalCompanyId_userId: { terminalCompanyId: caller.terminalCompanyId, userId: targetUserId } },
      });
      if (!target || target.status === 'ENDED') throw new NotFoundException('Member not found.');
      await this.assertManagerFloorHolds(tx, caller.terminalCompanyId, target.memberRole === 'MANAGER');
      await tx.terminalCompanyMember.update({ where: { id: target.id }, data: { status: 'ENDED', endedAt: new Date() } });
      await this.audit.record(
        { action: 'TERMINAL_COMPANY_MEMBER_ENDED', actorId, targetUserId, newValue: { terminalCompanyId: caller.terminalCompanyId } },
        tx,
      );
      return { ended: true as const };
    });
  }

  /** Self-serve mirror of `reactivateMember` — no floor: reactivating only
   *  ever adds a manager back, never removes one. */
  async staffReactivateMember(actorId: string, targetUserId: string) {
    const caller = await this.assertActiveMemberRole(actorId, ['MANAGER']);
    return this.reactivateMember(actorId, caller.terminalCompanyId, targetUserId);
  }

  /**
   * TERM-STAFF-API, god's own scope addition: a manager who mistypes an
   * invite email had no way to undo it — an admin dependency surviving
   * inside the feature built to end admin dependency. Self-serve mirror of
   * `revokeInvite`, no new logic: that method already scopes its lookup to
   * `{ id: inviteId, terminalCompanyId: companyId }`, so an inviteId
   * belonging to another company already 404s ("Invite not found.")
   * rather than 403ing — never confirming the invite exists at all, per
   * the directive.
   */
  async staffRevokeInvite(actorId: string, inviteId: string) {
    const caller = await this.assertActiveMemberRole(actorId, ['MANAGER']);
    return this.revokeInvite(actorId, caller.terminalCompanyId, inviteId);
  }

  /** Self-serve mirror of `resendInvite` — same cross-company 404 via the
   *  same scoped lookup, same reasoning as `staffRevokeInvite` above. */
  async staffResendInvite(actorId: string, inviteId: string) {
    const caller = await this.assertActiveMemberRole(actorId, ['MANAGER']);
    return this.resendInvite(actorId, caller.terminalCompanyId, inviteId);
  }

  async myWorkspace(userId: string) {
    const member = await this.prisma.terminalCompanyMember.findFirst({
      where: { userId, status: 'ACTIVE', terminalCompany: { isActive: true } },
      include: {
        terminalCompany: { select: { id: true, businessName: true, isTest: true } },
        locations: { include: { location: { include: { hub: { select: { id: true, code: true, name: true, district: true, city: true } } } } } },
      },
    });
    if (!member) throw new ForbiddenException('No active terminal company membership.');
    return {
      companyId: member.terminalCompany.id,
      companyName: member.terminalCompany.businessName,
      // MDF-700/T-7: selected above (:601) but previously dropped here —
      // the one piece of demo-data labelling this endpoint was missing.
      // Server-side enforcement already requires isTest to match at
      // hub-placement and invite time (terminal.service.ts:155, :315); this
      // is exposure only, not a new rule.
      isTest: member.terminalCompany.isTest,
      memberRole: member.memberRole,
      // Re-checked here, not just at grant time: a location deactivated after
      // the grant was made must stop appearing immediately, with no separate
      // cleanup pass needed — the same read-time discipline CLOSE-22 applied
      // to a leg's own stale dispatch markers.
      locations: member.locations.filter((ml) => ml.location.isActive).map((ml) => ({ locationId: ml.location.id, hub: ml.location.hub })),
    };
  }

  /**
   * TERM-8: the hub ids `TerminalController.queue` is allowed to ask
   * `ShipmentService.terminalQueue` about — the ONLY place that decides
   * which hubs are "mine." Same ACTIVE-membership + ACTIVE-location query
   * `myWorkspace` already runs (not a parallel derivation of it), across
   * EVERY company the caller belongs to, not just one — a person who holds
   * ACTIVE membership at two different terminal companies sees one combined
   * queue, the same way `myWorkspace` would need `findMany` instead of
   * `findFirst` to do if a second slice ever asked for multi-company reads
   * there.
   */
  async myActiveHubIds(userId: string): Promise<string[]> {
    // Same existence check `myWorkspace` makes, same exception — a caller
    // with NO active membership anywhere is refused, same as `terminal/me`;
    // a genuine member with zero CURRENT grants gets an empty queue instead,
    // which is a different, valid state (not an error).
    const hasMembership = await this.prisma.terminalCompanyMember.findFirst({
      where: { userId, status: 'ACTIVE', terminalCompany: { isActive: true } },
      select: { id: true },
    });
    if (!hasMembership) throw new ForbiddenException('No active terminal company membership.');
    const grants = await this.prisma.terminalCompanyMemberLocation.findMany({
      where: {
        member: { userId, status: 'ACTIVE', terminalCompany: { isActive: true } },
        location: { isActive: true },
      },
      select: { location: { select: { hubId: true } } },
    });
    return [...new Set(grants.map((g) => g.location.hubId))];
  }

  /* ---- shaping -------------------------------------------------------------- */

  private serializeCompany(c: TerminalCompanyProfile) {
    return {
      id: c.id,
      businessName: c.businessName,
      contactEmail: c.contactEmail,
      contactPhone: c.contactPhone,
      isActive: c.isActive,
      isTest: c.isTest,
      createdAt: c.createdAt,
    };
  }

  private serializeLocation(l: { id: string; isActive: boolean; hub: { id: string; code: string; name: string; district?: string; city?: string } }) {
    return { id: l.id, isActive: l.isActive, hub: l.hub };
  }

  private serializeMember(m: {
    id: string;
    userId: string;
    memberRole: string;
    status: string;
    createdAt: Date;
    endedAt: Date | null;
    user: { id: string; firstName: string; lastName: string; email: string };
    locations: { location: { id: string; hub: { id: string; code: string; name: string } } }[];
  }) {
    return {
      id: m.id,
      userId: m.userId,
      name: `${m.user.firstName} ${m.user.lastName}`.trim(),
      email: m.user.email,
      memberRole: m.memberRole,
      status: m.status,
      createdAt: m.createdAt,
      endedAt: m.endedAt,
      locations: m.locations.map((ml) => ml.location),
    };
  }

  private serializeInvite(i: {
    id: string;
    email: string;
    memberRole: string;
    expiresAt: Date;
    createdAt: Date;
    locationIds: string[];
  }) {
    // Never the token — only ever its existence and metadata.
    return { id: i.id, email: i.email, memberRole: i.memberRole, expiresAt: i.expiresAt, createdAt: i.createdAt, locationCount: i.locationIds.length };
  }
}
