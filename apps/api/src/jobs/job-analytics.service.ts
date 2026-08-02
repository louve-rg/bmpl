import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmployerService } from './employer.service';

/**
 * Belize Connect analytics (M24) — reuses the M22 read-only aggregation approach.
 * Admin metrics are platform-wide; employer metrics are scoped to their own jobs.
 * Job-seeker metrics stay privacy-conscious (none exposed cross-user). No fake data.
 */
@Injectable()
export class JobAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employers: EmployerService,
  ) {}

  async adminOverview() {
    const [activeJobs, submittedJobs, underReview, openReports, applications, hires, approvedEmployers, byCategoryRaw, byDistrictRaw] = await Promise.all([
      this.prisma.jobListing.count({ where: { status: 'PUBLISHED' } }),
      this.prisma.jobListing.count({ where: { status: 'SUBMITTED' } }),
      this.prisma.jobListing.count({ where: { status: 'UNDER_REVIEW' } }),
      this.prisma.jobReport.count({ where: { status: 'OPEN' } }),
      this.prisma.jobApplication.count(),
      this.prisma.jobApplication.count({ where: { status: 'HIRED' } }),
      this.prisma.userRole.count({ where: { roleCode: 'EMPLOYER', status: 'APPROVED' } }),
      this.prisma.jobListing.groupBy({ by: ['jobCategoryId'], where: { status: 'PUBLISHED' }, _count: { _all: true } }),
      this.prisma.jobListing.groupBy({ by: ['district'], where: { status: 'PUBLISHED' }, _count: { _all: true } }),
    ]);
    const cats = await this.prisma.jobCategory.findMany({ where: { id: { in: byCategoryRaw.map((r) => r.jobCategoryId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
    const catName = new Map(cats.map((c) => [c.id, c.name]));
    return {
      activeJobs,
      moderationBacklog: submittedJobs + underReview,
      openReports,
      applications,
      hires,
      applicationConversion: applications ? Math.round((hires / applications) * 10000) / 100 : 0,
      approvedEmployers,
      byCategory: byCategoryRaw.map((r) => ({ category: r.jobCategoryId ? (catName.get(r.jobCategoryId) ?? 'Uncategorized') : 'Uncategorized', count: r._count._all })).sort((a, b) => b.count - a.count),
      byDistrict: byDistrictRaw.map((r) => ({ district: r.district ?? 'Unspecified', count: r._count._all })).sort((a, b) => b.count - a.count),
    };
  }

  async employerOverview(userId: string) {
    const employer = await this.employers.requireProfile(userId);
    const [activeJobs, totalJobs, apps, shortlisted, interviewed, hired] = await Promise.all([
      this.prisma.jobListing.count({ where: { employerProfileId: employer.id, status: 'PUBLISHED' } }),
      this.prisma.jobListing.count({ where: { employerProfileId: employer.id } }),
      this.prisma.jobApplication.count({ where: { job: { employerProfileId: employer.id } } }),
      this.prisma.jobApplication.count({ where: { job: { employerProfileId: employer.id }, status: 'SHORTLISTED' } }),
      this.prisma.jobApplication.count({ where: { job: { employerProfileId: employer.id }, status: { in: ['INTERVIEW_REQUESTED', 'INTERVIEW_SCHEDULED'] } } }),
      this.prisma.jobApplication.count({ where: { job: { employerProfileId: employer.id }, status: 'HIRED' } }),
    ]);
    return { activeJobs, totalJobs, applications: apps, shortlisted, interviewed, hired, applicationConversion: apps ? Math.round((hired / apps) * 10000) / 100 : 0 };
  }
}
