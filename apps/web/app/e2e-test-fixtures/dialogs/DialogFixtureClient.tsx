'use client';

import { ExpandableRouteMap } from '../../../components/maps/ExpandableRouteMap';
import { EnlargeableImage } from '../../../components/storefront/EnlargeableImage';
import type { MapPoint } from '../../../lib/trip-map';

/**
 * Synthetic test coordinates, obviously not a real BML route — chosen only to
 * sit inside Belize's bounds so MapPreview's fitBounds/maxBounds behave the
 * way they do for a real caller. Never read as, or fed into, anything that
 * treats it as real geography (root CLAUDE.md §5).
 */
const SYNTHETIC_ROUTE: MapPoint[] = [
  { latitude: 17.5, longitude: -88.2, label: 'Collect: Test sender' },
  { latitude: 17.25, longitude: -88.75, label: 'Deliver: Test recipient' },
];

/** A 1x1 transparent PNG — the dialog under test only needs an <img> to exist, never a real photo. */
const FIXTURE_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

/**
 * The real, unmodified FullScreenMapModal (via ExpandableRouteMap) and three
 * real EnlargeableImage siblings, surrounded by ordinary focusable page
 * furniture (nav links, buttons before and after) standing in for whatever a
 * real host page would put there. This file adds no dialog behaviour of its
 * own — see the page-level doc comment for why it exists at all.
 */
export function DialogFixtureClient() {
  return (
    <div data-e2e-fixture-ready="true">
      <header>
        <nav>
          <a id="nav-home" href="#">
            Home
          </a>{' '}
          <a id="nav-settings" href="#">
            Settings
          </a>{' '}
          <a id="nav-profile" href="#">
            Profile
          </a>
        </nav>
      </header>
      <main>
        <button id="fixture-before" type="button">
          Before content
        </button>

        <section aria-label="map fixture">
          <ExpandableRouteMap points={SYNTHETIC_ROUTE} title="Fixture route" lazy={false} />
        </section>

        <section aria-label="image fixtures">
          <EnlargeableImage src={FIXTURE_IMAGE} alt="Product photo 1" label="Enlarge product photo 1" />
          <EnlargeableImage src={FIXTURE_IMAGE} alt="Product photo 2" label="Enlarge product photo 2" />
          <EnlargeableImage src={FIXTURE_IMAGE} alt="Product photo 3" label="Enlarge product photo 3" />
        </section>

        <button id="fixture-after" type="button">
          After content
        </button>
      </main>
    </div>
  );
}
