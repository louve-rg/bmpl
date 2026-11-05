// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TripsList } from './TripsList';
import type { PassengerTrip } from '../../lib/passenger-driver';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** MDF-549: "View passengers" wires each trip row to its own bookings fetch. */
const apiGet = vi.fn<(path: string) => Promise<unknown>>();
vi.mock('../../lib/api', () => ({
  api: {
    get: (path: string) => apiGet(path),
    post: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  },
}));

const TRIP: PassengerTrip = {
  id: 'trip_1',
  reference: 'TRP-1001',
  status: 'ASSIGNED',
  scheduledDepartureAt: new Date('2026-12-01T12:00:00Z').toISOString(),
  routeName: 'San Ignacio — Belize City',
  from: 'San Ignacio',
  to: 'Belize City',
  operator: 'Western Express',
  seatCapacity: 20,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<TripsList />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  document.body.innerHTML = '';
  root = null;
  container = null;
  apiGet.mockReset();
});

describe('TripsList — "View passengers" (MDF-549)', () => {
  it('fetches the trip bookings only once the row is expanded, and hides them again on toggle', async () => {
    apiGet.mockImplementation((path: string) => (path === '/passenger/driver/trips' ? Promise.resolve([TRIP]) : Promise.resolve([])));
    await mount();

    expect(apiGet).not.toHaveBeenCalledWith('/passenger/driver/trips/trip_1/bookings');

    const toggle = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'View passengers')!;
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(apiGet).toHaveBeenCalledWith('/passenger/driver/trips/trip_1/bookings');
    expect(container!.textContent).toContain('Hide passengers');

    const hide = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Hide passengers')!;
    act(() => {
      hide.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container!.textContent).toContain('View passengers');
  });
});
