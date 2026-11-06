// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapPreview } from './MapPreview';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * SHIP-H / Edward issue 2 verification: a browser test needs to count and
 * identify map markers by kind (customer door vs. terminal), not just see
 * that something rendered. The marker itself is a Leaflet `divIcon` — an
 * opaque HTML string — so the only way to check what it carries is to
 * inspect the `html` passed to `L.divIcon`, same approach LocationPicker's
 * own tests already use for this fake Leaflet (real Leaflet needs a real
 * browser canvas jsdom does not provide).
 */
const divIconCalls: Array<{ html: string }> = [];
vi.mock('leaflet', () => {
  function fakeMarker() {
    const marker: { addTo: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn>; bindPopup: ReturnType<typeof vi.fn>; openPopup: ReturnType<typeof vi.fn> } = {
      addTo: vi.fn(),
      on: vi.fn(),
      bindPopup: vi.fn(),
      openPopup: vi.fn(),
    };
    marker.addTo.mockReturnValue(marker);
    marker.on.mockReturnValue(marker);
    marker.bindPopup.mockReturnValue(marker);
    return marker;
  }
  function fakeMap() {
    return {
      setView: vi.fn(),
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
    divIcon: vi.fn((opts: { html: string }) => {
      divIconCalls.push(opts);
      return opts;
    }),
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
  divIconCalls.length = 0;
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

describe('MapPreview marker html carries a stable, kind-identifiable test hook', () => {
  it('tags a lettered ADDRESS stop (a customer door) with data-kind="ADDRESS" and its letter', async () => {
    mount();
    act(() => {
      root!.render(<MapPreview points={[{ latitude: 17.5, longitude: -88.2, label: 'A', kind: 'ADDRESS', letter: 'A' }]} />);
    });
    await flush();

    expect(divIconCalls).toHaveLength(1);
    expect(divIconCalls[0]!.html).toContain('data-testid="route-map-marker"');
    expect(divIconCalls[0]!.html).toContain('data-kind="ADDRESS"');
    expect(divIconCalls[0]!.html).toContain('data-letter="A"');
  });

  it('tags a lettered HUB stop (a terminal) with data-kind="HUB", distinct from an ADDRESS stop', async () => {
    mount();
    act(() => {
      root!.render(
        <MapPreview
          points={[
            { latitude: 17.5, longitude: -88.2, label: 'A', kind: 'ADDRESS', letter: 'A' },
            { latitude: 17.6, longitude: -88.3, label: 'B', kind: 'HUB', letter: 'B' },
          ]}
        />,
      );
    });
    await flush();

    expect(divIconCalls).toHaveLength(2);
    const [door, hub] = divIconCalls;
    expect(door!.html).toContain('data-kind="ADDRESS"');
    expect(door!.html).toContain('data-letter="A"');
    expect(hub!.html).toContain('data-kind="HUB"');
    expect(hub!.html).toContain('data-letter="B"');
  });

  it('a middle stop (an intermediate transfer hub) is identical in shape to any other HUB — a test tells it apart from its position in the lettered sequence, not a third kind value', async () => {
    mount();
    act(() => {
      root!.render(
        <MapPreview
          points={[
            { latitude: 17.5, longitude: -88.2, label: 'A', kind: 'ADDRESS', letter: 'A' },
            { latitude: 17.6, longitude: -88.3, label: 'B', kind: 'HUB', letter: 'B' },
            { latitude: 17.7, longitude: -88.4, label: 'C', kind: 'HUB', letter: 'C' },
            { latitude: 17.8, longitude: -88.5, label: 'D', kind: 'ADDRESS', letter: 'D' },
          ]}
        />,
      );
    });
    await flush();

    expect(divIconCalls.map((c) => (c.html.match(/data-kind="(\w+)"/) ?? [])[1])).toEqual(['ADDRESS', 'HUB', 'HUB', 'ADDRESS']);
    expect(divIconCalls.map((c) => (c.html.match(/data-letter="(\w*)"/) ?? [])[1])).toEqual(['A', 'B', 'C', 'D']);
  });

  it('defaults an unlabeled kind to the same ADDRESS treatment the visuals already fall back to, for an api deploy older than SHIP-C', async () => {
    mount();
    act(() => {
      root!.render(<MapPreview points={[{ latitude: 17.5, longitude: -88.2, label: 'A', letter: 'A' }]} />);
    });
    await flush();

    expect(divIconCalls[0]!.html).toContain('data-kind="ADDRESS"');
  });
});
