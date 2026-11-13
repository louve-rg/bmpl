// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecipientCollectionCode } from './RecipientCollectionCode';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const incomingCollectionCode = vi.fn();
vi.mock('../../lib/shipping', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/shipping')>();
  return {
    ...actual,
    shippingApi: {
      ...actual.shippingApi,
      incomingCollectionCode: (...args: unknown[]) => incomingCollectionCode(...args),
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
  incomingCollectionCode.mockReset();
});

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<RecipientCollectionCode reference="BML-ABCD2345" />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

/**
 * MDF-738 (Item 11): the linked-recipient counterpart to
 * RecipientDeliveryCode -- the whole point of this card is that this
 * component DID NOT EXIST, so a signed-in recipient had no screen for the
 * fact an unlinked stranger could already get via #700's mail/token path.
 */
describe('RecipientCollectionCode', () => {
  it('shows the code when one is available, with no token/email step -- being signed in as the linked recipient IS the authentication', async () => {
    incomingCollectionCode.mockResolvedValue({ reference: 'BML-ABCD2345', collectionCode: '7731' });
    const el = await mount();

    expect(incomingCollectionCode).toHaveBeenCalledWith('BML-ABCD2345');
    expect(el.textContent).toContain('Your collection code');
    expect(el.textContent).toContain('7731');
    expect(el.textContent).not.toMatch(/error|could not load/i);
  });

  it('renders null as "nothing to show", never as an error', async () => {
    incomingCollectionCode.mockResolvedValue({ reference: 'BML-ABCD2345', collectionCode: null });
    const el = await mount();

    expect(el.textContent).toContain('No collection code to show for this parcel right now.');
    expect(el.textContent).not.toMatch(/error|could not load|failed/i);
  });

  it('shows an honest error only when the request itself fails', async () => {
    incomingCollectionCode.mockRejectedValue({ status: 500, message: 'boom' });
    const el = await mount();

    expect(el.textContent).toContain('We could not load your collection code right now.');
  });
});
