// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const apiGet = vi.fn();
vi.mock('../../../../lib/api', () => ({
  api: { get: (...args: unknown[]) => apiGet(...args) },
}));

const { default: DriverEarningsPage } = await import('./page');

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
    root!.render(<DriverEarningsPage />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

function earningsResponse(overrides: Record<string, unknown> = {}) {
  return {
    totals: { pendingMinor: 0, postedMinor: 0, completedDeliveries: 0 },
    earnings: [],
    ...overrides,
  };
}

/**
 * The earnings endpoint's @Roles('DELIVERY_DRIVER') guard chain can refuse
 * for three structurally different reasons (apps/api/src/auth/guards.ts's
 * JwtAuthGuard and RolesGuard, and SettlementService.driverEarnings's own
 * "No driver profile." case, which fires even for an approved role), and the
 * server already tells them apart by message text. The page used to
 * collapse all three into one hardcoded sentence that is simply false for
 * the approved-role-no-profile case. These tests prove it now shows the
 * server's own reason instead — the same convention
 * ServiceAreasSection.test.tsx already established for a 404.
 */
describe('a 403 shows the server own reason, not one hardcoded sentence', () => {
  it('an unapproved/absent role shows the real guard message', async () => {
    apiGet.mockRejectedValue({ status: 403, message: 'You do not have an approved role for this action.' });
    await mount();
    expect(container!.textContent).toContain('You do not have an approved role for this action.');
  });

  it('a suspended account shows the real guard message, not the role sentence', async () => {
    apiGet.mockRejectedValue({ status: 403, message: 'Account is suspended or deactivated.' });
    await mount();
    expect(container!.textContent).toContain('Account is suspended or deactivated.');
    expect(container!.textContent).not.toContain('only available to approved delivery-driver accounts');
  });

  it('an approved role with no driver profile shows the real reason, not a false "not approved" message', async () => {
    apiGet.mockRejectedValue({ status: 403, message: 'No driver profile.' });
    await mount();
    expect(container!.textContent).toContain('No driver profile.');
    expect(container!.textContent).not.toContain('only available to approved delivery-driver accounts');
  });

  it('a non-403 failure still renders as a plain error, not the driver-access branch', async () => {
    apiGet.mockRejectedValue({ status: 500, message: 'Something went wrong.' });
    await mount();
    expect(container!.textContent).toContain('Something went wrong.');
  });
});

describe('the success path renders real figures from the API, nothing hardcoded', () => {
  it('shows the real (zero) totals and the empty state when there are no earnings yet', async () => {
    apiGet.mockResolvedValue(earningsResponse());
    await mount();
    expect(container!.textContent).toContain('No earnings yet');
    expect(container!.textContent).toContain('$0.00');
  });

  it('shows real totals and a real earnings row', async () => {
    apiGet.mockResolvedValue(
      earningsResponse({
        totals: { pendingMinor: 500, postedMinor: 8800, completedDeliveries: 2 },
        earnings: [
          {
            id: 'e1',
            orderDeliveryId: 'd1',
            vendorOrderId: 'vo-12345678',
            currency: 'BZD',
            method: 'FLAT',
            grossMinor: 1000,
            adjustmentsMinor: 0,
            netMinor: 880,
            status: 'POSTED',
            calculatedAt: '2026-10-01T00:00:00.000Z',
            postedAt: '2026-10-02T00:00:00.000Z',
          },
        ],
      }),
    );
    await mount();
    expect(container!.textContent).toContain('$5.00'); // pending total
    expect(container!.textContent).toContain('$88.00'); // posted total
    expect(container!.textContent).toContain('2'); // completed deliveries
    expect(container!.textContent).toContain('#vo-12345'); // real order id, sliced
    expect(container!.textContent).toContain('$8.80'); // the row's own net
  });
});
