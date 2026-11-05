// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocationPicker } from './LocationPicker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * MDF-485 M1/M2 (owner behaviours 6 and 10). Two gaps the existing
 * LocationPicker suite didn't cover, because neither existed before this:
 *
 * - A standalone picker (no caller-supplied `address`) grows its own search
 *   box, so it needs no surrounding form to be useful on its own (M3 wants
 *   one picker three surfaces can share -- checkout, logistics, passenger
 *   booking -- and only one of those is guaranteed to already be typing an
 *   address into a nearby field).
 * - The full-screen map now stages its edits: "Use this location" commits
 *   them, closing any other way (X, Escape) discards them. Before this, both
 *   paths committed identically and immediately -- see the now-rewritten
 *   test in LocationPicker.test.tsx that used to assert exactly that.
 */
const apiGet = vi.fn();
vi.mock('../../lib/api', () => ({
  api: { get: (...args: unknown[]) => apiGet(...args) },
}));

vi.mock('leaflet', () => {
  function fakeMarker() {
    const marker: {
      setLatLng: ReturnType<typeof vi.fn>;
      getLatLng: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
      addTo: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
    } = {
      setLatLng: vi.fn(),
      getLatLng: vi.fn(() => ({ lat: 17.5, lng: -88.2 })),
      remove: vi.fn(),
      addTo: vi.fn(),
      on: vi.fn(),
    };
    marker.addTo.mockReturnValue(marker);
    marker.on.mockReturnValue(marker);
    return marker;
  }
  function fakeMap() {
    return {
      setView: vi.fn(),
      on: vi.fn(),
      getZoom: vi.fn(() => 13),
      invalidateSize: vi.fn(),
      remove: vi.fn(),
      fitBounds: vi.fn(),
      dragging: { enable: vi.fn(), disable: vi.fn() },
    };
  }
  const L = {
    map: vi.fn(() => fakeMap()),
    tileLayer: vi.fn(() => ({ addTo: vi.fn().mockReturnThis() })),
    divIcon: vi.fn(() => ({})),
    marker: vi.fn(() => fakeMarker()),
    latLngBounds: vi.fn(() => ({})),
    circle: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), remove: vi.fn(), getBounds: vi.fn(() => ({})) })),
    Marker: { prototype: { options: {} as Record<string, unknown> } },
  };
  return { default: L };
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
  apiGet.mockReset();
  vi.clearAllMocks();
});

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

async function clickMap(lat: number, lng: number) {
  const leaflet = (await import('leaflet')).default as unknown as { map: ReturnType<typeof vi.fn> };
  const mapInstance = leaflet.map.mock.results.at(-1)!.value as { on: ReturnType<typeof vi.fn> };
  const onClick = mapInstance.on.mock.calls.find((c: unknown[]) => c[0] === 'click')?.[1] as
    | ((e: { latlng: { lat: number; lng: number } }) => void)
    | undefined;
  if (!onClick) throw new Error('map has no click handler registered');
  act(() => onClick({ latlng: { lat, lng } }));
}

describe('LocationPicker standalone search box (MDF-485 M1/M2, owner behaviour 6)', () => {
  it('renders its own search box when no address prop is given, and no "Show my address" button', async () => {
    mount();
    act(() => {
      root!.render(<LocationPicker value={null} onChange={() => {}} />);
    });
    await flush();

    expect(container!.querySelector('input[aria-label*="Search for an address"]')).not.toBeNull();
    expect(
      Array.from(container!.querySelectorAll('button')).some((b) => b.getAttribute('aria-label')?.includes('Show the address')),
    ).toBe(false);
  });

  it('does not render the standalone search box when the caller supplies an address, and keeps "Show my address"', async () => {
    mount();
    act(() => {
      root!.render(<LocationPicker value={null} onChange={() => {}} address="12 Front St, Belize City" />);
    });
    await flush();

    expect(container!.querySelector('input[aria-label*="Search for an address"]')).toBeNull();
    expect(findButton(container!, 'Show the address')).not.toBeNull();
  });

  it('searches the typed query, not any address prop, and places the pin on the best match', async () => {
    apiGet.mockResolvedValue({ results: [{ label: 'Radisson Fort George Hotel', latitude: 17.503, longitude: -88.197 }] });
    mount();
    const onChange = vi.fn();
    act(() => {
      root!.render(<LocationPicker value={null} onChange={onChange} />);
    });
    await flush();

    const input = container!.querySelector('input[aria-label*="Search for an address"]') as HTMLInputElement;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      nativeInputValueSetter.call(input, 'Radisson Fort George Hotel');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      findButton(container!, 'Search for this on the map').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(apiGet).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent('Radisson Fort George Hotel')));
    expect(onChange).toHaveBeenCalledWith({ latitude: 17.503, longitude: -88.197 });
  });

  it('disables the search button until something is typed', async () => {
    mount();
    act(() => {
      root!.render(<LocationPicker value={null} onChange={() => {}} />);
    });
    await flush();

    expect(findButton(container!, 'Search for this on the map').disabled).toBe(true);
  });

  // Nominatim's published policy is ~1 request/sec; the API already
  // serialises its own calls to respect it, but a search-as-you-type box on
  // THIS side would still breach that policy from a single user typing. The
  // search here is submit-driven only -- never a request per keystroke.
  it('makes no request from typing alone -- only the explicit search action does (Nominatim ~1 req/sec policy)', async () => {
    mount();
    act(() => {
      root!.render(<LocationPicker value={null} onChange={() => {}} />);
    });
    await flush();

    const input = container!.querySelector('input[aria-label*="Search for an address"]') as HTMLInputElement;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    for (const partial of ['R', 'Ra', 'Rad', 'Radisson']) {
      act(() => {
        nativeInputValueSetter.call(input, partial);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    await flush();

    expect(apiGet).not.toHaveBeenCalled();
  });
});

describe('LocationPicker full-screen confirm/cancel (MDF-485 M1/M2, owner behaviour 10)', () => {
  // RULING (god, 2026-11-05): cancel is an UNDO at the MODAL'S boundary, not
  // a staged draft inside the picker -- `AddressField`'s `movedFromSaved`
  // (and anything else in checkout keyed on live pin movement) reacts to
  // `onChange` immediately, and staging would silently break that as a side
  // effect of adding a button. So every tap/drag inside the full-screen map
  // still reaches the caller immediately, exactly like the embedded map
  // (LocationPicker.test.tsx's own test of that is unmodified). What's new
  // is only what happens at dismissal: X/Escape replay the value the picker
  // had the moment it opened, undoing whatever was placed meanwhile;
  // "Use this location" does nothing extra, because the right value is
  // already live by then.
  it('confirming ("Use this location") does not revert -- whatever was placed while the modal was open stays', async () => {
    mount();
    const onChange = vi.fn();
    act(() => {
      root!.render(<LocationPicker value={null} onChange={onChange} />);
    });
    await flush();
    act(() => findButton(container!, 'full screen').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();

    await clickMap(17.5, -88.2);
    expect(onChange).toHaveBeenCalledWith({ latitude: 17.5, longitude: -88.2 });
    onChange.mockClear();

    act(() => findButton(document.body, 'Use this location').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();

    // Confirm is a no-op on top of the live commit -- no further onChange call.
    expect(onChange).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('dismissing the full-screen map with X undoes a pin placed while it was open, by replaying the value it opened with', async () => {
    mount();
    const onChange = vi.fn();
    act(() => {
      root!.render(<LocationPicker value={{ latitude: 17.4995, longitude: -88.1976 }} onChange={onChange} />);
    });
    await flush();
    act(() => findButton(container!, 'full screen').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();

    await clickMap(16.0, -89.0);
    expect(onChange).toHaveBeenCalledWith({ latitude: 16.0, longitude: -89.0 });
    onChange.mockClear();

    act(() => findButton(document.body, 'Close map').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();

    // The undo: X replays the OPENING value, overriding the 16.0/-89.0 tap.
    expect(onChange).toHaveBeenCalledWith({ latitude: 17.4995, longitude: -88.1976 });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('dismissing with X when nothing was placed replays the same value it opened with -- a harmless no-op', async () => {
    mount();
    const onChange = vi.fn();
    act(() => {
      root!.render(<LocationPicker value={{ latitude: 17.4995, longitude: -88.1976 }} onChange={onChange} />);
    });
    await flush();
    act(() => findButton(container!, 'full screen').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();

    act(() => findButton(document.body, 'Close map').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();

    for (const [arg] of onChange.mock.calls) {
      expect(arg).toEqual({ latitude: 17.4995, longitude: -88.1976 });
    }
  });
});
