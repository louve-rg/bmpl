import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * "Notify me when back in stock" subscriptions (usability). A customer subscribes to
 * an EXACT product or variant; duplicates are prevented by a unique index. On restock
 * (inventory crossing zero → in stock, wired from InventoryService.adjust) every
 * subscriber is notified once and the subscription is removed (one-shot).
 */
@Injectable()
export class BackInStockService {
  private readonly logger = new Logger(BackInStockService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Subscribe the caller to a back-in-stock alert. Idempotent (no duplicate rows). */
  async subscribe(userId: string, productId: string, variantId: string | null) {
    const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
    if (!product) throw new NotFoundException('Product not found.');
    if (variantId) {
      const v = await this.prisma.productVariant.findFirst({ where: { id: variantId, productId }, select: { id: true } });
      if (!v) throw new BadRequestException('That variant does not belong to this product.');
    }
    // skipDuplicates makes a repeat subscribe a no-op (unique per user+variant, or
    // user+product for a product-level entry via the partial index).
    await this.prisma.backInStockSubscription.createMany({
      data: [{ userId, productId, variantId: variantId ?? null }],
      skipDuplicates: true,
    });
    return { subscribed: true, productId, variantId: variantId ?? null };
  }

  /** Cancel the caller's subscription for the exact product/variant. */
  async unsubscribe(userId: string, productId: string, variantId: string | null) {
    await this.prisma.backInStockSubscription.deleteMany({
      where: { userId, productId, variantId: variantId ?? null },
    });
    return { subscribed: false, productId, variantId: variantId ?? null };
  }

  /** The caller's active subscriptions (exact product+variant keys) for UI state. */
  async subscribedIds(userId: string) {
    const rows = await this.prisma.backInStockSubscription.findMany({
      where: { userId },
      select: { productId: true, variantId: true },
    });
    return { subscriptions: rows.map((r) => ({ productId: r.productId, variantId: r.variantId })) };
  }

  /**
   * Fire back-in-stock notifications for an exact product/variant that just returned to
   * stock, then remove those subscriptions (one-shot). Best-effort: never throws into
   * the inventory transaction path.
   */
  async notifyRestock(productId: string, variantId: string | null): Promise<void> {
    try {
      const subs = await this.prisma.backInStockSubscription.findMany({
        where: { productId, variantId: variantId ?? null },
        select: { id: true, userId: true },
      });
      if (subs.length === 0) return;
      const product = await this.prisma.product.findUnique({
        where: { id: productId },
        select: { title: true, slug: true },
      });
      await this.notifications.notifyUsers(
        subs.map((s) => s.userId),
        {
          type: 'MARKETPLACE',
          category: 'ORDER',
          event: 'BACK_IN_STOCK',
          title: 'Back in stock',
          body: `${product?.title ?? 'An item you saved'} is back in stock — grab it before it's gone.`,
          data: { productId, variantId: variantId ?? null, slug: product?.slug ?? null },
        },
      );
      await this.prisma.backInStockSubscription.deleteMany({ where: { id: { in: subs.map((s) => s.id) } } });
    } catch (err) {
      this.logger.warn(`Back-in-stock notify failed for product ${productId}: ${String(err)}`);
    }
  }
}
