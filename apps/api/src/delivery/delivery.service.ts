import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  DeliveryEstimateInput,
  DeliveryQuoteInput,
  DeliveryZoneInput,
  DeliveryZoneUpdateInput,
} from '@bmpl/validation';
import type { DeliveryZone, DeliveryRate } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';
import { CartService } from '../cart/cart.service';
import { DeliveryPricingService } from './delivery.pricing';

const num = (v: bigint | null | undefined): number | null => (v == null ? null : Number(v));

function serializeZone(z: DeliveryZone & { rate: DeliveryRate | null }) {
  return {
    id: z.id,
    name: z.name,
    districts: z.districts,
    feeMinor: z.rate ? Number(z.rate.feeMinor) : 0,
    isActive: z.isActive,
    position: z.position,
  };
}

/** Vendor-owner delivery configuration: settings snapshot, zones (+ fees), estimate. */
@Injectable()
export class VendorDeliveryService {
  constructor(private readonly prisma: PrismaService) {}

  private async profileId(userId: string): Promise<string> {
    const vp = await this.prisma.vendorProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!vp) throw new ForbiddenException('Create your storefront first.');
    return vp.id;
  }

  async getOwn(userId: string) {
    const vendorProfileId = await this.profileId(userId);
    const [settings, zones, estimate] = await Promise.all([
      this.prisma.vendorSettings.findUnique({ where: { vendorProfileId } }),
      this.prisma.deliveryZone.findMany({ where: { vendorProfileId }, include: { rate: true }, orderBy: { position: 'asc' } }),
      this.prisma.deliveryEstimate.findUnique({ where: { vendorProfileId } }),
    ]);
    return {
      settings: {
        pickupEnabled: settings?.pickupEnabled ?? true,
        deliveryEnabled: settings?.deliveryEnabled ?? false,
        baseDeliveryFeeMinor: num(settings?.baseDeliveryFeeMinor),
        freeDeliveryThresholdMinor: num(settings?.freeDeliveryThresholdMinor),
        minimumOrderMinor: num(settings?.minimumOrderMinor),
        deliveryRadiusKm: settings?.deliveryRadiusKm ?? null,
      },
      zones: zones.map(serializeZone),
      estimate: estimate ? { minHours: estimate.minHours, maxHours: estimate.maxHours, label: estimate.label } : null,
    };
  }

  async createZone(userId: string, dto: DeliveryZoneInput) {
    const vendorProfileId = await this.profileId(userId);
    await this.assertNoOverlap(vendorProfileId, dto.districts, null);
    await this.prisma.deliveryZone.create({
      data: {
        vendorProfileId,
        name: dto.name,
        districts: dto.districts,
        isActive: dto.isActive ?? true,
        position: await this.nextPosition(vendorProfileId),
        rate: { create: { feeMinor: BigInt(dto.feeMinor) } },
      },
    });
    return this.getOwn(userId);
  }

  async updateZone(userId: string, zoneId: string, dto: DeliveryZoneUpdateInput) {
    const vendorProfileId = await this.profileId(userId);
    await this.ownedZone(vendorProfileId, zoneId);
    if (dto.districts) await this.assertNoOverlap(vendorProfileId, dto.districts, zoneId);
    await this.prisma.deliveryZone.update({
      where: { id: zoneId },
      data: {
        name: dto.name ?? undefined,
        districts: dto.districts ?? undefined,
        isActive: dto.isActive ?? undefined,
        rate:
          dto.feeMinor === undefined
            ? undefined
            : { upsert: { create: { feeMinor: BigInt(dto.feeMinor) }, update: { feeMinor: BigInt(dto.feeMinor) } } },
      },
    });
    return this.getOwn(userId);
  }

  async deleteZone(userId: string, zoneId: string) {
    const vendorProfileId = await this.profileId(userId);
    await this.ownedZone(vendorProfileId, zoneId);
    await this.prisma.deliveryZone.delete({ where: { id: zoneId } });
    return this.getOwn(userId);
  }

  async upsertEstimate(userId: string, dto: DeliveryEstimateInput) {
    const vendorProfileId = await this.profileId(userId);
    await this.prisma.deliveryEstimate.upsert({
      where: { vendorProfileId },
      create: { vendorProfileId, minHours: dto.minHours, maxHours: dto.maxHours, label: dto.label ?? null },
      update: { minHours: dto.minHours, maxHours: dto.maxHours, label: dto.label ?? null },
    });
    return this.getOwn(userId);
  }

  private async ownedZone(vendorProfileId: string, zoneId: string) {
    const z = await this.prisma.deliveryZone.findUnique({ where: { id: zoneId }, select: { vendorProfileId: true } });
    if (!z || z.vendorProfileId !== vendorProfileId) throw new NotFoundException('Delivery zone not found.');
    return z;
  }

  /** A district maps to at most one active zone per vendor (deterministic pricing). */
  private async assertNoOverlap(vendorProfileId: string, districts: string[], excludeZoneId: string | null) {
    const others = await this.prisma.deliveryZone.findMany({
      where: { vendorProfileId, isActive: true, ...(excludeZoneId ? { id: { not: excludeZoneId } } : {}) },
      select: { name: true, districts: true },
    });
    for (const o of others) {
      const clash = o.districts.find((d) => districts.includes(d));
      if (clash) throw new BadRequestException(`District ${clash.replace('_', ' ')} is already covered by zone "${o.name}".`);
    }
  }

  private async nextPosition(vendorProfileId: string) {
    const last = await this.prisma.deliveryZone.findFirst({ where: { vendorProfileId }, orderBy: { position: 'desc' }, select: { position: true } });
    return (last?.position ?? -1) + 1;
  }
}

/** Customer-facing pre-checkout delivery quote for the active cart. */
@Injectable()
export class CustomerDeliveryService {
  constructor(private readonly cart: CartService, private readonly pricing: DeliveryPricingService) {}

  async quote(userId: string, dto: DeliveryQuoteInput) {
    const cart = await this.cart.getActive(userId);
    const choice = new Map(dto.vendors.map((v) => [v.vendorProfileId, v.deliveryMethod]));
    let deliveryFeeMinor = 0;
    const vendors = [];
    for (const v of cart.vendors) {
      const method = choice.get(v.vendorProfileId) ?? 'PICKUP';
      if (method === 'DELIVERY') {
        const q = await this.pricing.quote(v.vendorProfileId, dto.district, BigInt(v.subtotalMinor));
        if (q.deliverable) deliveryFeeMinor += Number(q.feeMinor);
        vendors.push({
          vendorProfileId: v.vendorProfileId,
          businessName: v.businessName,
          deliveryMethod: 'DELIVERY' as const,
          deliverable: q.deliverable,
          reason: q.reason ?? null,
          feeMinor: Number(q.feeMinor),
          freeApplied: q.freeApplied,
          estimate: q.estimate,
          minimumOrderMinor: q.minimumOrderMinor != null ? Number(q.minimumOrderMinor) : null,
        });
      } else {
        vendors.push({
          vendorProfileId: v.vendorProfileId,
          businessName: v.businessName,
          deliveryMethod: 'PICKUP' as const,
          deliverable: true,
          reason: null,
          feeMinor: 0,
          freeApplied: false,
          estimate: null,
          minimumOrderMinor: null,
        });
      }
    }
    const subtotalMinor = Number(cart.subtotalMinor);
    return { district: dto.district, vendors, subtotalMinor, deliveryFeeMinor, totalMinor: subtotalMinor + deliveryFeeMinor };
  }
}
