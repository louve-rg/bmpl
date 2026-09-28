import { Injectable, NotFoundException } from '@nestjs/common';
import { belizeCalendarDate, HOMEPAGE_PLACEMENTS, type PromotionPlacementType } from '@bmpl/shared';
import type { PromotionReportInput, TrackPromotionEventInput } from '@bmpl/validation';
import { Prisma, PromotionEventKind } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PromotionsService } from './promotions.service';

/** Which daily-metric column a public event increments. */
const EVENT_COLUMN: Record<TrackPromotionEventInput['event'], 'impressions' | 'views' | 'clicks' | 'conversions'> = {
  impression: 'impressions',
  view: 'views',
  click: 'clicks',
  conversion: 'conversions',
};

/**
 * Which `PromotionEvent` row kind a public event also writes (BMPL-332).
 * `conversion` is deliberately absent: BMPL-332 requirement 9 is on hold —
 * no existing mechanism ties a completed Order back to a Promotion (unlike
 * Coupon/CouponUsage, which is real), and the owner has not yet ruled on
 * what authoritative activity should count as a conversion. Conversions
 * keep today's behavior exactly: the daily counter only, no event row,
 * until that is decided.
 */
const EVENT_KIND: Partial<Record<TrackPromotionEventInput['event'], PromotionEventKind>> = {
  impression: PromotionEventKind.IMPRESSION,
  view: PromotionEventKind.VIEW,
  click: PromotionEventKind.CLICK,
};

/**
 * The Belize calendar day, as a @db.Date bucket key, for a real instant.
 * A UTC-midnight bucket would roll a promotion's daily metrics to the next
 * day up to six hours before it is actually tomorrow in Belize - see
 * BMPL-197.
 */
const dayBucket = (d = new Date()) => belizeCalendarDate(d);

/**
 * Public promotion serving (M26). A promotion is served ONLY IF status===APPROVED AND
 * isActive AND now is within [startAt,endAt] (null = open) AND (no campaign OR campaign
 * RUNNING) AND every resolved target is still live. Suspended/unpublished/expired targets
 * therefore disappear automatically — no cascade writes. Ordering is priority desc,
 * publishedAt desc. This serves via its OWN endpoints and never mutates organic
 * marketplace/search ranking (rule #3).
 */
@Injectable()
export class PromotionDiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly promotions: PromotionsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Base serving predicate (status/active/window/campaign). Target liveness is applied in JS. */
  private servedWhere(now = new Date()): Prisma.PromotionWhereInput {
    return {
      status: 'APPROVED',
      isActive: true,
      AND: [
        { OR: [{ startAt: null }, { startAt: { lte: now } }] },
        { OR: [{ endAt: null }, { endAt: { gte: now } }] },
        { OR: [{ campaignId: null }, { campaign: { status: 'RUNNING' } }] },
      ],
    };
  }

  /**
   * Served promotions for one Admin-assigned placement (+ optional category/device).
   * DUAL eligibility: the campaign/promotion must be serveable (servedWhere) AND the
   * placement assignment itself must be active, within its own window, and match the
   * device — so an approved campaign with no (or a paused/expired/wrong-device) placement
   * renders NOTHING. Ordering follows Admin priority (promotion.priority), never DB order.
   */
  async servePlacement(
    placement: PromotionPlacementType,
    categoryId?: string,
    opts: { device?: 'DESKTOP' | 'MOBILE'; limit?: number } = {},
  ) {
    const now = new Date();
    const placementEligible: Prisma.PromotionPlacementWhereInput = {
      placement,
      ...(categoryId ? { categoryId } : {}),
      isActive: true,
      AND: [
        { OR: [{ startAt: null }, { startAt: { lte: now } }] },
        { OR: [{ endAt: null }, { endAt: { gte: now } }] },
      ],
      ...(opts.device ? { device: { in: [opts.device, 'BOTH'] } } : {}),
    };
    const rows = await this.prisma.promotion.findMany({
      where: { ...this.servedWhere(now), placements: { some: placementEligible } },
      orderBy: [{ priority: 'desc' }, { publishedAt: 'desc' }],
      take: opts.limit ?? 50,
      include: PromotionsService.SERVE_INCLUDE,
    });
    const live = rows.filter((p) => this.promotions.targetsLive(p.targets));
    return Promise.all(live.map((p) => this.promotions.serveCard(p)));
  }

  /** Homepage bundle: hero + featured-{businesses,products,jobs,properties}. */
  async homepage() {
    const [hero, featuredBusinesses, featuredProducts, featuredJobs, featuredProperties] = await Promise.all(
      HOMEPAGE_PLACEMENTS.map((p) => this.servePlacement(p)),
    );
    return { hero, featuredBusinesses, featuredProducts, featuredJobs, featuredProperties };
  }

  /** Public promotion detail — only if currently serveable. */
  async publicDetail(promotionId: string) {
    const p = await this.prisma.promotion.findFirst({
      where: { id: promotionId, ...this.servedWhere() },
      include: PromotionsService.SERVE_INCLUDE,
    });
    if (!p || !this.promotions.targetsLive(p.targets)) throw new NotFoundException('Promotion not found.');
    return this.promotions.detail(p.id);
  }

  /**
   * Best-effort daily metric increment. NEVER throws to the client (204).
   *
   * BMPL-332: for impression/view/click, this also writes a `PromotionEvent`
   * row carrying the real instant — both in the SAME transaction as the
   * daily-counter upsert. Do not build two sources for one fact and hope
   * they agree; make one write produce both (apps/api/CLAUDE.md sec 6, the
   * same guard-shape lesson arriving from the write side). A separate,
   * independent write to each table would leave a window where a failure
   * after the first and before the second could make them disagree; one
   * transaction cannot.
   */
  async track(promotionId: string, dto: TrackPromotionEventInput) {
    try {
      const promo = await this.prisma.promotion.findUnique({ where: { id: promotionId }, select: { id: true } });
      if (!promo) return;
      // One captured instant feeds both the event's occurredAt and the daily
      // bucket, rather than letting occurredAt fall back to the database's own
      // DEFAULT CURRENT_TIMESTAMP — the two would otherwise be evaluated by
      // two different clocks (app vs. DB) microseconds apart, and only one of
      // them would be capturable by a test that pins the clock.
      const now = new Date();
      const day = dayBucket(now);
      const placement = dto.placement ?? null;
      const column = EVENT_COLUMN[dto.event];
      const kind = EVENT_KIND[dto.event];
      const create: Prisma.PromotionMetricDailyCreateInput = {
        promotion: { connect: { id: promotionId } }, day, placement, impressions: 0, views: 0, clicks: 0, conversions: 0,
      };
      create[column] = 1;
      await this.prisma.$transaction(async (tx) => {
        if (kind) {
          await tx.promotionEvent.create({ data: { promotion: { connect: { id: promotionId } }, kind, placement, occurredAt: now } });
        }
        await tx.promotionMetricDaily.upsert({
          // placement is a nullable member of the compound unique; Prisma accepts null at
          // runtime though its generated type narrows to the enum — cast to satisfy TS.
          where: { promotionId_day_placement: { promotionId, day, placement: placement as never } },
          create,
          update: { [column]: { increment: 1 } } as Prisma.PromotionMetricDailyUpdateInput,
        });
      });
    } catch {
      // best-effort; tracking must never surface an error to the caller.
    }
  }

  /** Public abuse report on a served promotion. Guests allowed (reporterUserId optional). */
  async report(reporterUserId: string | null, promotionId: string, dto: PromotionReportInput) {
    const promo = await this.prisma.promotion.findFirst({ where: { id: promotionId, status: 'APPROVED' }, select: { id: true, title: true } });
    if (!promo) throw new NotFoundException('Promotion not found.');
    await this.prisma.promotionReport.create({
      data: { promotionId, reporterUserId: reporterUserId ?? null, reason: dto.reason, note: dto.note ?? null },
    });
    await this.audit.record({ action: 'PROMOTION_REPORTED', actorId: reporterUserId, newValue: { promotionId, reason: dto.reason } });
    await this.notifications.notifyAdmins('promotions.read', {
      type: 'SECURITY', event: 'PROMOTION_REPORTED',
      title: 'Promotion reported', body: `"${promo.title}" was reported (${dto.reason.toLowerCase()}).`, data: { promotionId },
    });
    return { ok: true };
  }
}
