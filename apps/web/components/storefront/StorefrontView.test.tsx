// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorefrontView, type Storefront } from './StorefrontView';

// react-dom's act() checks this flag; see use-dialog-focus-trap.test.tsx /
// LocationPicker.test.tsx for the same convention (no @testing-library/react
// dependency in this repo).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ReviewList/SaveButton each fetch their own data on mount — irrelevant to
// what this file tests (the storefront body's own field handling) and a
// source of noisy, unrelated network activity in jsdom. Stubbed out so this
// stays a hermetic test of StorefrontView itself.
vi.mock('../reviews/ReviewList', () => ({ ReviewList: () => null }));
vi.mock('../saved/SaveButton', () => ({ SaveButton: () => null }));

/**
 * BMPL-349: `openingHours`/`hoursExceptions` are optional on `Storefront` —
 * web (Vercel) and api (Railway, slower: it runs `prisma migrate deploy`
 * first) deploy independently, and `/store/[slug]` is PUBLIC, so there is a
 * real window where an anonymous shopper hits this page against an api that
 * hasn't started sending these fields yet. Proven with a real missing key
 * (JSON round-trip + delete), not an in-memory `undefined` a type-only check
 * would paper over.
 */
function baseStore(): Storefront {
  return {
    businessName: 'Ambergris Grill',
    slug: 'ambergris-grill',
    vendorProfileId: 'v1',
    description: null,
    contactEmail: 'hello@example.com',
    contactPhone: null,
    website: null,
    storeStatus: 'OPEN',
    ratingAverage: 4.5,
    ratingCount: 12,
    vacationMode: false,
    pickupEnabled: true,
    deliveryEnabled: true,
    logoUrl: null,
    bannerUrl: null,
    locations: [],
    openingHours: [],
    hoursExceptions: [],
    featuredProducts: [],
    categories: [],
  };
}

describe('StorefrontView', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    if (container) container.remove();
    root = null;
    container = null;
  });

  function mount(store: Storefront) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(<StorefrontView store={store} />);
    });
    return container;
  }

  it('renders normally with configured hours', () => {
    const el = mount(baseStore());
    expect(el.textContent).toContain('Ambergris Grill');
  });

  it('does not crash when openingHours/hoursExceptions are missing from the wire entirely', () => {
    const raw = JSON.parse(JSON.stringify(baseStore())) as Record<string, unknown>;
    delete raw.openingHours;
    delete raw.hoursExceptions;
    expect(() => mount(raw as unknown as Storefront)).not.toThrow();
    const el = mount(raw as unknown as Storefront);
    expect(el.textContent).toContain('Ambergris Grill');
    // Absence means unconstrained — same as an empty array — never a badge.
    expect(el.textContent).not.toContain('Closed now');
  });
});
