// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecipientDeliveryCode } from './RecipientDeliveryCode';

// react-dom's act() checks this flag; see StorefrontView.test.tsx / LocationPicker.test.tsx
// for the same convention (no @testing-library/react dependency in this repo).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const incomingDeliveryCode = vi.fn();
vi.mock('../../lib/shipping', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/shipping')>();
  return {
    ...actual,
    shippingApi: {
      ...actual.shippingApi,
      incomingDeliveryCode: (...args: unknown[]) => incomingDeliveryCode(...args),
    },
  };
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  incomingDeliveryCode.mockReset();
});

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<RecipientDeliveryCode reference="BML-ABCD2345" />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

/**
 * CLOSE-2, linked-recipient path. `deliveryCode: null` is the headline case
 * worth a named test — the owner's own instruction was "render that as 'no
 * code to show', never as a failure", and this is where that gets checked
 * rather than just hoped for.
 */
describe('RecipientDeliveryCode', () => {
  it('shows the code when one is available', async () => {
    incomingDeliveryCode.mockResolvedValue({ reference: 'BML-ABCD2345', deliveryCode: '4821' });
    const el = await mount();
    expect(el.textContent).toContain('Your delivery code');
    expect(el.textContent).toContain('4821');
    expect(el.textContent).not.toMatch(/error|could not load/i);
  });

  it('renders null as "nothing to show", never as an error', async () => {
    incomingDeliveryCode.mockResolvedValue({ reference: 'BML-ABCD2345', deliveryCode: null });
    const el = await mount();
    expect(el.textContent).toContain('No delivery code to show for this parcel right now.');
    expect(el.textContent).not.toMatch(/error|could not load|failed/i);
  });

  it('shows an honest error only when the request itself fails', async () => {
    incomingDeliveryCode.mockRejectedValue({ status: 500, message: 'boom' });
    const el = await mount();
    expect(el.textContent).toContain('We could not load your delivery code right now.');
  });
});
