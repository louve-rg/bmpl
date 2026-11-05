// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocationPicker } from './LocationPicker';

// react-dom's act() checks this flag; see use-dialog-focus-trap.test.tsx for
// the same convention (no @testing-library/react dependency in this repo).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Edward REQ 8: the embedded picker is a fixed 256px box — workable for a
 * glance, cramped for dragging a pin precisely with a thumb. LocationPicker
 * now renders a bigger picker inside FullScreenMapModal on request, reusing
 * the ExpandableRouteMap/MapPreview pattern: two independent Leaflet
 * instances, never both mounted (BMPL-210). These tests exercise that
 * mounting discipline and the confirm path against a minimal fake Leaflet —
 * real Leaflet needs a real browser canvas/viewport jsdom does not provide.
 */
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

describe('LocationPicker full-screen picking (Edward REQ 8)', () => {
  it('starts embedded, with no full-screen dialog in the document', async () => {
    mount();
    act(() => {
      root!.render(<LocationPicker value={null} onChange={() => {}} />);
    });
    await flush();

    expect(container!.querySelectorAll('[role="application"]')).toHaveLength(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('opens exactly one live map, full screen, when "Full screen" is tapped — never two at once', async () => {
    mount();
    act(() => {
      root!.render(<LocationPicker value={null} onChange={() => {}} />);
    });
    await flush();

    act(() => findButton(container!, 'full screen').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();

    // The embedded map is unmounted, not merely covered — the same BMPL-210
    // discipline ExpandableRouteMap already applies, now here too. (Both
    // LocationPicker and FullScreenMapModal render into the same React tree
    // — no portal — so this checks OUTSIDE the dialog specifically.)
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const maps = Array.from(document.querySelectorAll('[role="application"]'));
    expect(maps).toHaveLength(1);
    expect(dialog!.contains(maps[0]!)).toBe(true);
  });

  it('a full-width, thumb-sized confirm button closes the modal and restores the embedded map', async () => {
    mount();
    act(() => {
      root!.render(<LocationPicker value={null} onChange={() => {}} />);
    });
    await flush();
    act(() => findButton(container!, 'full screen').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();

    const confirm = findButton(document.body, 'Use this location');
    expect(confirm.className).toMatch(/min-h-\[48px\]/);
    expect(confirm.className).toMatch(/w-full/);

    act(() => confirm.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container!.querySelectorAll('[role="application"]')).toHaveLength(1);
  });

  // MDF-485 M1/M2, owner behaviour 10: a pin placed on the full-screen map
  // used to reach the caller immediately, same as the embedded map -- that
  // assertion moved to LocationPicker.search.test.tsx and was INVERTED on
  // purpose. The full-screen map now stages a draft; only "Use this
  // location" commits it, and X/Escape discard it. See the "full-screen
  // confirm/cancel" describe block there for the replacement coverage.
  // (god, 2026-11-05: re-verified the diff directly and confirmed the
  // inversion was correct -- the staging is scoped to the modal body only,
  // so this doesn't touch the embedded map's own live-commit behaviour.)
});

describe('LocationPicker coordinates display (MDF-485 M1/M2, owner behaviour 9)', () => {
  it('shows the coordinates the instant a pin exists, with no tap -- not behind a <details>', async () => {
    mount();
    act(() => {
      root!.render(<LocationPicker value={{ latitude: 17.4995, longitude: -88.1976 }} onChange={() => {}} />);
    });
    await flush();

    expect(container!.querySelector('details')).toBeNull();
    expect(container!.textContent).toContain('17.499500, -88.197600');
  });

  it('shows nothing coordinate-shaped when there is no pin yet', async () => {
    mount();
    act(() => {
      root!.render(<LocationPicker value={null} onChange={() => {}} />);
    });
    await flush();

    expect(container!.textContent).not.toMatch(/-?\d+\.\d{6}/);
  });
});

describe('LocationPicker repositioning an existing pin (MDF-376 section 6: placement AND repositioning)', () => {
  it('dragging the marker reports the DRAGGED coordinates, not the ones it was seeded with', async () => {
    mount();
    const onChange = vi.fn();
    act(() => {
      root!.render(<LocationPicker value={{ latitude: 17.4995, longitude: -88.1976 }} onChange={onChange} />);
    });
    await flush();

    const leaflet = (await import('leaflet')).default as unknown as { marker: ReturnType<typeof vi.fn> };
    const markerInstance = leaflet.marker.mock.results.at(-1)!.value as {
      getLatLng: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
    };
    const onDragEnd = markerInstance.on.mock.calls.find((c: unknown[]) => c[0] === 'dragend')?.[1] as
      | (() => void)
      | undefined;
    expect(onDragEnd).toBeTruthy();

    // Leaflet moves the marker itself, THEN fires dragend; the component
    // reads the new position back out via getLatLng() at that point, not
    // from whatever it was created with — the mock has to report the
    // dragged position at call time for this to mean anything.
    markerInstance.getLatLng.mockReturnValue({ lat: 17.52, lng: -88.21 });
    onChange.mockClear();
    act(() => onDragEnd!());

    expect(onChange).toHaveBeenCalledWith({ latitude: 17.52, longitude: -88.21 });
    expect(onChange).not.toHaveBeenCalledWith({ latitude: 17.4995, longitude: -88.1976 });
  });
});
