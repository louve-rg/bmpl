import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { canTransitionApplication, isActiveApplicationStatus, type JobApplicationStatus } from '@bmpl/shared';
import type { ApplicationNoteInput, ApplicationStatusInput, InterviewInput, InterviewUpdateInput, SubmitApplicationInput } from '@bmpl/validation';
import { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MessagingService } from '../messaging/messaging.service';
import { EmployerService } from './employer.service';

export interface Actor {
  userId: string;
  status?: string;
}

/**
 * Job applications (M24). Verified, context-scoped, privacy-preserving: the applicant
 * owns their applications; the employer only ever sees applications to THEIR OWN jobs.
 * Required questions are enforced + snapshotted; the pipeline follows a validated
 * transition map with append-only events, audit, notifications, and a system message
 * on the employer↔applicant thread. Employer notes are never exposed to the applicant.
 */
@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly messaging: MessagingService,
    private readonly employers: EmployerService,
  ) {}

  // ===========================================================================
  // Applicant: submit / list / withdraw
  // ===========================================================================
  async submit(actor: Actor, dto: SubmitApplicationInput) {
    if (actor.status && actor.status !== 'ACTIVE') throw new ForbiddenException('Your account cannot apply.');
    const job = await this.prisma.jobListing.findUnique({
      where: { id: dto.jobId },
      include: { employerProfile: { select: { userId: true, companyName: true, approvalStatus: true } }, questions: true },
    });
    if (!job || job.status !== 'PUBLISHED' || job.employerProfile.approvalStatus !== 'APPROVED') throw new NotFoundException('Job not found.');
    if (job.applicationMethod !== 'INTERNAL') throw new BadRequestException('This job is not accepting on-platform applications.');
    if (job.applicationDeadline && job.applicationDeadline < new Date()) throw new BadRequestException('The application deadline has passed.');

    // Duplicate policy: one ACTIVE application per (job, applicant); a WITHDRAWN one may re-apply.
    const existing = await this.prisma.jobApplication.findFirst({ where: { jobId: dto.jobId, applicantId: actor.userId, status: { not: 'WITHDRAWN' } } });
    if (existing) throw new BadRequestException('You already have an active application for this job.');

    // Résumé ownership (if provided).
    if (dto.resumeId) {
      const resume = await this.prisma.jobSeekerResume.findFirst({ where: { id: dto.resumeId, profile: { userId: actor.userId } } });
      if (!resume) throw new BadRequestException('That résumé does not belong to you.');
    }

    // Required-question enforcement + answer snapshots.
    const byId = new Map(job.questions.map((q) => [q.id, q]));
    const provided = new Map((dto.answers ?? []).map((a) => [a.questionId, a]));
    const answerRows: Prisma.JobApplicationAnswerCreateManyApplicationInput[] = [];
    for (const q of job.questions) {
      const a = provided.get(q.id);
      const hasText = !!a?.text && a.text.trim() !== '';
      const hasChoices = !!a?.choices && a.choices.length > 0;
      if (q.required && !hasText && !hasChoices) throw new BadRequestException(`Please answer: "${q.prompt}"`);
      if (a && (hasText || hasChoices)) {
        answerRows.push({ questionId: q.id, promptSnapshot: q.prompt, typeSnapshot: q.type, answerText: a.text ?? null, answerChoices: a.choices ?? [] });
      }
    }

    const application = await this.prisma.jobApplication.create({
      data: {
        jobId: dto.jobId,
        applicantId: actor.userId,
        resumeId: dto.resumeId ?? null,
        coverLetter: dto.coverLetter ?? null,
        source: dto.source ?? null,
        status: 'SUBMITTED',
        jobTitleSnapshot: job.title,
        companySnapshot: job.employerProfile.companyName,
        answers: answerRows.length ? { createMany: { data: answerRows } } : undefined,
        events: { create: { fromStatus: null, toStatus: 'SUBMITTED', actorId: actor.userId } },
      },
    });
    await this.audit.record({ action: 'JOB_APPLICATION_SUBMITTED', actorId: actor.userId, newValue: { applicationId: application.id, jobId: dto.jobId } });
    await this.notifications.createInApp({ userId: job.employerProfile.userId, type: 'MARKETPLACE', category: 'JOB', event: 'PRODUCT_MODERATED', title: 'New application', body: `New application for "${job.title}".`, data: { applicationId: application.id, jobId: dto.jobId } });
    await this.notifications.createInApp({ userId: actor.userId, type: 'MARKETPLACE', category: 'JOB', event: 'PRODUCT_MODERATED', title: 'Application submitted', body: `Your application for "${job.title}" was submitted.`, data: { applicationId: application.id } });
    await this.messaging.postJobApplicationSystem(application.id, actor.userId, job.employerProfile.userId, `Application submitted for "${job.title}".`);
    return this.getMine(actor.userId, application.id);
  }

  async listMine(userId: string) {
    const rows = await this.prisma.jobApplication.findMany({
      where: { applicantId: userId },
      orderBy: { submittedAt: 'desc' },
      take: 200,
      include: { job: { select: { slug: true, status: true } } },
    });
    return rows.map((a) => ({ id: a.id, jobId: a.jobId, jobSlug: a.job.slug, jobTitle: a.jobTitleSnapshot, company: a.companySnapshot, status: a.status, submittedAt: a.submittedAt, withdrawnAt: a.withdrawnAt }));
  }

  async getMine(userId: string, applicationId: string) {
    const a = await this.prisma.jobApplication.findFirst({
      where: { id: applicationId, applicantId: userId },
      include: { answers: true, events: { orderBy: { createdAt: 'asc' } }, interviews: { orderBy: { scheduledAt: 'asc' } }, resume: { select: { id: true, label: true } }, job: { select: { slug: true, status: true } } },
    });
    if (!a) throw new NotFoundException('Application not found.');
    return this.serialize(a, false);
  }

  async withdraw(actor: Actor, applicationId: string) {
    const a = await this.prisma.jobApplication.findFirst({ where: { id: applicationId, applicantId: actor.userId }, include: { job: { include: { employerProfile: { select: { userId: true } } } } } });
    if (!a) throw new NotFoundException('Application not found.');
    if (!isActiveApplicationStatus(a.status)) throw new BadRequestException('This application can no longer be withdrawn.');
    await this.transition(a.id, a.status, 'WITHDRAWN', actor.userId, null, { withdrawnAt: new Date() });
    await this.audit.record({ action: 'JOB_APPLICATION_WITHDRAWN', actorId: actor.userId, newValue: { applicationId } });
    await this.notifications.createInApp({ userId: a.job.employerProfile.userId, type: 'MARKETPLACE', category: 'JOB', event: 'PRODUCT_MODERATED', title: 'Applicant withdrew', body: `An applicant withdrew from "${a.jobTitleSnapshot}".`, data: { applicationId } });
    await this.messaging.postJobApplicationSystem(a.id, actor.userId, a.job.employerProfile.userId, 'The applicant withdrew their application.');
    return this.getMine(actor.userId, applicationId);
  }

  async openConversation(actor: Actor, applicationId: string) {
    // Authorization is enforced inside MessagingService.openJobApplication.
    return this.messaging.openJobApplication({ userId: actor.userId, status: actor.status }, applicationId);
  }

  // ===========================================================================
  // Employer: list / detail / pipeline / notes / interviews
  // ===========================================================================
  private async ownedApplication(employerUserId: string, applicationId: string) {
    const employer = await this.employers.requireProfile(employerUserId);
    const a = await this.prisma.jobApplication.findFirst({
      where: { id: applicationId, job: { employerProfileId: employer.id } },
      include: { job: { select: { title: true } } },
    });
    if (!a) throw new NotFoundException('Application not found.');
    return a;
  }

  async employerList(employerUserId: string, filter: { jobId?: string; status?: string }) {
    const employer = await this.employers.requireProfile(employerUserId);
    const rows = await this.prisma.jobApplication.findMany({
      where: { job: { employerProfileId: employer.id }, ...(filter.jobId ? { jobId: filter.jobId } : {}), ...(filter.status ? { status: filter.status as never } : {}) },
      orderBy: { submittedAt: 'desc' },
      take: 300,
      include: { applicant: { select: { firstName: true, lastName: true } }, job: { select: { title: true } } },
    });
    return rows.map((a) => ({ id: a.id, jobId: a.jobId, jobTitle: a.job.title, applicantName: `${a.applicant.firstName} ${a.applicant.lastName}`.trim(), status: a.status, submittedAt: a.submittedAt }));
  }

  async employerGet(employerUserId: string, applicationId: string) {
    await this.ownedApplication(employerUserId, applicationId);
    const a = await this.prisma.jobApplication.findUniqueOrThrow({
      where: { id: applicationId },
      include: { answers: true, events: { orderBy: { createdAt: 'asc' } }, interviews: { orderBy: { scheduledAt: 'asc' } }, resume: { select: { id: true, label: true } }, applicant: { select: { firstName: true, lastName: true, email: true } }, job: { select: { slug: true, status: true } } },
    });
    return this.serialize(a, true);
  }

  /** Signed résumé URL for the employer — only for an application to their own job. */
  async employerResumeUrl(employerUserId: string, applicationId: string) {
    const a = await this.ownedApplication(employerUserId, applicationId);
    if (!a.resumeId) throw new NotFoundException('No résumé attached.');
    const resume = await this.prisma.jobSeekerResume.findUniqueOrThrow({ where: { id: a.resumeId } });
    return { url: (await this.storage.presignDownload(resume.storageKey, 'private')).url };
  }

  async setStatus(actor: Actor, applicationId: string, dto: ApplicationStatusInput) {
    const a = await this.ownedApplication(actor.userId, applicationId);
    const to = dto.status as JobApplicationStatus;
    if (to === 'WITHDRAWN') throw new BadRequestException('Only the applicant can withdraw.');
    if (!canTransitionApplication(a.status, to)) throw new BadRequestException(`Cannot move an application from ${a.status} to ${to}.`);
    await this.transition(a.id, a.status, to, actor.userId, dto.note ?? null);
    await this.audit.record({ action: 'JOB_APPLICATION_STATUS_CHANGED', actorId: actor.userId, newValue: { applicationId, from: a.status, to } });
    await this.notifyApplicant(a.id, to, a.job.title);
    return this.employerGet(actor.userId, applicationId);
  }

  async addNote(actor: Actor, applicationId: string, dto: ApplicationNoteInput) {
    const a = await this.ownedApplication(actor.userId, applicationId);
    const notes = a.employerNotes ? `${a.employerNotes}\n\n${dto.note}` : dto.note;
    await this.prisma.jobApplication.update({ where: { id: a.id }, data: { employerNotes: notes } });
    return this.employerGet(actor.userId, applicationId);
  }

  async scheduleInterview(actor: Actor, applicationId: string, dto: InterviewInput) {
    const a = await this.ownedApplication(actor.userId, applicationId);
    if (a.status === 'WITHDRAWN' || a.status === 'REJECTED' || a.status === 'HIRED') throw new BadRequestException('This application is closed.');
    await this.prisma.jobInterview.create({ data: { applicationId: a.id, scheduledAt: dto.scheduledAt, timezone: dto.timezone ?? 'America/Belize', mode: dto.mode, location: dto.location ?? null, notes: dto.notes ?? null, createdById: actor.userId } });
    // Advance the pipeline to INTERVIEW_SCHEDULED when reachable.
    if (canTransitionApplication(a.status, 'INTERVIEW_SCHEDULED')) {
      await this.transition(a.id, a.status, 'INTERVIEW_SCHEDULED', actor.userId, 'Interview scheduled');
    } else if (canTransitionApplication(a.status, 'INTERVIEW_REQUESTED') && a.status === 'SHORTLISTED') {
      await this.transition(a.id, a.status, 'INTERVIEW_REQUESTED', actor.userId, 'Interview requested');
      await this.transition(a.id, 'INTERVIEW_REQUESTED', 'INTERVIEW_SCHEDULED', actor.userId, 'Interview scheduled');
    }
    await this.audit.record({ action: 'JOB_INTERVIEW_SCHEDULED', actorId: actor.userId, newValue: { applicationId } });
    await this.notifications.createInApp({ userId: a.applicantId, type: 'MARKETPLACE', category: 'JOB', event: 'PRODUCT_MODERATED', title: 'Interview scheduled', body: `An interview was scheduled for "${a.job.title}".`, data: { applicationId } });
    await this.messaging.postJobApplicationSystem(a.id, a.applicantId, actor.userId, `Interview scheduled for ${dto.scheduledAt.toISOString()} (${dto.mode}).`);
    return this.employerGet(actor.userId, applicationId);
  }

  async updateInterview(actor: Actor, interviewId: string, dto: InterviewUpdateInput) {
    const iv = await this.prisma.jobInterview.findUnique({ where: { id: interviewId }, include: { application: { include: { job: { select: { employerProfileId: true, title: true } } } } } });
    if (!iv) throw new NotFoundException('Interview not found.');
    const employer = await this.employers.requireProfile(actor.userId);
    if (iv.application.job.employerProfileId !== employer.id) throw new NotFoundException('Interview not found.');
    await this.prisma.jobInterview.update({
      where: { id: interviewId },
      data: {
        scheduledAt: dto.scheduledAt ?? undefined, timezone: dto.timezone ?? undefined, mode: dto.mode ?? undefined,
        location: dto.location === undefined ? undefined : dto.location, notes: dto.notes === undefined ? undefined : dto.notes,
        status: dto.status ?? (dto.scheduledAt ? 'RESCHEDULED' : undefined),
      },
    });
    await this.audit.record({ action: 'JOB_INTERVIEW_UPDATED', actorId: actor.userId, newValue: { interviewId, status: dto.status ?? null } });
    await this.notifications.createInApp({ userId: iv.application.applicantId, type: 'MARKETPLACE', category: 'JOB', event: 'PRODUCT_MODERATED', title: 'Interview updated', body: `Your interview for "${iv.application.job.title}" was updated.`, data: { applicationId: iv.applicationId } });
    return this.employerGet(actor.userId, iv.applicationId);
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================
  private async transition(applicationId: string, from: JobApplicationStatus, to: JobApplicationStatus, actorId: string, note: string | null, extra: Prisma.JobApplicationUpdateInput = {}) {
    await this.prisma.$transaction(async (tx) => {
      await tx.jobApplication.update({ where: { id: applicationId }, data: { status: to, ...extra } });
      await tx.jobApplicationEvent.create({ data: { applicationId, fromStatus: from, toStatus: to, actorId, note } });
    });
  }

  private async notifyApplicant(applicationId: string, to: JobApplicationStatus, jobTitle: string) {
    const a = await this.prisma.jobApplication.findUniqueOrThrow({ where: { id: applicationId }, select: { applicantId: true, job: { select: { employerProfile: { select: { userId: true } } } } } });
    const messages: Partial<Record<JobApplicationStatus, string>> = {
      SHORTLISTED: `You were shortlisted for "${jobTitle}".`,
      INTERVIEW_REQUESTED: `An interview was requested for "${jobTitle}".`,
      INTERVIEW_SCHEDULED: `An interview was scheduled for "${jobTitle}".`,
      OFFER_EXTENDED: `You received an offer for "${jobTitle}"!`,
      HIRED: `Congratulations — you were hired for "${jobTitle}"!`,
      REJECTED: `Your application for "${jobTitle}" was not selected.`,
      UNDER_REVIEW: `Your application for "${jobTitle}" is under review.`,
    };
    const body = messages[to] ?? `Your application for "${jobTitle}" was updated.`;
    await this.notifications.createInApp({ userId: a.applicantId, type: 'MARKETPLACE', category: 'JOB', event: 'PRODUCT_MODERATED', title: 'Application update', body, data: { applicationId } });
    await this.messaging.postJobApplicationSystem(applicationId, a.applicantId, a.job.employerProfile.userId, body);
  }

  private serialize(
    a: Prisma.JobApplicationGetPayload<{ include: { answers: true; events: true; interviews: true; resume: { select: { id: true; label: true } }; job: { select: { slug: true; status: true } } } }> & { applicant?: { firstName: string; lastName: string; email: string } },
    privileged: boolean,
  ) {
    return {
      id: a.id,
      jobId: a.jobId,
      jobSlug: a.job.slug,
      jobTitle: a.jobTitleSnapshot,
      company: a.companySnapshot,
      status: a.status,
      coverLetter: a.coverLetter,
      submittedAt: a.submittedAt,
      withdrawnAt: a.withdrawnAt,
      resume: a.resume ?? null,
      // Employer notes are PRIVATE — only in the privileged (employer) view.
      employerNotes: privileged ? a.employerNotes : undefined,
      applicant: privileged && a.applicant ? { name: `${a.applicant.firstName} ${a.applicant.lastName}`.trim(), email: a.applicant.email } : undefined,
      answers: a.answers.map((ans) => ({ prompt: ans.promptSnapshot, type: ans.typeSnapshot, text: ans.answerText, choices: ans.answerChoices })),
      timeline: a.events.map((e) => ({ from: e.fromStatus, to: e.toStatus, note: e.note, at: e.createdAt })),
      interviews: a.interviews.map((iv) => ({ id: iv.id, scheduledAt: iv.scheduledAt, timezone: iv.timezone, mode: iv.mode, location: iv.location, notes: iv.notes, status: iv.status })),
    };
  }
}
