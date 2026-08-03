import {
  BadRequestException,
  ConflictException,
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
import { ProductImagesService } from './product-images.service';
import { VariantsService } from './variants.service';
import { InventoryService } from './inventory.service';
import { OwnershipService } from './ownership.service';

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
    private readonly images: ProductImagesService,
    private readonly variants: VariantsService,
    private readonly inventory: InventoryService,
    private readonly ownership: OwnershipService,
  ) {}

  // ===========================================================================
  // Vendor (owner)
  // ===========================================================================

  async listOwn(userId: string) {
    const vp = await this.ownership.vendorProfileId(userId);
    const rows = await this.prisma.product.findMany({
      where: { vendorProfileId: vp },
      orderBy: { updatedAt: 'desc' },
      include: { category: { select: { name: true, slug: true } } },
    });
    const ids = rows.map((r) => r.id);
    const [primary, stock] = await Promise.all([
      this.images.primaryUrls(ids),
      this.inventory.summaryFor(ids),
    ]);
    return rows.map((p) => ({
      ...this.ownShape(p, p.category),
      primaryImageUrl: primary.get(p.id) ?? null,
      stock: stock.get(p.id) ?? { available: null, unlimited: false, status: 'UNTRACKED' as const },
    }));
  }

  async getOwn(userId: string, id: string) {
    const vp = await this.ownership.vendorProfileId(userId);
    const p = await this.prisma.product.findUnique({
      where: { id },
      include: { category: { select: { name: true, slug: true } }, tags: true },
    });
    if (!p || p.vendorProfileId !== vp) throw new NotFoundException('Product not found.');
    return {
      ...this.ownShape(p, p.category),
      tags: p.tags.map((t) => t.name),
      images: await this.images.list(id),
    };
  }

  async create(actor: ActorContext, dto: CreateProductInput) {
    const vp = await this.ownership.vendorProfileId(actor.userId);
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
        // Products go live immediately on create (no admin pre-review). Public
        // visibility still requires the vendor's storefront to be APPROVED, and
        // admins can suspend a live product after the fact.
        status: 'PUBLISHED',
        publishedAt: new Date(),
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
    const vp = await this.ownership.vendorProfileId(actor.userId);
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

  /** Vendor hides a product from the store. */
  async archive(actor: ActorContext, id: string) {
    return this.ownTransition(actor, id, {
      from: ['DRAFT', 'REJECTED', 'PUBLISHED', 'PENDING_REVIEW'],
      to: 'ARCHIVED',
      action: 'SUSPENDED', // closest ModerationAction; audit distinguishes
      audit: 'PRODUCT_ARCHIVED',
    });
  }

  /** Vendor re-lists an archived product — goes straight back live. */
  async unarchive(actor: ActorContext, id: string) {
    return this.ownTransition(actor, id, {
      from: ['ARCHIVED'],
      to: 'PUBLISHED',
      action: 'RESTORED',
      audit: 'PRODUCT_APPROVED',
    });
  }

  async remove(actor: ActorContext, id: string) {
    const vp = await this.ownership.vendorProfileId(actor.userId);
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p || p.vendorProfileId !== vp) throw new NotFoundException('Product not found.');
    if (p.status === 'SUSPENDED') {
      throw new ConflictException('A suspended product cannot be deleted; contact support.');
    }
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
      images: await this.images.list(id),
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

  /**
   * Public catalog with PostgreSQL full-text search + filters + sort + pagination.
   * Filtering/ranking/pagination run as one raw SQL query (uses the tsvector GIN
   * index, a recursive category-subtree CTE, and an inventory EXISTS check); the
   * resulting page of ids is then hydrated with Prisma for typed relations.
   */
  async publicList(query: ProductQueryInput) {
    const q = (query.q ?? '').trim();
    const offset = (query.page - 1) * query.pageSize;

    const catFilter = query.categoryId
      ? Prisma.sql`AND p."categoryId" IN (
          WITH RECURSIVE tree AS (
            SELECT id FROM categories WHERE id = ${query.categoryId}
            UNION ALL
            SELECT c.id FROM categories c JOIN tree t ON c."parentId" = t.id
          ) SELECT id FROM tree)`
      : Prisma.empty;
    const vendorFilter = query.vendorSlug ? Prisma.sql`AND vp.slug = ${query.vendorSlug}` : Prisma.empty;
    const featuredFilter = query.featured ? Prisma.sql`AND p.featured = TRUE` : Prisma.empty;
    const priceMinFilter = query.priceMin != null ? Prisma.sql`AND p."priceMinor" >= ${query.priceMin}` : Prisma.empty;
    const priceMaxFilter = query.priceMax != null ? Prisma.sql`AND p."priceMinor" <= ${query.priceMax}` : Prisma.empty;
    const inStockFilter = query.inStock
      ? Prisma.sql`AND (
          NOT EXISTS (SELECT 1 FROM inventory i WHERE i."productId" = p.id)
          OR EXISTS (SELECT 1 FROM inventory i WHERE i."productId" = p.id
            AND (i.unlimited OR i."allowBackorders" OR (i.quantity - i.reserved) > 0)))`
      : Prisma.empty;
    const searchFilter = q
      ? Prisma.sql`AND (p."searchVector" @@ websearch_to_tsquery('english', ${q}) OR p.title ILIKE ${`%${q}%`})`
      : Prisma.empty;
    const rankExpr = q
      ? Prisma.sql`ts_rank(p."searchVector", websearch_to_tsquery('english', ${q}))`
      : Prisma.sql`0`;

    // Newest-first: most recently PUBLISHED first (publishedAt), createdAt as the
    // fallback, and a stable id tie-breaker so pagination/order is deterministic and
    // never depends on DB return order. Editing a product (updatedAt) does NOT move it
    // up — only (re)publishing does, via publishedAt.
    const newestFirst = Prisma.sql`p."publishedAt" DESC NULLS LAST, p."createdAt" DESC, p.id DESC`;
    let orderBy: Prisma.Sql;
    switch (query.sort) {
      case 'price_asc': orderBy = Prisma.sql`p."priceMinor" ASC, ${newestFirst}`; break;
      case 'price_desc': orderBy = Prisma.sql`p."priceMinor" DESC, ${newestFirst}`; break;
      case 'featured': orderBy = Prisma.sql`p.featured DESC, ${newestFirst}`; break;
      case 'relevance': orderBy = q ? Prisma.sql`rank DESC, ${newestFirst}` : newestFirst; break;
      default: orderBy = newestFirst; // 'newest' + any unspecified sort
    }

    const rows = await this.prisma.$queryRaw<Array<{ id: string; total: bigint }>>`
      SELECT p.id, ${rankExpr} AS rank, count(*) OVER() AS total
      FROM products p
      JOIN vendor_profiles vp ON vp.id = p."vendorProfileId"
      WHERE p.status = 'PUBLISHED' AND vp."approvalStatus" = 'APPROVED'
        ${catFilter} ${vendorFilter} ${featuredFilter} ${priceMinFilter} ${priceMaxFilter} ${inStockFilter} ${searchFilter}
      ORDER BY ${orderBy}
      LIMIT ${query.pageSize} OFFSET ${offset}`;

    const total = rows.length ? Number(rows[0]!.total) : 0;
    const ids = rows.map((r) => r.id);
    const found = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      include: {
        category: { select: { name: true, slug: true } },
        vendorProfile: { select: { businessName: true, slug: true } },
      },
    });
    const byId = new Map(found.map((p) => [p.id, p]));
    const ordered = ids.map((id) => byId.get(id)).filter((p): p is (typeof found)[number] => !!p);
    const primary = await this.images.primaryUrls(ids);
    const stock = await this.inventory.inStockMap(ids);
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      items: ordered.map((p) => ({
        ...this.cardShape(p),
        primaryImageUrl: primary.get(p.id) ?? null,
        inStock: stock.get(p.id) ?? true,
      })),
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
      // Detail gallery EXCLUDES the brand image (listing-only role, M6.2).
      images: await this.images.listGallery(p.id),
      brandImageUrl: await this.images.brandImageUrl(p.id),
      ...(await this.variants.publicView(p.id)), // { options, variants }
      availability: await this.inventory.publicAvailability(p.id),
    };
  }

  /** Published featured products for a vendor storefront (used by VendorService). */
  async vendorFeatured(vendorProfileId: string, limit = 8) {
    const rows = await this.prisma.product.findMany({
      where: { vendorProfileId, status: 'PUBLISHED' },
      // Storefront grid is newest-first: most recently published at the top,
      // createdAt fallback, stable id tie-break (editing never moves a product up).
      orderBy: [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      include: {
        category: { select: { name: true, slug: true } },
        vendorProfile: { select: { businessName: true, slug: true } },
      },
    });
    const primary = await this.images.primaryUrls(rows.map((r) => r.id));
    return rows.map((p) => ({ ...this.cardShape(p), primaryImageUrl: primary.get(p.id) ?? null }));
  }

  /**
   * Storefront card shapes for a set of product ids, keyed by id — PUBLISHED
   * products of APPROVED vendors only (so wishlists / recently-viewed never leak
   * an unpublished or unapproved product). Ids absent from the map are no longer
   * viewable. Used by the M20 engagement module.
   */
  async cardsByIds(ids: string[]) {
    const found = ids.length
      ? await this.prisma.product.findMany({
          where: { id: { in: ids }, status: 'PUBLISHED', vendorProfile: { approvalStatus: 'APPROVED' } },
          include: {
            category: { select: { name: true, slug: true } },
            vendorProfile: { select: { businessName: true, slug: true } },
          },
        })
      : [];
    const foundIds = found.map((p) => p.id);
    const primary = await this.images.primaryUrls(foundIds);
    const stock = await this.inventory.inStockMap(foundIds);
    return new Map(found.map((p) => [p.id, { ...this.cardShape(p), primaryImageUrl: primary.get(p.id) ?? null, inStock: stock.get(p.id) ?? true }]));
  }

  /** Assert a product is publicly viewable (PUBLISHED + APPROVED vendor); else 404. */
  async assertViewable(productId: string): Promise<void> {
    const p = await this.prisma.product.findFirst({
      where: { id: productId, status: 'PUBLISHED', vendorProfile: { approvalStatus: 'APPROVED' } },
      select: { id: true },
    });
    if (!p) throw new NotFoundException('Product not found.');
  }

  /** Count of active variants for a product (drives the "choose your options" rule). */
  async activeVariantCount(productId: string): Promise<number> {
    return this.prisma.productVariant.count({ where: { productId, isActive: true } });
  }

  /** Canonical public variant serialization ({ options, variants }) — reused by the
   *  wishlist so a saved variant shows the exact title/options/price/availability. */
  publicVariantView(productId: string) {
    return this.variants.publicView(productId);
  }

  /** Signed primary image URLs per variant id (public bucket). */
  variantPrimaryUrls(variantIds: string[]) {
    return this.images.variantPrimaryUrls(variantIds);
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private async ownTransition(
    actor: ActorContext,
    id: string,
    plan: {
      from: ProductStatus[];
      to: ProductStatus;
      action: 'SUBMITTED' | 'SUSPENDED' | 'RESTORED';
      audit: 'PRODUCT_SUBMITTED' | 'PRODUCT_ARCHIVED' | 'PRODUCT_CREATED' | 'PRODUCT_APPROVED';
      clearRejection?: boolean;
    },
  ) {
    const vp = await this.ownership.vendorProfileId(actor.userId);
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
