import { randomUUID } from 'node:crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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
  private readonly logger = new Logger(PromotionDiscoveryService.name);

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
   *
   * MDF-211: the daily-counter write used to be `tx.promotionMetricDaily.upsert(...)`,
   * which Prisma compiles into an attempted UPDATE followed by a CREATE if
   * that affected no rows — two statements, not one. Two concurrent calls for
   * the same (promotionId, day, placement) bucket could both reach the CREATE,
   * and the loser's real unique-constraint violation (P2002) aborted the
   * WHOLE transaction, silently rolling the paired event insert back with it.
   * A single `INSERT ... ON CONFLICT DO UPDATE` is one atomic statement at
   * the database level — there is no gap between "does a row exist" and
   * "write a row" for a second call to land in, so the race this exists to
   * close is gone rather than merely survived.
   *
   * SCOPED to a non-null `placement` only. A null placement hits a separate,
   * pre-existing defect (the compound unique index can't be conflicted-on
   * with a null member — see the comment on
   * test/promotion-tracking.integration.spec.ts) that this fix does not
   * touch: Postgres treats NULL as distinct in a plain unique index, so an
   * `ON CONFLICT` here would never match for a null placement and would
   * insert a brand-new row on every call instead — unbounded growth driven
   * by this endpoint's unauthenticated, unthrottled traffic, breaking the
   * bound the schema's own BMPL-332 comment states as a design property
   * ("the right PERMANENT read path, bounded by promotions × days ×
   * placements"). The real fix needs the unique index to treat NULLs as not
   * distinct, which is a migration — out of scope here, carded separately.
   * The null branch below is therefore left byte-for-byte as it already
   * behaves on main, including its silent catch.
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

      if (placement === null) {
        const create: Prisma.PromotionMetricDailyCreateInput = {
          promotion: { connect: { id: promotionId } }, day, placement, impressions: 0, views: 0, clicks: 0, conversions: 0,
        };
        create[column] = 1;
        try {
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
          // Deliberately silent — unchanged from main for this known,
          // separately-tracked defect. Not this fix's to log or resolve.
        }
        return;
      }

      // Dynamic but not attacker-controlled: `column` only ever comes from the
      // fixed EVENT_COLUMN map above, never from the request body directly, so
      // splicing it in as a raw identifier (Prisma.raw, not a bound parameter —
      // a column name can't be one) carries no injection risk.
      const col = Prisma.raw(`"${column}"`);
      await this.prisma.$transaction(async (tx) => {
        if (kind) {
          await tx.promotionEvent.create({ data: { promotion: { connect: { id: promotionId } }, kind, placement, occurredAt: now } });
        }
        await tx.$executeRaw`
          INSERT INTO "promotion_metrics_daily"
            ("id", "promotionId", "day", "placement", "impressions", "views", "clicks", "conversions", "createdAt", "updatedAt")
          VALUES
            (${randomUUID()}, ${promotionId}, ${day}::date, ${placement}::"PromotionPlacementType",
             ${column === 'impressions' ? 1 : 0}, ${column === 'views' ? 1 : 0},
             ${column === 'clicks' ? 1 : 0}, ${column === 'conversions' ? 1 : 0},
             now(), now())
          ON CONFLICT ("promotionId", "day", "placement")
          DO UPDATE SET ${col} = "promotion_metrics_daily".${col} + 1, "updatedAt" = now()
        `;
      });
    } catch (e) {
      // Best-effort; tracking must never surface an error to the caller. But
      // "best-effort" means swallowing an EXPECTED outcome, not every outcome
      // (MDF-211) — this codebase's convention (~20 sites, see the BMPL-388
      // comment in packages/database/src/index.ts) is to catch P2002
      // specifically and let anything else through to be logged. Nothing in
      // the non-null path's own writes is expected to raise P2002 anymore
      // (the conflict is now handled inside the SQL itself), so in practice
      // this now logs any real failure on that path instead of discarding it
      // with zero trace. (The null-placement branch above never reaches this
      // catch — it has its own, deliberately silent one.)
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return;
      this.logger.error(`track() failed for promotion ${promotionId}: ${String(e)}`);
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
