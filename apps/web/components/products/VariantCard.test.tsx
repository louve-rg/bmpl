// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { VariantCard } from './VariantCard';
import type { InvRow, LocationStock, Variant } from './types';

// react-dom's act() checks this flag; see StorefrontView.test.tsx / LocationPicker.test.tsx
// for the same convention (no @testing-library/react dependency in this repo).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('../../lib/api', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
    patch: vi.fn(),
    del: vi.fn(),
  },
}));

function variant(overrides: Partial<Variant> = {}): Variant {
  return {
    id: 'var-1',
    title: 'Small',
    displayName: null,
    optionLabel: 'Small',
    sku: 'SKU-1',
    barcode: null,
    priceMinor: null,
    salePriceMinor: null,
    isActive: true,
    optionValueIds: [],
    quantity: 20,
    ...overrides,
  };
}

function invRow(overrides: Partial<InvRow> = {}): InvRow {
  return {
    inventoryId: 'inv-1',
    variantId: 'var-1',
    sku: 'SKU-1',
    quantity: 20,
    reserved: 2,
    available: 18,
    unlimited: false,
    allowBackorders: false,
    lowStockThreshold: 5,
    inStock: true,
    lowStock: false,
    outOfStock: false,
    ...overrides,
  };
}

function locationStock(overrides: Partial<LocationStock> = {}): LocationStock {
  return {
    locationId: 'loc-1',
    label: 'Main store',
    isPrimary: true,
    adopted: true,
    inventoryLocationId: 'il-1',
    quantity: 12,
    reserved: 1,
    available: 11,
    unlimited: false,
    allowBackorders: false,
    lowStockThreshold: 5,
    inStock: true,
    lowStock: false,
    outOfStock: false,
    ...overrides,
  };
}

describe('VariantCard — stock by location (BMPL-175/354)', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    if (container) container.remove();
    root = null;
    container = null;
  });

  function mount(invOverrides: Partial<InvRow> = {}) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <VariantCard
          productId="prod-1"
          variant={variant()}
          invRow={invRow(invOverrides)}
          images={[]}
          variantChoices={[]}
          moveImage={() => {}}
          reloadVariants={async () => {}}
          reloadImages={async () => {}}
          onError={() => {}}
        />,
      );
    });
    return container;
  }

  it('does not offer a per-location breakdown when the variant is unlimited', () => {
    const el = mount({ unlimited: true });
    expect(el.textContent).not.toContain('Stock by location');
  });

  it('fetches and renders each vendor location on open, scoped to this variant', async () => {
    apiGet.mockResolvedValue([locationStock(), locationStock({ locationId: 'loc-2', label: 'Warehouse', isPrimary: false, quantity: 3, reserved: 0 })]);
    const el = mount();

    const toggle = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Stock by location')!;
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(apiGet).toHaveBeenCalledWith('/vendor/products/prod-1/inventory/locations?variantId=var-1');
    expect(el.textContent).toContain('Main store');
    expect(el.textContent).toContain('Warehouse');
    expect(el.textContent).toContain('Primary');
  });

  it('says there is nothing to split when the vendor has only one location', async () => {
    apiGet.mockResolvedValue([locationStock()]);
    const el = mount();

    const toggle = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Stock by location')!;
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(el.textContent).toContain('Only one location — nothing to split.');
    expect(el.textContent).not.toContain('Main store');
  });

  it('posts a location-scoped adjustment, not the product-level endpoint', async () => {
    apiGet.mockResolvedValue([locationStock({ quantity: 12 }), locationStock({ locationId: 'loc-2', label: 'Warehouse', isPrimary: false })]);
    apiPost.mockResolvedValue({});
    const el = mount();

    const toggle = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Stock by location')!;
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const applyButtons = Array.from(el.querySelectorAll('button')).filter((b) => b.textContent === 'Apply');
    expect(applyButtons.length).toBe(2);

    await act(async () => {
      applyButtons[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(apiPost).toHaveBeenCalledWith('/vendor/products/prod-1/inventory/locations/loc-1/adjust?variantId=var-1', {
      delta: 1,
      reason: 'RESTOCK',
    });
  });
});
