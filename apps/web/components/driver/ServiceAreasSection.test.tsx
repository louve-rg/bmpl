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

/**
 * BMPL-353/360/368: the city picker is sourced from the driver-scoped
 * `GET /driver/service-areas/:district/cities` — hub towns AND
 * lane-reachable towns (BMPL-360, Ladyville is the named real case),
 * merged server-side — never a free-text box. These tests exercise: the
 * district picker still works unchanged, lane-only towns are now
 * selectable, saving an empty town set is indistinguishable in meaning
 * from never narrowing at all (the "whole district" invariant this feature
 * must not break for any existing driver), a town narrowed before it
 * dropped out of the server's current list stays visible rather than
 * silently disappearing, and — the part BMPL-368 exists for — the new
 * endpoint's 404 (no DriverProfile) is never shown as "no configured towns."
 */

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
});

async function mount(serviceAreas: ServiceArea[]) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const onDone = vi.fn().mockResolvedValue(undefined);
  await act(async () => {
    root!.render(<ServiceAreasSection serviceAreas={serviceAreas} onDone={onDone} />);
  });
  // Let the per-district city fetch (a microtask chain) resolve and re-render.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return { onDone };
}

describe('ServiceAreasSection', () => {
  it('renders the existing district picker checked for active areas', async () => {
    apiGet.mockResolvedValue({ cities: [] });
    await mount([{ district: 'BELIZE', isActive: true, cities: [] }]);
    const belize = container!.querySelector<HTMLInputElement>('#sa-BELIZE');
    const cayo = container!.querySelector<HTMLInputElement>('#sa-CAYO');
    expect(belize?.checked).toBe(true);
    expect(cayo?.checked).toBe(false);
  });

  it('saves the district list unchanged from before narrowing existed', async () => {
    apiGet.mockResolvedValue({ cities: [] });
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

  it('reads the driver-scoped, district-scoped endpoint — not the old public hub feed', async () => {
    apiGet.mockResolvedValue({ cities: ['Belize City'] });
    await mount([{ district: 'BELIZE', isActive: true, cities: [] }]);
    expect(apiGet).toHaveBeenCalledWith('/driver/service-areas/BELIZE/cities');
  });

  it('offers a lane-only town with no hub, the named real case (BMPL-360/368)', async () => {
    apiGet.mockResolvedValue({ cities: ['Belize City', 'Ladyville'] });
    await mount([{ district: 'BELIZE', isActive: true, cities: [] }]);
    expect(container!.textContent).toContain('Ladyville');
    const ladyville = container!.querySelector<HTMLInputElement>('#sa-BELIZE-city-Ladyville');
    expect(ladyville).not.toBeNull();
    // No free-text input anywhere in the town picker.
    expect(container!.querySelector('input[type="text"]')).toBeNull();
  });

  it('keeps a previously-narrowed town visible even if the server no longer lists it', async () => {
    apiGet.mockResolvedValue({ cities: ['Belize City'] });
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
    apiGet.mockResolvedValue({ cities: ['Belize City', 'San Pedro'] });
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
    apiGet.mockResolvedValue({ cities: ['Belize City', 'San Pedro'] });
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
    apiGet.mockResolvedValue({ cities: ['San Ignacio'] });
    await mount([{ district: 'BELIZE', isActive: true, cities: [] }]);
    const cayo = container!.querySelector<HTMLInputElement>('#sa-CAYO')!;
    await act(async () => {
      cayo.click();
    });
    expect(container!.textContent).toContain('Save service areas above before narrowing');
    expect(container!.querySelector('#sa-CAYO-city-San\\ Ignacio')).toBeNull();
  });

  describe('the new endpoint is driver-gated — a 404 must never read as "no towns" (BMPL-368)', () => {
    it('shows the server-s own message, not the empty-district message, and offers no save button', async () => {
      apiGet.mockRejectedValue({ status: 404, message: 'Start your driver application first.' });
      await mount([{ district: 'BELIZE', isActive: true, cities: [] }]);
      expect(container!.textContent).toContain('Start your driver application first.');
      expect(container!.textContent).not.toContain('No configured towns in Belize yet');
      // The top-level "Save service areas" button is unrelated to this
      // district's town picker and stays — only the TOWN save button, which
      // would save against data that never actually loaded, must be absent.
      expect(Array.from(container!.querySelectorAll('button')).some((b) => b.textContent === 'Save towns' || b.textContent?.startsWith('Save — serve all of'))).toBe(
        false,
      );
    });

    it('recovers via "Try again" once the endpoint succeeds', async () => {
      apiGet.mockRejectedValueOnce({ status: 404, message: 'Start your driver application first.' });
      await mount([{ district: 'BELIZE', isActive: true, cities: [] }]);
      expect(container!.textContent).toContain('Start your driver application first.');

      apiGet.mockResolvedValueOnce({ cities: ['Belize City'] });
      const retry = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Try again')!;
      await act(async () => {
        retry.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(container!.textContent).not.toContain('Start your driver application first.');
      expect(container!.textContent).toContain('Belize City');
    });

    it('a network error is likewise never shown as an empty district', async () => {
      apiGet.mockRejectedValue({ status: 500, message: 'Something went wrong.' });
      await mount([{ district: 'BELIZE', isActive: true, cities: [] }]);
      expect(container!.textContent).toContain('Something went wrong.');
      expect(container!.textContent).not.toContain('No configured towns in Belize yet');
    });
  });
});
