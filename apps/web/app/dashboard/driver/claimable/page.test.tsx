// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

// react-dom's act() checks this flag — see jobs/[id]/page.test.tsx for the
// same convention (no @testing-library/react dependency in this repo).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A STABLE object — see BMPL-380, cited by jobs/[id]/page.test.tsx: a fresh
// object on every useRouter() call can turn a callback dependency into an
// infinite render loop that looks exactly like a hang.
const router = { push: vi.fn() };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('../../../../lib/api', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
}));

const { default: ClaimableJobsPage } = await import('./page');

function job(over: Record<string, unknown> = {}) {
  return {
    id: 'del1',
    orderNumber: 'ORD-1001',
    vendor: 'Sunrise Grocery',
    itemCount: 3,
    city: 'Belmopan',
    district: 'CAYO',
    feeMinor: 850,
    dispatchExhaustedAt: '2026-11-20T10:00:00.000Z',
    ...over,
  };
}

async function renderPage(jobs: unknown[]) {
  apiGet.mockImplementation((url: string) => (url === '/driver/jobs/claimable' ? Promise.resolve(jobs) : Promise.resolve(null)));
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(ClaimableJobsPage));
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container, root };
}

afterEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  router.push.mockReset();
  document.body.innerHTML = '';
});

describe('ClaimableJobsPage — lists what summarizeClaimable actually returns', () => {
  it('shows the vendor, destination, item count and fee from the wire', async () => {
    const { container } = await renderPage([job()]);
    const text = container.textContent ?? '';
    expect(text).toMatch(/Order #ORD-1001/);
    expect(text).toMatch(/Collect from\s*Sunrise Grocery/);
    expect(text).toMatch(/Deliver to\s*Belmopan, CAYO/);
    expect(text).toMatch(/3 items/);
    expect(text).toMatch(/\$8\.50/);
  });

  it('renders an empty state rather than a spinner forever when there is nothing to claim', async () => {
    const { container } = await renderPage([]);
    expect(container.textContent).toMatch(/No unclaimed jobs right now/);
  });

  it('shows the API error rather than silently rendering nothing when the list call fails', async () => {
    apiGet.mockImplementation((url: string) =>
      url === '/driver/jobs/claimable' ? Promise.reject({ status: 500, message: 'Something went wrong.' }) : Promise.resolve(null),
    );
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(ClaimableJobsPage));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toMatch(/Something went wrong/);
  });
});

describe('ClaimableJobsPage — claim success', () => {
  it('sends the claim and navigates to the job detail page the API hands back', async () => {
    apiPost.mockResolvedValue({ id: 'del1' });
    const { container } = await renderPage([job()]);
    const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Claim this job')!;
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(apiPost).toHaveBeenCalledWith('/driver/jobs/del1/claim');
    expect(router.push).toHaveBeenCalledWith('/dashboard/driver/jobs/del1');
  });
});

/**
 * P4-CLAIM: the lost-race case the card says it must handle — a 409 from
 * DriverJobService.claim() means another driver's (or admin's, or a fresh
 * automatic offer's) conditional write won first. It must read as a plain
 * explained outcome, not an error dialog: the job leaves the list and a
 * single info notice explains why, with no `tone="error"` anywhere.
 */
describe('ClaimableJobsPage — lost-race handling (MDF-18 409/404)', () => {
  it('on 409, removes the job and explains it as a normal outcome, not an error', async () => {
    apiPost.mockRejectedValue({ status: 409, message: 'This delivery was just claimed or reassigned — reload and try again.' });
    const { container } = await renderPage([job()]);
    const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Claim this job')!;
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    // The order number legitimately appears inside the explanatory notice
    // itself ("Order #ORD-1001 was just claimed…") — what must be gone is
    // the CARD (its claim button), not every mention of the order number.
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent === 'Claim this job')).toBe(false);
    expect(container.textContent).toMatch(/claimed by another driver/);
    expect(container.querySelector('[role="alert"]')?.textContent).not.toMatch(/reload and try again/);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('on 404, removes the job and says it is no longer available', async () => {
    apiPost.mockRejectedValue({ status: 404, message: 'Job not found.' });
    const { container } = await renderPage([job()]);
    const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Claim this job')!;
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent === 'Claim this job')).toBe(false);
    expect(container.textContent).toMatch(/no longer available/);
  });

  it('on a business-rule 400, keeps the card and shows the reason on it, since the job may still be claimable later', async () => {
    apiPost.mockRejectedValue({ status: 400, message: 'You already have the maximum number of active jobs.' });
    const { container } = await renderPage([job()]);
    const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Claim this job')!;
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toMatch(/Order #ORD-1001/);
    expect(container.textContent).toMatch(/maximum number of active jobs/);
  });
});
