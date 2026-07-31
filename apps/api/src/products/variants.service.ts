import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateOptionInput, CreateVariantInput, UpdateVariantInput } from '@bmpl/validation';
import { slugify } from '@bmpl/shared';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from './inventory.service';
import { OwnershipService } from './ownership.service';

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

  async deleteValue(userId: string, productId: string, valueId: string) {
    await this.ownership.ownedProduct(userId, productId);
    await this.assertNoVariants(productId, 'options');
    const value = await this.prisma.productOptionValue.findUnique({
      where: { id: valueId },
      include: { option: true },
    });
    if (!value || value.option.productId !== productId) throw new NotFoundException('Value not found.');
    await this.prisma.productOptionValue.delete({ where: { id: valueId } });
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

    // Reject a duplicate combination.
    const existing = await this.prisma.productVariant.findMany({
      where: { productId },
      include: { optionValues: true },
    });
    const target = new Set(dto.optionValueIds);
    for (const v of existing) {
      const set = new Set(v.optionValues.map((ov) => ov.productOptionValueId));
      if (set.size === target.size && [...target].every((id) => set.has(id))) {
        throw new ConflictException('A variant with this combination already exists.');
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
    await this.prisma.productVariant.delete({ where: { id: variantId } }); // cascades links + inventory
    return this.buildManageView(productId);
  }

  // ---- Public view (used by ProductsService.publicDetail) ----

  async publicView(productId: string) {
    const options = await this.prisma.productOption.findMany({
      where: { productId },
      orderBy: { position: 'asc' },
      include: { values: { orderBy: { position: 'asc' } } },
    });
    const variants = await this.prisma.productVariant.findMany({
      where: { productId, isActive: true },
      orderBy: { position: 'asc' },
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
    const options = await this.prisma.productOption.findMany({
      where: { productId },
      orderBy: { position: 'asc' },
      include: { values: { orderBy: { position: 'asc' } } },
    });
    const variants = await this.prisma.productVariant.findMany({
      where: { productId },
      orderBy: { position: 'asc' },
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
        sku: v.sku,
        barcode: v.barcode,
        priceMinor: v.priceMinor == null ? null : Number(v.priceMinor),
        salePriceMinor: v.salePriceMinor == null ? null : Number(v.salePriceMinor),
        isActive: v.isActive,
        optionValueIds: v.optionValues.map((ov) => ov.productOptionValueId),
        quantity: v.inventory?.quantity ?? 0,
      })),
    };
  }

  private async assertNoVariants(productId: string, what: string) {
    const count = await this.prisma.productVariant.count({ where: { productId } });
    if (count > 0) throw new ConflictException(`Delete the variants before changing ${what}.`);
  }
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
