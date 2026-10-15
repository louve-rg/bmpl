// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const apiGet = vi.fn();
vi.mock('../../../lib/api', () => ({
  api: { get: (...args: unknown[]) => apiGet(...args) },
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { default: VendorsPage } = await import('./page');

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  apiGet.mockReset();
});

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<VendorsPage />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

/**
 * god, conv-mission-2026-10-13: "No vendors in this state" told the truth
 * about a narrower question (the active filter) than the one an operator
 * reads it as ("no vendors at all") — same shape as the dispatch-silence
 * defect found earlier tonight. The default filter (PENDING, a moderation
 * queue opening on the work that needs doing) stays unchanged on purpose;
 * only the empty-state wording names which filter is empty.
 */
describe('VendorsPage — empty state names the active filter', () => {
  it('names PENDING on the default load, not a generic "no vendors"', async () => {
    apiGet.mockResolvedValue([]);
    const el = await mount();
    expect(el.textContent).toContain('No vendors pending approval.');
    expect(el.textContent).not.toContain('No vendors in this state.');
  });

  it('names APPROVED once that tab is active', async () => {
    apiGet.mockResolvedValue([]);
    const el = await mount();
    const button = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'APPROVED')!;
    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(el.textContent).toContain('No approved vendors.');
  });

  it('names "All" plainly when the All tab is active', async () => {
    apiGet.mockResolvedValue([]);
    const el = await mount();
    const button = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'All')!;
    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(el.textContent).toContain('No vendors at all.');
  });
});
