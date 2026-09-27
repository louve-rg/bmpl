// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PassengersPage from './page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * BMPL-274/276 shape: every write control across the passengers console's
 * three moderation tabs (Providers, Departures, Bookings — BMPL-269's own
 * scoping of this file) is gated on passengers.moderate, fetched once at the
 * top-level page. Each tab is exercised by clicking into it, same as an
 * operator would.
 */

const PROVIDER = {
  id: 'prov_1',
  userId: 'user_1',
  businessName: 'Cayo Shuttle Co',
  contactName: 'Ana Cruz',
  accountEmail: 'ana@cayoshuttle.example',
  contactEmail: null,
  contactPhone: '610-1234',
  district: 'CAYO',
  city: 'San Ignacio',
  operatingLicenceNumber: 'OL-99',
  operatingLicenceExpiry: null,
  operatingLicenceExpiryStatus: null,
  roleStatus: 'APPROVED' as const,
  isActive: true,
  isTest: false,
  vehicleCount: 3,
  approvedVehicles: 2,
  driverCount: 2,
};

const TRIP = {
  id: 'trip_1',
  reference: 'TRP-1001',
  kind: 'SCHEDULED_ROUTE',
  status: 'SCHEDULED',
  isTest: false,
  routeName: 'San Ignacio — Belize City',
  providerName: 'Cayo Shuttle Co',
  scheduledDepartureAt: new Date().toISOString(),
  scheduledArrivalAt: null,
  cancelledAt: null,
  cancellationReason: null,
};

const BOOKING = {
  id: 'book_1',
  reference: 'BK-2001',
  status: 'REQUESTED' as const,
  seats: 2,
  isTest: false,
  tripId: 'trip_1',
  tripReference: 'TRP-1001',
  tripStatus: 'SCHEDULED',
  scheduledDepartureAt: new Date().toISOString(),
  routeName: 'San Ignacio — Belize City',
  from: 'San Ignacio',
  to: 'Belize City',
  passengerName: 'Jordan Reyes',
  confirmedAt: null,
  completedAt: null,
  cancelledAt: null,
  cancelledBy: null,
  cancellationReason: null,
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
      if (url.includes('/api/admin/passengers/drivers')) return jsonResponse(200, []);
      if (url.includes('/api/admin/passengers/providers')) return jsonResponse(200, [PROVIDER]);
      if (url.includes('/api/admin/passengers/trips')) return jsonResponse(200, [TRIP]);
      if (url.includes('/api/admin/passengers/bookings')) return jsonResponse(200, [BOOKING]);
      return jsonResponse(404, { message: 'not mocked: ' + url });
    }),
  );
}

async function mountOnTab(label: string) {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<PassengersPage />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

  const tabs = Array.from(document.body.querySelectorAll('button')).filter((b) => b.textContent?.trim() === label);
  if (tabs.length === 0) throw new Error(`${label} tab not found`);
  await act(async () => {
    (tabs[0] as HTMLButtonElement).click();
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

describe('PassengersPage — write affordances gated on passengers.moderate (BMPL-274)', () => {
  it('a passengers.read-only reader sees no write affordance on any moderation tab', async () => {
    stubFetch(['passengers.read']);

    await mountOnTab('Providers');
    let texts = buttonTexts();
    expect(texts.some((t) => t === 'Make simulation' || t === 'Make real')).toBe(false);
    expect(document.body.querySelectorAll('button[disabled]').length).toBe(0);
    expect(document.body.textContent).toMatch(/Cayo Shuttle Co/);

    await mountOnTab('Departures');
    texts = buttonTexts();
    expect(texts.some((t) => t.includes('Assign driver'))).toBe(false);
    expect(document.body.querySelectorAll('button[disabled]').length).toBe(0);
    expect(document.body.textContent).toMatch(/TRP-1001/);

    await mountOnTab('Bookings');
    texts = buttonTexts();
    expect(texts.some((t) => t === 'Confirm' || t === 'Cancel booking')).toBe(false);
    expect(document.body.querySelectorAll('button[disabled]').length).toBe(0);
    expect(document.body.textContent).toMatch(/BK-2001/);
  });

  it('a passengers.moderate operator sees every write affordance on every moderation tab', async () => {
    stubFetch(['passengers.moderate']);

    await mountOnTab('Providers');
    expect(buttonTexts()).toContain('Make simulation');

    await mountOnTab('Departures');
    expect(buttonTexts().some((t) => t.includes('Assign driver'))).toBe(true);

    await mountOnTab('Bookings');
    let texts = buttonTexts();
    expect(texts).toContain('Confirm');
    expect(texts).toContain('Cancel booking');
  });
});
