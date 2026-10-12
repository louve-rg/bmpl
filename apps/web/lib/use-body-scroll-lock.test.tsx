// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { EnlargeableImage } from '../components/storefront/EnlargeableImage';
import { FullScreenMapModal } from '../components/maps/FullScreenMapModal';

// react-dom's act() checks this flag; @testing-library/react normally sets
// it, and this file follows use-dialog-focus-trap.test.tsx in not adding
// that dependency just for this.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A 1x1 transparent PNG — the dialog under test only needs an <img> to exist. */
const FIXTURE_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
  document.body.style.overflow = '';
  root = null;
  container = null;
});

/**
 * MDF-126: two real scroll-lock owners (FullScreenMapModal, EnlargeableImage)
 * on the same page, the shape apps/web/app/e2e-test-fixtures/dialogs already
 * puts side by side. Each independently snapshots document.body.style.overflow
 * on open and restores ITS OWN snapshot on close, so closing them in the
 * order they were opened — map, then image — has the map's close restore
 * the pre-lock value while the image dialog is still open and showing, and
 * then the image's close re-applies the map's stale "hidden" snapshot
 * forever. Both failure points are asserted below.
 */
function StackedDialogsHarness() {
  const [mapOpen, setMapOpen] = useState(false);
  return (
    <>
      <button id="open-map" type="button" onClick={() => setMapOpen(true)}>
        Open map
      </button>
      <FullScreenMapModal open={mapOpen} onClose={() => setMapOpen(false)} title="Fixture map">
        <div>map body</div>
      </FullScreenMapModal>
      <EnlargeableImage src={FIXTURE_IMAGE} alt="fixture photo" label="Enlarge fixture photo" />
    </>
  );
}

function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<StackedDialogsHarness />));
}

function openMap() {
  act(() => document.getElementById('open-map')!.click());
}

function closeMap() {
  act(() => (document.querySelector('button[aria-label="Close map"]') as HTMLButtonElement).click());
}

function openImage() {
  act(() => (document.querySelector('button[aria-label="Enlarge fixture photo"]') as HTMLButtonElement).click());
}

function closeImage() {
  act(() => (document.querySelector('[role="dialog"] button[aria-label="Close"]') as HTMLButtonElement).click());
}

describe('stacking two real scroll-lock owners (MDF-126)', () => {
  it('stays locked while the OTHER dialog is still open, closed map-then-image', () => {
    document.body.style.overflow = '';
    mount();

    openMap();
    expect(document.body.style.overflow).toBe('hidden');

    openImage();
    expect(document.body.style.overflow).toBe('hidden');

    // The map closes first; the image lightbox is still open and still
    // covering the page. The background must stay locked.
    closeMap();
    expect(document.body.style.overflow).toBe('hidden');

    // Now the last lock owner closes — restore to the true original.
    closeImage();
    expect(document.body.style.overflow).toBe('');
  });

  it('stays locked while the OTHER dialog is still open, closed image-then-map', () => {
    document.body.style.overflow = '';
    mount();

    openMap();
    openImage();
    expect(document.body.style.overflow).toBe('hidden');

    closeImage();
    expect(document.body.style.overflow).toBe('hidden');

    closeMap();
    expect(document.body.style.overflow).toBe('');
  });

  it('restores a pre-existing non-empty overflow value, not a hardcoded empty string', () => {
    document.body.style.overflow = 'auto';
    mount();

    openMap();
    openImage();
    closeMap();
    closeImage();

    expect(document.body.style.overflow).toBe('auto');
  });
});
