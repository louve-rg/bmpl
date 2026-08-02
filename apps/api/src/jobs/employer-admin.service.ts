import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface Actor {
  userId: string;
}

/**
 * Admin employer/company moderation (M24). Employer APPROVAL is via the existing
 * EMPLOYER role-application review; this covers company-profile visibility (suspend /
 * restore) independent of the role. Suspending an employer also suspends their live
 * listings so a suspended employer cannot keep public jobs running.
 */
@Injectable()
export class EmployerAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(status?: string) {
    const rows = await this.prisma.employerProfile.findMany({
      where: status ? { approvalStatus: status as never } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { _count: { select: { jobs: true } } },
    });
    return rows.map((e) => ({ id: e.id, companyName: e.companyName, slug: e.slug, industry: e.industry, district: e.district, approvalStatus: e.approvalStatus, jobCount: e._count.jobs, createdAt: e.createdAt }));
  }

  async detail(id: string) {
    const e = await this.prisma.employerProfile.findUnique({ where: { id }, include: { _count: { select: { jobs: true } } } });
    if (!e) throw new NotFoundException('Employer not found.');
    const jobsByStatus = await this.prisma.jobListing.groupBy({ by: ['status'], where: { employerProfileId: id }, _count: { _all: true } });
    return { ...e, logoKey: undefined, bannerKey: undefined, jobCount: e._count.jobs, jobsByStatus: jobsByStatus.map((j) => ({ status: j.status, count: j._count._all })) };
  }

  async setApproval(actor: Actor, id: string, status: 'APPROVED' | 'SUSPENDED', reason?: string) {
    const e = await this.prisma.employerProfile.findUnique({ where: { id } });
    if (!e) throw new NotFoundException('Employer not found.');
    await this.prisma.employerProfile.update({ where: { id }, data: { approvalStatus: status } });
    if (status === 'SUSPENDED') {
      // Take their live listings offline so a suspended employer runs no public jobs.
      await this.prisma.jobListing.updateMany({ where: { employerProfileId: id, status: 'PUBLISHED' }, data: { status: 'SUSPENDED' } });
    }
    await this.audit.record({ action: 'EMPLOYER_PROFILE_UPSERTED', actorId: actor.userId, newValue: { employerProfileId: id, approvalStatus: status, reason: reason ?? null } });
    await this.notifications.createInApp({ userId: e.userId, type: 'ACCOUNT', category: 'ACCOUNT', title: status === 'SUSPENDED' ? 'Employer account suspended' : 'Employer account restored', body: reason ? `${status}: ${reason}` : `Your employer account was ${status.toLowerCase()}.`, data: { employerProfileId: id } });
    return this.detail(id);
  }
}
