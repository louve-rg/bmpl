// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * BMPL-281: the driver detail screen's VehicleCard (BMPL-270 part B) gates
 * vehicle approve/reject on the single drivers.moderate permission. Unlike
 * vendors/[id] and products/[id], drivers/[id]/page.tsx is itself a client
 * component ('use client', useParams + api.get), so the whole page renders
 * directly in this jsdom harness — no component-extraction workaround
 * needed here.
 *
 * The vehicle fixture is PENDING so the approve/reject controls are
 * status-eligible; the driver's other info (profile, licence, service
 * areas) carries no permission check at all and is what the "still renders
 * as text" assertion covers.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'driver_1' }),
}));

const { default: DriverDetailPage } = await import('./page');

const DRIVER = {
  id: 'driver_1',
  legalName: 'Marco Tut',
  displayName: null,
  phone: '610-1111',
  homeDistrict: 'COROZAL',
  homeAddress: '12 Main St',
  emergencyContactName: 'Ana Tut',
  emergencyContactPhone: '610-2222',
  licenceNumber: 'DL-9001',
  licenceExpiry: '2027-01-01',
  licenceExpiryStatus: 'VALID',
  vehicleOwnership: 'OWNED',
  availability: 'ONLINE',
  isActive: true,
  ratingAverage: 4.8,
  completedDeliveries: 120,
  createdAt: new Date().toISOString(),
  user: { id: 'user_1', name: 'Marco Tut', email: 'marco@example.com' },
  roleStatus: 'APPROVED',
  vehicles: [
    {
      id: 'vehicle_1',
      type: 'MOTORCYCLE',
      make: 'Honda',
      model: 'CB125',
      year: 2022,
      color: 'Red',
      licencePlate: 'BZ-1234',
      registrationNumber: 'REG-001',
      registrationExpiry: '2027-01-01',
      registrationExpiryStatus: 'VALID',
      insuranceProvider: 'Belize Insurance Co',
      insuranceExpiry: '2027-01-01',
      insuranceExpiryStatus: 'VALID',
      photoUrls: [],
      isActive: true,
      isPrimary: true,
      approvalStatus: 'PENDING',
      rejectionReason: null,
    },
  ],
  serviceAreas: [{ district: 'COROZAL', isActive: true }],
  recentActivity: [],
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
      if (url.includes('/api/admin/drivers/driver_1')) return jsonResponse(200, DRIVER);
      return jsonResponse(404, { message: 'not mocked: ' + url });
    }),
  );
}

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<DriverDetailPage />);
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

describe('DriverDetailPage — VehicleCard write affordances gated on drivers.moderate (BMPL-281)', () => {
  it('a reader sees neither Approve nor Reject on the pending vehicle, zero disabled buttons, and the vehicle facts still render', async () => {
    stubFetch(['drivers.read']);
    await mount();

    const texts = buttonTexts();
    expect(texts.some((t) => t === 'Approve')).toBe(false);
    expect(texts.some((t) => t === 'Reject')).toBe(false);
    expect(document.body.querySelectorAll('button[disabled]').length).toBe(0);

    expect(document.body.textContent).toMatch(/CB125/);
    expect(document.body.textContent).toMatch(/BZ-1234/);
    expect(document.body.textContent).toMatch(/REG-001/);
    expect(document.body.textContent).toMatch(/Marco Tut/);
  });

  it('a drivers.moderate holder sees both Approve and Reject on the pending vehicle', async () => {
    stubFetch(['drivers.moderate']);
    await mount();

    const texts = buttonTexts();
    expect(texts).toContain('Approve');
    expect(texts).toContain('Reject');
  });
});
