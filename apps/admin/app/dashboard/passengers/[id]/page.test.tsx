// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * BMPL-274/276 shape: the passenger driver detail screen (BMPL-269) gates
 * the "Make simulation"/"Make real" test-mode toggle and the per-vehicle
 * Approve/Reject controls on passengers.moderate. This page reads its id via
 * next/navigation's useParams, which throws outside a real Next router
 * context — mocked here rather than changing the component, mirroring how
 * any other Next-router-dependent hook would be handled in a unit test.
 */

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'driver_1' }),
}));

// Imported after the mock so the page picks it up.
const { default: PassengerDriverDetailPage } = await import('./page');

const VEHICLE_PENDING = {
  id: 'veh_1',
  type: 'VAN',
  make: 'Toyota',
  model: 'Hiace',
  year: 2019,
  color: 'White',
  licencePlate: 'BZ-1234',
  registrationNumber: null,
  registrationExpiry: null,
  registrationExpiryStatus: null,
  insuranceProvider: null,
  insuranceExpiry: null,
  insuranceExpiryStatus: null,
  seatCapacity: 12,
  isActive: true,
  isPrimary: true,
  approvalStatus: 'PENDING' as const,
  rejectionReason: null,
};

const DRIVER = {
  id: 'driver_1',
  legalName: 'Marco Tut',
  displayName: null,
  phone: '610-9999',
  homeDistrict: 'CAYO',
  homeAddress: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  licenceNumber: 'LIC-1',
  licenceExpiry: null,
  licenceExpiryStatus: null,
  availability: 'ONLINE' as const,
  isActive: true,
  isTest: false,
  ratingAverage: null,
  completedTrips: null,
  createdAt: new Date().toISOString(),
  user: { id: 'user_1', name: 'Marco Tut', email: 'marco@example.com' },
  roleStatus: 'APPROVED' as const,
  provider: null,
  vehicles: [VEHICLE_PENDING],
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
      if (url.includes('/api/admin/passengers/drivers/driver_1')) return jsonResponse(200, DRIVER);
      return jsonResponse(404, { message: 'not mocked: ' + url });
    }),
  );
}

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<PassengerDriverDetailPage />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
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

describe('PassengerDriverDetailPage — write affordances gated on passengers.moderate (BMPL-274)', () => {
  it('a passengers.read-only reader sees no write affordance for this driver', async () => {
    stubFetch(['passengers.read']);
    await mount();

    const texts = buttonTexts();
    expect(texts.some((t) => t === 'Make simulation' || t === 'Make real')).toBe(false);
    expect(texts).not.toContain('Approve');
    expect(texts).not.toContain('Reject');
    expect(document.body.querySelectorAll('button[disabled]').length).toBe(0);

    // Read-only report half: the driver and vehicle facts are still there.
    expect(document.body.textContent).toMatch(/Marco Tut/);
    expect(document.body.textContent).toMatch(/BZ-1234/);
  });

  it('a passengers.moderate operator sees every write affordance for this driver', async () => {
    stubFetch(['passengers.moderate']);
    await mount();

    const texts = buttonTexts();
    expect(texts).toContain('Make simulation');
    expect(texts).toContain('Approve');
    expect(texts).toContain('Reject');
  });
});
