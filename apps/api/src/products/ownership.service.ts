import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Single source of truth for marketplace vendor-ownership checks. Every
 * owner-scoped product operation resolves ownership through here so the rule
 * (a vendor may only touch their own product) is enforced identically across
 * products, images, variants, and inventory — no per-service duplication.
 */
@Injectable()
export class OwnershipService {
  constructor(private readonly prisma: PrismaService) {}

  /** The caller's vendor-profile id, or 403 if they have not created one. */
  async vendorProfileId(userId: string): Promise<string> {
    const vp = await this.prisma.vendorProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!vp) throw new ForbiddenException('Create your vendor profile first.');
    return vp.id;
  }

  /** A product owned by the caller (404 if missing or not theirs). */
  async ownedProduct(userId: string, productId: string): Promise<{ id: string; vendorProfileId: string }> {
    const vendorProfileId = await this.vendorProfileId(userId);
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, vendorProfileId: true },
    });
    if (!product || product.vendorProfileId !== vendorProfileId) {
      throw new NotFoundException('Product not found.');
    }
    return product;
  }
}
