// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DriverServiceAreasPage from './page';

// react-dom's act() checks this flag; see LocationPicker.test.tsx /
// RoutingProposalConfirm.test.tsx for the same convention (no
// @testing-library/react dependency in this repo).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const apiGet = vi.fn();
vi.mock('../../../../lib/api', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    put: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  },
}));

const BASE_DASHBOARD = {
  hasProfile: true,
  roleStatus: 'APPROVED' as const,
  application: null,
  profile: {
    legalName: 'Jane Doe',
    displayName: 'Jane',
    phone: '555-0100',
    homeDistrict: 'BELIZE',
    licenceNumber: 'L1',
    licenceExpiry: null,
    vehicleOwnership: 'OWNED' as const,
    availability: 'OFFLINE' as const,
  },
  vehicles: [],
  serviceAreas: [],
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  apiGet.mockReset();
});

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<DriverServiceAreasPage />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

/**
 * SHIPPING-E2E: this page used to show ONLY its own "no service areas
 * selected" warning (ServiceAreasSection's own, narrower alert) -- a driver
 * blocked from going online for an UNRELATED reason (an unapproved vehicle,
 * a pending document) got no hint of that here, unlike vehicles/page.tsx,
 * which has always repeated the full eligibility reason list. This page now
 * matches that exact shape.
 */
describe('DriverServiceAreasPage -- same eligibility-reasons treatment as vehicles/page.tsx', () => {
  it('shows the full "You can’t go online yet" reason list, same as the vehicle page, even for a reason that has nothing to do with service areas', async () => {
    apiGet.mockResolvedValue({
      ...BASE_DASHBOARD,
      eligibility: { canGoOnline: false, reasons: ['Your primary vehicle is not yet approved.'] },
    });
    const el = await mount();

    expect(el.textContent).toContain('You can’t go online yet');
    expect(el.textContent).toContain('Your primary vehicle is not yet approved.');
  });

  it('shows no eligibility banner once the driver can go online', async () => {
    apiGet.mockResolvedValue({
      ...BASE_DASHBOARD,
      serviceAreas: [{ district: 'BELIZE', isActive: true }],
      eligibility: { canGoOnline: true, reasons: [] },
    });
    const el = await mount();

    expect(el.textContent).not.toContain('You can’t go online yet');
  });
});
