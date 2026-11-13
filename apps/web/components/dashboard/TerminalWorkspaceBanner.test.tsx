// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalWorkspaceBanner } from './TerminalWorkspaceBanner';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * F-NAV: the prominent top-of-dashboard link, so a terminal company member
 * does not have to scroll past the customer nav and expand a collapsed
 * group to find their workspace. Renders on a confirmed 'member' only --
 * loading/error/not-member are deliberately out of scope here (MDF-720's
 * nav-level affordances already cover those); showing nothing is correct
 * for everyone who isn't a confirmed member, including while that's still
 * being checked.
 */

const apiGet = vi.fn();
vi.mock('../../lib/api', () => ({
  api: { get: (...args: unknown[]) => apiGet(...args) },
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  apiGet.mockReset();
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
    root!.render(<TerminalWorkspaceBanner />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

describe('TerminalWorkspaceBanner (F-NAV)', () => {
  it('renders nothing for a user with no terminal company membership', async () => {
    apiGet.mockImplementation(() => Promise.reject({ status: 403 }));
    const c = await mount();

    expect(c.textContent).toBe('');
  });

  it('renders nothing while membership is still loading -- not a premature claim', async () => {
    apiGet.mockImplementation(() => new Promise(() => {})); // never resolves
    const c = await mount();

    expect(c.textContent).toBe('');
  });

  it('renders nothing on a non-403 error -- never claims a workspace that was not confirmed', async () => {
    apiGet.mockImplementation(() => Promise.reject(new Error('network error')));
    const c = await mount();

    expect(c.textContent).toBe('');
  });

  it('shows a prominent, working link to the workspace for a confirmed member', async () => {
    apiGet.mockImplementation(() => Promise.resolve({ companyId: 'co_1', companyName: 'Tropic Air', memberRole: 'MANAGER', locations: [] }));
    const c = await mount();

    const link = c.querySelector('a');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('/dashboard/terminal');
    expect(c.textContent).toMatch(/Terminal Workspace/);
  });
});
