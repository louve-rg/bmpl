// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteScheduleEditor } from './RouteScheduleEditor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * MDF-528: owner ruling was "allow" for these controls — the only change is
 * (1) the disclosure that marking a day or date "Not operating" removes the
 * route from customer quotes, said next to the controls that cause it, and
 * (2) the collision display: none of the three schedule writes is ever
 * refused (Pam's guard, 807e22eb) — each can instead report
 * `affectedAcceptedLegs`, the already-accepted legs now sitting on a closed
 * date, which must be shown by reference/date, read as a consequence of a
 * successful save, and say explicitly that those legs are not blocked.
 */

const apiGet = vi.fn();
const apiPut = vi.fn();
const apiPost = vi.fn();
const apiDel = vi.fn();
vi.mock('../../lib/api', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    put: (...args: unknown[]) => apiPut(...args),
    post: (...args: unknown[]) => apiPost(...args),
    del: (...args: unknown[]) => apiDel(...args),
  },
}));

const EXISTING_EXCEPTION = { id: 'exc_1', date: '2026-12-25', status: 'OPERATING', reason: 'Holiday coverage' };
const LEG = { legId: 'leg_1', shipmentId: 'ship_1', reference: 'SHP-3001', scheduledDepartureAt: '2026-12-25T08:00:00.000Z' };

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  apiGet.mockReset();
  apiPut.mockReset();
  apiPost.mockReset();
  apiDel.mockReset();
  apiGet.mockResolvedValue({ days: [], exceptions: [EXISTING_EXCEPTION] });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
});

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<RouteScheduleEditor routeId="route_1" />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

function findButton(text: string) {
  return Array.from(container!.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) ?? null;
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('RouteScheduleEditor — disclosure (MDF-528)', () => {
  it('discloses, next to the weekly pattern controls, that "Not operating" removes the route from customer quotes', async () => {
    const c = await mount();
    expect(c.textContent).toMatch(/takes this route out of customer quotes on that day of the week/);
  });

  it('discloses, next to the date-exception controls, the same effect for a specific date', async () => {
    const c = await mount();
    expect(c.textContent).toMatch(/takes this route out of customer quotes on that date/);
  });
});

describe('RouteScheduleEditor — collision display (MDF-528, Pam\'s guard)', () => {
  it('shows nothing after a weekly-pattern save with no affected legs', async () => {
    apiPut.mockResolvedValue({ affectedAcceptedLegs: [] });
    const c = await mount();

    await click(findButton('Save weekly pattern')!);

    expect(c.textContent).not.toMatch(/already accepted work on/);
  });

  it('shows the affected legs by reference and departure date after a weekly-pattern save, reading as a consequence not an error', async () => {
    apiPut.mockResolvedValue({ affectedAcceptedLegs: [LEG] });
    const c = await mount();

    await click(findButton('Save weekly pattern')!);

    expect(c.textContent).toMatch(/already accepted work on/);
    expect(c.textContent).toContain('SHP-3001');
    expect(c.textContent).not.toContain('leg_1');
    expect(c.textContent).not.toContain('ship_1');
    expect(c.textContent).toMatch(/not blocked/);
  });

  it('shows the affected legs after adding an exception', async () => {
    apiPost.mockResolvedValue({ affectedAcceptedLegs: [LEG] });
    const c = await mount();

    const dateInput = container!.querySelector('input[type="date"]') as HTMLInputElement;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      nativeInputValueSetter.call(dateInput, '2026-12-25');
      dateInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(findButton('Add exception')!);

    expect(apiPost).toHaveBeenCalledWith('/shipping/provider/routes/route_1/schedule/exceptions', expect.objectContaining({ date: '2026-12-25' }));
    expect(container!.textContent).toMatch(/already accepted work on/);
    expect(container!.textContent).toContain('SHP-3001');
  });

  it('shows the affected legs after removing an exception, since a REMOVE can reinstate a closed weekly default underneath it', async () => {
    apiDel.mockResolvedValue({ affectedAcceptedLegs: [LEG] });
    const c = await mount();

    await click(findButton('Remove')!);

    expect(apiDel).toHaveBeenCalledWith('/shipping/provider/routes/route_1/schedule/exceptions/exc_1');
    expect(c.textContent).toMatch(/already accepted work on/);
    expect(c.textContent).toContain('SHP-3001');
  });
});
