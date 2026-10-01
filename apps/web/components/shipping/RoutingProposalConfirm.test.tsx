// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoutingProposalConfirm } from './RoutingProposalConfirm';

// react-dom's act() checks this flag; see StorefrontView.test.tsx / LocationPicker.test.tsx
// for the same convention (no @testing-library/react dependency in this repo).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('../../lib/api', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const onConfirmed = vi.fn(async () => {});

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  onConfirmed.mockClear();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
});

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<RoutingProposalConfirm shipmentId="ship_1" onConfirmed={onConfirmed} />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

function findButton(el: HTMLElement, text: string) {
  return Array.from(el.querySelectorAll('button')).find((b) => b.textContent === text) ?? null;
}

async function clickAndFlush(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * BMPL-364/375: the customer's own confirmation of a staff-prepared return
 * or reroute. The three required paths (priced, free-of-ceremony-but-still-
 * confirmed reroute, and unpriceable) mirror the admin panel's own test
 * shape (ExceptionResolution.test.tsx) — this is the surface that replaced
 * it, same owner rules, customer-voiced.
 */
describe('RoutingProposalConfirm — nothing pending is the ordinary case', () => {
  it('renders nothing when the GET 404s (no proposal awaiting confirmation)', async () => {
    apiGet.mockRejectedValue({ status: 404, message: 'No return or reroute is awaiting your confirmation.' });
    const el = await mount();
    expect(el.textContent).toBe('');
  });
});

describe('RoutingProposalConfirm — priced path', () => {
  it('a return states the real price and charges exactly that on confirm', async () => {
    apiGet.mockResolvedValue({
      kind: 'RETURN',
      legId: 'leg_1',
      note: 'Customer refused delivery.',
      preparedAt: new Date().toISOString(),
      available: true,
      totalMinor: 4500,
      pricingIncomplete: false,
      pricingNote: null,
    });
    const el = await mount();

    expect(el.textContent).toContain('Return this shipment to you');
    expect(el.textContent).toContain('$45.00');
    expect(el.textContent).toContain('Customer refused delivery.');
    // Never reads as ALREADY charged/processed before confirmation —
    // "nothing is charged" (the honest negation) is fine and expected.
    expect(el.textContent).not.toMatch(/has been charged|is being processed|your return is/i);

    const confirmBtn = findButton(el, 'Confirm and pay $45.00')!;
    expect(confirmBtn).toBeTruthy();

    apiPost.mockResolvedValue({ outcome: 'INITIATED', returnShipment: { id: 'r1', reference: 'BML-RET0001', quotedTotalMinor: 4500 } });
    await clickAndFlush(confirmBtn);

    expect(apiPost).toHaveBeenCalledWith('/shipping/ship_1/routing-proposal/confirm');
    expect(el.textContent).toContain('BML-RET0001');
    expect(el.textContent).toContain('$45.00');
    expect(onConfirmed).toHaveBeenCalledTimes(1);
  });

  it('shows the ACTUAL charged amount even when it differs from the price shown at read time — not flagged as an error', async () => {
    apiGet.mockResolvedValue({
      kind: 'RETURN',
      legId: 'leg_1',
      note: 'n',
      preparedAt: new Date().toISOString(),
      available: true,
      totalMinor: 4500,
    });
    const el = await mount();
    expect(el.textContent).toContain('$45.00');

    apiPost.mockResolvedValue({ outcome: 'INITIATED', returnShipment: { id: 'r1', reference: 'BML-RET0002', quotedTotalMinor: 5200 } });
    await clickAndFlush(findButton(el, 'Confirm and pay $45.00')!);

    expect(el.textContent).toContain('$52.00');
    expect(el.textContent).not.toMatch(/error|wrong|mismatch/i);
  });
});

describe('RoutingProposalConfirm — every priced reroute confirms the same way (no free path)', () => {
  it('a reroute that costs more shows that fact but confirms identically to one that does not', async () => {
    apiGet.mockResolvedValue({
      kind: 'REROUTE',
      legId: 'leg_1',
      note: 'n',
      preparedAt: new Date().toISOString(),
      destination: { name: 'Jane Doe', address: '12 New St', city: 'Belmopan', district: 'CAYO' },
      available: true,
      totalMinor: 3200,
      legCostsMoreThanOriginal: true,
    });
    const el = await mount();
    expect(el.textContent).toContain('Redirect this shipment to a new address');
    expect(el.textContent).toContain('12 New St');
    expect(el.textContent).toContain('more than you already paid');
    expect(findButton(el, 'Confirm the new address and pay $32.00')).toBeTruthy();
  });

  it('a reroute that does not cost more still shows ONE explicit confirm button, never skipped', async () => {
    apiGet.mockResolvedValue({
      kind: 'REROUTE',
      legId: 'leg_1',
      note: 'n',
      preparedAt: new Date().toISOString(),
      destination: { name: 'Jane Doe', address: '12 New St', city: 'Belmopan', district: 'CAYO' },
      available: true,
      totalMinor: 1200,
      legCostsMoreThanOriginal: false,
    });
    const el = await mount();
    expect(el.textContent).toContain('does not change what you already paid');
    // Still requires the same explicit click — no "informational only" variant.
    expect(findButton(el, 'Confirm the new address and pay $12.00')).toBeTruthy();
  });
});

describe('RoutingProposalConfirm — unpriceable path (PENDING_MANUAL)', () => {
  it('never offers a confirm button that would burn the proposal for nothing', async () => {
    apiGet.mockResolvedValue({
      kind: 'RETURN',
      legId: 'leg_1',
      note: 'n',
      preparedAt: new Date().toISOString(),
      available: false,
      reason: 'NO_LANE',
      message: 'No courier lane is configured for this route yet.',
    });
    const el = await mount();
    expect(el.textContent).toContain('We could not calculate a price');
    expect(el.textContent).toContain('No courier lane is configured for this route yet.');
    expect(Array.from(el.querySelectorAll('button')).length).toBe(0);
  });
});
