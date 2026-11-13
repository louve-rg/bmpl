// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EndpointPicker, emptyEndpoint, type EndpointValue } from './EndpointPicker';
import type { ShippingHub } from '../../lib/shipping';

// Same convention as page.test.tsx / LocationPicker.test.tsx: no
// @testing-library/react dependency in this repo.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HUB: ShippingHub = {
  id: 'hub-1',
  code: 'BZE',
  name: 'Belize City Hub',
  type: 'TERMINAL',
  district: 'BELIZE',
  city: 'Belize City',
  address: null,
  latitude: null,
  longitude: null,
  modes: ['LAND'],
  instructions: null,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
});

function mount(contactLabel: string, value: EndpointValue, onChange: (next: EndpointValue) => void) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <EndpointPicker
        label="Deliver to"
        contactLabel={contactLabel}
        value={value}
        onChange={onChange}
        hubs={[HUB]}
        allowDoor={false}
        allowHub={true}
      />,
    );
  });
}

const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
function setInputValue(input: HTMLInputElement, value: string) {
  act(() => {
    nativeInputValueSetter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function fieldset(): HTMLElement {
  const el = container!.querySelector<HTMLElement>('fieldset[aria-label="Deliver to"]');
  if (!el) throw new Error('no "Deliver to" fieldset');
  return el;
}

/**
 * MDF-746: a hub destination had no way to collect the recipient's email,
 * so the "collection ready" mail was a silent no-op for every parcel ending
 * at a terminal. These tests prove the field exists, is optional, explains
 * why it is worth giving, updates the value, and is scoped to the
 * destination (Recipient) side only -- a sender dropping off at a hub
 * themselves has nothing to be notified of.
 */
describe('EndpointPicker hub-destination recipient email (MDF-746)', () => {
  it('offers an optional email field on a hub destination, with an explanation of why it is worth giving', () => {
    mount('Recipient', { ...emptyEndpoint(), mode: 'HUB' }, vi.fn());
    const fs = fieldset();

    const label = Array.from(fs.querySelectorAll('span')).find((s) => /Recipient email/.test(s.textContent ?? ''));
    expect(label).toBeTruthy();
    expect(label!.textContent).toContain('(optional)');

    const input = fs.querySelector<HTMLInputElement>('input[type="email"]');
    expect(input).toBeTruthy();

    expect(fs.textContent).toContain('ready to collect');
  });

  it('calls onChange with the typed email, leaving every other field untouched', () => {
    const onChange = vi.fn();
    const value = { ...emptyEndpoint(), mode: 'HUB' as const, hubId: HUB.id, name: 'Jane Doe', phone: '501-222-3333' };
    mount('Recipient', value, onChange);

    const input = fieldset().querySelector<HTMLInputElement>('input[type="email"]')!;
    setInputValue(input, 'recipient@example.com');

    expect(onChange).toHaveBeenCalledWith({ ...value, email: 'recipient@example.com' });
  });

  it('does not offer an email field on a hub ORIGIN -- a sender dropping off at a hub has nothing to be notified of', () => {
    mount('Sender', { ...emptyEndpoint(), mode: 'HUB' }, vi.fn());
    expect(fieldset().querySelector('input[type="email"]')).toBeNull();
  });
});
