// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * VendorPickupPanel gains an OPTIONAL "Start preparing" step, mirroring
 * VendorFulfilmentPanel's delivery flow (god, conv-modules-2026-10-14,
 * Edward req 10 follow-on to #409). Pins: PENDING shows both buttons
 * (preparing stays optional — PENDING -> ready remains reachable directly);
 * PREPARING shows only "Mark ready for pickup", never "Start preparing"
 * again; "Mark ready for pickup" posts to the UNIFIED `/ready` endpoint
 * (`vendorMarkReady`) from either state, never the deprecated
 * `/ready-for-pickup` route (whose client wrapper, `vendorReadyForPickup`,
 * has since been deleted from `lib/orders.ts` as dead code — this negative
 * assertion now pins the HTTP call shape directly, not a wrapper that no
 * longer exists); a failed action shows the real error and recovers, never
 * a false success; the existing READY_FOR_PICKUP/PICKED_UP/CANCELLED states
 * are untouched.
 */

const apiPost = vi.fn();
vi.mock('../lib/api', () => ({ api: { post: (...a: unknown[]) => apiPost(...a), get: vi.fn() } }));

import { VendorPickupPanel } from './VendorPickupPanel';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
  root = null;
  container = null;
  apiPost.mockReset();
});

async function render(status: string, overrides: { pickedUpAt?: string | null } = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const onChanged = vi.fn();
  await act(async () => {
    root!.render(
      <VendorPickupPanel
        vendorOrderId="vo-1"
        status={status}
        pickedUpAt={overrides.pickedUpAt ?? null}
        onChanged={onChanged}
      />,
    );
  });
  return { onChanged };
}

function button(text: string): HTMLButtonElement | null {
  return Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === text) ?? null;
}

async function click(b: HTMLButtonElement) {
  await act(async () => {
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('PENDING — preparing stays optional', () => {
  it('shows both Start preparing and Mark ready for pickup', async () => {
    await render('PENDING');
    expect(button('Start preparing')).not.toBeNull();
    expect(button('Mark ready for pickup')).not.toBeNull();
  });

  it('Start preparing posts to start-preparing and triggers onChanged on success', async () => {
    apiPost.mockResolvedValueOnce({ id: 'vo-1', status: 'PREPARING' });
    const { onChanged } = await render('PENDING');
    await click(button('Start preparing')!);
    expect(apiPost).toHaveBeenCalledWith('/vendor/orders/vo-1/start-preparing');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('Mark ready for pickup from PENDING posts to the UNIFIED /ready endpoint, not /ready-for-pickup', async () => {
    apiPost.mockResolvedValueOnce({ id: 'vo-1', status: 'READY_FOR_PICKUP' });
    const { onChanged } = await render('PENDING');
    await click(button('Mark ready for pickup')!);
    expect(apiPost).toHaveBeenCalledWith('/vendor/orders/vo-1/ready');
    expect(apiPost).not.toHaveBeenCalledWith('/vendor/orders/vo-1/ready-for-pickup');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('a failed Start preparing shows the real error, not a false success, and the button recovers', async () => {
    apiPost.mockRejectedValueOnce({ status: 409, message: 'This order is already preparing.' });
    const { onChanged } = await render('PENDING');
    await click(button('Start preparing')!);
    expect(container!.textContent).toContain('This order is already preparing.');
    expect(onChanged).not.toHaveBeenCalled();
    expect(button('Start preparing')).not.toBeNull();
    expect(button('Start preparing')!.disabled).toBe(false);
  });

  it('shows a spinner (no visible label) on the button being pressed, while leaving the other one', async () => {
    let resolvePost: (v: unknown) => void = () => {};
    apiPost.mockImplementationOnce(() => new Promise((resolve) => (resolvePost = resolve)));
    await render('PENDING');
    await act(async () => {
      button('Start preparing')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(button('Start preparing')).toBeNull(); // label replaced by the spinner, same convention as VendorFulfilmentPanel
    expect(button('Mark ready for pickup')!.disabled).toBe(true); // both disabled while any action is in flight
    await act(async () => {
      resolvePost({ id: 'vo-1', status: 'PREPARING' });
      await Promise.resolve();
    });
  });
});

describe('PREPARING — Start preparing never reappears', () => {
  it('shows only Mark ready for pickup', async () => {
    await render('PREPARING');
    expect(button('Start preparing')).toBeNull();
    expect(button('Mark ready for pickup')).not.toBeNull();
  });

  it('Mark ready for pickup from PREPARING also posts to the unified /ready endpoint', async () => {
    apiPost.mockResolvedValueOnce({ id: 'vo-1', status: 'READY_FOR_PICKUP' });
    const { onChanged } = await render('PREPARING');
    await click(button('Mark ready for pickup')!);
    expect(apiPost).toHaveBeenCalledWith('/vendor/orders/vo-1/ready');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('a failed Mark ready for pickup from PREPARING shows the real error and recovers', async () => {
    apiPost.mockRejectedValueOnce({ status: 409, message: 'Cannot ready a preparing order.' });
    const { onChanged } = await render('PREPARING');
    await click(button('Mark ready for pickup')!);
    expect(container!.textContent).toContain('Cannot ready a preparing order.');
    expect(onChanged).not.toHaveBeenCalled();
    expect(button('Mark ready for pickup')).not.toBeNull();
  });
});

describe('existing states, unchanged', () => {
  it('READY_FOR_PICKUP still shows the PIN confirm form, not the preparing controls', async () => {
    await render('READY_FOR_PICKUP');
    expect(button('Start preparing')).toBeNull();
    expect(button('Mark ready for pickup')).toBeNull();
    expect(container!.querySelector('input[aria-label="Pickup code"]')).not.toBeNull();
    expect(button('Confirm pickup')).not.toBeNull();
  });

  it('confirming pickup still posts to confirm-pickup with the trimmed PIN', async () => {
    apiPost.mockResolvedValueOnce({ status: 'PICKED_UP' });
    const { onChanged } = await render('READY_FOR_PICKUP');
    const input = container!.querySelector<HTMLInputElement>('input[aria-label="Pickup code"]')!;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      nativeSetter.call(input, ' 4821 ');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(button('Confirm pickup')!);
    expect(apiPost).toHaveBeenCalledWith('/vendor/orders/vo-1/confirm-pickup', { pin: '4821' });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('PICKED_UP shows the collected confirmation with the timestamp', async () => {
    await render('PICKED_UP', { pickedUpAt: '2026-10-14T12:00:00.000Z' });
    expect(container!.textContent).toContain('Collected');
    expect(button('Start preparing')).toBeNull();
    expect(button('Mark ready for pickup')).toBeNull();
  });

  it('CANCELLED shows the cancelled message and no action buttons', async () => {
    await render('CANCELLED');
    expect(container!.textContent).toContain('This order was cancelled.');
    expect(button('Start preparing')).toBeNull();
    expect(button('Mark ready for pickup')).toBeNull();
  });
});
