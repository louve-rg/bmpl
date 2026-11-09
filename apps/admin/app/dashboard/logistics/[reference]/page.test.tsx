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

// MDF-538: a minimal fake Leaflet, same shape as apps/web's map tests --
// only exercised by the two tests below that actually reveal the map; every
// existing test here has no coordinates on origin/destination and never
// imports 'leaflet' at all.
vi.mock('leaflet', () => {
  function fakeMarker() {
    const marker = { addTo: vi.fn(), bindPopup: vi.fn(), on: vi.fn(), openPopup: vi.fn() };
    marker.addTo.mockReturnValue(marker);
    marker.bindPopup.mockReturnValue(marker);
    return marker;
  }
  function fakeMap() {
    return {
      setView: vi.fn(),
      on: vi.fn(),
      getZoom: vi.fn(() => 13),
      invalidateSize: vi.fn(),
      remove: vi.fn(),
      fitBounds: vi.fn(),
      dragging: { enable: vi.fn(), disable: vi.fn() },
    };
  }
  const L = {
    map: vi.fn(() => fakeMap()),
    tileLayer: vi.fn(() => ({ addTo: vi.fn().mockReturnThis() })),
    divIcon: vi.fn(() => ({})),
    marker: vi.fn(() => fakeMarker()),
    latLngBounds: vi.fn(() => ({})),
  };
  return { default: L };
});
vi.mock('leaflet/dist/leaflet.css', () => ({}));

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

/**
 * MDF-500: assigning the carrier organization that operates
 * a LINE_HAUL leg, through this screen rather than only by API — Stage 2's
 * read-only-inspection-plus-assignment slice, built against the existing
 * `POST legs/:id/operator` (its shape does not move under D1-D4, only the
 * internal eligibility guarantee does).
 */
describe('ShipmentOpsPage — carrier operator assignment (MDF-500)', () => {
  const PROVIDERS = [
    { id: 'prov_1', businessName: 'Tropic Air', isActive: true, isTest: false },
    { id: 'prov_2', businessName: 'Maya Island Air', isActive: true, isTest: false },
    { id: 'prov_3', businessName: 'Retired Carrier', isActive: false, isTest: false },
    { id: 'prov_4', businessName: 'Sim Carrier', isActive: true, isTest: true },
  ];

  function stubFetchWithProviders(adminPermissions: string[], shipment: unknown = SHIPMENT) {
    const posted: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions });
        if (url.includes('/api/admin/logistics/providers')) return jsonResponse(200, PROVIDERS);
        if (url.includes('/api/admin/logistics/legs/leg_1/operator') && init?.method === 'POST') {
          posted.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
          return jsonResponse(200, { legId: 'leg_1', operatedByProviderId: JSON.parse(String(init.body)).providerProfileId });
        }
        if (url.includes('/api/admin/logistics/shipments/SHP-1001') && (!init?.method || init.method === 'GET')) {
          return jsonResponse(200, shipment);
        }
        return jsonResponse(404, { message: 'not mocked: ' + url });
      }),
    );
    return posted;
  }

  it('shows "Not assigned" for a line-haul leg with no operator yet', async () => {
    stubFetchWithProviders(['logistics.read']);
    await mount();

    expect(document.body.textContent).toContain('Not assigned');
  });

  it('shows the resolved carrier name, not a bare id, once one is assigned', async () => {
    // A name distinct from the fixture's free-text leg.carrier ("Tropic Air")
    // so this assertion cannot pass on the pre-existing field by accident.
    stubFetchWithProviders(['logistics.read'], {
      ...SHIPMENT,
      legs: [{ ...SHIPMENT.legs[0], operatedByProviderId: 'prov_1', operatorName: 'Really Reliable Air' }],
    });
    await mount();

    expect(document.body.textContent).toMatch(/Really Reliable Air/);
    expect(document.body.textContent).not.toMatch(/Not assigned/);
  });

  it('a logistics.read-only viewer sees the assignment but not the control to change it', async () => {
    stubFetchWithProviders(['logistics.read']);
    await mount();

    expect(document.body.textContent).toMatch(/Not assigned/);
    expect(buttonTexts()).not.toContain('Assign');
    expect(document.body.querySelector('select#op-leg_1')).toBeNull();
  });

  it('a logistics.operate holder sees every carrier, with the eligible ones pickable and the ineligible ones disabled and named why (MDF-520, D4)', async () => {
    stubFetchWithProviders(['logistics.operate']);
    await mount();

    const select = document.body.querySelector('select#op-leg_1') as HTMLSelectElement;
    const options = Array.from(select.options);
    const byLabel = (text: string) => options.find((o) => o.textContent === text);

    expect(byLabel('Tropic Air')?.disabled).toBe(false);
    expect(byLabel('Maya Island Air')?.disabled).toBe(false);

    // Ineligible carriers stay IN the list -- an admin who omits one from the
    // dropdown cannot tell "deactivated" from "never existed" -- but each is
    // disabled and labelled with the specific gate it fails, mirroring
    // assertOperableProvider (apps/api) rather than a flat "not eligible".
    const retired = byLabel('Retired Carrier — deactivated');
    expect(retired?.disabled).toBe(true);
    const sim = byLabel('Sim Carrier — a simulation-only carrier');
    expect(sim?.disabled).toBe(true);
  });

  it('assigning posts the picked providerProfileId and reloads', async () => {
    const posted = stubFetchWithProviders(['logistics.operate']);
    await mount();

    const select = document.body.querySelector('select#op-leg_1') as HTMLSelectElement;
    await act(async () => {
      select.value = 'prov_1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const assignBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Assign')!;
    expect(assignBtn.hasAttribute('disabled')).toBe(false);
    await act(async () => {
      assignBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]?.body).toMatchObject({ providerProfileId: 'prov_1' });
  });

  it('picking "— none —" on an already-assigned leg clears the operator (providerProfileId: null)', async () => {
    const posted = stubFetchWithProviders(['logistics.operate'], {
      ...SHIPMENT,
      legs: [{ ...SHIPMENT.legs[0], operatedByProviderId: 'prov_1', operatorName: 'Tropic Air' }],
    });
    await mount();

    const select = document.body.querySelector('select#op-leg_1') as HTMLSelectElement;
    await act(async () => {
      select.value = '';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const assignBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Assign')!;
    await act(async () => {
      assignBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]?.body).toMatchObject({ providerProfileId: null });
  });

  it('surfaces the server refusal verbatim when an ineligible carrier is picked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions: ['logistics.operate'] });
        if (url.includes('/api/admin/logistics/providers')) return jsonResponse(200, PROVIDERS);
        if (url.includes('/api/admin/logistics/legs/leg_1/operator') && init?.method === 'POST') {
          return jsonResponse(400, { message: 'That carrier is not an approved shipping provider.' });
        }
        if (url.includes('/api/admin/logistics/shipments/SHP-1001')) return jsonResponse(200, SHIPMENT);
        return jsonResponse(404, { message: 'not mocked: ' + url });
      }),
    );
    await mount();

    const select = document.body.querySelector('select#op-leg_1') as HTMLSelectElement;
    await act(async () => {
      select.value = 'prov_1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const assignBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Assign')!;
    await act(async () => {
      assignBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('That carrier is not an approved shipping provider.');
  });

  it('does not show the carrier block for a non-line-haul leg', async () => {
    stubFetchWithProviders(['logistics.operate'], {
      ...SHIPMENT,
      legs: [{ ...SHIPMENT.legs[0], kind: 'LAST_MILE' as const }],
    });
    await mount();

    expect(document.body.textContent).not.toMatch(/Not assigned/);
    expect(document.body.querySelector('select#op-leg_1')).toBeNull();
  });

  it('does not show the carrier block once the leg is COMPLETED', async () => {
    stubFetchWithProviders(['logistics.operate'], {
      ...SHIPMENT,
      legs: [{ ...SHIPMENT.legs[0], status: 'COMPLETED', completedAt: '2026-10-01T10:00:00.000Z' }],
    });
    await mount();

    expect(document.body.querySelector('select#op-leg_1')).toBeNull();
  });
});

describe('ShipmentOpsPage — map preview makes a text/pin mismatch visible (MDF-538, owner section 8)', () => {
  const SHIPMENT_WITH_PINS = {
    ...SHIPMENT,
    origin: { ...SHIPMENT.origin, latitude: 17.5, longitude: -88.2 },
    destination: { ...SHIPMENT.destination, latitude: 17.92, longitude: -87.96 },
  };

  function stubFetchWithPins() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions: ['logistics.read'] });
        if (url.includes('/api/admin/logistics/shipments/SHP-1001')) return jsonResponse(200, SHIPMENT_WITH_PINS);
        return jsonResponse(404, { message: 'not mocked: ' + url });
      }),
    );
  }

  it('never touches Leaflet until "Show map" is tapped, even though both ends have a pin', async () => {
    const leaflet = (await import('leaflet')).default as unknown as { map: ReturnType<typeof vi.fn> };
    leaflet.map.mockClear();
    stubFetchWithPins();
    await mount();

    expect(document.body.textContent).toContain('On the map');
    expect(leaflet.map).not.toHaveBeenCalled();
  });

  it('shows no map and a clear hint when neither end has a pin, rather than a blank box', async () => {
    stubFetch(['logistics.read']);
    await mount();

    expect(document.body.textContent).toContain('No pin on file for either end of this shipment.');
    expect(buttonTexts()).not.toContain('Show map');
  });

  it('draws both ends, lettered, once "Show map" is tapped', async () => {
    const leaflet = (await import('leaflet')).default as unknown as { map: ReturnType<typeof vi.fn>; marker: ReturnType<typeof vi.fn> };
    leaflet.map.mockClear();
    leaflet.marker.mockClear();
    stubFetchWithPins();
    await mount();

    const showMap = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Show map');
    expect(showMap).not.toBeUndefined();
    await act(async () => {
      showMap!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(leaflet.map).toHaveBeenCalledTimes(1);
    expect(leaflet.marker).toHaveBeenCalledTimes(2);
    expect(leaflet.marker).toHaveBeenCalledWith([17.5, -88.2], expect.anything());
    expect(leaflet.marker).toHaveBeenCalledWith([17.92, -87.96], expect.anything());
    expect(document.body.textContent).toMatch(/A\s*From/);
    expect(document.body.textContent).toMatch(/B\s*To/);
  });

  it('expanding opens the full-screen modal with the same two stops', async () => {
    stubFetchWithPins();
    await mount();

    const showMap = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Show map')!;
    await act(async () => {
      showMap.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    const expand = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Expand')!;
    await act(async () => {
      expand.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain(`${SHIPMENT.reference} · route`);
  });
});

/**
 * MDF-624 (DISPATCH-3): the DETAIL half of the stuck-manual-assignment pair
 * -- the board (list) is where it must be NOTICED without opening anything;
 * this screen is where an admin CONFIRMS before reassigning. Reads
 * `leg.manualAssignmentPendingSince` directly -- the SAME field, computed
 * by the SAME expression in `serialize()`, that the board already reads
 * from `listForOps`. Deliberately NOT re-derived client-side: an earlier
 * version of this screen derived it from courierStatus/acceptedAt alone
 * (no offerExpiresAt on this payload to make the test three clauses), which
 * silently matched a healthy, self-healing AUTOMATIC offer too -- see the
 * dedicated test for that case below. Acting goes through the EXISTING
 * LegAssignModal/reassign endpoint -- no new one.
 */
describe('ShipmentOpsPage — confirming and acting on a stuck manual assignment (MDF-624)', () => {
  const STUCK_LEG = {
    ...SHIPMENT.legs[0],
    id: 'leg_fm',
    kind: 'FIRST_MILE' as const,
    status: 'READY',
    courierStatus: 'ASSIGNED',
    acceptedAt: null as string | null,
    manualAssignmentPendingSince: new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString() as string | null, // ~2d ago
    courier: { displayName: 'Jordan Reyes' },
  };

  function stuckShipment(overrides: Partial<typeof STUCK_LEG> = {}) {
    return { ...SHIPMENT, legs: [{ ...STUCK_LEG, ...overrides }] };
  }

  it('shows the stuck-assignment notice with the driver name and real age, to a read-only viewer too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions: ['logistics.read'] });
        if (url.includes('/api/admin/logistics/shipments/SHP-1001')) return jsonResponse(200, stuckShipment());
        return jsonResponse(404, { message: 'not mocked: ' + url });
      }),
    );
    await mount();

    expect(document.body.textContent).toContain('Manually assigned to Jordan Reyes');
    expect(document.body.textContent).toContain('still waiting for them to accept');
    expect(document.body.textContent).toContain('2d ago');
    // Notice is informational for everyone; the ACTION is what's gated.
    expect(buttonTexts()).not.toContain('Reassign driver');
  });

  it('does NOT show the notice when manualAssignmentPendingSince is null -- covers both the driver-already-accepted case and the healthy-automatic-offer case (courierStatus ASSIGNED, acceptedAt null, but no offerExpiresAt on this payload to tell the two apart client-side)', async () => {
    // This is the exact shape an earlier, re-derived version of this screen
    // got wrong: ASSIGNED + acceptedAt null alone matched a self-healing
    // AUTOMATIC offer too. Trusting the server's own field -- one
    // computation, shared with the board -- means there is nothing left
    // here to derive, and nothing left to get wrong the same way again.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions: ['logistics.operate'] });
        if (url.includes('/api/admin/logistics/shipments/SHP-1001')) {
          return jsonResponse(200, stuckShipment({ manualAssignmentPendingSince: null }));
        }
        return jsonResponse(404, { message: 'not mocked: ' + url });
      }),
    );
    await mount();

    expect(document.body.textContent).not.toContain('Manually assigned to');
    expect(document.body.textContent).not.toContain('still waiting for them to accept');
    expect(buttonTexts()).not.toContain('Reassign driver');
  });

  it('an operator gets a Reassign driver trigger that opens the existing LegAssignModal against this same leg', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions: ['logistics.operate'] });
        if (url.includes('/api/admin/logistics/shipments/SHP-1001')) return jsonResponse(200, stuckShipment());
        if (url.includes('/api/admin/logistics/legs/leg_fm/eligible-drivers')) return jsonResponse(200, []);
        return jsonResponse(404, { message: 'not mocked: ' + url });
      }),
    );
    await mount();

    const trigger = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Reassign driver')!;
    expect(trigger).not.toBeUndefined();
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute('aria-label')).toBe('Reassign driver');
    expect(dialog!.textContent).toContain('Jordan Reyes');
  });
});
