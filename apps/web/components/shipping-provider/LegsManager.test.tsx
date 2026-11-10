// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LegsManager } from './LegsManager';
import type { ShippingProviderLeg } from '../../lib/shipping-provider';

// react-dom's act() checks this flag; no @testing-library/react in this repo
// (see RoutingProposalConfirm.test.tsx for the same convention).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * MDF-526: a carrier's own legs — accept/reject a proposal, record a
 * departure/arrival, set a schedule. Every gate asserted here reads a flag
 * `providerLegOut` already computes server-side (canAccept/canReject/
 * canDepart/canArrive/canSchedule); this never re-derives the state
 * machine, it only exercises the UI reading it.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('../../lib/api', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
}));

const PROPOSAL: ShippingProviderLeg = {
  id: 'leg_1',
  reference: 'SHP-2001',
  status: 'READY',
  mode: 'LAND',
  modeLabel: 'Road',
  from: { name: 'Belize City Hub', city: 'Belize City' },
  to: { name: 'San Pedro Hub', city: 'San Pedro' },
  pieces: 3,
  description: null,
  scheduledDepartureAt: null,
  scheduledArrivalAt: null,
  departedAt: null,
  arrivedAt: null,
  carrierName: null,
  carrierBookingRef: null,
  isTest: false,
  operatorAcceptedAt: null,
  operatorRejectedAt: null,
  canAccept: true,
  canReject: true,
  canDepart: false,
  canArrive: false,
  canSchedule: false,
};

const ACCEPTED: ShippingProviderLeg = {
  ...PROPOSAL,
  id: 'leg_2',
  reference: 'SHP-2002',
  operatorAcceptedAt: new Date().toISOString(),
  canAccept: false,
  canReject: false,
  canDepart: true,
  canArrive: false,
  canSchedule: true,
};

const ARRIVED: ShippingProviderLeg = {
  ...ACCEPTED,
  id: 'leg_3',
  reference: 'SHP-2003',
  status: 'IN_PROGRESS',
  arrivedAt: new Date().toISOString(),
  canDepart: false,
  canArrive: false,
  canSchedule: false,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

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

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<LegsManager />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

function findButton(text: string) {
  return Array.from(container!.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) ?? null;
}

const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;

function setValue(el: HTMLInputElement, value: string) {
  act(() => {
    nativeInputValueSetter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('LegsManager — a pending proposal', () => {
  it('offers Accept and Reject, never the depart/arrive/schedule controls', async () => {
    apiGet.mockResolvedValue([PROPOSAL]);
    await mount();

    expect(findButton('Accept')).toBeTruthy();
    expect(findButton('Reject')).toBeTruthy();
    expect(findButton('Record departure')).toBeNull();
    expect(findButton('Record arrival')).toBeNull();
    expect(findButton('Set schedule')).toBeNull();
  });

  it('accept posts an empty body to the accept route and reloads', async () => {
    apiGet.mockResolvedValue([PROPOSAL]);
    apiPost.mockResolvedValue({});
    await mount();

    await click(findButton('Accept')!);

    expect(apiPost).toHaveBeenCalledWith('/shipping/provider/legs/leg_1/accept', {});
    expect(apiGet).toHaveBeenCalledTimes(2); // initial load + reload after accept
  });

  it('reject refuses with no reason, matching the server’s own required-reason message', async () => {
    apiGet.mockResolvedValue([PROPOSAL]);
    await mount();

    await click(findButton('Reject')!);
    await click(findButton('Reject this leg')!);

    expect(container!.textContent).toContain('A reason is required.');
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('reject with a reason posts it to the reject route', async () => {
    apiGet.mockResolvedValue([PROPOSAL]);
    apiPost.mockResolvedValue({});
    await mount();

    await click(findButton('Reject')!);
    const reasonInput = container!.querySelector('input') as HTMLInputElement;
    setValue(reasonInput, 'Fleet unavailable this week.');
    await click(findButton('Reject this leg')!);

    expect(apiPost).toHaveBeenCalledWith('/shipping/provider/legs/leg_1/reject', { reason: 'Fleet unavailable this week.' });
  });
});

describe('LegsManager — an accepted leg', () => {
  it('offers depart and schedule, never accept/reject', async () => {
    apiGet.mockResolvedValue([ACCEPTED]);
    await mount();

    expect(findButton('Record departure')).toBeTruthy();
    expect(findButton('Set schedule')).toBeTruthy();
    expect(findButton('Accept')).toBeNull();
    expect(findButton('Reject')).toBeNull();
  });

  it('confirming departure posts to the depart route with the optional fields omitted when blank', async () => {
    apiGet.mockResolvedValue([ACCEPTED]);
    apiPost.mockResolvedValue({});
    await mount();

    await click(findButton('Record departure')!);
    await click(findButton('Confirm departure')!);

    expect(apiPost).toHaveBeenCalledWith('/shipping/provider/legs/leg_2/depart', { carrierName: undefined, carrierBookingRef: undefined });
  });
});

describe('LegsManager — MDF-611 carrier handoff-code reveal', () => {
  it('does not offer the reveal button before the leg has arrived', async () => {
    apiGet.mockResolvedValue([ACCEPTED]);
    await mount();

    expect(findButton('Reveal handoff code')).toBeNull();
  });

  it('does not offer the reveal button once the leg is COMPLETED, even with arrivedAt set', async () => {
    apiGet.mockResolvedValue([{ ...ARRIVED, status: 'COMPLETED' }]);
    await mount();

    expect(findButton('Reveal handoff code')).toBeNull();
  });

  it('offers the reveal button once arrived and not yet completed, and reveals the code from the dedicated endpoint', async () => {
    apiGet.mockResolvedValueOnce([ARRIVED]);
    apiGet.mockResolvedValueOnce({ kind: 'handoff', code: '4821', attempts: 0 });
    await mount();

    expect(findButton('Reveal handoff code')).toBeTruthy();
    await click(findButton('Reveal handoff code')!);

    expect(apiGet).toHaveBeenCalledWith('/shipping/provider/legs/leg_3/code');
    expect(container!.textContent).toContain('4821');
  });

  it('Hide clears the revealed code from the screen', async () => {
    apiGet.mockResolvedValueOnce([ARRIVED]);
    apiGet.mockResolvedValueOnce({ kind: 'handoff', code: '4821', attempts: 0 });
    await mount();

    await click(findButton('Reveal handoff code')!);
    expect(container!.textContent).toContain('4821');

    await click(findButton('Hide')!);
    expect(container!.textContent).not.toContain('4821');
  });
});

describe('LegsManager — access', () => {
  it('shows ApprovalRequired on a 403 instead of an empty or broken list', async () => {
    apiGet.mockRejectedValue({ status: 403, message: 'Forbidden' });
    await mount();

    expect(container!.textContent).toMatch(/Approval required/);
  });
});
