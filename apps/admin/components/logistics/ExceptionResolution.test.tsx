// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExceptionResolution } from './ExceptionResolution';

// react-dom's act() checks this flag; see VariantCard.test.tsx / LocationPicker.test.tsx
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

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const onResolved = vi.fn(async () => {});

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  onResolved.mockClear();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
});

function mount(canManage: boolean) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<ExceptionResolution legId="leg_1" canManage={canManage} onResolved={onResolved} />);
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

function setValue(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/**
 * BMPL-375: this panel no longer charges anyone — it PREPARES a return or
 * reroute, and only the shipment's own customer (on a separate surface,
 * apps/web's RoutingProposalConfirm) can turn that into a real charge.
 * These tests were "does this charge correctly" before; they are now
 * "does this prepare correctly, and never claim to have charged anyone."
 */
describe('ExceptionResolution — priced path, now PREPARES rather than charges (BMPL-375)', () => {
  it('a return names the real price and prepares it, never claiming a charge happened', async () => {
    apiPost.mockResolvedValueOnce({ available: true, totalMinor: 4500, pricingIncomplete: false });
    const el = mount(true);

    await clickAndFlush(findButton(el, 'Return to sender')!);
    expect(apiPost).toHaveBeenCalledWith('/admin/logistics/legs/leg_1/return-quote');
    expect(el.textContent).toContain('$45.00');

    const confirmBtn = findButton(el, 'Prepare return — $45.00');
    expect(confirmBtn).toBeTruthy();
    expect(confirmBtn!.hasAttribute('disabled')).toBe(true); // no note yet

    const textarea = el.querySelector('textarea')!;
    setValue(textarea, 'Customer refused delivery three times.');

    apiPost.mockResolvedValueOnce({ outcome: 'PREPARED', totalMinor: 4500 });
    await clickAndFlush(findButton(el, 'Prepare return — $45.00')!);

    expect(apiPost).toHaveBeenCalledWith('/admin/logistics/legs/leg_1/return-to-sender', { note: 'Customer refused delivery three times.' });
    expect(el.textContent).toContain('Prepared — waiting on the customer');
    expect(el.textContent).toContain('Nothing is booked and nothing is charged yet');
    expect(el.textContent).not.toMatch(/has been charged|has been booked/i);
    expect(onResolved).toHaveBeenCalledTimes(1);
  });
});

describe('ExceptionResolution — every priced reroute prepares the same way, no free path (BMPL-375)', () => {
  it('a reroute that does not cost more than the original still requires the same explicit prepare click', async () => {
    const el = mount(true);
    await clickAndFlush(findButton(el, 'Reroute to a new address')!);

    const [addressInput, cityInput] = Array.from(el.querySelectorAll('input'));
    setValue(addressInput!, '12 New St');
    setValue(cityInput!, 'Belmopan');
    const selects = Array.from(el.querySelectorAll('select'));
    setValue(selects[0]!, 'CAYO'); // district select
    const inputs = Array.from(el.querySelectorAll('input'));
    setValue(inputs[2]!, 'Jane Doe'); // name
    setValue(inputs[3]!, '601-2345'); // phone

    apiPost.mockResolvedValueOnce({ available: true, totalMinor: 1200, legCostsMoreThanOriginal: false, pricingIncomplete: false });
    await clickAndFlush(findButton(el, 'Get price')!);

    expect(apiPost).toHaveBeenCalledWith(
      '/admin/logistics/legs/leg_1/reroute-quote',
      expect.objectContaining({ destination: expect.objectContaining({ city: 'Belmopan', district: 'CAYO', name: 'Jane Doe' }) }),
    );
    expect(el.textContent).toContain('$12.00');
    expect(el.textContent).toContain('does not cost more than what the customer already paid');

    const label = 'Prepare reroute — $12.00';
    const confirmBtn = findButton(el, label);
    expect(confirmBtn).toBeTruthy();
    expect(el.textContent).not.toMatch(/charge \$12\.00/i);

    const textarea = el.querySelector('textarea')!;
    setValue(textarea, 'Recipient moved to a new address.');

    apiPost.mockResolvedValueOnce({ outcome: 'PREPARED', totalMinor: 1200, legCostsMoreThanOriginal: false });
    await clickAndFlush(findButton(el, label)!);

    expect(el.textContent).toContain('Prepared — waiting on the customer');
    expect(onResolved).toHaveBeenCalledTimes(1);
  });

  it('a reroute that costs more than the original prepares identically — informational text differs, the button does not gate on it', async () => {
    const el = mount(true);
    await clickAndFlush(findButton(el, 'Reroute to a new address')!);
    setValue(Array.from(el.querySelectorAll('input'))[0]!, '12 New St');
    setValue(Array.from(el.querySelectorAll('input'))[1]!, 'Belmopan');
    setValue(Array.from(el.querySelectorAll('select'))[0]!, 'CAYO');
    setValue(Array.from(el.querySelectorAll('input'))[2]!, 'Jane Doe');
    setValue(Array.from(el.querySelectorAll('input'))[3]!, '601-2345');

    apiPost.mockResolvedValueOnce({ available: true, totalMinor: 3200, legCostsMoreThanOriginal: true, pricingIncomplete: false });
    await clickAndFlush(findButton(el, 'Get price')!);

    expect(el.textContent).toContain('costs more than what the customer already paid');
    expect(findButton(el, 'Prepare reroute — $32.00')).toBeTruthy();
  });
});

describe('ExceptionResolution — PENDING_MANUAL path', () => {
  it('never offers a prepare button that would charge nothing, and records pending with no charge on submit', async () => {
    apiPost.mockResolvedValueOnce({ available: false, reason: 'NO_LANE', message: 'No courier lane is configured for this route yet.' });
    const el = mount(true);

    await clickAndFlush(findButton(el, 'Return to sender')!);
    expect(el.textContent).toContain('We cannot price this');
    expect(el.textContent).toContain('No courier lane is configured for this route yet.');

    const confirmBtn = findButton(el, 'Record as pending — no charge');
    expect(confirmBtn).toBeTruthy();
    expect(el.textContent).not.toMatch(/prepare return/i);

    const textarea = el.querySelector('textarea')!;
    setValue(textarea, 'Needs a human to route this manually.');

    apiPost.mockResolvedValueOnce({ outcome: 'PENDING_MANUAL', reason: 'No courier lane is configured for this route yet.' });
    await clickAndFlush(findButton(el, 'Record as pending — no charge')!);

    expect(el.textContent).toContain('Nothing was charged');
    expect(onResolved).toHaveBeenCalledTimes(1);
  });

  it('treats a technically-available zero price the same honest way, never as a free success', async () => {
    apiPost.mockResolvedValueOnce({ available: true, totalMinor: 0, pricingIncomplete: true, pricingNote: 'No courier fee is configured for HUB_BZ.' });
    const el = mount(true);

    await clickAndFlush(findButton(el, 'Return to sender')!);
    expect(el.textContent).toContain('No courier fee is configured for HUB_BZ.');
    expect(findButton(el, 'Record as pending — no charge')).toBeTruthy();
  });
});

describe('ExceptionResolution — permission split (operate can preview, only manage can prepare)', () => {
  it('an operate-only viewer sees the price but no prepare button', async () => {
    apiPost.mockResolvedValueOnce({ available: true, totalMinor: 4500, pricingIncomplete: false });
    const el = mount(false);

    await clickAndFlush(findButton(el, 'Return to sender')!);
    expect(el.textContent).toContain('$45.00');
    expect(findButton(el, 'Prepare return — $45.00')).toBeNull();
    expect(el.textContent).toContain('needs the stronger logistics-manage permission');
  });
});
