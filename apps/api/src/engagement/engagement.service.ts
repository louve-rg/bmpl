import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RECENTLY_VIEWED_MAX } from '@bmpl/shared';
import { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../products/products.service';

/** Message shown when a customer hearts a variant product without a concrete variant. */
export const CHOOSE_OPTIONS_MESSAGE = 'Choose your options before adding this item to your Wishlist.';

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
  /**
   * Save the EXACT selected item to the wishlist. For a variant product a concrete
   * `variantId` is required (server-enforced) so the parent is never silently saved;
   * for a no-variant product `variantId` is null. Idempotent per (user, variant) or
   * (user, product) — different variants of one product coexist as separate entries.
   */
  async save(userId: string, productId: string, variantId?: string | null) {
    await this.products.assertViewable(productId); // 404 if the parent isn't viewable
    if (variantId) {
      const v = await this.prisma.productVariant.findFirst({ where: { id: variantId, productId, isActive: true }, select: { id: true } });
      if (!v) throw new NotFoundException('That option is no longer available for this product.');
    } else if ((await this.products.activeVariantCount(productId)) > 0) {
      // A variant product hearted without a concrete variant → prompt, never save the parent.
      throw new BadRequestException(CHOOSE_OPTIONS_MESSAGE);
    }
    try {
      await this.prisma.savedProduct.create({ data: { userId, productId, variantId: variantId ?? null } });
    } catch (e) {
      // Already in the wishlist → idempotent success (no duplicate).
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
    return { saved: true, productId, variantId: variantId ?? null };
  }

  /** Remove the EXACT wishlist entry (a specific variant, or the product-level entry). */
  async unsave(userId: string, productId: string, variantId?: string | null) {
    await this.prisma.savedProduct.deleteMany({ where: { userId, productId, variantId: variantId ?? null } });
    return { saved: false, productId, variantId: variantId ?? null };
  }

  async listSaved(userId: string) {
    const rows = await this.prisma.savedProduct.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 200 });
    const items = await this.buildWishlistItems(rows);
    return { items };
  }

  /**
   * Wishlist entries with the EXACT saved selection resolved: variant title, selected
   * options, variant image/SKU/price/availability (falling back to the parent for
   * no-variant entries). A saved variant that is gone/deactivated stays visible as
   * `available:false` so the customer can still identify what they saved.
   */
  private async buildWishlistItems(rows: Array<{ id: string; productId: string; variantId: string | null; createdAt: Date }>) {
    const productIds = [...new Set(rows.map((r) => r.productId))];
    const cards = await this.products.cardsByIds(productIds); // parent cards (title/slug/vendor/price/image)
    const variantProductIds = [...new Set(rows.filter((r) => r.variantId).map((r) => r.productId))];
    const views = new Map<string, Awaited<ReturnType<ProductsService['publicVariantView']>> | null>();
    await Promise.all(
      variantProductIds.map(async (pid) => {
        try { views.set(pid, await this.products.publicVariantView(pid)); } catch { views.set(pid, null); }
      }),
    );
    const variantIds = rows.map((r) => r.variantId).filter((v): v is string => !!v);
    const variantImages = variantIds.length ? await this.products.variantPrimaryUrls(variantIds) : new Map<string, string | null>();

    return rows.map((r) => {
      const product = cards.get(r.productId) ?? null; // null → parent not viewable
      if (!r.variantId) {
        // Product-level wishlist entry.
        return {
          id: r.id,
          productId: r.productId,
          variantId: null,
          savedAt: r.createdAt,
          available: product !== null,
          product,
          variant: null,
        };
      }
      // Variant entry — resolve the exact variant.
      const view = views.get(r.productId) ?? null;
      const v = view?.variants.find((x) => x.id === r.variantId) ?? null;
      const variant = {
        variantId: r.variantId,
        title: v?.title ?? null, // resolved variant title (displayName → options → product title)
        displayName: v?.displayName ?? null,
        optionLabel: v?.optionLabel ?? null, // "Fragrance: Perfect in Pink · Size: Medium"
        sku: v?.sku ?? null,
        priceMinor: v?.priceMinor ?? product?.priceMinor ?? null,
        salePriceMinor: v?.salePriceMinor ?? null,
        imageUrl: variantImages.get(r.variantId) ?? product?.primaryImageUrl ?? null,
        availability: v?.availability ?? null,
      };
      // Available only when the parent is viewable AND the variant is still active/present.
      const available = product !== null && v !== null;
      return { id: r.id, productId: r.productId, variantId: r.variantId, savedAt: r.createdAt, available, product, variant };
    });
  }

  /** Exact saved-item keys (productId + variantId) — powers per-variant heart state. */
  async savedIds(userId: string) {
    const rows = await this.prisma.savedProduct.findMany({ where: { userId }, select: { productId: true, variantId: true } });
    return {
      // Back-compat: distinct product ids that have ANY saved entry.
      productIds: [...new Set(rows.map((r) => r.productId))],
      // Exact saved selections — the heart is active only for the exact match.
      saved: rows.map((r) => ({ productId: r.productId, variantId: r.variantId })),
    };
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
