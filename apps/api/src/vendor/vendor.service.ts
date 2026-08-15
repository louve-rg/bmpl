import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  isAllowedProductImageMime,
  MAX_PRODUCT_IMAGE_BYTES,
  slugify,
  STORAGE_PREFIX,
} from '@bmpl/shared';
import type {
  CreateVendorProfileInput,
  UpdateVendorProfileInput,
  VendorHoursInput,
  VendorLocationInput,
  VendorSettingsInput,
} from '@bmpl/validation';
import { Prisma } from '@bmpl/database';
import type { VendorProfile } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { UploadIngestService } from '../storage/upload-ingest.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProductsService } from '../products/products.service';

export interface ActorContext {
  userId: string;
  ipAddress?: string | null;
  sessionId?: string | null;
}

type ImageKind = 'logo' | 'banner';
type ModerationKind = 'approve' | 'reject' | 'suspend' | 'restore';

/** Relations loaded to render a storefront (public view + owner preview). */
const STOREFRONT_INCLUDE = {
  settings: true,
  locations: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
  openingHours: { orderBy: { dayOfWeek: 'asc' } },
} satisfies Prisma.VendorProfileInclude;

@Injectable()
export class VendorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ingest: UploadIngestService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly products: ProductsService,
  ) {}

  // ===========================================================================
  // Owner (the signed-in VENDOR)
  // ===========================================================================

  /** The caller's full storefront record, or `{ profile: null }` if not started. */
  async getOwn(userId: string) {
    const profile = await this.prisma.vendorProfile.findUnique({
      where: { userId },
      include: {
        settings: true,
        locations: { orderBy: { createdAt: 'asc' } },
        openingHours: { orderBy: { dayOfWeek: 'asc' } },
      },
    });
    if (!profile) return { profile: null };
    return this.serializeOwn(profile);
  }

  async create(userId: string, dto: CreateVendorProfileInput) {
    const existing = await this.prisma.vendorProfile.findUnique({ where: { userId } });
    if (existing) throw new ConflictException('You already have a vendor profile.');

    const slug = dto.slug
      ? await this.assertSlugFree(dto.slug)
      : await this.deriveUniqueSlug(dto.businessName);

    const profile = await this.prisma.vendorProfile.create({
      data: {
        userId,
        businessName: dto.businessName,
        slug,
        description: dto.description ?? null,
        contactEmail: dto.contactEmail,
        contactPhone: dto.contactPhone ?? null,
        website: emptyToNull(dto.website),
        socialLinks: (dto.socialLinks ?? undefined) as Prisma.InputJsonValue | undefined,
        approvalStatus: 'DRAFT',
        storeStatus: 'CLOSED',
        settings: { create: {} }, // sensible defaults from the schema
      },
      include: { settings: true, locations: true, openingHours: true },
    });
    return this.serializeOwn(profile);
  }

  async update(userId: string, dto: UpdateVendorProfileInput) {
    const profile = await this.ownProfileOrThrow(userId);

    let slug = profile.slug;
    if (dto.slug !== undefined && dto.slug !== profile.slug) {
      slug = await this.assertSlugFree(dto.slug, profile.id);
    }

    await this.prisma.vendorProfile.update({
      where: { id: profile.id },
      data: {
        businessName: dto.businessName ?? undefined,
        slug,
        description: dto.description === undefined ? undefined : dto.description,
        contactEmail: dto.contactEmail ?? undefined,
        contactPhone: dto.contactPhone === undefined ? undefined : dto.contactPhone,
        website: dto.website === undefined ? undefined : emptyToNull(dto.website),
        socialLinks:
          dto.socialLinks === undefined
            ? undefined
            : ((dto.socialLinks ?? Prisma.JsonNull) as Prisma.InputJsonValue),
        storeStatus: dto.storeStatus ?? undefined,
      },
    });
    return this.getOwn(userId);
  }

  /** DRAFT/REJECTED -> PENDING. Requires the minimum publishable fields. */
  async submit(actor: ActorContext) {
    const profile = await this.ownProfileOrThrow(actor.userId);
    if (profile.approvalStatus !== 'DRAFT' && profile.approvalStatus !== 'REJECTED') {
      throw new ConflictException(`A ${profile.approvalStatus} profile cannot be submitted.`);
    }
    if (!profile.businessName?.trim() || !profile.contactEmail?.trim()) {
      throw new BadRequestException('Add a business name and contact email before submitting.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.vendorProfile.update({
        where: { id: profile.id },
        data: { approvalStatus: 'PENDING', submittedAt: new Date(), rejectionReason: null },
      });
      await tx.vendorModerationReview.create({
        data: {
          vendorProfileId: profile.id,
          reviewerId: actor.userId,
          action: 'SUBMITTED',
          fromStatus: profile.approvalStatus,
          toStatus: 'PENDING',
        },
      });
      await this.audit.record(
        {
          action: 'VENDOR_PROFILE_SUBMITTED',
          actorId: actor.userId,
          ipAddress: actor.ipAddress ?? null,
          sessionId: actor.sessionId ?? null,
          newValue: { vendorProfileId: profile.id },
        },
        tx,
      );
      // Alert vendor reviewers of the new application (M16).
      await this.notifications.notifyAdmins(
        'vendors.read',
        {
          type: 'ACCOUNT',
          category: 'ADMIN_ALERT',
          event: 'ADMIN_VENDOR_APPLICATION',
          title: 'New vendor application',
          body: `"${profile.businessName}" submitted their storefront for review.`,
          data: { vendorProfileId: profile.id },
        },
        tx,
      );
    });
    return this.getOwn(actor.userId);
  }

  async updateSettings(userId: string, dto: VendorSettingsInput) {
    const profile = await this.ownProfileOrThrow(userId);
    await this.prisma.vendorSettings.update({
      where: { vendorProfileId: profile.id },
      data: {
        pickupEnabled: dto.pickupEnabled ?? undefined,
        deliveryEnabled: dto.deliveryEnabled ?? undefined,
        vacationMode: dto.vacationMode ?? undefined,
        minimumOrderMinor:
          dto.minimumOrderMinor === undefined
            ? undefined
            : dto.minimumOrderMinor === null
              ? null
              : BigInt(dto.minimumOrderMinor),
        deliveryRadiusKm: dto.deliveryRadiusKm === undefined ? undefined : dto.deliveryRadiusKm,
        baseDeliveryFeeMinor:
          dto.baseDeliveryFeeMinor === undefined ? undefined : dto.baseDeliveryFeeMinor === null ? null : BigInt(dto.baseDeliveryFeeMinor),
        freeDeliveryThresholdMinor:
          dto.freeDeliveryThresholdMinor === undefined ? undefined : dto.freeDeliveryThresholdMinor === null ? null : BigInt(dto.freeDeliveryThresholdMinor),
        taxesEnabled: dto.taxesEnabled ?? undefined,
        autoAcceptOrders: dto.autoAcceptOrders ?? undefined,
        hideOutOfStock: dto.hideOutOfStock ?? undefined,
      },
    });
    return this.getOwn(userId);
  }

  // ---- Locations ----
  async addLocation(userId: string, dto: VendorLocationInput) {
    const profile = await this.ownProfileOrThrow(userId);
    await this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary) {
        await tx.vendorLocation.updateMany({
          where: { vendorProfileId: profile.id },
          data: { isPrimary: false },
        });
      }
      await tx.vendorLocation.create({
        data: {
          vendorProfileId: profile.id,
          label: dto.label,
          addressLine1: dto.addressLine1,
          addressLine2: dto.addressLine2 ?? null,
          city: dto.city,
          district: dto.district,
          latitude: dto.latitude ?? null,
          longitude: dto.longitude ?? null,
          isPrimary: dto.isPrimary ?? false,
        },
      });
    });
    return this.getOwn(userId);
  }

  async updateLocation(userId: string, locationId: string, dto: Partial<VendorLocationInput>) {
    const profile = await this.ownProfileOrThrow(userId);
    await this.ownLocationOrThrow(profile.id, locationId);
    await this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary) {
        await tx.vendorLocation.updateMany({
          where: { vendorProfileId: profile.id },
          data: { isPrimary: false },
        });
      }
      await tx.vendorLocation.update({
        where: { id: locationId },
        data: {
          label: dto.label ?? undefined,
          addressLine1: dto.addressLine1 ?? undefined,
          addressLine2: dto.addressLine2 === undefined ? undefined : (dto.addressLine2 ?? null),
          city: dto.city ?? undefined,
          district: dto.district ?? undefined,
          latitude: dto.latitude === undefined ? undefined : (dto.latitude ?? null),
          longitude: dto.longitude === undefined ? undefined : (dto.longitude ?? null),
          isPrimary: dto.isPrimary ?? undefined,
        },
      });
    });
    return this.getOwn(userId);
  }

  async deleteLocation(userId: string, locationId: string) {
    const profile = await this.ownProfileOrThrow(userId);
    await this.ownLocationOrThrow(profile.id, locationId);
    await this.prisma.vendorLocation.delete({ where: { id: locationId } });
    return this.getOwn(userId);
  }

  /** Replace-all opening hours. */
  async setHours(userId: string, dto: VendorHoursInput) {
    const profile = await this.ownProfileOrThrow(userId);
    await this.prisma.$transaction(async (tx) => {
      await tx.vendorOpeningHours.deleteMany({ where: { vendorProfileId: profile.id } });
      if (dto.hours.length) {
        await tx.vendorOpeningHours.createMany({
          data: dto.hours.map((h) => ({
            vendorProfileId: profile.id,
            dayOfWeek: h.dayOfWeek,
            isClosed: h.isClosed,
            openTime: h.isClosed ? null : (h.openTime ?? null),
            closeTime: h.isClosed ? null : (h.closeTime ?? null),
          })),
        });
      }
    });
    return this.getOwn(userId);
  }

  // ---- Images (public bucket) ----
  /** Server-side vendor logo/banner upload (browser → API → public storage). */
  async uploadImage(userId: string, kind: ImageKind, buffer: Buffer | undefined, fileName?: string) {
    const profile = await this.ownProfileOrThrow(userId);
    const prefix =
      kind === 'logo' ? STORAGE_PREFIX.vendorLogo(profile.id) : STORAGE_PREFIX.vendorBanner(profile.id);
    return this.ingest.image(buffer, prefix, 'public', { fileName, fallbackName: kind });
  }

  /** @deprecated Prefer {@link uploadImage} — the browser PUT is cross-origin and fails as "Load failed". */
  async presignImage(userId: string, kind: ImageKind, fileName: string, contentType: string) {
    if (!isAllowedProductImageMime(contentType)) {
      throw new BadRequestException('Unsupported image type. Use JPEG, PNG, or WebP.');
    }
    const profile = await this.ownProfileOrThrow(userId);
    const prefix =
      kind === 'logo' ? STORAGE_PREFIX.vendorLogo(profile.id) : STORAGE_PREFIX.vendorBanner(profile.id);
    const key = this.storage.buildKey(prefix, fileName);
    return this.storage.presignUpload(key, contentType, 'public');
  }

  async confirmImage(userId: string, kind: ImageKind, key: string) {
    const profile = await this.ownProfileOrThrow(userId);
    const prefix =
      kind === 'logo' ? STORAGE_PREFIX.vendorLogo(profile.id) : STORAGE_PREFIX.vendorBanner(profile.id);
    this.storage.assertKeyInNamespace(key, prefix);
    const meta = await this.storage.headObject(key, 'public');
    if (!meta) throw new BadRequestException('Uploaded image could not be found in storage.');
    if (!isAllowedProductImageMime(meta.contentType)) {
      throw new BadRequestException('Unsupported image type.');
    }
    if (meta.sizeBytes <= 0 || meta.sizeBytes > MAX_PRODUCT_IMAGE_BYTES) {
      throw new BadRequestException('Image exceeds the maximum allowed size.');
    }
    await this.prisma.vendorProfile.update({
      where: { id: profile.id },
      data: kind === 'logo' ? { logoKey: key } : { bannerKey: key },
    });
    return this.getOwn(userId);
  }

  // ===========================================================================
  // Public storefront (M3)
  // ===========================================================================

  /** Approved, non-vacation vendors for the public directory (optional search/filter). */
  async publicList(query?: { q?: string; district?: string }) {
    const q = query?.q?.trim();
    const rows = await this.prisma.vendorProfile.findMany({
      where: {
        approvalStatus: 'APPROVED',
        settings: { is: { vacationMode: false } },
        ...(q ? { businessName: { contains: q, mode: 'insensitive' as const } } : {}),
        ...(query?.district
          ? { locations: { some: { district: query.district as never } } }
          : {}),
      },
      orderBy: { businessName: 'asc' },
      include: { settings: { select: { pickupEnabled: true, deliveryEnabled: true } } },
    });
    return Promise.all(
      rows.map(async (r) => ({
        businessName: r.businessName,
        slug: r.slug,
        description: r.description,
        storeStatus: r.storeStatus,
        ratingAverage: r.ratingAverage,
        ratingCount: r.ratingCount,
        pickupEnabled: r.settings?.pickupEnabled ?? true,
        deliveryEnabled: r.settings?.deliveryEnabled ?? false,
        logoUrl: await this.urlOrNull(r.logoKey),
      })),
    );
  }

  /** A single approved storefront by slug. 404 for unknown/unapproved vendors. */
  async publicStorefront(slug: string) {
    const p = await this.prisma.vendorProfile.findFirst({
      where: { slug, approvalStatus: 'APPROVED' },
      include: STOREFRONT_INCLUDE,
    });
    if (!p) throw new NotFoundException('Storefront not found.');
    return this.buildStorefront(p);
  }

  /**
   * Owner-only PREVIEW of the caller's OWN storefront in ANY status (DRAFT,
   * PENDING, …) — lets a vendor see exactly what customers will see before it is
   * approved/public. Same shape as the public storefront plus a `preview` flag
   * and the current `approvalStatus`.
   */
  async previewOwn(userId: string) {
    const p = await this.prisma.vendorProfile.findUnique({
      where: { userId },
      include: STOREFRONT_INCLUDE,
    });
    if (!p) throw new NotFoundException('Create your storefront first.');
    return { ...(await this.buildStorefront(p)), preview: true, approvalStatus: p.approvalStatus };
  }

  private async buildStorefront(
    p: Prisma.VendorProfileGetPayload<{ include: typeof STOREFRONT_INCLUDE }>,
  ) {
    const featuredProducts = await this.products.vendorFeatured(p.id);
    const catRows = await this.prisma.product.findMany({
      where: { vendorProfileId: p.id, status: 'PUBLISHED' },
      select: { category: { select: { name: true, slug: true } } },
      distinct: ['categoryId'],
      orderBy: { categoryId: 'asc' },
    });

    return {
      // Public review subject id — reviews are read publicly by (subjectType, subjectId).
      vendorProfileId: p.id,
      businessName: p.businessName,
      slug: p.slug,
      description: p.description,
      contactEmail: p.contactEmail,
      contactPhone: p.contactPhone,
      website: p.website,
      socialLinks: p.socialLinks,
      storeStatus: p.storeStatus,
      ratingAverage: p.ratingAverage,
      ratingCount: p.ratingCount,
      vacationMode: p.settings?.vacationMode ?? false,
      pickupEnabled: p.settings?.pickupEnabled ?? true,
      deliveryEnabled: p.settings?.deliveryEnabled ?? false,
      logoUrl: await this.urlOrNull(p.logoKey),
      bannerUrl: await this.urlOrNull(p.bannerKey),
      locations: p.locations.map((l) => ({
        label: l.label,
        addressLine1: l.addressLine1,
        addressLine2: l.addressLine2,
        city: l.city,
        district: l.district,
        isPrimary: l.isPrimary,
      })),
      openingHours: p.openingHours.map((h) => ({
        dayOfWeek: h.dayOfWeek,
        isClosed: h.isClosed,
        openTime: h.openTime,
        closeTime: h.closeTime,
      })),
      featuredProducts,
      categories: catRows.map((c) => c.category),
    };
  }

  // ===========================================================================
  // Admin moderation
  // ===========================================================================

  async adminList(status?: string) {
    const rows = await this.prisma.vendorProfile.findMany({
      where: status ? { approvalStatus: status as VendorProfile['approvalStatus'] } : {},
      orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        _count: { select: { locations: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      businessName: r.businessName,
      slug: r.slug,
      approvalStatus: r.approvalStatus,
      storeStatus: r.storeStatus,
      submittedAt: r.submittedAt,
      owner: r.user,
      locationCount: r._count.locations,
    }));
  }

  async adminGet(id: string) {
    const profile = await this.prisma.vendorProfile.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        settings: true,
        locations: { orderBy: { createdAt: 'asc' } },
        openingHours: { orderBy: { dayOfWeek: 'asc' } },
        reviews: {
          orderBy: { createdAt: 'desc' },
          include: { reviewer: { select: { firstName: true, lastName: true } } },
        },
      },
    });
    if (!profile) throw new NotFoundException('Vendor profile not found.');
    return {
      ...this.publicShape(profile),
      owner: profile.user,
      settings: settingsShape(profile.settings),
      locations: profile.locations,
      openingHours: profile.openingHours,
      rejectionReason: profile.rejectionReason,
      reviews: profile.reviews.map((rev) => ({
        action: rev.action,
        note: rev.note,
        fromStatus: rev.fromStatus,
        toStatus: rev.toStatus,
        createdAt: rev.createdAt,
        reviewer: rev.reviewer ? `${rev.reviewer.firstName} ${rev.reviewer.lastName}` : null,
      })),
      logoUrl: await this.urlOrNull(profile.logoKey),
      bannerUrl: await this.urlOrNull(profile.bannerKey),
    };
  }

  /**
   * Designate a storefront as a SIMULATION store (or return it to a real one).
   *
   * Everything bought from a simulation store becomes an `isTest` order, which
   * is excluded from analytics and can only ever be offered to a driver profile
   * that is itself flagged for testing. Because the flag lives on the STORE
   * rather than in the checkout request, a customer has nothing to forge.
   *
   * Refused once the store has real orders behind it: flipping a live storefront
   * into test mode would make its future orders invisible to revenue and
   * undeliverable by real drivers, and flipping a test store to real would let a
   * rehearsal's history leak into the figures.
   */
  async setTestMode(actor: ActorContext, vendorProfileId: string, isTest: boolean, reason?: string) {
    const vp = await this.prisma.vendorProfile.findUnique({
      where: { id: vendorProfileId },
      select: { id: true, businessName: true, isTest: true },
    });
    if (!vp) throw new NotFoundException('Vendor not found.');
    if (vp.isTest === isTest) return { id: vp.id, businessName: vp.businessName, isTest };

    const realOrders = await this.prisma.vendorOrder.count({
      where: { vendorProfileId, order: { isTest: !isTest } },
    });
    if (realOrders > 0) {
      throw new BadRequestException(
        `This store already has ${realOrders} order(s) on the other side of the test boundary. Create a separate storefront for simulations.`,
      );
    }

    const updated = await this.prisma.vendorProfile.update({ where: { id: vendorProfileId }, data: { isTest } });
    await this.audit.record({
      action: 'VENDOR_TEST_MODE_CHANGED',
      actorId: actor.userId,
      ipAddress: actor.ipAddress ?? null,
      sessionId: actor.sessionId ?? null,
      newValue: { vendorProfileId, isTest, reason: reason ?? null },
    });
    return { id: updated.id, businessName: updated.businessName, isTest: updated.isTest };
  }

  async moderate(actor: ActorContext, id: string, kind: ModerationKind, note?: string) {
    const profile = await this.prisma.vendorProfile.findUnique({ where: { id } });
    if (!profile) throw new NotFoundException('Vendor profile not found.');

    const plan = TRANSITIONS[kind];
    if (!plan.from.includes(profile.approvalStatus)) {
      throw new ConflictException(
        `Cannot ${kind} a ${profile.approvalStatus} vendor profile.`,
      );
    }
    if (kind === 'reject' && !note?.trim()) {
      throw new BadRequestException('A reason is required to reject a vendor.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.vendorProfile.update({
        where: { id },
        data: {
          approvalStatus: plan.to,
          approvedAt: plan.to === 'APPROVED' ? new Date() : undefined,
          rejectionReason: kind === 'reject' ? (note ?? null) : null,
        },
      });
      await tx.vendorModerationReview.create({
        data: {
          vendorProfileId: id,
          reviewerId: actor.userId,
          action: plan.action,
          note: note ?? null,
          fromStatus: profile.approvalStatus,
          toStatus: plan.to,
        },
      });
      await this.audit.record(
        {
          action: plan.audit,
          actorId: actor.userId,
          targetUserId: profile.userId,
          ipAddress: actor.ipAddress ?? null,
          sessionId: actor.sessionId ?? null,
          previousValue: { approvalStatus: profile.approvalStatus },
          newValue: { approvalStatus: plan.to },
          reason: note ?? null,
        },
        tx,
      );
      await this.notifications.createInApp(
        {
          userId: profile.userId,
          type: 'MARKETPLACE',
          title: plan.notifyTitle,
          body: plan.notifyBody(profile.businessName, note),
          data: { vendorProfileId: id, approvalStatus: plan.to },
        },
        tx,
      );
    });
    return this.adminGet(id);
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private async ownProfileOrThrow(userId: string): Promise<VendorProfile> {
    const profile = await this.prisma.vendorProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Create your vendor profile first.');
    return profile;
  }

  private async ownLocationOrThrow(vendorProfileId: string, locationId: string) {
    const loc = await this.prisma.vendorLocation.findUnique({ where: { id: locationId } });
    if (!loc || loc.vendorProfileId !== vendorProfileId) {
      throw new NotFoundException('Location not found.');
    }
    return loc;
  }

  private async assertSlugFree(slug: string, excludeId?: string): Promise<string> {
    const existing = await this.prisma.vendorProfile.findUnique({ where: { slug } });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(`The store address "${slug}" is already taken.`);
    }
    return slug;
  }

  private async deriveUniqueSlug(name: string): Promise<string> {
    const root = slugify(name) || 'store';
    let candidate = root;
    let n = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const existing = await this.prisma.vendorProfile.findUnique({ where: { slug: candidate } });
      if (!existing) return candidate;
      n += 1;
      candidate = `${root}-${n}`;
    }
  }

  private async urlOrNull(key: string | null): Promise<string | null> {
    if (!key) return null;
    try {
      return await this.storage.publicUrl(key);
    } catch {
      return null; // storage disabled in this environment
    }
  }

  private publicShape(p: VendorProfile) {
    return {
      id: p.id,
      businessName: p.businessName,
      slug: p.slug,
      description: p.description,
      contactEmail: p.contactEmail,
      contactPhone: p.contactPhone,
      website: p.website,
      socialLinks: p.socialLinks,
      approvalStatus: p.approvalStatus,
      storeStatus: p.storeStatus,
      ratingAverage: p.ratingAverage,
      ratingCount: p.ratingCount,
      submittedAt: p.submittedAt,
      approvedAt: p.approvedAt,
    };
  }

  private async serializeOwn(
    p: VendorProfile & {
      settings: unknown;
      locations: unknown;
      openingHours: unknown;
    },
  ) {
    return {
      profile: {
        ...this.publicShape(p),
        rejectionReason: p.rejectionReason,
        logoKey: p.logoKey,
        bannerKey: p.bannerKey,
        logoUrl: await this.urlOrNull(p.logoKey),
        bannerUrl: await this.urlOrNull(p.bannerKey),
      },
      settings: settingsShape(p.settings as Parameters<typeof settingsShape>[0]),
      locations: p.locations,
      openingHours: p.openingHours,
    };
  }
}

function emptyToNull(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  return s ? s : null;
}

/** BigInt-safe settings view (minimumOrderMinor -> number | null). */
function settingsShape(
  s:
    | {
        pickupEnabled: boolean;
        deliveryEnabled: boolean;
        vacationMode: boolean;
        minimumOrderMinor: bigint | null;
        deliveryRadiusKm: number | null;
        taxesEnabled: boolean;
        autoAcceptOrders: boolean;
        hideOutOfStock: boolean;
      }
    | null
    | undefined,
) {
  if (!s) return null;
  return {
    pickupEnabled: s.pickupEnabled,
    deliveryEnabled: s.deliveryEnabled,
    vacationMode: s.vacationMode,
    minimumOrderMinor: s.minimumOrderMinor === null ? null : Number(s.minimumOrderMinor),
    deliveryRadiusKm: s.deliveryRadiusKm,
    taxesEnabled: s.taxesEnabled,
    autoAcceptOrders: s.autoAcceptOrders,
    hideOutOfStock: s.hideOutOfStock,
  };
}

const TRANSITIONS: Record<
  ModerationKind,
  {
    from: VendorProfile['approvalStatus'][];
    to: VendorProfile['approvalStatus'];
    action: 'APPROVED' | 'REJECTED' | 'SUSPENDED' | 'RESTORED';
    audit: 'VENDOR_APPROVED' | 'VENDOR_REJECTED' | 'VENDOR_SUSPENDED' | 'VENDOR_RESTORED';
    notifyTitle: string;
    notifyBody: (name: string, note?: string) => string;
  }
> = {
  approve: {
    from: ['PENDING'],
    to: 'APPROVED',
    action: 'APPROVED',
    audit: 'VENDOR_APPROVED',
    notifyTitle: 'Your storefront is approved',
    notifyBody: (name) => `“${name}” has been approved and can now be published.`,
  },
  reject: {
    from: ['PENDING'],
    to: 'REJECTED',
    action: 'REJECTED',
    audit: 'VENDOR_REJECTED',
    notifyTitle: 'Storefront needs changes',
    notifyBody: (name, note) => `“${name}” was not approved. ${note ?? ''}`.trim(),
  },
  suspend: {
    from: ['APPROVED'],
    to: 'SUSPENDED',
    action: 'SUSPENDED',
    audit: 'VENDOR_SUSPENDED',
    notifyTitle: 'Storefront suspended',
    notifyBody: (name, note) => `“${name}” has been suspended. ${note ?? ''}`.trim(),
  },
  restore: {
    from: ['SUSPENDED'],
    to: 'APPROVED',
    action: 'RESTORED',
    audit: 'VENDOR_RESTORED',
    notifyTitle: 'Storefront restored',
    notifyBody: (name) => `“${name}” has been restored and is live again.`,
  },
};
