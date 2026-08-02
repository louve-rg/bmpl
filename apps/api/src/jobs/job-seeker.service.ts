import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { isAllowedResumeMime, MAX_RESUME_BYTES, MAX_RESUMES_PER_SEEKER, STORAGE_PREFIX } from '@bmpl/shared';
import type {
  JobSeekerCertificationInput,
  JobSeekerEducationInput,
  JobSeekerExperienceInput,
  JobSeekerLanguageInput,
  JobSeekerSkillInput,
  ResumeConfirmInput,
  UpsertJobSeekerProfileInput,
} from '@bmpl/validation';
import { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';

export interface Actor {
  userId: string;
  status?: string;
}

/**
 * Job-seeker profile (M24). A normalized employment profile with child skills/
 * education/experience/certifications/languages and PRIVATE résumés. Own-account
 * only; visibility gates any future public exposure (default PRIVATE). Creating a
 * profile grants the auto-approved JOB_SEEKER role so the switcher/dashboard appear.
 */
@Injectable()
export class JobSeekerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  private async ensureJobSeekerRole(userId: string) {
    // JOB_SEEKER requires no approval (auto-granted) — a direct grant matches policy.
    await this.prisma.userRole.upsert({
      where: { userId_roleCode: { userId, roleCode: 'JOB_SEEKER' } },
      create: { userId, roleCode: 'JOB_SEEKER', status: 'APPROVED', approvedAt: new Date() },
      update: {},
    });
  }

  async upsertProfile(actor: Actor, dto: UpsertJobSeekerProfileInput) {
    if (actor.status && actor.status !== 'ACTIVE') throw new ForbiddenException('Your account cannot manage a job-seeker profile.');
    const data = {
      preferredName: dto.preferredName,
      legalName: dto.legalName ?? undefined,
      headline: dto.headline ?? undefined,
      summary: dto.summary ?? undefined,
      district: dto.district ?? undefined,
      contactEmail: dto.contactEmail ?? undefined,
      contactPhone: dto.contactPhone ?? undefined,
      employmentStatus: dto.employmentStatus ?? undefined,
      preferredTypes: dto.preferredTypes ?? undefined,
      preferredDistricts: dto.preferredDistricts ?? undefined,
      remotePreference: dto.remotePreference ?? undefined,
      availabilityDate: dto.availabilityDate ?? undefined,
      salaryExpectMinor: dto.salaryExpectMinor == null ? undefined : BigInt(dto.salaryExpectMinor),
      salaryPeriod: dto.salaryPeriod ?? undefined,
      salaryExpectPublic: dto.salaryExpectPublic ?? undefined,
      visibility: dto.visibility ?? undefined,
    };
    const profile = await this.prisma.jobSeekerProfile.upsert({
      where: { userId: actor.userId },
      create: { userId: actor.userId, ...data, preferredName: dto.preferredName },
      update: data,
    });
    await this.ensureJobSeekerRole(actor.userId);
    await this.audit.record({ action: 'JOB_SEEKER_PROFILE_UPSERTED', actorId: actor.userId, newValue: { profileId: profile.id } });
    return this.getOwn(actor.userId);
  }

  private async requireProfile(userId: string) {
    const p = await this.prisma.jobSeekerProfile.findUnique({ where: { userId } });
    if (!p) throw new NotFoundException('Create your job-seeker profile first.');
    return p;
  }

  async getOwn(userId: string) {
    const p = await this.prisma.jobSeekerProfile.findUnique({
      where: { userId },
      include: {
        skills: { orderBy: { name: 'asc' } },
        education: { orderBy: { startYear: 'desc' } },
        experience: { orderBy: { startDate: 'desc' } },
        certifications: { orderBy: { issuedYear: 'desc' } },
        languages: { orderBy: { name: 'asc' } },
        resumes: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!p) return null;
    return { ...p, salaryExpectMinor: p.salaryExpectMinor == null ? null : Number(p.salaryExpectMinor), resumes: await this.serializeResumes(p.resumes, userId) };
  }

  // ---- child collections ----
  async addSkill(userId: string, dto: JobSeekerSkillInput) {
    const p = await this.requireProfile(userId);
    try {
      await this.prisma.jobSeekerSkill.create({ data: { profileId: p.id, name: dto.name } });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
    return this.getOwn(userId);
  }
  async removeChild(userId: string, kind: 'skill' | 'education' | 'experience' | 'certification' | 'language', id: string) {
    const p = await this.requireProfile(userId);
    const models = {
      skill: this.prisma.jobSeekerSkill,
      education: this.prisma.jobSeekerEducation,
      experience: this.prisma.jobSeekerExperience,
      certification: this.prisma.jobSeekerCertification,
      language: this.prisma.jobSeekerLanguage,
    } as const;
    await (models[kind] as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { id, profileId: p.id } });
    return this.getOwn(userId);
  }
  async addEducation(userId: string, dto: JobSeekerEducationInput) {
    const p = await this.requireProfile(userId);
    await this.prisma.jobSeekerEducation.create({ data: { profileId: p.id, institution: dto.institution, level: dto.level ?? null, fieldOfStudy: dto.fieldOfStudy ?? null, startYear: dto.startYear ?? null, endYear: dto.endYear ?? null, current: dto.current ?? false } });
    return this.getOwn(userId);
  }
  async addExperience(userId: string, dto: JobSeekerExperienceInput) {
    const p = await this.requireProfile(userId);
    await this.prisma.jobSeekerExperience.create({ data: { profileId: p.id, title: dto.title, company: dto.company, district: dto.district ?? null, startDate: dto.startDate ?? null, endDate: dto.endDate ?? null, current: dto.current ?? false, description: dto.description ?? null } });
    return this.getOwn(userId);
  }
  async addCertification(userId: string, dto: JobSeekerCertificationInput) {
    const p = await this.requireProfile(userId);
    await this.prisma.jobSeekerCertification.create({ data: { profileId: p.id, name: dto.name, issuer: dto.issuer ?? null, issuedYear: dto.issuedYear ?? null } });
    return this.getOwn(userId);
  }
  async addLanguage(userId: string, dto: JobSeekerLanguageInput) {
    const p = await this.requireProfile(userId);
    try {
      await this.prisma.jobSeekerLanguage.create({ data: { profileId: p.id, name: dto.name, proficiency: dto.proficiency ?? null } });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
    return this.getOwn(userId);
  }

  // ---- résumés (PRIVATE R2) ----
  async presignResume(userId: string, fileName: string, contentType: string) {
    await this.requireProfile(userId);
    if (!isAllowedResumeMime(contentType)) throw new BadRequestException('Upload a PDF or DOCX file.');
    const key = this.storage.buildKey(STORAGE_PREFIX.jobSeekerResume(userId), fileName);
    return this.storage.presignUpload(key, contentType, 'private');
  }

  async confirmResume(userId: string, dto: ResumeConfirmInput) {
    const p = await this.requireProfile(userId);
    const count = await this.prisma.jobSeekerResume.count({ where: { profileId: p.id } });
    if (count >= MAX_RESUMES_PER_SEEKER) throw new BadRequestException(`At most ${MAX_RESUMES_PER_SEEKER} résumés.`);
    this.storage.assertKeyInNamespace(dto.storageKey, STORAGE_PREFIX.jobSeekerResume(userId));
    const meta = await this.storage.headObject(dto.storageKey, 'private');
    if (!meta) throw new BadRequestException('The uploaded file could not be found in storage.');
    if (!isAllowedResumeMime(meta.contentType)) throw new BadRequestException('Upload a PDF or DOCX file.');
    if (meta.sizeBytes <= 0 || meta.sizeBytes > MAX_RESUME_BYTES) throw new BadRequestException('The file exceeds the maximum allowed size.');
    await this.prisma.jobSeekerResume.create({
      data: { profileId: p.id, label: dto.label, storageKey: dto.storageKey, mimeType: meta.contentType, fileSizeBytes: meta.sizeBytes, isPrimary: count === 0 },
    });
    return this.getOwn(userId);
  }

  async setPrimaryResume(userId: string, resumeId: string) {
    const p = await this.requireProfile(userId);
    const r = await this.prisma.jobSeekerResume.findFirst({ where: { id: resumeId, profileId: p.id } });
    if (!r) throw new NotFoundException('Résumé not found.');
    await this.prisma.$transaction([
      this.prisma.jobSeekerResume.updateMany({ where: { profileId: p.id }, data: { isPrimary: false } }),
      this.prisma.jobSeekerResume.update({ where: { id: resumeId }, data: { isPrimary: true } }),
    ]);
    return this.getOwn(userId);
  }

  async deleteResume(userId: string, resumeId: string) {
    const p = await this.requireProfile(userId);
    await this.prisma.jobSeekerResume.deleteMany({ where: { id: resumeId, profileId: p.id } });
    return this.getOwn(userId);
  }

  /** A signed download URL for the OWNER's own résumé. */
  async ownResumeUrl(userId: string, resumeId: string) {
    const p = await this.requireProfile(userId);
    const r = await this.prisma.jobSeekerResume.findFirst({ where: { id: resumeId, profileId: p.id } });
    if (!r) throw new NotFoundException('Résumé not found.');
    return { url: (await this.storage.presignDownload(r.storageKey, 'private')).url };
  }

  private async serializeResumes(resumes: Array<{ id: string; label: string; mimeType: string; fileSizeBytes: number; isPrimary: boolean; scanStatus: string; createdAt: Date }>, userId: string) {
    return resumes.map((r) => ({ id: r.id, label: r.label, mimeType: r.mimeType, fileSizeBytes: r.fileSizeBytes, isPrimary: r.isPrimary, scanStatus: r.scanStatus, createdAt: r.createdAt, downloadUrl: `/jobs/seeker/resumes/${r.id}/url` }));
  }
}
