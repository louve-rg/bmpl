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

describe('ExceptionResolution — priced path (BMPL-364 "done means")', () => {
  it('a return names and charges the real configured price', async () => {
    apiPost.mockResolvedValueOnce({ available: true, totalMinor: 4500, pricingIncomplete: false });
    const el = mount(true);

    await clickAndFlush(findButton(el, 'Return to sender')!);
    expect(apiPost).toHaveBeenCalledWith('/admin/logistics/legs/leg_1/return-quote');
    expect(el.textContent).toContain('$45.00');

    const confirmBtn = findButton(el, 'Confirm return — charge $45.00');
    expect(confirmBtn).toBeTruthy();
    expect(confirmBtn!.hasAttribute('disabled')).toBe(true); // no note yet

    const textarea = el.querySelector('textarea')!;
    setValue(textarea, 'Customer refused delivery three times.');

    apiPost.mockResolvedValueOnce({ outcome: 'INITIATED', returnShipment: { reference: 'SHP-RET-1' } });
    await clickAndFlush(findButton(el, 'Confirm return — charge $45.00')!);

    expect(apiPost).toHaveBeenCalledWith('/admin/logistics/legs/leg_1/return-to-sender', { note: 'Customer refused delivery three times.' });
    expect(el.textContent).toContain('SHP-RET-1');
    expect(onResolved).toHaveBeenCalledTimes(1);
  });
});

describe('ExceptionResolution — free-reroute path (does not increase the charge)', () => {
  it('needs no payment-confirmation wording, but still states the price and requires one explicit click', async () => {
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

    apiPost.mockResolvedValueOnce({ available: true, totalMinor: 1200, increasesCharge: false, pricingIncomplete: false });
    await clickAndFlush(findButton(el, 'Get price')!);

    expect(apiPost).toHaveBeenCalledWith(
      '/admin/logistics/legs/leg_1/reroute-quote',
      expect.objectContaining({ destination: expect.objectContaining({ city: 'Belmopan', district: 'CAYO', name: 'Jane Doe' }) }),
    );
    expect(el.textContent).toContain('$12.00');
    expect(el.textContent).toContain('does not increase what the customer already paid');

    const label = 'Confirm reroute — $12.00, no change to what was already paid';
    const confirmBtn = findButton(el, label);
    expect(confirmBtn).toBeTruthy();
    expect(el.textContent).not.toMatch(/charge \$12\.00/i);

    const textarea = el.querySelector('textarea')!;
    setValue(textarea, 'Recipient moved to a new address.');

    apiPost.mockResolvedValueOnce({ outcome: 'INITIATED', rerouteShipment: { reference: 'SHP-RRT-1' } });
    await clickAndFlush(findButton(el, label)!);

    expect(el.textContent).toContain('SHP-RRT-1');
    expect(onResolved).toHaveBeenCalledTimes(1);
  });
});

describe('ExceptionResolution — PENDING_MANUAL path', () => {
  it('never offers a confirm button that would charge nothing, and records pending with no charge on submit', async () => {
    apiPost.mockResolvedValueOnce({ available: false, reason: 'NO_LANE', message: 'No courier lane is configured for this route yet.' });
    const el = mount(true);

    await clickAndFlush(findButton(el, 'Return to sender')!);
    expect(el.textContent).toContain('We cannot price this');
    expect(el.textContent).toContain('No courier lane is configured for this route yet.');

    const confirmBtn = findButton(el, 'Record as pending — no charge');
    expect(confirmBtn).toBeTruthy();
    expect(el.textContent).not.toMatch(/confirm return — charge/i);

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

describe('ExceptionResolution — permission split (operate can preview, only manage can confirm)', () => {
  it('an operate-only viewer sees the price but no confirm button', async () => {
    apiPost.mockResolvedValueOnce({ available: true, totalMinor: 4500, pricingIncomplete: false });
    const el = mount(false);

    await clickAndFlush(findButton(el, 'Return to sender')!);
    expect(el.textContent).toContain('$45.00');
    expect(findButton(el, 'Confirm return — charge $45.00')).toBeNull();
    expect(el.textContent).toContain('needs the stronger logistics-manage permission');
  });
});
