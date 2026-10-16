import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { District } from '@bmpl/database';
import { DeliveryPricingService } from './delivery.pricing';
import type { PrismaService } from '../prisma/prisma.service';

// Module-level mock: replaces the ENTIRE `@bmpl/shared` export surface with a
// spy for `planRoute`. Any future code path that starts calling the real
// `planRoute` — directly, or via a new dependency this service picks up later
// — calls this spy instead, and the assertion below sees it. This is what
// makes the test a property check that survives a redesign, not a pin of
// today's constructor signature.
const planRouteSpy = vi.fn();
vi.mock('@bmpl/shared', () => ({ planRoute: planRouteSpy }));

// If this file ever fails with a hoisting error ("Cannot access 'planRouteSpy'
// before initialization") instead of a normal assertion failure, that is the
// invariant being violated, not a broken test: it means the pricing path under
// test has started importing `@bmpl/shared` itself, which collides with this
// mock's hoisting. Treat it exactly like a failed `expect(planRouteSpy)` call.

afterEach(() => {
  planRouteSpy.mockClear();
});

/** A realistic VendorSettings + one matching zone/rate + an estimate — not a
 *  degenerate empty mock. If this ever started returning `deliverable: false`
 *  or a zero fee, the test below would fail on that assertion first, so a
 *  broken mock can't silently defeat the planner-isolation assertion by
 *  making `quote()` short-circuit before it would ever have had a chance to
 *  reach a planner call. */
function mockPrisma() {
  return {
    vendorSettings: {
      findUnique: vi.fn().mockResolvedValue({
        deliveryEnabled: true,
        minimumOrderMinor: null,
        baseDeliveryFeeMinor: null,
        freeDeliveryThresholdMinor: null,
      }),
    },
    deliveryZone: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'zone-belize-city',
          districts: ['BELIZE'] as District[],
          isActive: true,
          position: 0,
          rate: { feeMinor: 450n },
        },
      ]),
    },
    deliveryEstimate: {
      findUnique: vi.fn().mockResolvedValue({ minHours: 1, maxHours: 3, label: '1–3 hours' }),
    },
  } as unknown as PrismaService;
}

describe('marketplace delivery pricing never consults the multimodal shipment planner', () => {
  it('computes a real zone-matched fee without ever calling planRoute', async () => {
    const service = new DeliveryPricingService(mockPrisma());

    const quote = await service.quote('vendor-1', 'BELIZE' as District, 10_000n);

    // The invariant: no matter how this quote was resolved, the one function
    // that represents "the multimodal planner was consulted" was never called.
    expect(planRouteSpy).not.toHaveBeenCalled();

    // Guards the guard: prove the computation actually ran and produced a
    // real, meaningful fee — not a degenerate path that trivially never
    // reaches anything because it failed first.
    expect(quote.deliverable).toBe(true);
    expect(quote.feeMinor).toBe(450n);
    expect(quote.appliedZoneId).toBe('zone-belize-city');
  });

  it('still never calls planRoute on the base-flat-fee (no matching zone) path', async () => {
    const prisma = mockPrisma();
    (prisma.deliveryZone.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.vendorSettings.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      deliveryEnabled: true,
      minimumOrderMinor: null,
      baseDeliveryFeeMinor: 600n,
      freeDeliveryThresholdMinor: null,
    });
    const service = new DeliveryPricingService(prisma);

    const quote = await service.quote('vendor-1', 'CAYO' as District, 10_000n);

    expect(planRouteSpy).not.toHaveBeenCalled();
    expect(quote.deliverable).toBe(true);
    expect(quote.feeMinor).toBe(600n);
    expect(quote.appliedZoneId).toBeNull();
  });
});

/**
 * STATIC GUARD, same convention as apps/api/src/shipping/shipment-money-boundary.spec.ts:
 * these read source text rather than exercising behaviour, as a second,
 * independent check against the one failure mode a module mock cannot see —
 * a future import reaching the planner through a path this test file's mock
 * does not shadow (e.g. a dynamic `await import(...)`).
 */
const MARKETPLACE_PRICING_FILES = ['delivery.pricing.ts'];
const sourceOfDelivery = (file: string) => readFileSync(resolve(process.cwd(), 'src/delivery', file), 'utf8');
const sourceOfOrders = () => readFileSync(resolve(process.cwd(), 'src/orders', 'orders.service.ts'), 'utf8');

describe('marketplace delivery pricing never consults the multimodal shipment planner (STATIC GUARD, source read)', () => {
  it('STATIC GUARD: delivery pricing never imports or calls the planner', () => {
    for (const file of MARKETPLACE_PRICING_FILES) {
      expect(sourceOfDelivery(file), file).not.toMatch(/planRoute|RoutePlanner/);
    }
  });

  it('STATIC GUARD: the marketplace checkout path (orders.service.ts) never imports or calls the planner', () => {
    expect(sourceOfOrders()).not.toMatch(/planRoute|RoutePlanner/);
  });
});
