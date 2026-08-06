import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { resolveVariantTitle } from '@bmpl/shared';
import type { AddCartItemInput, UpdateCartItemInput } from '@bmpl/validation';
import type { Inventory, Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../products/inventory.service';
import { ProductImagesService } from '../products/product-images.service';
import { effectiveUnitPrice } from '../products/pricing.util';

/** A blocking or informational condition on a cart line, surfaced to the UI. */
export type CartIssue =
  | 'PRODUCT_UNAVAILABLE' // product not PUBLISHED (draft/suspended/archived)
  | 'VENDOR_INACTIVE' // owning storefront is not APPROVED
  | 'VARIANT_REQUIRED' // product has variants but the line has none
  | 'VARIANT_UNAVAILABLE' // variant missing / not this product's / disabled
  | 'OUT_OF_STOCK' // no units available and no backorder/unlimited
  | 'INSUFFICIENT_STOCK'; // fewer units available than the requested quantity

const money = (v: bigint) => Number(v);

/** The product/variant a line points at, resolved and confirmed purchasable. */
interface Purchasable {
  productId: string;
  variantId: string | null;
  vendorProfileId: string;
  unitPriceMinor: bigint;
}

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly images: ProductImagesService,
  ) {}

  // ===========================================================================
  // Commands (customer, self-scoped)
  // ===========================================================================

  /** The caller's active cart, fully evaluated (prices + availability re-checked). */
  async getActive(userId: string) {
    const cart = await this.ensureCart(userId);
    return this.buildView(cart.id);
  }

  /** Add an item (or merge onto the existing identical line). */
  async addItem(userId: string, dto: AddCartItemInput) {
    const cart = await this.ensureCart(userId);
    const variantId = dto.variantId ?? null;
    const target = await this.resolvePurchasable(dto.productId, variantId);

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.cartItem.findFirst({
        where: { cartId: cart.id, productId: target.productId, variantId },
      });
      const nextQty = (existing?.quantity ?? 0) + dto.quantity;
      await this.assertStock(target, nextQty);
      if (existing) {
        await tx.cartItem.update({
          where: { id: existing.id },
          data: { quantity: nextQty, unitPriceMinorSnapshot: target.unitPriceMinor },
        });
      } else {
        await tx.cartItem.create({
          data: {
            cartId: cart.id,
            productId: target.productId,
            variantId,
            vendorProfileId: target.vendorProfileId,
            quantity: dto.quantity,
            unitPriceMinorSnapshot: target.unitPriceMinor,
          },
        });
      }
      await tx.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } });
    });

    return this.buildView(cart.id);
  }

  /** Set a line's quantity (must be ≥ 1; use remove to delete). */
  async updateItem(userId: string, itemId: string, dto: UpdateCartItemInput) {
    const cart = await this.ensureCart(userId);
    const item = await this.ownedItem(cart.id, itemId);
    const target = await this.resolvePurchasable(item.productId, item.variantId);
    await this.assertStock(target, dto.quantity);
    await this.prisma.cartItem.update({
      where: { id: item.id },
      data: { quantity: dto.quantity, unitPriceMinorSnapshot: target.unitPriceMinor },
    });
    return this.buildView(cart.id);
  }

  /** Remove a single line. */
  async removeItem(userId: string, itemId: string) {
    const cart = await this.ensureCart(userId);
    await this.ownedItem(cart.id, itemId);
    await this.prisma.cartItem.delete({ where: { id: itemId } });
    return this.buildView(cart.id);
  }

  /**
   * Move a cart line to the wishlist as ONE safe server-side operation: the EXACT
   * variant (productId + variantId) is saved first, and the cart line is removed only
   * after that succeeds — both inside a transaction, so a failure leaves the line in
   * the cart (never in neither place). An already-wishlisted variant is not duplicated;
   * the line is still removed. The parent product is never substituted for the variant.
   */
  async moveToWishlist(userId: string, itemId: string) {
    const cart = await this.ensureCart(userId);
    const item = await this.ownedItem(cart.id, itemId); // throws NotFound if not the caller's line
    let alreadySaved = false;
    await this.prisma.$transaction(async (tx) => {
      // skipDuplicates = ON CONFLICT DO NOTHING: an already-wishlisted variant is not
      // duplicated and — crucially — does NOT raise a constraint error that would abort
      // the transaction (which would then block the delete). count===0 ⇒ it was already saved.
      const res = await tx.savedProduct.createMany({
        data: [{ userId, productId: item.productId, variantId: item.variantId ?? null }],
        skipDuplicates: true,
      });
      alreadySaved = res.count === 0;
      // Remove the cart line only after the wishlist entry is guaranteed to exist.
      await tx.cartItem.delete({ where: { id: item.id } });
      await tx.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } });
    });
    return { ...(await this.buildView(cart.id)), movedToWishlist: true, alreadySaved, productId: item.productId, variantId: item.variantId ?? null };
  }

  /** Empty the cart (keeps the cart row itself). */
  async clear(userId: string) {
    const cart = await this.ensureCart(userId);
    await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    return this.buildView(cart.id);
  }

  // ===========================================================================
  // Validation used by add/update (throws — the mutation is rejected)
  // ===========================================================================

  /**
   * Resolve a (product, variant) pair to a purchasable target, rejecting an
   * unpublished product, an inactive storefront, a missing/required/disabled
   * variant. Does NOT check quantity — see assertStock.
   */
  private async resolvePurchasable(productId: string, variantId: string | null): Promise<Purchasable> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        vendorProfile: { select: { id: true, approvalStatus: true } },
        variants: { where: { isActive: true }, select: { id: true } },
      },
    });
    if (!product) throw new NotFoundException('Product not found.');
    if (product.status !== 'PUBLISHED') {
      throw new ConflictException('This product is not available for purchase.');
    }
    if (product.vendorProfile.approvalStatus !== 'APPROVED') {
      throw new ConflictException('This storefront is not currently active.');
    }

    const hasVariants = product.variants.length > 0;
    if (variantId) {
      const variant = await this.prisma.productVariant.findUnique({
        where: { id: variantId },
        select: { id: true, productId: true, isActive: true, priceMinor: true, salePriceMinor: true },
      });
      if (!variant || variant.productId !== productId || !variant.isActive) {
        throw new BadRequestException('The selected option is unavailable.');
      }
      return {
        productId,
        variantId,
        vendorProfileId: product.vendorProfileId,
        unitPriceMinor: effectiveUnitPrice(product, variant),
      };
    }

    if (hasVariants) {
      throw new BadRequestException('Select an option before adding this product.');
    }
    return {
      productId,
      variantId: null,
      vendorProfileId: product.vendorProfileId,
      unitPriceMinor: effectiveUnitPrice(product),
    };
  }

  /** Enforce current availability for the requested quantity (respects unlimited/backorders). */
  private async assertStock(target: Purchasable, quantity: number) {
    const inv = await this.targetInventory(target.productId, target.variantId);
    if (!inv) return; // untracked inventory = treated as available (marketplace convention)
    const a = this.inventory.availability(inv);
    if (a.unlimited || a.allowBackorders) return;
    if (a.available !== null && a.available < quantity) {
      throw new ConflictException(
        a.available <= 0 ? 'This item is out of stock.' : `Only ${a.available} in stock.`,
      );
    }
  }

  // ===========================================================================
  // View builder (non-throwing — annotates each line with issues)
  // ===========================================================================

  private async buildView(cartId: string) {
    const cart = await this.prisma.cart.findUniqueOrThrow({ where: { id: cartId } });
    const items = await this.prisma.cartItem.findMany({
      where: { cartId },
      orderBy: { createdAt: 'asc' },
      include: {
        product: {
          select: {
            title: true,
            slug: true,
            status: true,
            priceMinor: true,
            salePriceMinor: true,
            currency: true,
            vendorProfile: {
              select: { id: true, slug: true, businessName: true, approvalStatus: true, storeStatus: true },
            },
          },
        },
        variant: {
          select: {
            id: true,
            sku: true,
            isActive: true,
            productId: true,
            displayName: true,
            priceMinor: true,
            salePriceMinor: true,
            inventory: true,
            optionValues: {
              select: {
                optionValue: { select: { value: true, option: { select: { name: true, position: true } } } },
              },
            },
          },
        },
      },
    });

    const productIds = [...new Set(items.map((i) => i.productId))];
    const variantIds = [...new Set(items.map((i) => i.variantId).filter((v): v is string => !!v))];
    const [primary, variantPrimary, productInvMap, variantProducts] = await Promise.all([
      this.images.primaryUrls(productIds),
      this.images.variantPrimaryUrls(variantIds),
      this.productLevelInventory(productIds),
      this.activeVariantProductIds(productIds),
    ]);

    const evaluated = items.map((item) => {
      const p = item.product;
      const v = item.variant;
      const issues: CartIssue[] = [];

      if (p.status !== 'PUBLISHED') issues.push('PRODUCT_UNAVAILABLE');
      if (p.vendorProfile.approvalStatus !== 'APPROVED') issues.push('VENDOR_INACTIVE');
      if (!item.variantId && variantProducts.has(item.productId)) issues.push('VARIANT_REQUIRED');
      if (item.variantId && (!v || !v.isActive || v.productId !== item.productId)) {
        issues.push('VARIANT_UNAVAILABLE');
      }

      const unitPriceMinor = effectiveUnitPrice(p, v);
      const inv = item.variantId ? v?.inventory ?? null : productInvMap.get(item.productId) ?? null;
      const a = inv ? this.inventory.availability(inv) : null;
      const available = a ? a.available : null; // null = unlimited / untracked
      const inStock = a ? a.inStock : true;
      if (a && !a.unlimited && !a.allowBackorders && available !== null) {
        if (available <= 0) issues.push('OUT_OF_STOCK');
        else if (available < item.quantity) issues.push('INSUFFICIENT_STOCK');
      }

      const priceChanged = money(item.unitPriceMinorSnapshot) !== money(unitPriceMinor);
      const purchasable = issues.length === 0;
      // Structured selected option VALUES (ordered) — clients format the display from
      // these (never by splitting the combined label). `variantLabel` is the legacy
      // slash join, retained for back-compat.
      const sortedOptions = v
        ? v.optionValues
            .map((ov) => ov.optionValue)
            .sort((x, y) => x.option.position - y.option.position)
        : [];
      const optionValues = sortedOptions.map((ov) => ov.value);
      // Labeled option pairs (e.g. { name: "Size", value: "Small" }) for the stacked
      // checkout summary; ordered by option position.
      const options = sortedOptions.map((ov) => ({ name: ov.option.name, value: ov.value }));
      const variantLabel = optionValues.length ? optionValues.join(' / ') : null;
      // Variant-specific marketplace title (displayName → option label → product title).
      const variantTitle = v ? resolveVariantTitle(v.displayName, variantLabel, p.title) : null;
      // Prefer the purchased variant's own image; fall back to the product primary.
      const imageUrl = (item.variantId ? variantPrimary.get(item.variantId) : null) ?? primary.get(item.productId) ?? null;

      return {
        id: item.id,
        productId: item.productId,
        variantId: item.variantId,
        title: p.title,
        slug: p.slug,
        variantLabel,
        variantTitle,
        displayName: v?.displayName ?? null,
        optionValues,
        options,
        sku: v?.sku ?? null,
        imageUrl,
        currency: p.currency,
        quantity: item.quantity,
        unitPriceMinor: money(unitPriceMinor),
        unitPriceMinorSnapshot: money(item.unitPriceMinorSnapshot),
        priceChanged,
        lineSubtotalMinor: money(unitPriceMinor) * item.quantity,
        available,
        inStock,
        issues,
        purchasable,
        vendor: {
          vendorProfileId: p.vendorProfile.id,
          slug: p.vendorProfile.slug,
          businessName: p.vendorProfile.businessName,
          storeStatus: p.vendorProfile.storeStatus,
        },
      };
    });

    // Group by vendor for the future per-vendor order split.
    const groups = new Map<string, (typeof evaluated)[number][]>();
    for (const line of evaluated) {
      const list = groups.get(line.vendor.vendorProfileId) ?? [];
      list.push(line);
      groups.set(line.vendor.vendorProfileId, list);
    }
    const vendors = [...groups.values()].map((lines) => {
      const first = lines[0]!;
      const subtotalMinor = lines.reduce((s, l) => s + (l.purchasable ? l.lineSubtotalMinor : 0), 0);
      const itemCount = lines.reduce((s, l) => s + l.quantity, 0);
      return {
        vendorProfileId: first.vendor.vendorProfileId,
        slug: first.vendor.slug,
        businessName: first.vendor.businessName,
        storeStatus: first.vendor.storeStatus,
        subtotalMinor,
        itemCount,
        items: lines.map(({ vendor: _vendor, ...rest }) => rest),
      };
    });

    const subtotalMinor = vendors.reduce((s, g) => s + g.subtotalMinor, 0);
    const itemCount = evaluated.reduce((s, l) => s + l.quantity, 0);
    return {
      id: cart.id,
      currency: cart.currency,
      itemCount,
      distinctItemCount: evaluated.length,
      subtotalMinor,
      hasPriceChanges: evaluated.some((l) => l.priceChanged),
      hasUnavailableItems: evaluated.some((l) => !l.purchasable),
      vendors,
      updatedAt: cart.updatedAt,
    };
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private async ensureCart(userId: string) {
    return this.prisma.cart.upsert({ where: { userId }, update: {}, create: { userId } });
  }

  private async ownedItem(cartId: string, itemId: string) {
    const item = await this.prisma.cartItem.findUnique({ where: { id: itemId } });
    if (!item || item.cartId !== cartId) throw new NotFoundException('Cart item not found.');
    return item;
  }

  private async targetInventory(productId: string, variantId: string | null): Promise<Inventory | null> {
    if (variantId) return this.prisma.inventory.findFirst({ where: { productId, variantId } });
    return this.prisma.inventory.findFirst({ where: { productId, variantId: null } });
  }

  /** Product-level inventory rows (variantId null) keyed by productId. */
  private async productLevelInventory(productIds: string[]): Promise<Map<string, Inventory>> {
    const out = new Map<string, Inventory>();
    if (!productIds.length) return out;
    const rows = await this.prisma.inventory.findMany({
      where: { productId: { in: productIds }, variantId: null },
    });
    for (const r of rows) out.set(r.productId, r);
    return out;
  }

  /** Products (of the given set) that have at least one active variant. */
  private async activeVariantProductIds(productIds: string[]): Promise<Set<string>> {
    if (!productIds.length) return new Set();
    const rows = await this.prisma.productVariant.findMany({
      where: { productId: { in: productIds }, isActive: true },
      select: { productId: true },
    });
    return new Set(rows.map((r) => r.productId));
  }
}
