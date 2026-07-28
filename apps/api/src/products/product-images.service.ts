import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  isAllowedProductImageMime,
  MAX_PRODUCT_IMAGE_BYTES,
  STORAGE_PREFIX,
} from '@bmpl/shared';
import type { ProductImageConfirmInput, ProductImageUpdateInput } from '@bmpl/validation';
import type { ProductImage } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

interface OwnedProduct {
  id: string;
  vendorProfileId: string;
}

@Injectable()
export class ProductImagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Presigned PUT to the PUBLIC bucket, namespaced under the owning vendor+product. */
  async presign(userId: string, productId: string, fileName: string, contentType: string) {
    if (!isAllowedProductImageMime(contentType)) {
      throw new BadRequestException('Unsupported image type. Use JPEG, PNG, or WebP.');
    }
    const product = await this.ownedProduct(userId, productId);
    const key = this.storage.buildKey(
      STORAGE_PREFIX.productImage(product.vendorProfileId, product.id),
      fileName,
    );
    return this.storage.presignUpload(key, contentType, 'public');
  }

  /** Confirm an uploaded image: verify namespace + real MIME/size, then persist. */
  async confirm(userId: string, productId: string, dto: ProductImageConfirmInput) {
    const product = await this.ownedProduct(userId, productId);
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

    await this.prisma.$transaction(async (tx) => {
      const count = await tx.productImage.count({ where: { productId } });
      await tx.productImage.create({
        data: {
          productId,
          storageKey: dto.key,
          mimeType: meta.contentType,
          fileSizeBytes: meta.sizeBytes,
          width: dto.width ?? null,
          height: dto.height ?? null,
          altText: dto.altText ?? null,
          caption: dto.caption ?? null,
          position: count,
          isPrimary: count === 0, // first image is primary
        },
      });
    });
    return this.list(productId);
  }

  async listForOwner(userId: string, productId: string) {
    await this.ownedProduct(userId, productId);
    return this.list(productId);
  }

  async update(userId: string, productId: string, imageId: string, dto: ProductImageUpdateInput) {
    await this.ownedProduct(userId, productId);
    await this.ownedImage(productId, imageId);
    await this.prisma.productImage.update({
      where: { id: imageId },
      data: {
        altText: dto.altText === undefined ? undefined : dto.altText,
        caption: dto.caption === undefined ? undefined : dto.caption,
      },
    });
    return this.list(productId);
  }

  /** Full reorder: `order` must contain exactly the product's image ids. */
  async reorder(userId: string, productId: string, order: string[]) {
    await this.ownedProduct(userId, productId);
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

  /** Set the primary image transactionally (exactly one primary per product). */
  async setPrimary(userId: string, productId: string, imageId: string) {
    await this.ownedProduct(userId, productId);
    await this.ownedImage(productId, imageId);
    await this.prisma.$transaction([
      this.prisma.productImage.updateMany({
        where: { productId, isPrimary: true },
        data: { isPrimary: false },
      }),
      this.prisma.productImage.update({ where: { id: imageId }, data: { isPrimary: true } }),
    ]);
    return this.list(productId);
  }

  async remove(userId: string, productId: string, imageId: string) {
    await this.ownedProduct(userId, productId);
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

  // ---- shared serialization (also used by public/admin product views) ----

  /** Ordered images with resolved public URLs (primary first, then by position). */
  async list(productId: string) {
    const rows = await this.prisma.productImage.findMany({
      where: { productId },
      orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }],
    });
    return Promise.all(rows.map((r) => this.serialize(r)));
  }

  private async serialize(img: ProductImage) {
    return {
      id: img.id,
      url: await this.urlOrNull(img.storageKey),
      mimeType: img.mimeType,
      fileSizeBytes: img.fileSizeBytes,
      width: img.width,
      height: img.height,
      altText: img.altText,
      caption: img.caption,
      position: img.position,
      isPrimary: img.isPrimary,
    };
  }

  /** Batch: primary-image URL per product id (single query; avoids N+1 on lists). */
  async primaryUrls(productIds: string[]): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    if (!productIds.length) return out;
    const rows = await this.prisma.productImage.findMany({
      where: { productId: { in: productIds }, isPrimary: true },
    });
    for (const r of rows) out.set(r.productId, await this.urlOrNull(r.storageKey));
    return out;
  }

  private async urlOrNull(key: string): Promise<string | null> {
    try {
      return await this.storage.publicUrl(key);
    } catch {
      return null; // storage disabled in this environment
    }
  }

  private async ownedProduct(userId: string, productId: string): Promise<OwnedProduct> {
    const vp = await this.prisma.vendorProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!vp) throw new ForbiddenException('Create your vendor profile first.');
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, vendorProfileId: true },
    });
    if (!product || product.vendorProfileId !== vp.id) throw new NotFoundException('Product not found.');
    return product;
  }

  private async ownedImage(productId: string, imageId: string): Promise<ProductImage> {
    const image = await this.prisma.productImage.findUnique({ where: { id: imageId } });
    if (!image || image.productId !== productId) throw new NotFoundException('Image not found.');
    return image;
  }
}
