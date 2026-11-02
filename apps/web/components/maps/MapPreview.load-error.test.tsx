// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapPreview } from './MapPreview';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * MDF-376 section 6 (owner directive): the driver-facing route map is the
 * other half of "the map failing to load" needing a defined, readable
 * state. Before this, a rejected `import('leaflet')` left the container an
 * empty box forever -- not even a "Loading…" message, since MapPreview
 * never rendered one -- with no way for a driver to tell "still loading"
 * from "never going to load".
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

const POINTS = [{ latitude: 17.5, longitude: -88.2, label: 'Collect: 123 Main St' }];

describe('MapPreview when the map itself fails to load', () => {
  it('shows a readable explanation inside the map box instead of staying blank', async () => {
    mount();
    act(() => {
      root!.render(<MapPreview points={POINTS} />);
    });
    await flush();

    expect(container!.textContent).toContain('couldn’t load');
  });
});
