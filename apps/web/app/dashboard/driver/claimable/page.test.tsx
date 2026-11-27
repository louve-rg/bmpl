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
    claim: {
      dispatchExhaustedAt: '2026-11-20T10:00:00.000Z',
      youPassed: false,
      inAvailableJobs: false,
      claimPath: '/driver/jobs/del1/claim',
    },
    ...over,
  };
}

/** EDW-P3: the courier-leg side of the same endpoint — no marketplace fields at all. */
function legJob(over: Record<string, unknown> = {}) {
  return {
    id: 'leg1',
    kind: 'FIRST_MILE',
    kindLabel: 'Shipping pickup',
    reference: 'BML-7Q2K',
    pickup: { area: 'Belize City' },
    dropoff: { area: 'San Pedro' },
    load: '1 parcel',
    feeMinor: 1200,
    claim: {
      dispatchExhaustedAt: '2026-11-21T09:00:00.000Z',
      youPassed: false,
      inAvailableJobs: false,
      claimPath: '/driver/jobs/leg1/claim',
    },
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
  it('sends the claim to claim.claimPath and navigates to the marketplace detail page for a marketplace row', async () => {
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
 * EDW-P3: `claimableJobs` now covers shipment courier legs too — the
 * courier side gains a claim path it never had. The card shows the
 * normalized fields (kind/reference/pickup/dropoff/load) instead of the
 * marketplace ones, and a successful claim routes to the shipping detail
 * route, not the marketplace one.
 */
describe('ClaimableJobsPage — courier-leg rows (EDW-P3)', () => {
  it('shows the leg reference, kind label and normalized pickup/dropoff areas, not marketplace fields', async () => {
    const { container } = await renderPage([legJob()]);
    const text = container.textContent ?? '';
    expect(text).toMatch(/BML-7Q2K/);
    expect(text).toMatch(/Shipping pickup/);
    expect(text).toMatch(/Collect\s*Belize City/);
    expect(text).toMatch(/Deliver\s*San Pedro/);
    expect(text).toMatch(/1 parcel/);
    expect(text).not.toMatch(/Order #/);
  });

  it('claims via claim.claimPath and navigates to the shipping detail route for a courier leg', async () => {
    apiPost.mockResolvedValue({ id: 'leg1' });
    const { container } = await renderPage([legJob()]);
    const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Claim this job')!;
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(apiPost).toHaveBeenCalledWith('/driver/jobs/leg1/claim');
    expect(router.push).toHaveBeenCalledWith('/dashboard/driver/shipping/leg1');
  });

  it('on a 409 for a courier leg, names it by reference rather than a marketplace order number', async () => {
    apiPost.mockRejectedValue({ status: 409, message: 'ignored' });
    const { container } = await renderPage([legJob()]);
    const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Claim this job')!;
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toMatch(/BML-7Q2K is no longer available/);
  });
});

/**
 * EDW-P3 (owner requirement): the same job can show on both this page and
 * the Available tab. `claim.inAvailableJobs` is the server's own call on
 * that, never recomputed here — when true, the card must say so, so a
 * driver checking both tabs sees one job, not two.
 */
describe('ClaimableJobsPage — same job also on the Available tab (EDW-P3)', () => {
  it('links to the Available tab when claim.inAvailableJobs is true', async () => {
    const { container } = await renderPage([job({ claim: { ...job().claim, inAvailableJobs: true } })]);
    expect(container.textContent).toMatch(/Also showing in your\s*Available\s*tab/);
  });

  it('says nothing about the Available tab when claim.inAvailableJobs is false', async () => {
    const { container } = await renderPage([job()]);
    expect(container.textContent).not.toMatch(/Available\s*tab/);
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
    // itself ("Order #ORD-1001 is no longer available…") — what must be gone is
    // the CARD (its claim button), not every mention of the order number.
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent === 'Claim this job')).toBe(false);
    expect(container.textContent).toMatch(/no longer available — it was claimed or reassigned/);
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
