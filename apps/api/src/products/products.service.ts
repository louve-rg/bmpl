import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { slugify } from '@bmpl/shared';
import type { CreateProductInput, ProductQueryInput, UpdateProductInput } from '@bmpl/validation';
import { Prisma } from '@bmpl/database';
import type { Product, ProductStatus } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface ActorContext {
  userId: string;
  ipAddress?: string | null;
  sessionId?: string | null;
}

type ModerationKind = 'approve' | 'reject' | 'suspend' | 'restore';

const money = (v: bigint | null) => (v === null ? null : Number(v));

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ===========================================================================
  // Vendor (owner)
  // ===========================================================================

  async listOwn(userId: string) {
    const vp = await this.ownProfileId(userId);
    const rows = await this.prisma.product.findMany({
      where: { vendorProfileId: vp },
      orderBy: { updatedAt: 'desc' },
      include: { category: { select: { name: true, slug: true } } },
    });
    return rows.map((p) => this.ownShape(p, p.category));
  }

  async getOwn(userId: string, id: string) {
    const vp = await this.ownProfileId(userId);
    const p = await this.prisma.product.findUnique({
      where: { id },
      include: { category: { select: { name: true, slug: true } }, tags: true },
    });
    if (!p || p.vendorProfileId !== vp) throw new NotFoundException('Product not found.');
    return { ...this.ownShape(p, p.category), tags: p.tags.map((t) => t.name) };
  }

  async create(actor: ActorContext, dto: CreateProductInput) {
    const vp = await this.ownProfileId(actor.userId);
    await this.categoryOrThrow(dto.categoryId);
    await this.assertSkuFree(vp, dto.sku);
    const slug = dto.slug ? await this.assertSlugFree(dto.slug) : await this.deriveUniqueSlug(dto.title);

    const product = await this.prisma.product.create({
      data: {
        vendorProfileId: vp,
        categoryId: dto.categoryId,
        title: dto.title,
        slug,
        description: dto.description ?? null,
        sku: dto.sku,
        barcode: dto.barcode ?? null,
        brand: dto.brand ?? null,
        status: 'DRAFT',
        priceMinor: BigInt(dto.priceMinor),
        salePriceMinor: dto.salePriceMinor == null ? null : BigInt(dto.salePriceMinor),
        weightGrams: dto.weightGrams ?? null,
        lengthMm: dto.lengthMm ?? null,
        widthMm: dto.widthMm ?? null,
        heightMm: dto.heightMm ?? null,
        featured: dto.featured,
        metaTitle: dto.metaTitle ?? null,
        metaDescription: dto.metaDescription ?? null,
        searchKeywords: dto.searchKeywords ?? [],
        tags: dto.tags?.length ? { connectOrCreate: this.tagConnectors(dto.tags) } : undefined,
      },
      include: { category: { select: { name: true, slug: true } } },
    });

    await this.audit.record({
      action: 'PRODUCT_CREATED',
      actorId: actor.userId,
      ipAddress: actor.ipAddress ?? null,
      sessionId: actor.sessionId ?? null,
      newValue: { id: product.id, title: product.title, sku: product.sku },
    });
    return this.ownShape(product, product.category);
  }

  async update(actor: ActorContext, id: string, dto: UpdateProductInput) {
    const vp = await this.ownProfileId(actor.userId);
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing || existing.vendorProfileId !== vp) throw new NotFoundException('Product not found.');
    if (existing.status === 'ARCHIVED') {
      throw new ConflictException('Restore the product before editing it.');
    }
    if (dto.categoryId) await this.categoryOrThrow(dto.categoryId);

    let slug = existing.slug;
    if (dto.slug !== undefined && dto.slug !== existing.slug) slug = await this.assertSlugFree(dto.slug, id);
    if (dto.sku !== undefined && dto.sku !== existing.sku) await this.assertSkuFree(vp, dto.sku, id);

    // salePrice must not exceed the effective price (new or existing).
    const nextPrice = dto.priceMinor ?? Number(existing.priceMinor);
    const nextSale = dto.salePriceMinor === undefined ? money(existing.salePriceMinor) : dto.salePriceMinor;
    if (nextSale != null && nextSale > nextPrice) {
      throw new BadRequestException('Sale price cannot exceed the price.');
    }

    const product = await this.prisma.product.update({
      where: { id },
      data: {
        title: dto.title ?? undefined,
        slug,
        description: dto.description === undefined ? undefined : dto.description,
        sku: dto.sku ?? undefined,
        barcode: dto.barcode === undefined ? undefined : dto.barcode,
        categoryId: dto.categoryId ?? undefined,
        brand: dto.brand === undefined ? undefined : dto.brand,
        priceMinor: dto.priceMinor === undefined ? undefined : BigInt(dto.priceMinor),
        salePriceMinor:
          dto.salePriceMinor === undefined ? undefined : dto.salePriceMinor === null ? null : BigInt(dto.salePriceMinor),
        weightGrams: dto.weightGrams === undefined ? undefined : dto.weightGrams,
        lengthMm: dto.lengthMm === undefined ? undefined : dto.lengthMm,
        widthMm: dto.widthMm === undefined ? undefined : dto.widthMm,
        heightMm: dto.heightMm === undefined ? undefined : dto.heightMm,
        featured: dto.featured ?? undefined,
        metaTitle: dto.metaTitle === undefined ? undefined : dto.metaTitle,
        metaDescription: dto.metaDescription === undefined ? undefined : dto.metaDescription,
        searchKeywords: dto.searchKeywords ?? undefined,
        tags: dto.tags === undefined ? undefined : { set: [], connectOrCreate: this.tagConnectors(dto.tags) },
      },
      include: { category: { select: { name: true, slug: true } }, tags: true },
    });
    return { ...this.ownShape(product, product.category), tags: product.tags.map((t) => t.name) };
  }

  async submit(actor: ActorContext, id: string) {
    return this.ownTransition(actor, id, {
      from: ['DRAFT', 'REJECTED'],
      to: 'PENDING_REVIEW',
      action: 'SUBMITTED',
      audit: 'PRODUCT_SUBMITTED',
      clearRejection: true,
    });
  }

  async archive(actor: ActorContext, id: string) {
    return this.ownTransition(actor, id, {
      from: ['DRAFT', 'REJECTED', 'PUBLISHED', 'SUSPENDED', 'PENDING_REVIEW'],
      to: 'ARCHIVED',
      action: 'SUSPENDED', // closest ModerationAction; audit distinguishes
      audit: 'PRODUCT_ARCHIVED',
    });
  }

  async unarchive(actor: ActorContext, id: string) {
    return this.ownTransition(actor, id, {
      from: ['ARCHIVED'],
      to: 'DRAFT',
      action: 'RESTORED',
      audit: 'PRODUCT_CREATED',
    });
  }

  async remove(actor: ActorContext, id: string) {
    const vp = await this.ownProfileId(actor.userId);
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p || p.vendorProfileId !== vp) throw new NotFoundException('Product not found.');
    if (p.status !== 'DRAFT') throw new ConflictException('Only draft products can be deleted; archive instead.');
    await this.prisma.product.delete({ where: { id } });
    await this.audit.record({
      action: 'PRODUCT_DELETED',
      actorId: actor.userId,
      ipAddress: actor.ipAddress ?? null,
      sessionId: actor.sessionId ?? null,
      previousValue: { id: p.id, title: p.title },
    });
    return { id };
  }

  // ===========================================================================
  // Admin moderation
  // ===========================================================================

  async adminList(status?: string) {
    const rows = await this.prisma.product.findMany({
      where: status ? { status: status as ProductStatus } : {},
      orderBy: { updatedAt: 'desc' },
      include: {
        category: { select: { name: true } },
        vendorProfile: { select: { businessName: true, slug: true } },
      },
    });
    return rows.map((p) => ({
      id: p.id,
      title: p.title,
      slug: p.slug,
      sku: p.sku,
      status: p.status,
      priceMinor: money(p.priceMinor),
      featured: p.featured,
      category: p.category.name,
      vendor: p.vendorProfile.businessName,
      vendorSlug: p.vendorProfile.slug,
    }));
  }

  async adminGet(id: string) {
    const p = await this.prisma.product.findUnique({
      where: { id },
      include: {
        category: { select: { name: true, slug: true } },
        vendorProfile: { select: { businessName: true, slug: true } },
        tags: true,
        reviews: {
          orderBy: { createdAt: 'desc' },
          include: { reviewer: { select: { firstName: true, lastName: true } } },
        },
      },
    });
    if (!p) throw new NotFoundException('Product not found.');
    return {
      ...this.ownShape(p, p.category),
      vendor: p.vendorProfile,
      tags: p.tags.map((t) => t.name),
      reviews: p.reviews.map((r) => ({
        action: r.action,
        note: r.note,
        fromStatus: r.fromStatus,
        toStatus: r.toStatus,
        createdAt: r.createdAt,
        reviewer: r.reviewer ? `${r.reviewer.firstName} ${r.reviewer.lastName}` : null,
      })),
    };
  }

  async moderate(actor: ActorContext, id: string, kind: ModerationKind, note?: string) {
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Product not found.');
    const plan = MOD[kind];
    if (!plan.from.includes(p.status)) {
      throw new ConflictException(`Cannot ${kind} a ${p.status} product.`);
    }
    if (kind === 'reject' && !note?.trim()) {
      throw new BadRequestException('A reason is required to reject a product.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          status: plan.to,
          publishedAt: plan.to === 'PUBLISHED' && !p.publishedAt ? new Date() : undefined,
          rejectionReason: kind === 'reject' ? (note ?? null) : null,
        },
      });
      await tx.productModerationReview.create({
        data: {
          productId: id,
          reviewerId: actor.userId,
          action: plan.action,
          note: note ?? null,
          fromStatus: p.status,
          toStatus: plan.to,
        },
      });
      await this.audit.record(
        {
          action: plan.audit,
          actorId: actor.userId,
          ipAddress: actor.ipAddress ?? null,
          sessionId: actor.sessionId ?? null,
          previousValue: { status: p.status },
          newValue: { status: plan.to },
          reason: note ?? null,
        },
        tx,
      );
      const owner = await tx.vendorProfile.findUnique({
        where: { id: p.vendorProfileId },
        select: { userId: true },
      });
      if (owner) {
        await this.notifications.createInApp(
          {
            userId: owner.userId,
            type: 'MARKETPLACE',
            title: plan.title,
            body: plan.body(p.title, note),
            data: { productId: id, status: plan.to },
          },
          tx,
        );
      }
    });
    return this.adminGet(id);
  }

  // ===========================================================================
  // Public
  // ===========================================================================

  async publicList(query: ProductQueryInput) {
    const where: Prisma.ProductWhereInput = {
      status: 'PUBLISHED',
      vendorProfile: { approvalStatus: 'APPROVED' },
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.featured ? { featured: true } : {}),
      ...(query.vendorSlug ? { vendorProfile: { approvalStatus: 'APPROVED', slug: query.vendorSlug } } : {}),
      ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    const orderBy = ORDER[query.sort] ?? ORDER.newest;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          category: { select: { name: true, slug: true } },
          vendorProfile: { select: { businessName: true, slug: true } },
        },
      }),
    ]);
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      items: rows.map((p) => this.cardShape(p)),
    };
  }

  async publicDetail(slug: string) {
    const p = await this.prisma.product.findFirst({
      where: { slug, status: 'PUBLISHED', vendorProfile: { approvalStatus: 'APPROVED' } },
      include: {
        category: { select: { name: true, slug: true } },
        vendorProfile: { select: { businessName: true, slug: true } },
        tags: true,
      },
    });
    if (!p) throw new NotFoundException('Product not found.');
    return {
      ...this.cardShape(p),
      description: p.description,
      barcode: p.barcode,
      weightGrams: p.weightGrams,
      dimensionsMm: { length: p.lengthMm, width: p.widthMm, height: p.heightMm },
      metaTitle: p.metaTitle,
      metaDescription: p.metaDescription,
      tags: p.tags.map((t) => t.name),
    };
  }

  /** Published featured products for a vendor storefront (used by VendorService). */
  async vendorFeatured(vendorProfileId: string, limit = 8) {
    const rows = await this.prisma.product.findMany({
      where: { vendorProfileId, status: 'PUBLISHED' },
      orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      include: {
        category: { select: { name: true, slug: true } },
        vendorProfile: { select: { businessName: true, slug: true } },
      },
    });
    return rows.map((p) => this.cardShape(p));
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private async ownProfileId(userId: string): Promise<string> {
    const vp = await this.prisma.vendorProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!vp) throw new ForbiddenException('Create your vendor profile first.');
    return vp.id;
  }

  private async ownTransition(
    actor: ActorContext,
    id: string,
    plan: {
      from: ProductStatus[];
      to: ProductStatus;
      action: 'SUBMITTED' | 'SUSPENDED' | 'RESTORED';
      audit: 'PRODUCT_SUBMITTED' | 'PRODUCT_ARCHIVED' | 'PRODUCT_CREATED';
      clearRejection?: boolean;
    },
  ) {
    const vp = await this.ownProfileId(actor.userId);
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p || p.vendorProfileId !== vp) throw new NotFoundException('Product not found.');
    if (!plan.from.includes(p.status)) {
      throw new ConflictException(`Cannot do that to a ${p.status} product.`);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: { status: plan.to, rejectionReason: plan.clearRejection ? null : undefined },
      });
      await tx.productModerationReview.create({
        data: { productId: id, reviewerId: actor.userId, action: plan.action, fromStatus: p.status, toStatus: plan.to },
      });
      await this.audit.record(
        {
          action: plan.audit,
          actorId: actor.userId,
          ipAddress: actor.ipAddress ?? null,
          sessionId: actor.sessionId ?? null,
          previousValue: { status: p.status },
          newValue: { status: plan.to },
        },
        tx,
      );
    });
    return this.getOwn(actor.userId, id);
  }

  private async categoryOrThrow(categoryId: string) {
    const c = await this.prisma.category.findUnique({ where: { id: categoryId }, select: { id: true } });
    if (!c) throw new BadRequestException('Category not found.');
  }

  private async assertSkuFree(vendorProfileId: string, sku: string, excludeId?: string) {
    const existing = await this.prisma.product.findFirst({ where: { vendorProfileId, sku } });
    if (existing && existing.id !== excludeId) throw new ConflictException(`SKU "${sku}" is already used.`);
  }

  private async assertSlugFree(slug: string, excludeId?: string): Promise<string> {
    const existing = await this.prisma.product.findUnique({ where: { slug } });
    if (existing && existing.id !== excludeId) throw new ConflictException(`The URL "${slug}" is already in use.`);
    return slug;
  }

  private async deriveUniqueSlug(title: string): Promise<string> {
    const root = slugify(title) || 'product';
    let candidate = root;
    let n = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const existing = await this.prisma.product.findUnique({ where: { slug: candidate } });
      if (!existing) return candidate;
      n += 1;
      candidate = `${root}-${n}`;
    }
  }

  private tagConnectors(names: string[]) {
    const unique = [...new Map(names.map((n) => [slugify(n), n.trim()])).entries()];
    return unique.map(([slug, name]) => ({ where: { slug }, create: { name, slug } }));
  }

  private ownShape(p: Product, category: { name: string; slug: string }) {
    return {
      id: p.id,
      title: p.title,
      slug: p.slug,
      description: p.description,
      sku: p.sku,
      barcode: p.barcode,
      brand: p.brand,
      status: p.status,
      priceMinor: money(p.priceMinor),
      salePriceMinor: money(p.salePriceMinor),
      currency: p.currency,
      weightGrams: p.weightGrams,
      lengthMm: p.lengthMm,
      widthMm: p.widthMm,
      heightMm: p.heightMm,
      featured: p.featured,
      metaTitle: p.metaTitle,
      metaDescription: p.metaDescription,
      searchKeywords: p.searchKeywords,
      categoryId: p.categoryId,
      category,
      rejectionReason: p.rejectionReason,
      publishedAt: p.publishedAt,
      updatedAt: p.updatedAt,
    };
  }

  private cardShape(
    p: Product & {
      category: { name: string; slug: string };
      vendorProfile: { businessName: string; slug: string };
    },
  ) {
    return {
      id: p.id,
      title: p.title,
      slug: p.slug,
      brand: p.brand,
      priceMinor: money(p.priceMinor),
      salePriceMinor: money(p.salePriceMinor),
      currency: p.currency,
      featured: p.featured,
      ratingAverage: p.ratingAverage,
      ratingCount: p.ratingCount,
      category: p.category,
      vendor: { businessName: p.vendorProfile.businessName, slug: p.vendorProfile.slug },
    };
  }
}

const ORDER: Record<string, Prisma.ProductOrderByWithRelationInput | Prisma.ProductOrderByWithRelationInput[]> = {
  newest: { createdAt: 'desc' },
  price_asc: { priceMinor: 'asc' },
  price_desc: { priceMinor: 'desc' },
  featured: [{ featured: 'desc' }, { createdAt: 'desc' }],
  relevance: { createdAt: 'desc' },
};

const MOD: Record<
  ModerationKind,
  {
    from: ProductStatus[];
    to: ProductStatus;
    action: 'APPROVED' | 'REJECTED' | 'SUSPENDED' | 'RESTORED';
    audit: 'PRODUCT_APPROVED' | 'PRODUCT_REJECTED' | 'PRODUCT_SUSPENDED';
    title: string;
    body: (t: string, note?: string) => string;
  }
> = {
  approve: {
    from: ['PENDING_REVIEW'],
    to: 'PUBLISHED',
    action: 'APPROVED',
    audit: 'PRODUCT_APPROVED',
    title: 'Product approved',
    body: (t) => `“${t}” is now live on your storefront.`,
  },
  reject: {
    from: ['PENDING_REVIEW'],
    to: 'REJECTED',
    action: 'REJECTED',
    audit: 'PRODUCT_REJECTED',
    title: 'Product needs changes',
    body: (t, note) => `“${t}” was not approved. ${note ?? ''}`.trim(),
  },
  suspend: {
    from: ['PUBLISHED'],
    to: 'SUSPENDED',
    action: 'SUSPENDED',
    audit: 'PRODUCT_SUSPENDED',
    title: 'Product suspended',
    body: (t, note) => `“${t}” has been suspended. ${note ?? ''}`.trim(),
  },
  restore: {
    from: ['SUSPENDED'],
    to: 'PUBLISHED',
    action: 'RESTORED',
    audit: 'PRODUCT_APPROVED',
    title: 'Product restored',
    body: (t) => `“${t}” is live again.`,
  },
};
