// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocationPicker } from './LocationPicker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * MDF-376 section 6 (owner directive): "the map failing to load" is one of
 * the named failure paths and needs a defined, readable state -- not a
 * blank frame. Before this, a rejected `import('leaflet')` (a chunk load
 * failure, an offline customer, an ad blocker on the OSM request) left the
 * picker stuck on "Loading map…" forever, indistinguishable from an
 * ordinary slow load, with "Use my current location" and "Show my address"
 * still enabled and silently doing nothing when pressed (both end up
 * calling `place()`, a no-op without a live map instance).
 */
vi.mock('leaflet', () => {
  throw new Error('chunk load failed');
});
vi.mock('leaflet/dist/leaflet.css', () => ({}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
  root = null;
  container = null;
  vi.clearAllMocks();
});

/** Lets the dynamic `import('leaflet')` inside the build effect settle. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
}

function findButton(root: ParentNode, matchLabel: string): HTMLButtonElement {
  const btn = Array.from(root.querySelectorAll('button')).find(
    (b) => b.getAttribute('aria-label')?.includes(matchLabel) || b.textContent === matchLabel,
  );
  if (!btn) throw new Error(`No button found matching "${matchLabel}"`);
  return btn;
}

describe('LocationPicker when the map itself fails to load', () => {
  it('shows a readable explanation instead of "Loading map…" forever', async () => {
    mount();
    act(() => {
      root!.render(<LocationPicker value={null} onChange={() => {}} />);
    });
    await flush();

    expect(container!.textContent).toContain('couldn’t load');
    expect(container!.textContent).not.toContain('Loading map');
  });

  it('disables the controls that only work through a live map, rather than letting them silently do nothing', async () => {
    mount();
    const onChange = vi.fn();
    act(() => {
      root!.render(<LocationPicker value={null} onChange={onChange} />);
    });
    await flush();

    const current = findButton(container!, 'current location');
    const showAddress = findButton(container!, 'Show the address');
    const fullScreen = findButton(container!, 'full screen');
    expect(current.disabled).toBe(true);
    expect(showAddress.disabled).toBe(true);
    expect(fullScreen.disabled).toBe(true);

    // Even if something still dispatched a click, nothing reaches the caller
    // — the real pre-fix bug was a control that looked live but did nothing.
    act(() => current.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();
    expect(onChange).not.toHaveBeenCalled();
  });
});
