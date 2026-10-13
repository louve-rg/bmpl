// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { ProductEditorManager } from './ProductEditorManager';
import type { Inventory, InvRow, ManageView, ProductImage } from './types';

// Same convention as VariantCard.test.tsx / StorefrontView.test.tsx — no
// @testing-library/react dependency in this repo.
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

function manageView(overrides: Partial<ManageView> = {}): ManageView {
  return { productTitle: 'Test product', options: [], variants: [], ...overrides };
}

function productInvRow(overrides: Partial<InvRow> = {}): InvRow {
  return {
    inventoryId: 'inv-product',
    variantId: null,
    sku: null,
    hasLocations: false,
    quantity: 7,
    reserved: 1,
    available: 6,
    unlimited: false,
    allowBackorders: false,
    lowStockThreshold: 3,
    inStock: true,
    lowStock: false,
    outOfStock: false,
    ...overrides,
  };
}

function inventory(overrides: Partial<Inventory> = {}): Inventory {
  return { product: productInvRow(), variants: [], ...overrides };
}

const images: ProductImage[] = [];

describe('ProductEditorManager — inventory for a product with no options (MDF-226)', () => {
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

  async function mount(view: ManageView, inv: Inventory) {
    apiGet.mockImplementation((url: string) => {
      if (url.endsWith('/variants')) return Promise.resolve(view);
      if (url.endsWith('/inventory')) return Promise.resolve(inv);
      if (url.endsWith('/images')) return Promise.resolve(images);
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<ProductEditorManager productId="prod-1" />);
      await Promise.resolve();
      await Promise.resolve();
    });
    return container;
  }

  it('shows the product-level inventory card when the product has no options', async () => {
    const el = await mount(manageView({ options: [] }), inventory({ product: productInvRow({ quantity: 7, reserved: 1 }) }));
    expect(el.textContent).toContain('Inventory');
    expect(el.textContent).toContain('On hand:');
    expect(el.textContent).toContain('7');
    expect(el.textContent).toContain('Reserved: 1');
    expect(el.textContent).toContain('Apply adjustment');
    // The options-required messaging stays — this is additive, not a replacement.
    expect(el.textContent).toContain('No options yet');
  });

  it('adjusts the product-level row directly, with no ?variantId= on the request', async () => {
    apiPost.mockResolvedValue({});
    const el = await mount(manageView({ options: [] }), inventory({ product: productInvRow({ quantity: 7 }) }));

    const applyButton = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Apply adjustment')!;
    await act(async () => {
      applyButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(apiPost).toHaveBeenCalledWith('/vendor/products/prod-1/inventory/adjust', {
      delta: 1,
      reason: 'RESTOCK',
    });
  });

  it('hides the product-level inventory card once the product has options (regression: the with-options path is unaffected)', async () => {
    const view = manageView({
      options: [{ id: 'opt-1', name: 'Size', values: [{ id: 'val-1', value: 'Small' }] }],
      variants: [
        {
          id: 'var-1',
          title: 'Small',
          displayName: null,
          optionLabel: 'Small',
          sku: 'SKU-1',
          barcode: null,
          priceMinor: null,
          salePriceMinor: null,
          isActive: true,
          optionValueIds: ['val-1'],
          quantity: 12,
        },
      ],
    });
    const inv = inventory({
      product: productInvRow({ quantity: 0 }),
      variants: [productInvRow({ inventoryId: 'inv-var-1', variantId: 'var-1', quantity: 12 })],
    });
    const el = await mount(view, inv);

    // The variant's own inventory card is present (unchanged behavior)...
    expect(el.textContent).toContain('Small');
    expect(el.textContent).toContain('Apply adjustment');
    // ...but there is exactly one inventory control, not a second product-level one.
    const applyButtons = Array.from(el.querySelectorAll('button')).filter((b) => b.textContent === 'Apply adjustment');
    expect(applyButtons.length).toBe(1);
    expect(el.textContent).not.toContain('No options yet');
  });
});
