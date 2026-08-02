import { Injectable, NotFoundException } from '@nestjs/common';
import { JOBS_PAGE_SIZE, RECENTLY_VIEWED_JOBS_MAX } from '@bmpl/shared';
import { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { JobsService } from './jobs.service';
import { EmployerService } from './employer.service';

export interface JobSearchQuery {
  q?: string;
  categorySlug?: string;
  district?: string;
  employmentType?: string;
  workArrangement?: string;
  remote?: boolean;
  salaryMin?: number;
  experienceLevel?: string;
  educationLevel?: string;
  postedWithinDays?: number;
  closingSoon?: boolean;
  sort?: string;
  page?: number;
}

/**
 * Public job discovery (M24): search/filter/sort over PUBLISHED jobs of APPROVED
 * employers only (drafts/rejected/closed/archived/suspended and expired listings are
 * excluded), the public job detail, deterministic related jobs, and the M20-style
 * saved + recently-viewed collections. No AI; salary respects its visibility.
 */
@Injectable()
export class JobDiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly employers: EmployerService,
  ) {}

  private baseWhere(): Prisma.JobListingWhereInput {
    return {
      status: 'PUBLISHED',
      employerProfile: { approvalStatus: 'APPROVED' },
      OR: [{ applicationDeadline: null }, { applicationDeadline: { gte: new Date() } }], // exclude expired
    };
  }

  async publicSearch(query: JobSearchQuery) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = JOBS_PAGE_SIZE;
    const and: Prisma.JobListingWhereInput[] = [this.baseWhere()];
    if (query.q) {
      const c = { contains: query.q, mode: 'insensitive' as const };
      and.push({ OR: [{ title: c }, { description: c }, { employerProfile: { companyName: c } }, { skills: { some: { name: c } } }] });
    }
    if (query.categorySlug) and.push({ jobCategory: { slug: query.categorySlug } });
    if (query.district) and.push({ district: query.district as never });
    if (query.employmentType) and.push({ employmentType: query.employmentType as never });
    if (query.workArrangement) and.push({ workArrangement: query.workArrangement as never });
    if (query.remote) and.push({ OR: [{ workArrangement: 'REMOTE' }, { remoteEligible: true }] });
    if (query.experienceLevel) and.push({ experienceLevel: query.experienceLevel as never });
    if (query.educationLevel) and.push({ educationLevel: query.educationLevel as never });
    if (query.salaryMin != null) and.push({ OR: [{ salaryMaxMinor: { gte: BigInt(query.salaryMin) } }, { salaryMinMinor: { gte: BigInt(query.salaryMin) } }] });
    if (query.postedWithinDays != null) {
      const since = new Date();
      since.setUTCDate(since.getUTCDate() - query.postedWithinDays);
      and.push({ publishedAt: { gte: since } });
    }
    if (query.closingSoon) {
      const soon = new Date();
      soon.setUTCDate(soon.getUTCDate() + 7);
      and.push({ applicationDeadline: { not: null, lte: soon, gte: new Date() } });
    }
    const where: Prisma.JobListingWhereInput = { AND: and };
    const orderBy: Prisma.JobListingOrderByWithRelationInput =
      query.sort === 'deadline'
        ? { applicationDeadline: { sort: 'asc', nulls: 'last' } }
        : query.sort === 'salary_asc'
          ? { salaryMinMinor: { sort: 'asc', nulls: 'last' } }
          : query.sort === 'salary_desc'
            ? { salaryMaxMinor: { sort: 'desc', nulls: 'last' } }
            : { publishedAt: 'desc' };
    const [rows, total] = await Promise.all([
      this.prisma.jobListing.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize, include: { employerProfile: { select: { companyName: true, slug: true, logoKey: true } }, jobCategory: { select: { name: true, slug: true } } } }),
      this.prisma.jobListing.count({ where }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: rows.map((j) => ({ ...this.jobs.card(j), company: { name: j.employerProfile.companyName, slug: j.employerProfile.slug }, category: j.jobCategory })),
    };
  }

  async publicDetail(slug: string) {
    const job = await this.prisma.jobListing.findFirst({ where: { slug, ...this.baseWhere() }, select: { id: true } });
    if (!job) throw new NotFoundException('Job not found.');
    const full = await this.jobs.serializeFull(job.id, false);
    const company = await this.employers.publicCompany((full.company as { slug: string }).slug).catch(() => null);
    const related = await this.related(job.id);
    return { ...full, companyProfile: company, related };
  }

  private async related(jobId: string, limit = 6) {
    const job = await this.prisma.jobListing.findUnique({ where: { id: jobId }, select: { jobCategoryId: true, district: true } });
    if (!job) return [];
    const rows = await this.prisma.jobListing.findMany({
      where: { AND: [this.baseWhere(), { id: { not: jobId } }, { OR: [job.jobCategoryId ? { jobCategoryId: job.jobCategoryId } : {}, job.district ? { district: job.district } : {}] }] },
      orderBy: { publishedAt: 'desc' },
      take: limit,
      include: { employerProfile: { select: { companyName: true, slug: true } } },
    });
    return rows.map((j) => ({ ...this.jobs.card(j), company: { name: j.employerProfile.companyName, slug: j.employerProfile.slug } }));
  }

  // ===========================================================================
  // Saved jobs (M20 pattern)
  // ===========================================================================
  private async assertViewableJob(jobId: string) {
    const j = await this.prisma.jobListing.findFirst({ where: { id: jobId, status: 'PUBLISHED', employerProfile: { approvalStatus: 'APPROVED' } }, select: { id: true } });
    if (!j) throw new NotFoundException('Job not found.');
  }

  async save(userId: string, jobId: string) {
    await this.assertViewableJob(jobId);
    try {
      await this.prisma.savedJob.create({ data: { userId, jobId } });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
    return { saved: true };
  }
  async unsave(userId: string, jobId: string) {
    await this.prisma.savedJob.deleteMany({ where: { userId, jobId } });
    return { saved: false };
  }
  async savedIds(userId: string) {
    const rows = await this.prisma.savedJob.findMany({ where: { userId }, select: { jobId: true } });
    return { jobIds: rows.map((r) => r.jobId) };
  }
  async listSaved(userId: string) {
    const rows = await this.prisma.savedJob.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 200, include: { job: { include: { employerProfile: { select: { companyName: true, slug: true } } } } } });
    return {
      items: rows.map((r) => {
        const j = r.job;
        const closed = j.status !== 'PUBLISHED' || (j.applicationDeadline != null && j.applicationDeadline < new Date());
        return { savedAt: r.createdAt, jobId: j.id, closed, ...this.jobs.card(j), status: j.status, company: { name: j.employerProfile.companyName, slug: j.employerProfile.slug } };
      }),
    };
  }

  async recordView(userId: string, jobId: string) {
    await this.assertViewableJob(jobId);
    await this.prisma.recentlyViewedJob.upsert({ where: { userId_jobId: { userId, jobId } }, create: { userId, jobId }, update: { viewedAt: new Date() } });
    const overflow = await this.prisma.recentlyViewedJob.findMany({ where: { userId }, orderBy: { viewedAt: 'desc' }, skip: RECENTLY_VIEWED_JOBS_MAX, select: { id: true } });
    if (overflow.length) await this.prisma.recentlyViewedJob.deleteMany({ where: { id: { in: overflow.map((r) => r.id) } } });
    return { ok: true };
  }
  async listRecentlyViewed(userId: string) {
    const rows = await this.prisma.recentlyViewedJob.findMany({ where: { userId }, orderBy: { viewedAt: 'desc' }, take: RECENTLY_VIEWED_JOBS_MAX, include: { job: { include: { employerProfile: { select: { companyName: true, slug: true } } } } } });
    return {
      items: rows
        .filter((r) => r.job.status === 'PUBLISHED')
        .map((r) => ({ viewedAt: r.viewedAt, ...this.jobs.card(r.job), company: { name: r.job.employerProfile.companyName, slug: r.job.employerProfile.slug } })),
    };
  }
}
