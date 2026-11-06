// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LogisticsOpsPage from './page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * BMPL-280: the logistics ops board (BMPL-270) gates the ONLY trigger for
 * LegAssignModal — the "Assign driver"/"Reassign" link — on
 * logistics.operate, the same permission the modal's own writes need.
 * LegAssignModal itself carries no check (it can never mount for a
 * non-operator, per its own comment) — nothing to test inside a component
 * that literally cannot render for a reader.
 */

const ROW = {
  id: 'ship_1',
  reference: 'SHP-2001',
  serviceLabel: 'Door to hub',
  status: 'FIRST_MILE',
  statusLabel: 'First mile',
  isTest: false,
  customer: 'Jordan Reyes',
  origin: 'Belize City',
  destination: 'San Pedro',
  totalMinor: 5000,
  exceptionReason: null,
  needsAttention: false,
  needsDriver: false,
  createdAt: new Date().toISOString(),
  legs: [
    {
      id: 'leg_1',
      sequence: 1,
      kind: 'FIRST_MILE',
      mode: 'LAND',
      status: 'READY',
      courierStatus: null,
      from: 'Belize City',
      to: 'Belize City Hub',
      operator: null,
      needsDriver: false,
    },
  ],
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
      if (url.includes('/api/admin/logistics/shipments')) return jsonResponse(200, { rows: [ROW], total: 1 });
      return jsonResponse(404, { message: 'not mocked: ' + url });
    }),
  );
}

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<LogisticsOpsPage />);
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

/**
 * MDF-560 (owner): "a shipment that can be booked but has no carrier to
 * move it must be accurately represented as awaiting fulfilment, not
 * treated as operationally complete." A LINE_HAUL leg is never dispatched
 * to a driver (`legAssignMode` refuses it outright), so the server's own
 * `needsDriver` -- dispatch exhaustion -- can never fire for one, and
 * without the board's own check an unassigned transport leg read exactly
 * like an ordinarily-queued one: neutral "Waiting", no card highlight.
 */
const CROSS_TOWN_ROW = {
  ...ROW,
  id: 'ship_2',
  reference: 'BML-TEST0002',
  status: 'AT_ORIGIN_HUB',
  statusLabel: 'At the departure terminal',
  needsDriver: false,
  legs: [
    { id: 'leg_fm', sequence: 1, kind: 'FIRST_MILE', mode: 'LAND', status: 'COMPLETED', courierStatus: 'DELIVERED', from: 'Sender', to: 'Belize City Hub', operator: 'J. Reyes', needsDriver: false },
    { id: 'leg_lh', sequence: 2, kind: 'LINE_HAUL', mode: 'LAND', status: 'PENDING', courierStatus: null, from: 'Belize City Hub', to: 'Belmopan Hub', operator: null, needsDriver: false },
    { id: 'leg_lm', sequence: 3, kind: 'LAST_MILE', mode: 'LAND', status: 'PENDING', courierStatus: null, from: 'Belmopan Hub', to: 'Recipient', operator: null, needsDriver: false },
  ],
};

function stubFetchRows(adminPermissions: string[], rows: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions });
      if (url.includes('/api/admin/logistics/shipments')) return jsonResponse(200, { rows, total: rows.length });
      return jsonResponse(404, { message: 'not mocked: ' + url });
    }),
  );
}

describe('LogisticsOpsPage — an unassigned LINE_HAUL leg reads as awaiting fulfilment, not routine progress (MDF-560)', () => {
  it('flags the leg "No carrier assigned" and highlights the card, even though the server\'s own needsDriver/needsAttention are both false', async () => {
    stubFetchRows(['logistics.read'], [CROSS_TOWN_ROW]);
    await mount();

    expect(document.body.textContent).toContain('No carrier assigned');
    expect(document.body.textContent).toContain('A transport leg has no carrier assigned yet');
    const card = document.body.querySelector('a[href*="BML-TEST0002"]')?.closest('[class*="border-amber"]');
    expect(card).not.toBeNull();
  });

  it('says nothing extra once a carrier is on record, even on the same unfinished leg', async () => {
    stubFetchRows(['logistics.read'], [
      { ...CROSS_TOWN_ROW, legs: CROSS_TOWN_ROW.legs.map((l) => (l.kind === 'LINE_HAUL' ? { ...l, operator: 'Tropic Overland Ltd' } : l)) },
    ]);
    await mount();

    expect(document.body.textContent).not.toContain('No carrier assigned');
    expect(document.body.textContent).not.toContain('needs assigning by hand');
    expect(document.body.textContent).toContain('Tropic Overland Ltd');
  });
});

/**
 * CLOSE-20 (owner, via MDF-560): UNAVAILABLE ("nobody was ever eligible to
 * ask") is a different claim from EXHAUSTED ("we asked everyone and nobody
 * took it") and must read as such — a leg that can resolve itself the
 * moment a driver comes online must not say "needs assigning by hand", the
 * sentence that is only true of exhaustion.
 */
const UNAVAILABLE_ROW = {
  ...ROW,
  id: 'ship_3',
  reference: 'BML-TEST0003',
  needsDriver: true,
  legs: [
    { id: 'leg_u', sequence: 1, kind: 'FIRST_MILE', mode: 'LAND', status: 'PENDING', courierStatus: null, from: 'Sender', to: 'Belize City Hub', operator: null, needsDriver: true, needsDriverReason: 'UNAVAILABLE' as const },
  ],
};

const EXHAUSTED_ROW = {
  ...ROW,
  id: 'ship_4',
  reference: 'BML-TEST0004',
  needsDriver: true,
  legs: [
    { id: 'leg_e', sequence: 1, kind: 'FIRST_MILE', mode: 'LAND', status: 'PENDING', courierStatus: null, from: 'Sender', to: 'Belize City Hub', operator: null, needsDriver: true, needsDriverReason: 'EXHAUSTED' as const },
  ],
};

describe('LogisticsOpsPage — unavailable vs exhausted drivers read as different claims (CLOSE-20)', () => {
  it('an UNAVAILABLE leg gets its own badge and a "may resolve on its own" message, not the exhaustion wording', async () => {
    stubFetchRows(['logistics.read'], [UNAVAILABLE_ROW]);
    await mount();

    expect(document.body.textContent).toContain('No driver online');
    expect(document.body.textContent).toContain('may resolve on its own');
    expect(document.body.textContent).not.toContain('No driver found');
    expect(document.body.textContent).not.toContain('ran out of drivers');
    expect(document.body.textContent).not.toContain('needs assigning by hand');
  });

  it('an EXHAUSTED leg keeps the original "No driver found" / "ran out of drivers" wording', async () => {
    stubFetchRows(['logistics.read'], [EXHAUSTED_ROW]);
    await mount();

    expect(document.body.textContent).toContain('No driver found');
    expect(document.body.textContent).toContain('ran out of drivers');
    expect(document.body.textContent).not.toContain('No driver online');
    expect(document.body.textContent).not.toContain('may resolve on its own');
  });

  it('falls back to the pre-CLOSE-20 exhaustion wording when needsDriverReason is absent entirely (older deploy)', async () => {
    const legacyRow = { ...ROW, id: 'ship_5', reference: 'BML-TEST0005', needsDriver: true, legs: [{ ...ROW.legs[0], needsDriver: true }] };
    stubFetchRows(['logistics.read'], [legacyRow]);
    await mount();

    expect(document.body.textContent).toContain('No driver found');
    expect(document.body.textContent).toContain('ran out of drivers');
  });
});

describe('LogisticsOpsPage — the LegAssignModal trigger is gated on logistics.operate (BMPL-280)', () => {
  it('a logistics.read-only reader sees no assign/reassign trigger, and the leg still reports its state as text', async () => {
    stubFetch(['logistics.read']);
    await mount();

    const texts = buttonTexts();
    expect(texts.some((t) => t === 'Assign driver' || t === 'Reassign')).toBe(false);
    expect(document.body.querySelectorAll('button[disabled]').length).toBe(0);

    // Read-only report half: the shipment reference, route and leg status
    // are still information, only the trigger is withheld.
    expect(document.body.textContent).toMatch(/SHP-2001/);
    expect(document.body.textContent).toMatch(/Belize City → San Pedro/);
    expect(document.body.textContent).toMatch(/Ready/);
  });

  it('a logistics.operate operator sees the assign trigger', async () => {
    stubFetch(['logistics.operate']);
    await mount();

    expect(buttonTexts()).toContain('Assign driver');
  });
});
