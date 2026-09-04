import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_MARKETING_TIMEZONE,
  IMAGE_ASSET_KINDS,
  isAllowedProductImageMime,
  MAX_PRODUCT_IMAGE_BYTES,
  MAX_PROMOTION_ASSETS,
  STORAGE_PREFIX,
  type PromotionAssetKind,
  type PromotionStatus,
  type PromotionTargetType,
} from '@bmpl/shared';
import type {
  CreatePromotionInput,
  PromotionAssetConfirmInput,
  PromotionModerateInput,
  PromotionOwnerActionInput,
  SetPlacementsInput,
  SetTargetsInput,
  UpdatePromotionInput,
} from '@bmpl/validation';
import { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { UploadIngestService } from '../storage/upload-ingest.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface Actor {
  userId: string;
  status?: string;
  permissions?: string[];
}

/** A single target-input row (from setTargets / createPromotion). */
type TargetInput = SetTargetsInput['targets'][number];

/** Statuses in which an owner may still edit a promotion's content. */
const EDITABLE: PromotionStatus[] = ['DRAFT', 'REJECTED', 'MORE_INFO_REQUIRED'];
/** Statuses eligible for (re)submission to moderation. */
const SUBMITTABLE: PromotionStatus[] = ['DRAFT', 'REJECTED', 'MORE_INFO_REQUIRED'];
/** Statuses in the admin moderation queue. */
const REVIEWABLE: PromotionStatus[] = ['SUBMITTED', 'UNDER_REVIEW'];

const n = (v: bigint | null | undefined) => (v == null ? null : Number(v));

/** Which single FK column carries a given target type (null = url/none). */
const TARGET_FK: Record<PromotionTargetType, keyof TargetInput | null> = {
  VENDOR: 'vendorProfileId',
  EMPLOYER: 'employerProfileId',
  AGENCY: 'agencyProfileId',
  AGENT: 'agentProfileId',
  PROPERTY_OWNER: 'propertyOwnerProfileId',
  PRODUCT: 'productId',
  JOB: 'jobListingId',
  PROPERTY: 'propertyListingId',
  EXTERNAL_LINK: null,
  NONE: null,
};
const ALL_FK_FIELDS: Array<keyof TargetInput> = [
  'vendorProfileId', 'employerProfileId', 'agencyProfileId', 'agentProfileId',
  'propertyOwnerProfileId', 'productId', 'jobListingId', 'propertyListingId',
];

/** Prisma include that resolves every target relation + campaign for serving/detail. */
const SERVE_INCLUDE = {
  assets: { orderBy: { position: 'asc' } },
  placements: true,
  campaign: { select: { id: true, name: true, status: true } },
  targets: {
    include: {
      vendorProfile: { select: { id: true, userId: true, businessName: true, slug: true, logoKey: true, approvalStatus: true, isTest: true } },
      employerProfile: { select: { id: true, userId: true, companyName: true, slug: true, logoKey: true, approvalStatus: true } },
      agencyProfile: { select: { id: true, managerUserId: true, name: true, slug: true, logoKey: true, approvalStatus: true } },
      agentProfile: { select: { id: true, userId: true, displayName: true, slug: true, photoKey: true, approvalStatus: true, isActive: true } },
      propertyOwnerProfile: { select: { id: true, userId: true, displayName: true, legalName: true, approvalStatus: true } },
      product: { select: { id: true, title: true, slug: true, status: true, priceMinor: true, currency: true, vendorProfile: { select: { userId: true, approvalStatus: true, isTest: true } }, images: { where: { isPrimary: true }, take: 1, select: { storageKey: true } } } },
      jobListing: { select: { id: true, title: true, slug: true, status: true, employerProfile: { select: { userId: true, approvalStatus: true, companyName: true } } } },
      propertyListing: { select: { id: true, title: true, slug: true, status: true, priceMinor: true, currency: true, ownerProfile: { select: { userId: true, approvalStatus: true } }, agentProfile: { select: { userId: true, approvalStatus: true } }, images: { where: { isPrimary: true }, take: 1, select: { storageKey: true } } } },
    },
  },
} satisfies Prisma.PromotionInclude;

export type PromotionWithRelations = Prisma.PromotionGetPayload<{ include: typeof SERVE_INCLUDE }>;
type ResolvedTarget = PromotionWithRelations['targets'][number];

/**
 * Promotions (M26). Owner-authored, moderated before serving: an owner can never bypass
 * moderation (submit → admin approve → APPROVED + isActive). Every write is ownership-
 * scoped to ownerUserId === actor (cross-owner access is a 404), and every target set on
 * a promotion is verified to be owned by the actor. Promotions render as ADDITIVE
 * placements and never mutate organic marketplace/search ranking. Assets live in the
 * PUBLIC bucket. There is no PromotionStatusHistory table — transitions are audited.
 */
@Injectable()
export class PromotionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ingest: UploadIngestService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ===========================================================================
  // Authorization
  // ===========================================================================
  /** Load a promotion the actor OWNS, or 404. */
  private async requireOwned(actor: Actor, promotionId: string) {
    const promo = await this.prisma.promotion.findUnique({ where: { id: promotionId } });
    if (!promo || promo.ownerUserId !== actor.userId) throw new NotFoundException('Promotion not found.');
    return promo;
  }

  private assertEditable(status: PromotionStatus) {
    if (!EDITABLE.includes(status)) throw new BadRequestException('Only a draft, rejected, or more-info promotion can be edited.');
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================
  async create(actor: Actor, dto: CreatePromotionInput) {
    if (dto.campaignId) await this.requireOwnedCampaign(actor, dto.campaignId);
    const targetData = dto.targets ? await Promise.all(dto.targets.map((t) => this.verifyTargetOwnership(actor, t))) : [];
    const placementData = dto.placements ? await this.buildPlacements(dto.placements) : [];
    const promo = await this.prisma.promotion.create({
      data: {
        ownerUserId: actor.userId,
        campaignId: dto.campaignId ?? null,
        type: dto.type,
        title: dto.title,
        subtitle: dto.subtitle ?? null,
        description: dto.description ?? null,
        status: 'DRAFT',
        priority: dto.priority ?? 0,
        isActive: false,
        startAt: dto.startAt ?? null,
        endAt: dto.endAt ?? null,
        timezone: dto.timezone ?? DEFAULT_MARKETING_TIMEZONE,
        targets: targetData.length ? { create: targetData } : undefined,
        placements: placementData.length ? { create: placementData } : undefined,
      },
    });
    await this.audit.record({ action: 'PROMOTION_CREATED', actorId: actor.userId, newValue: { promotionId: promo.id } });
    return this.managedDetail(actor, promo.id);
  }

  async update(actor: Actor, promotionId: string, dto: UpdatePromotionInput) {
    const promo = await this.requireOwned(actor, promotionId);
    this.assertEditable(promo.status);
    if (dto.campaignId) await this.requireOwnedCampaign(actor, dto.campaignId);
    await this.prisma.promotion.update({
      where: { id: promotionId },
      data: {
        title: dto.title ?? undefined,
        subtitle: dto.subtitle === undefined ? undefined : dto.subtitle,
        description: dto.description === undefined ? undefined : dto.description,
        campaignId: dto.campaignId === undefined ? undefined : dto.campaignId,
        priority: dto.priority ?? undefined,
        startAt: dto.startAt === undefined ? undefined : dto.startAt,
        endAt: dto.endAt === undefined ? undefined : dto.endAt,
        timezone: dto.timezone === undefined ? undefined : (dto.timezone ?? DEFAULT_MARKETING_TIMEZONE),
      },
    });
    await this.audit.record({ action: 'PROMOTION_UPDATED', actorId: actor.userId, newValue: { promotionId } });
    return this.managedDetail(actor, promotionId);
  }

  async submit(actor: Actor, promotionId: string) {
    const promo = await this.requireOwned(actor, promotionId);
    if (!SUBMITTABLE.includes(promo.status)) throw new BadRequestException('This promotion cannot be submitted from its current status.');
    const targetCount = await this.prisma.promotionTarget.count({ where: { promotionId } });
    if (targetCount === 0) throw new BadRequestException('Add at least one target (or a banner target) before submitting.');
    await this.prisma.promotion.update({
      where: { id: promotionId },
      data: { status: 'SUBMITTED', submittedAt: new Date(), isActive: false, moderationReason: null },
    });
    await this.audit.record({ action: 'PROMOTION_SUBMITTED', actorId: actor.userId, newValue: { promotionId } });
    await this.notifications.notifyAdmins('promotions.read', {
      type: 'MARKETPLACE', category: 'PROMOTION', event: 'PROMOTION_SUBMITTED',
      title: 'Promotion submitted for review', body: `"${promo.title}" was submitted for review.`, data: { promotionId },
    });
    return this.managedDetail(actor, promotionId);
  }

  async ownerStatus(actor: Actor, promotionId: string, dto: PromotionOwnerActionInput) {
    const promo = await this.requireOwned(actor, promotionId);
    const s = promo.status as PromotionStatus;
    let to: PromotionStatus = s;
    const extra: Prisma.PromotionUncheckedUpdateInput = {};
    switch (dto.action) {
      case 'PAUSE':
        if (s !== 'APPROVED') throw new BadRequestException('Only an approved promotion can be paused.');
        to = 'PAUSED';
        extra.isActive = false;
        break;
      case 'RESUME':
        if (s !== 'PAUSED') throw new BadRequestException('Only a paused promotion can be resumed.');
        to = 'APPROVED';
        extra.isActive = true;
        break;
      case 'ARCHIVE':
        if (['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'].includes(s)) throw new BadRequestException('Pause or wait for review before archiving.');
        to = 'ARCHIVED';
        extra.isActive = false;
        break;
    }
    await this.prisma.promotion.update({ where: { id: promotionId }, data: { status: to, ...extra } });
    await this.audit.record({ action: 'PROMOTION_STATUS_CHANGED', actorId: actor.userId, newValue: { promotionId, from: s, to } });
    return this.managedDetail(actor, promotionId);
  }

  // ===========================================================================
  // Admin moderation (mirrors properties.service.moderate)
  // ===========================================================================
  async moderate(actor: Actor, promotionId: string, dto: PromotionModerateInput) {
    const promo = await this.prisma.promotion.findUnique({ where: { id: promotionId } });
    if (!promo) throw new NotFoundException('Promotion not found.');
    const s = promo.status as PromotionStatus;
    let to: PromotionStatus = s;
    const extra: Prisma.PromotionUncheckedUpdateInput = {};
    let title = 'Promotion update';
    switch (dto.action) {
      case 'APPROVE':
        if (!REVIEWABLE.includes(s)) throw new BadRequestException('Only a submitted promotion can be approved.');
        to = 'APPROVED';
        title = 'Your promotion is live';
        extra.isActive = true;
        extra.approvedAt = new Date();
        if (!promo.publishedAt) extra.publishedAt = new Date();
        break;
      case 'REJECT':
        if (!REVIEWABLE.includes(s)) throw new BadRequestException('Only a submitted promotion can be rejected.');
        to = 'REJECTED';
        title = 'Your promotion was not approved';
        extra.isActive = false;
        break;
      case 'REQUEST_INFO':
        if (!REVIEWABLE.includes(s)) throw new BadRequestException('Only a submitted promotion can be returned for more info.');
        to = 'MORE_INFO_REQUIRED';
        title = 'More information needed';
        break;
      case 'PAUSE':
        if (s !== 'APPROVED') throw new BadRequestException('Only an approved promotion can be paused.');
        to = 'PAUSED';
        title = 'Your promotion was paused';
        extra.isActive = false;
        break;
      case 'EXPIRE':
        if (!['APPROVED', 'PAUSED'].includes(s)) throw new BadRequestException('Only an approved or paused promotion can be expired.');
        to = 'EXPIRED';
        title = 'Your promotion has expired';
        extra.isActive = false;
        extra.expiredAt = new Date();
        break;
      case 'ARCHIVE':
        to = 'ARCHIVED';
        title = 'Your promotion was archived';
        extra.isActive = false;
        break;
      case 'RESTORE':
        if (!['PAUSED', 'EXPIRED', 'REJECTED', 'ARCHIVED'].includes(s)) throw new BadRequestException('Only a paused, expired, rejected, or archived promotion can be restored.');
        to = 'APPROVED';
        title = 'Your promotion was restored';
        extra.isActive = true;
        if (!promo.publishedAt) extra.publishedAt = new Date();
        break;
    }
    await this.prisma.promotion.update({
      where: { id: promotionId },
      data: { status: to, moderationReason: dto.reason ?? null, moderatedById: actor.userId, ...extra },
    });
    await this.audit.record({
      action: to === 'APPROVED' && dto.action === 'APPROVE' ? 'PROMOTION_PUBLISHED' : 'PROMOTION_MODERATED',
      actorId: actor.userId,
      newValue: { promotionId, action: dto.action, reason: dto.reason ?? null },
    });
    await this.notifications.createInApp({
      userId: promo.ownerUserId, type: 'MARKETPLACE', category: 'PROMOTION', event: 'PROMOTION_MODERATED',
      title, body: dto.reason ? `${title}: ${dto.reason}` : title, data: { promotionId, status: to },
    });
    return this.adminDetail(promotionId);
  }

  /** Admin priority / feature toggle (promotions.manage). */
  async setPriority(actor: Actor, promotionId: string, dto: { priority?: number; isActive?: boolean }) {
    const promo = await this.prisma.promotion.findUnique({ where: { id: promotionId } });
    if (!promo) throw new NotFoundException('Promotion not found.');
    // isActive may only be set true when the promotion is APPROVED.
    const isActive = dto.isActive === undefined ? undefined : dto.isActive && promo.status === 'APPROVED';
    await this.prisma.promotion.update({
      where: { id: promotionId },
      data: {
        priority: dto.priority === undefined ? undefined : Math.max(0, Math.min(1000, Math.trunc(dto.priority))),
        isActive,
      },
    });
    await this.audit.record({ action: 'PROMOTION_STATUS_CHANGED', actorId: actor.userId, newValue: { promotionId, priority: dto.priority, isActive } });
    return this.adminDetail(promotionId);
  }

  // ===========================================================================
  // Placements
  // ===========================================================================
  async setPlacements(actor: Actor, promotionId: string, dto: SetPlacementsInput) {
    const promo = await this.requireOwned(actor, promotionId);
    this.assertEditable(promo.status);
    const data = await this.buildPlacements(dto.placements);
    await this.prisma.$transaction([
      this.prisma.promotionPlacement.deleteMany({ where: { promotionId } }),
      ...(data.length ? [this.prisma.promotionPlacement.createMany({ data: data.map((d) => ({ ...d, promotionId })) })] : []),
    ]);
    await this.audit.record({ action: 'PROMOTION_UPDATED', actorId: actor.userId, newValue: { promotionId, placements: data.length } });
    return this.managedDetail(actor, promotionId);
  }

  /** Validate + dedupe placements; categoryId must reference an existing category. */
  private async buildPlacements(placements: SetPlacementsInput['placements']) {
    const out: Array<{ placement: PromotionWithRelations['placements'][number]['placement']; position: number; categoryId: string | null }> = [];
    const seen = new Set<string>();
    for (const p of placements) {
      if (p.categoryId) {
        const cat = await this.prisma.category.findUnique({ where: { id: p.categoryId }, select: { id: true } });
        if (!cat) throw new BadRequestException('Placement category not found.');
      }
      const key = `${p.placement}:${p.categoryId ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ placement: p.placement as never, position: p.position ?? 0, categoryId: p.categoryId ?? null });
    }
    return out;
  }

  // ===========================================================================
  // Targets (ownership verification is the security core)
  // ===========================================================================
  async setTargets(actor: Actor, promotionId: string, dto: SetTargetsInput) {
    const promo = await this.requireOwned(actor, promotionId);
    this.assertEditable(promo.status);
    const data = await Promise.all(dto.targets.map((t) => this.verifyTargetOwnership(actor, t)));
    await this.prisma.$transaction([
      this.prisma.promotionTarget.deleteMany({ where: { promotionId } }),
      ...(data.length ? [this.prisma.promotionTarget.createMany({ data: data.map((d) => ({ ...d, promotionId })) })] : []),
    ]);
    await this.audit.record({ action: 'PROMOTION_UPDATED', actorId: actor.userId, newValue: { promotionId, targets: data.length } });
    return this.managedDetail(actor, promotionId);
  }

  /**
   * Verify the actor owns the target, and that exactly one FK matching targetType is set.
   * Returns the normalized create-data for a PromotionTarget row. Throws 403/404 otherwise.
   */
  private async verifyTargetOwnership(actor: Actor, t: TargetInput): Promise<Prisma.PromotionTargetCreateManyPromotionInput> {
    const expected = TARGET_FK[t.targetType];
    // Reject any FK that doesn't match the declared target type.
    for (const f of ALL_FK_FIELDS) {
      if (f !== expected && t[f]) throw new BadRequestException(`Unexpected ${f} for target type ${t.targetType}.`);
    }
    const base = { targetType: t.targetType } as Prisma.PromotionTargetCreateManyPromotionInput;

    switch (t.targetType) {
      case 'NONE':
        return base;
      case 'EXTERNAL_LINK':
        if (!t.externalUrl) throw new BadRequestException('externalUrl is required for an external-link target.');
        return { ...base, externalUrl: t.externalUrl };
      case 'VENDOR': {
        const id = this.requireFk(t, 'vendorProfileId');
        const v = await this.prisma.vendorProfile.findUnique({ where: { id }, select: { userId: true } });
        this.assertOwner(v?.userId, actor);
        return { ...base, vendorProfileId: id };
      }
      case 'EMPLOYER': {
        const id = this.requireFk(t, 'employerProfileId');
        const e = await this.prisma.employerProfile.findUnique({ where: { id }, select: { userId: true } });
        this.assertOwner(e?.userId, actor);
        return { ...base, employerProfileId: id };
      }
      case 'AGENCY': {
        const id = this.requireFk(t, 'agencyProfileId');
        const a = await this.prisma.agencyProfile.findUnique({ where: { id }, select: { managerUserId: true } });
        this.assertOwner(a?.managerUserId, actor);
        return { ...base, agencyProfileId: id };
      }
      case 'AGENT': {
        const id = this.requireFk(t, 'agentProfileId');
        const a = await this.prisma.realEstateAgentProfile.findUnique({ where: { id }, select: { userId: true } });
        this.assertOwner(a?.userId, actor);
        return { ...base, agentProfileId: id };
      }
      case 'PROPERTY_OWNER': {
        const id = this.requireFk(t, 'propertyOwnerProfileId');
        const o = await this.prisma.propertyOwnerProfile.findUnique({ where: { id }, select: { userId: true } });
        this.assertOwner(o?.userId, actor);
        return { ...base, propertyOwnerProfileId: id };
      }
      case 'PRODUCT': {
        const id = this.requireFk(t, 'productId');
        const p = await this.prisma.product.findUnique({ where: { id }, select: { vendorProfile: { select: { userId: true } } } });
        this.assertOwner(p?.vendorProfile.userId, actor);
        return { ...base, productId: id };
      }
      case 'JOB': {
        const id = this.requireFk(t, 'jobListingId');
        const j = await this.prisma.jobListing.findUnique({ where: { id }, select: { employerProfile: { select: { userId: true } } } });
        this.assertOwner(j?.employerProfile.userId, actor);
        return { ...base, jobListingId: id };
      }
      case 'PROPERTY': {
        const id = this.requireFk(t, 'propertyListingId');
        const l = await this.prisma.propertyListing.findUnique({ where: { id }, select: { ownerProfile: { select: { userId: true } }, agentProfile: { select: { userId: true } } } });
        if (!l) throw new NotFoundException('Property listing not found.');
        if (l.ownerProfile.userId !== actor.userId && l.agentProfile?.userId !== actor.userId) throw new ForbiddenException('You do not own this property listing.');
        return { ...base, propertyListingId: id };
      }
      default:
        throw new BadRequestException('Unsupported target type.');
    }
  }

  private requireFk(t: TargetInput, field: keyof TargetInput): string {
    const v = t[field];
    if (!v || typeof v !== 'string') throw new BadRequestException(`${field} is required for target type ${t.targetType}.`);
    return v;
  }

  private assertOwner(ownerUserId: string | undefined, actor: Actor) {
    if (!ownerUserId) throw new NotFoundException('Target not found.');
    if (ownerUserId !== actor.userId) throw new ForbiddenException('You do not own this target.');
  }

  // ===========================================================================
  // Assets (PUBLIC bucket)
  // ===========================================================================
  /** Server-side promotion-asset upload (browser → API → public storage). */
  async uploadAsset(actor: Actor, promotionId: string, kind: PromotionAssetKind, buffer: Buffer | undefined, fileName?: string) {
    const promo = await this.requireOwned(actor, promotionId);
    this.assertEditable(promo.status);
    if (!IMAGE_ASSET_KINDS.includes(kind)) throw new BadRequestException('This asset kind is a URL reference, not an uploaded image.');
    const count = await this.prisma.promotionAsset.count({ where: { promotionId } });
    if (count >= MAX_PROMOTION_ASSETS) throw new BadRequestException(`At most ${MAX_PROMOTION_ASSETS} assets per promotion.`);
    return this.ingest.image(buffer, STORAGE_PREFIX.promotionAsset(promotionId), 'public', {
      fileName,
      fallbackName: 'asset',
    });
  }

  /** @deprecated Prefer {@link uploadAsset} — the browser PUT is cross-origin and fails as "Load failed". */
  async presignAsset(actor: Actor, promotionId: string, kind: PromotionAssetKind, fileName: string, contentType: string) {
    const promo = await this.requireOwned(actor, promotionId);
    this.assertEditable(promo.status);
    if (!IMAGE_ASSET_KINDS.includes(kind)) throw new BadRequestException('This asset kind is a URL reference, not an uploaded image.');
    if (!isAllowedProductImageMime(contentType)) throw new BadRequestException('Use a JPEG, PNG, or WebP image.');
    const count = await this.prisma.promotionAsset.count({ where: { promotionId } });
    if (count >= MAX_PROMOTION_ASSETS) throw new BadRequestException(`At most ${MAX_PROMOTION_ASSETS} assets per promotion.`);
    const key = this.storage.buildKey(STORAGE_PREFIX.promotionAsset(promotionId), fileName);
    return this.storage.presignUpload(key, contentType, 'public');
  }

  async confirmAsset(actor: Actor, promotionId: string, dto: PromotionAssetConfirmInput) {
    const promo = await this.requireOwned(actor, promotionId);
    this.assertEditable(promo.status);
    const count = await this.prisma.promotionAsset.count({ where: { promotionId } });
    if (count >= MAX_PROMOTION_ASSETS) throw new BadRequestException(`At most ${MAX_PROMOTION_ASSETS} assets per promotion.`);

    if (dto.kind === 'VIDEO_PLACEHOLDER') {
      if (!dto.videoUrl) throw new BadRequestException('A video URL is required for a video placeholder.');
      const asset = await this.prisma.promotionAsset.create({
        data: { promotionId, kind: dto.kind, videoUrl: dto.videoUrl, altText: dto.altText ?? null, position: dto.position ?? count },
      });
      await this.audit.record({ action: 'PROMOTION_UPDATED', actorId: actor.userId, newValue: { promotionId, assetId: asset.id } });
      return this.managedDetail(actor, promotionId);
    }

    if (!dto.storageKey) throw new BadRequestException('An uploaded storage key is required for an image asset.');
    this.storage.assertKeyInNamespace(dto.storageKey, STORAGE_PREFIX.promotionAsset(promotionId));
    const meta = await this.storage.headObject(dto.storageKey, 'public');
    if (!meta) throw new BadRequestException('The uploaded image could not be found in storage.');
    if (!isAllowedProductImageMime(meta.contentType)) throw new BadRequestException('Use a JPEG, PNG, or WebP image.');
    if (meta.sizeBytes <= 0 || meta.sizeBytes > MAX_PRODUCT_IMAGE_BYTES) throw new BadRequestException('The image exceeds the maximum allowed size.');
    try {
      const asset = await this.prisma.promotionAsset.create({
        data: {
          promotionId, kind: dto.kind, storageKey: dto.storageKey, mimeType: meta.contentType, fileSizeBytes: meta.sizeBytes,
          altText: dto.altText ?? null, position: dto.position ?? count,
        },
      });
      await this.audit.record({ action: 'PROMOTION_UPDATED', actorId: actor.userId, newValue: { promotionId, assetId: asset.id } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new BadRequestException('That asset was already added.');
      throw e;
    }
    return this.managedDetail(actor, promotionId);
  }

  async deleteAsset(actor: Actor, promotionId: string, assetId: string) {
    const promo = await this.requireOwned(actor, promotionId);
    this.assertEditable(promo.status);
    const asset = await this.prisma.promotionAsset.findFirst({ where: { id: assetId, promotionId } });
    if (!asset) throw new NotFoundException('Asset not found.');
    await this.prisma.promotionAsset.delete({ where: { id: assetId } });
    if (asset.storageKey) await this.storage.deleteObject(asset.storageKey, 'public');
    return this.managedDetail(actor, promotionId);
  }

  // ===========================================================================
  // Reads
  // ===========================================================================
  async ownerList(actor: Actor, status?: string) {
    const rows = await this.prisma.promotion.findMany({
      where: { ownerUserId: actor.userId, ...(status ? { status: status as never } : {}) },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      include: SERVE_INCLUDE,
    });
    return Promise.all(rows.map((p) => this.ownerCard(p)));
  }

  async managedDetail(actor: Actor, promotionId: string) {
    await this.requireOwned(actor, promotionId);
    return this.detail(promotionId, { includeModeration: true });
  }

  async adminList(filter: { status?: string; type?: string; reported?: boolean }) {
    const where: Prisma.PromotionWhereInput = {
      ...(filter.status ? { status: filter.status as never } : {}),
      ...(filter.type ? { type: filter.type as never } : {}),
      ...(filter.reported ? { reports: { some: { status: 'OPEN' } } } : {}),
    };
    const rows = await this.prisma.promotion.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
      take: 200,
      include: { ...SERVE_INCLUDE, owner: { select: { email: true } }, _count: { select: { reports: true } } },
    });
    return Promise.all(rows.map(async (p) => ({
      ...(await this.ownerCard(p)),
      moderationReason: p.moderationReason,
      ownerEmail: p.owner?.email ?? null,
      reportCount: p._count.reports,
    })));
  }

  async adminDetail(promotionId: string) {
    const promo = await this.prisma.promotion.findUnique({ where: { id: promotionId }, select: { id: true } });
    if (!promo) throw new NotFoundException('Promotion not found.');
    return this.detail(promotionId, { includeModeration: true });
  }

  // ===========================================================================
  // Serving-time helpers (shared with PromotionDiscoveryService)
  // ===========================================================================
  /** True only if EVERY target on the promotion is still live (see rule #2). */
  targetsLive(targets: ResolvedTarget[]): boolean {
    return targets.every((t) => this.targetLive(t));
  }

  private targetLive(t: ResolvedTarget): boolean {
    switch (t.targetType) {
      case 'NONE':
      case 'EXTERNAL_LINK':
        return true;
      case 'VENDOR':
        // isTest: a simulation storefront's promotion must never serve on a
        // real customer's page, however legitimately it was approved.
        return t.vendorProfile?.approvalStatus === 'APPROVED' && !t.vendorProfile.isTest;
      case 'EMPLOYER':
        return t.employerProfile?.approvalStatus === 'APPROVED';
      case 'AGENCY':
        return t.agencyProfile?.approvalStatus === 'APPROVED';
      case 'AGENT':
        return t.agentProfile != null && t.agentProfile.approvalStatus !== 'SUSPENDED' && t.agentProfile.isActive;
      case 'PROPERTY_OWNER':
        return t.propertyOwnerProfile?.approvalStatus === 'APPROVED';
      case 'PRODUCT':
        return t.product?.status === 'PUBLISHED' && t.product.vendorProfile.approvalStatus === 'APPROVED' && !t.product.vendorProfile.isTest;
      case 'JOB':
        return t.jobListing?.status === 'PUBLISHED' && t.jobListing.employerProfile.approvalStatus === 'APPROVED';
      case 'PROPERTY':
        return (
          t.propertyListing != null &&
          ['PUBLISHED', 'UNDER_OFFER'].includes(t.propertyListing.status) &&
          t.propertyListing.ownerProfile.approvalStatus === 'APPROVED' &&
          (t.propertyListing.agentProfile == null || t.propertyListing.agentProfile.approvalStatus !== 'SUSPENDED')
        );
      default:
        return false;
    }
  }

  /** Resolve a target row into a display card (name/href/image). Best-effort. */
  private async resolveTargetCard(t: ResolvedTarget) {
    switch (t.targetType) {
      case 'VENDOR':
        return t.vendorProfile && { targetType: t.targetType, id: t.vendorProfile.id, label: t.vendorProfile.businessName, slug: t.vendorProfile.slug, href: `/store/${t.vendorProfile.slug}`, imageUrl: await this.urlOrNull(t.vendorProfile.logoKey) };
      case 'EMPLOYER':
        return t.employerProfile && { targetType: t.targetType, id: t.employerProfile.id, label: t.employerProfile.companyName, slug: t.employerProfile.slug, href: `/jobs/employers/${t.employerProfile.slug}`, imageUrl: await this.urlOrNull(t.employerProfile.logoKey) };
      case 'AGENCY':
        return t.agencyProfile && { targetType: t.targetType, id: t.agencyProfile.id, label: t.agencyProfile.name, slug: t.agencyProfile.slug, href: `/properties/agencies/${t.agencyProfile.slug}`, imageUrl: await this.urlOrNull(t.agencyProfile.logoKey) };
      case 'AGENT':
        return t.agentProfile && { targetType: t.targetType, id: t.agentProfile.id, label: t.agentProfile.displayName, slug: t.agentProfile.slug, href: `/properties/agents/${t.agentProfile.slug}`, imageUrl: await this.urlOrNull(t.agentProfile.photoKey) };
      case 'PROPERTY_OWNER':
        return t.propertyOwnerProfile && { targetType: t.targetType, id: t.propertyOwnerProfile.id, label: t.propertyOwnerProfile.displayName ?? t.propertyOwnerProfile.legalName };
      case 'PRODUCT':
        return t.product && { targetType: t.targetType, id: t.product.id, label: t.product.title, slug: t.product.slug, href: `/products/${t.product.slug}`, priceMinor: n(t.product.priceMinor), currency: t.product.currency, imageUrl: await this.urlOrNull(t.product.images[0]?.storageKey ?? null) };
      case 'JOB':
        return t.jobListing && { targetType: t.targetType, id: t.jobListing.id, label: t.jobListing.title, slug: t.jobListing.slug, href: `/jobs/${t.jobListing.slug}`, company: t.jobListing.employerProfile.companyName };
      case 'PROPERTY':
        return t.propertyListing && { targetType: t.targetType, id: t.propertyListing.id, label: t.propertyListing.title, slug: t.propertyListing.slug, href: `/properties/${t.propertyListing.slug}`, priceMinor: n(t.propertyListing.priceMinor), currency: t.propertyListing.currency, imageUrl: await this.urlOrNull(t.propertyListing.images[0]?.storageKey ?? null) };
      case 'EXTERNAL_LINK':
        return { targetType: t.targetType, externalUrl: t.externalUrl };
      case 'NONE':
      default:
        return { targetType: t.targetType };
    }
  }

  private async assetList(assets: PromotionWithRelations['assets']) {
    return Promise.all(
      assets.map(async (a) => ({
        id: a.id, kind: a.kind, altText: a.altText, position: a.position,
        url: a.storageKey ? await this.urlOrNull(a.storageKey) : null,
        videoUrl: a.videoUrl, mimeType: a.mimeType, fileSizeBytes: a.fileSizeBytes,
      })),
    );
  }

  /** Public/serve card: compact promotion + resolved primary target + assets. */
  async serveCard(p: PromotionWithRelations) {
    const targets = (await Promise.all(p.targets.map((t) => this.resolveTargetCard(t)))).filter(Boolean);
    return {
      id: p.id,
      type: p.type,
      title: p.title,
      subtitle: p.subtitle,
      priority: p.priority,
      startAt: p.startAt,
      endAt: p.endAt,
      assets: await this.assetList(p.assets),
      placements: p.placements.map((pl) => ({ placement: pl.placement, position: pl.position, categoryId: pl.categoryId })),
      target: targets[0] ?? null,
      targets,
      publishedAt: p.publishedAt,
    };
  }

  /** Owner/admin card: adds status + activity flags. */
  private async ownerCard(p: PromotionWithRelations) {
    return {
      ...(await this.serveCard(p)),
      status: p.status,
      isActive: p.isActive,
      campaignId: p.campaignId,
      updatedAt: p.updatedAt,
      createdAt: p.createdAt,
    };
  }

  /** Full detail — owner/admin (with moderation) or public (without). */
  async detail(promotionId: string, opts: { includeModeration?: boolean } = {}) {
    const p = await this.prisma.promotion.findUniqueOrThrow({ where: { id: promotionId }, include: SERVE_INCLUDE });
    const targets = (await Promise.all(p.targets.map((t) => this.resolveTargetCard(t)))).filter(Boolean);
    return {
      id: p.id,
      type: p.type,
      title: p.title,
      subtitle: p.subtitle,
      description: p.description,
      status: p.status,
      priority: p.priority,
      isActive: p.isActive,
      startAt: p.startAt,
      endAt: p.endAt,
      timezone: p.timezone,
      campaign: p.campaign ? { id: p.campaign.id, name: p.campaign.name, status: p.campaign.status } : null,
      assets: await this.assetList(p.assets),
      placements: p.placements.map((pl) => ({ id: pl.id, placement: pl.placement, position: pl.position, categoryId: pl.categoryId })),
      targets,
      publishedAt: p.publishedAt,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      ...(opts.includeModeration
        ? { moderationReason: p.moderationReason, moderatedById: p.moderatedById, submittedAt: p.submittedAt, approvedAt: p.approvedAt, expiredAt: p.expiredAt }
        : {}),
    };
  }

  // ===========================================================================
  // helpers
  // ===========================================================================
  async urlOrNull(key: string | null | undefined) {
    if (!key) return null;
    try {
      return (await this.storage.presignDownload(key, 'public')).url;
    } catch {
      return null;
    }
  }

  private async requireOwnedCampaign(actor: Actor, campaignId: string) {
    const c = await this.prisma.campaign.findUnique({ where: { id: campaignId }, select: { ownerUserId: true } });
    if (!c || c.ownerUserId !== actor.userId) throw new NotFoundException('Campaign not found.');
  }

  /** Shared Prisma include for serving (used by PromotionDiscoveryService). */
  static readonly SERVE_INCLUDE = SERVE_INCLUDE;
}
