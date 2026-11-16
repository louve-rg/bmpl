// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RoutesPage from './page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * BMPL-274/276 shape: the route console (BMPL-267) hides every write
 * affordance from a logistics.read-only reader and shows them to a
 * logistics.manage operator. The "Schedule" toggle is deliberately excluded
 * from the absence check — it needs only logistics.read (same as the whole
 * page) and is not a write affordance, exactly like the hub console's own
 * "Hours" toggle.
 */

const HUB = { id: 'hub_1', code: 'SPA', name: 'San Pedro Airstrip', modes: ['AIR'], isActive: true };
const ROUTE = {
  id: 'route_1',
  originHub: { id: 'hub_1', code: 'SPA', name: 'San Pedro Airstrip', modes: ['AIR'] },
  destinationHub: { id: 'hub_2', code: 'BZE', name: 'Belize City Airstrip', modes: ['AIR'] },
  mode: 'AIR',
  carrierName: 'Tropic Air',
  carrierPhone: null,
  scheduleNote: null,
  durationMinutes: 25,
  priceMinor: 8000,
  isActive: true,
};

const SCHEDULE = {
  days: [
    { dayOfWeek: 1, status: 'REDUCED', note: 'Weather' },
    { dayOfWeek: 2, status: 'NOT_OPERATING', note: null },
  ],
  exceptions: [{ id: 'exc_1', date: '2026-12-25', status: 'NOT_OPERATING', reason: 'Holiday' }],
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function stubFetch(adminPermissions: string[], opts: { hubs?: unknown[]; routes?: unknown[] } = {}) {
  const posts: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/api/admin/logistics/routes/route_1/schedule')) return jsonResponse(200, SCHEDULE);
      if (url.includes('/api/admin/logistics/routes') && method === 'POST') {
        posts.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
        return jsonResponse(201, { ...ROUTE, id: 'route_new' });
      }
      if (url.includes('/api/admin/logistics/routes/') && method === 'PATCH') {
        posts.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
        return jsonResponse(200, { ...ROUTE });
      }
      if (url.includes('/api/admin/logistics/routes')) return jsonResponse(200, opts.routes ?? [ROUTE]);
      if (url.includes('/api/admin/logistics/hubs')) return jsonResponse(200, opts.hubs ?? [HUB]);
      if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions });
      return jsonResponse(404, { message: 'not mocked: ' + url });
    }),
  );
  return posts;
}

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<RoutesPage />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function buttonTexts(): string[] {
  return Array.from(document.body.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '');
}

/** Opens the Schedule panel the same way an operator would — clicking the
 *  toggle — rather than asserting against whatever the page shows by
 *  default. A test that never opens the panel would pass while everything
 *  inside it regressed. */
async function openSchedulePanel() {
  const toggle = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === 'Schedule',
  );
  if (!toggle) throw new Error('Schedule toggle not found');
  await act(async () => {
    toggle.click();
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe('RoutesPage — write affordances gated on logistics.manage (BMPL-274)', () => {
  it('a logistics.read-only reader sees no write affordance anywhere on the page', async () => {
    stubFetch(['logistics.read']);
    await mount();

    const texts = buttonTexts();
    expect(texts).not.toContain('Add route');
    expect(texts.some((t) => t === 'Suspend' || t === 'Resume')).toBe(false);
    expect(document.body.querySelector('#route-mode')).toBeNull();
    expect(document.body.querySelectorAll('button[disabled]').length).toBe(0);

    // Read-only report half: the route's price, duration and carrier are
    // still information, not withheld with the controls.
    expect(document.body.textContent).toMatch(/Tropic Air/);
    expect(document.body.textContent).toMatch(/\$80\.00/);
    // The Schedule toggle needs only logistics.read and is not a write
    // affordance — it must remain visible for a reader.
    expect(texts).toContain('Schedule');
  });

  it('a logistics.manage operator sees every write affordance', async () => {
    stubFetch(['logistics.manage']);
    await mount();

    const texts = buttonTexts();
    expect(texts).toContain('Add route');
    expect(texts).toContain('Suspend');
    expect(document.body.querySelector('#route-mode')).not.toBeNull();
  });
});

describe('RouteScheduleEditor — the toggle-revealed panel, where most of BMPL-267 actually lives (BMPL-277)', () => {
  it('a logistics.read-only reader sees no write affordance inside the open panel, and the schedule still renders as text', async () => {
    stubFetch(['logistics.read']);
    await mount();
    await openSchedulePanel();

    const texts = buttonTexts();
    expect(texts).not.toContain('Save weekly pattern');
    expect(texts).not.toContain('Remove');
    expect(texts).not.toContain('Add exception');
    expect(document.body.querySelector('select')).toBeNull();
    expect(document.body.querySelectorAll('button[disabled]').length).toBe(0);

    // Report-not-form: every day and the exception are still information.
    expect(document.body.textContent).toMatch(/Reduced/);
    expect(document.body.textContent).toMatch(/Weather/);
    expect(document.body.textContent).toMatch(/Not operating/);
    expect(document.body.textContent).toMatch(/2026-12-25/);
    expect(document.body.textContent).toMatch(/Holiday/);
    // Days with no configured row at all still report their real default
    // (operating), never a blank.
    expect(document.body.textContent).toMatch(/Operating/);
  });

  it('a logistics.manage operator sees every write affordance inside the open panel', async () => {
    stubFetch(['logistics.manage']);
    await mount();
    await openSchedulePanel();

    const texts = buttonTexts();
    expect(texts).toContain('Save weekly pattern');
    expect(texts).toContain('Remove');
    expect(texts).toContain('Add exception');
    expect(document.body.querySelector('select')).not.toBeNull();
  });
});

describe('RoutesPage — simulation visibility (TERM-SIM-ROUTE-FORM-CREATES-REAL-ROUTE)', () => {
  const SIM_HUB = { id: 'hub_3', code: 'SIM', name: 'Simulation Strip', modes: ['AIR'], isActive: true, isTest: true };

  it('sends isTest in the create body, checked or not', async () => {
    const posts = stubFetch(['logistics.manage'], { hubs: [HUB, SIM_HUB] });
    await mount();

    const fromSelect = document.body.querySelector<HTMLSelectElement>('#route-from')!;
    const toSelect = document.body.querySelector<HTMLSelectElement>('#route-to')!;
    await act(async () => {
      fromSelect.value = 'hub_1';
      fromSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      toSelect.value = 'hub_3';
      toSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const priceInput = document.body.querySelector<HTMLInputElement>('#route-price')!;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      nativeInputValueSetter.call(priceInput, '80.00');
      priceInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const carrierInput = document.body.querySelector<HTMLInputElement>('#route-carrier')!;
    await act(async () => {
      nativeInputValueSetter.call(carrierInput, 'Tropic Air');
      carrierInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const checkbox = document.body.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => {
      checkbox.click();
    });

    const addButton = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent === 'Add route')!;
    await act(async () => {
      addButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    const createPost = posts.find((p) => p.url.includes('/api/admin/logistics/routes'));
    expect(createPost?.body).toMatchObject({ isTest: true });
  });

  it('marks a simulation hub in the From/To option text without hiding or filtering it', async () => {
    stubFetch(['logistics.manage'], { hubs: [HUB, SIM_HUB] });
    await mount();

    const fromOptions = Array.from(document.body.querySelectorAll<HTMLOptionElement>('#route-from option')).map((o) => o.textContent);
    expect(fromOptions).toContain('SPA · San Pedro Airstrip');
    expect(fromOptions).toContain('SIM · Simulation Strip · Simulation');
  });

  it('badges a simulation route "Simulation" in the list, same as the other surfaces', async () => {
    stubFetch(['logistics.read'], { routes: [{ ...ROUTE, isTest: true }] });
    await mount();

    const routeRow = Array.from(document.body.querySelectorAll('.p-4')).find((el) => el.textContent?.includes('Tropic Air'));
    expect(routeRow?.textContent).toContain('Simulation');
  });

  it('shows no Simulation badge for a real route', async () => {
    stubFetch(['logistics.read']);
    await mount();

    const routeRow = Array.from(document.body.querySelectorAll('.p-4')).find((el) => el.textContent?.includes('Tropic Air'));
    expect(routeRow?.textContent).not.toContain('Simulation');
  });
});

describe('RoutesPage — Carrier is required (TERM-ROUTE-BLANK-CARRIER-STRANDS-A-READY-LEG)', () => {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  const setInput = async (el: HTMLInputElement, value: string) => {
    await act(async () => {
      nativeInputValueSetter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  it('keeps Add route disabled until origin, destination, price AND carrier are all filled', async () => {
    const HUB_2 = { id: 'hub_2', code: 'BZE', name: 'Belize City Airstrip', modes: ['AIR'], isActive: true };
    const posts = stubFetch(['logistics.manage'], { hubs: [HUB, HUB_2] });
    await mount();

    const addButton = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent === 'Add route')! as HTMLButtonElement;
    expect(addButton.disabled).toBe(true);

    const fromSelect = document.body.querySelector<HTMLSelectElement>('#route-from')!;
    const toSelect = document.body.querySelector<HTMLSelectElement>('#route-to')!;
    await act(async () => {
      fromSelect.value = 'hub_1';
      fromSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      toSelect.value = 'hub_2';
      toSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await setInput(document.body.querySelector<HTMLInputElement>('#route-price')!, '80.00');
    // Still disabled with no carrier named, even though every other required field is filled.
    expect(addButton.disabled).toBe(true);

    await setInput(document.body.querySelector<HTMLInputElement>('#route-carrier')!, '   ');
    // Whitespace-only does not count as named.
    expect(addButton.disabled).toBe(true);

    await setInput(document.body.querySelector<HTMLInputElement>('#route-carrier')!, 'Tropic Air');
    expect(addButton.disabled).toBe(false);

    await act(async () => {
      addButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    const createPost = posts.find((p) => p.url.includes('/api/admin/logistics/routes'));
    expect(createPost?.body).toMatchObject({ carrierName: 'Tropic Air' });
  });

  it('marks the Carrier input required', async () => {
    stubFetch(['logistics.manage']);
    await mount();
    const carrierInput = document.body.querySelector<HTMLInputElement>('#route-carrier')!;
    expect(carrierInput.required).toBe(true);
  });
});

describe('RoutesPage — an already-blank route is recoverable (TERM-ROUTE-BLANK-CARRIER-STRANDS-A-READY-LEG part 3)', () => {
  const BLANK = { ...ROUTE, id: 'route_blank', carrierName: null };

  it('a logistics.read-only reader never sees the Edit carrier control', async () => {
    stubFetch(['logistics.read'], { routes: [BLANK] });
    await mount();
    expect(buttonTexts()).not.toContain('Edit carrier');
  });

  it('a logistics.manage operator can name a carrier on a route that has none, by PATCHing the existing route', async () => {
    const posts = stubFetch(['logistics.manage'], { routes: [BLANK] });
    await mount();

    expect(document.body.textContent).toMatch(/Carrier not named/);

    const editButton = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent === 'Edit carrier')!;
    await act(async () => {
      editButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const carrierInput = document.body.querySelector<HTMLInputElement>(`#route-carrier-edit-${BLANK.id}`)!;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      nativeInputValueSetter.call(carrierInput, 'Belize Road Freight');
      carrierInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const saveButton = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent === 'Save carrier')!;
    await act(async () => {
      saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    const patchPost = posts.find((p) => p.url.includes(`/api/admin/logistics/routes/${BLANK.id}`));
    expect(patchPost?.body).toMatchObject({ carrierName: 'Belize Road Freight' });
  });
});
