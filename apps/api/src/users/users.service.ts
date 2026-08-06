import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { UpdateProfileInput } from '@bmpl/validation';
import {
  AVATAR_REJECTION_REASONS,
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
import { publicAvatarUrl } from '../common/avatar-url';

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
      include: { roles: true },
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
      avatarUrl: publicAvatarUrl(user),
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
   * Resolve a user's approved picture to a short-lived signed storage URL, for the
   * public `GET /users/:id/avatar` redirect. Returns null for every state other
   * than APPROVED, so a pending or rejected image is never served to anyone.
   */
  async approvedAvatarDownloadUrl(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarKey: true, avatarStatus: true, status: true },
    });
    if (!user) throw new NotFoundException('User not found.');
    // A suspended account's face stops being shown alongside its activity.
    if (user.status !== 'ACTIVE') return null;
    if (user.avatarStatus !== 'APPROVED' || !user.avatarKey) return null;
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
