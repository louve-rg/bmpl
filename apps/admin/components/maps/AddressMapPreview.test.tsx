// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddressMapPreview } from './AddressMapPreview';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * MDF-538: admin's own tap-to-load map preview, built from the primitives
 * ported from apps/web (MapPreview, FullScreenMapModal, cooperative-map-
 * drag, MapPoint/labelStops -- see this component's own header comment for
 * why they're a port rather than a packages/ui extraction). Same fake
 * Leaflet shape as apps/web's own map tests -- jsdom has no real canvas for
 * Leaflet to render into.
 */
vi.mock('leaflet', () => {
  function fakeMarker() {
    const marker = { addTo: vi.fn(), bindPopup: vi.fn(), on: vi.fn(), openPopup: vi.fn() };
    marker.addTo.mockReturnValue(marker);
    marker.bindPopup.mockReturnValue(marker);
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

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function mount(children: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(children);
  });
}

function findButton(label: string): HTMLButtonElement {
  const btn = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
  if (!btn) throw new Error(`No button labelled "${label}"`);
  return btn;
}

describe('AddressMapPreview', () => {
  it('shows the empty hint and nothing else when there are no points', async () => {
    mount(<AddressMapPreview points={[]} emptyHint="No pin on file." />);
    await flush();

    expect(container!.textContent).toBe('No pin on file.');
    expect(container!.querySelector('button')).toBeNull();
  });

  it('renders nothing at all when there are no points and no emptyHint', async () => {
    mount(<AddressMapPreview points={[]} />);
    await flush();

    expect(container!.innerHTML).toBe('');
  });

  it('never imports Leaflet until "Show map" is tapped', async () => {
    const leaflet = (await import('leaflet')).default as unknown as { map: ReturnType<typeof vi.fn> };
    mount(<AddressMapPreview points={[{ latitude: 17.5, longitude: -88.2, label: 'Somewhere' }]} />);
    await flush();

    expect(leaflet.map).not.toHaveBeenCalled();
    findButton('Show map');
  });

  it('draws the map once "Show map" is tapped, with no lettered legend for a single point', async () => {
    const leaflet = (await import('leaflet')).default as unknown as { map: ReturnType<typeof vi.fn>; marker: ReturnType<typeof vi.fn> };
    mount(<AddressMapPreview points={[{ latitude: 17.5, longitude: -88.2, label: 'Somewhere' }]} />);
    await flush();

    await act(async () => {
      findButton('Show map').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(leaflet.map).toHaveBeenCalledTimes(1);
    expect(leaflet.marker).toHaveBeenCalledWith([17.5, -88.2], expect.anything());
    // A single stop has nothing to letter against -- the legend only earns
    // its place once there's more than one point to tell apart.
    expect(container!.querySelector('ul')).toBeNull();
  });

  it('shows a lettered legend for more than one point', async () => {
    mount(
      <AddressMapPreview
        points={[
          { latitude: 17.5, longitude: -88.2, label: 'Origin' },
          { latitude: 17.9, longitude: -87.9, label: 'Destination' },
        ]}
      />,
    );
    await flush();
    await act(async () => {
      findButton('Show map').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container!.textContent).toContain('Origin');
    expect(container!.textContent).toContain('Destination');
    expect(container!.textContent).toMatch(/A[^B]*Origin/);
    expect(container!.textContent).toMatch(/B[^A]*Destination/);
  });

  it('expanding opens a full-screen dialog with the same points, and only one live map at a time', async () => {
    mount(
      <AddressMapPreview
        points={[
          { latitude: 17.5, longitude: -88.2, label: 'Origin' },
          { latitude: 17.9, longitude: -87.9, label: 'Destination' },
        ]}
        title="Test route"
      />,
    );
    await flush();
    await act(async () => {
      findButton('Show map').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      findButton('Expand').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute('aria-label')).toBe('Test route');
    // BMPL-210 discipline, same as web's ExpandableRouteMap: the embedded
    // preview is unmounted while the full-screen one is open, not merely
    // covered by it.
    expect(container!.querySelector('.isolate')).toBeNull();
  });
});
