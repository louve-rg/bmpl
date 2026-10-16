// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * BMPL-280: the shipment ops screen (BMPL-270) gates every operating control
 * — depart/arrive, handoff, flag-a-problem, record-collection — on the
 * single logistics.operate permission, five call sites in one file. useParams
 * is mocked (this page reads the shipment reference from the route), same
 * approach as the other useParams pages in this round.
 */

vi.mock('next/navigation', () => ({
  useParams: () => ({ reference: 'SHP-1001' }),
}));

const { default: ShipmentOpsPage } = await import('./page');

const SHIPMENT = {
  id: 'ship_1',
  reference: 'SHP-1001',
  serviceLabel: 'Door to door',
  status: 'AWAITING_COLLECTION',
  statusLabel: 'Awaiting collection',
  isTest: false,
  endsAtHub: true,
  quotedTotalMinor: 4500,
  explanation: null,
  exceptionReason: null,
  cancelledAt: null,
  origin: { name: 'Belize City', address: '4 Market Sq', city: 'Belize City', district: 'BELIZE' },
  destination: { name: 'San Pedro Airstrip', address: null, city: 'San Pedro', district: 'BELIZE' },
  legs: [
    {
      id: 'leg_1',
      sequence: 1,
      kind: 'LINE_HAUL' as const,
      mode: 'AIR',
      modeLabel: 'Flight',
      status: 'READY',
      description: null,
      carrier: 'Tropic Air',
      carrierBookingRef: null,
      scheduleNote: null,
      departedAt: null,
      arrivedAt: null,
      startedAt: null,
      completedAt: null,
      handoffReceivedByName: null,
      exceptionReason: null,
      originHub: { name: 'Belize City Airstrip' },
      destinationHub: { name: 'San Pedro Airstrip' },
    },
  ],
  custody: [],
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
      if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions });
      if (url.includes('/api/admin/logistics/shipments/SHP-1001')) return jsonResponse(200, SHIPMENT);
      return jsonResponse(404, { message: 'not mocked: ' + url });
    }),
  );
}

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<ShipmentOpsPage />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function buttonTexts(): string[] {
  return Array.from(document.body.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '');
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe('ShipmentOpsPage — write affordances gated on logistics.operate (BMPL-280)', () => {
  it('a logistics.read-only reader sees no write affordance anywhere on the page', async () => {
    stubFetch(['logistics.read']);
    await mount();

    const texts = buttonTexts();
    expect(texts).not.toContain('Record collection');
    expect(texts).not.toContain('Mark departed');
    expect(document.body.textContent).not.toMatch(/Report a problem with this leg/);
    expect(document.body.querySelectorAll('button[disabled]').length).toBe(0);

    // Read-only report half: the shipment and leg facts are still information.
    expect(document.body.textContent).toMatch(/Waiting to be collected/);
    expect(document.body.textContent).toMatch(/Tropic Air/);
    expect(document.body.textContent).toMatch(/\$45\.00/);
  });

  it('a logistics.operate operator sees every write affordance', async () => {
    stubFetch(['logistics.operate']);
    await mount();

    const texts = buttonTexts();
    expect(texts).toContain('Record collection');
    expect(texts).toContain('Mark departed');
    expect(document.body.textContent).toMatch(/Report a problem with this leg/);
  });
});

/**
 * BMPL-178/352 (Edward req 2): pickupPhotoUrls is optional on the web type —
 * web and api deploy independently, so a required field read unguarded is
 * how a screen crashes on the api side lagging behind a merge (BMPL-349).
 */
describe('ShipmentOpsPage — pickup photo (BMPL-178/352)', () => {
  it('shows the courier-attached pickup photo for its own leg', async () => {
    stubFetch(['logistics.read']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions: ['logistics.read'] });
        if (url.includes('/api/admin/logistics/shipments/SHP-1001')) {
          return jsonResponse(200, {
            ...SHIPMENT,
            legs: [{ ...SHIPMENT.legs[0], pickupPhotoUrls: ['https://example.com/pickup.jpg'] }],
          });
        }
        return jsonResponse(404, { message: 'not mocked: ' + url });
      }),
    );
    await mount();

    const imgs = Array.from(document.body.querySelectorAll('img'));
    expect(imgs.some((img) => img.getAttribute('src') === 'https://example.com/pickup.jpg')).toBe(true);
  });

  it('does not crash when pickupPhotoUrls is absent from the leg entirely', async () => {
    stubFetch(['logistics.read']);
    await mount();

    // SHIPMENT's own fixture leg carries no pickupPhotoUrls key at all — the
    // page rendered without throwing and the rest of the leg still shows.
    expect(document.body.textContent).toMatch(/Tropic Air/);
    expect(document.body.querySelectorAll('img[alt^="Pickup photo"]').length).toBe(0);
  });
});

/**
 * BMPL-364: resolving an exceptional leg by return or reroute. Only wiring
 * is asserted here (trigger visibility, permission split, the RETURNED
 * guard) — the pricing/confirmation behaviour itself is covered in full by
 * ExceptionResolution.test.tsx.
 */
describe('ShipmentOpsPage — exception resolution wiring (BMPL-364)', () => {
  function exceptionShipment(overrides: Partial<typeof SHIPMENT> = {}) {
    return {
      ...SHIPMENT,
      status: 'EXCEPTION',
      statusLabel: 'Needs attention',
      exceptionReason: 'Recipient refused delivery.',
      legs: [{ ...SHIPMENT.legs[0], status: 'EXCEPTION', exceptionReason: 'Recipient refused delivery.' }],
      ...overrides,
    };
  }

  it('an operator sees both resolution triggers on an EXCEPTION leg', async () => {
    stubFetch(['logistics.operate']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions: ['logistics.operate'] });
        if (url.includes('/api/admin/logistics/shipments/SHP-1001')) return jsonResponse(200, exceptionShipment());
        return jsonResponse(404, { message: 'not mocked: ' + url });
      }),
    );
    await mount();

    const texts = buttonTexts();
    expect(texts).toContain('Return to sender');
    expect(texts).toContain('Reroute to a new address');
  });

  it('a read-only viewer sees neither trigger, even on an EXCEPTION leg', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions: ['logistics.read'] });
        if (url.includes('/api/admin/logistics/shipments/SHP-1001')) return jsonResponse(200, exceptionShipment());
        return jsonResponse(404, { message: 'not mocked: ' + url });
      }),
    );
    await mount();

    const texts = buttonTexts();
    expect(texts).not.toContain('Return to sender');
    expect(texts).not.toContain('Reroute to a new address');
  });

  it('hides both triggers once the shipment already reads RETURNED (BMPL-356), even though the leg itself stays EXCEPTION', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions: ['logistics.operate'] });
        if (url.includes('/api/admin/logistics/shipments/SHP-1001')) {
          return jsonResponse(200, exceptionShipment({ status: 'RETURNED', statusLabel: 'Returned to sender' }));
        }
        return jsonResponse(404, { message: 'not mocked: ' + url });
      }),
    );
    await mount();

    const texts = buttonTexts();
    expect(texts).not.toContain('Return to sender');
    expect(texts).not.toContain('Reroute to a new address');
  });
});

/**
 * MDF-318 (Edward requirement 10): resuming a leg or releasing its driver had
 * zero UI callers anywhere — `POST legs/:id/resolve-exception` existed,
 * tested and permission-gated, but nothing on this screen (or any other)
 * called it. Only wiring is asserted here (trigger visibility, permission
 * gate, side-by-side with the return/reroute panel) — the resolution
 * behaviour itself is covered in full by ExceptionRecovery.test.tsx.
 */
describe('ShipmentOpsPage — exception recovery wiring (MDF-318, requirement 10)', () => {
  function exceptionShipment(overrides: Partial<typeof SHIPMENT> = {}) {
    return {
      ...SHIPMENT,
      status: 'EXCEPTION',
      statusLabel: 'Needs attention',
      exceptionReason: 'Recipient refused delivery.',
      legs: [{ ...SHIPMENT.legs[0], status: 'EXCEPTION', exceptionReason: 'Recipient refused delivery.' }],
      ...overrides,
    };
  }

  it('an operator sees Resume and Release driver, alongside the existing return/reroute triggers, on a driver-carried EXCEPTION leg', async () => {
    stubFetch(['logistics.operate']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions: ['logistics.operate'] });
        if (url.includes('/api/admin/logistics/shipments/SHP-1001')) {
          return jsonResponse(200, {
            ...exceptionShipment(),
            legs: [{ ...SHIPMENT.legs[0], kind: 'LAST_MILE' as const, status: 'EXCEPTION', exceptionReason: 'Recipient refused delivery.' }],
          });
        }
        return jsonResponse(404, { message: 'not mocked: ' + url });
      }),
    );
    await mount();

    const texts = buttonTexts();
    expect(texts).toContain('Resume');
    expect(texts).toContain('Release driver');
    expect(texts).toContain('Return to sender');
    expect(texts).toContain('Reroute to a new address');
  });

  it('hides Release driver for a LINE_HAUL EXCEPTION leg — a carrier, not a driver, holds it', async () => {
    stubFetch(['logistics.operate']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions: ['logistics.operate'] });
        if (url.includes('/api/admin/logistics/shipments/SHP-1001')) return jsonResponse(200, exceptionShipment());
        return jsonResponse(404, { message: 'not mocked: ' + url });
      }),
    );
    await mount();

    const texts = buttonTexts();
    expect(texts).toContain('Resume');
    expect(texts).not.toContain('Release driver');
  });

  it('a read-only viewer sees neither Resume nor Release driver, even on an EXCEPTION leg', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions: ['logistics.read'] });
        if (url.includes('/api/admin/logistics/shipments/SHP-1001')) return jsonResponse(200, exceptionShipment());
        return jsonResponse(404, { message: 'not mocked: ' + url });
      }),
    );
    await mount();

    const texts = buttonTexts();
    expect(texts).not.toContain('Resume');
    expect(texts).not.toContain('Release driver');
  });

  it('hides both triggers once the shipment already reads RETURNED, same gate as the return/reroute panel', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions: ['logistics.operate'] });
        if (url.includes('/api/admin/logistics/shipments/SHP-1001')) {
          return jsonResponse(200, exceptionShipment({ status: 'RETURNED', statusLabel: 'Returned to sender' }));
        }
        return jsonResponse(404, { message: 'not mocked: ' + url });
      }),
    );
    await mount();

    const texts = buttonTexts();
    expect(texts).not.toContain('Resume');
    expect(texts).not.toContain('Release driver');
  });
});

/**
 * MDF-318 (Edward requirement 12): `scheduleLeg()` (POST legs/:id/schedule)
 * had zero UI callers anywhere. This screen is its first caller, for a
 * LINE_HAUL leg in one of the server's own SCHEDULABLE_LEG_STATUSES.
 */
describe('ShipmentOpsPage — per-leg carrier scheduling wiring (MDF-318, requirement 12)', () => {
  function legOf(overrides: Partial<Record<keyof (typeof SHIPMENT)['legs'][number], unknown>> = {}) {
    return { ...SHIPMENT.legs[0], ...overrides };
  }

  it('an operator sees the schedule control on a READY line-haul leg', async () => {
    stubFetch(['logistics.operate']);
    await mount();

    const texts = buttonTexts();
    expect(texts).toContain('Save schedule');
    expect(document.body.textContent).toMatch(/Departs/);
    expect(document.body.textContent).toMatch(/Arrives/);
  });

  it('a read-only viewer does not see the schedule control', async () => {
    stubFetch(['logistics.read']);
    await mount();

    expect(buttonTexts()).not.toContain('Save schedule');
  });

  it('hides the schedule control once the leg is COMPLETED', async () => {
    stubFetch(['logistics.operate']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions: ['logistics.operate'] });
        if (url.includes('/api/admin/logistics/shipments/SHP-1001')) {
          return jsonResponse(200, { ...SHIPMENT, legs: [legOf({ status: 'COMPLETED', completedAt: '2026-10-01T10:00:00.000Z' })] });
        }
        return jsonResponse(404, { message: 'not mocked: ' + url });
      }),
    );
    await mount();

    expect(buttonTexts()).not.toContain('Save schedule');
  });

  it('calls POST legs/:id/schedule with an ISO scheduledDepartureAt and reloads on success', async () => {
    stubFetch(['logistics.operate']);
    const posted: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions: ['logistics.operate'] });
        if (url.includes('/api/admin/logistics/shipments/SHP-1001') && (!init || init.method === undefined || init.method === 'GET')) {
          return jsonResponse(200, SHIPMENT);
        }
        if (url.includes('/api/admin/logistics/legs/leg_1/schedule') && init?.method === 'POST') {
          posted.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
          return jsonResponse(200, SHIPMENT);
        }
        return jsonResponse(404, { message: 'not mocked: ' + url });
      }),
    );
    await mount();

    const departInput = document.body.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(departInput, '2026-11-01T09:30');
      departInput.dispatchEvent(new Event('input', { bubbles: true }));
      departInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const saveBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent === 'Save schedule')!;
    expect(saveBtn.hasAttribute('disabled')).toBe(false);
    await act(async () => {
      saveBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(posted.length).toBe(1);
    expect(posted[0]!.url).toContain('/api/admin/logistics/legs/leg_1/schedule');
    expect(typeof (posted[0]!.body as { scheduledDepartureAt: string }).scheduledDepartureAt).toBe('string');
    expect((posted[0]!.body as { scheduledDepartureAt: string }).scheduledDepartureAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('surfaces the server refusal verbatim when the schedule call is refused', async () => {
    stubFetch(['logistics.operate']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions: ['logistics.operate'] });
        if (url.includes('/api/admin/logistics/legs/leg_1/schedule')) {
          return jsonResponse(400, { message: 'That departure time has already passed.' });
        }
        if (url.includes('/api/admin/logistics/shipments/SHP-1001')) return jsonResponse(200, SHIPMENT);
        return jsonResponse(404, { message: 'not mocked: ' + url });
      }),
    );
    await mount();

    const departInput = document.body.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(departInput, '2020-01-01T09:30');
      departInput.dispatchEvent(new Event('input', { bubbles: true }));
      departInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const saveBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent === 'Save schedule')!;
    await act(async () => {
      saveBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('That departure time has already passed.');
  });
});
