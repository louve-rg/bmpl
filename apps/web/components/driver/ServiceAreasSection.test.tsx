// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceAreasSection } from './ServiceAreasSection';
import type { ServiceArea } from './dashboard-data';

// react-dom's act() checks this flag; see use-dialog-focus-trap.test.tsx /
// LocationPicker.test.tsx for the same convention (no @testing-library/react
// dependency in this repo).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const apiGet = vi.fn();
const apiPut = vi.fn();
vi.mock('../../lib/api', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    put: (...args: unknown[]) => apiPut(...args),
  },
}));

const hubs = vi.fn();
vi.mock('../../lib/shipping', () => ({
  shippingApi: {
    hubs: (...args: unknown[]) => hubs(...args),
  },
}));

/**
 * BMPL-353: the city picker is sourced from `GET /shipping/hubs` (the same
 * public, BML-operator-curated terminal list checkout already uses) — never
 * a free-text box. These tests exercise: the district picker still works
 * unchanged, the town picker only offers configured towns, saving an empty
 * town set is indistinguishable in meaning from never narrowing at all (the
 * "whole district" invariant this feature must not break for any existing
 * driver), and a town narrowed before its hub was deactivated/renamed stays
 * visible rather than silently disappearing.
 */
function hub(district: string, city: string) {
  return {
    id: `${district}-${city}`,
    code: `${district}-${city}`.toUpperCase(),
    name: city,
    type: 'BMPL_HUB',
    district,
    city,
    address: null,
    latitude: null,
    longitude: null,
    modes: ['LAND'],
    instructions: null,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
  root = null;
  container = null;
  apiGet.mockReset();
  apiPut.mockReset();
  hubs.mockReset();
});

async function mount(serviceAreas: ServiceArea[]) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const onDone = vi.fn().mockResolvedValue(undefined);
  await act(async () => {
    root!.render(<ServiceAreasSection serviceAreas={serviceAreas} onDone={onDone} />);
  });
  // Let the per-district hub fetch (a microtask chain) resolve and re-render.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return { onDone };
}

describe('ServiceAreasSection', () => {
  it('renders the existing district picker checked for active areas', async () => {
    hubs.mockResolvedValue([]);
    await mount([{ district: 'BELIZE', isActive: true, cities: [] }]);
    const belize = container!.querySelector<HTMLInputElement>('#sa-BELIZE');
    const cayo = container!.querySelector<HTMLInputElement>('#sa-CAYO');
    expect(belize?.checked).toBe(true);
    expect(cayo?.checked).toBe(false);
  });

  it('saves the district list unchanged from before narrowing existed', async () => {
    hubs.mockResolvedValue([]);
    await mount([{ district: 'BELIZE', isActive: true, cities: [] }]);
    const cayo = container!.querySelector<HTMLInputElement>('#sa-CAYO')!;
    await act(async () => {
      cayo.click();
    });
    const saveAreas = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Save service areas')!;
    await act(async () => {
      saveAreas.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(apiPut).toHaveBeenCalledWith('/driver/service-areas', { districts: expect.arrayContaining(['BELIZE']) });
  });

  it('offers only configured towns from the public hub list, never free text', async () => {
    hubs.mockResolvedValue([hub('BELIZE', 'Belize City'), hub('BELIZE', 'Ladyville'), hub('CAYO', 'San Ignacio')]);
    await mount([{ district: 'BELIZE', isActive: true, cities: [] }]);
    expect(hubs).toHaveBeenCalled();
    expect(container!.textContent).toContain('Belize City');
    expect(container!.textContent).toContain('Ladyville');
    // A CAYO-only hub town must not leak into the BELIZE picker.
    expect(container!.textContent).not.toContain('San Ignacio');
    // No free-text input anywhere in the town picker.
    expect(container!.querySelector('input[type="text"]')).toBeNull();
  });

  it('keeps a previously-narrowed town visible even if its hub is gone from the current list', async () => {
    hubs.mockResolvedValue([hub('BELIZE', 'Belize City')]);
    await mount([
      {
        district: 'BELIZE',
        isActive: true,
        cities: [{ id: 'c1', city: 'Stale Town', isActive: true }],
      },
    ]);
    expect(container!.textContent).toContain('Stale Town');
    const staleCheckbox = container!.querySelector<HTMLInputElement>('#sa-BELIZE-city-Stale\\ Town');
    expect(staleCheckbox?.checked).toBe(true);
  });

  it('narrows to a subset of configured towns and saves them', async () => {
    hubs.mockResolvedValue([hub('BELIZE', 'Belize City'), hub('BELIZE', 'San Pedro')]);
    await mount([{ district: 'BELIZE', isActive: true, cities: [] }]);
    const sanPedro = container!.querySelector<HTMLInputElement>('#sa-BELIZE-city-San\\ Pedro')!;
    await act(async () => {
      sanPedro.click();
    });
    const saveTowns = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Save towns')!;
    apiPut.mockResolvedValue({});
    await act(async () => {
      saveTowns.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(apiPut).toHaveBeenCalledWith('/driver/service-areas/BELIZE/cities', { cities: ['San Pedro'] });
  });

  it('saving with no towns picked still means the whole district (unchanged behaviour)', async () => {
    hubs.mockResolvedValue([hub('BELIZE', 'Belize City'), hub('BELIZE', 'San Pedro')]);
    await mount([{ district: 'BELIZE', isActive: true, cities: [] }]);
    expect(container!.textContent).toContain('Serving all of Belize.');
    const saveTowns = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent?.startsWith('Save — serve all of'))!;
    apiPut.mockResolvedValue({});
    await act(async () => {
      saveTowns.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    // The call that keeps/restores whole-district coverage sends an EMPTY
    // array — the same shape an existing driver who never narrowed anything
    // has always implicitly had — never an enumeration of "everything".
    expect(apiPut).toHaveBeenCalledWith('/driver/service-areas/BELIZE/cities', { cities: [] });
    expect(container!.textContent).toContain('Serving all of Belize.');
  });

  it('does not offer town narrowing for a district only selected locally, not yet saved', async () => {
    hubs.mockResolvedValue([hub('CAYO', 'San Ignacio')]);
    await mount([{ district: 'BELIZE', isActive: true, cities: [] }]);
    const cayo = container!.querySelector<HTMLInputElement>('#sa-CAYO')!;
    await act(async () => {
      cayo.click();
    });
    expect(container!.textContent).toContain('Save service areas above before narrowing');
    expect(container!.querySelector('#sa-CAYO-city-San\\ Ignacio')).toBeNull();
  });
});
