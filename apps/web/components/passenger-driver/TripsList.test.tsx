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
  completedAt: null,
  routeName: 'San Ignacio — Belize City',
  from: 'San Ignacio',
  to: 'Belize City',
  operator: 'Western Express',
  seatCapacity: 20,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(status?: string) {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<TripsList status={status} />);
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

const COMPLETED_TRIP: PassengerTrip = {
  ...TRIP,
  id: 'trip_2',
  reference: 'TRP-2002',
  status: 'COMPLETED',
  completedAt: new Date('2026-11-02T15:30:00Z').toISOString(),
};

describe('TripsList — trip history (MDF-554): a completed trip finishes on the server but not for the driver', () => {
  it('with no status, My Departures is byte-for-byte the old single-fetch shape -- no pagination UI', async () => {
    apiGet.mockImplementation((path: string) => (path === '/passenger/driver/trips' ? Promise.resolve([TRIP]) : Promise.resolve([])));
    await mount();

    expect(apiGet).toHaveBeenCalledWith('/passenger/driver/trips');
    expect(container!.textContent).not.toMatch(/Showing \d/);
    expect(Array.from(container!.querySelectorAll('button')).some((b) => b.textContent?.trim() === 'Next')).toBe(false);
  });

  it('passing status="COMPLETED" reads the paginated envelope, shows completedAt, and renders Previous/Next', async () => {
    apiGet.mockImplementation((path: string) =>
      path.startsWith('/passenger/driver/trips?status=COMPLETED')
        ? Promise.resolve({ rows: [COMPLETED_TRIP], total: 25, page: 1, pageSize: 20 })
        : Promise.resolve([]),
    );
    await mount('COMPLETED');

    expect(apiGet).toHaveBeenCalledWith('/passenger/driver/trips?status=COMPLETED&page=1&pageSize=20');
    expect(container!.textContent).toContain('TRP-2002');
    expect(container!.textContent).toMatch(/Completed.*2026/);
    expect(container!.textContent).toContain('Showing 1–20 of 25');

    const next = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Next')!;
    const prev = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Previous')!;
    expect(next.hasAttribute('disabled')).toBe(false);
    expect(prev.hasAttribute('disabled')).toBe(true);

    await act(async () => {
      next.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(apiGet).toHaveBeenCalledWith('/passenger/driver/trips?status=COMPLETED&page=2&pageSize=20');
  });

  it('shows a history-specific empty state, distinct from "No departures assigned"', async () => {
    apiGet.mockImplementation((path: string) =>
      path.startsWith('/passenger/driver/trips?status=COMPLETED')
        ? Promise.resolve({ rows: [], total: 0, page: 1, pageSize: 20 })
        : Promise.resolve([]),
    );
    await mount('COMPLETED');

    expect(container!.textContent).toContain('No completed trips yet');
    expect(container!.textContent).not.toContain('No departures assigned');
  });
});
