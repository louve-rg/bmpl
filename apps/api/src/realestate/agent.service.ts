import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { isAllowedProductImageMime, slugify, slugWithSuffix, STORAGE_PREFIX } from '@bmpl/shared';
import type { UpsertAgentProfileInput } from '@bmpl/validation';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { UploadIngestService } from '../storage/upload-ingest.service';
import { AuditService } from '../audit/audit.service';

export interface Actor {
  userId: string;
  status?: string;
}

/**
 * Real-estate agent profile (M25). Approval is via the REAL_ESTATE_AGENT role-
 * application workflow — this profile mirrors that (approvalStatus). Agent photo lives
 * in the PUBLIC bucket. The role is NEVER auto-granted here (agents require approval);
 * @Roles('REAL_ESTATE_AGENT') gates the surface, publishing requires not-suspended.
 */
@Injectable()
export class AgentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ingest: UploadIngestService,
    private readonly audit: AuditService,
  ) {}

  private async uniqueSlug(name: string) {
    const base = slugify(name) || 'agent';
    let candidate = base;
    for (let i = 2; i < 200; i += 1) {
      const clash = await this.prisma.realEstateAgentProfile.findUnique({ where: { slug: candidate } });
      if (!clash) return candidate;
      candidate = slugWithSuffix(base, i);
    }
    return slugWithSuffix(base, Date.now() % 100000);
  }

  /** Resolve the caller's agent profile id, or 404. */
  async requireAgentProfile(userId: string) {
    const p = await this.prisma.realEstateAgentProfile.findUnique({ where: { userId } });
    if (!p) throw new NotFoundException('Create your agent profile first.');
    return p;
  }

  /** Assert the agent may publish/manage listings (approved role + not suspended + active). */
  async requirePublishableAgent(userId: string) {
    const p = await this.requireAgentProfile(userId);
    if (p.approvalStatus === 'SUSPENDED') throw new ForbiddenException('Your agent account is suspended.');
    if (!p.isActive) throw new ForbiddenException('Your agent account is inactive.');
    return p;
  }

  async upsertProfile(actor: Actor, dto: UpsertAgentProfileInput) {
    if (actor.status && actor.status !== 'ACTIVE') throw new ForbiddenException('Your account cannot manage an agent profile.');
    const existing = await this.prisma.realEstateAgentProfile.findUnique({ where: { userId: actor.userId } });
    const data = {
      displayName: dto.displayName,
      legalName: dto.legalName ?? undefined,
      bio: dto.bio ?? undefined,
      phone: dto.phone ?? undefined,
      email: dto.email ?? undefined,
      website: dto.website ?? undefined,
      serviceDistricts: dto.serviceDistricts ?? undefined,
      specialties: dto.specialties ?? undefined,
      yearsExperience: dto.yearsExperience ?? undefined,
    };
    const profile = existing
      ? await this.prisma.realEstateAgentProfile.update({ where: { userId: actor.userId }, data })
      : await this.prisma.realEstateAgentProfile.create({
          data: { userId: actor.userId, slug: await this.uniqueSlug(dto.displayName), approvalStatus: 'APPROVED', ...data },
        });
    await this.audit.record({ action: 'REAL_ESTATE_AGENT_PROFILE_UPSERTED', actorId: actor.userId, newValue: { agentProfileId: profile.id } });
    return this.getOwn(actor.userId);
  }

  async getOwn(userId: string) {
    const p = await this.prisma.realEstateAgentProfile.findUnique({ where: { userId }, include: { agency: { select: { name: true, slug: true } } } });
    if (!p) return null;
    return { ...p, photoUrl: await this.urlOrNull(p.photoKey) };
  }

  /** Server-side agent-photo upload (browser → API → public storage). */
  async uploadPhoto(userId: string, buffer: Buffer | undefined, fileName?: string) {
    await this.requireAgentProfile(userId);
    return this.ingest.image(buffer, STORAGE_PREFIX.agentPhoto(userId), 'public', {
      fileName,
      fallbackName: 'photo',
    });
  }

  /** @deprecated Prefer {@link uploadPhoto} — the browser PUT is cross-origin and fails as "Load failed". */
  async presignPhoto(userId: string, fileName: string, contentType: string) {
    await this.requireAgentProfile(userId);
    if (!isAllowedProductImageMime(contentType)) throw new BadRequestException('Use a JPEG, PNG, or WebP image.');
    const key = this.storage.buildKey(STORAGE_PREFIX.agentPhoto(userId), fileName);
    return this.storage.presignUpload(key, contentType, 'public');
  }

  async confirmPhoto(userId: string, storageKey: string) {
    const p = await this.requireAgentProfile(userId);
    this.storage.assertKeyInNamespace(storageKey, STORAGE_PREFIX.agentPhoto(userId));
    const meta = await this.storage.headObject(storageKey, 'public');
    if (!meta) throw new BadRequestException('The uploaded image could not be found.');
    await this.prisma.realEstateAgentProfile.update({ where: { id: p.id }, data: { photoKey: storageKey } });
    return this.getOwn(userId);
  }

  /** Public agent page (no private metadata). */
  async publicAgent(slug: string) {
    const p = await this.prisma.realEstateAgentProfile.findFirst({ where: { slug, approvalStatus: 'APPROVED' }, include: { agency: { select: { name: true, slug: true } } } });
    if (!p) throw new NotFoundException('Agent not found.');
    const activeListings = await this.prisma.propertyListing.count({ where: { agentProfileId: p.id, status: { in: ['PUBLISHED', 'UNDER_OFFER'] } } });
    return {
      displayName: p.displayName,
      slug: p.slug,
      bio: p.bio,
      phone: p.phone,
      email: p.email,
      website: p.website,
      serviceDistricts: p.serviceDistricts,
      specialties: p.specialties,
      yearsExperience: p.yearsExperience,
      ratingAverage: p.ratingAverage,
      ratingCount: p.ratingCount,
      agency: p.agency,
      photoUrl: await this.urlOrNull(p.photoKey),
      activeListings,
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
