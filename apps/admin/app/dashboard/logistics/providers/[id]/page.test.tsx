// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * MDF-524: the carrier detail page, built against Pam's carrier-lifecycle
 * contract ahead of it landing on origin/main (see the page's own header
 * comment for exactly which endpoint shapes are confirmed real today vs.
 * assumed). These tests characterize what THIS code does against the
 * assumed shapes; they are the first thing to re-run once her real
 * contract message arrives, and are expected to need path/shape updates
 * at that point, not a surprise.
 */

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'prov_1' }),
}));

const { default: CarrierDetailPage } = await import('./page');

const PROVIDER = {
  id: 'prov_1',
  businessName: 'Tropic Air',
  description: 'Regional carrier.',
  contactEmail: 'ops@tropicair.bz',
  contactPhone: '+501-610-0000',
  district: 'BELIZE',
  city: 'Belize City',
  addressLine1: null,
  operatingLicenceNumber: 'LIC-001',
  operatingLicenceExpiry: '2027-01-01T00:00:00.000Z',
  isActive: true,
  status: 'APPROVED' as const,
  statusReason: null,
  statusChangedAt: null,
  isTest: false,
  createdAt: new Date().toISOString(),
  activeMembers: 1,
};

const MEMBERS = [
  { userId: 'u_owner', firstName: 'Jane', lastName: 'Doe', email: 'jane@tropicair.bz', memberRole: 'OWNER' as const, status: 'ACTIVE' as const, startedAt: new Date().toISOString(), endedAt: null },
  { userId: 'u_staff', firstName: 'John', lastName: 'Roe', email: 'john@tropicair.bz', memberRole: 'STAFF' as const, status: 'ACTIVE' as const, startedAt: new Date().toISOString(), endedAt: null },
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type StubOpts = {
  adminPermissions?: string[];
  provider?: unknown;
  membersStatus?: number;
  members?: unknown;
  shipmentRows?: unknown[];
  providersForPicker?: unknown[];
};

function stubFetch(opts: StubOpts = {}) {
  const permissions = opts.adminPermissions ?? ['logistics.manage', 'logistics.operate'];
  const provider = opts.provider ?? PROVIDER;
  const posts: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions: permissions });
      if (url.includes('/api/admin/logistics/providers/prov_1/members') && (!init?.method || init.method === 'GET')) {
        return jsonResponse(opts.membersStatus ?? 200, opts.members ?? MEMBERS);
      }
      if (url.includes('/api/admin/logistics/providers/prov_1/members') && init?.method === 'POST') {
        posts.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
        return jsonResponse(200, {});
      }
      if (url.includes('/api/admin/logistics/providers/prov_1/suspend') && init?.method === 'POST') {
        posts.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
        return jsonResponse(200, { id: 'prov_1', status: 'SUSPENDED' });
      }
      if (url.includes('/api/admin/logistics/providers/prov_1/revoke') && init?.method === 'POST') {
        posts.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
        return jsonResponse(200, { id: 'prov_1', status: 'REVOKED' });
      }
      if (url.includes('/api/admin/logistics/shipments') && (!init?.method || init.method === 'GET')) {
        return jsonResponse(200, { rows: opts.shipmentRows ?? [] });
      }
      if (url.includes('/api/admin/logistics/legs/') && url.includes('/operator') && init?.method === 'POST') {
        posts.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
        return jsonResponse(200, {});
      }
      if (url.includes('/api/admin/logistics/providers') && (!init?.method || init.method === 'GET')) {
        return jsonResponse(200, opts.providersForPicker ?? [provider]);
      }
      return jsonResponse(404, { message: 'not mocked: ' + url });
    }),
  );
  return posts;
}

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<CarrierDetailPage />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function buttonTexts(): string[] {
  return Array.from(document.body.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '');
}

// act()-wrapped, and using the native setter rather than a plain `.value =`
// assignment, so React's controlled-input tracking actually sees the change
// -- same gotcha and same fix as WalletOperations.test.tsx.
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;

function clickButton(text: string) {
  const btn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);
  if (!btn) throw new Error(`no button with text "${text}"`);
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function clickButtonMatching(pattern: RegExp) {
  const btn = Array.from(document.body.querySelectorAll('button')).find((b) => pattern.test(b.textContent ?? ''));
  if (!btn) throw new Error(`no button matching ${pattern}`);
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function setValue(el: HTMLInputElement, value: string) {
  act(() => {
    nativeInputValueSetter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
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

describe('CarrierDetailPage — profile and not-found (MDF-524)', () => {
  it('shows the resolved carrier\'s own profile fields', async () => {
    stubFetch();
    await mount();

    expect(container!.textContent).toContain('Tropic Air');
    expect(container!.textContent).toContain('ops@tropicair.bz');
    expect(container!.textContent).toContain('LIC-001');
  });

  it('shows an honest not-found state for an id no carrier matches, not a crash or a blank page', async () => {
    stubFetch({ providersForPicker: [] });
    await mount();

    expect(container!.textContent).toContain('Carrier not found');
  });
});

describe('CarrierDetailPage — suspend vs. revoke, made legible (MDF-524, D-owner requirement)', () => {
  it('an APPROVED carrier offers both actions to a logistics.manage holder, gated behind a reason', async () => {
    stubFetch();
    await mount();

    expect(buttonTexts()).toContain('Suspend (administrative)');
    expect(buttonTexts()).toContain('Revoke (security / safety)');

    clickButton('Suspend (administrative)');
    await act(async () => {});
    // No reason typed yet -- must refuse, not silently proceed.
    expect(container!.textContent).toContain('Give a reason');
  });

  it('suspend posts the reason to the suspend route and reloads to the new status', async () => {
    const posts = stubFetch();
    await mount();

    const reasonInput = document.getElementById('carrier-status-reason') as HTMLInputElement;
    setValue(reasonInput, 'Licence expired, pending renewal.');
    clickButton('Suspend (administrative)');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const call = posts.find((p) => p.url.includes('/suspend'));
    expect(call?.body).toEqual({ reason: 'Licence expired, pending renewal.' });
  });

  it('a reader with no logistics.manage sees the current status but no action to change it', async () => {
    stubFetch({ adminPermissions: ['logistics.read'] });
    await mount();

    expect(buttonTexts()).not.toContain('Suspend (administrative)');
    expect(buttonTexts()).not.toContain('Revoke (security / safety)');
  });

  it('a revoked carrier reads as urgent and points at the in-flight shipments section, not a reinstate button', async () => {
    stubFetch({ provider: { ...PROVIDER, status: 'REVOKED', statusReason: 'Safety complaint upheld.' } });
    await mount();

    expect(container!.textContent).toContain('REVOKED');
    expect(container!.textContent).toContain('Safety complaint upheld.');
    expect(container!.textContent).toMatch(/needs a new carrier/);
    expect(buttonTexts()).not.toContain('Reinstate');
  });

  it('a suspended carrier reads as a routine, reversible hold, distinct from revoked', async () => {
    stubFetch({ provider: { ...PROVIDER, status: 'SUSPENDED', statusReason: 'Routine licence check.' } });
    await mount();

    expect(container!.textContent).toContain('SUSPENDED');
    expect(container!.textContent).toMatch(/not offered for new work until reinstated/);
    expect(container!.textContent).not.toMatch(/needs a new carrier/);
  });
});

describe('CarrierDetailPage — member roster (MDF-524)', () => {
  it('lists active members with role, and never offers to end the OWNER', async () => {
    stubFetch();
    await mount();

    expect(container!.textContent).toContain('Jane Doe');
    expect(container!.textContent).toContain('John Roe');
    const endButtons = buttonTexts().filter((t) => t === 'End');
    expect(endButtons).toHaveLength(1); // only for the STAFF member, never the OWNER
  });

  it('ending a membership posts to the existing endMember route', async () => {
    const posts = stubFetch();
    await mount();

    clickButton('End');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(posts.some((p) => p.url.includes('/members/u_staff/end'))).toBe(true);
  });

  it('adding a member searches by name/email and posts the resolved id, never a typed one', async () => {
    const posts: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions: ['logistics.manage', 'logistics.operate'] });
        if (url.includes('/api/admin/users?query=')) return jsonResponse(200, { items: [{ id: 'u_new', firstName: 'Ann', lastName: 'Lee', email: 'ann@example.bz' }] });
        if (url.includes('/api/admin/logistics/providers/prov_1/members') && (!init?.method || init.method === 'GET')) return jsonResponse(200, MEMBERS);
        if (url.includes('/api/admin/logistics/providers/prov_1/members') && init?.method === 'POST') {
          posts.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
          return jsonResponse(200, {});
        }
        if (url.includes('/api/admin/logistics/shipments')) return jsonResponse(200, { rows: [] });
        if (url.includes('/api/admin/logistics/providers')) return jsonResponse(200, [PROVIDER]);
        return jsonResponse(404, { message: 'not mocked: ' + url });
      }),
    );
    await mount();

    const search = document.getElementById('carrier-member-search') as HTMLInputElement;
    setValue(search, 'ann');
    clickButton('Search');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container!.textContent).toContain('Ann Lee');

    clickButtonMatching(/Ann Lee/);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const addCall = posts.find((p) => p.url.endsWith('/members') && p.body && (p.body as { userId?: string }).userId === 'u_new');
    expect(addCall).toBeTruthy();
  });

  it('when this environment cannot list members yet (404), it says so plainly instead of showing an empty roster', async () => {
    stubFetch({ membersStatus: 404, members: { message: 'not found' } });
    await mount();

    expect(container!.textContent).toMatch(/cannot list this carrier.s members yet/);
  });
});

describe('CarrierDetailPage — in-flight shipments and reassignment (MDF-524)', () => {
  it('when the server does not yet expose which leg this carrier operates, says so distinctly from "none"', async () => {
    stubFetch({
      shipmentRows: [
        { id: 's1', reference: 'SHP-2001', statusLabel: 'In transit', isTest: false, legs: [{ id: 'leg_1', sequence: 1, kind: 'LINE_HAUL', status: 'IN_PROGRESS', from: 'Belize City', to: 'San Pedro', operator: 'Tropic Air' }] },
      ],
    });
    await mount();

    expect(container!.textContent).toMatch(/cannot yet say which shipments/);
    expect(container!.textContent).not.toMatch(/Nothing currently in flight/);
  });

  it('once the carrier operates no open leg, says so as a genuine zero, not a loading or unsupported state', async () => {
    stubFetch({
      shipmentRows: [
        { id: 's1', reference: 'SHP-2001', statusLabel: 'Completed', isTest: false, legs: [{ id: 'leg_1', sequence: 1, kind: 'LINE_HAUL', status: 'COMPLETED', from: 'Belize City', to: 'San Pedro', operator: 'Tropic Air', operatedByProviderId: 'prov_1' }] },
      ],
    });
    await mount();

    expect(container!.textContent).toContain('Nothing currently in flight');
  });

  it('lists an open leg this carrier operates and reassigning posts to the existing per-leg operator route', async () => {
    const posts = stubFetch({
      shipmentRows: [
        {
          id: 's1',
          reference: 'SHP-2001',
          statusLabel: 'In transit',
          isTest: false,
          legs: [{ id: 'leg_1', sequence: 1, kind: 'LINE_HAUL', status: 'IN_PROGRESS', from: 'Belize City', to: 'San Pedro', operator: 'Tropic Air', operatedByProviderId: 'prov_1' }],
        },
      ],
      providersForPicker: [PROVIDER, { id: 'prov_2', businessName: 'Maya Island Air', isActive: true, isTest: false }],
    });
    await mount();

    expect(container!.textContent).toContain('SHP-2001');
    expect(container!.textContent).toContain('Belize City → San Pedro');

    const select = document.body.querySelector('select') as HTMLSelectElement;
    await act(async () => {
      select.value = 'prov_2';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    clickButton('Reassign');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const call = posts.find((p) => p.url.includes('/legs/leg_1/operator'));
    expect(call?.body).toEqual({ providerProfileId: 'prov_2' });
  });
});
