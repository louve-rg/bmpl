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
