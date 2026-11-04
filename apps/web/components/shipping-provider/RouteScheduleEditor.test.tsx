// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteScheduleEditor } from './RouteScheduleEditor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * MDF-528: owner ruling was "allow" for these controls — the only change is
 * the disclosure that marking a day or date "Not operating" removes the
 * route from customer quotes, said next to the controls that cause it.
 */

const apiGet = vi.fn();
vi.mock('../../lib/api', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    put: vi.fn(),
    post: vi.fn(),
    del: vi.fn(),
  },
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  apiGet.mockReset();
  apiGet.mockResolvedValue({ days: [], exceptions: [] });
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
