// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OpsPage from './page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * W8: GET /admin/ops/email had no admin presentation at all — an administrator
 * could not see whether production email actually works without calling the
 * API by hand. This covers the DiagnosticsSection added to the existing
 * Operations console page (no new page), with the one non-obvious
 * requirement: `canDeliver: false` must read as a clear warning, not a
 * neutral field, because the console transport accepts and discards every
 * message while reporting success to its own caller.
 */

const OVERVIEW = {
  queues: {
    pendingVendorApplications: 0,
    pendingProductModeration: 0,
    pendingDriverVehicles: 0,
    pendingRoleApplications: 0,
    moreInfoRoleApplications: 0,
    openReviewReports: 0,
    openSupportCases: 0,
    failedSettlements: 0,
    deliveriesPendingAssignment: 0,
    awaitingPickupCollection: 0,
    suspendedUsers: 0,
    suspendedRoles: 0,
  },
  totalActionable: 0,
  settings: {
    id: 'settings_1',
    localCourierFeeMinor: 0,
    localCourierFeeTestMinor: 0,
    announcementActive: false,
    announcementLevel: 'INFO',
    announcementMessage: null,
    maintenanceMode: false,
    maintenanceMessage: null,
    updatedById: null,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  },
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function stubFetch(email: unknown, adminPermissions: string[] = ['ops.read']) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/admin/ops/overview')) return jsonResponse(200, OVERVIEW);
      if (url.includes('/api/admin/ops/email')) {
        if (email === 'forbidden') return jsonResponse(403, { message: 'forbidden' });
        return jsonResponse(200, email);
      }
      if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions });
      // MDF-560: DriverCoverage also mounts on this page and queries this
      // endpoint once per district. Answered with one driver everywhere so
      // it renders no alert of its own — this file is about the email
      // diagnostics alert, which the tests below locate by being the only
      // [role="alert"] on the page.
      if (url.includes('/api/admin/drivers')) return jsonResponse(200, [{ id: 'drv_1' }]);
      return jsonResponse(404, { message: 'not mocked: ' + url });
    }),
  );
}

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<OpsPage />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe('Operations console — email transport diagnostics (W8)', () => {
  it('canDeliver: false on the console provider reads as a clear warning, not a neutral field', async () => {
    stubFetch({ provider: 'console', credentialPresent: true, canDeliver: false });
    await mount();

    expect(document.body.textContent).toMatch(/Email is NOT being delivered/);
    expect(document.body.textContent).toMatch(/silently discarded/);
    const warningAlert = document.querySelector('[role="alert"]');
    expect(warningAlert?.className).toMatch(/amber/);
  });

  it('canDeliver: true renders as success, not merely the absence of a warning', async () => {
    stubFetch({ provider: 'resend', credentialPresent: true, canDeliver: true });
    await mount();

    expect(document.body.textContent).toMatch(/Email can be delivered/);
    const alerts = Array.from(document.querySelectorAll('[role="alert"]'));
    const successAlert = alerts.find((a) => /Email can be delivered/.test(a.textContent ?? ''));
    expect(successAlert?.className).toMatch(/emerald/);
  });

  it('a missing credential is shown as Missing, distinct from a broken but present credential', async () => {
    stubFetch({ provider: 'resend', credentialPresent: false, canDeliver: false });
    await mount();

    expect(document.body.textContent).toMatch(/Missing/);
    expect(document.body.textContent).toMatch(/required credential is missing/);
  });

  it('never renders a credential value, prefix or length — presence only', async () => {
    stubFetch({ provider: 'resend', credentialPresent: true, canDeliver: true });
    await mount();

    expect(document.body.innerHTML).not.toMatch(/re_[a-zA-Z0-9]/);
    expect(document.body.textContent).not.toMatch(/RESEND_API_KEY/);
  });

  it('a reader without ops.read on just the email endpoint sees a restricted message, not a crash', async () => {
    stubFetch('forbidden');
    await mount();

    expect(document.body.textContent).toMatch(/ops\.read/);
  });
});
