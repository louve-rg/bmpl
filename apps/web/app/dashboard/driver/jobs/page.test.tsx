// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

// react-dom's act() checks this flag; see page.test.tsx under
// driver/shipping/[id] for the same convention.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

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

const { default: DriverJobsPage } = await import('./page');

function job(over: Record<string, unknown> = {}) {
  return {
    id: 'leg1',
    kind: 'FIRST_MILE',
    kindLabel: 'Parcel pickup',
    reference: 'SHP-1',
    pickup: { name: 'Jane Doe', area: 'Belize City', kind: 'ADDRESS' },
    dropoff: { name: 'Downtown Hub', area: 'Belize City', kind: 'HUB' },
    load: '1 piece',
    status: 'ASSIGNED',
    statusLabel: 'Assigned',
    view: 'assigned',
    feeMinor: 500,
    assignedAt: null,
    acceptedAt: null,
    completedAt: null,
    offerExpiresAt: null,
    queuePosition: null,
    ...over,
  };
}

async function renderPage(jobs: unknown[]) {
  apiGet.mockImplementation((url: string) => {
    if (url === '/driver/jobs/counts') return Promise.resolve({ available: 0, assigned: jobs.length, active: 0, completed: 0 });
    if (url === '/driver/jobs/queue') return Promise.resolve({ items: [], route: {}, followsRecommendation: true });
    if (url.startsWith('/driver/jobs?scope=')) return Promise.resolve(jobs);
    return Promise.resolve(null);
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(DriverJobsPage));
  });
  // The counts call resolves, which opens the "assigned" tab; let that
  // second effect (loading the job list) settle too.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container, root };
}

/** Same as renderPage, but opens on the Available tab (claim rows only ever render there). */
async function renderAvailablePage(jobs: unknown[]) {
  apiGet.mockImplementation((url: string) => {
    if (url === '/driver/jobs/counts') return Promise.resolve({ available: jobs.length, assigned: 0, active: 0, completed: 0 });
    if (url === '/driver/jobs/queue') return Promise.resolve({ items: [], route: {}, followsRecommendation: true });
    if (url.startsWith('/driver/jobs?scope=')) return Promise.resolve(jobs);
    return Promise.resolve(null);
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(DriverJobsPage));
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

describe('DriverJobsPage — list carries kind and availability windows (SHIP-B)', () => {
  it('tags a HUB stop as a terminal and leaves an ADDRESS stop untagged', async () => {
    const { container } = await renderPage([job()]);
    expect(container.textContent).toMatch(/Jane Doe/);
    expect(container.textContent).toMatch(/Downtown Hub\s*·\s*Terminal/);
    expect(container.textContent).not.toMatch(/Jane Doe\s*·\s*Terminal/);
  });

  it('shows the SENDER window beside Collect and the RECIPIENT window beside Deliver, never swapped', async () => {
    const { container } = await renderPage([
      job({
        availabilityWindows: [
          { role: 'SENDER', startTime: '08:00', endTime: '12:00' },
          { role: 'RECIPIENT', startTime: '22:00', endTime: '02:00' },
        ],
      }),
    ]);
    const text = container.textContent ?? '';
    // "Deliver" is also a substring of the "My Deliveries" page title, so
    // every search below starts after the card's own "Collect" line.
    const collectAt = text.indexOf('Collect Jane Doe');
    const deliverAt = text.indexOf('Deliver ', collectAt);
    const senderWindowAt = text.indexOf('8:00 AM–12:00 PM', collectAt);
    const recipientWindowAt = text.indexOf('10:00 PM–2:00 AM (overnight)', collectAt);
    expect(senderWindowAt).toBeGreaterThan(collectAt);
    expect(senderWindowAt).toBeLessThan(deliverAt);
    expect(recipientWindowAt).toBeGreaterThan(deliverAt);
  });

  it('renders nothing extra when availabilityWindows is absent from the wire', async () => {
    const { container } = await renderPage([job()]);
    // "Available" alone also matches the tab filter label — this checks for
    // the window phrasing specifically, not the word.
    expect(container.textContent).not.toMatch(/Available \d/);
  });

  // P2-SHIPMENT-PARITY: the API already computes a human statusLabel
  // (DELIVERY_STATUS_LABELS) for this exact `status` value — this card used
  // to ignore it and show the raw courierStatus enum instead.
  it('shows the API\'s own statusLabel on the status badge, not the raw courierStatus enum', async () => {
    const { container } = await renderPage([job({ status: 'DRIVER_ACCEPTED', statusLabel: 'Driver accepted' })]);
    expect(container.textContent).toContain('Driver accepted');
    expect(container.textContent).not.toMatch(/DRIVER ACCEPTED/);
  });
});

/**
 * SHIP-B Bug 1 (list): mirrors PlaceBlock's own rule on the detail page —
 * name ?? area as the primary line, an address line when the server sends
 * one, and area again underneath only when BOTH a name and an area exist
 * (never shown twice, never shown alone when there's nothing to pair it
 * with). The server is the sole gate on whether `address` is populated at
 * all (offer-time for this job's own door end, still gated for name/phone)
 * — the page does not add a second acceptance check of its own.
 */
describe('DriverJobsPage — list shows a door end\'s real address (SHIP-B Bug 1)', () => {
  it('shows the address beneath the name, and the area beneath that', async () => {
    const { container } = await renderPage([job({ pickup: { name: 'Jane Doe', area: 'Belize City', kind: 'ADDRESS', address: '12 Albert St' } })]);
    const text = container.textContent ?? '';
    const nameAt = text.indexOf('Collect Jane Doe');
    const addressAt = text.indexOf('12 Albert St', nameAt);
    const areaAt = text.indexOf('Belize City', addressAt);
    expect(nameAt).toBeGreaterThan(-1);
    expect(addressAt).toBeGreaterThan(nameAt);
    expect(areaAt).toBeGreaterThan(addressAt);
  });

  it('renders exactly as before when address is absent from the wire — name/area only, no crash', async () => {
    const raw = JSON.parse(JSON.stringify(job())) as Record<string, unknown>;
    const el = await renderPage([raw]);
    expect(el.container.textContent).toMatch(/Collect Jane Doe/);
    expect(el.container.textContent).not.toMatch(/12 Albert St/);
  });

  it('does not repeat the area on its own line when there is no name to pair it with', async () => {
    // A HUB end always has a name, so this exercises an ADDRESS end with no
    // name yet (not accepted) but an area — the one-line case.
    const { container } = await renderPage([
      job({ dropoff: { name: null, area: 'Dangriga', kind: 'ADDRESS', address: null } }),
    ]);
    const text = container.textContent ?? '';
    expect(text).toMatch(/Deliver Dangriga/);
    // Exactly one occurrence of "Dangriga" — the primary line's fallback,
    // not a second, redundant area line underneath it.
    expect(text.split('Dangriga').length - 1).toBe(1);
  });
});

/**
 * EDW-P3: the Available list now has two kinds of row — a live offer
 * (unchanged, no `claim` key) and a post-exhaustion row the server appends
 * after them, carrying a `claim` object. Routing the latter to the normal
 * job-detail page would 404 it (not assigned to this driver yet), so it
 * must render inline instead, and the owner's "one job, not two" rule means
 * it must say plainly that the same job is also on Unclaimed Jobs.
 */
function claimRow(over: Record<string, unknown> = {}) {
  return job({
    id: 'leg-claim',
    view: 'available',
    status: 'ASSIGNED',
    statusLabel: 'Assigned',
    claim: {
      dispatchExhaustedAt: '2026-11-20T10:00:00.000Z',
      youPassed: false,
      inAvailableJobs: true,
      claimPath: '/driver/jobs/leg-claim/claim',
    },
    ...over,
  });
}

describe('DriverJobsPage — unclaimed rows appended to Available (EDW-P3)', () => {
  it('gives a claim row a Claim button and no link to the job-detail page, while a live offer stays linked', async () => {
    const liveOffer = job({ id: 'leg-live', view: 'available', status: 'ASSIGNED', offerExpiresAt: '2026-11-26T20:00:00.000Z' });
    const { container } = await renderAvailablePage([liveOffer, claimRow()]);

    const links = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toContain('/dashboard/driver/shipping/leg-live');
    expect(links).not.toContain('/dashboard/driver/shipping/leg-claim');

    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toContain('Claim this job');
  });

  it('says the row is also on Unclaimed Jobs, and shows when dispatch gave up rather than a fake offer-expiry countdown', async () => {
    const { container } = await renderAvailablePage([claimRow()]);
    const text = container.textContent ?? '';
    expect(text).toMatch(/Also listed on\s*Unclaimed Jobs/);
    expect(text).toMatch(/Waiting since/);
    expect(text).not.toMatch(/Offer expires/);
  });

  it('claims via claim.claimPath — never a path built from the job id — and navigates to the resulting job', async () => {
    apiPost.mockResolvedValue({ id: 'won1' });
    const { container } = await renderAvailablePage([claimRow()]);
    const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Claim this job')!;
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(apiPost).toHaveBeenCalledWith('/driver/jobs/leg-claim/claim');
    expect(router.push).toHaveBeenCalledWith('/dashboard/driver/shipping/won1');
  });

  it('on a 409, removes the row and shows a plain notice rather than an error', async () => {
    apiPost.mockRejectedValue({ status: 409, message: 'This delivery was just claimed or reassigned — reload and try again.' });
    const { container } = await renderAvailablePage([claimRow()]);
    const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Claim this job')!;
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent === 'Claim this job')).toBe(false);
    expect(container.textContent).toMatch(/no longer available — it was claimed or reassigned/);
    expect(router.push).not.toHaveBeenCalled();
  });
});
