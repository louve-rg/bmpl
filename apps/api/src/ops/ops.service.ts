import { Injectable } from '@nestjs/common';
import { toCsv, type AnnouncementLevel } from '@bmpl/shared';
import type { UpdatePlatformSettingsInput } from '@bmpl/validation';
import { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface Actor {
  userId: string;
}

/**
 * Platform Operations (M23). A cross-domain operations console — aggregated action
 * queues + audit export — and the admin-managed announcement/maintenance banner.
 * Read-only over existing domain tables (no mutation of business state); the only
 * write is the single platform-settings row. maintenanceMode is DISPLAY-ONLY and is
 * never used to gate API access.
 */
@Injectable()
export class OpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ===========================================================================
  // Operations overview — aggregated action queues (ops.read)
  // ===========================================================================
  async overview() {
    const [
      pendingVendorApplications,
      pendingProductModeration,
      pendingDriverVehicles,
      pendingRoleApplications,
      moreInfoRoleApplications,
      openReviewReports,
      openSupportCases,
      failedSettlements,
      deliveriesPendingAssignment,
      awaitingPickupCollection,
      suspendedUsers,
      suspendedRoles,
    ] = await Promise.all([
      this.prisma.vendorProfile.count({ where: { approvalStatus: 'PENDING' } }),
      this.prisma.product.count({ where: { status: 'PENDING_REVIEW' } }),
      this.prisma.driverVehicle.count({ where: { approvalStatus: 'PENDING' } }),
      this.prisma.roleApplication.count({ where: { status: 'PENDING' } }),
      this.prisma.roleApplication.count({ where: { status: 'MORE_INFO_REQUIRED' } }),
      this.prisma.reviewReport.count({ where: { status: 'OPEN' } }),
      this.prisma.conversation.count({ where: { contextType: 'SUPPORT_CASE', status: 'OPEN' } }),
      this.prisma.vendorSettlement.count({ where: { status: 'FAILED' } }),
      this.prisma.orderDelivery.count({ where: { status: 'PENDING_ASSIGNMENT' } }),
      this.prisma.vendorOrder.count({ where: { status: 'READY_FOR_PICKUP' } }),
      this.prisma.user.count({ where: { status: 'SUSPENDED' } }),
      this.prisma.userRole.count({ where: { status: 'SUSPENDED' } }),
    ]);
    // Belize Connect Jobs (M24) queues.
    const [pendingJobModeration, openJobReports] = await Promise.all([
      this.prisma.jobListing.count({ where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } } }),
      this.prisma.jobReport.count({ where: { status: 'OPEN' } }),
    ]);
    const queues = {
      pendingVendorApplications,
      pendingProductModeration,
      pendingDriverVehicles,
      pendingRoleApplications,
      moreInfoRoleApplications,
      openReviewReports,
      openSupportCases,
      failedSettlements,
      deliveriesPendingAssignment,
      awaitingPickupCollection,
      pendingJobModeration,
      openJobReports,
      suspendedUsers,
      suspendedRoles,
    };
    // "Actionable" excludes the informational suspended-* counts.
    const totalActionable =
      pendingVendorApplications + pendingProductModeration + pendingDriverVehicles +
      pendingRoleApplications + moreInfoRoleApplications + openReviewReports +
      openSupportCases + failedSettlements + deliveriesPendingAssignment + awaitingPickupCollection +
      pendingJobModeration + openJobReports;
    return { queues, totalActionable, settings: await this.getSettings() };
  }

  // ===========================================================================
  // Announcement / maintenance banner
  // ===========================================================================
  /** Get (or lazily create) the singleton platform-settings row. */
  async getSettings() {
    const existing = await this.prisma.platformSetting.findFirst({ orderBy: { createdAt: 'asc' } });
    if (existing) return existing;
    return this.prisma.platformSetting.create({ data: {} });
  }

  async updateSettings(actor: Actor, dto: UpdatePlatformSettingsInput) {
    const current = await this.getSettings();
    const updated = await this.prisma.platformSetting.update({
      where: { id: current.id },
      data: {
        announcementActive: dto.announcementActive ?? undefined,
        announcementLevel: (dto.announcementLevel as AnnouncementLevel | undefined) ?? undefined,
        announcementMessage: dto.announcementMessage === undefined ? undefined : dto.announcementMessage,
        maintenanceMode: dto.maintenanceMode ?? undefined,
        maintenanceMessage: dto.maintenanceMessage === undefined ? undefined : dto.maintenanceMessage,
        updatedById: actor.userId,
      },
    });
    await this.audit.record({
      action: 'PLATFORM_SETTING_UPDATED',
      actorId: actor.userId,
      previousValue: { announcementActive: current.announcementActive, announcementLevel: current.announcementLevel, maintenanceMode: current.maintenanceMode },
      newValue: { announcementActive: updated.announcementActive, announcementLevel: updated.announcementLevel, maintenanceMode: updated.maintenanceMode },
    });
    return updated;
  }

  /** Public banner payload — only ACTIVE notices, no internal metadata. */
  async publicBanner() {
    const s = await this.getSettings();
    return {
      announcement: s.announcementActive && s.announcementMessage
        ? { level: s.announcementLevel, message: s.announcementMessage }
        : null,
      maintenance: s.maintenanceMode
        ? { message: s.maintenanceMessage ?? 'The platform is undergoing scheduled maintenance.' }
        : null,
    };
  }

  // ===========================================================================
  // Audit export (audit.read)
  // ===========================================================================
  async auditCsv(filter: { action?: string; actorId?: string; from?: string; to?: string }) {
    const where: Prisma.AuditLogWhereInput = {
      ...(filter.action ? { action: filter.action as never } : {}),
      ...(filter.actorId ? { actorId: filter.actorId } : {}),
      ...(filter.from || filter.to
        ? { createdAt: { ...(filter.from ? { gte: new Date(filter.from) } : {}), ...(filter.to ? { lte: new Date(filter.to) } : {}) } }
        : {}),
    };
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 10000,
      include: { actor: { select: { email: true } }, targetUser: { select: { email: true } } },
    });
    const header = ['createdAt', 'action', 'actorEmail', 'targetEmail', 'targetRole', 'reason', 'ipAddress'];
    const out = rows.map((r) => [
      r.createdAt.toISOString(),
      r.action,
      r.actor?.email ?? '',
      r.targetUser?.email ?? '',
      r.targetRole ?? '',
      r.reason ?? '',
      r.ipAddress ?? '',
    ]);
    return toCsv(header, out);
  }
}
