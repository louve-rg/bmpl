import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { isAllowedProductImageMime, slugify, slugWithSuffix, STORAGE_PREFIX } from '@bmpl/shared';
import type { UpsertAgencyProfileInput } from '@bmpl/validation';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { UploadIngestService } from '../storage/upload-ingest.service';
import { AuditService } from '../audit/audit.service';

export interface Actor {
  userId: string;
  status?: string;
}

/**
 * Real-estate agency profile (M25). One manager agent per agency (managerUserId).
 * Logo/banner live in the PUBLIC bucket. Approval mirrors the manager's approved
 * REAL_ESTATE_AGENT role; @Roles gates the surface.
 */
@Injectable()
export class AgencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ingest: UploadIngestService,
    private readonly audit: AuditService,
  ) {}

  private async uniqueSlug(name: string) {
    const base = slugify(name) || 'agency';
    let candidate = base;
    for (let i = 2; i < 200; i += 1) {
      const clash = await this.prisma.agencyProfile.findUnique({ where: { slug: candidate } });
      if (!clash) return candidate;
      candidate = slugWithSuffix(base, i);
    }
    return slugWithSuffix(base, Date.now() % 100000);
  }

  async requireAgency(managerUserId: string) {
    const a = await this.prisma.agencyProfile.findUnique({ where: { managerUserId } });
    if (!a) throw new NotFoundException('Create your agency profile first.');
    return a;
  }

  async upsertProfile(actor: Actor, dto: UpsertAgencyProfileInput) {
    if (actor.status && actor.status !== 'ACTIVE') throw new ForbiddenException('Your account cannot manage an agency profile.');
    const existing = await this.prisma.agencyProfile.findUnique({ where: { managerUserId: actor.userId } });
    const data = {
      name: dto.name,
      legalName: dto.legalName ?? undefined,
      description: dto.description ?? undefined,
      contactEmail: dto.contactEmail,
      contactPhone: dto.contactPhone ?? undefined,
      website: dto.website ?? undefined,
      district: dto.district ?? undefined,
      addressLine1: dto.addressLine1 ?? undefined,
      city: dto.city ?? undefined,
    };
    const agency = existing
      ? await this.prisma.agencyProfile.update({ where: { managerUserId: actor.userId }, data })
      : await this.prisma.agencyProfile.create({
          data: { managerUserId: actor.userId, slug: await this.uniqueSlug(dto.name), approvalStatus: 'APPROVED', ...data },
        });
    await this.audit.record({ action: 'AGENCY_PROFILE_UPSERTED', actorId: actor.userId, newValue: { agencyId: agency.id } });
    return this.getOwn(actor.userId);
  }

  async getOwn(managerUserId: string) {
    const a = await this.prisma.agencyProfile.findUnique({ where: { managerUserId } });
    if (!a) return null;
    return { ...a, logoUrl: await this.urlOrNull(a.logoKey), bannerUrl: await this.urlOrNull(a.bannerKey) };
  }

  /** Server-side agency logo/banner upload (browser → API → public storage). */
  async uploadImage(managerUserId: string, kind: 'logo' | 'banner', buffer: Buffer | undefined, fileName?: string) {
    const a = await this.requireAgency(managerUserId);
    const prefix = kind === 'banner' ? STORAGE_PREFIX.agencyBanner(a.id) : STORAGE_PREFIX.agencyLogo(a.id);
    return this.ingest.image(buffer, prefix, 'public', { fileName, fallbackName: kind });
  }

  /** @deprecated Prefer {@link uploadImage} — the browser PUT is cross-origin and fails as "Load failed". */
  async presignImage(managerUserId: string, kind: 'logo' | 'banner', fileName: string, contentType: string) {
    const a = await this.requireAgency(managerUserId);
    if (!isAllowedProductImageMime(contentType)) throw new BadRequestException('Use a JPEG, PNG, or WebP image.');
    const prefix = kind === 'banner' ? STORAGE_PREFIX.agencyBanner(a.id) : STORAGE_PREFIX.agencyLogo(a.id);
    const key = this.storage.buildKey(prefix, fileName);
    return this.storage.presignUpload(key, contentType, 'public');
  }

  async confirmImage(managerUserId: string, kind: 'logo' | 'banner', storageKey: string) {
    const a = await this.requireAgency(managerUserId);
    const prefix = kind === 'banner' ? STORAGE_PREFIX.agencyBanner(a.id) : STORAGE_PREFIX.agencyLogo(a.id);
    this.storage.assertKeyInNamespace(storageKey, prefix);
    const meta = await this.storage.headObject(storageKey, 'public');
    if (!meta) throw new BadRequestException('The uploaded image could not be found.');
    await this.prisma.agencyProfile.update({ where: { id: a.id }, data: kind === 'banner' ? { bannerKey: storageKey } : { logoKey: storageKey } });
    return this.getOwn(managerUserId);
  }

  /** Public agency page (no private metadata). */
  async publicAgency(slug: string) {
    const a = await this.prisma.agencyProfile.findFirst({ where: { slug, approvalStatus: 'APPROVED' } });
    if (!a) throw new NotFoundException('Agency not found.');
    const [activeListings, agents] = await Promise.all([
      this.prisma.propertyListing.count({ where: { agencyId: a.id, status: { in: ['PUBLISHED', 'UNDER_OFFER'] } } }),
      this.prisma.realEstateAgentProfile.findMany({ where: { agencyId: a.id, approvalStatus: 'APPROVED', isActive: true }, select: { displayName: true, slug: true, photoKey: true } }),
    ]);
    return {
      name: a.name,
      slug: a.slug,
      description: a.description,
      website: a.website,
      district: a.district,
      city: a.city,
      contactEmail: a.contactEmail,
      contactPhone: a.contactPhone,
      logoUrl: await this.urlOrNull(a.logoKey),
      bannerUrl: await this.urlOrNull(a.bannerKey),
      activeListings,
      agents: await Promise.all(agents.map(async (ag) => ({ displayName: ag.displayName, slug: ag.slug, photoUrl: await this.urlOrNull(ag.photoKey) }))),
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
