// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminSettlementsPage from './page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * BMPL-274/276 shape, and the one god named as the highest-consequence
 * screen (BMPL-269): a settlements.read-only reader must still see the
 * commission and driver-payout rates as information, and must never see an
 * edit form or a Retry control for them. A test that only checked the edit
 * form was gone would pass on a screen that showed a reader NOTHING, which
 * is a different defect (BMPL-269's own "Read-only access" banner regression)
 * with the same green light — so this asserts the rates render for BOTH
 * personas, not just for the manager.
 */

const RECONCILIATION = {
  escrowBalanceMinor: 100000,
  platformRevenueMinor: 5000,
  pendingVendorLiabilityMinor: 20000,
  pendingDriverLiabilityMinor: 8000,
  globalLedgerNetMinor: 0,
  balanced: true,
  failedSettlements: 0,
};
const FEE_CONFIG = {
  id: 'fee_1',
  currency: 'BZD',
  commissionBps: 1250,
  driverEarningMethod: 'PERCENT_DELIVERY_FEE' as const,
  driverFlatMinor: 0,
  driverDeliveryFeeBps: 8000,
  defaults: { commissionBps: 1000, driverDeliveryFeeBps: 8000 },
};
const EXCEPTION = { id: 'exc_1', vendorOrderId: 'vo_1', orderNumber: 'ORD-1001', failureReason: 'Insufficient escrow', updatedAt: new Date().toISOString() };

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
      if (url.includes('/api/admin/settlements/reconciliation')) return jsonResponse(200, RECONCILIATION);
      if (url.includes('/api/admin/settlements/accounts')) return jsonResponse(200, []);
      if (url.includes('/api/admin/settlements/fee-config')) return jsonResponse(200, FEE_CONFIG);
      if (url.includes('/api/admin/settlements/exceptions')) return jsonResponse(200, [EXCEPTION]);
      if (/\/api\/admin\/settlements(\?|$)/.test(url)) return jsonResponse(200, []);
      return jsonResponse(404, { message: 'not mocked: ' + url });
    }),
  );
}

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<AdminSettlementsPage />);
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

describe('AdminSettlementsPage — write affordances gated on settlements.manage (BMPL-274)', () => {
  it('a settlements.read-only reader sees no write affordance anywhere, and the rates still render', async () => {
    stubFetch(['settlements.read']);
    await mount();

    const texts = buttonTexts();
    expect(texts).not.toContain('Edit rates');
    expect(texts).not.toContain('Retry');
    expect(document.body.querySelectorAll('button[disabled]').length).toBe(0);

    // The report half — the whole reason this screen was singled out: the
    // commission and driver-payout rates MUST still be visible as
    // information to a reader, not just hidden along with the edit form.
    expect(document.body.textContent).toMatch(/12\.50%/); // commission
    expect(document.body.textContent).toMatch(/80\.00%/); // driver delivery share
    expect(document.body.textContent).toMatch(/% of delivery fee/); // driver earning method label

    // No leftover "Read-only access" apology banner (BMPL-269 removed it —
    // report not form means the numbers are just there, not apologized for).
    expect(document.body.textContent).not.toMatch(/Read-only access/i);
  });

  it('a settlements.manage operator sees every write affordance', async () => {
    stubFetch(['settlements.manage']);
    await mount();

    const texts = buttonTexts();
    expect(texts).toContain('Edit rates');
    expect(texts).toContain('Retry');
  });
});
