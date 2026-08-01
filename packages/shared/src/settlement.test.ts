import { describe, it, expect } from 'vitest';
import { computeSettlement, DEFAULT_FEE_CONFIG, type FeeConfig } from './settlement';

/** The load-bearing invariant: the split is exact and always balances. */
function assertBalances(b: ReturnType<typeof computeSettlement>) {
  expect(b.vendorNetMinor + b.driverAllocationMinor + b.platformRevenueMinor).toBe(b.grossMinor);
  expect(b.platformRevenueMinor).toBe(b.commissionMinor + b.platformFeeMinor);
  for (const v of [b.commissionMinor, b.driverAllocationMinor, b.platformFeeMinor, b.vendorNetMinor]) {
    expect(v >= 0n).toBe(true);
  }
}

describe('computeSettlement (M18 fee engine)', () => {
  it('splits a delivery order: 10% commission, 80% of delivery fee to driver', () => {
    const b = computeSettlement({ merchandiseSubtotalMinor: 10000n, deliveryFeeMinor: 500n, hasDelivery: true }, DEFAULT_FEE_CONFIG);
    expect(b.grossMinor).toBe(10500n);
    expect(b.commissionMinor).toBe(1000n); // 10% of 10000
    expect(b.driverAllocationMinor).toBe(400n); // 80% of 500
    expect(b.platformFeeMinor).toBe(100n); // 20% of 500
    expect(b.vendorNetMinor).toBe(9000n); // 10000 − 1000
    expect(b.platformRevenueMinor).toBe(1100n); // 1000 + 100
    assertBalances(b);
  });

  it('pickup order (no delivery): no driver allocation, gross = merchandise', () => {
    const b = computeSettlement({ merchandiseSubtotalMinor: 8000n, deliveryFeeMinor: 0n, hasDelivery: false }, DEFAULT_FEE_CONFIG);
    expect(b.grossMinor).toBe(8000n);
    expect(b.driverAllocationMinor).toBe(0n);
    expect(b.vendorNetMinor).toBe(7200n);
    expect(b.platformRevenueMinor).toBe(800n);
    assertBalances(b);
  });

  it('FLAT driver method caps at the delivery fee', () => {
    const cfg: FeeConfig = { commissionBps: 1000, driverEarningMethod: 'FLAT', driverFlatMinor: 900n, driverDeliveryFeeBps: 0 };
    const b = computeSettlement({ merchandiseSubtotalMinor: 5000n, deliveryFeeMinor: 500n, hasDelivery: true }, cfg);
    expect(b.driverAllocationMinor).toBe(500n); // capped at the 500 delivery fee
    expect(b.platformFeeMinor).toBe(0n);
    assertBalances(b);
  });

  it('HYBRID = flat + percentage, still capped at the delivery fee', () => {
    const cfg: FeeConfig = { commissionBps: 500, driverEarningMethod: 'HYBRID', driverFlatMinor: 100n, driverDeliveryFeeBps: 5000 };
    const b = computeSettlement({ merchandiseSubtotalMinor: 20000n, deliveryFeeMinor: 800n, hasDelivery: true }, cfg);
    expect(b.commissionMinor).toBe(1000n); // 5% of 20000
    expect(b.driverAllocationMinor).toBe(500n); // 100 + 50% of 800 = 500
    assertBalances(b);
  });

  it('stays balanced across odd amounts (rounding never leaks value)', () => {
    for (const [sub, fee] of [[9999n, 333n], [1n, 1n], [12345n, 777n], [100000n, 1249n]] as const) {
      assertBalances(computeSettlement({ merchandiseSubtotalMinor: sub, deliveryFeeMinor: fee, hasDelivery: true }, DEFAULT_FEE_CONFIG));
    }
  });
});
