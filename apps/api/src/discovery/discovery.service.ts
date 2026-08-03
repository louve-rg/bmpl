import { Injectable, NotFoundException } from '@nestjs/common';
import {
  DISCOVERY_SECTION_SIZE,
  FOR_YOU_SIZE,
  RELATED_SIZE,
  SUGGEST_MIN_CHARS,
  SUGGEST_SIZE,
  TOP_CATEGORIES_SIZE,
  TOP_RATED_MIN_RATINGS,
} from '@bmpl/shared';
import { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../products/products.service';

const VIEWABLE = { status: 'PUBLISHED', vendorProfile: { approvalStatus: 'APPROVED' } } as const;

/** Canonical newest-first ordering: most recently published first, createdAt fallback,
 *  stable id tie-breaker. Editing a product never moves it up (only publishedAt does). */
const NEWEST_FIRST: Prisma.ProductOrderByWithRelationInput[] = [
  { publishedAt: { sort: 'desc', nulls: 'last' } },
  { createdAt: 'desc' },
  { id: 'desc' },
];

/**
 * Discovery & Recommendations (M21). DETERMINISTIC, non-AI heuristics over existing
 * data: the M7 catalog, M19 rating aggregates, and (for personalization) the M20
 * saved/recently-viewed signals. No ML, no ad ranking, no cross-user data exposure —
 * "for you" reads only the caller's own signals. Every result is resolved through
 * ProductsService.cardsByIds, so only PUBLISHED products of APPROVED vendors surface.
 */
@Injectable()
export class DiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
  ) {}

  /** Resolve a set of ids to cards, preserving the given order and dropping any
   *  that are no longer viewable. */
  private async orderedCards(ids: string[]) {
    const cards = await this.products.cardsByIds(ids);
    return ids.map((id) => cards.get(id)).filter((c): c is NonNullable<typeof c> => !!c);
  }

  private async idsByRating(limit: number, where: Prisma.ProductWhereInput = {}) {
    const rows = await this.prisma.product.findMany({
      where: { ...VIEWABLE, ...where },
      orderBy: [{ ratingAverage: 'desc' }, { ratingCount: 'desc' }, { featured: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  // ===========================================================================
  // Homepage / discovery surface
  // ===========================================================================
  async newArrivals(limit = DISCOVERY_SECTION_SIZE) {
    // Newest-first: publishedAt desc → createdAt desc → id (stable tie-break).
    const rows = await this.prisma.product.findMany({ where: VIEWABLE, orderBy: NEWEST_FIRST, take: limit, select: { id: true } });
    return this.orderedCards(rows.map((r) => r.id));
  }

  async featured(limit = DISCOVERY_SECTION_SIZE) {
    const rows = await this.prisma.product.findMany({ where: { ...VIEWABLE, featured: true }, orderBy: NEWEST_FIRST, take: limit, select: { id: true } });
    return this.orderedCards(rows.map((r) => r.id));
  }

  async topRated(limit = DISCOVERY_SECTION_SIZE, categoryId?: string) {
    const ids = await this.idsByRating(limit, {
      ratingCount: { gte: TOP_RATED_MIN_RATINGS },
      ...(categoryId ? { categoryId } : {}),
    });
    return this.orderedCards(ids);
  }

  /**
   * Popular by real sales (units sold on AUTHORIZED/SETTLING/SETTLED orders), with a
   * deterministic cold-start fallback (top-rated → featured → newest) so the section
   * is never empty on a fresh catalog.
   */
  async popular(limit = DISCOVERY_SECTION_SIZE) {
    const sold = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT oi."productId" AS id, SUM(oi.quantity)::bigint AS sold
      FROM order_items oi
      JOIN vendor_orders vo ON vo.id = oi."vendorOrderId"
      JOIN orders o ON o.id = vo."orderId"
      JOIN payments p ON p."orderId" = o.id
      WHERE oi."productId" IS NOT NULL AND p.status IN ('AUTHORIZED','SETTLING','SETTLED')
      GROUP BY oi."productId"
      ORDER BY sold DESC
      LIMIT ${limit}`;
    const ordered = await this.orderedCards(sold.map((r) => r.id));
    if (ordered.length >= limit) return ordered;
    // Fill the remainder with rating-ranked products not already included.
    const have = new Set(ordered.map((c) => c.id));
    const fillIds = (await this.idsByRating(limit * 2)).filter((id) => !have.has(id));
    const fill = await this.orderedCards(fillIds);
    return [...ordered, ...fill].slice(0, limit);
  }

  async topCategories(limit = TOP_CATEGORIES_SIZE) {
    const grouped = await this.prisma.product.groupBy({
      by: ['categoryId'],
      where: VIEWABLE,
      _count: { _all: true },
      orderBy: { _count: { categoryId: 'desc' } },
      take: limit,
    });
    const cats = await this.prisma.category.findMany({
      where: { id: { in: grouped.map((g) => g.categoryId) }, isVisible: true },
      select: { id: true, name: true, slug: true, iconName: true },
    });
    const countById = new Map(grouped.map((g) => [g.categoryId, g._count._all]));
    return cats
      .map((c) => ({ ...c, productCount: countById.get(c.id) ?? 0 }))
      .sort((a, b) => b.productCount - a.productCount);
  }

  /** The aggregated discovery/homepage bundle. */
  async homepage() {
    const [featured, topRated, newArrivals, popular, categories] = await Promise.all([
      this.featured(),
      this.topRated(),
      this.newArrivals(),
      this.popular(),
      this.topCategories(),
    ]);
    return { featured, topRated, newArrivals, popular, categories };
  }

  // ===========================================================================
  // Product-detail cross-sell
  // ===========================================================================
  async relatedBySlug(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { slug, ...VIEWABLE },
      select: { id: true, categoryId: true, vendorProfileId: true },
    });
    if (!product) throw new NotFoundException('Product not found.');
    return this.related(product.id, product.categoryId, product.vendorProfileId);
  }

  private async related(productId: string, categoryId: string, vendorProfileId: string) {
    // Same category first (rating-weighted), then fill from the same vendor.
    const sameCategory = await this.prisma.product.findMany({
      where: { ...VIEWABLE, categoryId, id: { not: productId } },
      orderBy: [{ ratingCount: 'desc' }, { featured: 'desc' }, { createdAt: 'desc' }],
      take: RELATED_SIZE,
      select: { id: true },
    });
    let ids = sameCategory.map((r) => r.id);
    if (ids.length < RELATED_SIZE) {
      const have = new Set([productId, ...ids]);
      const fromVendor = await this.prisma.product.findMany({
        where: { ...VIEWABLE, vendorProfileId, id: { notIn: [...have] } },
        orderBy: [{ ratingCount: 'desc' }, { createdAt: 'desc' }],
        take: RELATED_SIZE - ids.length,
        select: { id: true },
      });
      ids = [...ids, ...fromVendor.map((r) => r.id)];
    }
    const [related, moreFromVendor] = await Promise.all([
      this.orderedCards(ids),
      this.moreFromVendor(vendorProfileId, productId),
    ]);
    return { related, moreFromVendor };
  }

  async moreFromVendor(vendorProfileId: string, excludeProductId?: string, limit = RELATED_SIZE) {
    const rows = await this.prisma.product.findMany({
      where: { ...VIEWABLE, vendorProfileId, ...(excludeProductId ? { id: { not: excludeProductId } } : {}) },
      orderBy: [{ featured: 'desc' }, { ratingCount: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      select: { id: true },
    });
    return this.orderedCards(rows.map((r) => r.id));
  }

  // ===========================================================================
  // Personalized "for you" (own signals only)
  // ===========================================================================
  async forYou(userId: string, limit = FOR_YOU_SIZE) {
    // Signals: categories of products the user recently viewed or saved.
    const [viewed, saved, purchased] = await Promise.all([
      this.prisma.recentlyViewedProduct.findMany({ where: { userId }, orderBy: { viewedAt: 'desc' }, take: 50, select: { productId: true, product: { select: { categoryId: true } } } }),
      this.prisma.savedProduct.findMany({ where: { userId }, select: { productId: true, product: { select: { categoryId: true } } } }),
      this.prisma.orderItem.findMany({ where: { vendorOrder: { order: { userId } }, productId: { not: null } }, select: { productId: true } }),
    ]);
    const categoryIds = [...new Set([...viewed, ...saved].map((r) => r.product?.categoryId).filter((c): c is string => !!c))];
    const exclude = new Set<string>([
      ...saved.map((r) => r.productId),
      ...viewed.map((r) => r.productId),
      ...purchased.map((r) => r.productId).filter((p): p is string => !!p),
    ]);

    let items: Awaited<ReturnType<DiscoveryService['orderedCards']>> = [];
    let personalized = false;
    if (categoryIds.length) {
      const rows = await this.prisma.product.findMany({
        where: { ...VIEWABLE, categoryId: { in: categoryIds }, id: { notIn: [...exclude] } },
        orderBy: [{ ratingCount: 'desc' }, { ratingAverage: 'desc' }, { featured: 'desc' }, { createdAt: 'desc' }],
        take: limit,
        select: { id: true },
      });
      items = await this.orderedCards(rows.map((r) => r.id));
      personalized = items.length > 0;
    }
    // Cold-start / thin-result fallback: popular products the user hasn't engaged with.
    if (items.length < limit) {
      const have = new Set(items.map((c) => c.id));
      const fallback = (await this.popular(limit * 2)).filter((c) => !have.has(c.id) && !exclude.has(c.id));
      items = [...items, ...fallback].slice(0, limit);
    }
    return { personalized, items };
  }

  // ===========================================================================
  // Search typeahead suggestions
  // ===========================================================================
  async suggest(qRaw: string) {
    const q = (qRaw ?? '').trim();
    if (q.length < SUGGEST_MIN_CHARS) return { products: [], categories: [], vendors: [] };
    const contains = { contains: q, mode: 'insensitive' as const };
    const [products, categories, vendors] = await Promise.all([
      this.prisma.product.findMany({
        where: { ...VIEWABLE, OR: [{ title: contains }, { brand: contains }] },
        orderBy: [{ ratingCount: 'desc' }, { featured: 'desc' }],
        take: SUGGEST_SIZE,
        select: { title: true, slug: true },
      }),
      this.prisma.category.findMany({ where: { isVisible: true, name: contains }, orderBy: { sortOrder: 'asc' }, take: SUGGEST_SIZE, select: { name: true, slug: true } }),
      this.prisma.vendorProfile.findMany({ where: { approvalStatus: 'APPROVED', businessName: contains }, orderBy: { businessName: 'asc' }, take: SUGGEST_SIZE, select: { businessName: true, slug: true } }),
    ]);
    return { products, categories, vendors };
  }
}
