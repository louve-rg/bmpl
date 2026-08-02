import { Injectable, NotFoundException } from '@nestjs/common';
import type { JobReportInput, ResolveJobReportInput } from '@bmpl/validation';
import { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface Actor {
  userId: string;
}

/**
 * Job reporting & safety (M24) — reuses the M23 moderation pattern. One report per
 * (job, reporter); a single report never auto-removes a listing (admins triage).
 */
@Injectable()
export class JobReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async report(actor: Actor, jobId: string, dto: JobReportInput) {
    const job = await this.prisma.jobListing.findFirst({ where: { id: jobId, status: 'PUBLISHED' }, select: { id: true, title: true } });
    if (!job) throw new NotFoundException('Job not found.');
    try {
      await this.prisma.jobReport.create({ data: { jobId, reporterId: actor.userId, reason: dto.reason, note: dto.note ?? null } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { ok: true }; // already reported
      throw e;
    }
    await this.audit.record({ action: 'JOB_REPORTED', actorId: actor.userId, newValue: { jobId, reason: dto.reason } });
    await this.notifications.notifyAdmins('jobs.read', { type: 'SECURITY', event: 'ADMIN_ORDER_EXCEPTION', title: 'Job reported', body: `"${job.title}" was reported (${dto.reason.toLowerCase()}).`, data: { jobId } });
    return { ok: true };
  }

  async adminList(status?: string) {
    const rows = await this.prisma.jobReport.findMany({
      where: status ? { status: status as never } : { status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { job: { select: { id: true, title: true, slug: true, status: true } } },
    });
    return rows.map((r) => ({ id: r.id, jobId: r.jobId, reason: r.reason, note: r.note, status: r.status, createdAt: r.createdAt, job: r.job }));
  }

  async resolve(actor: Actor, reportId: string, dto: ResolveJobReportInput) {
    const rep = await this.prisma.jobReport.findUnique({ where: { id: reportId } });
    if (!rep) throw new NotFoundException('Report not found.');
    await this.prisma.jobReport.update({ where: { id: reportId }, data: { status: dto.status, resolvedById: actor.userId, resolutionNote: dto.note ?? null, resolvedAt: new Date() } });
    await this.audit.record({ action: 'JOB_REPORT_RESOLVED', actorId: actor.userId, newValue: { reportId, status: dto.status } });
    return { ok: true };
  }
}
