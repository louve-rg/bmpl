// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusBadge } from './ui';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
});

function mount(el: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(el);
  });
  return container;
}

/**
 * P2-SHIPMENT-PARITY: `label` is optional and additive. Every pre-existing
 * caller passes only `status` and must keep rendering the title-cased raw
 * enum exactly as before — that is the regression this file guards against
 * while a handful of callers (driver job screens) start passing a real
 * server-computed label for the same status value.
 */
describe('StatusBadge', () => {
  it('renders the title-cased raw status when no label is given — unchanged default behavior', () => {
    const el = mount(<StatusBadge status="DRIVER_ACCEPTED" />);
    expect(el.textContent).toContain('DRIVER ACCEPTED');
  });

  it('renders the given label instead of the raw status once a caller supplies one', () => {
    const el = mount(<StatusBadge status="DRIVER_ACCEPTED" label="Driver accepted" />);
    expect(el.textContent).toContain('Driver accepted');
    expect(el.textContent).not.toMatch(/DRIVER ACCEPTED/);
  });

  it('still derives tone from the raw status, not the label', () => {
    // COMPLETED tones success (emerald dot); the label text must not change that.
    const el = mount(<StatusBadge status="COMPLETED" label="Delivered" />);
    expect(el.querySelector('.bg-emerald-500')).not.toBeNull();
  });
});
