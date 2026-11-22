import { randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { hashPassword, verifyPassword } from '@bmpl/authentication';
import type { DeliveryStatus, PassengerTripStatus, VendorOrderStatus } from '@bmpl/database';
import type { DeleteAccountInput, UpdateProfileInput } from '@bmpl/validation';
import {
  AVATAR_REJECTION_REASONS,
  avatarNeedsApproval,
  avatarRejectionMessage,
  isAllowedAvatarMime,
  MAX_AVATAR_BYTES,
  ROLE_DEFINITIONS,
  roleRequiresAvatar,
  sniffProductImageMime,
  STORAGE_PREFIX,
  type AvatarStatus,
  type RoleCode,
} from '@bmpl/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { UploadIngestService } from '../storage/upload-ingest.service';
import { AvatarVisionService } from '../storage/avatar-vision.service';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { publicAvatarUrl } from '../common/avatar-url';

/** The committed-and-not-yet-finished delivery/courier statuses — a driver
 *  in one of these cannot simply vanish; see {@link UsersService.liveResponsibilities}. */
const LIVE_DRIVER_STATUSES: DeliveryStatus[] = ['DRIVER_ACCEPTED', 'PICKUP_CONFIRMED', 'IN_TRANSIT', 'ARRIVING'];
/** Vendor order states still awaiting the vendor's own action. */
const LIVE_VENDOR_ORDER_STATUSES: VendorOrderStatus[] = ['PENDING', 'PREPARING', 'READY_FOR_PICKUP'];
/** The same "accepted but not yet finished" shape as {@link LIVE_DRIVER_STATUSES},
 *  applied to the separate PASSENGER_DRIVER vertical (PassengerTrip, not
 *  OrderDelivery/ShipmentLeg): a trip the driver has taken on but not yet
 *  completed, cancelled or exceptioned. */
const LIVE_PASSENGER_TRIP_STATUSES: PassengerTripStatus[] = ['ASSIGNED', 'EN_ROUTE_TO_PICKUP', 'IN_PROGRESS'];

/** Serializable view of the signed-in user + their roles. */
export interface MeView {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  district: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  /** Stable public URL of the APPROVED picture, or null while there isn't one. */
  avatarUrl: string | null;
  avatarStatus: AvatarStatus;
  /** Short-lived signed URL so the owner can see the picture awaiting review. */
  avatarPendingUrl: string | null;
  /** Plain-language explanation when avatarStatus is REJECTED. */
  avatarRejectedReason: string | null;
  /** True when one of this user's approved roles makes a picture mandatory. */
  avatarRequired: boolean;
  status: string;
  emailVerified: boolean;
  activeRole: RoleCode | null;
  roles: Array<{
    roleCode: RoleCode;
    label: string;
    status: string;
    isSelectable: boolean;
  }>;
  /**
   * The admin permissions this user actually holds — the same grant rows the
   * PermissionsGuard evaluates (AuthContextService.build), so what a console
   * renders and what the API enforces can never disagree. Empty for everyone
   * who is not staff. Read-only knowledge of one's OWN permissions is not a
   * privilege: the first 403 reveals it anyway, just after the wrong button
   * was drawn.
   */
  adminPermissions: string[];
}

/** The outcome of an avatar upload, as the uploader sees it. */
export interface AvatarUploadResult {
  status: AvatarStatus;
  /** What to tell the user — approved, queued for review, or why it failed. */
  message: string;
  avatarUrl: string | null;
}

const APPROVED_MESSAGE = 'Your profile picture is live.';
const PENDING_MESSAGE =
  'Thanks — your photo is being reviewed. It usually takes less than a day, and we’ll let you know as soon as it’s live.';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ingest: UploadIngestService,
    private readonly vision: AvatarVisionService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  /**
   * Stable, cacheable reference to a user's approved picture. API-relative for
   * the reasons documented on {@link publicAvatarUrl}; the route itself is public
   * and only ever serves an APPROVED picture — see UserAvatarController.
   */
  private avatarUrlFor(userId: string): string {
    return `/users/${userId}/avatar`;
  }

  async getMe(userId: string): Promise<MeView> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { roles: true, adminPermissions: { select: { permission: true } } },
    });

    // The owner is the one person who may see a picture that isn't approved yet,
    // so they can tell what is actually being reviewed.
    const avatarPendingUrl = user.avatarPendingKey
      ? await this.signedOrNull(user.avatarPendingKey)
      : null;

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      district: user.district,
      addressLine1: user.addressLine1,
      addressLine2: user.addressLine2,
      city: user.city,
      // The OWNER always sees their own picture, moderated or not — a customer's
      // avatar is cosmetic and shown inside their own account, which is exactly
      // here. Signed directly rather than via the public route, because that
      // route deliberately 404s for unmoderated pictures.
      avatarUrl: user.avatarKey
        ? await this.signedOrNull(user.avatarKey)
        : publicAvatarUrl(user),
      avatarStatus: user.avatarStatus,
      avatarPendingUrl,
      avatarRejectedReason:
        user.avatarStatus === 'REJECTED' ? avatarRejectionMessage(user.avatarRejectedReason) : null,
      avatarRequired: user.roles.some(
        (r) => r.status === 'APPROVED' && roleRequiresAvatar(r.roleCode),
      ),
      status: user.status,
      emailVerified: !!user.emailVerifiedAt,
      activeRole: user.activeRoleCode,
      roles: user.roles.map((r) => ({
        roleCode: r.roleCode as RoleCode,
        label: ROLE_DEFINITIONS[r.roleCode as RoleCode].label,
        status: r.status,
        isSelectable: r.status === 'APPROVED',
      })),
      adminPermissions: user.adminPermissions.map((p) => p.permission).sort(),
    };
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<MeView> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone || null,
        district: input.district,
        addressLine1: input.addressLine1 || null,
        addressLine2: input.addressLine2 || null,
        city: input.city || null,
      },
    });
    return this.getMe(userId);
  }

  /**
   * Upload a profile picture (browser → API → private storage).
   *
   * The face check runs on the raw bytes BEFORE anything is written to storage,
   * so a picture that fails is never persisted at all. A picture that passes goes
   * live immediately; anything the checker is unsure about — including when no
   * vision provider is configured — is stored as pending and queued for an admin.
   *
   * A previously approved picture is left in place throughout: a rejected or
   * still-pending replacement never takes down the photo the user already had.
   */
  async uploadAvatar(
    userId: string,
    buffer: Buffer | undefined,
    fileName?: string,
  ): Promise<AvatarUploadResult> {
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException(
        'No image data was received. Please choose a file and try again.',
      );
    }
    if (buffer.length > MAX_AVATAR_BYTES) {
      throw new BadRequestException('That image is too large. Please use a photo under 5 MB.');
    }
    // Trust the bytes, never the declared Content-Type.
    const mime = sniffProductImageMime(buffer);
    if (!mime || !isAllowedAvatarMime(mime)) {
      throw new BadRequestException('Unsupported image type. Use JPEG, PNG, or WebP.');
    }

    // Whether this picture is an identity claim or decoration depends entirely on
    // who is uploading it. A customer's avatar asserts nothing, so it publishes
    // instantly; a driver's is what someone checks at their door, so it is
    // reviewed. Gating both on the same queue made every new customer wait for a
    // decision that protects nobody.
    if (!(await this.avatarNeedsApproval(userId))) {
      return this.publishUnmoderated(userId, buffer, fileName);
    }

    const verdict = await this.vision.check(buffer);
    if (verdict.decision === 'REJECT') {
      // Record the attempt so repeat offenders are visible, but store nothing.
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          avatarStatus: 'REJECTED',
          avatarPendingKey: null,
          avatarRejectedReason: verdict.reason,
          avatarFaceScore: verdict.faceScore,
          avatarSubmittedAt: new Date(),
          avatarReviewedAt: new Date(),
          avatarReviewedById: null,
        },
      });
      await this.audit.record({
        action: 'AVATAR_AUTO_REJECTED',
        actorId: userId,
        targetUserId: userId,
        newValue: { reason: verdict.reason, faceScore: verdict.faceScore },
      });
      throw new BadRequestException(avatarRejectionMessage(verdict.reason));
    }

    const { key } = await this.ingest.image(buffer, STORAGE_PREFIX.avatar(userId), 'private', {
      fileName,
      fallbackName: 'avatar',
      maxBytes: MAX_AVATAR_BYTES,
    });

    if (verdict.decision === 'APPROVE') {
      const previousKey = await this.replaceApprovedAvatar(userId, key, verdict.faceScore);
      await this.deleteQuietly(previousKey);
      await this.audit.record({
        action: 'AVATAR_AUTO_APPROVED',
        actorId: userId,
        targetUserId: userId,
        newValue: { faceScore: verdict.faceScore },
      });
      return { status: 'APPROVED', message: APPROVED_MESSAGE, avatarUrl: this.avatarUrlFor(userId) };
    }

    // REVIEW — hold it for a human and keep any existing approved picture live.
    const previous = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { avatarPendingKey: true, avatarKey: true, avatarStatus: true },
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        avatarPendingKey: key,
        avatarStatus: 'PENDING',
        avatarRejectedReason: null,
        avatarFaceScore: verdict.faceScore,
        avatarSubmittedAt: new Date(),
        avatarReviewedAt: null,
        avatarReviewedById: null,
      },
    });
    // A superseded pending upload is dead weight in the bucket.
    await this.deleteQuietly(previous.avatarPendingKey);
    await this.audit.record({
      action: 'AVATAR_SUBMITTED',
      actorId: userId,
      targetUserId: userId,
      newValue: { faceScore: verdict.faceScore, note: verdict.note },
    });
    return {
      status: 'PENDING',
      message: PENDING_MESSAGE,
      avatarUrl: previous.avatarKey ? this.avatarUrlFor(userId) : null,
    };
  }

  /**
   * True when this user holds a role whose picture is a verified identity claim.
   * Read from APPROVED roles only — a pending driver application does not yet put
   * anyone at someone's door, so it does not yet gate their avatar.
   */
  private async avatarNeedsApproval(userId: string): Promise<boolean> {
    const roles = await this.prisma.userRole.findMany({
      where: { userId, status: 'APPROVED' },
      select: { roleCode: true },
    });
    return avatarNeedsApproval(roles.map((r) => r.roleCode));
  }

  /**
   * Store and publish a picture immediately — the customer path. No face check,
   * no pending state, no queue.
   *
   * Content safety still has a backstop: an admin can take any avatar down (see
   * {@link rejectAvatar}), which is takedown-on-report rather than review-before-
   * publish. That keeps the abuse lever without making 99% of users wait.
   */
  private async publishUnmoderated(
    userId: string,
    buffer: Buffer,
    fileName?: string,
  ): Promise<AvatarUploadResult> {
    const { key } = await this.ingest.image(buffer, STORAGE_PREFIX.avatar(userId), 'private', {
      fileName,
      fallbackName: 'avatar',
      maxBytes: MAX_AVATAR_BYTES,
    });
    // moderated=false: cosmetic, so it never reaches the public avatar route.
    const previousKey = await this.replaceApprovedAvatar(userId, key, null, undefined, false);
    await this.deleteQuietly(previousKey);
    await this.audit.record({
      action: 'AVATAR_AUTO_APPROVED',
      actorId: userId,
      targetUserId: userId,
      newValue: { moderated: false },
    });
    return { status: 'APPROVED', message: APPROVED_MESSAGE, avatarUrl: this.avatarUrlFor(userId) };
  }

  /** Remove the user's picture entirely, falling back to their initials. */
  async removeAvatar(userId: string): Promise<MeView> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { avatarKey: true, avatarPendingKey: true },
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        avatarKey: null,
        avatarPendingKey: null,
        avatarStatus: 'NONE',
        avatarRejectedReason: null,
        avatarFaceScore: null,
        avatarSubmittedAt: null,
        avatarReviewedAt: null,
        avatarReviewedById: null,
      },
    });
    await this.deleteQuietly(user.avatarKey);
    await this.deleteQuietly(user.avatarPendingKey);
    await this.audit.record({ action: 'AVATAR_REMOVED', actorId: userId, targetUserId: userId });
    return this.getMe(userId);
  }

  /**
   * MDF-924: self-service account deletion. Reauthentication (the CURRENT
   * password) is required, same as changePassword — a live session alone
   * is not enough proof for a one-way destructive action.
   *
   * The `users` row is NEVER deleted. Every foreign key into it (orders,
   * shipments, audit log, wallet accounts, ...) must keep pointing at a
   * real row — this ANONYMIZES the eligible personal data in place instead:
   * email, name, phone and address are overwritten, the avatar is removed,
   * the password hash is replaced with an unusable one, and the account is
   * marked `DEACTIVATED` + `deletedAt` (see the schema comment on
   * `deletedAt` for why deactivation alone is not deletion). Every session
   * is revoked afterward, including the one that made this call.
   *
   * Refuses first — before anonymizing anything — when the account
   * currently holds a live responsibility only a hand-off can clear; see
   * {@link liveResponsibilities}.
   */
  async deleteAccount(
    userId: string,
    input: DeleteAccountInput,
    meta: { ipAddress?: string },
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const ok = await verifyPassword(user.passwordHash, input.currentPassword);
    if (!ok) {
      throw new BadRequestException('Current password is incorrect.');
    }

    const reasons = await this.liveResponsibilities(userId);
    if (reasons.length > 0) {
      throw new ConflictException({
        message: 'Your account cannot be deleted yet.',
        reasons,
      });
    }

    // Unique, deterministic, and never reachable as a real registration —
    // register() lower-cases nothing special here, but no real address can
    // ever collide with this host, and the user's own id makes it unique
    // without a retry loop.
    const anonymizedEmail = `deleted-${userId}@deleted.bmpl.internal`;
    // A random hash nobody knows and nothing derives from the request —
    // this account must never be able to log in again, even if some other
    // guard were ever removed.
    const unusablePasswordHash = await hashPassword(randomBytes(32).toString('hex'));

    const previous = await this.prisma.$transaction(async (tx) => {
      const before = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { avatarKey: true, avatarPendingKey: true },
      });
      await tx.user.update({
        where: { id: userId },
        data: {
          email: anonymizedEmail,
          passwordHash: unusablePasswordHash,
          firstName: 'Deleted',
          lastName: 'User',
          phone: null,
          district: null,
          addressLine1: null,
          addressLine2: null,
          city: null,
          avatarKey: null,
          avatarPendingKey: null,
          avatarStatus: 'NONE',
          avatarRejectedReason: null,
          status: 'DEACTIVATED',
          deletedAt: new Date(),
        },
      });
      await this.audit.record(
        { action: 'USER_ACCOUNT_DELETED', actorId: userId, targetUserId: userId, ipAddress: meta.ipAddress },
        tx,
      );
      return before;
    });
    // Storage deletes are best-effort and not transactional — same pattern
    // as removeAvatar above.
    await this.deleteQuietly(previous.avatarKey);
    await this.deleteQuietly(previous.avatarPendingKey);

    // A stolen session must not survive the account it belonged to being
    // deleted — including the session that made this very call.
    await this.sessions.revokeAllForUser(userId);
  }

  /**
   * Live, hand-off-worthy responsibilities that must block deletion — each
   * entry is a complete, honest explanation of what to do first, per
   * MDF-924's requirement that a refusal here is a real response, not a
   * silent failure.
   *
   * Four checks, each with a concrete, pre-existing mechanism behind it
   * (no invented business floor):
   *
   * - Terminal company: the SAME last-active-manager floor
   *   `assertManagerFloorHolds` enforces in `terminal.service.ts` — read
   *   here directly rather than calling into that module, which is outside
   *   this card's file boundary. If this ever drifts from that floor's own
   *   definition, fix `terminal.service.ts` first and mirror it here.
   * - Vendor: an open VendorOrder (not yet PICKED_UP or CANCELLED) depends
   *   on the vendor actually doing something next.
   * - Driver (DELIVERY_DRIVER): a committed-but-unfinished marketplace
   *   OrderDelivery or shipping ShipmentLeg (accepted, not yet
   *   delivered/cancelled/declined).
   * - Driver (PASSENGER_DRIVER): the identical shape applied to the separate
   *   passenger-transport vertical — a PassengerTrip the driver has taken on
   *   (ASSIGNED/EN_ROUTE_TO_PICKUP/IN_PROGRESS) but not yet completed,
   *   cancelled or exceptioned. A passenger mid-trip is the same hand-off
   *   problem as a parcel mid-delivery, just a different table.
   *
   * A fifth check is of a DIFFERENT KIND and is NOT a business floor: the
   * last-super-admin guard below. There is no last-admin *business* rule
   * anywhere in this codebase (checked `AdminPermissionGrant`/`UserRole`
   * before deciding not to invent one) — but deleting the only remaining
   * SUPER_ADMIN is an IRREVERSIBLE platform state (nobody left who can grant
   * admin access to anyone, including back to this same person), whereas
   * refusing it is recoverable in one step (promote another SUPER_ADMIN,
   * then delete). This is an anti-lockout guard against an asymmetric,
   * irreversible outcome, not a judgment about how many admins the business
   * should have.
   *
   * Deliberately does NOT check: an "operator" floor (terminal OPERATOR has
   * no floor in `assertManagerFloorHolds` either — only MANAGER count
   * matters — mirroring how `staffDeactivateMember` already treats the two
   * differently).
   */
  private async liveResponsibilities(userId: string): Promise<string[]> {
    const reasons: string[] = [];

    const managerMemberships = await this.prisma.terminalCompanyMember.findMany({
      where: { userId, status: 'ACTIVE', memberRole: 'MANAGER' },
      select: { terminalCompanyId: true, terminalCompany: { select: { businessName: true } } },
    });
    for (const membership of managerMemberships) {
      const otherActiveManagers = await this.prisma.terminalCompanyMember.count({
        where: {
          terminalCompanyId: membership.terminalCompanyId,
          status: 'ACTIVE',
          memberRole: 'MANAGER',
          userId: { not: userId },
        },
      });
      if (otherActiveManagers === 0) {
        reasons.push(
          `You are the only active manager of "${membership.terminalCompany.businessName}". Promote another manager, or ask an administrator to end your membership, before deleting your account.`,
        );
      }
    }

    const vendor = await this.prisma.vendorProfile.findUnique({
      where: { userId },
      select: { id: true, businessName: true },
    });
    if (vendor) {
      const openOrders = await this.prisma.vendorOrder.count({
        where: { vendorProfileId: vendor.id, status: { in: LIVE_VENDOR_ORDER_STATUSES } },
      });
      if (openOrders > 0) {
        reasons.push(
          `Your storefront "${vendor.businessName}" has ${openOrders} order${openOrders === 1 ? '' : 's'} awaiting fulfillment. Complete or cancel ${openOrders === 1 ? 'it' : 'them'} before deleting your account.`,
        );
      }
    }

    const driver = await this.prisma.driverProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (driver) {
      const [activeDeliveries, activeLegs] = await Promise.all([
        this.prisma.orderDelivery.count({
          where: { assignedDriverProfileId: driver.id, status: { in: LIVE_DRIVER_STATUSES } },
        }),
        this.prisma.shipmentLeg.count({
          where: { assignedDriverProfileId: driver.id, courierStatus: { in: LIVE_DRIVER_STATUSES } },
        }),
      ]);
      const activeCount = activeDeliveries + activeLegs;
      if (activeCount > 0) {
        reasons.push(
          `You have ${activeCount} delivery or shipment job${activeCount === 1 ? '' : 's'} in progress. Complete or hand ${activeCount === 1 ? 'it' : 'them'} off before deleting your account.`,
        );
      }
    }

    const passengerDriver = await this.prisma.passengerDriverProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (passengerDriver) {
      const activeTrips = await this.prisma.passengerTrip.count({
        where: { driverProfileId: passengerDriver.id, status: { in: LIVE_PASSENGER_TRIP_STATUSES } },
      });
      if (activeTrips > 0) {
        reasons.push(
          `You have ${activeTrips} passenger trip${activeTrips === 1 ? '' : 's'} in progress. Complete or hand ${activeTrips === 1 ? 'it' : 'them'} off before deleting your account.`,
        );
      }
    }

    // Anti-lockout guard, not a business floor — see the doc comment above.
    const ownRole = await this.prisma.userRole.findUnique({
      where: { userId_roleCode: { userId, roleCode: 'SUPER_ADMIN' } },
      select: { status: true },
    });
    if (ownRole?.status === 'APPROVED') {
      const otherSuperAdmins = await this.prisma.userRole.count({
        where: { roleCode: 'SUPER_ADMIN', status: 'APPROVED', userId: { not: userId } },
      });
      if (otherSuperAdmins === 0) {
        reasons.push(
          'You are the only active super-admin. Deleting your account would leave the platform with no one able to grant admin access, and nobody inside the product could undo that. Grant super-admin to another account first, then delete yours.',
        );
      }
    }

    return reasons;
  }

  /**
   * Resolve a user's approved picture to a short-lived signed storage URL, for the
   * public `GET /users/:id/avatar` redirect. Returns null for every state other
   * than APPROVED, so a pending or rejected image is never served to anyone.
   */
  async approvedAvatarDownloadUrl(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarKey: true, avatarStatus: true, avatarModerated: true, status: true },
    });
    if (!user) throw new NotFoundException('User not found.');
    // A suspended account's face stops being shown alongside its activity.
    if (user.status !== 'ACTIVE') return null;
    if (user.avatarStatus !== 'APPROVED' || !user.avatarKey) return null;
    // Cosmetic customer avatars are not public. Enforced HERE as well as in
    // publicAvatarUrl: the serializers decide what to link, this decides what is
    // actually served, so a stale or hand-built URL cannot leak one either.
    if (!user.avatarModerated) return null;
    return this.signedOrNull(user.avatarKey);
  }

  // ---- Admin moderation -----------------------------------------------------

  /** Pictures awaiting a human decision, oldest submission first. */
  async avatarQueue(limit = 100) {
    const rows = await this.prisma.user.findMany({
      where: { avatarStatus: 'PENDING', avatarPendingKey: { not: null } },
      orderBy: { avatarSubmittedAt: 'asc' },
      take: limit,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarPendingKey: true,
        avatarFaceScore: true,
        avatarSubmittedAt: true,
        roles: { where: { status: 'APPROVED' }, select: { roleCode: true } },
      },
    });
    return Promise.all(
      rows.map(async (r) => ({
        userId: r.id,
        email: r.email,
        name: `${r.firstName} ${r.lastName}`,
        // Signed so an admin can actually look at the image they are judging.
        imageUrl: await this.signedOrNull(r.avatarPendingKey!),
        faceScore: r.avatarFaceScore,
        submittedAt: r.avatarSubmittedAt,
        roles: r.roles.map((role) => role.roleCode),
        // Surfaced so reviewers know which queue items block someone's work.
        requiresAvatar: r.roles.some((role) => roleRequiresAvatar(role.roleCode)),
      })),
    );
  }

  /** Publish a pending picture. */
  async approveAvatar(userId: string, adminId: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { avatarPendingKey: true },
    });
    if (!user.avatarPendingKey) {
      throw new BadRequestException('This user has no profile picture awaiting review.');
    }
    const previousKey = await this.replaceApprovedAvatar(userId, user.avatarPendingKey, null, adminId);
    await this.deleteQuietly(previousKey);
    await this.audit.record({ action: 'AVATAR_APPROVED', actorId: adminId, targetUserId: userId });
  }

  /** Reject a pending picture; any previously approved one is left untouched. */
  async rejectAvatar(userId: string, adminId: string, reason?: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { avatarPendingKey: true, avatarKey: true },
    });
    if (!user.avatarPendingKey) {
      throw new BadRequestException('This user has no profile picture awaiting review.');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        avatarPendingKey: null,
        // Falling back to an earlier approved picture is APPROVED, not REJECTED —
        // the user still has a live photo and shouldn't be told otherwise.
        avatarStatus: user.avatarKey ? 'APPROVED' : 'REJECTED',
        avatarRejectedReason: reason || AVATAR_REJECTION_REASONS.ADMIN_REJECTED,
        avatarReviewedAt: new Date(),
        avatarReviewedById: adminId,
      },
    });
    await this.deleteQuietly(user.avatarPendingKey);
    await this.audit.record({
      action: 'AVATAR_REJECTED',
      actorId: adminId,
      targetUserId: userId,
      newValue: { reason: reason || AVATAR_REJECTION_REASONS.ADMIN_REJECTED },
    });
  }

  // ---- internals ------------------------------------------------------------

  /** Promote `key` to the live avatar; returns the key it displaced, if any. */
  private async replaceApprovedAvatar(
    userId: string,
    key: string,
    faceScore: number | null,
    reviewedById?: string,
    /** False only for the cosmetic customer path — see publishUnmoderated. */
    moderated = true,
  ): Promise<string | null> {
    const previous = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { avatarKey: true },
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        avatarKey: key,
        avatarPendingKey: null,
        avatarStatus: 'APPROVED',
        avatarModerated: moderated,
        avatarRejectedReason: null,
        ...(faceScore === null ? {} : { avatarFaceScore: faceScore }),
        avatarSubmittedAt: new Date(),
        avatarReviewedAt: new Date(),
        avatarReviewedById: reviewedById ?? null,
      },
    });
    return previous.avatarKey;
  }

  /**
   * Signed download URL, or null when storage is unavailable. A missing picture
   * must degrade to initials, never to a 500 on a page that merely shows a name.
   */
  private async signedOrNull(key: string): Promise<string | null> {
    try {
      return (await this.storage.presignDownload(key)).url;
    } catch {
      return null;
    }
  }

  /** Best-effort cleanup of a superseded object; failure must not fail the request. */
  private async deleteQuietly(key: string | null | undefined): Promise<void> {
    if (!key) return;
    try {
      await this.storage.deleteObject(key);
    } catch {
      /* orphaned object — harmless, and never worth failing an upload over */
    }
  }
}
