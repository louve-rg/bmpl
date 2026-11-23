import { randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { hashPassword, verifyPassword } from '@bmpl/authentication';
import type {
  DeliveryStatus,
  JobApplicationStatus,
  PassengerBookingStatus,
  PassengerTripStatus,
  Prisma,
  ShipmentStatus,
  VendorOrderStatus,
  WalletHoldStatus,
} from '@bmpl/database';
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
  TERMINAL_DELIVERY_STATUSES,
  type AvatarStatus,
  type RoleCode,
} from '@bmpl/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { UploadIngestService } from '../storage/upload-ingest.service';
import { AvatarVisionService } from '../storage/avatar-vision.service';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { VendorService } from '../vendor/vendor.service';
import { publicAvatarUrl } from '../common/avatar-url';

/** The committed-and-not-yet-finished delivery/courier statuses — a driver
 *  in one of these cannot simply vanish; see {@link UsersService.liveResponsibilities}. */
const LIVE_DRIVER_STATUSES: DeliveryStatus[] = ['DRIVER_ACCEPTED', 'PICKUP_CONFIRMED', 'IN_TRANSIT', 'ARRIVING'];
/** Vendor order states still awaiting the vendor's own action — reused for
 *  both the vendor's own open orders and a CUSTOMER's in-flight orders. */
const LIVE_VENDOR_ORDER_STATUSES: VendorOrderStatus[] = ['PENDING', 'PREPARING', 'READY_FOR_PICKUP'];
/**
 * A vendor order that is genuinely still open. PENDING/PREPARING always are
 * (the vendor hasn't finished packing it). READY_FOR_PICKUP is NOT always
 * open: VendorOrder.status never advances past it for a DELIVERY order — the
 * real completion signal lives on OrderDelivery.status, not here (same fact
 * `SettlementService.settleVendorOrder` and `releaseReservationsInTx`'s own
 * guards already key off). A PICKUP order has no OrderDelivery row at all, so
 * `NOT: { delivery: { status: { in: TERMINAL_DELIVERY_STATUSES } } }` reads
 * true for it (nothing to match) exactly as intended — still awaiting
 * collection. ACCT-DELETE-DELIVERY-BLOCKS: before this, a DELIVERY order that
 * had already been delivered kept its vendor-order at READY_FOR_PICKUP
 * forever, permanently blocking the customer (and the vendor, on the
 * storefront-side check below) from ever deleting their account.
 */
const vendorOrderStillOpenWhere: Prisma.VendorOrderWhereInput = {
  OR: [
    { status: { in: ['PENDING', 'PREPARING'] } },
    { status: 'READY_FOR_PICKUP', NOT: { delivery: { status: { in: [...TERMINAL_DELIVERY_STATUSES] } } } },
  ],
};
/** The same "accepted but not yet finished" shape as {@link LIVE_DRIVER_STATUSES},
 *  applied to the separate PASSENGER_DRIVER vertical (PassengerTrip, not
 *  OrderDelivery/ShipmentLeg): a trip the driver has taken on but not yet
 *  completed, cancelled or exceptioned. */
const LIVE_PASSENGER_TRIP_STATUSES: PassengerTripStatus[] = ['ASSIGNED', 'EN_ROUTE_TO_PICKUP', 'IN_PROGRESS'];
/** Every ShipmentStatus except the three terminal ones (DELIVERED, CANCELLED,
 *  RETURNED) and DRAFT (nothing has been committed to yet, nobody is
 *  depending on this account to read anything out). EXCEPTION and REROUTED
 *  are deliberately included — the shipment is still unresolved, not done. */
const LIVE_SHIPMENT_STATUSES: ShipmentStatus[] = [
  'AWAITING_PICKUP',
  'FIRST_MILE',
  'AT_ORIGIN_HUB',
  'IN_TRANSIT',
  'AT_DESTINATION_HUB',
  'OUT_FOR_DELIVERY',
  'AWAITING_COLLECTION',
  'EXCEPTION',
  'REROUTED',
];
/** PassengerBooking states a provider still owes an answer or a seat to. */
const OPEN_PASSENGER_BOOKING_STATUSES: PassengerBookingStatus[] = ['REQUESTED', 'CONFIRMED'];
/** JobApplication states an employer still owes a decision to. */
const OPEN_JOB_APPLICATION_STATUSES: JobApplicationStatus[] = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'SHORTLISTED',
  'INTERVIEW_REQUESTED',
  'INTERVIEW_SCHEDULED',
  'OFFER_EXTENDED',
];
/** Wallet holds not yet resolved — HELD and AUTHORIZED are both still live;
 *  RELEASED is terminal. */
const OPEN_WALLET_HOLD_STATUSES: WalletHoldStatus[] = ['HELD', 'AUTHORIZED'];

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
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ingest: UploadIngestService,
    private readonly vision: AvatarVisionService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly vendor: VendorService,
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
   * No row this touches is ever DELETED except `SavedAddress` (nothing else
   * has a foreign key into one — see {@link anonymizePersonalData}). Every
   * other table — the `users` row itself, plus the role-profile and
   * identity tables {@link anonymizePersonalData} covers — is ANONYMIZED in
   * place instead, because real foreign keys from orders, shipments, the
   * audit log, delivery/shipment history and wallet accounts must keep
   * pointing at a real row. (Acceptance round 1 caught that this method
   * originally anonymized ONLY the `users` row and left a driver's licence
   * number, a saved home address, and several other role profiles' contact
   * details sitting under a user named "Deleted User" — fixed here by
   * extending the same anonymize-not-delete treatment to every personal-data
   * table this account actually populated.)
   *
   * A live storefront is also SUSPENDED here (see the `vendor.moderate` call
   * below) — reusing the existing admin mechanism, not a parallel one.
   *
   * WHAT THIS ACTUALLY PROMISES (owner ruling, acceptance round 2/3): this
   * is PROFILE ANONYMIZED, PAST TRANSACTION RECORDS RETAINED — not "account
   * deleted" in the sense a caller might assume. `OrderAddress.fullName`/
   * `phone`/`addressLine1` and `OrderDelivery.recipientName` on a COMPLETED
   * order or shipment are deliberately left untouched (they are the
   * vendor's/carrier's own record of work performed, not solely this
   * account's data — root CLAUDE.md's no-fabrication-of-business-records
   * line, applied to retention). The practical consequence: a vendor,
   * admin or driver reading a PAST order can still see this person's real
   * name, phone and delivery address on it, indefinitely, even though the
   * `users` row now reads "Deleted User" — because that screen's customer
   * name and the order's own stored address come from two different
   * sources. Any user-facing copy describing this action must not claim
   * more than this — see the PR body for the acceptance ruling this
   * paraphrases.
   *
   * Refuses first — before changing anything — when the account currently
   * holds a live responsibility only a hand-off can clear, or funds nothing
   * can be done with once nobody can sign in to spend them; see
   * {@link liveResponsibilities}.
   *
   * Every session is revoked afterward, including the one that made this
   * call.
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

    // Suspend a live storefront BEFORE anonymizing anything, reusing
    // VendorService.moderate() exactly as the admin console does — see
    // UsersModule's VendorModule import. Only called when the storefront is
    // actually APPROVED (live/orderable): liveResponsibilities already
    // refused above if it had an open order, so an APPROVED storefront here
    // has nothing outstanding to lose; any other status (DRAFT/PENDING/
    // REJECTED/already SUSPENDED) has nothing for moderate() to transition
    // away from, and moderate() throws if called on one of those, so this
    // guard is load-bearing, not defensive filler.
    //
    // Acceptance round 3, transaction boundary: `moderate()` opens and
    // commits its OWN `$transaction` internally (vendor.service.ts) — it
    // takes no external `tx`, and giving it one would mean either widening
    // this card's file boundary into vendor.service.ts or duplicating its
    // transition/audit/notification logic here, the exact "second way to do
    // something that already works" root CLAUDE.md §12 calls a defect. So
    // this call is deliberately OUTSIDE the anonymize transaction below, not
    // an oversight — and that ordering is the safer of the two failure
    // directions, not just the simpler one: if the anonymize transaction
    // then fails, the result is a SUSPENDED storefront on an otherwise
    // intact, still-logged-in account — recoverable in one step (an admin
    // restore()s it, or the owner retries delete) and nobody is left
    // accountable for nothing. Reversing the order would risk the opposite
    // failure — an anonymized "Deleted User" account whose storefront is
    // still APPROVED and orderable, with nobody left to run it — which is
    // the worse of the two states to be caught in.
    //
    // The one real consequence of this ordering (acceptance round 4): in
    // that failure case, moderate() has ALREADY sent the owner a
    // notification saying their storefront was suspended because they
    // deleted their account — while the account is, in fact, still ACTIVE
    // and they are still logged in. Low probability, and the ordering
    // above is still the right call; a reader of this comment should not
    // have to rediscover that the notification has already left the
    // building.
    const vendor = await this.prisma.vendorProfile.findUnique({
      where: { userId },
      select: { id: true, approvalStatus: true },
    });
    if (vendor?.approvalStatus === 'APPROVED') {
      await this.vendor.moderate(
        { userId, ipAddress: meta.ipAddress },
        vendor.id,
        'suspend',
        'Storefront suspended automatically: its owner deleted their account.',
      );
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
      const orphanedKeys = await this.anonymizePersonalData(tx, userId);
      await this.audit.record(
        { action: 'USER_ACCOUNT_DELETED', actorId: userId, targetUserId: userId, ipAddress: meta.ipAddress },
        tx,
      );
      return { avatarKey: before.avatarKey, avatarPendingKey: before.avatarPendingKey, orphanedKeys };
    });
    // Storage deletes are best-effort and not transactional — same pattern
    // as removeAvatar above.
    await this.deleteQuietly(previous.avatarKey);
    await this.deleteQuietly(previous.avatarPendingKey);
    for (const key of previous.orphanedKeys) {
      await this.deleteQuietly(key);
    }

    // A stolen session must not survive the account it belonged to being
    // deleted — including the session that made this very call.
    await this.sessions.revokeAllForUser(userId);
  }

  /**
   * MDF-924 acceptance round 2: anonymize every OTHER personal-data table
   * this account may have populated, not just the `users` row. Decided
   * table by table — not a uniform sweep — and every decision is written
   * down here so the next person doesn't have to re-derive it:
   *
   * - `SavedAddress` — DELETED outright. It is the one table in this list
   *   nothing else has a foreign key into (only `User.savedAddresses`
   *   points at it), so there is no dependent record an anonymize-in-place
   *   would be protecting.
   * - `DriverProfile` / `PassengerDriverProfile` — legalName, displayName,
   *   phone, home address, home coordinates, emergency contact, licence
   *   number and the profile photo are overwritten or cleared. A licence
   *   number is exactly the "personal data, not a transactional record"
   *   acceptance named. `licenceExpiry` and `homeDistrict` are left: the
   *   column is NOT NULL (a date can't be blanked without inventing a fake
   *   one) and a district alone isn't identifying. Both are also flipped
   *   `isActive: false` / `availability: OFFLINE` — a behavioural
   *   consequence of deletion (dispatch must stop treating a profile nobody
   *   can answer for as available), not a PII decision, but leaving it
   *   undone would mean this driver keeps getting offered jobs they can
   *   neither accept nor decline.
   * - `DriverVehicle` — licencePlate, registration and insurance
   *   identifiers are overwritten/cleared. make/model/year/colour are left
   *   — they describe the vehicle, not the person. Rows are KEPT, never
   *   deleted: delivery and shipment history still points at them.
   * - `JobSeekerProfile` — preferredName, legalName, contactEmail,
   *   contactPhone and the photo — exactly the fields named. `headline`/
   *   `summary` are free text the person wrote themselves and may contain
   *   anything, including other names; left alone deliberately, for the
   *   same reason the stored free-text columns elsewhere are a judgement
   *   call rather than a sweep (see the PR description).
   * - `EmployerProfile` / `AgencyProfile` — contactEmail/contactPhone only.
   *   companyName/name/legalName/slug are the BUSINESS's public identity,
   *   the same status as `VendorProfile.businessName` — not the deleting
   *   person's data to begin with.
   * - `PropertyOwnerProfile` / `RealEstateAgentProfile` — legalName,
   *   displayName, phone, email, photo. `RealEstateAgentProfile.isActive`
   *   is also set false, the same existing-lever reasoning as the driver
   *   case above; `bio` is left for the same free-text reason as
   *   `JobSeekerProfile`'s headline/summary.
   * - `VendorLocation` — addressLine1/2, coordinates and
   *   pickupInstructions are overwritten/cleared. `label`/city/district/
   *   country are left: label isn't personal, and city/district/country
   *   are required columns other operational reads (delivery zones,
   *   inventory-by-location) still rely on.
   *
   * Acceptance round 3 — four table families this method missed the first
   * time (spot-checked: `VendorProfile` itself was never updated at all):
   *
   * - `RoleApplicationDocument` — the actual uploaded identity/licence
   *   photos, found across EVERY `RoleApplication` this account ever
   *   submitted (any role, any outcome — not just the live profile it ended
   *   up with). `storageKey` is `@unique` and `NOT NULL`, so each row gets
   *   its own deterministic placeholder (one query per row, like
   *   `DriverVehicle` above) rather than one shared value; `label` is
   *   nullable and cleared. `contentType` (a MIME type like
   *   `application/pdf`) is left: it carries no personal data, and nulling
   *   a `NOT NULL` column buys no privacy.
   * - `JobSeekerResume` — the CV itself, a separate table from
   *   `JobSeekerProfile` (whose own photo this method already clears).
   *   Same per-row placeholder reasoning as the documents above; `label` is
   *   `NOT NULL` here, so it gets a literal replacement string instead of
   *   `null`.
   * - `VendorProfile.contactEmail`/`contactPhone` — the vendor row itself
   *   was never touched before this round; only its child `VendorLocation`
   *   rows were. For a sole trader these are the person's own contact
   *   details, not the business's public identity — unlike `businessName`,
   *   which stays for the same reason `EmployerProfile.companyName` does.
   * - `PassengerProviderProfile` / `ShippingProviderProfile` —
   *   `contactEmail`, `contactPhone`, `addressLine1`,
   *   `operatingLicenceNumber`. `businessName`/`district`/`city` are left:
   *   business identity and coarse location, not the person.
   *
   * Acceptance round 4 — a fifth table family, missed by all three prior
   * rounds (spot-checked: `PropertyDocument` was mentioned nowhere in this
   * file):
   *
   * - `PropertyDocument` — identity/ownership paperwork (`TITLE_DEED`,
   *   `PROOF_OF_OWNERSHIP`, `OWNER_AUTHORIZATION`, `AGENT_MANDATE`, etc.) in
   *   the PRIVATE bucket, hanging off `PropertyListing`, not off the user
   *   directly — reached only through `PropertyOwnerProfile.listings`
   *   (`PropertyListing.ownerProfileId`), the same per-row-placeholder
   *   treatment as `RoleApplicationDocument` above, because these are this
   *   OWNER's own identity/ownership documents and this is the owner
   *   leaving.
   *
   *   Deliberately NOT reached through `RealEstateAgentProfile.listings`
   *   (`PropertyListing.agentProfileId`): a listing an agent merely
   *   represents is still owned by someone else who has not deleted their
   *   account, and that owner's title deed is the OWNER's document, not
   *   the departing agent's — scrubbing it on the agent's own deletion
   *   would destroy a still-active owner's legal paperwork, which is a
   *   bug, not privacy. `AGENT_MANDATE`/`OWNER_AUTHORIZATION` on such a
   *   listing get the same bilateral-record treatment as `Message`/
   *   `MessageAttachment` below: an agreement between two parties, one of
   *   whom is still active, is not solely this departing account's record
   *   to rewrite.
   *
   * Deliberately left alone, stated rather than silently skipped:
   *
   * - `JobSeekerProfile.headline`/`summary`, `RealEstateAgentProfile.bio` —
   *   free text the person wrote themselves, which may itself contain a
   *   name or other personal detail no sweep can reliably find and which a
   *   blanket overwrite would just as easily destroy a harmless sentence.
   * - `Message.body` / `MessageAttachment` — free text and files this
   *   account sent INTO a conversation with another party. The thread
   *   belongs to both sides, not solely to the account being deleted — the
   *   same reasoning the PR body gives for leaving `OrderDelivery.
   *   recipientName`/`ShipmentLeg.handoffReceivedByName` alone: it is a
   *   dated record of what was actually said, and rewriting half of a
   *   two-sided conversation after the fact is worse than leaving it.
   *
   * MDF-949 — full re-trace against `schema.prisma` (not this method) as the
   * source of truth, prompted by two families the delivery report recorded
   * as "checked? no": NOTIFICATIONS, and whatever else outside the
   * user/profile graph had never been looked at.
   *
   * - `Notification` / `NotificationRecipient` / `NotificationPreference` —
   *   traced, nothing to fix. `Notification.title`/`body` is system-authored
   *   event text describing the SUBJECT of the event (an order, a vehicle, a
   *   job) — surveyed roughly 15 call sites across the API and found none
   *   that interpolate the recipient's own name/email/phone/address into the
   *   text; a notification is addressed "Your ..."/"You ...", never by name.
   *   `NotificationRecipient` and `NotificationPreference` carry no personal
   *   field of their own at all beyond the `userId` FK, which already reads
   *   through to the anonymized `User` row. Nothing here is a personal
   *   identifier this method needs to touch.
   * - `PassengerVehicle` — the real gap. Its own schema comment says it
   *   "mirrors DriverVehicle's approval/registration/insurance shape", and
   *   `DriverVehicle` already gets exactly that treatment above — but
   *   nothing anonymized `PassengerVehicle` at all. Fixed below, reached via
   *   `ownerDriverProfileId` only: that is the ONE vehicle this passenger
   *   driver personally owns, the passenger-transport equivalent of the
   *   single `DriverVehicle` a delivery driver owns. Deliberately NOT
   *   reached via `providerProfileId`: that is a FLEET vehicle a provider
   *   makes available to potentially several drivers via
   *   `PassengerFleetAffiliation`, any of whom may be actively assigned to
   *   it right now — the same still-active-other-party reasoning round 4
   *   gave for not touching an agent-represented `PropertyDocument`.
   *   `liveResponsibilities` has no check at all today for a
   *   `PassengerProviderProfile` with active fleet/trip obligations; that is
   *   a real gap, but a different one — a missing deletion-refusal business
   *   rule, not a missed anonymization — and is reported rather than
   *   invented here, same as the uncarded shipping-carrier-owner floor above.
   *
   * Surveyed and left alone, for the reasons already given above for a
   * similarly-shaped field, not re-explained per table: `RoleApplication.
   * message`, `JobApplication.coverLetter`/`employerNotes`,
   * `JobApplicationAnswer`, `JobInterview.notes`/`location`,
   * `PassengerFleetAffiliation.message`, `Conversation.subject`,
   * `ReviewReport.note` (free text / bilateral record, the
   * headline-or-Message reasoning above). `PropertyEnquiry.message`/
   * `contactPhone` and `PropertyViewingRequest.message` (a message sent TO a
   * listing owner who has not deleted their account — the Message
   * reasoning, not the SavedAddress one). `TerminalCompanyProfile.
   * contactEmail`/`contactPhone` and `TerminalCompanyInvite.email` (the
   * company's own multi-member business record, never 1:1 with a single
   * deleting user the way `VendorProfile` is). `Review`/`ReviewMedia`/
   * `ReviewResponse` (the author's name/face is a live join to the already-
   * anonymized `User` row, never a separately stored copy; `title`/`body`
   * are the same free-text judgment call as `JobSeekerProfile.headline`).
   * `Session.userAgent`/`ipAddress` on an already-revoked row (security/
   * audit retention, the same standing as `AuditLog`). `PassengerBooking`'s
   * pickup/dropoff snapshot (the `OrderAddress`/`OrderDelivery` owner-ruling
   * precedent — a completed trip record, and any live display of who the
   * rider was already resolves through the anonymized `User` row, same as
   * `Review`).
   *
   * Returns every storage key this pass orphaned, so the caller deletes the
   * actual objects AFTER the transaction commits — best-effort, same
   * pattern as the avatar cleanup in {@link deleteAccount} and
   * {@link removeAvatar}.
   */
  private async anonymizePersonalData(tx: Prisma.TransactionClient, userId: string): Promise<string[]> {
    const orphanedKeys: string[] = [];

    await tx.savedAddress.deleteMany({ where: { userId } });

    const driver = await tx.driverProfile.findUnique({
      where: { userId },
      select: { id: true, profilePhotoKey: true },
    });
    if (driver) {
      if (driver.profilePhotoKey) orphanedKeys.push(driver.profilePhotoKey);
      await tx.driverProfile.update({
        where: { id: driver.id },
        data: {
          legalName: 'Deleted Driver',
          displayName: 'Deleted Driver',
          phone: 'REMOVED',
          homeAddress: null,
          latitude: null,
          longitude: null,
          emergencyContactName: null,
          emergencyContactPhone: null,
          licenceNumber: `DELETED-${driver.id}`,
          profilePhotoKey: null,
          applicantNotes: null,
          isActive: false,
          availability: 'OFFLINE',
        },
      });
      const vehicles = await tx.driverVehicle.findMany({
        where: { driverProfileId: driver.id },
        select: { id: true, photoKeys: true },
      });
      for (const vehicle of vehicles) {
        orphanedKeys.push(...vehicle.photoKeys);
        await tx.driverVehicle.update({
          where: { id: vehicle.id },
          data: {
            licencePlate: `DELETED-${vehicle.id}`,
            registrationNumber: null,
            insuranceProvider: null,
            insurancePolicyNumber: null,
            photoKeys: [],
          },
        });
      }
    }

    const passengerDriver = await tx.passengerDriverProfile.findUnique({
      where: { userId },
      select: { id: true, profilePhotoKey: true },
    });
    if (passengerDriver) {
      if (passengerDriver.profilePhotoKey) orphanedKeys.push(passengerDriver.profilePhotoKey);
      await tx.passengerDriverProfile.update({
        where: { id: passengerDriver.id },
        data: {
          legalName: 'Deleted Driver',
          displayName: 'Deleted Driver',
          phone: 'REMOVED',
          homeAddress: null,
          latitude: null,
          longitude: null,
          emergencyContactName: null,
          emergencyContactPhone: null,
          licenceNumber: `DELETED-${passengerDriver.id}`,
          profilePhotoKey: null,
          applicantNotes: null,
          isActive: false,
          availability: 'OFFLINE',
        },
      });
      // PassengerVehicle: the schema's own comment says it "mirrors
      // DriverVehicle's approval/registration/insurance shape" -- and
      // DriverVehicle gets exactly this treatment above. Only the
      // ownerDriverProfileId path: this is the ONE vehicle this driver
      // personally owns, the passenger-transport equivalent of the
      // single DriverVehicle a delivery driver owns. A vehicle reached
      // instead via providerProfileId is a FLEET asset a provider makes
      // available to potentially several drivers at once (see
      // PassengerFleetAffiliation) -- other, still-active drivers may be
      // assigned to it right now, so it is deliberately NOT touched here
      // even when the provider itself is the account being deleted (see
      // MDF-949's PR body for why that is reported, not fixed, in this
      // card).
      const ownedPassengerVehicles = await tx.passengerVehicle.findMany({
        where: { ownerDriverProfileId: passengerDriver.id },
        select: { id: true, photoKeys: true },
      });
      for (const vehicle of ownedPassengerVehicles) {
        orphanedKeys.push(...vehicle.photoKeys);
        await tx.passengerVehicle.update({
          where: { id: vehicle.id },
          data: {
            licencePlate: `DELETED-${vehicle.id}`,
            registrationNumber: null,
            insuranceProvider: null,
            insurancePolicyNumber: null,
            photoKeys: [],
          },
        });
      }
    }

    const jobSeeker = await tx.jobSeekerProfile.findUnique({
      where: { userId },
      select: { id: true, photoKey: true },
    });
    if (jobSeeker) {
      if (jobSeeker.photoKey) orphanedKeys.push(jobSeeker.photoKey);
      await tx.jobSeekerProfile.update({
        where: { id: jobSeeker.id },
        data: { preferredName: 'Deleted', legalName: null, contactEmail: null, contactPhone: null, photoKey: null },
      });
    }

    const employer = await tx.employerProfile.findUnique({ where: { userId }, select: { id: true } });
    if (employer) {
      await tx.employerProfile.update({
        where: { id: employer.id },
        data: { contactEmail: `deleted-${employer.id}@deleted.bmpl.internal`, contactPhone: null },
      });
    }

    const propertyOwner = await tx.propertyOwnerProfile.findUnique({ where: { userId }, select: { id: true } });
    if (propertyOwner) {
      await tx.propertyOwnerProfile.update({
        where: { id: propertyOwner.id },
        data: { legalName: 'Deleted Owner', displayName: null, phone: null, email: null },
      });
    }

    const agent = await tx.realEstateAgentProfile.findUnique({
      where: { userId },
      select: { id: true, photoKey: true },
    });
    if (agent) {
      if (agent.photoKey) orphanedKeys.push(agent.photoKey);
      await tx.realEstateAgentProfile.update({
        where: { id: agent.id },
        data: { displayName: 'Deleted Agent', legalName: null, phone: null, email: null, photoKey: null, isActive: false },
      });
    }

    const agency = await tx.agencyProfile.findUnique({ where: { managerUserId: userId }, select: { id: true } });
    if (agency) {
      await tx.agencyProfile.update({
        where: { id: agency.id },
        data: { contactEmail: `deleted-agency-${agency.id}@deleted.bmpl.internal`, contactPhone: null },
      });
    }

    const vendorForLocations = await tx.vendorProfile.findUnique({ where: { userId }, select: { id: true } });
    if (vendorForLocations) {
      await tx.vendorProfile.update({
        where: { id: vendorForLocations.id },
        data: { contactEmail: `deleted-${vendorForLocations.id}@deleted.bmpl.internal`, contactPhone: null },
      });
      await tx.vendorLocation.updateMany({
        where: { vendorProfileId: vendorForLocations.id },
        data: { addressLine1: 'Address removed', addressLine2: null, latitude: null, longitude: null, pickupInstructions: null },
      });
    }

    const passengerProviderForAnon = await tx.passengerProviderProfile.findUnique({ where: { userId }, select: { id: true } });
    if (passengerProviderForAnon) {
      await tx.passengerProviderProfile.update({
        where: { id: passengerProviderForAnon.id },
        data: {
          contactEmail: `deleted-${passengerProviderForAnon.id}@deleted.bmpl.internal`,
          contactPhone: null,
          addressLine1: null,
          operatingLicenceNumber: null,
        },
      });
    }

    const shippingProviderForAnon = await tx.shippingProviderProfile.findUnique({ where: { userId }, select: { id: true } });
    if (shippingProviderForAnon) {
      await tx.shippingProviderProfile.update({
        where: { id: shippingProviderForAnon.id },
        data: {
          contactEmail: `deleted-${shippingProviderForAnon.id}@deleted.bmpl.internal`,
          contactPhone: null,
          addressLine1: null,
          operatingLicenceNumber: null,
        },
      });
    }

    // RoleApplicationDocument: across every application this account ever
    // submitted, not just the live profile it ended up with — see the doc
    // comment above for why storageKey/label are handled this way.
    const roleApplicationIds = (await tx.roleApplication.findMany({ where: { userId }, select: { id: true } })).map((a) => a.id);
    if (roleApplicationIds.length > 0) {
      const documents = await tx.roleApplicationDocument.findMany({
        where: { applicationId: { in: roleApplicationIds } },
        select: { id: true, storageKey: true },
      });
      for (const doc of documents) {
        orphanedKeys.push(doc.storageKey);
        await tx.roleApplicationDocument.update({ where: { id: doc.id }, data: { storageKey: `deleted-${doc.id}`, label: null } });
      }
    }

    // JobSeekerResume: the CV itself, a separate table from JobSeekerProfile.
    if (jobSeeker) {
      const resumes = await tx.jobSeekerResume.findMany({ where: { profileId: jobSeeker.id }, select: { id: true, storageKey: true } });
      for (const resume of resumes) {
        orphanedKeys.push(resume.storageKey);
        await tx.jobSeekerResume.update({ where: { id: resume.id }, data: { storageKey: `deleted-${resume.id}`, label: 'Removed' } });
      }
    }

    // PropertyDocument: only via listings this user OWNS (propertyOwnerProfile),
    // never via listings they merely agent — see the doc comment above for why.
    if (propertyOwner) {
      const ownedListingIds = (
        await tx.propertyListing.findMany({ where: { ownerProfileId: propertyOwner.id }, select: { id: true } })
      ).map((l) => l.id);
      if (ownedListingIds.length > 0) {
        const propertyDocs = await tx.propertyDocument.findMany({
          where: { listingId: { in: ownedListingIds } },
          select: { id: true, storageKey: true },
        });
        for (const doc of propertyDocs) {
          orphanedKeys.push(doc.storageKey);
          await tx.propertyDocument.update({ where: { id: doc.id }, data: { storageKey: `deleted-${doc.id}`, label: null } });
        }
      }
    }

    return orphanedKeys;
  }

  /**
   * Live, hand-off-worthy responsibilities that must block deletion — each
   * entry is a complete, honest explanation of what to do first, per
   * MDF-924's requirement that a refusal here is a real response, not a
   * silent failure.
   *
   * Driver/vendor/terminal/passenger-driver checks, each with a concrete,
   * pre-existing mechanism behind it (no invented business floor):
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
   * - CUSTOMER with an in-flight order or shipment (acceptance round 2): an
   *   open VendorOrder/OrderDelivery, or a Shipment not yet DRAFT/DELIVERED/
   *   CANCELLED/RETURNED, where THIS account is the customer who placed it.
   *   The delivery or shipment keeps moving either way, but the person who
   *   has to read out a pickup or delivery code could no longer sign in.
   *   Checked for the customer, not the recipient — a shipment's claimed
   *   recipient deleting their own account is a different, unaddressed
   *   case, not guessed at here.
   * - Passenger operator with an open booking (REQUESTED/CONFIRMED): the
   *   same count-based shape as the vendor open-order check, substituting
   *   PassengerBooking for VendorOrder — structurally identical, so treated
   *   the same rather than left as a gap.
   * - Employer with an applicant still awaiting a decision: the same shape
   *   again, substituting JobApplication for VendorOrder.
   *
   * Two checks are of a DIFFERENT KIND and are NOT business floors:
   *
   * - Wallet funds, a hold or an escrow balance (acceptance round 2):
   *   refuses rather than sweeps, transfers or zeroes anything — moving
   *   money to tidy up a deletion would itself be a financial transaction,
   *   out of bounds here exactly as real-money movement is everywhere else
   *   in this codebase (root CLAUDE.md §4). The only safe direction is
   *   refusal; there is no mechanism in this card's scope that could clear
   *   it instead.
   * - The last-super-admin guard: there is no last-admin *business* rule
   *   anywhere in this codebase (checked `AdminPermissionGrant`/`UserRole`
   *   before deciding not to invent one) — but deleting the only remaining
   *   SUPER_ADMIN is an IRREVERSIBLE platform state (nobody left who can
   *   grant admin access to anyone, including back to this same person),
   *   whereas refusing it is recoverable in one step (promote another
   *   SUPER_ADMIN, then delete). This is an anti-lockout guard against an
   *   asymmetric, irreversible outcome, not a judgment about how many
   *   admins the business should have.
   *
   * Deliberately does NOT check (surveyed, not guessed — acceptance round
   * 2 asked for the survey explicitly):
   *
   * - An "operator" floor (terminal OPERATOR has no floor in
   *   `assertManagerFloorHolds` either — only MANAGER count matters —
   *   mirroring how `staffDeactivateMember` already treats the two
   *   differently).
   * - A shipping-carrier owner floor. `ShippingProviderMember` has the
   *   identical OWNER/STAFF + ACTIVE/ENDED shape `TerminalCompanyMember`
   *   has, but — unlike the terminal case — there is no
   *   `assertManagerFloorHolds`-equivalent anywhere for it; grepped for
   *   one and found none. Building a floor here would be inventing the
   *   exact business rule root CLAUDE.md §12 warns against, so this is
   *   reported, not built. If a sole carrier owner deleting their account
   *   should be blocked, that is a real gap — but it is a new rule to
   *   decide, not an existing one to mirror.
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
        where: { vendorProfileId: vendor.id, ...vendorOrderStillOpenWhere },
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

    // CUSTOMER with an in-flight order — checked across every order THIS
    // account placed, not the vendor's own (already checked above). Reuses
    // vendorOrderStillOpenWhere (PENDING/PREPARING/not-yet-terminal
    // READY_FOR_PICKUP) plus one more combination that doesn't occur in
    // practice today but is kept to match the status machine's intent:
    // VendorOrder.status itself at PICKED_UP with an OrderDelivery still
    // moving (LIVE_DRIVER_STATUSES) would also count, if it ever happens.
    // ACCT-DELETE-DELIVERY-BLOCKS: this comment previously said a
    // READY_FOR_PICKUP vendor-order was always "still with the vendor" —
    // true for PICKUP, false for DELIVERY, where it never leaves
    // READY_FOR_PICKUP at all. See vendorOrderStillOpenWhere's own comment.
    const inFlightOrders = await this.prisma.vendorOrder.count({
      where: {
        order: { userId },
        OR: [vendorOrderStillOpenWhere, { status: 'PICKED_UP', delivery: { status: { in: LIVE_DRIVER_STATUSES } } }],
      },
    });
    if (inFlightOrders > 0) {
      reasons.push(
        `You have ${inFlightOrders} order${inFlightOrders === 1 ? '' : 's'} still being fulfilled or delivered. Wait for ${inFlightOrders === 1 ? 'it' : 'them'} to finish before deleting your account.`,
      );
    }

    // CUSTOMER with an in-flight shipment — same reasoning, the Shipment
    // table. Checked on customerUserId (who booked it), not recipientUserId
    // (who is receiving it) — see the doc comment above for why.
    const inFlightShipments = await this.prisma.shipment.count({
      where: { customerUserId: userId, status: { in: LIVE_SHIPMENT_STATUSES } },
    });
    if (inFlightShipments > 0) {
      reasons.push(
        `You have ${inFlightShipments} shipment${inFlightShipments === 1 ? '' : 's'} still moving. Wait for ${inFlightShipments === 1 ? 'it' : 'them'} to finish before deleting your account.`,
      );
    }

    // Wallet funds, a hold or an escrow balance — refuse, never sweep. See
    // the doc comment above: moving the money to clear this would itself be
    // a financial transaction, out of bounds here. Trusting
    // `cachedBalanceMinor` rather than re-summing the ledger is safe: it is
    // only ever written inside the SAME transaction as the ledger entries
    // that justify it (`WalletService.postTransaction`, the one and only
    // place a transaction posts), so it cannot be stale relative to the
    // ledger it mirrors.
    const walletAccounts = await this.prisma.walletAccount.findMany({
      where: { userId },
      select: { id: true, cachedBalanceMinor: true },
    });
    const hasBalance = walletAccounts.some((a) => a.cachedBalanceMinor !== 0n);
    let hasOpenHold = false;
    if (walletAccounts.length > 0) {
      const openHolds = await this.prisma.walletHold.count({
        where: {
          walletAccountId: { in: walletAccounts.map((a) => a.id) },
          status: { in: OPEN_WALLET_HOLD_STATUSES },
        },
      });
      hasOpenHold = openHolds > 0;
    }
    if (hasBalance || hasOpenHold) {
      // Acceptance round 3: the previous copy told the person to "withdraw"
      // — there is no withdrawal, payout or refund-to-source route anywhere
      // in this product (root CLAUDE.md §4/§8), so that instruction could
      // never be followed. State the blocking fact only; do not promise a
      // route that does not exist. The permanent handling of a stranded
      // non-zero balance (e.g. self-service UAT test credit with nowhere to
      // go) is an owner decision, not something to guess at here.
      reasons.push(
        'Your wallet still holds funds, a hold, or an escrow balance, and this account cannot be deleted while it does. This product has no way to remove funds from a wallet today.',
      );
    }

    // Passenger operator with an open booking — same shape as the vendor
    // open-order check above, substituting PassengerBooking for VendorOrder.
    const passengerProvider = await this.prisma.passengerProviderProfile.findUnique({
      where: { userId },
      select: { id: true, businessName: true },
    });
    if (passengerProvider) {
      const openBookings = await this.prisma.passengerBooking.count({
        where: { status: { in: OPEN_PASSENGER_BOOKING_STATUSES }, trip: { providerProfileId: passengerProvider.id } },
      });
      if (openBookings > 0) {
        reasons.push(
          `Your transport operator "${passengerProvider.businessName}" has ${openBookings} booking${openBookings === 1 ? '' : 's'} still open. Complete or cancel ${openBookings === 1 ? 'it' : 'them'} before deleting your account.`,
        );
      }
    }

    // Employer with an applicant still awaiting a decision — same shape
    // again, substituting JobApplication for VendorOrder.
    const employerForCheck = await this.prisma.employerProfile.findUnique({
      where: { userId },
      select: { id: true, companyName: true },
    });
    if (employerForCheck) {
      const openApplicants = await this.prisma.jobApplication.count({
        where: { status: { in: OPEN_JOB_APPLICATION_STATUSES }, job: { employerProfileId: employerForCheck.id } },
      });
      if (openApplicants > 0) {
        reasons.push(
          `"${employerForCheck.companyName}" has ${openApplicants} applicant${openApplicants === 1 ? '' : 's'} still awaiting a decision. Resolve ${openApplicants === 1 ? 'their application' : 'their applications'} before deleting your account.`,
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

  /**
   * Best-effort cleanup of a superseded object; failure must not fail the
   * request. Harmless for an avatar — a stray file nobody can find is just
   * wasted storage. NOT harmless for an identity document orphaned by
   * {@link anonymizePersonalData} (acceptance round 4): the database row
   * pointing at it has already been overwritten inside the committed
   * transaction by the time this runs, so a failed delete here leaves a
   * licence photo or a title deed sitting in the private bucket with
   * nothing left to find it by and no way to retry. Log the key so an
   * operator can still purge it by hand — a storage key is not personal
   * data, there is nothing in it to protect by staying silent.
   */
  private async deleteQuietly(key: string | null | undefined): Promise<void> {
    if (!key) return;
    try {
      await this.storage.deleteObject(key);
    } catch (err) {
      this.logger.warn(`Failed to delete orphaned storage object, key=${key}: ${err instanceof Error ? err.message : err}`);
    }
  }
}
