import { Injectable } from '@nestjs/common';
import type { District } from '@bmpl/database';
import { PrismaService } from '../prisma/prisma.service';

export type DeliveryUnavailableReason = 'PICKUP_ONLY' | 'BELOW_MINIMUM' | 'DISTRICT_NOT_SERVED';

export interface DeliveryQuote {
  deliverable: boolean;
  reason?: DeliveryUnavailableReason;
  minimumOrderMinor?: bigint;
  feeMinor: bigint;
  freeApplied: boolean;
  appliedZoneId: string | null;
  estimate: { minHours: number; maxHours: number; label: string | null } | null;
}

/**
 * Delivery pricing engine (M13). Given a vendor, a destination district, and the
 * vendor's order subtotal, it resolves a delivery fee via:
 *   1. zone match (a DeliveryZone covering the district → its DeliveryRate fee), else
 *   2. the vendor's base flat fee,
 * then applies the free-delivery threshold. Pure fee resolution — NO routing,
 * geocoding, ETA-from-maps, or dispatch. Extensible: add weight/distance rules
 * behind this interface without touching callers.
 */
@Injectable()
export class DeliveryPricingService {
  constructor(private readonly prisma: PrismaService) {}

  async quote(vendorProfileId: string, district: District, subtotalMinor: bigint): Promise<DeliveryQuote> {
    const [settings, zones, estimateRow] = await Promise.all([
      this.prisma.vendorSettings.findUnique({ where: { vendorProfileId } }),
      this.prisma.deliveryZone.findMany({
        where: { vendorProfileId, isActive: true },
        include: { rate: true },
        orderBy: { position: 'asc' },
      }),
      this.prisma.deliveryEstimate.findUnique({ where: { vendorProfileId } }),
    ]);

    const estimate = estimateRow
      ? { minHours: estimateRow.minHours, maxHours: estimateRow.maxHours, label: estimateRow.label }
      : null;
    const unavailable = (reason: DeliveryUnavailableReason, extra: Partial<DeliveryQuote> = {}): DeliveryQuote => ({
      deliverable: false,
      reason,
      feeMinor: 0n,
      freeApplied: false,
      appliedZoneId: null,
      estimate,
      ...extra,
    });

    if (!settings?.deliveryEnabled) return unavailable('PICKUP_ONLY');
    if (settings.minimumOrderMinor != null && subtotalMinor < settings.minimumOrderMinor) {
      return unavailable('BELOW_MINIMUM', { minimumOrderMinor: settings.minimumOrderMinor });
    }

    // Zone match wins; otherwise the base flat fee. No base + no zone = not served.
    const zone = zones.find((z) => z.districts.includes(district) && z.rate);
    let feeMinor: bigint;
    let appliedZoneId: string | null;
    if (zone?.rate) {
      feeMinor = zone.rate.feeMinor;
      appliedZoneId = zone.id;
    } else if (settings.baseDeliveryFeeMinor != null) {
      feeMinor = settings.baseDeliveryFeeMinor;
      appliedZoneId = null;
    } else {
      return unavailable('DISTRICT_NOT_SERVED');
    }

    let freeApplied = false;
    if (settings.freeDeliveryThresholdMinor != null && subtotalMinor >= settings.freeDeliveryThresholdMinor) {
      feeMinor = 0n;
      freeApplied = true;
    }

    return { deliverable: true, feeMinor, freeApplied, appliedZoneId, estimate };
  }
}
