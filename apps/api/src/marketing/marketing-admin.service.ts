import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { HOMEPAGE_PLACEMENTS, PROMOTION_PLACEMENTS, type PromotionPlacementType } from '@bmpl/shared';
import type { ResolvePromotionReportInput } from '@bmpl/validation';
import { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const DEVICES = ['BOTH', 'DESKTOP', 'MOBILE'] as const;
type Device = (typeof DEVICES)[number];
export interface AssignPlacementInput {
  placement: string;
  categoryId?: string | null;
  position?: number;
  device?: string;
  startAt?: string | null;
  endAt?: string | null;
}
export interface UpdatePlacementInput {
  position?: number;
  device?: string;
  isActive?: boolean;
  startAt?: string | null;
  endAt?: string | null;
}

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
  // Admin-controlled ad placement (promotions.manage)
  // Marketing owns the campaign content; ADMIN decides WHERE an approved campaign
  // appears. A campaign with no placement never renders; removing a placement never
  // deletes the campaign; one campaign may hold many placements.
  // ===========================================================================
  private toDevice(d?: string): Device {
    return (DEVICES as readonly string[]).includes(d ?? '') ? (d as Device) : 'BOTH';
  }
  private assertPlacement(p: string): PromotionPlacementType {
    if (!(PROMOTION_PLACEMENTS as readonly string[]).includes(p)) throw new BadRequestException('Unknown placement surface.');
    return p as PromotionPlacementType;
  }

  /** Assign (or update) an APPROVED campaign to a placement slot. */
  async assignPlacement(actor: Actor, promotionId: string, dto: AssignPlacementInput) {
    const promo = await this.prisma.promotion.findUnique({ where: { id: promotionId }, select: { id: true, status: true } });
    if (!promo) throw new NotFoundException('Campaign not found.');
    if (promo.status !== 'APPROVED') throw new BadRequestException('Only an approved campaign can be assigned to a placement.');
    const placement = this.assertPlacement(dto.placement);
    const categoryId = dto.categoryId ?? null;
    const data = {
      position: dto.position ?? 0,
      device: this.toDevice(dto.device),
      startAt: dto.startAt ? new Date(dto.startAt) : null,
      endAt: dto.endAt ? new Date(dto.endAt) : null,
      isActive: true,
      assignedById: actor.userId,
    };
    // Nullable categoryId can't be used in the compound-unique `where` (Prisma types it
    // non-null), so resolve the existing assignment explicitly.
    const existing = await this.prisma.promotionPlacement.findFirst({ where: { promotionId, placement, categoryId } });
    const row = existing
      ? await this.prisma.promotionPlacement.update({ where: { id: existing.id }, data })
      : await this.prisma.promotionPlacement.create({ data: { promotionId, placement, categoryId, ...data } });
    await this.audit.record({ action: 'PROMOTION_STATUS_CHANGED', actorId: actor.userId, newValue: { promotionId, placement, categoryId, assigned: true } });
    return row;
  }

  async updatePlacement(actor: Actor, placementId: string, dto: UpdatePlacementInput) {
    const existing = await this.prisma.promotionPlacement.findUnique({ where: { id: placementId } });
    if (!existing) throw new NotFoundException('Placement not found.');
    const row = await this.prisma.promotionPlacement.update({
      where: { id: placementId },
      data: {
        position: dto.position ?? undefined,
        device: dto.device ? this.toDevice(dto.device) : undefined,
        isActive: dto.isActive ?? undefined,
        startAt: dto.startAt === undefined ? undefined : dto.startAt ? new Date(dto.startAt) : null,
        endAt: dto.endAt === undefined ? undefined : dto.endAt ? new Date(dto.endAt) : null,
        assignedById: actor.userId,
      },
    });
    await this.audit.record({ action: 'PROMOTION_STATUS_CHANGED', actorId: actor.userId, newValue: { placementId, updated: true } });
    return row;
  }

  /** Remove a placement — the campaign itself is untouched. */
  async removePlacement(actor: Actor, placementId: string) {
    const existing = await this.prisma.promotionPlacement.findUnique({ where: { id: placementId }, select: { id: true, promotionId: true } });
    if (!existing) throw new NotFoundException('Placement not found.');
    await this.prisma.promotionPlacement.delete({ where: { id: placementId } });
    await this.audit.record({ action: 'PROMOTION_STATUS_CHANGED', actorId: actor.userId, newValue: { placementId, promotionId: existing.promotionId, removed: true } });
    return { ok: true };
  }

  /** All placement assignments (optionally for one slot) for the Admin ads console. */
  async listPlacements(placement?: string) {
    const where: Prisma.PromotionPlacementWhereInput = placement ? { placement: this.assertPlacement(placement) } : {};
    const rows = await this.prisma.promotionPlacement.findMany({
      where,
      orderBy: [{ placement: 'asc' }, { position: 'desc' }, { createdAt: 'desc' }],
      take: 500,
      include: {
        promotion: { select: { id: true, title: true, type: true, status: true, priority: true, isActive: true } },
        category: { select: { name: true, slug: true } },
      },
    });
    return rows;
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
