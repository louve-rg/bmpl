// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecipientAvailabilityWindow } from './RecipientAvailabilityWindow';

// react-dom's act() checks this flag; see StorefrontView.test.tsx / LocationPicker.test.tsx
// for the same convention (no @testing-library/react dependency in this repo).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const incomingAvailabilityWindow = vi.fn();
vi.mock('../../lib/shipping', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/shipping')>();
  return {
    ...actual,
    shippingApi: {
      ...actual.shippingApi,
      incomingAvailabilityWindow: (...args: unknown[]) => incomingAvailabilityWindow(...args),
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
  incomingAvailabilityWindow.mockReset();
});

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<RecipientAvailabilityWindow reference="BML-ABCD2345" />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

/**
 * BMPL-349/350: RecipientAvailabilityWindows.windows is optional on the web
 * type — web and api deploy independently, so there is a real window where
 * this GET returns a 200 with the key simply not there yet. Proven with a
 * real missing key (JSON round-trip + delete), same technique as
 * StorefrontView.test.tsx.
 */
describe('RecipientAvailabilityWindow — BMPL-349/350', () => {
  it('renders normally with a configured window', async () => {
    incomingAvailabilityWindow.mockResolvedValue({ reference: 'BML-ABCD2345', windows: [{ startTime: '09:00', endTime: '17:00' }] });
    const el = await mount();
    expect(el.textContent).toContain('Your delivery availability');
  });

  it('does not crash when windows is missing from the wire entirely', async () => {
    const raw = JSON.parse(JSON.stringify({ reference: 'BML-ABCD2345', windows: [] })) as Record<string, unknown>;
    delete raw.windows;
    incomingAvailabilityWindow.mockResolvedValue(raw);

    let threw = false;
    try {
      await mount();
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(container!.textContent).toContain('Your delivery availability');
    expect(container!.textContent).not.toContain('Currently:');
  });
});
