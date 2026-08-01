import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  isAllowedProductImageMime,
  MAX_PRODUCT_IMAGE_BYTES,
  STORAGE_PREFIX,
} from '@bmpl/shared';
import type { ProductImageConfirmInput, ProductImageReplaceInput, ProductImageUpdateInput } from '@bmpl/validation';
import type { ProductImage } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { OwnershipService } from './ownership.service';

@Injectable()
export class ProductImagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ownership: OwnershipService,
  ) {}

  /** Presigned PUT to the PUBLIC bucket, namespaced under the owning vendor+product. */
  async presign(userId: string, productId: string, fileName: string, contentType: string) {
    if (!isAllowedProductImageMime(contentType)) {
      throw new BadRequestException('Unsupported image type. Use JPEG, PNG, or WebP.');
    }
    const product = await this.ownership.ownedProduct(userId, productId);
    const key = this.storage.buildKey(
      STORAGE_PREFIX.productImage(product.vendorProfileId, product.id),
      fileName,
    );
    return this.storage.presignUpload(key, contentType, 'public');
  }

  /** Confirm an uploaded image: verify namespace + real MIME/size, then persist. */
  async confirm(userId: string, productId: string, dto: ProductImageConfirmInput) {
    const product = await this.ownership.ownedProduct(userId, productId);
    const prefix = STORAGE_PREFIX.productImage(product.vendorProfileId, product.id);
    this.storage.assertKeyInNamespace(dto.key, prefix);

    const meta = await this.storage.headObject(dto.key, 'public');
    if (!meta) throw new BadRequestException('Uploaded image could not be found in storage.');
    if (!isAllowedProductImageMime(meta.contentType)) {
      throw new BadRequestException('Unsupported image type.');
    }
    if (meta.sizeBytes <= 0 || meta.sizeBytes > MAX_PRODUCT_IMAGE_BYTES) {
      throw new BadRequestException('Image exceeds the maximum allowed size.');
    }
    if (dto.variantId) await this.assertVariantInProduct(productId, dto.variantId);

    await this.prisma.$transaction(async (tx) => {
      const count = await tx.productImage.count({ where: { productId } });
      // The first image within a variant GROUP (or the general group) becomes that
      // group's primary — so every variant gallery has a primary of its own.
      const groupCount = await tx.productImage.count({ where: { productId, variantId: dto.variantId ?? null } });
      await tx.productImage.create({
        data: {
          productId,
          variantId: dto.variantId ?? null,
          storageKey: dto.key,
          mimeType: meta.contentType,
          fileSizeBytes: meta.sizeBytes,
          width: dto.width ?? null,
          height: dto.height ?? null,
          altText: dto.altText ?? null,
          caption: dto.caption ?? null,
          position: count,
          isPrimary: groupCount === 0,
        },
      });
    });
    return this.list(productId);
  }

  /** A variant referenced by an image must belong to the same product. */
  private async assertVariantInProduct(productId: string, variantId: string): Promise<void> {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { productId: true },
    });
    if (!variant || variant.productId !== productId) {
      throw new BadRequestException('That variant does not belong to this product.');
    }
  }

  async listForOwner(userId: string, productId: string) {
    await this.ownership.ownedProduct(userId, productId);
    return this.list(productId);
  }

  async update(userId: string, productId: string, imageId: string, dto: ProductImageUpdateInput) {
    await this.ownership.ownedProduct(userId, productId);
    const image = await this.ownedImage(productId, imageId);
    if (dto.variantId) await this.assertVariantInProduct(productId, dto.variantId);
    const movingGroup = dto.variantId !== undefined && dto.variantId !== image.variantId;

    await this.prisma.$transaction(async (tx) => {
      // When moving an image between variant groups, keep exactly one primary per
      // group: become primary only if the target group has none; and if this image
      // was its old group's primary, promote the next image there.
      let isPrimary: boolean | undefined;
      if (movingGroup) {
        const targetHasPrimary = (await tx.productImage.count({ where: { productId, variantId: dto.variantId ?? null, isPrimary: true } })) > 0;
        isPrimary = !targetHasPrimary;
      }
      await tx.productImage.update({
        where: { id: imageId },
        data: {
          altText: dto.altText === undefined ? undefined : dto.altText,
          caption: dto.caption === undefined ? undefined : dto.caption,
          variantId: dto.variantId === undefined ? undefined : dto.variantId,
          ...(isPrimary === undefined ? {} : { isPrimary }),
        },
      });
      if (movingGroup && image.isPrimary) {
        const next = await tx.productImage.findFirst({ where: { productId, variantId: image.variantId, id: { not: imageId } }, orderBy: { position: 'asc' } });
        if (next) await tx.productImage.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
    });
    return this.list(productId);
  }

  /** Full reorder: `order` must contain exactly the product's image ids. */
  async reorder(userId: string, productId: string, order: string[]) {
    await this.ownership.ownedProduct(userId, productId);
    const images = await this.prisma.productImage.findMany({ where: { productId }, select: { id: true } });
    const ids = new Set(images.map((i) => i.id));
    if (order.length !== ids.size || !order.every((id) => ids.has(id))) {
      throw new BadRequestException('Reorder must list every image exactly once.');
    }
    await this.prisma.$transaction(
      order.map((id, index) =>
        this.prisma.productImage.update({ where: { id }, data: { position: index } }),
      ),
    );
    return this.list(productId);
  }

  /**
   * Set the primary image for its variant GROUP — exactly one primary per
   * (product, variant) group, so each variant gallery has its own primary and the
   * general (variantId = null) gallery has its own. Amazon-style: a variant's
   * gallery resets to this image.
   */
  async setPrimary(userId: string, productId: string, imageId: string) {
    await this.ownership.ownedProduct(userId, productId);
    const image = await this.ownedImage(productId, imageId);
    await this.prisma.$transaction([
      // Clear the current primary only WITHIN the same variant group.
      this.prisma.productImage.updateMany({
        where: { productId, variantId: image.variantId, isPrimary: true },
        data: { isPrimary: false },
      }),
      this.prisma.productImage.update({ where: { id: imageId }, data: { isPrimary: true } }),
    ]);
    return this.list(productId);
  }

  /**
   * Replace the FILE of an existing image in place (M6.1). Preserves the image's
   * variant, gallery position, primary status, alt text, and caption — vendors no
   * longer delete-and-reupload just to swap a photo. The new object is verified
   * (namespace + real MIME/size); the old object is best-effort deleted.
   */
  async replace(userId: string, productId: string, imageId: string, dto: ProductImageReplaceInput) {
    const product = await this.ownership.ownedProduct(userId, productId);
    const image = await this.ownedImage(productId, imageId);
    const prefix = STORAGE_PREFIX.productImage(product.vendorProfileId, product.id);
    this.storage.assertKeyInNamespace(dto.key, prefix);
    if (dto.key === image.storageKey) throw new BadRequestException('The replacement image is the same file.');
    const meta = await this.storage.headObject(dto.key, 'public');
    if (!meta) throw new BadRequestException('Uploaded image could not be found in storage.');
    if (!isAllowedProductImageMime(meta.contentType)) throw new BadRequestException('Unsupported image type.');
    if (meta.sizeBytes <= 0 || meta.sizeBytes > MAX_PRODUCT_IMAGE_BYTES) throw new BadRequestException('Image exceeds the maximum allowed size.');

    const oldKey = image.storageKey;
    await this.prisma.productImage.update({
      where: { id: imageId },
      // variantId / position / isPrimary / altText / caption are intentionally preserved.
      data: { storageKey: dto.key, mimeType: meta.contentType, fileSizeBytes: meta.sizeBytes, width: dto.width ?? null, height: dto.height ?? null },
    });
    await this.storage.deleteObject(oldKey, 'public');
    return this.list(productId);
  }

  async remove(userId: string, productId: string, imageId: string) {
    await this.ownership.ownedProduct(userId, productId);
    const image = await this.ownedImage(productId, imageId);

    await this.prisma.$transaction(async (tx) => {
      await tx.productImage.delete({ where: { id: imageId } });
      // If the primary was removed, promote the lowest-position remaining image.
      if (image.isPrimary) {
        const next = await tx.productImage.findFirst({
          where: { productId },
          orderBy: { position: 'asc' },
        });
        if (next) await tx.productImage.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
    });
    // Best-effort object cleanup (never blocks the row deletion).
    await this.storage.deleteObject(image.storageKey, 'public');
    return this.list(productId);
  }

  /**
   * Set an image as the product's BRAND image (M6.2) — the marketplace listing/card
   * image. At most one per product. A brand image is not variant-scoped and is
   * excluded from the detail gallery, so we also detach it from any variant and
   * clear its gallery-primary flag. Replacing the designation never deletes files.
   */
  async setBrandImage(userId: string, productId: string, imageId: string) {
    await this.ownership.ownedProduct(userId, productId);
    await this.ownedImage(productId, imageId);
    await this.prisma.$transaction([
      this.prisma.productImage.updateMany({ where: { productId, isBrandImage: true }, data: { isBrandImage: false } }),
      this.prisma.productImage.update({ where: { id: imageId }, data: { isBrandImage: true, variantId: null, isPrimary: false } }),
    ]);
    return this.list(productId);
  }

  /** Remove the brand-image designation (the file becomes a general gallery image). */
  async clearBrandImage(userId: string, productId: string, imageId: string) {
    await this.ownership.ownedProduct(userId, productId);
    await this.ownedImage(productId, imageId);
    await this.prisma.productImage.update({ where: { id: imageId }, data: { isBrandImage: false } });
    return this.list(productId);
  }

  // ---- shared serialization (also used by public/admin product views) ----

  /** ALL images (incl. the brand image, flagged) — for the vendor/admin editor. */
  async list(productId: string) {
    const rows = await this.prisma.productImage.findMany({
      where: { productId },
      orderBy: [{ isBrandImage: 'desc' }, { isPrimary: 'desc' }, { position: 'asc' }],
    });
    return Promise.all(rows.map((r) => this.serialize(r)));
  }

  /** Customer-facing detail GALLERY — excludes the brand image (listing-only role). */
  async listGallery(productId: string) {
    const rows = await this.prisma.productImage.findMany({
      where: { productId, isBrandImage: false },
      orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }],
    });
    return Promise.all(rows.map((r) => this.serialize(r)));
  }

  /** The product's brand-image URL, or null when none is assigned. */
  async brandImageUrl(productId: string): Promise<string | null> {
    const img = await this.prisma.productImage.findFirst({ where: { productId, isBrandImage: true } });
    return img ? this.urlOrNull(img.storageKey) : null;
  }

  private async serialize(img: ProductImage) {
    return {
      id: img.id,
      variantId: img.variantId,
      url: await this.urlOrNull(img.storageKey),
      mimeType: img.mimeType,
      fileSizeBytes: img.fileSizeBytes,
      width: img.width,
      height: img.height,
      altText: img.altText,
      caption: img.caption,
      position: img.position,
      isPrimary: img.isPrimary,
      isBrandImage: img.isBrandImage,
      // Explicit, unambiguous role for the editor + clients.
      role: img.isBrandImage ? ('BRAND' as const) : img.variantId ? ('VARIANT' as const) : ('GENERAL' as const),
    };
  }

  /**
   * Batch: the marketplace listing/card image URL per product id (M6.2 precedence):
   * 1) the Brand Image, 2) the general (variantId = null) primary, 3) any primary,
   * 4) the first image. Deterministic product-level thumbnail for catalog / search /
   * category / storefront cards.
   */
  async primaryUrls(productIds: string[]): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    if (!productIds.length) return out;
    const rows = await this.prisma.productImage.findMany({
      where: { productId: { in: productIds } },
      orderBy: [{ isBrandImage: 'desc' }, { isPrimary: 'desc' }, { position: 'asc' }],
    });
    const rank = (r: { isBrandImage: boolean; isPrimary: boolean; variantId: string | null }): number =>
      r.isBrandImage ? 3 : r.isPrimary && r.variantId === null ? 2 : r.isPrimary ? 1 : 0;
    const chosen = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const cur = chosen.get(r.productId);
      if (!cur || rank(r) > rank(cur)) chosen.set(r.productId, r);
    }
    for (const [productId, r] of chosen) out.set(productId, await this.urlOrNull(r.storageKey));
    return out;
  }

  /**
   * Batch: the variant-specific primary image URL per variant id (M6.1) — used so
   * cart/order lines show the image of the exact variant purchased. Falls back to
   * the variant's first image; callers fall back to the product primary when a
   * variant has no images.
   */
  async variantPrimaryUrls(variantIds: string[]): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    if (!variantIds.length) return out;
    const rows = await this.prisma.productImage.findMany({
      where: { variantId: { in: variantIds } },
      orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }],
    });
    for (const r of rows) {
      if (!r.variantId || out.has(r.variantId)) continue;
      out.set(r.variantId, await this.urlOrNull(r.storageKey));
    }
    return out;
  }

  private async urlOrNull(key: string): Promise<string | null> {
    try {
      return await this.storage.publicUrl(key);
    } catch {
      return null; // storage disabled in this environment
    }
  }

  private async ownedImage(productId: string, imageId: string): Promise<ProductImage> {
    const image = await this.prisma.productImage.findUnique({ where: { id: imageId } });
    if (!image || image.productId !== productId) throw new NotFoundException('Image not found.');
    return image;
  }
}
