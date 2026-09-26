import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  aggregateRatings,
  isAllowedProductImageMime,
  MAX_PRODUCT_IMAGE_BYTES,
  MAX_REVIEW_MEDIA,
  publicDisplayName,
  STORAGE_PREFIX,
  userInitials,
  type ReviewSubjectType,
} from '@bmpl/shared';
import type { CreateReviewInput, EditReviewInput, ResolveReportInput, ReviewModerateInput, ReviewReportInput, ReviewResponseInput } from '@bmpl/validation';
import { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OwnershipService } from '../products/ownership.service';
import { AVATAR_SELECT, publicAvatarUrl } from '../common/avatar-url';

export interface Actor {
  userId: string;
  status?: string;
  permissions?: string[];
}

/**
 * Everything {@link ReviewsService.serialize} reads. The reviewer is included so a
 * published review carries a face and a name — an anonymous star rating is the
 * easiest kind to fake, and readers weigh a review differently when a real person
 * is standing behind it.
 */
const REVIEW_INCLUDE = {
  media: true,
  response: true,
  reviewer: { select: { firstName: true, lastName: true, ...AVATAR_SELECT } },
} satisfies Prisma.ReviewInclude;

type ReviewRow = Prisma.ReviewGetPayload<{ include: typeof REVIEW_INCLUDE }>;

/** A vendor-order is fulfilled when its delivery is DELIVERED or (pickup) PICKED_UP. */
function isFulfilled(vo: { status: string; deliveryMethod: string; delivery: { status: string } | null }): boolean {
  if (vo.delivery) return vo.delivery.status === 'DELIVERED';
  return vo.deliveryMethod === 'PICKUP' && vo.status === 'PICKED_UP';
}

/**
 * Reviews & Ratings (M19). Verified reviews tied to COMPLETED transactions:
 * product (order item), vendor (vendor-order), driver (delivery). Eligibility is
 * proven server-side from order records; duplicates are prevented per verified
 * context; aggregates (average/count on the subject) are recomputed from source.
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly ownership: OwnershipService,
  ) {}

  // ===========================================================================
  // Create / edit
  // ===========================================================================
  async create(actor: Actor, dto: CreateReviewInput) {
    if (actor.status && actor.status !== 'ACTIVE') throw new ForbiddenException('Your account cannot post reviews.');
    const ctx = await this.resolveEligibility(actor.userId, dto.subjectType, dto.contextId);

    const existing = await this.prisma.review.findUnique({ where: { reviewerId_subjectType_contextId: { reviewerId: actor.userId, subjectType: dto.subjectType, contextId: dto.contextId } } });
    if (existing) throw new BadRequestException('You have already reviewed this.');

    const media = dto.mediaKeys?.length ? await this.resolveMedia(actor.userId, dto.mediaKeys) : [];

    const review = await this.prisma.$transaction(async (tx) => {
      const r = await tx.review.create({
        data: {
          reviewerId: actor.userId,
          subjectType: dto.subjectType,
          subjectId: ctx.subjectId,
          contextType: ctx.contextType,
          contextId: dto.contextId,
          rating: dto.rating,
          title: dto.title ?? null,
          body: dto.body,
          verifiedPurchase: true,
          productId: ctx.productId ?? null,
          variantId: ctx.variantId ?? null,
          variantName: ctx.variantName ?? null,
          sku: ctx.sku ?? null,
          media: media.length ? { create: media } : undefined,
        },
      });
      return r;
    });
    await this.recompute(dto.subjectType, ctx.subjectId);
    await this.audit.record({ action: 'REVIEW_CREATED', actorId: actor.userId, newValue: { reviewId: review.id, subjectType: dto.subjectType, subjectId: ctx.subjectId, rating: dto.rating } });
    if (ctx.notifyUserId) {
      await this.notifications.createInApp({ userId: ctx.notifyUserId, type: 'MARKETPLACE', category: 'VENDOR', event: 'REVIEW_RECEIVED', title: 'New review', body: `You received a ${dto.rating}-star review.`, data: { reviewId: review.id } });
    }
    return this.getById(review.id, actor);
  }

  async edit(actor: Actor, reviewId: string, dto: EditReviewInput) {
    const r = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!r || r.reviewerId !== actor.userId) throw new NotFoundException('Review not found.');
    if (r.status === 'REJECTED') throw new ForbiddenException('This review cannot be edited.');
    await this.prisma.review.update({
      where: { id: reviewId },
      data: {
        rating: dto.rating ?? undefined,
        title: dto.title === undefined ? undefined : dto.title,
        body: dto.body ?? undefined,
        editedAt: new Date(),
      },
    });
    if (dto.rating !== undefined && dto.rating !== r.rating) await this.recompute(r.subjectType, r.subjectId);
    await this.audit.record({ action: 'REVIEW_EDITED', actorId: actor.userId, newValue: { reviewId } });
    return this.getById(reviewId, actor);
  }

  /** Resolve + verify eligibility for a subject/context; returns the subjectId + snapshot. */
  private async resolveEligibility(userId: string, subjectType: ReviewSubjectType, contextId: string) {
    if (subjectType === 'PRODUCT') {
      const item = await this.prisma.orderItem.findUnique({
        where: { id: contextId },
        include: { vendorOrder: { include: { order: { select: { userId: true } }, delivery: { select: { status: true } }, vendorProfile: { select: { userId: true } } } } },
      });
      if (!item || item.vendorOrder.order.userId !== userId) throw new NotFoundException('Order item not found.');
      if (!isFulfilled(item.vendorOrder)) throw new ForbiddenException('You can review this after the order is completed.');
      if (!item.productId) throw new BadRequestException('This product is no longer available to review.');
      return { subjectId: item.productId, contextType: 'ORDER_ITEM' as const, productId: item.productId, variantId: item.variantId, variantName: item.variantTitle, sku: item.sku, notifyUserId: item.vendorOrder.vendorProfile.userId };
    }
    if (subjectType === 'VENDOR') {
      const vo = await this.prisma.vendorOrder.findUnique({
        where: { id: contextId },
        include: { order: { select: { userId: true } }, delivery: { select: { status: true } }, vendorProfile: { select: { id: true, userId: true } } },
      });
      if (!vo || vo.order.userId !== userId) throw new NotFoundException('Order not found.');
      if (!isFulfilled(vo)) throw new ForbiddenException('You can review this vendor after the order is completed.');
      return { subjectId: vo.vendorProfile.id, contextType: 'VENDOR_ORDER' as const, notifyUserId: vo.vendorProfile.userId };
    }
    // DRIVER
    const d = await this.prisma.orderDelivery.findUnique({
      where: { id: contextId },
      include: { assignedDriver: { select: { id: true, userId: true } }, vendorOrder: { include: { order: { select: { userId: true } } } } },
    });
    if (!d || d.vendorOrder.order.userId !== userId) throw new NotFoundException('Delivery not found.');
    if (d.status !== 'DELIVERED' || !d.assignedDriver) throw new ForbiddenException('You can rate the driver after delivery is completed.');
    if (d.assignedDriver.userId === userId) throw new ForbiddenException('You cannot review yourself.');
    return { subjectId: d.assignedDriver.id, contextType: 'ORDER_DELIVERY' as const, notifyUserId: d.assignedDriver.userId };
  }

  private async resolveMedia(userId: string, keys: string[]) {
    if (keys.length > MAX_REVIEW_MEDIA) throw new BadRequestException(`At most ${MAX_REVIEW_MEDIA} photos.`);
    const namespace = STORAGE_PREFIX.reviewMedia(userId);
    const out: Array<{ storageKey: string; mimeType: string; fileSizeBytes: number }> = [];
    for (const key of keys) {
      this.storage.assertKeyInNamespace(key, namespace);
      const meta = await this.storage.headObject(key, 'private');
      if (!meta) throw new BadRequestException('An uploaded photo could not be found in storage.');
      if (!isAllowedProductImageMime(meta.contentType)) throw new BadRequestException('Use a JPEG, PNG, or WebP image.');
      if (meta.sizeBytes <= 0 || meta.sizeBytes > MAX_PRODUCT_IMAGE_BYTES) throw new BadRequestException('A photo exceeds the maximum allowed size.');
      out.push({ storageKey: key, mimeType: meta.contentType, fileSizeBytes: meta.sizeBytes });
    }
    return out;
  }

  async presignMedia(userId: string, fileName: string, contentType: string) {
    if (!isAllowedProductImageMime(contentType)) throw new BadRequestException('Use a JPEG, PNG, or WebP image.');
    const key = this.storage.buildKey(STORAGE_PREFIX.reviewMedia(userId), fileName);
    return this.storage.presignUpload(key, contentType, 'private');
  }

  // ===========================================================================
  // Aggregation (recomputed from source; cached on the subject)
  // ===========================================================================
  private async recompute(subjectType: ReviewSubjectType, subjectId: string) {
    const rows = await this.prisma.review.findMany({ where: { subjectType, subjectId, status: 'PUBLISHED' }, select: { rating: true } });
    const agg = aggregateRatings(rows.map((r) => r.rating));
    if (subjectType === 'PRODUCT') await this.prisma.product.update({ where: { id: subjectId }, data: { ratingAverage: agg.average, ratingCount: agg.count } }).catch(() => {});
    else if (subjectType === 'VENDOR') await this.prisma.vendorProfile.update({ where: { id: subjectId }, data: { ratingAverage: agg.average, ratingCount: agg.count } }).catch(() => {});
    else await this.prisma.driverProfile.update({ where: { id: subjectId }, data: { ratingAverage: agg.average, ratingCount: agg.count } }).catch(() => {});
  }

  // ===========================================================================
  // Public reads
  // ===========================================================================
  async listForSubject(subjectType: ReviewSubjectType, subjectId: string, opts: { sort?: string; rating?: number; page?: number; viewerId?: string }) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = 10;
    // A simulation-side subject answers BYTE-IDENTICALLY to a subject that
    // does not exist: the same empty page a real subject with no reviews
    // gets. An empty list is this endpoint's honest answer for "nothing
    // visible here", and it leaks nothing an enumerator can use — a 404
    // would hand them exactly the exists/doesn't distinction they want.
    // Review's subject is soft-polymorphic (no relation to join through),
    // so the boundary is asked per type instead.
    if (!(await this.subjectServesPublicly(subjectType, subjectId))) {
      return { aggregate: aggregateRatings([]), total: 0, page, pageSize, reviews: [] };
    }
    const where: Prisma.ReviewWhereInput = { subjectType, subjectId, status: 'PUBLISHED', ...(opts.rating ? { rating: opts.rating } : {}) };
    const orderBy: Prisma.ReviewOrderByWithRelationInput = opts.sort === 'helpful' ? { helpfulCount: 'desc' } : opts.sort === 'rating_desc' ? { rating: 'desc' } : opts.sort === 'rating_asc' ? { rating: 'asc' } : { createdAt: 'desc' };
    const [rows, total, all] = await Promise.all([
      this.prisma.review.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize, include: { ...REVIEW_INCLUDE, media: { where: { status: 'APPROVED' } } } }),
      this.prisma.review.count({ where }),
      this.prisma.review.findMany({ where: { subjectType, subjectId, status: 'PUBLISHED' }, select: { rating: true } }),
    ]);
    return {
      aggregate: aggregateRatings(all.map((r) => r.rating)),
      total,
      page,
      pageSize,
      reviews: await Promise.all(rows.map((r) => this.serialize(r, opts.viewerId))),
    };
  }

  /**
   * Whether this subject belongs on the public, real-marketplace side.
   * Every subject type carries (or derives) the simulation flag: a product
   * through its vendor, a vendor and a delivery driver directly. A subject
   * that does not exist is simply "not visible" — the caller's empty page
   * then matches the test-side answer with no extra work.
   */
  private async subjectServesPublicly(subjectType: ReviewSubjectType, subjectId: string): Promise<boolean> {
    switch (subjectType) {
      case 'PRODUCT': {
        const p = await this.prisma.product.findUnique({ where: { id: subjectId }, select: { vendorProfile: { select: { isTest: true } } } });
        return p != null && !p.vendorProfile.isTest;
      }
      case 'VENDOR': {
        const v = await this.prisma.vendorProfile.findUnique({ where: { id: subjectId }, select: { isTest: true } });
        return v != null && !v.isTest;
      }
      case 'DRIVER': {
        const d = await this.prisma.driverProfile.findUnique({ where: { id: subjectId }, select: { isTest: true } });
        return d != null && !d.isTest;
      }
    }
  }

  async getById(reviewId: string, actor?: Actor) {
    const r = await this.prisma.review.findUnique({ where: { id: reviewId }, include: REVIEW_INCLUDE });
    if (!r) throw new NotFoundException('Review not found.');
    return this.serialize(r, actor?.userId);
  }

  async ownReviews(userId: string) {
    const rows = await this.prisma.review.findMany({ where: { reviewerId: userId }, orderBy: { createdAt: 'desc' }, take: 100, include: REVIEW_INCLUDE });
    return Promise.all(rows.map((r) => this.serialize(r, userId)));
  }

  /** Fulfilled contexts the customer can still review (product / vendor / driver). */
  async eligibleContexts(userId: string) {
    const vendorOrders = await this.prisma.vendorOrder.findMany({
      where: { order: { userId }, OR: [{ delivery: { status: 'DELIVERED' } }, { deliveryMethod: 'PICKUP', status: 'PICKED_UP' }] },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { items: true, order: { select: { orderNumber: true } }, vendorProfile: { select: { id: true, businessName: true } }, delivery: { select: { id: true, status: true, assignedDriverProfileId: true, assignedDriver: { select: { displayName: true } } } } },
    });
    const reviewed = await this.prisma.review.findMany({ where: { reviewerId: userId }, select: { subjectType: true, contextId: true } });
    const done = new Set(reviewed.map((r) => `${r.subjectType}:${r.contextId}`));
    const items: Array<{ subjectType: ReviewSubjectType; contextId: string; label: string; orderNumber: string }> = [];
    for (const vo of vendorOrders) {
      if (!done.has(`VENDOR:${vo.id}`)) items.push({ subjectType: 'VENDOR', contextId: vo.id, label: vo.vendorProfile.businessName, orderNumber: vo.order.orderNumber });
      for (const it of vo.items) {
        if (it.productId && !done.has(`PRODUCT:${it.id}`)) items.push({ subjectType: 'PRODUCT', contextId: it.id, label: it.variantTitle || it.productTitle, orderNumber: vo.order.orderNumber });
      }
      if (vo.delivery?.status === 'DELIVERED' && vo.delivery.assignedDriverProfileId && !done.has(`DRIVER:${vo.delivery.id}`)) {
        items.push({ subjectType: 'DRIVER', contextId: vo.delivery.id, label: vo.delivery.assignedDriver?.displayName ?? 'Your driver', orderNumber: vo.order.orderNumber });
      }
    }
    return items;
  }

  // ===========================================================================
  // Vendor response
  // ===========================================================================
  async respond(actor: Actor, reviewId: string, dto: ReviewResponseInput) {
    if (actor.status && actor.status !== 'ACTIVE') throw new ForbiddenException('Your account cannot respond.');
    const r = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!r) throw new NotFoundException('Review not found.');
    await this.assertVendorOwnsSubject(actor.userId, r);
    const existing = await this.prisma.reviewResponse.findUnique({ where: { reviewId } });
    if (existing) {
      await this.prisma.reviewResponse.update({ where: { reviewId }, data: { body: dto.body, editedAt: new Date() } });
      await this.audit.record({ action: 'REVIEW_RESPONSE_EDITED', actorId: actor.userId, newValue: { reviewId } });
    } else {
      await this.prisma.reviewResponse.create({ data: { reviewId, responderId: actor.userId, body: dto.body } });
      await this.audit.record({ action: 'REVIEW_RESPONSE_ADDED', actorId: actor.userId, newValue: { reviewId } });
      await this.notifications.createInApp({ userId: r.reviewerId, type: 'MARKETPLACE', category: 'VENDOR', event: 'REVIEW_RESPONSE_RECEIVED', title: 'The seller responded', body: 'A seller responded to your review.', data: { reviewId } });
    }
    return this.getById(reviewId, actor);
  }

  private async assertVendorOwnsSubject(userId: string, r: { subjectType: string; subjectId: string; productId: string | null }) {
    const vp = await this.ownership.vendorProfileId(userId); // throws if not a vendor
    if (r.subjectType === 'VENDOR') {
      if (r.subjectId !== vp) throw new ForbiddenException('You can only respond to reviews of your own store.');
    } else if (r.subjectType === 'PRODUCT' && r.productId) {
      const product = await this.prisma.product.findUnique({ where: { id: r.productId }, select: { vendorProfileId: true } });
      if (!product || product.vendorProfileId !== vp) throw new ForbiddenException('You can only respond to reviews of your own products.');
    } else {
      throw new ForbiddenException('Vendors can only respond to product or store reviews.');
    }
  }

  // ===========================================================================
  // Reports + helpful votes
  // ===========================================================================
  async report(actor: Actor, reviewId: string, dto: ReviewReportInput) {
    const r = await this.prisma.review.findUnique({ where: { id: reviewId }, select: { id: true } });
    if (!r) throw new NotFoundException('Review not found.');
    try {
      await this.prisma.reviewReport.create({ data: { reviewId, reporterId: actor.userId, reason: dto.reason, note: dto.note ?? null } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { ok: true }; // already reported
      throw e;
    }
    await this.audit.record({ action: 'REVIEW_REPORTED', actorId: actor.userId, newValue: { reviewId, reason: dto.reason } });
    await this.notifications.notifyAdmins('reviews.read', { type: 'SECURITY', category: 'ADMIN_ALERT', event: 'ADMIN_ORDER_EXCEPTION', title: 'Review reported', body: `A review was reported (${dto.reason.toLowerCase()}).`, data: { reviewId } });
    return { ok: true };
  }

  async toggleHelpful(actor: Actor, reviewId: string) {
    const existing = await this.prisma.reviewHelpfulVote.findUnique({ where: { reviewId_userId: { reviewId, userId: actor.userId } } });
    if (existing) {
      await this.prisma.$transaction([
        this.prisma.reviewHelpfulVote.delete({ where: { id: existing.id } }),
        this.prisma.review.update({ where: { id: reviewId }, data: { helpfulCount: { decrement: 1 } } }),
      ]);
      return { helpful: false };
    }
    await this.prisma.$transaction([
      this.prisma.reviewHelpfulVote.create({ data: { reviewId, userId: actor.userId } }),
      this.prisma.review.update({ where: { id: reviewId }, data: { helpfulCount: { increment: 1 } } }),
    ]);
    return { helpful: true };
  }

  // ===========================================================================
  // Admin moderation
  // ===========================================================================
  async adminList(filter: { status?: string; subjectType?: string; reported?: boolean }) {
    const where: Prisma.ReviewWhereInput = {
      ...(filter.status ? { status: filter.status as never } : {}),
      ...(filter.subjectType ? { subjectType: filter.subjectType as never } : {}),
      ...(filter.reported ? { reports: { some: { status: 'OPEN' } } } : {}),
    };
    const rows = await this.prisma.review.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200, include: { ...REVIEW_INCLUDE, _count: { select: { reports: true } } } });
    return Promise.all(rows.map(async (r) => ({ ...(await this.serialize(r)), reportCount: r._count.reports, moderationReason: r.moderationReason })));
  }

  async moderate(actor: Actor, reviewId: string, dto: ReviewModerateInput) {
    const r = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!r) throw new NotFoundException('Review not found.');
    const status = dto.action === 'UNHIDE' ? 'PUBLISHED' : dto.action === 'HIDE' ? 'HIDDEN' : 'REJECTED';
    await this.prisma.review.update({ where: { id: reviewId }, data: { status, moderatedById: actor.userId, moderationReason: dto.reason ?? null, moderatedAt: new Date() } });
    await this.recompute(r.subjectType, r.subjectId); // hidden/rejected drop out of aggregates
    await this.audit.record({ action: 'REVIEW_MODERATED', actorId: actor.userId, newValue: { reviewId, action: dto.action, reason: dto.reason ?? null } });
    await this.notifications.createInApp({ userId: r.reviewerId, type: 'ACCOUNT', category: 'ACCOUNT', title: 'Review updated', body: dto.action === 'UNHIDE' ? 'Your review is visible again.' : 'Your review was moderated.', data: { reviewId } });
    return this.getById(reviewId, actor);
  }

  async reportsList(status?: string) {
    const rows = await this.prisma.reviewReport.findMany({ where: status ? { status: status as never } : { status: 'OPEN' }, orderBy: { createdAt: 'desc' }, take: 200, include: { review: { select: { id: true, subjectType: true, body: true, status: true } } } });
    return rows.map((r) => ({ id: r.id, reviewId: r.reviewId, reason: r.reason, note: r.note, status: r.status, createdAt: r.createdAt, review: r.review }));
  }

  async resolveReport(actor: Actor, reportId: string, dto: ResolveReportInput) {
    const rep = await this.prisma.reviewReport.findUnique({ where: { id: reportId } });
    if (!rep) throw new NotFoundException('Report not found.');
    await this.prisma.reviewReport.update({ where: { id: reportId }, data: { status: dto.status, resolvedById: actor.userId, resolutionNote: dto.note ?? null, resolvedAt: new Date() } });
    await this.audit.record({ action: 'REVIEW_REPORT_RESOLVED', actorId: actor.userId, newValue: { reportId, status: dto.status } });
    return { ok: true };
  }

  // ===========================================================================
  // serialization
  // ===========================================================================
  private async serialize(r: ReviewRow, viewerId?: string) {
    const media = await Promise.all(
      r.media.filter((m) => m.status === 'APPROVED').map(async (m) => {
        try {
          return { id: m.id, url: (await this.storage.presignDownload(m.storageKey, 'private')).url };
        } catch {
          return { id: m.id, url: null };
        }
      }),
    );
    const votedHelpful = viewerId ? !!(await this.prisma.reviewHelpfulVote.findUnique({ where: { reviewId_userId: { reviewId: r.id, userId: viewerId } } })) : false;
    return {
      id: r.id,
      subjectType: r.subjectType,
      subjectId: r.subjectId,
      rating: r.rating,
      title: r.title,
      body: r.body,
      status: r.status,
      verifiedPurchase: r.verifiedPurchase,
      helpfulCount: r.helpfulCount,
      votedHelpful,
      variantName: r.variantName,
      sku: r.sku,
      media,
      response: r.response ? { body: r.response.body, createdAt: r.response.createdAt, editedAt: r.response.editedAt } : null,
      // Public identity: first name + surname initial, plus the approved picture
      // (null while there isn't one — the UI draws initials instead).
      reviewer: {
        name: publicDisplayName(r.reviewer.firstName, r.reviewer.lastName),
        initials: userInitials(r.reviewer.firstName, r.reviewer.lastName),
        avatarUrl: publicAvatarUrl(r.reviewer),
      },
      isMine: viewerId === r.reviewerId,
      createdAt: r.createdAt,
      editedAt: r.editedAt,
    };
  }
}
