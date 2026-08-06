import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  isAllowedDocumentMime,
  isAllowedProductImageMime,
  MAX_DOCUMENT_BYTES,
  MAX_PROPERTY_IMAGES,
  slugify,
  slugWithSuffix,
  STORAGE_PREFIX,
  type LocationVisibility,
} from '@bmpl/shared';
import type {
  AssignAgentInput,
  CreatePropertyInput,
  PropertyDocumentConfirmInput,
  PropertyImageConfirmInput,
  PropertyModerateInput,
  PropertyOwnerStatusInput,
  UpdatePropertyInput,
} from '@bmpl/validation';
import { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { UploadIngestService } from '../storage/upload-ingest.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PropertyOwnerService } from './property-owner.service';
import { AgentService } from './agent.service';

export interface Actor {
  userId: string;
  status?: string;
  permissions?: string[];
}

/** Statuses a lister may still edit. */
const EDITABLE: string[] = ['DRAFT', 'REJECTED', 'MORE_INFO_REQUIRED'];
/** Statuses eligible for (re)submission to moderation. */
const SUBMITTABLE: string[] = ['DRAFT', 'REJECTED', 'MORE_INFO_REQUIRED'];
const n = (v: bigint | null) => (v == null ? null : Number(v));
const round2 = (v: number | null | undefined) => (v == null ? null : Math.round(v * 100) / 100);

/**
 * Property listings (M25). Owner-authored, moderated before going public: the lister
 * can never bypass moderation (submit → admin approve → PUBLISHED). Every write is
 * ownership-scoped — an owner reaches only their own listings, an agent only ones with
 * an ACCEPTED assignment (or listing.agentProfileId) pointing to them; cross access is
 * a 404. Private documents and the exact address are NEVER exposed on public surfaces.
 */
@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ingest: UploadIngestService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly owners: PropertyOwnerService,
    private readonly agents: AgentService,
  ) {}

  // ===========================================================================
  // Keys
  // ===========================================================================
  private async uniqueSlug(title: string) {
    const base = slugify(title) || 'property';
    let candidate = base;
    for (let i = 2; i < 500; i += 1) {
      if (!(await this.prisma.propertyListing.findUnique({ where: { slug: candidate } }))) return candidate;
      candidate = slugWithSuffix(base, i);
    }
    return slugWithSuffix(base, Date.now() % 100000);
  }

  private async uniqueReference() {
    for (let i = 0; i < 500; i += 1) {
      const ref = `RE-${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
      if (!(await this.prisma.propertyListing.findUnique({ where: { reference: ref } }))) return ref;
    }
    return `RE-${Date.now().toString(36).toUpperCase()}`;
  }

  // ===========================================================================
  // Authorization
  // ===========================================================================
  /** Load a listing the actor may MANAGE (owner-of OR accepted-agent-of), or 404. */
  async requireManageable(actor: Actor, listingId: string) {
    const listing = await this.prisma.propertyListing.findUnique({
      where: { id: listingId },
      include: { ownerProfile: true, agentProfile: true },
    });
    if (!listing) throw new NotFoundException('Listing not found.');
    if (listing.ownerProfile.userId === actor.userId) return { listing, role: 'OWNER' as const };
    if (listing.agentProfile && listing.agentProfile.userId === actor.userId) return { listing, role: 'AGENT' as const };
    const asn = await this.prisma.propertyListingAssignment.findFirst({
      where: { listingId, status: 'ACCEPTED', agentProfile: { userId: actor.userId } },
      include: { agentProfile: true },
    });
    if (asn?.agentProfile) return { listing: { ...listing, agentProfile: asn.agentProfile }, role: 'AGENT' as const };
    throw new NotFoundException('Listing not found.');
  }

  /** Assert the acting lister may take a publishing action (not suspended/inactive). */
  private assertPublishable(ctx: Awaited<ReturnType<PropertiesService['requireManageable']>>) {
    if (ctx.role === 'OWNER') {
      if (ctx.listing.ownerProfile.approvalStatus === 'SUSPENDED') throw new ForbiddenException('Your property-owner account is suspended.');
    } else {
      const a = ctx.listing.agentProfile;
      if (!a || a.approvalStatus === 'SUSPENDED') throw new ForbiddenException('Your agent account is suspended.');
      if (!a.isActive) throw new ForbiddenException('Your agent account is inactive.');
    }
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================
  async create(actor: Actor, dto: CreatePropertyInput) {
    const owner = await this.owners.requirePublishableOwner(actor.userId);
    const listing = await this.prisma.propertyListing.create({
      data: {
        ownerProfileId: owner.id,
        purpose: dto.purpose,
        propertyType: dto.propertyType,
        title: dto.title,
        slug: await this.uniqueSlug(dto.title),
        reference: await this.uniqueReference(),
        description: dto.description,
        priceMinor: BigInt(dto.priceMinor),
        rentalPeriod: dto.rentalPeriod ?? null,
        negotiable: dto.negotiable ?? false,
        district: dto.district ?? null,
        locality: dto.locality ?? null,
        generalAddress: dto.generalAddress ?? null,
        exactAddress: dto.exactAddress ?? null,
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
        locationVisibility: dto.locationVisibility ?? 'DISTRICT_ONLY',
        bedrooms: dto.bedrooms ?? null,
        bathrooms: dto.bathrooms ?? null,
        halfBathrooms: dto.halfBathrooms ?? null,
        parkingSpaces: dto.parkingSpaces ?? null,
        propertySize: dto.propertySize ?? null,
        landSize: dto.landSize ?? null,
        areaUnit: dto.areaUnit ?? null,
        yearBuilt: dto.yearBuilt ?? null,
        furnishing: dto.furnishing ?? null,
        tenure: dto.tenure ?? null,
        petPolicy: dto.petPolicy ?? null,
        availabilityDate: dto.availabilityDate ?? null,
        leaseTerm: dto.leaseTerm ?? null,
        condition: dto.condition ?? null,
        videoUrl: dto.videoUrl ?? null,
        status: 'DRAFT',
        amenities: dto.amenities?.length ? { create: dedupe(dto.amenities).map((name) => ({ name })) } : undefined,
        utilities: dto.utilities?.length ? { create: dedupe(dto.utilities).map((name) => ({ name })) } : undefined,
        priceHistory: { create: { priceMinor: BigInt(dto.priceMinor) } },
        statusHistory: { create: { fromStatus: null, toStatus: 'DRAFT', actorId: actor.userId } },
      },
    });
    await this.audit.record({ action: 'PROPERTY_CREATED', actorId: actor.userId, newValue: { listingId: listing.id } });
    return this.managedDetail(actor, listing.id);
  }

  async update(actor: Actor, listingId: string, dto: UpdatePropertyInput) {
    const ctx = await this.requireManageable(actor, listingId);
    if (!EDITABLE.includes(ctx.listing.status)) throw new BadRequestException('Only draft, rejected, or more-info listings can be edited.');
    const priceChanged = dto.priceMinor !== undefined && BigInt(dto.priceMinor) !== ctx.listing.priceMinor;
    await this.prisma.$transaction(async (tx) => {
      await tx.propertyListing.update({
        where: { id: listingId },
        data: {
          purpose: dto.purpose ?? undefined,
          propertyType: dto.propertyType ?? undefined,
          title: dto.title ?? undefined,
          description: dto.description ?? undefined,
          priceMinor: dto.priceMinor === undefined ? undefined : BigInt(dto.priceMinor),
          rentalPeriod: dto.rentalPeriod === undefined ? undefined : dto.rentalPeriod,
          negotiable: dto.negotiable ?? undefined,
          district: dto.district === undefined ? undefined : dto.district,
          locality: dto.locality === undefined ? undefined : dto.locality,
          generalAddress: dto.generalAddress === undefined ? undefined : dto.generalAddress,
          exactAddress: dto.exactAddress === undefined ? undefined : dto.exactAddress,
          latitude: dto.latitude === undefined ? undefined : dto.latitude,
          longitude: dto.longitude === undefined ? undefined : dto.longitude,
          locationVisibility: dto.locationVisibility ?? undefined,
          bedrooms: dto.bedrooms === undefined ? undefined : dto.bedrooms,
          bathrooms: dto.bathrooms === undefined ? undefined : dto.bathrooms,
          halfBathrooms: dto.halfBathrooms === undefined ? undefined : dto.halfBathrooms,
          parkingSpaces: dto.parkingSpaces === undefined ? undefined : dto.parkingSpaces,
          propertySize: dto.propertySize === undefined ? undefined : dto.propertySize,
          landSize: dto.landSize === undefined ? undefined : dto.landSize,
          areaUnit: dto.areaUnit === undefined ? undefined : dto.areaUnit,
          yearBuilt: dto.yearBuilt === undefined ? undefined : dto.yearBuilt,
          furnishing: dto.furnishing === undefined ? undefined : dto.furnishing,
          tenure: dto.tenure === undefined ? undefined : dto.tenure,
          petPolicy: dto.petPolicy === undefined ? undefined : dto.petPolicy,
          availabilityDate: dto.availabilityDate === undefined ? undefined : dto.availabilityDate,
          leaseTerm: dto.leaseTerm === undefined ? undefined : dto.leaseTerm,
          condition: dto.condition === undefined ? undefined : dto.condition,
          videoUrl: dto.videoUrl === undefined ? undefined : dto.videoUrl,
        },
      });
      if (dto.amenities) {
        await tx.propertyAmenity.deleteMany({ where: { listingId } });
        const names = dedupe(dto.amenities);
        if (names.length) await tx.propertyAmenity.createMany({ data: names.map((name) => ({ listingId, name })) });
      }
      if (dto.utilities) {
        await tx.propertyUtility.deleteMany({ where: { listingId } });
        const names = dedupe(dto.utilities);
        if (names.length) await tx.propertyUtility.createMany({ data: names.map((name) => ({ listingId, name })) });
      }
      if (priceChanged) await tx.propertyPriceHistory.create({ data: { listingId, priceMinor: BigInt(dto.priceMinor!) } });
    });
    await this.audit.record({ action: 'PROPERTY_UPDATED', actorId: actor.userId, newValue: { listingId, priceChanged } });
    return this.managedDetail(actor, listingId);
  }

  async submit(actor: Actor, listingId: string) {
    const ctx = await this.requireManageable(actor, listingId);
    this.assertPublishable(ctx);
    if (!SUBMITTABLE.includes(ctx.listing.status)) throw new BadRequestException('This listing cannot be submitted from its current status.');
    if (!ctx.listing.district) throw new BadRequestException('Add the property district before submitting.');
    await this.transition(listingId, ctx.listing.status, 'SUBMITTED', actor.userId, null, { moderationReason: null });
    await this.audit.record({ action: 'PROPERTY_SUBMITTED', actorId: actor.userId, newValue: { listingId } });
    await this.notifications.notifyAdmins('properties.read', { type: 'MARKETPLACE', category: 'PROPERTY', event: 'PRODUCT_MODERATED', title: 'Listing submitted for review', body: `"${ctx.listing.title}" was submitted for review.`, data: { listingId } });
    return this.managedDetail(actor, listingId);
  }

  async ownerStatus(actor: Actor, listingId: string, dto: PropertyOwnerStatusInput) {
    const ctx = await this.requireManageable(actor, listingId);
    const s = ctx.listing.status;
    let to: string = s;
    const extra: Prisma.PropertyListingUpdateInput = {};
    switch (dto.action) {
      case 'WITHDRAW':
        if (!['PUBLISHED', 'UNDER_OFFER', 'APPROVED', 'SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED'].includes(s)) throw new BadRequestException('This listing cannot be withdrawn from its current status.');
        to = 'WITHDRAWN';
        break;
      case 'UNDER_OFFER':
        if (s !== 'PUBLISHED') throw new BadRequestException('Only a published listing can be marked under offer.');
        to = 'UNDER_OFFER';
        break;
      case 'SOLD':
        if (!['PUBLISHED', 'UNDER_OFFER'].includes(s)) throw new BadRequestException('Only a live listing can be marked sold.');
        if (ctx.listing.purpose !== 'FOR_SALE') throw new BadRequestException('Only a for-sale listing can be marked sold.');
        to = 'SOLD';
        extra.soldAt = new Date();
        break;
      case 'RENTED':
        if (!['PUBLISHED', 'UNDER_OFFER'].includes(s)) throw new BadRequestException('Only a live listing can be marked rented.');
        if (ctx.listing.purpose !== 'FOR_RENT') throw new BadRequestException('Only a for-rent listing can be marked rented.');
        to = 'RENTED';
        extra.rentedAt = new Date();
        break;
      case 'ARCHIVE':
        if (['SUBMITTED', 'UNDER_REVIEW', 'PUBLISHED', 'UNDER_OFFER'].includes(s)) throw new BadRequestException('Withdraw or wait for review before archiving.');
        to = 'ARCHIVED';
        extra.archivedAt = new Date();
        break;
    }
    await this.transition(listingId, s, to, actor.userId, null, extra);
    await this.audit.record({ action: 'PROPERTY_STATUS_CHANGED', actorId: actor.userId, newValue: { listingId, from: s, to } });
    await this.notifyListers(listingId, { title: 'Listing status updated', body: `"${ctx.listing.title}" is now ${to.replace(/_/g, ' ').toLowerCase()}.`, data: { listingId, status: to } }, actor.userId);
    return this.managedDetail(actor, listingId);
  }

  // ===========================================================================
  // Admin moderation
  // ===========================================================================
  async moderate(actor: Actor, listingId: string, dto: PropertyModerateInput) {
    const listing = await this.prisma.propertyListing.findUnique({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('Listing not found.');
    const reviewable = ['SUBMITTED', 'UNDER_REVIEW'];
    let to: string = listing.status;
    const extra: Prisma.PropertyListingUpdateInput = {};
    let title = 'Listing update';
    switch (dto.action) {
      case 'APPROVE':
        if (!reviewable.includes(listing.status)) throw new BadRequestException('Only a submitted listing can be approved.');
        to = 'PUBLISHED';
        title = 'Your listing is live';
        if (!listing.publishedAt) extra.publishedAt = new Date();
        break;
      case 'REJECT':
        if (!reviewable.includes(listing.status)) throw new BadRequestException('Only a submitted listing can be rejected.');
        to = 'REJECTED';
        title = 'Your listing was not approved';
        break;
      case 'REQUEST_INFO':
        if (!reviewable.includes(listing.status)) throw new BadRequestException('Only a submitted listing can be returned for more info.');
        to = 'MORE_INFO_REQUIRED';
        title = 'More information needed';
        break;
      case 'UNPUBLISH':
        if (!['PUBLISHED', 'UNDER_OFFER'].includes(listing.status)) throw new BadRequestException('Only a live listing can be unpublished.');
        to = 'WITHDRAWN';
        title = 'Your listing was unpublished';
        break;
      case 'SUSPEND':
        to = 'SUSPENDED';
        title = 'Your listing was suspended';
        break;
      case 'RESTORE':
        if (!['SUSPENDED', 'WITHDRAWN'].includes(listing.status)) throw new BadRequestException('Only a suspended or withdrawn listing can be restored.');
        to = 'PUBLISHED';
        title = 'Your listing was restored';
        if (!listing.publishedAt) extra.publishedAt = new Date();
        break;
      case 'ARCHIVE':
        to = 'ARCHIVED';
        title = 'Your listing was archived';
        extra.archivedAt = new Date();
        break;
    }
    await this.transition(listingId, listing.status, to, actor.userId, dto.reason ?? null, { ...extra, moderationReason: dto.reason ?? null, moderatedById: actor.userId, moderatedAt: new Date() });
    await this.audit.record({ action: to === 'PUBLISHED' ? 'PROPERTY_PUBLISHED' : 'PROPERTY_MODERATED', actorId: actor.userId, newValue: { listingId, action: dto.action, reason: dto.reason ?? null } });
    await this.notifyListers(listingId, { title, body: dto.reason ? `${title}: ${dto.reason}` : title, data: { listingId, status: to } });
    return this.adminDetail(listingId);
  }

  // ===========================================================================
  // Images (PUBLIC bucket)
  // ===========================================================================
  /** Server-side listing-image upload (browser → API → public storage). */
  async uploadImage(actor: Actor, listingId: string, buffer: Buffer | undefined, fileName?: string) {
    await this.requireManageable(actor, listingId);
    const count = await this.prisma.propertyImage.count({ where: { listingId } });
    if (count >= MAX_PROPERTY_IMAGES) throw new BadRequestException(`At most ${MAX_PROPERTY_IMAGES} images per listing.`);
    return this.ingest.image(buffer, STORAGE_PREFIX.propertyImage(listingId), 'public', {
      fileName,
      fallbackName: 'image',
    });
  }

  /** @deprecated Prefer {@link uploadImage} — the browser PUT is cross-origin and fails as "Load failed". */
  async presignImage(actor: Actor, listingId: string, fileName: string, contentType: string) {
    await this.requireManageable(actor, listingId);
    if (!isAllowedProductImageMime(contentType)) throw new BadRequestException('Use a JPEG, PNG, or WebP image.');
    const count = await this.prisma.propertyImage.count({ where: { listingId } });
    if (count >= MAX_PROPERTY_IMAGES) throw new BadRequestException(`At most ${MAX_PROPERTY_IMAGES} images per listing.`);
    const key = this.storage.buildKey(STORAGE_PREFIX.propertyImage(listingId), fileName);
    return this.storage.presignUpload(key, contentType, 'public');
  }

  async confirmImage(actor: Actor, listingId: string, dto: PropertyImageConfirmInput) {
    await this.requireManageable(actor, listingId);
    this.storage.assertKeyInNamespace(dto.storageKey, STORAGE_PREFIX.propertyImage(listingId));
    const count = await this.prisma.propertyImage.count({ where: { listingId } });
    if (count >= MAX_PROPERTY_IMAGES) throw new BadRequestException(`At most ${MAX_PROPERTY_IMAGES} images per listing.`);
    const meta = await this.storage.headObject(dto.storageKey, 'public');
    if (!meta) throw new BadRequestException('The uploaded image could not be found in storage.');
    if (!isAllowedProductImageMime(meta.contentType)) throw new BadRequestException('Use a JPEG, PNG, or WebP image.');
    try {
      await this.prisma.propertyImage.create({
        data: { listingId, storageKey: dto.storageKey, altText: dto.altText ?? null, caption: dto.caption ?? null, areaLabel: dto.areaLabel ?? null, position: count, isPrimary: count === 0 },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new BadRequestException('That image was already added.');
      throw e;
    }
    return this.managedDetail(actor, listingId);
  }

  async setPrimaryImage(actor: Actor, listingId: string, imageId: string) {
    await this.requireManageable(actor, listingId);
    const img = await this.prisma.propertyImage.findFirst({ where: { id: imageId, listingId } });
    if (!img) throw new NotFoundException('Image not found.');
    await this.prisma.$transaction([
      this.prisma.propertyImage.updateMany({ where: { listingId }, data: { isPrimary: false } }),
      this.prisma.propertyImage.update({ where: { id: imageId }, data: { isPrimary: true } }),
    ]);
    return this.managedDetail(actor, listingId);
  }

  async reorderImages(actor: Actor, listingId: string, orderedIds: string[]) {
    await this.requireManageable(actor, listingId);
    const imgs = await this.prisma.propertyImage.findMany({ where: { listingId }, select: { id: true } });
    const known = new Set(imgs.map((i) => i.id));
    const ordered = orderedIds.filter((id) => known.has(id));
    await this.prisma.$transaction(ordered.map((id, position) => this.prisma.propertyImage.update({ where: { id }, data: { position } })));
    return this.managedDetail(actor, listingId);
  }

  async deleteImage(actor: Actor, listingId: string, imageId: string) {
    await this.requireManageable(actor, listingId);
    const img = await this.prisma.propertyImage.findFirst({ where: { id: imageId, listingId } });
    if (!img) throw new NotFoundException('Image not found.');
    await this.prisma.propertyImage.delete({ where: { id: imageId } });
    await this.storage.deleteObject(img.storageKey, 'public');
    if (img.isPrimary) {
      const next = await this.prisma.propertyImage.findFirst({ where: { listingId }, orderBy: { position: 'asc' } });
      if (next) await this.prisma.propertyImage.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
    return this.managedDetail(actor, listingId);
  }

  // ===========================================================================
  // Documents (PRIVATE bucket) — owner / assigned-accepted agent / permitted admin
  // ===========================================================================
  /** Server-side listing-document upload (browser → API → private storage). */
  async uploadDocument(actor: Actor, listingId: string, buffer: Buffer | undefined, fileName?: string) {
    await this.requireManageable(actor, listingId);
    return this.ingest.document(buffer, STORAGE_PREFIX.propertyDocument(listingId), 'private', {
      fileName,
      fallbackName: 'document',
    });
  }

  /** @deprecated Prefer {@link uploadDocument} — the browser PUT is cross-origin and fails as "Load failed". */
  async presignDocument(actor: Actor, listingId: string, fileName: string, contentType: string) {
    await this.requireManageable(actor, listingId);
    if (!isAllowedDocumentMime(contentType)) throw new BadRequestException('Upload a PDF or image (JPEG, PNG, WebP, HEIC).');
    const key = this.storage.buildKey(STORAGE_PREFIX.propertyDocument(listingId), fileName);
    return this.storage.presignUpload(key, contentType, 'private');
  }

  async confirmDocument(actor: Actor, listingId: string, dto: PropertyDocumentConfirmInput) {
    await this.requireManageable(actor, listingId);
    this.storage.assertKeyInNamespace(dto.storageKey, STORAGE_PREFIX.propertyDocument(listingId));
    const meta = await this.storage.headObject(dto.storageKey, 'private');
    if (!meta) throw new BadRequestException('The uploaded file could not be found in storage.');
    if (!isAllowedDocumentMime(meta.contentType)) throw new BadRequestException('Upload a PDF or image (JPEG, PNG, WebP, HEIC).');
    if (meta.sizeBytes <= 0 || meta.sizeBytes > MAX_DOCUMENT_BYTES) throw new BadRequestException('The file exceeds the maximum allowed size.');
    try {
      await this.prisma.propertyDocument.create({
        data: { listingId, kind: dto.kind, storageKey: dto.storageKey, label: dto.label ?? null, mimeType: meta.contentType, fileSizeBytes: meta.sizeBytes },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new BadRequestException('That document was already added.');
      throw e;
    }
    return this.managedDetail(actor, listingId);
  }

  async listDocuments(actor: Actor, listingId: string) {
    await this.requireManageable(actor, listingId);
    const docs = await this.prisma.propertyDocument.findMany({ where: { listingId }, orderBy: { createdAt: 'desc' } });
    return docs.map((d) => this.docMeta(d));
  }

  /** Signed URL for a private listing document — owner / accepted-agent only. */
  async documentUrl(actor: Actor, listingId: string, documentId: string) {
    await this.requireManageable(actor, listingId);
    const doc = await this.prisma.propertyDocument.findFirst({ where: { id: documentId, listingId } });
    if (!doc) throw new NotFoundException('Document not found.');
    return { url: (await this.storage.presignDownload(doc.storageKey, 'private')).url };
  }

  /** Admin document review (gated by property_documents.read at the controller). */
  async adminListDocuments(listingId: string) {
    const listing = await this.prisma.propertyListing.findUnique({ where: { id: listingId }, select: { id: true } });
    if (!listing) throw new NotFoundException('Listing not found.');
    const docs = await this.prisma.propertyDocument.findMany({ where: { listingId }, orderBy: { createdAt: 'desc' } });
    return Promise.all(
      docs.map(async (d) => ({ ...this.docMeta(d), url: await this.urlOrNull(d.storageKey) })),
    );
  }

  // ===========================================================================
  // Agent assignments
  // ===========================================================================
  async assignAgent(actor: Actor, listingId: string, dto: AssignAgentInput) {
    const ctx = await this.requireManageable(actor, listingId);
    if (ctx.role !== 'OWNER') throw new ForbiddenException('Only the listing owner can assign an agent.');
    const agent = await this.prisma.realEstateAgentProfile.findUnique({ where: { id: dto.agentProfileId } });
    if (!agent || agent.approvalStatus !== 'APPROVED' || !agent.isActive) throw new BadRequestException('That agent is not available for assignment.');
    if (dto.authorizationDocId) {
      const doc = await this.prisma.propertyDocument.findFirst({ where: { id: dto.authorizationDocId, listingId } });
      if (!doc) throw new BadRequestException('The authorization document does not belong to this listing.');
    }
    const assignment = await this.prisma.propertyListingAssignment.create({
      data: {
        listingId,
        ownerProfileId: ctx.listing.ownerProfileId,
        agentProfileId: agent.id,
        agencyId: agent.agencyId ?? null,
        status: 'PENDING',
        authorizationDocId: dto.authorizationDocId ?? null,
      },
    });
    await this.audit.record({ action: 'PROPERTY_ASSIGNMENT_CHANGED', actorId: actor.userId, newValue: { listingId, assignmentId: assignment.id, agentProfileId: agent.id, status: 'PENDING' } });
    await this.notifications.createInApp({ userId: agent.userId, type: 'MARKETPLACE', category: 'PROPERTY', event: 'PRODUCT_MODERATED', title: 'New listing assignment', body: `You were invited to manage "${ctx.listing.title}".`, data: { listingId, assignmentId: assignment.id } });
    return this.managedDetail(actor, listingId);
  }

  /** Agent accepts a pending assignment → ACCEPTED + listing.agentProfileId set. */
  async acceptAssignment(actor: Actor, assignmentId: string) {
    const agent = await this.agents.requirePublishableAgent(actor.userId);
    const asn = await this.prisma.propertyListingAssignment.findFirst({
      where: { id: assignmentId, agentProfileId: agent.id },
      include: { listing: { select: { id: true, title: true, ownerProfile: { select: { userId: true } } } } },
    });
    if (!asn) throw new NotFoundException('Assignment not found.');
    if (asn.status !== 'PENDING') throw new BadRequestException('This assignment can no longer be accepted.');
    await this.prisma.$transaction([
      this.prisma.propertyListingAssignment.update({ where: { id: assignmentId }, data: { status: 'ACCEPTED', acceptedAt: new Date() } }),
      this.prisma.propertyListing.update({ where: { id: asn.listingId }, data: { agentProfileId: agent.id, agencyId: agent.agencyId ?? undefined } }),
    ]);
    await this.audit.record({ action: 'PROPERTY_ASSIGNMENT_CHANGED', actorId: actor.userId, newValue: { listingId: asn.listingId, assignmentId, status: 'ACCEPTED' } });
    await this.notifications.createInApp({ userId: asn.listing.ownerProfile.userId, type: 'MARKETPLACE', category: 'PROPERTY', event: 'PRODUCT_MODERATED', title: 'Agent accepted assignment', body: `An agent accepted managing "${asn.listing.title}".`, data: { listingId: asn.listingId, assignmentId } });
    return this.managedDetail(actor, asn.listingId);
  }

  async declineAssignment(actor: Actor, assignmentId: string) {
    const agent = await this.agents.requireAgentProfile(actor.userId);
    const asn = await this.prisma.propertyListingAssignment.findFirst({ where: { id: assignmentId, agentProfileId: agent.id } });
    if (!asn) throw new NotFoundException('Assignment not found.');
    if (asn.status !== 'PENDING') throw new BadRequestException('This assignment can no longer be declined.');
    await this.prisma.propertyListingAssignment.update({ where: { id: assignmentId }, data: { status: 'DECLINED', endedAt: new Date() } });
    await this.audit.record({ action: 'PROPERTY_ASSIGNMENT_CHANGED', actorId: actor.userId, newValue: { assignmentId, status: 'DECLINED' } });
    return { ok: true };
  }

  async agentAssignments(actor: Actor, status?: string) {
    const agent = await this.agents.requireAgentProfile(actor.userId);
    const rows = await this.prisma.propertyListingAssignment.findMany({
      where: { agentProfileId: agent.id, ...(status ? { status: status as never } : {}) },
      orderBy: { assignedAt: 'desc' },
      take: 200,
      include: { listing: { select: { id: true, title: true, slug: true, reference: true, status: true } } },
    });
    return rows.map((a) => ({ id: a.id, status: a.status, assignedAt: a.assignedAt, acceptedAt: a.acceptedAt, listing: a.listing }));
  }

  // ===========================================================================
  // Reads (lister-scoped)
  // ===========================================================================
  async ownerList(userId: string, status?: string) {
    const owner = await this.owners.requireOwnerProfile(userId);
    const rows = await this.prisma.propertyListing.findMany({
      where: { ownerProfileId: owner.id, ...(status ? { status: status as never } : {}) },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      include: { images: true, _count: { select: { enquiries: true, viewingRequests: true } } },
    });
    return Promise.all(rows.map((l) => this.card(l, { withCounts: true })));
  }

  async agentList(userId: string, status?: string) {
    const agent = await this.agents.requireAgentProfile(userId);
    const rows = await this.prisma.propertyListing.findMany({
      where: { agentProfileId: agent.id, ...(status ? { status: status as never } : {}) },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      include: { images: true, _count: { select: { enquiries: true, viewingRequests: true } } },
    });
    return Promise.all(rows.map((l) => this.card(l, { withCounts: true })));
  }

  async managedDetail(actor: Actor, listingId: string) {
    await this.requireManageable(actor, listingId);
    return this.privateDetail(listingId);
  }

  async adminList(filter: { status?: string; district?: string; reported?: boolean }) {
    const where: Prisma.PropertyListingWhereInput = {
      ...(filter.status ? { status: filter.status as never } : {}),
      ...(filter.district ? { district: filter.district as never } : {}),
      ...(filter.reported ? { reports: { some: { status: 'OPEN' } } } : {}),
    };
    const rows = await this.prisma.propertyListing.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 200,
      include: { images: true, ownerProfile: { select: { legalName: true, displayName: true } }, agentProfile: { select: { displayName: true, slug: true } }, _count: { select: { reports: true, enquiries: true } } },
    });
    return Promise.all(
      rows.map(async (l) => ({
        ...(await this.card(l)),
        status: l.status,
        moderationReason: l.moderationReason,
        owner: l.ownerProfile.displayName ?? l.ownerProfile.legalName,
        agent: l.agentProfile ? { displayName: l.agentProfile.displayName, slug: l.agentProfile.slug } : null,
        reportCount: l._count.reports,
        enquiryCount: l._count.enquiries,
      })),
    );
  }

  async adminDetail(listingId: string) {
    const listing = await this.prisma.propertyListing.findUnique({ where: { id: listingId }, select: { id: true } });
    if (!listing) throw new NotFoundException('Listing not found.');
    return this.privateDetail(listingId);
  }

  // ===========================================================================
  // Serialization
  // ===========================================================================
  /** Location fields respecting the listing's locationVisibility. Exact address is
   *  NEVER included; coordinates are rounded to 2 dp for APPROXIMATE_MAP. */
  publicLocation(l: { locationVisibility: LocationVisibility; district: string | null; locality: string | null; generalAddress: string | null; latitude: number | null; longitude: number | null }) {
    const vis = l.locationVisibility;
    const base = { visibility: vis, district: l.district ?? null };
    if (vis === 'DISTRICT_ONLY') return base;
    const withLocality = { ...base, locality: l.locality ?? null };
    if (vis === 'LOCALITY_ONLY') return withLocality;
    if (vis === 'APPROXIMATE_MAP') return { ...withLocality, latitude: round2(l.latitude), longitude: round2(l.longitude) };
    // EXACT_ADDRESS — general address + exact coords (still never the private exactAddress field)
    return { ...withLocality, generalAddress: l.generalAddress ?? null, latitude: l.latitude ?? null, longitude: l.longitude ?? null };
  }

  /** Compact card for public + lister lists. Signs the primary image. */
  async card(
    l: {
      id: string; title: string; slug: string; reference: string; purpose: string; propertyType: string; priceMinor: bigint; currency: string; rentalPeriod: string | null; negotiable: boolean;
      district: string | null; locality: string | null; generalAddress: string | null; latitude: number | null; longitude: number | null; locationVisibility: LocationVisibility;
      bedrooms: number | null; bathrooms: number | null; propertySize: number | null; landSize: number | null; areaUnit: string | null; furnishing: string | null; status: string; publishedAt: Date | null; createdAt: Date; viewCount?: number;
      images?: Array<{ storageKey: string; isPrimary: boolean; position: number }>;
      _count?: { enquiries?: number; viewingRequests?: number };
    },
    opts: { withCounts?: boolean } = {},
  ) {
    return {
      id: l.id,
      title: l.title,
      slug: l.slug,
      reference: l.reference,
      purpose: l.purpose,
      propertyType: l.propertyType,
      priceMinor: n(l.priceMinor),
      currency: l.currency,
      rentalPeriod: l.rentalPeriod,
      negotiable: l.negotiable,
      bedrooms: l.bedrooms,
      bathrooms: l.bathrooms,
      propertySize: l.propertySize,
      landSize: l.landSize,
      areaUnit: l.areaUnit,
      furnishing: l.furnishing,
      status: l.status,
      location: this.publicLocation(l),
      primaryImageUrl: await this.primaryImageUrl(l.images),
      publishedAt: l.publishedAt,
      createdAt: l.createdAt,
      ...(l.viewCount != null ? { viewCount: l.viewCount } : {}),
      ...(opts.withCounts && l._count ? { enquiryCount: l._count.enquiries ?? 0, viewingCount: l._count.viewingRequests ?? 0 } : {}),
    };
  }

  /** Full owner/agent/admin view — includes exact address, private documents list,
   *  status/price history, and assignments. */
  async privateDetail(listingId: string) {
    const l = await this.prisma.propertyListing.findUniqueOrThrow({
      where: { id: listingId },
      include: {
        amenities: { orderBy: { name: 'asc' } },
        utilities: { orderBy: { name: 'asc' } },
        images: { orderBy: { position: 'asc' } },
        documents: { orderBy: { createdAt: 'desc' } },
        statusHistory: { orderBy: { createdAt: 'asc' } },
        priceHistory: { orderBy: { createdAt: 'asc' } },
        assignments: { orderBy: { assignedAt: 'desc' }, include: { agentProfile: { select: { id: true, displayName: true, slug: true } } } },
        ownerProfile: { select: { id: true, legalName: true, displayName: true, phone: true, email: true } },
        agentProfile: { select: { id: true, displayName: true, slug: true } },
        agency: { select: { id: true, name: true, slug: true } },
      },
    });
    return {
      id: l.id,
      title: l.title,
      slug: l.slug,
      reference: l.reference,
      status: l.status,
      purpose: l.purpose,
      propertyType: l.propertyType,
      description: l.description,
      priceMinor: n(l.priceMinor),
      currency: l.currency,
      rentalPeriod: l.rentalPeriod,
      negotiable: l.negotiable,
      district: l.district,
      locality: l.locality,
      generalAddress: l.generalAddress,
      exactAddress: l.exactAddress,
      latitude: l.latitude,
      longitude: l.longitude,
      locationVisibility: l.locationVisibility,
      bedrooms: l.bedrooms,
      bathrooms: l.bathrooms,
      halfBathrooms: l.halfBathrooms,
      parkingSpaces: l.parkingSpaces,
      propertySize: l.propertySize,
      landSize: l.landSize,
      areaUnit: l.areaUnit,
      yearBuilt: l.yearBuilt,
      furnishing: l.furnishing,
      tenure: l.tenure,
      petPolicy: l.petPolicy,
      availabilityDate: l.availabilityDate,
      leaseTerm: l.leaseTerm,
      condition: l.condition,
      videoUrl: l.videoUrl,
      authorityVerified: l.authorityVerified,
      moderationReason: l.moderationReason,
      viewCount: l.viewCount,
      publishedAt: l.publishedAt,
      soldAt: l.soldAt,
      rentedAt: l.rentedAt,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
      amenities: l.amenities.map((a) => a.name),
      utilities: l.utilities.map((u) => u.name),
      images: await Promise.all(l.images.map(async (img) => ({ id: img.id, url: await this.urlOrNull(img.storageKey, 'public'), altText: img.altText, caption: img.caption, areaLabel: img.areaLabel, position: img.position, isPrimary: img.isPrimary }))),
      documents: l.documents.map((d) => this.docMeta(d)),
      statusHistory: l.statusHistory.map((h) => ({ from: h.fromStatus, to: h.toStatus, note: h.note, at: h.createdAt })),
      priceHistory: l.priceHistory.map((p) => ({ priceMinor: n(p.priceMinor), currency: p.currency, at: p.createdAt })),
      assignments: l.assignments.map((a) => ({ id: a.id, status: a.status, agent: a.agentProfile, assignedAt: a.assignedAt, acceptedAt: a.acceptedAt, endedAt: a.endedAt })),
      owner: { id: l.ownerProfile.id, name: l.ownerProfile.displayName ?? l.ownerProfile.legalName, phone: l.ownerProfile.phone, email: l.ownerProfile.email },
      agent: l.agentProfile,
      agency: l.agency,
    };
  }

  // ===========================================================================
  // helpers
  // ===========================================================================
  private docMeta(d: { id: string; kind: string; label: string | null; mimeType: string; fileSizeBytes: number; scanStatus: string; createdAt: Date }) {
    return { id: d.id, kind: d.kind, label: d.label, mimeType: d.mimeType, fileSizeBytes: d.fileSizeBytes, scanStatus: d.scanStatus, createdAt: d.createdAt };
  }

  private async primaryImageUrl(images?: Array<{ storageKey: string; isPrimary: boolean; position: number }>) {
    if (!images?.length) return null;
    const primary = images.find((i) => i.isPrimary) ?? [...images].sort((a, b) => a.position - b.position)[0];
    return primary ? this.urlOrNull(primary.storageKey, 'public') : null;
  }

  async urlOrNull(key: string | null, visibility: 'public' | 'private' = 'public') {
    if (!key) return null;
    try {
      return (await this.storage.presignDownload(key, visibility)).url;
    } catch {
      return null;
    }
  }

  private async transition(listingId: string, from: string, to: string, actorId: string, note: string | null, extra: Prisma.PropertyListingUpdateInput = {}) {
    await this.prisma.$transaction(async (tx) => {
      await tx.propertyListing.update({ where: { id: listingId }, data: { status: to as never, ...extra } });
      await tx.propertyStatusHistory.create({ data: { listingId, fromStatus: from as never, toStatus: to as never, actorId, note } });
    });
  }

  private async notifyListers(listingId: string, params: { title: string; body: string; data?: Record<string, unknown> }, exceptUserId?: string) {
    const l = await this.prisma.propertyListing.findUnique({ where: { id: listingId }, include: { ownerProfile: { select: { userId: true } }, agentProfile: { select: { userId: true } } } });
    if (!l) return;
    const recipients = [l.ownerProfile.userId, l.agentProfile?.userId].filter((u) => u && u !== exceptUserId);
    await this.notifications.notifyUsers(recipients, { type: 'MARKETPLACE', category: 'PROPERTY', event: 'PRODUCT_MODERATED', ...params });
  }
}

const dedupe = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
