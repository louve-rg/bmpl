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

describe('LocationPicker — a GPS fix that arrives after the chunk has already failed', () => {
  /**
   * The race QA found: "Use my current location" is tapped WHILE the
   * Leaflet chunk is still loading — before `loadError` has flipped, so the
   * button is not yet disabled. The chunk import then fails while the real
   * device geolocation request is still in flight. `place()` silently
   * no-ops against the now-dead map (no `L`, no `map`) — before the fix
   * below, `useCurrentLocation`'s success callback reported "Location
   * detected" regardless, so the UI claimed success on a coordinate that
   * never reached `onChange` at all.
   */
  it('reports the map as unavailable instead of a false "Location detected" when the fix lands after the chunk fails', async () => {
    let resolvePosition: ((pos: GeolocationPosition) => void) | null = null;
    const getCurrentPosition = vi.fn((success: (pos: GeolocationPosition) => void) => {
      resolvePosition = success;
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });

    mount();
    const onChange = vi.fn();
    act(() => {
      root!.render(<LocationPicker value={null} onChange={onChange} />);
    });

    // No `flush()` yet — the chunk import is still pending, so the button is
    // not disabled. This is the exact window the race lives in.
    const current = findButton(container!, 'current location');
    expect(current.disabled).toBe(false);
    act(() => current.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);

    // NOW let the chunk import's rejection land, after the GPS request has
    // already started.
    await flush();
    expect(container!.textContent).toContain('couldn’t load');

    // The device returns a real, successful fix — after the map has died.
    act(() => resolvePosition!({ coords: { latitude: 17.5, longitude: -88.2, accuracy: 10 } } as GeolocationPosition));

    expect(onChange).not.toHaveBeenCalled();
    expect(container!.textContent).not.toContain('Location detected');
    expect(container!.textContent).toContain('your location couldn’t be placed on it');
  });
});

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
