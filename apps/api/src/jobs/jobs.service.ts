import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { slugify, slugWithSuffix } from '@bmpl/shared';
import type { CreateJobInput, JobCategoryInput, JobModerateInput, JobQuestionInput, UpdateJobInput } from '@bmpl/validation';
import { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmployerService } from './employer.service';

export interface Actor {
  userId: string;
  status?: string;
  permissions?: string[];
}

const EDITABLE: string[] = ['DRAFT', 'MORE_INFO_REQUIRED', 'REJECTED'];
const n = (v: bigint | null) => (v == null ? null : Number(v));

/**
 * Job listings (M24). Employer-authored, moderated before going public. The employer
 * can never bypass moderation: submit → admin approve → PUBLISHED. Only PUBLISHED jobs
 * (of APPROVED employers) are public and accept applications. All writes ownership-
 * scoped to the caller's employer profile; admin moderation is permission-gated.
 */
@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly employers: EmployerService,
  ) {}

  private async uniqueSlug(title: string) {
    const base = slugify(title) || 'job';
    let candidate = base;
    for (let i = 2; i < 500; i += 1) {
      if (!(await this.prisma.jobListing.findUnique({ where: { slug: candidate } }))) return candidate;
      candidate = slugWithSuffix(base, i);
    }
    return slugWithSuffix(base, Date.now() % 100000);
  }

  private async ownedJob(userId: string, jobId: string) {
    const employer = await this.employers.requireProfile(userId);
    const job = await this.prisma.jobListing.findFirst({ where: { id: jobId, employerProfileId: employer.id } });
    if (!job) throw new NotFoundException('Job not found.');
    return { employer, job };
  }

  // ===========================================================================
  // Employer job authoring
  // ===========================================================================
  async create(actor: Actor, dto: CreateJobInput) {
    const employer = await this.employers.requirePublishable(actor.userId);
    const job = await this.prisma.jobListing.create({
      data: {
        employerProfileId: employer.id,
        jobCategoryId: dto.jobCategoryId ?? null,
        title: dto.title,
        slug: await this.uniqueSlug(dto.title),
        employmentType: dto.employmentType,
        workArrangement: dto.workArrangement ?? 'ONSITE',
        district: dto.district ?? null,
        city: dto.city ?? null,
        remoteEligible: dto.remoteEligible ?? false,
        description: dto.description,
        responsibilities: dto.responsibilities ?? null,
        requirements: dto.requirements ?? null,
        preferredQualifications: dto.preferredQualifications ?? null,
        experienceLevel: dto.experienceLevel ?? null,
        educationLevel: dto.educationLevel ?? null,
        salaryMinMinor: dto.salaryMinMinor == null ? null : BigInt(dto.salaryMinMinor),
        salaryMaxMinor: dto.salaryMaxMinor == null ? null : BigInt(dto.salaryMaxMinor),
        salaryPeriod: dto.salaryPeriod ?? null,
        salaryVisibility: dto.salaryVisibility ?? 'HIDDEN',
        openings: dto.openings ?? 1,
        applicationDeadline: dto.applicationDeadline ?? null,
        startDate: dto.startDate ?? null,
        applicationMethod: dto.applicationMethod ?? 'INTERNAL',
        externalUrl: dto.externalUrl ?? null,
        applicationEmail: dto.applicationEmail ?? null,
        status: 'DRAFT',
        skills: dto.skills?.length ? { create: dto.skills.map((s) => ({ name: s.name, required: s.required ?? true })) } : undefined,
        benefits: dto.benefits?.length ? { create: dto.benefits.map((name) => ({ name })) } : undefined,
      },
    });
    await this.audit.record({ action: 'JOB_CREATED', actorId: actor.userId, newValue: { jobId: job.id } });
    return this.employerDetail(actor.userId, job.id);
  }

  async update(actor: Actor, jobId: string, dto: UpdateJobInput) {
    const { job } = await this.ownedJob(actor.userId, jobId);
    if (!EDITABLE.includes(job.status)) throw new BadRequestException('Only draft, rejected, or more-info jobs can be edited. Close and duplicate a published job instead.');
    await this.prisma.$transaction(async (tx) => {
      await tx.jobListing.update({
        where: { id: jobId },
        data: {
          jobCategoryId: dto.jobCategoryId === undefined ? undefined : dto.jobCategoryId,
          title: dto.title ?? undefined,
          employmentType: dto.employmentType ?? undefined,
          workArrangement: dto.workArrangement ?? undefined,
          district: dto.district === undefined ? undefined : dto.district,
          city: dto.city === undefined ? undefined : dto.city,
          remoteEligible: dto.remoteEligible ?? undefined,
          description: dto.description ?? undefined,
          responsibilities: dto.responsibilities === undefined ? undefined : dto.responsibilities,
          requirements: dto.requirements === undefined ? undefined : dto.requirements,
          preferredQualifications: dto.preferredQualifications === undefined ? undefined : dto.preferredQualifications,
          experienceLevel: dto.experienceLevel === undefined ? undefined : dto.experienceLevel,
          educationLevel: dto.educationLevel === undefined ? undefined : dto.educationLevel,
          salaryMinMinor: dto.salaryMinMinor === undefined ? undefined : dto.salaryMinMinor == null ? null : BigInt(dto.salaryMinMinor),
          salaryMaxMinor: dto.salaryMaxMinor === undefined ? undefined : dto.salaryMaxMinor == null ? null : BigInt(dto.salaryMaxMinor),
          salaryPeriod: dto.salaryPeriod === undefined ? undefined : dto.salaryPeriod,
          salaryVisibility: dto.salaryVisibility ?? undefined,
          openings: dto.openings ?? undefined,
          applicationDeadline: dto.applicationDeadline === undefined ? undefined : dto.applicationDeadline,
          startDate: dto.startDate === undefined ? undefined : dto.startDate,
          applicationMethod: dto.applicationMethod ?? undefined,
          externalUrl: dto.externalUrl === undefined ? undefined : dto.externalUrl,
          applicationEmail: dto.applicationEmail === undefined ? undefined : dto.applicationEmail,
        },
      });
      if (dto.skills) {
        await tx.jobSkill.deleteMany({ where: { jobId } });
        if (dto.skills.length) await tx.jobSkill.createMany({ data: dto.skills.map((s) => ({ jobId, name: s.name, required: s.required ?? true })) });
      }
      if (dto.benefits) {
        await tx.jobBenefit.deleteMany({ where: { jobId } });
        if (dto.benefits.length) await tx.jobBenefit.createMany({ data: dto.benefits.map((name) => ({ jobId, name })) });
      }
    });
    await this.audit.record({ action: 'JOB_UPDATED', actorId: actor.userId, newValue: { jobId } });
    return this.employerDetail(actor.userId, jobId);
  }

  async submit(actor: Actor, jobId: string) {
    await this.employers.requirePublishable(actor.userId);
    const { job } = await this.ownedJob(actor.userId, jobId);
    if (!EDITABLE.includes(job.status)) throw new BadRequestException('This job cannot be submitted from its current status.');
    await this.prisma.jobListing.update({ where: { id: jobId }, data: { status: 'SUBMITTED', moderationReason: null } });
    await this.audit.record({ action: 'JOB_SUBMITTED', actorId: actor.userId, newValue: { jobId } });
    await this.notifications.notifyAdmins('jobs.read', { type: 'MARKETPLACE', event: 'ADMIN_JOB_LISTING_SUBMITTED', title: 'Job submitted for review', body: `"${job.title}" was submitted for review.`, data: { jobId } });
    return this.employerDetail(actor.userId, jobId);
  }

  async close(actor: Actor, jobId: string) {
    const { job } = await this.ownedJob(actor.userId, jobId);
    if (job.status !== 'PUBLISHED') throw new BadRequestException('Only a published job can be closed.');
    await this.prisma.jobListing.update({ where: { id: jobId }, data: { status: 'CLOSED', closedAt: new Date() } });
    await this.audit.record({ action: 'JOB_CLOSED', actorId: actor.userId, newValue: { jobId } });
    return this.employerDetail(actor.userId, jobId);
  }

  async archive(actor: Actor, jobId: string) {
    const { job } = await this.ownedJob(actor.userId, jobId);
    if (['UNDER_REVIEW', 'SUBMITTED', 'PUBLISHED'].includes(job.status)) throw new BadRequestException('Close or wait for review before archiving.');
    await this.prisma.jobListing.update({ where: { id: jobId }, data: { status: 'ARCHIVED', archivedAt: new Date() } });
    await this.audit.record({ action: 'JOB_ARCHIVED', actorId: actor.userId, newValue: { jobId } });
    return this.employerDetail(actor.userId, jobId);
  }

  async duplicate(actor: Actor, jobId: string) {
    const employer = await this.employers.requirePublishable(actor.userId);
    const src = await this.prisma.jobListing.findFirst({ where: { id: jobId, employerProfileId: employer.id }, include: { skills: true, benefits: true, questions: true } });
    if (!src) throw new NotFoundException('Job not found.');
    const copy = await this.prisma.jobListing.create({
      data: {
        employerProfileId: employer.id, jobCategoryId: src.jobCategoryId, title: `${src.title} (copy)`, slug: await this.uniqueSlug(`${src.title} copy`),
        employmentType: src.employmentType, workArrangement: src.workArrangement, district: src.district, city: src.city, remoteEligible: src.remoteEligible,
        description: src.description, responsibilities: src.responsibilities, requirements: src.requirements, preferredQualifications: src.preferredQualifications,
        experienceLevel: src.experienceLevel, educationLevel: src.educationLevel, salaryMinMinor: src.salaryMinMinor, salaryMaxMinor: src.salaryMaxMinor,
        salaryPeriod: src.salaryPeriod, salaryVisibility: src.salaryVisibility, openings: src.openings, applicationMethod: src.applicationMethod,
        externalUrl: src.externalUrl, applicationEmail: src.applicationEmail, status: 'DRAFT',
        skills: { create: src.skills.map((s) => ({ name: s.name, required: s.required })) },
        benefits: { create: src.benefits.map((b) => ({ name: b.name })) },
        questions: { create: src.questions.map((q) => ({ prompt: q.prompt, type: q.type, required: q.required, options: q.options, sortOrder: q.sortOrder })) },
      },
    });
    await this.audit.record({ action: 'JOB_CREATED', actorId: actor.userId, newValue: { jobId: copy.id, duplicatedFrom: jobId } });
    return this.employerDetail(actor.userId, copy.id);
  }

  // ---- application questions ----
  async addQuestion(actor: Actor, jobId: string, dto: JobQuestionInput) {
    const { job } = await this.ownedJob(actor.userId, jobId);
    if (!EDITABLE.includes(job.status)) throw new BadRequestException('Edit questions only on draft/rejected/more-info jobs.');
    if ((dto.type === 'SINGLE_CHOICE' || dto.type === 'MULTIPLE_CHOICE') && (!dto.options || dto.options.length < 2)) {
      throw new BadRequestException('Choice questions need at least two options.');
    }
    await this.prisma.jobApplicationQuestion.create({ data: { jobId, prompt: dto.prompt, type: dto.type, required: dto.required ?? false, options: dto.options ?? [], sortOrder: dto.sortOrder ?? 0 } });
    return this.employerDetail(actor.userId, jobId);
  }

  async removeQuestion(actor: Actor, jobId: string, questionId: string) {
    const { job } = await this.ownedJob(actor.userId, jobId);
    if (!EDITABLE.includes(job.status)) throw new BadRequestException('Edit questions only on draft/rejected/more-info jobs.');
    await this.prisma.jobApplicationQuestion.deleteMany({ where: { id: questionId, jobId } });
    return this.employerDetail(actor.userId, jobId);
  }

  // ===========================================================================
  // Employer reads
  // ===========================================================================
  async employerList(userId: string, status?: string) {
    const employer = await this.employers.requireProfile(userId);
    const rows = await this.prisma.jobListing.findMany({
      where: { employerProfileId: employer.id, ...(status ? { status: status as never } : {}) },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      include: { _count: { select: { applications: true } } },
    });
    return rows.map((j) => ({ ...this.card(j), status: j.status, applicationCount: j._count.applications, updatedAt: j.updatedAt }));
  }

  async employerDetail(userId: string, jobId: string) {
    const { job } = await this.ownedJob(userId, jobId);
    return this.serializeFull(job.id, true);
  }

  // ===========================================================================
  // Admin moderation
  // ===========================================================================
  async adminList(filter: { status?: string; reported?: boolean }) {
    const where: Prisma.JobListingWhereInput = {
      ...(filter.status ? { status: filter.status as never } : {}),
      ...(filter.reported ? { reports: { some: { status: 'OPEN' } } } : {}),
    };
    const rows = await this.prisma.jobListing.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 200, include: { employerProfile: { select: { companyName: true, slug: true } }, _count: { select: { applications: true, reports: true } } } });
    return rows.map((j) => ({ ...this.card(j), status: j.status, company: j.employerProfile.companyName, applicationCount: j._count.applications, reportCount: j._count.reports, moderationReason: j.moderationReason }));
  }

  async adminDetail(jobId: string) {
    const job = await this.prisma.jobListing.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found.');
    return this.serializeFull(jobId, true);
  }

  async moderate(actor: Actor, jobId: string, dto: JobModerateInput) {
    const job = await this.prisma.jobListing.findUnique({ where: { id: jobId }, include: { employerProfile: { select: { userId: true } } } });
    if (!job) throw new NotFoundException('Job not found.');
    const reviewable = ['SUBMITTED', 'UNDER_REVIEW'];
    let status = job.status;
    let event = 'JOB_LISTING_MODERATED';
    let title = 'Job update';
    switch (dto.action) {
      case 'APPROVE':
        if (!reviewable.includes(job.status)) throw new BadRequestException('Only a submitted job can be approved.');
        status = 'PUBLISHED';
        title = 'Your job is live';
        break;
      case 'REJECT':
        if (!reviewable.includes(job.status)) throw new BadRequestException('Only a submitted job can be rejected.');
        status = 'REJECTED';
        title = 'Your job was not approved';
        break;
      case 'REQUEST_INFO':
        if (!reviewable.includes(job.status)) throw new BadRequestException('Only a submitted job can be returned for more info.');
        status = 'MORE_INFO_REQUIRED';
        title = 'More information needed';
        break;
      case 'UNPUBLISH':
        if (job.status !== 'PUBLISHED') throw new BadRequestException('Only a published job can be unpublished.');
        status = 'CLOSED';
        title = 'Your job was unpublished';
        break;
      case 'SUSPEND':
        status = 'SUSPENDED';
        title = 'Your job was suspended';
        break;
      case 'ARCHIVE':
        status = 'ARCHIVED';
        break;
    }
    await this.prisma.jobListing.update({
      where: { id: jobId },
      data: {
        status,
        moderationReason: dto.reason ?? null,
        moderatedById: actor.userId,
        moderatedAt: new Date(),
        publishedAt: status === 'PUBLISHED' && !job.publishedAt ? new Date() : undefined,
        closedAt: status === 'CLOSED' ? new Date() : undefined,
        archivedAt: status === 'ARCHIVED' ? new Date() : undefined,
      },
    });
    await this.audit.record({ action: status === 'PUBLISHED' ? 'JOB_PUBLISHED' : 'JOB_MODERATED', actorId: actor.userId, newValue: { jobId, action: dto.action, reason: dto.reason ?? null } });
    await this.notifications.createInApp({ userId: job.employerProfile.userId, type: 'MARKETPLACE', category: 'JOB', event, title, body: dto.reason ? `${title}: ${dto.reason}` : title, data: { jobId } });
    return this.adminDetail(jobId);
  }

  // ===========================================================================
  // Job categories (admin lookup)
  // ===========================================================================
  async listCategories(all = false) {
    return this.prisma.jobCategory.findMany({ where: all ? {} : { isVisible: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  }
  async createCategory(actor: Actor, dto: JobCategoryInput) {
    const slug = slugify(dto.name) || `cat-${Date.now()}`;
    const cat = await this.prisma.jobCategory.create({ data: { name: dto.name, slug, isVisible: dto.isVisible ?? true, sortOrder: dto.sortOrder ?? 0 } });
    await this.audit.record({ action: 'JOB_CATEGORY_MANAGED', actorId: actor.userId, newValue: { jobCategoryId: cat.id, action: 'CREATE' } });
    return cat;
  }
  async updateCategory(actor: Actor, id: string, dto: JobCategoryInput) {
    await this.prisma.jobCategory.update({ where: { id }, data: { name: dto.name, isVisible: dto.isVisible ?? undefined, sortOrder: dto.sortOrder ?? undefined } });
    await this.audit.record({ action: 'JOB_CATEGORY_MANAGED', actorId: actor.userId, newValue: { jobCategoryId: id, action: 'UPDATE' } });
    return this.listCategories(true);
  }

  // ===========================================================================
  // Serialization
  // ===========================================================================
  /** Compact card for lists. */
  card(j: { id: string; title: string; slug: string; employmentType: string; workArrangement: string; district: string | null; city: string | null; salaryMinMinor: bigint | null; salaryMaxMinor: bigint | null; salaryPeriod: string | null; salaryVisibility: string; applicationDeadline: Date | null; publishedAt: Date | null; createdAt: Date }) {
    const showSalary = j.salaryVisibility !== 'HIDDEN' && (j.salaryMinMinor != null || j.salaryMaxMinor != null);
    return {
      id: j.id,
      title: j.title,
      slug: j.slug,
      employmentType: j.employmentType,
      workArrangement: j.workArrangement,
      district: j.district,
      city: j.city,
      salary: showSalary ? { minMinor: n(j.salaryMinMinor), maxMinor: n(j.salaryMaxMinor), period: j.salaryPeriod, visibility: j.salaryVisibility } : null,
      applicationDeadline: j.applicationDeadline,
      publishedAt: j.publishedAt,
      createdAt: j.createdAt,
    };
  }

  /** Full detail (employer/admin see everything; public view is in JobDiscoveryService). */
  async serializeFull(jobId: string, privileged: boolean) {
    const j = await this.prisma.jobListing.findUniqueOrThrow({
      where: { id: jobId },
      include: {
        employerProfile: { select: { companyName: true, slug: true } },
        jobCategory: { select: { name: true, slug: true } },
        skills: true,
        benefits: true,
        questions: { orderBy: { sortOrder: 'asc' } },
      },
    });
    return {
      ...this.card(j),
      status: j.status,
      moderationReason: privileged ? j.moderationReason : undefined,
      company: { name: j.employerProfile.companyName, slug: j.employerProfile.slug },
      category: j.jobCategory,
      remoteEligible: j.remoteEligible,
      description: j.description,
      responsibilities: j.responsibilities,
      requirements: j.requirements,
      preferredQualifications: j.preferredQualifications,
      experienceLevel: j.experienceLevel,
      educationLevel: j.educationLevel,
      openings: j.openings,
      startDate: j.startDate,
      applicationMethod: j.applicationMethod,
      externalUrl: j.externalUrl,
      applicationEmail: j.applicationEmail,
      skills: j.skills.map((s) => ({ name: s.name, required: s.required })),
      benefits: j.benefits.map((b) => b.name),
      questions: j.questions.map((q) => ({ id: q.id, prompt: q.prompt, type: q.type, required: q.required, options: q.options })),
    };
  }
}
