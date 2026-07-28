import { describe, expect, it } from 'vitest';
import type { Inventory } from '@bmpl/database';
import { InventoryService } from './inventory.service';

// availability() is a pure derivation and uses none of the injected deps.
const svc = new InventoryService(null as never, null as never, null as never);

function inv(over: Partial<Inventory>): Inventory {
  return {
    id: 'i',
    productId: 'p',
    variantId: null,
    quantity: 0,
    reserved: 0,
    lowStockThreshold: 0,
    unlimited: false,
    allowBackorders: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as Inventory;
}

describe('InventoryService.availability (stock derivation)', () => {
  it('is out of stock at zero on-hand', () => {
    const a = svc.availability(inv({ quantity: 0 }));
    expect(a).toMatchObject({ available: 0, inStock: false, outOfStock: true, lowStock: false });
  });

  it('is in stock with on-hand quantity', () => {
    expect(svc.availability(inv({ quantity: 5 }))).toMatchObject({ available: 5, inStock: true });
  });

  it('subtracts reserved from available', () => {
    expect(svc.availability(inv({ quantity: 5, reserved: 3 })).available).toBe(2);
  });

  it('flags low stock at/under the threshold (but above zero)', () => {
    expect(svc.availability(inv({ quantity: 2, lowStockThreshold: 3 })).lowStock).toBe(true);
    expect(svc.availability(inv({ quantity: 4, lowStockThreshold: 3 })).lowStock).toBe(false);
  });

  it('unlimited is always in stock with null available', () => {
    const a = svc.availability(inv({ quantity: 0, unlimited: true }));
    expect(a).toMatchObject({ available: null, inStock: true, outOfStock: false, lowStock: false });
  });

  it('backorders keep it in stock at zero on-hand', () => {
    const a = svc.availability(inv({ quantity: 0, allowBackorders: true }));
    expect(a).toMatchObject({ inStock: true, outOfStock: false });
  });
});
