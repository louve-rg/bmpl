import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  isAllowedProductImageMime,
  MAX_PRODUCT_IMAGE_BYTES,
  productImageExt,
  sniffProductImageMime,
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

    await this.persistImage(productId, {
      key: dto.key,
      mimeType: meta.contentType,
      fileSizeBytes: meta.sizeBytes,
      width: dto.width,
      height: dto.height,
      altText: dto.altText,
      caption: dto.caption,
      variantId: dto.variantId ?? null,
    });
    return this.list(productId);
  }

  /**
   * Server-side upload (browser → API → storage) for a product image. The file
   * arrives as a raw request body through the same-origin web proxy, so there is
   * no cross-origin browser PUT to the storage endpoint (the cause of the mobile
   * "Load failed"). The real MIME is sniffed from the bytes — a client-declared
   * Content-Type is never trusted — and size is enforced on the actual buffer.
   */
  async upload(
    userId: string,
    productId: string,
    buffer: Buffer | undefined,
    opts: { variantId?: string; width?: number; height?: number; altText?: string; caption?: string } = {},
  ) {
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('No image data was received. Please choose an image and try again.');
    }
    if (buffer.length > MAX_PRODUCT_IMAGE_BYTES) {
      throw new BadRequestException('The image is too large.');
    }
    const mime = sniffProductImageMime(buffer);
    if (!mime) {
      throw new BadRequestException('Unsupported image type. Use JPEG, PNG, or WebP.');
    }
    const product = await this.ownership.ownedProduct(userId, productId);
    if (opts.variantId) await this.assertVariantInProduct(productId, opts.variantId);
    const key = this.storage.buildKey(
      STORAGE_PREFIX.productImage(product.vendorProfileId, product.id),
      `image.${productImageExt(mime)}`,
    );
    await this.storage.putObject(key, buffer, mime, 'public');
    await this.persistImage(productId, {
      key,
      mimeType: mime,
      fileSizeBytes: buffer.length,
      width: opts.width,
      height: opts.height,
      altText: opts.altText,
      caption: opts.caption,
      variantId: opts.variantId ?? null,
    });
    return this.list(productId);
  }

  /**
   * Server-side in-place FILE replace (browser → API → storage). Preserves the
   * image's variant, position, primary status, alt text and caption — same
   * contract as {@link replace} but without a cross-origin browser PUT.
   */
  async replaceFile(
    userId: string,
    productId: string,
    imageId: string,
    buffer: Buffer | undefined,
    opts: { width?: number; height?: number } = {},
  ) {
    const product = await this.ownership.ownedProduct(userId, productId);
    const image = await this.ownedImage(productId, imageId);
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('No image data was received. Please choose an image and try again.');
    }
    if (buffer.length > MAX_PRODUCT_IMAGE_BYTES) throw new BadRequestException('The image is too large.');
    const mime = sniffProductImageMime(buffer);
    if (!mime) throw new BadRequestException('Unsupported image type. Use JPEG, PNG, or WebP.');
    const key = this.storage.buildKey(
      STORAGE_PREFIX.productImage(product.vendorProfileId, product.id),
      `image.${productImageExt(mime)}`,
    );
    await this.storage.putObject(key, buffer, mime, 'public');
    const oldKey = image.storageKey;
    await this.prisma.productImage.update({
      where: { id: imageId },
      // variantId / position / isPrimary / altText / caption are intentionally preserved.
      data: { storageKey: key, mimeType: mime, fileSizeBytes: buffer.length, width: opts.width ?? null, height: opts.height ?? null },
    });
    await this.storage.deleteObject(oldKey, 'public');
    return this.list(productId);
  }

  /**
   * Create a ProductImage row. The first image within a variant GROUP (or the
   * general/unassigned group) becomes that group's primary — so every variant
   * gallery has a primary of its own.
   */
  private async persistImage(
    productId: string,
    data: {
      key: string;
      mimeType: string;
      fileSizeBytes: number;
      width?: number | null;
      height?: number | null;
      altText?: string | null;
      caption?: string | null;
      variantId?: string | null;
    },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const count = await tx.productImage.count({ where: { productId } });
      const groupCount = await tx.productImage.count({ where: { productId, variantId: data.variantId ?? null } });
      await tx.productImage.create({
        data: {
          productId,
          variantId: data.variantId ?? null,
          storageKey: data.key,
          mimeType: data.mimeType,
          fileSizeBytes: data.fileSizeBytes,
          width: data.width ?? null,
          height: data.height ?? null,
          altText: data.altText ?? null,
          caption: data.caption ?? null,
          position: count,
          isPrimary: groupCount === 0,
        },
      });
    });
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

  /**
   * Customer-facing detail GALLERY. Source of truth for what is publicly visible:
   *  - A VARIANT product (has ≥1 variant): ONLY images assigned to an ACTIVE
   *    variant. Unassigned images (variantId = null) are an internal editor pool
   *    and are NEVER public; images of a deactivated/archived variant are excluded
   *    so a hidden variant leaves no stale images/thumbnails behind.
   *  - A SIMPLE product (no variants): its general (variantId = null) images ARE
   *    the gallery — there is no variant to assign them to.
   * The Brand Image (listing-only role) is always excluded here.
   */
  async listGallery(productId: string) {
    const hasVariants = (await this.prisma.productVariant.count({ where: { productId } })) > 0;
    const where = hasVariants
      ? { productId, isBrandImage: false, variantId: { not: null }, variant: { isActive: true } }
      : { productId, isBrandImage: false, variantId: null };
    const rows = await this.prisma.productImage.findMany({
      where,
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
   * Batch: the marketplace listing/card image URL per product id. Only publicly
   * eligible images qualify — the unassigned pool is NEVER a card image:
   *  1) the Brand Image (always eligible), else
   *  2) for a VARIANT product: the primary/first image of an ACTIVE variant, else
   *     for a SIMPLE product: the general (variantId = null) primary/first image,
   *  3) null when nothing eligible exists.
   * Deterministic product-level thumbnail for catalog / search / category / cards.
   */
  async primaryUrls(productIds: string[]): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    const chosen = await this.choosePrimaryRows(productIds, { includeBrand: true });
    for (const [productId, r] of chosen) out.set(productId, await this.urlOrNull(r.storageKey));
    return out;
  }

  /**
   * Shared chooser behind `primaryUrls` and the order-line resolution. With
   * `includeBrand: false` the Brand Image never qualifies — the caller wants
   * the product's OWN image (order lines show what was bought, never the
   * storefront logo).
   */
  private async choosePrimaryRows(
    productIds: string[],
    opts: { includeBrand: boolean },
  ): Promise<Map<string, { storageKey: string }>> {
    if (!productIds.length) return new Map();
    const [rows, variantRows] = await Promise.all([
      this.prisma.productImage.findMany({
        where: { productId: { in: productIds } },
        orderBy: [{ isBrandImage: 'desc' }, { isPrimary: 'desc' }, { position: 'asc' }],
        include: { variant: { select: { isActive: true } } },
      }),
      this.prisma.productVariant.findMany({
        where: { productId: { in: productIds } },
        select: { productId: true },
        distinct: ['productId'],
      }),
    ]);
    const hasVariants = new Set(variantRows.map((v) => v.productId));
    const eligible = (r: (typeof rows)[number]): boolean => {
      if (r.isBrandImage) return opts.includeBrand;
      if (hasVariants.has(r.productId)) return r.variantId != null && r.variant?.isActive === true;
      return r.variantId === null; // simple product: general images are public
    };
    const rank = (r: { isBrandImage: boolean; isPrimary: boolean }): number =>
      r.isBrandImage ? 2 : r.isPrimary ? 1 : 0;
    const chosen = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      if (!eligible(r)) continue;
      const cur = chosen.get(r.productId);
      if (!cur || rank(r) > rank(cur)) chosen.set(r.productId, r);
    }
    return chosen;
  }

  /**
   * Order-line image resolution, stated once for both moments it is needed:
   * the exact variant's primary image, else the product's own (non-brand)
   * primary, else null. The Brand Image is a listing/card role and is NEVER an
   * order-line image. Returns storage KEYS aligned with the input — checkout
   * snapshots these onto `OrderItem.imageStorageKey`.
   */
  async orderLineImageKeys(
    lines: { productId: string | null; variantId: string | null }[],
  ): Promise<(string | null)[]> {
    const variantIds = [...new Set(lines.map((l) => l.variantId).filter((id): id is string => !!id))];
    const productIds = [...new Set(lines.map((l) => l.productId).filter((id): id is string => !!id))];
    const [variantRows, productChosen] = await Promise.all([
      variantIds.length
        ? this.prisma.productImage.findMany({
            where: { variantId: { in: variantIds } },
            orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }],
          })
        : Promise.resolve([]),
      this.choosePrimaryRows(productIds, { includeBrand: false }),
    ]);
    const variantKey = new Map<string, string>();
    for (const r of variantRows) {
      if (r.variantId && !variantKey.has(r.variantId)) variantKey.set(r.variantId, r.storageKey);
    }
    return lines.map(
      (l) =>
        (l.variantId ? variantKey.get(l.variantId) : null) ??
        (l.productId ? productChosen.get(l.productId)?.storageKey : null) ??
        null,
    );
  }

  /**
   * URLs for serialized order lines: the snapshot taken at checkout wins;
   * a null snapshot (pre-snapshot rows) falls back to the SAME live resolution
   * checkout would apply today (`orderLineImageKeys`), so legacy orders fix
   * themselves on read and can never show the brand image either.
   */
  async orderLineImageUrls(
    lines: { imageStorageKey: string | null; productId: string | null; variantId: string | null }[],
  ): Promise<(string | null)[]> {
    const needFallback = lines.filter((l) => !l.imageStorageKey);
    const fallbackKeys = needFallback.length ? await this.orderLineImageKeys(needFallback) : [];
    const fallbackByIndex = new Map<(typeof lines)[number], string | null>();
    needFallback.forEach((l, i) => fallbackByIndex.set(l, fallbackKeys[i] ?? null));
    return Promise.all(
      lines.map((l) => {
        const key = l.imageStorageKey ?? fallbackByIndex.get(l) ?? null;
        return key ? this.urlOrNull(key) : Promise.resolve(null);
      }),
    );
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
