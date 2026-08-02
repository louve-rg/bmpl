import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface Actor {
  userId: string;
}

/**
 * Admin owner/agent moderation (M25). Owner/agent APPROVAL is via the existing role-
 * application review; this covers profile visibility (suspend / restore) independent of
 * the role. Suspending an owner also takes their live listings offline so a suspended
 * owner runs no public listings. A suspended agent's assigned listings drop from public
 * search automatically (discovery excludes non-approved agents).
 */
@Injectable()
export class RealEstateAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---- owners ----
  async listOwners(status?: string) {
    const rows = await this.prisma.propertyOwnerProfile.findMany({
      where: status ? { approvalStatus: status as never } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { _count: { select: { listings: true } } },
    });
    return rows.map((o) => ({ id: o.id, name: o.displayName ?? o.legalName, district: o.district, approvalStatus: o.approvalStatus, identityVerified: o.identityVerified, listingCount: o._count.listings, createdAt: o.createdAt }));
  }

  async ownerDetail(id: string) {
    const o = await this.prisma.propertyOwnerProfile.findUnique({ where: { id }, include: { _count: { select: { listings: true } } } });
    if (!o) throw new NotFoundException('Owner not found.');
    const byStatus = await this.prisma.propertyListing.groupBy({ by: ['status'], where: { ownerProfileId: id }, _count: { _all: true } });
    return { ...o, listingCount: o._count.listings, listingsByStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })) };
  }

  async setOwnerApproval(actor: Actor, id: string, status: 'APPROVED' | 'SUSPENDED', reason?: string) {
    const o = await this.prisma.propertyOwnerProfile.findUnique({ where: { id } });
    if (!o) throw new NotFoundException('Owner not found.');
    await this.prisma.propertyOwnerProfile.update({ where: { id }, data: { approvalStatus: status } });
    if (status === 'SUSPENDED') {
      await this.prisma.propertyListing.updateMany({ where: { ownerProfileId: id, status: { in: ['PUBLISHED', 'UNDER_OFFER'] } }, data: { status: 'SUSPENDED' } });
    }
    await this.audit.record({ action: 'PROPERTY_OWNER_PROFILE_UPSERTED', actorId: actor.userId, newValue: { propertyOwnerProfileId: id, approvalStatus: status, reason: reason ?? null } });
    await this.notifications.createInApp({ userId: o.userId, type: 'ACCOUNT', category: 'ACCOUNT', title: status === 'SUSPENDED' ? 'Property-owner account suspended' : 'Property-owner account restored', body: reason ? `${status}: ${reason}` : `Your property-owner account was ${status.toLowerCase()}.`, data: { propertyOwnerProfileId: id } });
    return this.ownerDetail(id);
  }

  // ---- agents ----
  async listAgents(status?: string) {
    const rows = await this.prisma.realEstateAgentProfile.findMany({
      where: status ? { approvalStatus: status as never } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { agency: { select: { name: true, slug: true } }, _count: { select: { listings: true } } },
    });
    return rows.map((a) => ({ id: a.id, displayName: a.displayName, slug: a.slug, agency: a.agency, approvalStatus: a.approvalStatus, isActive: a.isActive, listingCount: a._count.listings, createdAt: a.createdAt }));
  }

  async agentDetail(id: string) {
    const a = await this.prisma.realEstateAgentProfile.findUnique({ where: { id }, include: { agency: { select: { name: true, slug: true } }, _count: { select: { listings: true } } } });
    if (!a) throw new NotFoundException('Agent not found.');
    const byStatus = await this.prisma.propertyListing.groupBy({ by: ['status'], where: { agentProfileId: id }, _count: { _all: true } });
    return { ...a, photoKey: undefined, listingCount: a._count.listings, listingsByStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })) };
  }

  async setAgentApproval(actor: Actor, id: string, status: 'APPROVED' | 'SUSPENDED', reason?: string) {
    const a = await this.prisma.realEstateAgentProfile.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Agent not found.');
    await this.prisma.realEstateAgentProfile.update({ where: { id }, data: { approvalStatus: status, ...(status === 'SUSPENDED' ? { isActive: false } : { isActive: true }) } });
    await this.audit.record({ action: 'REAL_ESTATE_AGENT_PROFILE_UPSERTED', actorId: actor.userId, newValue: { agentProfileId: id, approvalStatus: status, reason: reason ?? null } });
    await this.notifications.createInApp({ userId: a.userId, type: 'ACCOUNT', category: 'ACCOUNT', title: status === 'SUSPENDED' ? 'Agent account suspended' : 'Agent account restored', body: reason ? `${status}: ${reason}` : `Your agent account was ${status.toLowerCase()}.`, data: { agentProfileId: id } });
    return this.agentDetail(id);
  }
}
