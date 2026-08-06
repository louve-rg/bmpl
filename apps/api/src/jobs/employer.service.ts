import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { isAllowedProductImageMime, slugify, slugWithSuffix, STORAGE_PREFIX } from '@bmpl/shared';
import type { UpsertEmployerProfileInput } from '@bmpl/validation';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { UploadIngestService } from '../storage/upload-ingest.service';
import { AuditService } from '../audit/audit.service';

export interface Actor {
  userId: string;
  status?: string;
}

/**
 * Employer / company profile (M24). Approval is via the EMPLOYER role-application
 * workflow (business-registration document, admin review) — this profile mirrors that
 * (approvalStatus). All employer endpoints are @Roles('EMPLOYER') so only an APPROVED
 * employer reaches them; publishing additionally requires approvalStatus === APPROVED
 * (admin can SUSPEND the company independently).
 */
@Injectable()
export class EmployerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ingest: UploadIngestService,
    private readonly audit: AuditService,
  ) {}

  /** Resolve the caller's employer profile id, or 404 (used by job/application scoping). */
  async requireProfile(userId: string) {
    const p = await this.prisma.employerProfile.findUnique({ where: { userId } });
    if (!p) throw new NotFoundException('Create your company profile first.');
    return p;
  }

  /** Assert the employer may publish/receive applicants (approved role + not suspended). */
  async requirePublishable(userId: string) {
    const p = await this.requireProfile(userId);
    if (p.approvalStatus === 'SUSPENDED') throw new ForbiddenException('Your employer account is suspended.');
    return p;
  }

  private async uniqueSlug(name: string) {
    const base = slugify(name) || 'company';
    let candidate = base;
    for (let i = 2; i < 200; i += 1) {
      const clash = await this.prisma.employerProfile.findUnique({ where: { slug: candidate } });
      if (!clash) return candidate;
      candidate = slugWithSuffix(base, i);
    }
    return slugWithSuffix(base, Date.now() % 100000);
  }

  async upsertProfile(actor: Actor, dto: UpsertEmployerProfileInput) {
    if (actor.status && actor.status !== 'ACTIVE') throw new ForbiddenException('Your account cannot manage a company profile.');
    const existing = await this.prisma.employerProfile.findUnique({ where: { userId: actor.userId } });
    const data = {
      companyName: dto.companyName,
      legalName: dto.legalName ?? undefined,
      description: dto.description ?? undefined,
      industry: dto.industry ?? undefined,
      companySize: dto.companySize ?? undefined,
      contactEmail: dto.contactEmail,
      contactPhone: dto.contactPhone ?? undefined,
      website: dto.website ?? undefined,
      district: dto.district ?? undefined,
      addressLine1: dto.addressLine1 ?? undefined,
      addressLine2: dto.addressLine2 ?? undefined,
      city: dto.city ?? undefined,
    };
    const profile = existing
      ? await this.prisma.employerProfile.update({ where: { userId: actor.userId }, data })
      : await this.prisma.employerProfile.create({
          data: { userId: actor.userId, slug: await this.uniqueSlug(dto.companyName), approvalStatus: 'APPROVED', ...data },
        });
    await this.audit.record({ action: 'EMPLOYER_PROFILE_UPSERTED', actorId: actor.userId, newValue: { employerProfileId: profile.id } });
    return this.getOwn(actor.userId);
  }

  async getOwn(userId: string) {
    const p = await this.prisma.employerProfile.findUnique({ where: { userId } });
    if (!p) return null;
    return { ...p, logoUrl: await this.urlOrNull(p.logoKey), bannerUrl: await this.urlOrNull(p.bannerKey) };
  }

  /** Server-side employer logo/banner upload (browser → API → public storage). */
  async uploadImage(userId: string, kind: 'logo' | 'banner', buffer: Buffer | undefined, fileName?: string) {
    const p = await this.requireProfile(userId);
    const prefix = kind === 'logo' ? STORAGE_PREFIX.employerLogo(p.id) : STORAGE_PREFIX.employerBanner(p.id);
    return this.ingest.image(buffer, prefix, 'public', { fileName, fallbackName: kind });
  }

  /** @deprecated Prefer {@link uploadImage} — the browser PUT is cross-origin and fails as "Load failed". */
  async presignImage(userId: string, kind: 'logo' | 'banner', fileName: string, contentType: string) {
    const p = await this.requireProfile(userId);
    if (!isAllowedProductImageMime(contentType)) throw new BadRequestException('Use a JPEG, PNG, or WebP image.');
    const prefix = kind === 'logo' ? STORAGE_PREFIX.employerLogo(p.id) : STORAGE_PREFIX.employerBanner(p.id);
    const key = this.storage.buildKey(prefix, fileName);
    return this.storage.presignUpload(key, contentType, 'public');
  }

  async confirmImage(userId: string, kind: 'logo' | 'banner', storageKey: string) {
    const p = await this.requireProfile(userId);
    const prefix = kind === 'logo' ? STORAGE_PREFIX.employerLogo(p.id) : STORAGE_PREFIX.employerBanner(p.id);
    this.storage.assertKeyInNamespace(storageKey, prefix);
    const meta = await this.storage.headObject(storageKey, 'public');
    if (!meta) throw new BadRequestException('The uploaded image could not be found.');
    await this.prisma.employerProfile.update({ where: { id: p.id }, data: kind === 'logo' ? { logoKey: storageKey } : { bannerKey: storageKey } });
    return this.getOwn(userId);
  }

  /** Public company summary for a job/company page (no private docs/contact leakage). */
  async publicCompany(slug: string) {
    const p = await this.prisma.employerProfile.findFirst({ where: { slug, approvalStatus: 'APPROVED' } });
    if (!p) throw new NotFoundException('Company not found.');
    const openJobs = await this.prisma.jobListing.count({ where: { employerProfileId: p.id, status: 'PUBLISHED' } });
    return {
      companyName: p.companyName,
      slug: p.slug,
      description: p.description,
      industry: p.industry,
      companySize: p.companySize,
      website: p.website,
      district: p.district,
      city: p.city,
      logoUrl: await this.urlOrNull(p.logoKey),
      bannerUrl: await this.urlOrNull(p.bannerKey),
      openJobs,
    };
  }

  private async urlOrNull(key: string | null) {
    if (!key) return null;
    try {
      return (await this.storage.presignDownload(key, 'public')).url;
    } catch {
      return null;
    }
  }
}
