import { Injectable } from '@nestjs/common';
import { RECENTLY_VIEWED_MAX } from '@bmpl/shared';
import { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../products/products.service';

/**
 * Saved Products (Wishlists) & Recently Viewed (M20). Own-account customer
 * convenience only — saving/viewing NEVER reserves stock, moves money, or is
 * exposed to any other user (vendors/admins included). Product cards are resolved
 * through ProductsService so only PUBLISHED products of APPROVED vendors surface;
 * a saved/viewed product that is no longer viewable is returned as `available:false`
 * (the row is kept so it reappears if the product is re-published).
 */
@Injectable()
export class EngagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
  ) {}

  // ===========================================================================
  // Saved products (wishlist)
  // ===========================================================================
  async save(userId: string, productId: string) {
    await this.products.assertViewable(productId); // 404 if not a viewable product
    try {
      await this.prisma.savedProduct.create({ data: { userId, productId } });
    } catch (e) {
      // Already saved → idempotent success.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
    return { saved: true };
  }

  async unsave(userId: string, productId: string) {
    await this.prisma.savedProduct.deleteMany({ where: { userId, productId } });
    return { saved: false };
  }

  async listSaved(userId: string) {
    const rows = await this.prisma.savedProduct.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 200 });
    const cards = await this.products.cardsByIds(rows.map((r) => r.productId));
    return {
      items: rows.map((r) => {
        const product = cards.get(r.productId) ?? null;
        return { productId: r.productId, savedAt: r.createdAt, available: product !== null, product };
      }),
    };
  }

  /** Lightweight set of saved product ids — powers heart-toggle state on listings. */
  async savedIds(userId: string) {
    const rows = await this.prisma.savedProduct.findMany({ where: { userId }, select: { productId: true } });
    return { productIds: rows.map((r) => r.productId) };
  }

  async savedCount(userId: string) {
    return { count: await this.prisma.savedProduct.count({ where: { userId } }) };
  }

  // ===========================================================================
  // Recently viewed
  // ===========================================================================
  async recordView(userId: string, productId: string) {
    await this.products.assertViewable(productId);
    await this.prisma.recentlyViewedProduct.upsert({
      where: { userId_productId: { userId, productId } },
      create: { userId, productId },
      update: { viewedAt: new Date() },
    });
    await this.pruneRecentlyViewed(userId);
    return { ok: true };
  }

  async listRecentlyViewed(userId: string, limit = RECENTLY_VIEWED_MAX) {
    const take = Math.min(Math.max(1, limit), RECENTLY_VIEWED_MAX);
    const rows = await this.prisma.recentlyViewedProduct.findMany({ where: { userId }, orderBy: { viewedAt: 'desc' }, take });
    const cards = await this.products.cardsByIds(rows.map((r) => r.productId));
    return {
      items: rows.map((r) => {
        const product = cards.get(r.productId) ?? null;
        return { productId: r.productId, viewedAt: r.viewedAt, available: product !== null, product };
      }),
    };
  }

  async clearRecentlyViewed(userId: string) {
    await this.prisma.recentlyViewedProduct.deleteMany({ where: { userId } });
    return { ok: true };
  }

  /** Keep only the newest RECENTLY_VIEWED_MAX rows for a user. */
  private async pruneRecentlyViewed(userId: string) {
    const overflow = await this.prisma.recentlyViewedProduct.findMany({
      where: { userId },
      orderBy: { viewedAt: 'desc' },
      skip: RECENTLY_VIEWED_MAX,
      select: { id: true },
    });
    if (overflow.length) await this.prisma.recentlyViewedProduct.deleteMany({ where: { id: { in: overflow.map((r) => r.id) } } });
  }
}
