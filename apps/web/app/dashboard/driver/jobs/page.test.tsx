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

const apiGet = vi.fn();
vi.mock('../../../../lib/api', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
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

afterEach(() => {
  apiGet.mockReset();
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
});
