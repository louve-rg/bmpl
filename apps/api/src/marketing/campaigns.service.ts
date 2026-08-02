import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { canTransitionCampaign, DEFAULT_MARKETING_TIMEZONE, type CampaignStatus } from '@bmpl/shared';
import type {
  CampaignScheduleInput,
  CampaignStatusInput,
  CreateCampaignInput,
  UpdateCampaignInput,
} from '@bmpl/validation';
import { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface Actor {
  userId: string;
  status?: string;
  permissions?: string[];
}

/**
 * Campaigns (M26). An owner-scoped container grouping promotions/coupons with an
 * activation window. Every read/mutate is scoped to ownerUserId === actor — a business
 * reaches only its own campaigns (cross-owner access is a 404). Lifecycle transitions
 * follow CAMPAIGN_TRANSITIONS; only a RUNNING campaign lets its promotions serve
 * publicly (enforced at serving-time in PromotionDiscoveryService).
 */
@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ===========================================================================
  // Authorization
  // ===========================================================================
  /** Load a campaign the actor owns, or 404. */
  private async requireOwned(actor: Actor, campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign || campaign.ownerUserId !== actor.userId) throw new NotFoundException('Campaign not found.');
    return campaign;
  }

  // ===========================================================================
  // Business CRUD
  // ===========================================================================
  async create(actor: Actor, dto: CreateCampaignInput) {
    const campaign = await this.prisma.campaign.create({
      data: {
        ownerUserId: actor.userId,
        name: dto.name,
        description: dto.description ?? null,
        type: dto.type,
        status: 'DRAFT',
        timezone: dto.timezone ?? DEFAULT_MARKETING_TIMEZONE,
        statusHistory: { create: { fromStatus: null, toStatus: 'DRAFT', actorId: actor.userId } },
      },
    });
    await this.audit.record({ action: 'CAMPAIGN_CREATED', actorId: actor.userId, newValue: { campaignId: campaign.id } });
    return this.detail(actor, campaign.id);
  }

  async update(actor: Actor, campaignId: string, dto: UpdateCampaignInput) {
    await this.requireOwned(actor, campaignId);
    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: {
        name: dto.name ?? undefined,
        description: dto.description === undefined ? undefined : dto.description,
        type: dto.type ?? undefined,
        timezone: dto.timezone === undefined ? undefined : (dto.timezone ?? DEFAULT_MARKETING_TIMEZONE),
      },
    });
    await this.audit.record({ action: 'CAMPAIGN_UPDATED', actorId: actor.userId, newValue: { campaignId } });
    return this.detail(actor, campaignId);
  }

  async list(actor: Actor, status?: string) {
    const rows = await this.prisma.campaign.findMany({
      where: { ownerUserId: actor.userId, ...(status ? { status: status as never } : {}) },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      include: { _count: { select: { promotions: true, coupons: true, schedules: true } } },
    });
    return rows.map((c) => this.card(c));
  }

  async detail(actor: Actor, campaignId: string) {
    await this.requireOwned(actor, campaignId);
    return this.serializeDetail(campaignId);
  }

  // ===========================================================================
  // Schedules
  // ===========================================================================
  async addSchedule(actor: Actor, campaignId: string, dto: CampaignScheduleInput) {
    const campaign = await this.requireOwned(actor, campaignId);
    await this.prisma.campaignSchedule.create({
      data: { campaignId, startAt: dto.startAt, endAt: dto.endAt, timezone: dto.timezone ?? campaign.timezone },
    });
    await this.audit.record({ action: 'CAMPAIGN_UPDATED', actorId: actor.userId, newValue: { campaignId, addedSchedule: true } });
    return this.detail(actor, campaignId);
  }

  async removeSchedule(actor: Actor, campaignId: string, scheduleId: string) {
    await this.requireOwned(actor, campaignId);
    const schedule = await this.prisma.campaignSchedule.findFirst({ where: { id: scheduleId, campaignId } });
    if (!schedule) throw new NotFoundException('Schedule not found.');
    await this.prisma.campaignSchedule.delete({ where: { id: scheduleId } });
    await this.audit.record({ action: 'CAMPAIGN_UPDATED', actorId: actor.userId, newValue: { campaignId, removedSchedule: scheduleId } });
    return this.detail(actor, campaignId);
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================
  async setStatus(actor: Actor, campaignId: string, dto: CampaignStatusInput) {
    const campaign = await this.requireOwned(actor, campaignId);
    return this.applyStatus(campaign.id, campaign.status, dto.status, actor.userId, dto.note ?? null, () => this.detail(actor, campaignId));
  }

  /** Admin campaign oversight (campaigns.manage) — same transition rules, no owner scope. */
  async adminSetStatus(actor: Actor, campaignId: string, dto: CampaignStatusInput) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new NotFoundException('Campaign not found.');
    return this.applyStatus(campaign.id, campaign.status, dto.status, actor.userId, dto.note ?? null, () => this.serializeDetail(campaignId));
  }

  private async applyStatus<T>(
    campaignId: string,
    from: CampaignStatus,
    to: CampaignStatus,
    actorId: string,
    note: string | null,
    ret: () => Promise<T>,
  ) {
    if (from === to) throw new BadRequestException('The campaign is already in that status.');
    if (!canTransitionCampaign(from, to)) throw new BadRequestException(`A ${from.toLowerCase()} campaign cannot transition to ${to.toLowerCase()}.`);
    await this.prisma.$transaction([
      this.prisma.campaign.update({ where: { id: campaignId }, data: { status: to } }),
      this.prisma.campaignStatusHistory.create({ data: { campaignId, fromStatus: from, toStatus: to, actorId, note } }),
    ]);
    await this.audit.record({ action: 'CAMPAIGN_STATUS_CHANGED', actorId, newValue: { campaignId, from, to } });
    return ret();
  }

  // ===========================================================================
  // Admin
  // ===========================================================================
  async adminList(filter: { status?: string; ownerUserId?: string }) {
    const where: Prisma.CampaignWhereInput = {
      ...(filter.status ? { status: filter.status as never } : {}),
      ...(filter.ownerUserId ? { ownerUserId: filter.ownerUserId } : {}),
    };
    const rows = await this.prisma.campaign.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 200,
      include: { owner: { select: { email: true } }, _count: { select: { promotions: true, coupons: true, schedules: true } } },
    });
    return rows.map((c) => ({ ...this.card(c), ownerEmail: c.owner?.email ?? null }));
  }

  // ===========================================================================
  // Serialization
  // ===========================================================================
  private card(c: {
    id: string; name: string; description: string | null; type: string; status: string; timezone: string; createdAt: Date; updatedAt: Date;
    _count?: { promotions?: number; coupons?: number; schedules?: number };
  }) {
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      type: c.type,
      status: c.status,
      timezone: c.timezone,
      promotionCount: c._count?.promotions ?? 0,
      couponCount: c._count?.coupons ?? 0,
      scheduleCount: c._count?.schedules ?? 0,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  private async serializeDetail(campaignId: string) {
    const c = await this.prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
      include: {
        schedules: { orderBy: { startAt: 'asc' } },
        statusHistory: { orderBy: { createdAt: 'asc' } },
        promotions: { orderBy: { updatedAt: 'desc' }, select: { id: true, title: true, type: true, status: true, priority: true, isActive: true } },
        _count: { select: { promotions: true, coupons: true, schedules: true } },
      },
    });
    return {
      ...this.card(c),
      schedules: c.schedules.map((s) => ({ id: s.id, startAt: s.startAt, endAt: s.endAt, timezone: s.timezone })),
      statusHistory: c.statusHistory.map((h) => ({ from: h.fromStatus, to: h.toStatus, note: h.note, at: h.createdAt })),
      promotions: c.promotions,
    };
  }
}
