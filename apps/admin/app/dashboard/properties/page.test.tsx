// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PropertiesPage from './page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * BMPL-281: the properties console (BMPL-270 part B) gates THREE independent
 * permissions — properties.moderate (listing moderation + report resolution),
 * property_owners.moderate (owner suspend/restore) and
 * real_estate_agents.moderate (agent suspend/restore) — each asserted
 * independently, mirroring jobs.page.test.tsx's approach for its own three.
 * There is deliberately no fourth "agencies" permission to test: part B's
 * commit found no agencies moderation UI or endpoint on this page at all
 * (the agency shown on a property is a read-only badge), so nothing exists
 * there to gate.
 *
 * Fixtures: the listing is SUBMITTED (moderation actions status-eligible),
 * the owner and the agent are both APPROVED (Suspend is status-eligible, not
 * Restore, for each).
 */

const LISTING_ITEM = {
  id: 'prop_1',
  title: 'Seaside Cottage',
  slug: 'seaside-cottage',
  reference: 'RE-1001',
  purpose: 'FOR_SALE',
  propertyType: 'HOUSE',
  priceMinor: 25000000,
  currency: 'BZD',
  rentalPeriod: null,
  negotiable: true,
  bedrooms: 3,
  bathrooms: 2,
  propertySize: 1800,
  landSize: 5000,
  areaUnit: 'SQUARE_FEET',
  furnishing: null,
  status: 'SUBMITTED',
  location: { visibility: 'GENERAL', district: 'BELIZE' },
  primaryImageUrl: null,
  publishedAt: null,
  createdAt: new Date().toISOString(),
  moderationReason: null,
  owner: 'Jordan Reyes',
  agent: null,
  reportCount: 0,
  enquiryCount: 0,
};

const LISTING_DETAIL = {
  id: 'prop_1',
  title: 'Seaside Cottage',
  slug: 'seaside-cottage',
  reference: 'RE-1001',
  status: 'SUBMITTED',
  purpose: 'FOR_SALE',
  propertyType: 'HOUSE',
  description: 'A cottage near the sea.',
  priceMinor: 25000000,
  currency: 'BZD',
  rentalPeriod: null,
  negotiable: true,
  district: 'BELIZE',
  locality: null,
  generalAddress: null,
  exactAddress: null,
  latitude: null,
  longitude: null,
  locationVisibility: 'GENERAL',
  bedrooms: 3,
  bathrooms: 2,
  halfBathrooms: 0,
  parkingSpaces: 1,
  propertySize: 1800,
  landSize: 5000,
  areaUnit: 'SQUARE_FEET',
  yearBuilt: 2010,
  furnishing: null,
  tenure: null,
  petPolicy: null,
  availabilityDate: null,
  leaseTerm: null,
  condition: null,
  videoUrl: null,
  authorityVerified: false,
  moderationReason: null,
  viewCount: 5,
  publishedAt: null,
  soldAt: null,
  rentedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  amenities: [],
  utilities: [],
  images: [],
  documents: [],
  statusHistory: [],
  priceHistory: [],
  assignments: [],
  owner: { id: 'owner_1', name: 'Jordan Reyes', phone: null, email: null },
  agent: null,
  agency: null,
};

const OWNER_ITEM = {
  id: 'owner_1',
  name: 'Jordan Reyes',
  district: 'BELIZE',
  approvalStatus: 'APPROVED',
  identityVerified: true,
  listingCount: 2,
  createdAt: new Date().toISOString(),
};

const OWNER_DETAIL = {
  id: 'owner_1',
  legalName: 'Jordan Reyes',
  displayName: 'Jordan Reyes',
  phone: null,
  email: null,
  district: 'BELIZE',
  approvalStatus: 'APPROVED',
  identityVerified: true,
  listingCount: 2,
  listingsByStatus: [{ status: 'PUBLISHED', count: 2 }],
  createdAt: new Date().toISOString(),
};

const AGENT_ITEM = {
  id: 'agent_1',
  displayName: 'Casey Lee',
  slug: 'casey-lee',
  agency: null,
  approvalStatus: 'APPROVED',
  isActive: true,
  listingCount: 1,
  createdAt: new Date().toISOString(),
};

const AGENT_DETAIL = {
  id: 'agent_1',
  displayName: 'Casey Lee',
  slug: 'casey-lee',
  bio: null,
  licenseNumber: 'RE-9001',
  specialties: [],
  district: 'BELIZE',
  phone: null,
  email: null,
  agency: null,
  approvalStatus: 'APPROVED',
  isActive: true,
  listingCount: 1,
  listingsByStatus: [{ status: 'PUBLISHED', count: 1 }],
  createdAt: new Date().toISOString(),
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function stubFetch(adminPermissions: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions });
      if (url.includes('/api/admin/properties/reports')) return jsonResponse(200, []);
      if (url.includes('/api/admin/properties/owners/owner_1')) return jsonResponse(200, OWNER_DETAIL);
      if (url.includes('/api/admin/properties/owners')) return jsonResponse(200, [OWNER_ITEM]);
      if (url.includes('/api/admin/properties/agents/agent_1')) return jsonResponse(200, AGENT_DETAIL);
      if (url.includes('/api/admin/properties/agents')) return jsonResponse(200, [AGENT_ITEM]);
      if (url.includes('/api/admin/properties/prop_1/documents')) return jsonResponse(200, []);
      if (url.includes('/api/admin/properties/prop_1')) return jsonResponse(200, LISTING_DETAIL);
      if (url.includes('/api/admin/properties')) return jsonResponse(200, [LISTING_ITEM]);
      return jsonResponse(404, { message: 'not mocked: ' + url });
    }),
  );
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<PropertiesPage />);
  });
  await settle();
}

async function clickTab(label: string) {
  const tabs = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button[role="tab"]'));
  const tab = tabs.find((t) => t.textContent?.trim() === label);
  if (!tab) throw new Error(`${label} tab not found`);
  await act(async () => {
    tab.click();
  });
  await settle();
}

function buttonTexts(): string[] {
  return Array.from(document.body.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '');
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe('PropertiesPage — three independent permissions (BMPL-281)', () => {
  it('a reader with none of the three permissions sees no write affordance on any tab, and the facts still render', async () => {
    stubFetch(['properties.read']);
    await mount();

    let texts = buttonTexts();
    expect(texts.some((t) => t === 'Approve & publish')).toBe(false);
    expect(document.body.querySelectorAll('button[disabled]').length).toBe(0);
    expect(document.body.textContent).toMatch(/Seaside Cottage/);

    await clickTab('Owners');
    texts = buttonTexts();
    expect(texts.some((t) => t === 'Suspend')).toBe(false);
    expect(document.body.querySelectorAll('button[disabled]').length).toBe(0);
    expect(document.body.textContent).toMatch(/Jordan Reyes/);

    await clickTab('Agents');
    texts = buttonTexts();
    expect(texts.some((t) => t === 'Suspend')).toBe(false);
    expect(document.body.querySelectorAll('button[disabled]').length).toBe(0);
    expect(document.body.textContent).toMatch(/Casey Lee/);
  });

  it('properties.moderate alone shows moderation actions but not owner or agent suspend', async () => {
    stubFetch(['properties.moderate']);
    await mount();

    expect(buttonTexts()).toContain('Approve & publish');

    await clickTab('Owners');
    expect(buttonTexts().some((t) => t === 'Suspend')).toBe(false);

    await clickTab('Agents');
    expect(buttonTexts().some((t) => t === 'Suspend')).toBe(false);
  });

  it('property_owners.moderate alone shows owner Suspend but not agent Suspend or moderation actions', async () => {
    stubFetch(['property_owners.moderate']);
    await mount();

    expect(buttonTexts().some((t) => t === 'Approve & publish')).toBe(false);

    await clickTab('Owners');
    expect(buttonTexts()).toContain('Suspend');

    await clickTab('Agents');
    expect(buttonTexts().some((t) => t === 'Suspend')).toBe(false);
  });

  it('real_estate_agents.moderate alone shows agent Suspend but not owner Suspend or moderation actions', async () => {
    stubFetch(['real_estate_agents.moderate']);
    await mount();

    expect(buttonTexts().some((t) => t === 'Approve & publish')).toBe(false);

    await clickTab('Owners');
    expect(buttonTexts().some((t) => t === 'Suspend')).toBe(false);

    await clickTab('Agents');
    expect(buttonTexts()).toContain('Suspend');
  });

  it('holding all three shows every write affordance on its own tab', async () => {
    stubFetch(['properties.moderate', 'property_owners.moderate', 'real_estate_agents.moderate']);
    await mount();

    expect(buttonTexts()).toContain('Approve & publish');

    await clickTab('Owners');
    expect(buttonTexts()).toContain('Suspend');

    await clickTab('Agents');
    expect(buttonTexts()).toContain('Suspend');
  });
});
