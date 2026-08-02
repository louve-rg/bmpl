import { Injectable, NotFoundException } from '@nestjs/common';
import { HOMEPAGE_PLACEMENTS } from '@bmpl/shared';
import type { ResolvePromotionReportInput } from '@bmpl/validation';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface Actor {
  userId: string;
  status?: string;
  permissions?: string[];
}

/** Homepage curation payload: priority/feature toggles for homepage-placed promotions. */
export interface HomepageCurationInput {
  items?: Array<{ promotionId: string; priority?: number; isActive?: boolean }>;
}

/**
 * Marketing admin oversight (M26) — abuse-report triage and homepage curation. Promotion
 * moderation (approve/reject/…) lives in PromotionsService.moderate; priority/feature
 * toggles in PromotionsService.setPriority; campaign/coupon oversight in their own
 * services. This service owns report resolution and homepage ordering only.
 */
@Injectable()
export class MarketingAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ===========================================================================
  // Reports (promotions.read / promotions.moderate)
  // ===========================================================================
  async listReports(status?: string) {
    const rows = await this.prisma.promotionReport.findMany({
      where: status ? { status: status as never } : { status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { promotion: { select: { id: true, title: true, type: true, status: true } } },
    });
    return rows.map((r) => ({ id: r.id, promotionId: r.promotionId, reason: r.reason, note: r.note, status: r.status, createdAt: r.createdAt, promotion: r.promotion }));
  }

  async resolveReport(actor: Actor, reportId: string, dto: ResolvePromotionReportInput) {
    const report = await this.prisma.promotionReport.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Report not found.');
    await this.prisma.promotionReport.update({
      where: { id: reportId },
      data: { status: dto.status, resolvedById: actor.userId, resolutionNote: dto.note ?? null, resolvedAt: new Date() },
    });
    await this.audit.record({ action: 'PROMOTION_REPORT_RESOLVED', actorId: actor.userId, newValue: { reportId, status: dto.status } });
    return { ok: true };
  }

  // ===========================================================================
  // Homepage curation (homepage.manage)
  // ===========================================================================
  /** Current homepage-placed promotions grouped by placement, with priority + active flags. */
  async getHomepageCuration() {
    const rows = await this.prisma.promotion.findMany({
      where: { placements: { some: { placement: { in: [...HOMEPAGE_PLACEMENTS] } } } },
      orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
      take: 200,
      include: { placements: { where: { placement: { in: [...HOMEPAGE_PLACEMENTS] } } } },
    });
    const groups = Object.fromEntries(HOMEPAGE_PLACEMENTS.map((p) => [p, [] as Array<Record<string, unknown>>]));
    for (const promo of rows) {
      for (const pl of promo.placements) {
        groups[pl.placement]?.push({
          promotionId: promo.id,
          title: promo.title,
          type: promo.type,
          status: promo.status,
          isActive: promo.isActive,
          priority: promo.priority,
          position: pl.position,
        });
      }
    }
    return { placements: groups };
  }

  /** Apply priority/feature toggles for homepage curation. isActive can only be true when APPROVED. */
  async setHomepageCuration(actor: Actor, dto: HomepageCurationInput) {
    const items = dto.items ?? [];
    for (const item of items) {
      const promo = await this.prisma.promotion.findUnique({ where: { id: item.promotionId }, select: { id: true, status: true } });
      if (!promo) continue;
      const isActive = item.isActive === undefined ? undefined : item.isActive && promo.status === 'APPROVED';
      await this.prisma.promotion.update({
        where: { id: promo.id },
        data: {
          priority: item.priority === undefined ? undefined : Math.max(0, Math.min(1000, Math.trunc(item.priority))),
          isActive,
        },
      });
    }
    await this.audit.record({ action: 'PROMOTION_STATUS_CHANGED', actorId: actor.userId, newValue: { homepageCuration: items.length } });
    return this.getHomepageCuration();
  }
}
