// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { RecipientTracking } from './RecipientTracking';
import type { RecipientTrackingStep, RecipientTrackingView } from '../../lib/shipping';

// react-dom's act() checks this flag; see LocationPicker.test.tsx for the
// same convention (no @testing-library/react dependency in this repo).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function step(overrides: Partial<RecipientTrackingStep> = {}): RecipientTrackingStep {
  return {
    sequence: 1,
    kindLabel: 'Collection',
    modeLabel: 'Road',
    description: 'Picked up from the sender',
    completed: true,
    isCurrent: false,
    completedAt: '2026-10-01T12:00:00.000Z',
    ...overrides,
  };
}

function view(overrides: Partial<RecipientTrackingView> = {}): RecipientTrackingView {
  return {
    reference: 'BML-TEST1',
    status: 'IN_TRANSIT',
    statusLabel: 'On the way',
    serviceLabel: 'Door to door',
    bookedAt: null,
    deliveredAt: null,
    destination: { city: 'San Pedro', district: 'BELIZE' },
    collectionHub: null,
    steps: [step()],
    eta: { confidence: 'UNKNOWN', estimatedArrivalAt: null },
    ...overrides,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
});

function mount(v: RecipientTrackingView) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<RecipientTracking view={v} />);
  });
  return container;
}

/**
 * BMPL-391 (Edward requirement 2, the recipient gap): a linked recipient
 * sees the same single optional pickup photo the sender already sees on
 * ShipmentJourney's LegRow — mirrored here, not imported, because
 * RecipientTracking has its own flat step structure. #304 (API) adds
 * `pickupPhotoUrls` to each step for `trackAsRecipient`/`listIncoming`
 * only; `trackPublic` never carries it, so the component itself must
 * never invent a value when the field is simply absent.
 */
describe('RecipientTracking — recipient pickup photo (BMPL-391, Edward req 2)', () => {
  it('renders the thumbnail when a linked recipient’s step carries a photo', () => {
    const el = mount(view({ steps: [step({ pickupPhotoUrls: ['https://files.example/photo1.jpg'] })] }));
    const img = el.querySelector('img');
    expect(img).toBeTruthy();
    expect(img!.getAttribute('src')).toBe('https://files.example/photo1.jpg');
    expect(img!.getAttribute('alt')).toBe('Pickup photo 1');
  });

  it('renders nothing when the field is absent entirely — never invents a placeholder', () => {
    const el = mount(view({ steps: [step()] })); // no pickupPhotoUrls key at all
    expect(el.querySelector('img')).toBeNull();
  });

  it('renders nothing for an empty array the same as absent', () => {
    const el = mount(view({ steps: [step({ pickupPhotoUrls: [] })] }));
    expect(el.querySelector('img')).toBeNull();
  });

  it('a photo on one step never bleeds onto a sibling step (per-leg, not pooled)', () => {
    const el = mount(
      view({
        steps: [
          step({ sequence: 1, pickupPhotoUrls: ['https://files.example/leg1.jpg'] }),
          step({ sequence: 2, kindLabel: 'Delivery', description: 'Out for delivery', completed: false, isCurrent: true, completedAt: null }),
        ],
      }),
    );
    const imgs = el.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0]!.getAttribute('src')).toBe('https://files.example/leg1.jpg');
  });
});
