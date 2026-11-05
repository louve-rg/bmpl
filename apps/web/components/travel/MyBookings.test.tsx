// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MyBookings } from './MyBookings';
import type { RiderBooking } from '../../lib/passenger-travel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * MDF-549 gap B: the rider who placed a pickup/drop-off pin could never see
 * it again on their own booking row -- found live by Dwight, god read the
 * whole pre-fix file and confirmed zero references to pickup/dropoff/
 * landmark anywhere in it. These tests assert the row now shows both ends,
 * and stays silent when neither was ever pinned (the normal case).
 */
const apiGet = vi.fn<(path: string) => Promise<unknown>>();
vi.mock('../../lib/api', () => ({
  api: {
    get: (path: string) => apiGet(path),
    post: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  },
}));

function baseBooking(extra: Partial<RiderBooking> = {}): RiderBooking {
  return {
    id: 'book_1',
    reference: 'BK-2001',
    status: 'CONFIRMED',
    seats: 2,
    tripId: 'trip_1',
    tripReference: 'TRP-1001',
    tripStatus: 'SCHEDULED',
    scheduledDepartureAt: new Date('2026-12-01T12:00:00Z').toISOString(),
    routeName: 'San Ignacio — Belize City',
    from: 'San Ignacio',
    to: 'Belize City',
    cancelledBy: null,
    cancellationReason: null,
    createdAt: new Date().toISOString(),
    pickup: null,
    dropoff: null,
    ...extra,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<MyBookings />);
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

describe('MyBookings (MDF-549 gap B): the rider sees their own pins', () => {
  it('shows both ends when the rider pinned both', async () => {
    apiGet.mockResolvedValue([
      baseBooking({
        pickup: {
          district: 'BELIZE',
          city: 'Ladyville',
          address: null,
          landmark: 'Blue gate by the school',
          instructions: 'Call on arrival',
          latitude: 17.56,
          longitude: -88.3,
        },
        dropoff: {
          district: 'STANN CREEK',
          city: 'Dangriga',
          address: '12 Front St',
          landmark: null,
          instructions: null,
          latitude: 16.97,
          longitude: -88.23,
        },
      }),
    ]);
    await mount();

    expect(container!.textContent).toContain('Pickup: Blue gate by the school, Ladyville, BELIZE');
    expect(container!.textContent).toContain('Drop-off: 12 Front St, Dangriga, STANN CREEK');
    expect(container!.textContent).toContain('Call on arrival');
  });

  it('stays silent on pickup/drop-off when neither was ever pinned -- the normal case', async () => {
    apiGet.mockResolvedValue([baseBooking()]);
    await mount();

    expect(container!.textContent).not.toContain('Pickup:');
    expect(container!.textContent).not.toContain('Drop-off:');
  });
});
