// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { RecipientTracking } from './RecipientTracking';
import type { LinkedRecipientTrackingStep, LinkedRecipientTrackingView, RecipientTrackingStep, RecipientTrackingView } from '../../lib/shipping';

// react-dom's act() checks this flag; see LocationPicker.test.tsx for the
// same convention (no @testing-library/react dependency in this repo).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function baseStep(overrides: Partial<RecipientTrackingStep> = {}): RecipientTrackingStep {
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

// The LINKED step shape — the only one that can carry a photo at all;
// `pickupPhotoUrls` is required on this type, not optional, exactly to
// make the anonymous view's plain `baseStep()` above unable to pretend it
// has one.
function linkedStep(overrides: Partial<LinkedRecipientTrackingStep> = {}): LinkedRecipientTrackingStep {
  return { ...baseStep(), pickupPhotoUrls: [], ...overrides };
}

function baseView(overrides: Partial<RecipientTrackingView> = {}): RecipientTrackingView {
  return {
    reference: 'BML-TEST1',
    status: 'IN_TRANSIT',
    statusLabel: 'On the way',
    serviceLabel: 'Door to door',
    bookedAt: null,
    deliveredAt: null,
    destination: { city: 'San Pedro', district: 'BELIZE' },
    collectionHub: null,
    steps: [baseStep()],
    eta: { confidence: 'UNKNOWN', estimatedArrivalAt: null },
    ...overrides,
  };
}

function linkedView(overrides: Partial<LinkedRecipientTrackingView> = {}): LinkedRecipientTrackingView {
  return { ...baseView(), steps: [linkedStep()], ...overrides };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
});

function mount(v: RecipientTrackingView | LinkedRecipientTrackingView) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<RecipientTracking view={v} />);
  });
  return container;
}

/**
 * BMPL-391 (Edward requirement 2, the recipient gap). god's call on the
 * type design: `pickupPhotoUrls` lives only on `LinkedRecipientTrackingStep`
 * (required there), never on the base `RecipientTrackingStep` the
 * anonymous `/track/[token]` page actually gets — so the "anonymous view
 * never shows a photo" guarantee is provable by passing the REAL base
 * shape through this component, not just by omitting an optional key on
 * the same type. Mirrored from ShipmentJourney's LegRow, not imported,
 * because RecipientTracking has its own flat step structure.
 */
describe('RecipientTracking — recipient pickup photo (BMPL-391, Edward req 2)', () => {
  it('renders the thumbnail when a linked recipient’s step carries a photo', () => {
    const el = mount(linkedView({ steps: [linkedStep({ pickupPhotoUrls: ['https://files.example/photo1.jpg'] })] }));
    const img = el.querySelector('img');
    expect(img).toBeTruthy();
    expect(img!.getAttribute('src')).toBe('https://files.example/photo1.jpg');
    expect(img!.getAttribute('alt')).toBe('Pickup photo 1');
  });

  it('the anonymous/base view shape (what /track/[token] actually gets) never renders a photo — not absence of data, absence of the field', () => {
    const el = mount(baseView({ steps: [baseStep()] }));
    expect(el.querySelector('img')).toBeNull();
  });

  it('renders nothing for a linked step with an empty photo array, same as absent', () => {
    const el = mount(linkedView({ steps: [linkedStep({ pickupPhotoUrls: [] })] }));
    expect(el.querySelector('img')).toBeNull();
  });

  it('a photo on one step never bleeds onto a sibling step (per-leg, not pooled)', () => {
    const el = mount(
      linkedView({
        steps: [
          linkedStep({ sequence: 1, pickupPhotoUrls: ['https://files.example/leg1.jpg'] }),
          linkedStep({
            sequence: 2,
            kindLabel: 'Delivery',
            description: 'Out for delivery',
            completed: false,
            isCurrent: true,
            completedAt: null,
            pickupPhotoUrls: [],
          }),
        ],
      }),
    );
    const imgs = el.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0]!.getAttribute('src')).toBe('https://files.example/leg1.jpg');
  });
});
