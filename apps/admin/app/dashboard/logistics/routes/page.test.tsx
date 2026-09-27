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

function stubFetch(adminPermissions: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/admin/logistics/routes/route_1/schedule')) return jsonResponse(200, SCHEDULE);
      if (url.includes('/api/admin/logistics/routes')) return jsonResponse(200, [ROUTE]);
      if (url.includes('/api/admin/logistics/hubs')) return jsonResponse(200, [HUB]);
      if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions });
      return jsonResponse(404, { message: 'not mocked: ' + url });
    }),
  );
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
