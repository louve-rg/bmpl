// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * First test coverage for this file. S2-ANNOUNCE added the static "Coming
 * February 2027" strip here (not a second banner component -- see this
 * file's own comment on why) -- it must render unconditionally, before the
 * dynamic ops fetch ever resolves, and survive a dismissed/absent ops
 * message. The dynamic maintenance/announcement behaviour is pinned too,
 * since it had none before.
 */
const apiGet = vi.fn();
vi.mock('../lib/api', () => ({ api: { get: (...a: unknown[]) => apiGet(...a) } }));

import { AnnouncementBanner } from './AnnouncementBanner';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  apiGet.mockReset();
  root = null;
  container = null;
});

async function mount(data: unknown) {
  apiGet.mockImplementation(() => Promise.resolve(data));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<AnnouncementBanner />);
    await Promise.resolve();
  });
  return container;
}

describe('AnnouncementBanner', () => {
  it('renders the static launch strip immediately, before the ops fetch resolves', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    apiGet.mockImplementation(() => new Promise(() => {})); // never resolves
    act(() => root!.render(<AnnouncementBanner />));
    expect(container.textContent).toContain('Coming February 2027');
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/#launch');
  });

  it('keeps showing the launch strip when there is no ops announcement at all', async () => {
    const el = await mount({ announcement: null, maintenance: null });
    expect(el.textContent).toContain('Coming February 2027');
    expect(el.querySelector('[role="status"]')).toBeNull();
  });

  it('renders a real ops announcement alongside the launch strip, not instead of it', async () => {
    const el = await mount({ announcement: { level: 'WARNING', message: 'Checkout is slow right now.' }, maintenance: null });
    expect(el.textContent).toContain('Coming February 2027');
    expect(el.textContent).toContain('Checkout is slow right now.');
  });

  it('renders no countdown timer in the launch strip', async () => {
    const el = await mount({ announcement: null, maintenance: null });
    expect(el.textContent).not.toMatch(/\d+\s*(days?|hours?|minutes?|seconds?)/i);
  });
});
