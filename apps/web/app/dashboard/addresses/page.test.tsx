// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AddressesPage from './page';

// Same convention as LocationPicker.test.tsx / checkout/page.test.tsx -- no
// @testing-library/react dependency in this repo.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * MDF-534 (god's finding): `{row.addressLine1}` rendered unguarded on a
 * pin-only row used to read ", Belize City, Belize District" -- a leading
 * comma, no street, nothing saying a pin exists. These tests pin that fix:
 * the row falls back to the landmark, then to "Pinned location", and never
 * to a leading comma. They also cover the quiet per-row pin marker, the only
 * place a customer can tell which saved rows still need a pin added.
 */
const ROWS = [
  {
    id: 'a1',
    label: 'Home',
    fullName: 'Rae Test',
    phone: '+501 600 0000',
    email: null,
    company: null,
    addressLine1: '12 Front St',
    addressLine2: null,
    city: 'Belize City',
    district: 'BELIZE',
    landmark: null,
    instructions: null,
    latitude: null,
    longitude: null,
    isDefault: true,
  },
  {
    id: 'a2',
    label: 'Office',
    fullName: 'Rae Test',
    phone: '+501 600 0000',
    email: null,
    company: null,
    addressLine1: '',
    addressLine2: null,
    city: 'Orange Walk Town',
    district: 'ORANGE_WALK',
    landmark: 'Behind the blue gate',
    instructions: null,
    latitude: 18.08,
    longitude: -88.56,
    isDefault: false,
  },
  {
    id: 'a3',
    label: 'Cousin’s place',
    fullName: 'Rae Test',
    phone: '+501 600 0000',
    email: null,
    company: null,
    addressLine1: '',
    addressLine2: null,
    city: 'Dangriga',
    district: 'STANN_CREEK',
    landmark: null,
    instructions: null,
    latitude: 16.97,
    longitude: -88.23,
    isDefault: false,
  },
];

const apiGet = vi.fn((_path: string) => Promise.resolve(ROWS));
vi.mock('../../../lib/api', () => ({
  api: {
    get: (...args: [string]) => apiGet(...args),
    post: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  },
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
}

describe('AddressesPage list row — a pin-only address must not look broken', () => {
  it('reads a street address normally, with no pin marker', async () => {
    mount();
    act(() => {
      root!.render(<AddressesPage />);
    });
    await flush();

    expect(container!.textContent).toContain('12 Front St, Belize City');
    const homeCard = Array.from(container!.querySelectorAll('li')).find((li) => li.textContent?.includes('Home'));
    expect(homeCard?.textContent).not.toContain('📍');
  });

  it('falls back to the landmark when there is no street -- never a leading comma', async () => {
    mount();
    act(() => {
      root!.render(<AddressesPage />);
    });
    await flush();

    const office = Array.from(container!.querySelectorAll('li')).find((li) => li.textContent?.includes('Office'));
    const addressLine = Array.from(office!.querySelectorAll('p')).find((p) => p.textContent?.includes('Orange Walk Town'));
    expect(addressLine?.textContent?.trim().startsWith(',')).toBe(false);
    expect(addressLine?.textContent).toContain('Behind the blue gate, Orange Walk Town');
  });

  it('falls back to "Pinned location" when there is neither a street nor a landmark', async () => {
    mount();
    act(() => {
      root!.render(<AddressesPage />);
    });
    await flush();

    expect(container!.textContent).toContain('Pinned location, Dangriga');
  });

  it('shows the quiet pin marker only on rows that actually have a pin', async () => {
    mount();
    act(() => {
      root!.render(<AddressesPage />);
    });
    await flush();

    const cards = Array.from(container!.querySelectorAll('li'));
    const home = cards.find((li) => li.textContent?.includes('Home'));
    const office = cards.find((li) => li.textContent?.includes('Office'));
    expect(home?.textContent).not.toContain('📍');
    expect(office?.textContent).toContain('📍');
  });
});
