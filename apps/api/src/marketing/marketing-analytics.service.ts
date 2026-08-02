import { Injectable, NotFoundException } from '@nestjs/common';
import { computeCtr } from '@bmpl/shared';
import { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Marketing analytics (M26) — read-only aggregation over PromotionMetricDaily. Admin
 * metrics are platform-wide; owner metrics are scoped to the actor's promotions. Every
 * number is a live sum of stored daily rollups — nothing is fabricated. CTR is derived
 * via computeCtr(impressions, clicks) (rule #6).
 */
@Injectable()
export class MarketingAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private summarize(sum: { impressions: number | null; views: number | null; clicks: number | null; conversions: number | null }) {
    const impressions = sum.impressions ?? 0;
    const views = sum.views ?? 0;
    const clicks = sum.clicks ?? 0;
    const conversions = sum.conversions ?? 0;
    return { impressions, views, clicks, conversions, ctr: computeCtr(impressions, clicks) };
  }

  async ownerOverview(userId: string) {
    const scope: Prisma.PromotionMetricDailyWhereInput = { promotion: { ownerUserId: userId } };
    const [totalPromotions, activePromotions, byStatusRaw, metrics, campaigns, coupons, topRaw] = await Promise.all([
      this.prisma.promotion.count({ where: { ownerUserId: userId } }),
      this.prisma.promotion.count({ where: { ownerUserId: userId, status: 'APPROVED', isActive: true } }),
      this.prisma.promotion.groupBy({ by: ['status'], where: { ownerUserId: userId }, _count: { _all: true } }),
      this.prisma.promotionMetricDaily.aggregate({ where: scope, _sum: { impressions: true, views: true, clicks: true, conversions: true } }),
      this.prisma.campaign.count({ where: { ownerUserId: userId } }),
      this.prisma.coupon.count({ where: { ownerUserId: userId } }),
      this.prisma.promotionMetricDaily.groupBy({ by: ['promotionId'], where: scope, _sum: { views: true, clicks: true, impressions: true }, orderBy: { _sum: { views: 'desc' } }, take: 5 }),
    ]);
    return {
      totalPromotions,
      activePromotions,
      byStatus: byStatusRaw.map((r) => ({ status: r.status, count: r._count._all })),
      totals: this.summarize(metrics._sum),
      campaigns,
      coupons,
      topPromotions: await this.hydrateTop(topRaw),
    };
  }

  /** Per-promotion analytics for the owner: totals, daily series, and per-placement split. */
  async promotionOverview(userId: string, promotionId: string) {
    const promo = await this.prisma.promotion.findFirst({ where: { id: promotionId, ownerUserId: userId }, select: { id: true, title: true, type: true, status: true } });
    if (!promo) throw new NotFoundException('Promotion not found.');
    const [totals, daily, byPlacementRaw, redemptions] = await Promise.all([
      this.prisma.promotionMetricDaily.aggregate({ where: { promotionId }, _sum: { impressions: true, views: true, clicks: true, conversions: true } }),
      this.prisma.promotionMetricDaily.groupBy({ by: ['day'], where: { promotionId }, _sum: { impressions: true, views: true, clicks: true, conversions: true }, orderBy: { day: 'asc' } }),
      this.prisma.promotionMetricDaily.groupBy({ by: ['placement'], where: { promotionId }, _sum: { impressions: true, views: true, clicks: true, conversions: true } }),
      this.prisma.promotionRedemption.count({ where: { promotionId } }),
    ]);
    return {
      promotion: promo,
      totals: this.summarize(totals._sum),
      redemptions,
      daily: daily.map((d) => ({ day: d.day, ...this.summarize(d._sum) })),
      byPlacement: byPlacementRaw.map((p) => ({ placement: p.placement, ...this.summarize(p._sum) })),
    };
  }

  async adminOverview() {
    const [servingNow, pendingModeration, openReports, byStatusRaw, byTypeRaw, metrics, activeCampaigns, activeCoupons, topRaw] = await Promise.all([
      this.prisma.promotion.count({ where: { status: 'APPROVED', isActive: true } }),
      this.prisma.promotion.count({ where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } } }),
      this.prisma.promotionReport.count({ where: { status: 'OPEN' } }),
      this.prisma.promotion.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.promotion.groupBy({ by: ['type'], _count: { _all: true } }),
      this.prisma.promotionMetricDaily.aggregate({ _sum: { impressions: true, views: true, clicks: true, conversions: true } }),
      this.prisma.campaign.count({ where: { status: 'RUNNING' } }),
      this.prisma.coupon.count({ where: { status: 'ACTIVE' } }),
      this.prisma.promotionMetricDaily.groupBy({ by: ['promotionId'], _sum: { views: true, clicks: true, impressions: true }, orderBy: { _sum: { views: 'desc' } }, take: 10 }),
    ]);
    return {
      servingNow,
      pendingModeration,
      openReports,
      byStatus: byStatusRaw.map((r) => ({ status: r.status, count: r._count._all })),
      byType: byTypeRaw.map((r) => ({ type: r.type, count: r._count._all })).sort((a, b) => b.count - a.count),
      totals: this.summarize(metrics._sum),
      activeCampaigns,
      activeCoupons,
      topPromotions: await this.hydrateTop(topRaw),
    };
  }

  private async hydrateTop(rows: Array<{ promotionId: string; _sum: { views: number | null; clicks: number | null; impressions: number | null } }>) {
    if (!rows.length) return [];
    const promos = await this.prisma.promotion.findMany({ where: { id: { in: rows.map((r) => r.promotionId) } }, select: { id: true, title: true, type: true, status: true } });
    const byId = new Map(promos.map((p) => [p.id, p]));
    return rows
      .map((r) => {
        const p = byId.get(r.promotionId);
        if (!p) return null;
        const impressions = r._sum.impressions ?? 0;
        const clicks = r._sum.clicks ?? 0;
        return { id: p.id, title: p.title, type: p.type, status: p.status, views: r._sum.views ?? 0, clicks, impressions, ctr: computeCtr(impressions, clicks) };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
  }
}
