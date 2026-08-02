import { Injectable, NotFoundException } from '@nestjs/common';
import type { PropertyReportInput, ResolvePropertyReportInput } from '@bmpl/validation';
import { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface Actor {
  userId: string;
}

/**
 * Property reporting & safety (M25) — mirrors the M24 report pattern. One report per
 * (listing, reporter); a single report never auto-removes a listing (admins triage).
 */
@Injectable()
export class PropertyReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async report(actor: Actor, listingId: string, dto: PropertyReportInput) {
    const listing = await this.prisma.propertyListing.findFirst({ where: { id: listingId, status: { in: ['PUBLISHED', 'UNDER_OFFER'] } }, select: { id: true, title: true } });
    if (!listing) throw new NotFoundException('Listing not found.');
    try {
      await this.prisma.propertyReport.create({ data: { listingId, reporterId: actor.userId, reason: dto.reason, note: dto.note ?? null } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { ok: true }; // already reported
      throw e;
    }
    await this.audit.record({ action: 'PROPERTY_REPORTED', actorId: actor.userId, newValue: { listingId, reason: dto.reason } });
    await this.notifications.notifyAdmins('properties.read', { type: 'SECURITY', event: 'ADMIN_ORDER_EXCEPTION', title: 'Listing reported', body: `"${listing.title}" was reported (${dto.reason.toLowerCase()}).`, data: { listingId } });
    return { ok: true };
  }

  async adminList(status?: string) {
    const rows = await this.prisma.propertyReport.findMany({
      where: status ? { status: status as never } : { status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { listing: { select: { id: true, title: true, slug: true, reference: true, status: true } } },
    });
    return rows.map((r) => ({ id: r.id, listingId: r.listingId, reason: r.reason, note: r.note, status: r.status, createdAt: r.createdAt, listing: r.listing }));
  }

  async resolve(actor: Actor, reportId: string, dto: ResolvePropertyReportInput) {
    const rep = await this.prisma.propertyReport.findUnique({ where: { id: reportId } });
    if (!rep) throw new NotFoundException('Report not found.');
    await this.prisma.propertyReport.update({ where: { id: reportId }, data: { status: dto.status, resolvedById: actor.userId, resolutionNote: dto.note ?? null, resolvedAt: new Date() } });
    await this.audit.record({ action: 'PROPERTY_REPORT_RESOLVED', actorId: actor.userId, newValue: { reportId, status: dto.status } });
    return { ok: true };
  }
}
