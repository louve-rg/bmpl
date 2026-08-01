/**
 * Settlement & Earnings (Phase 3 · M18) — the fee engine + vocabulary.
 *
 * Pure, framework-agnostic. `computeSettlement` is the SINGLE source of truth for
 * how escrow is split after a vendor-order is fulfilled: vendor net, driver
 * earning, and platform revenue. All amounts are BigInt minor units (cents). The
 * split is exact by construction (see the invariant below) so the resulting ledger
 * transaction always balances. NO external withdrawal/payout — this only describes
 * an INTERNAL redistribution of already-escrowed customer funds.
 */

export const DRIVER_EARNING_METHODS = ['FLAT', 'PERCENT_DELIVERY_FEE', 'HYBRID'] as const;
export type DriverEarningMethod = (typeof DRIVER_EARNING_METHODS)[number];

export const SETTLEMENT_STATUSES = ['PENDING', 'POSTED', 'FAILED'] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

/** Server-side fee configuration (mirrors PlatformFeeConfig). */
export interface FeeConfig {
  commissionBps: number; // marketplace commission, basis points of merchandise subtotal
  driverEarningMethod: DriverEarningMethod;
  driverFlatMinor: bigint; // FLAT / HYBRID fixed amount per delivery
  driverDeliveryFeeBps: number; // PERCENT / HYBRID share of the delivery fee, basis points
}

/** Documented defaults (admin-configurable). Commission 10%; driver 80% of the
 *  delivery fee. These are engineering defaults for the configurable engine — the
 *  actual business rates should be confirmed by the platform operator. */
export const DEFAULT_FEE_CONFIG: FeeConfig = {
  commissionBps: 1000,
  driverEarningMethod: 'PERCENT_DELIVERY_FEE',
  driverFlatMinor: 0n,
  driverDeliveryFeeBps: 8000,
};

const bps = (amount: bigint, basisPoints: number): bigint => (amount * BigInt(Math.max(0, Math.round(basisPoints)))) / 10000n;
const clamp = (v: bigint, lo: bigint, hi: bigint): bigint => (v < lo ? lo : v > hi ? hi : v);

export interface SettlementInput {
  merchandiseSubtotalMinor: bigint;
  deliveryFeeMinor: bigint; // 0 for pickup / no delivery
  hasDelivery: boolean; // whether a driver delivered this vendor-order
}

export interface SettlementBreakdown {
  merchandiseSubtotalMinor: bigint;
  deliveryFeeMinor: bigint;
  grossMinor: bigint; // merchandise + delivery fee (the escrow debit)
  commissionMinor: bigint; // platform commission on merchandise
  driverAllocationMinor: bigint; // driver's share of the delivery fee
  platformFeeMinor: bigint; // platform's share of the delivery fee
  platformRevenueMinor: bigint; // commission + platform delivery share
  vendorNetMinor: bigint; // merchandise − commission
}

/**
 * Split gross escrow for one vendor-order. Invariant (exact, no rounding drift):
 *   vendorNet + driverAllocation + platformRevenue === gross
 * because commission and driverAllocation cancel algebraically.
 */
export function computeSettlement(input: SettlementInput, config: FeeConfig): SettlementBreakdown {
  const subtotal = input.merchandiseSubtotalMinor;
  const deliveryFee = input.hasDelivery ? input.deliveryFeeMinor : 0n;
  const gross = subtotal + deliveryFee;

  const commission = clamp(bps(subtotal, config.commissionBps), 0n, subtotal);

  let driverAllocation = 0n;
  if (input.hasDelivery && deliveryFee > 0n) {
    if (config.driverEarningMethod === 'FLAT') driverAllocation = config.driverFlatMinor;
    else if (config.driverEarningMethod === 'PERCENT_DELIVERY_FEE') driverAllocation = bps(deliveryFee, config.driverDeliveryFeeBps);
    else driverAllocation = config.driverFlatMinor + bps(deliveryFee, config.driverDeliveryFeeBps); // HYBRID
    // The driver can never earn more than the delivery fee (platform share ≥ 0).
    driverAllocation = clamp(driverAllocation, 0n, deliveryFee);
  }

  const platformDeliveryShare = deliveryFee - driverAllocation;
  const platformRevenue = commission + platformDeliveryShare;
  const vendorNet = subtotal - commission;

  return {
    merchandiseSubtotalMinor: subtotal,
    deliveryFeeMinor: deliveryFee,
    grossMinor: gross,
    commissionMinor: commission,
    driverAllocationMinor: driverAllocation,
    platformFeeMinor: platformDeliveryShare,
    platformRevenueMinor: platformRevenue,
    vendorNetMinor: vendorNet,
  };
}

/** Idempotency reference for a vendor-order settlement's ledger transaction. */
export const settlementReference = (vendorOrderId: string): string => `settlement:${vendorOrderId}:v1`;
