import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateOptionInput, CreateVariantInput, GenerateVariantsInput, UpdateVariantInput } from '@bmpl/validation';
import { resolveVariantTitle, slugify } from '@bmpl/shared';
import type { Prisma } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from './inventory.service';
import { OwnershipService } from './ownership.service';

/** An option-value row joined enough to build a variant's label. */
type OptionWithValues = Prisma.ProductOptionGetPayload<{ include: { values: true } }>;

@Injectable()
export class VariantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly ownership: OwnershipService,
  ) {}

  // ---- Options & values ----

  async listForOwner(userId: string, productId: string) {
    await this.ownership.ownedProduct(userId, productId);
    return this.buildManageView(productId);
  }

  async createOption(userId: string, productId: string, dto: CreateOptionInput) {
    await this.ownership.ownedProduct(userId, productId);
    const exists = await this.prisma.productOption.findFirst({ where: { productId, name: dto.name } });
    if (exists) throw new ConflictException(`Option "${dto.name}" already exists.`);
    const count = await this.prisma.productOption.count({ where: { productId } });
    await this.prisma.productOption.create({
      data: {
        productId,
        name: dto.name,
        position: count,
        values: dto.values?.length
          ? { create: dedupe(dto.values).map((value, i) => ({ value, position: i })) }
          : undefined,
      },
    });
    return this.buildManageView(productId);
  }

  async addValue(userId: string, productId: string, optionId: string, value: string) {
    await this.ownership.ownedProduct(userId, productId);
    const option = await this.prisma.productOption.findUnique({ where: { id: optionId } });
    if (!option || option.productId !== productId) throw new NotFoundException('Option not found.');
    const dup = await this.prisma.productOptionValue.findFirst({ where: { productOptionId: optionId, value } });
    if (dup) throw new ConflictException(`Value "${value}" already exists.`);
    const count = await this.prisma.productOptionValue.count({ where: { productOptionId: optionId } });
    await this.prisma.productOptionValue.create({ data: { productOptionId: optionId, value, position: count } });
    return this.buildManageView(productId);
  }

  async deleteOption(userId: string, productId: string, optionId: string) {
    await this.ownership.ownedProduct(userId, productId);
    await this.assertNoVariants(productId, 'options');
    const option = await this.prisma.productOption.findUnique({ where: { id: optionId } });
    if (!option || option.productId !== productId) throw new NotFoundException('Option not found.');
    await this.prisma.productOption.delete({ where: { id: optionId } });
    return this.buildManageView(productId);
  }

  /**
   * Remove an option value. Variants using it are removed too (their order-item
   * references are preserved via SetNull). When those variants still carry
   * inventory or order history, `force` is required (the UI confirms first).
   */
  async deleteValue(userId: string, productId: string, valueId: string, force = false) {
    await this.ownership.ownedProduct(userId, productId);
    const value = await this.prisma.productOptionValue.findUnique({ where: { id: valueId }, include: { option: true } });
    if (!value || value.option.productId !== productId) throw new NotFoundException('Value not found.');

    const affected = await this.prisma.productVariant.findMany({
      where: { productId, optionValues: { some: { productOptionValueId: valueId } } },
      include: { inventory: true, _count: { select: { orderItems: true } } },
    });
    if (affected.length > 0 && !force) {
      const withData = affected.filter((v) => (v.inventory?.quantity ?? 0) > 0 || v._count.orderItems > 0);
      if (withData.length > 0) {
        throw new ConflictException(`${affected.length} variant(s) use this value${withData.length ? ' and some have inventory or orders' : ''}. Confirm to remove them.`);
      }
    }
    await this.prisma.$transaction([
      // Remove the affected variants' images first so they don't orphan into the
      // general gallery (ProductImage→variant is SetNull).
      this.prisma.productImage.deleteMany({ where: { productId, variantId: { in: affected.map((v) => v.id) } } }),
      this.prisma.productVariant.deleteMany({ where: { productId, optionValues: { some: { productOptionValueId: valueId } } } }),
      this.prisma.productOptionValue.delete({ where: { id: valueId } }),
    ]);
    return this.buildManageView(productId);
  }

  // ---- Variants ----

  async createVariant(userId: string, productId: string, dto: CreateVariantInput) {
    await this.ownership.ownedProduct(userId, productId);

    const options = await this.prisma.productOption.findMany({
      where: { productId },
      include: { values: true },
    });
    if (options.length === 0) throw new BadRequestException('Add at least one option before creating variants.');

    // Every chosen value must belong to this product, with exactly one per option.
    const valueToOption = new Map<string, string>();
    for (const o of options) for (const v of o.values) valueToOption.set(v.id, o.id);
    const chosenOptions = new Set<string>();
    for (const vid of dto.optionValueIds) {
      const optId = valueToOption.get(vid);
      if (!optId) throw new BadRequestException('An option value does not belong to this product.');
      if (chosenOptions.has(optId)) throw new BadRequestException('Pick only one value per option.');
      chosenOptions.add(optId);
    }
    if (chosenOptions.size !== options.length) {
      throw new BadRequestException('A variant must choose one value for every option.');
    }

    // Reject a duplicate combination — name the clashing combination for clarity.
    const existing = await this.prisma.productVariant.findMany({
      where: { productId },
      include: { optionValues: true },
    });
    const target = new Set(dto.optionValueIds);
    for (const v of existing) {
      const set = new Set(v.optionValues.map((ov) => ov.productOptionValueId));
      if (set.size === target.size && [...target].every((id) => set.has(id))) {
        throw new ConflictException(`A variant for "${this.labelFor(dto.optionValueIds, options)}" already exists. Add a new option value first to create a different variant.`);
      }
    }
    if (dto.sku) {
      const skuDup = await this.prisma.productVariant.findFirst({ where: { productId, sku: dto.sku } });
      if (skuDup) throw new ConflictException(`Variant SKU "${dto.sku}" is already used.`);
    }

    await this.prisma.$transaction(async (tx) => {
      const position = await tx.productVariant.count({ where: { productId } });
      const variant = await tx.productVariant.create({
        data: {
          productId,
          displayName: dto.displayName?.trim() || null,
          sku: dto.sku ?? null,
          barcode: dto.barcode ?? null,
          priceMinor: dto.priceMinor == null ? null : BigInt(dto.priceMinor),
          salePriceMinor: dto.salePriceMinor == null ? null : BigInt(dto.salePriceMinor),
          position,
          optionValues: { create: dto.optionValueIds.map((id) => ({ productOptionValueId: id })) },
        },
      });
      await this.inventory.ensureVariantInventory(productId, variant.id, dto.quantity, tx);
    });
    return this.buildManageView(productId);
  }

  /**
   * Generate every MISSING option-value combination as a variant, in one
   * transaction. Existing variants (and their ids, images, prices, SKUs, inventory,
   * display names, order references) are never touched — only absent combinations
   * are created. Idempotent: a second call with no new values is a no-op.
   */
  async generateVariants(userId: string, productId: string, dto: GenerateVariantsInput) {
    await this.ownership.ownedProduct(userId, productId);
    const options = await this.prisma.productOption.findMany({ where: { productId }, orderBy: { position: 'asc' }, include: { values: { orderBy: { position: 'asc' } } } });
    if (options.length === 0 || options.some((o) => o.values.length === 0)) {
      throw new BadRequestException('Add at least one value to every option before generating variants.');
    }
    // Cartesian product of value ids, one per option.
    let combos: string[][] = [[]];
    for (const o of options) combos = combos.flatMap((c) => o.values.map((v) => [...c, v.id]));

    const existing = await this.prisma.productVariant.findMany({ where: { productId }, include: { optionValues: true } });
    const existingKeys = new Set(existing.map((v) => keyOf(v.optionValues.map((ov) => ov.productOptionValueId))));
    const missing = combos.filter((c) => !existingKeys.has(keyOf(c)));

    if (missing.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        let position = await tx.productVariant.count({ where: { productId } });
        for (const combo of missing) {
          const variant = await tx.productVariant.create({
            data: { productId, position: position++, optionValues: { create: combo.map((id) => ({ productOptionValueId: id })) } },
          });
          await this.inventory.ensureVariantInventory(productId, variant.id, dto.quantity, tx);
        }
      });
    }
    return { ...(await this.buildManageView(productId)), created: missing.length };
  }

  /** Rename an option value's label (does NOT recreate or corrupt variants). */
  async renameValue(userId: string, productId: string, valueId: string, value: string) {
    await this.ownership.ownedProduct(userId, productId);
    const row = await this.prisma.productOptionValue.findUnique({ where: { id: valueId }, include: { option: true } });
    if (!row || row.option.productId !== productId) throw new NotFoundException('Value not found.');
    const dup = await this.prisma.productOptionValue.findFirst({ where: { productOptionId: row.productOptionId, value, id: { not: valueId } } });
    if (dup) throw new ConflictException(`Value "${value}" already exists.`);
    await this.prisma.productOptionValue.update({ where: { id: valueId }, data: { value } });
    return this.buildManageView(productId);
  }

  async updateVariant(userId: string, productId: string, variantId: string, dto: UpdateVariantInput) {
    await this.ownership.ownedProduct(userId, productId);
    const variant = await this.prisma.productVariant.findUnique({ where: { id: variantId } });
    if (!variant || variant.productId !== productId) throw new NotFoundException('Variant not found.');
    if (dto.sku && dto.sku !== variant.sku) {
      const dup = await this.prisma.productVariant.findFirst({ where: { productId, sku: dto.sku } });
      if (dup) throw new ConflictException(`Variant SKU "${dto.sku}" is already used.`);
    }
    await this.prisma.productVariant.update({
      where: { id: variantId },
      data: {
        // Display name is variant-owned marketplace data; '' clears back to the label.
        displayName: dto.displayName === undefined ? undefined : dto.displayName?.trim() || null,
        sku: dto.sku === undefined ? undefined : dto.sku,
        barcode: dto.barcode === undefined ? undefined : dto.barcode,
        priceMinor: dto.priceMinor === undefined ? undefined : dto.priceMinor === null ? null : BigInt(dto.priceMinor),
        salePriceMinor: dto.salePriceMinor === undefined ? undefined : dto.salePriceMinor === null ? null : BigInt(dto.salePriceMinor),
        isActive: dto.isActive ?? undefined,
      },
    });
    return this.buildManageView(productId);
  }

  async deleteVariant(userId: string, productId: string, variantId: string) {
    await this.ownership.ownedProduct(userId, productId);
    const variant = await this.prisma.productVariant.findUnique({ where: { id: variantId } });
    if (!variant || variant.productId !== productId) throw new NotFoundException('Variant not found.');
    // Delete the variant's images too. The ProductImage→variant FK is SetNull, so
    // WITHOUT this the images would orphan into the general gallery (variantId=null)
    // and keep showing after the variant is gone. Deleting them keeps the public
    // gallery built only from currently-valid records.
    await this.prisma.$transaction([
      this.prisma.productImage.deleteMany({ where: { productId, variantId } }),
      this.prisma.productVariant.delete({ where: { id: variantId } }), // cascades links + inventory
    ]);
    return this.buildManageView(productId);
  }

  // ---- Public view (used by ProductsService.publicDetail) ----

  async publicView(productId: string) {
    const product = await this.prisma.product.findUniqueOrThrow({ where: { id: productId }, select: { title: true } });
    const options = await this.prisma.productOption.findMany({
      where: { productId },
      orderBy: { position: 'asc' },
      include: { values: { orderBy: { position: 'asc' } } },
    });
    // Public variant lineup: newest-created variant first (deterministic id tie-break),
    // and only ACTIVE variants — a deactivated/deleted variant never appears. Image
    // ordering WITHIN a variant is separate (primary first, then vendor position).
    const variants = await this.prisma.productVariant.findMany({
      where: { productId, isActive: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { optionValues: true, inventory: true },
    });
    return {
      options: options.map((o) => ({
        id: o.id,
        name: o.name,
        values: o.values.map((v) => ({ id: v.id, value: v.value })),
      })),
      variants: variants.map((v) => ({
        id: v.id,
        // Resolved marketplace title (displayName → option label → product title)
        // + the raw parts, so any client can apply the precedence itself.
        title: resolveVariantTitle(v.displayName, this.labelForVariant(v.optionValues.map((ov) => ov.productOptionValueId), options), product.title),
        displayName: v.displayName,
        optionLabel: this.labelForVariant(v.optionValues.map((ov) => ov.productOptionValueId), options) || null,
        sku: v.sku,
        priceMinor: v.priceMinor == null ? null : Number(v.priceMinor),
        salePriceMinor: v.salePriceMinor == null ? null : Number(v.salePriceMinor),
        optionValueIds: v.optionValues.map((ov) => ov.productOptionValueId),
        availability: v.inventory
          ? (({ inStock, lowStock, outOfStock, available, unlimited, allowBackorders }) => ({
              inStock,
              lowStock,
              outOfStock,
              available,
              unlimited,
              allowBackorders,
            }))(this.inventory.availability(v.inventory))
          : { inStock: true, lowStock: false, outOfStock: false, available: null, unlimited: false, allowBackorders: false },
      })),
    };
  }

  // ---- shared ----

  private async buildManageView(productId: string) {
    const product = await this.prisma.product.findUniqueOrThrow({ where: { id: productId }, select: { title: true } });
    const options = await this.prisma.productOption.findMany({
      where: { productId },
      orderBy: { position: 'asc' },
      include: { values: { orderBy: { position: 'asc' } } },
    });
    // Newest-first too, so the vendor's Storefront Preview + editor match exactly what
    // customers see on the live marketplace (§ variant order consistency). Includes
    // inactive variants — this is the owner's management view.
    const variants = await this.prisma.productVariant.findMany({
      where: { productId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { optionValues: true, inventory: true },
    });
    return {
      productTitle: product.title,
      options: options.map((o) => ({
        id: o.id,
        name: o.name,
        values: o.values.map((v) => ({ id: v.id, value: v.value })),
      })),
      variants: variants.map((v) => {
        const optionLabel = this.labelForVariant(v.optionValues.map((ov) => ov.productOptionValueId), options) || null;
        return {
          id: v.id,
          title: resolveVariantTitle(v.displayName, optionLabel, product.title),
          displayName: v.displayName,
          optionLabel,
          sku: v.sku,
          barcode: v.barcode,
          priceMinor: v.priceMinor == null ? null : Number(v.priceMinor),
          salePriceMinor: v.salePriceMinor == null ? null : Number(v.salePriceMinor),
          isActive: v.isActive,
          optionValueIds: v.optionValues.map((ov) => ov.productOptionValueId),
          quantity: v.inventory?.quantity ?? 0,
        };
      }),
    };
  }

  /** Option-value label join for a set of value ids, ordered by option position. */
  private labelForVariant(valueIds: string[], options: OptionWithValues[]): string {
    const parts: Array<{ position: number; value: string }> = [];
    for (const o of options) {
      for (const v of o.values) {
        if (valueIds.includes(v.id)) parts.push({ position: o.position, value: v.value });
      }
    }
    return parts.sort((a, b) => a.position - b.position).map((p) => p.value).join(' / ');
  }

  private labelFor(valueIds: string[], options: OptionWithValues[]): string {
    return this.labelForVariant(valueIds, options) || 'this combination';
  }

  private async assertNoVariants(productId: string, what: string) {
    const count = await this.prisma.productVariant.count({ where: { productId } });
    if (count > 0) throw new ConflictException(`Delete the variants before changing ${what}.`);
  }
}

/** Stable key for a variant's set of option-value ids (order-independent). */
function keyOf(valueIds: string[]): string {
  return [...valueIds].sort().join('|');
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const k = slugify(v);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(v);
    }
  }
  return out;
}
