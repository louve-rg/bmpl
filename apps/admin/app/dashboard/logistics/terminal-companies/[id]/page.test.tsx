// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * TERM-4, closed out by TERM-6-UI. Contract read from
 * apps/api/src/terminal/{terminal.controller.ts,terminal.service.ts} on
 * origin/main plus Pam's TERM-6 PR #629 diff (bb112650) -- see the page's
 * own header comment for the exact citations. Covers: profile (now
 * editable), the absent/broken-locations distinction, the
 * no-implicit-whole-company-grant messaging (a member with zero
 * currently-active locations reads as having no access regardless of
 * role), cross-referencing a member's location grants against the
 * company's own isActive flag rather than trusting a cached list,
 * invite/revoke, end-membership, direct reactivate, and per-member
 * location grant/revoke (still no in-place role change -- that's the one
 * gap TERM-6 left, and the page still says so).
 */

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'tc_1' }),
}));

const { default: TerminalCompanyDetailPage } = await import('./page');

const BASE_COMPANY = {
  id: 'tc_1',
  businessName: 'Belize Terminal Services',
  contactEmail: 'ops@bts.bz',
  contactPhone: '+501-610-0000',
  isActive: true,
  isTest: false,
  createdAt: new Date().toISOString(),
  locations: [] as unknown[],
  members: [] as unknown[],
  pendingInvites: [] as unknown[],
};

const ACTIVE_LOCATION = { id: 'loc_1', isActive: true, hub: { id: 'hub_1', code: 'BZE', name: 'Belize City Hub', city: 'Belize City' } };
const DEACTIVATED_LOCATION = { id: 'loc_2', isActive: false, hub: { id: 'hub_2', code: 'COR', name: 'Corozal Hub', city: 'Corozal' } };

const HUB_1 = { id: 'hub_1', code: 'BZE', name: 'Belize City Hub', district: 'BELIZE', city: 'Belize City', isActive: true, isTest: false };
const HUB_3 = { id: 'hub_3', code: 'SPR', name: 'San Pedro Hub', district: 'BELIZE', city: 'San Pedro', isActive: true, isTest: false };

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type StubOpts = {
  adminPermissions?: string[];
  companyStatus?: number;
  company?: unknown;
  hubs?: unknown[];
};

function stubFetch(opts: StubOpts = {}) {
  const permissions = opts.adminPermissions ?? ['terminals.manage', 'terminals.read'];
  const company = opts.company ?? BASE_COMPANY;
  const posts: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions: permissions });
      if (url.includes('/api/admin/logistics/hubs')) return jsonResponse(200, opts.hubs ?? [HUB_1, HUB_3]);
      if (url.includes('/api/admin/terminal/companies/tc_1') && method === 'PATCH') {
        posts.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
        return jsonResponse(200, { ...(company as object), ...(init?.body ? JSON.parse(String(init.body)) : {}) });
      }
      if (url.includes('/api/admin/terminal/companies/tc_1') && method === 'GET' && !url.includes('/locations') && !url.includes('/members') && !url.includes('/invites')) {
        return jsonResponse(opts.companyStatus ?? 200, opts.companyStatus && opts.companyStatus !== 200 ? company : company);
      }
      // TERM-6 member-location and reactivate endpoints both contain
      // "/members", so they're matched BEFORE the generic end-membership
      // DELETE check below, not instead of it.
      if (url.includes('/members') && url.includes('/reactivate') && method === 'POST') {
        posts.push({ url, method, body: null });
        return jsonResponse(200, {});
      }
      if (url.includes('/members') && url.includes('/locations') && (method === 'POST' || method === 'DELETE')) {
        posts.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
        return jsonResponse(200, {});
      }
      if (url.includes('/api/admin/terminal/companies/tc_1/locations') && (method === 'POST' || method === 'DELETE')) {
        posts.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
        return jsonResponse(200, {});
      }
      if (url.includes('/api/admin/terminal/companies/tc_1/invites') && method === 'POST') {
        posts.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
        return jsonResponse(200, {});
      }
      if (url.includes('/api/admin/terminal/companies/tc_1/members') && method === 'DELETE') {
        posts.push({ url, method, body: null });
        return jsonResponse(200, {});
      }
      return jsonResponse(404, { message: 'not mocked: ' + url });
    }),
  );
  return posts;
}

const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;

function setValue(el: HTMLInputElement, value: string) {
  nativeInputValueSetter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<TerminalCompanyDetailPage />);
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

describe('TerminalCompanyDetailPage (TERM-4)', () => {
  it('renders the company profile with an edit control', async () => {
    stubFetch({ company: BASE_COMPANY });
    await mount();

    expect(container!.textContent).toContain('Belize Terminal Services');
    expect(container!.textContent).toContain('ops@bts.bz');
    expect(Array.from(container!.querySelectorAll('button')).some((b) => b.textContent === 'Edit')).toBe(true);
  });

  it("edits a company's profile, sending only the editable fields -- never isTest", async () => {
    const posts = stubFetch({ company: BASE_COMPANY });
    await mount();

    const editButton = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Edit')!;
    await act(async () => {
      editButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const nameInput = container!.querySelector<HTMLInputElement>('#tc-edit-name')!;
    await act(async () => {
      setValue(nameInput, 'Belize Terminal Services Ltd');
    });
    const saveButton = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Save')!;
    await act(async () => {
      saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    const patchCall = posts.find((p) => p.method === 'PATCH' && p.url.includes('/companies/tc_1'));
    expect(patchCall?.body).toEqual({ businessName: 'Belize Terminal Services Ltd', contactEmail: 'ops@bts.bz', contactPhone: '+501-610-0000' });
    expect(patchCall?.body).not.toHaveProperty('isTest');
  });

  it('shows "no locations yet" (absent), not the all-deactivated warning, when the company has never had one', async () => {
    stubFetch({ company: { ...BASE_COMPANY, locations: [] } });
    await mount();

    expect(container!.textContent).toContain('No locations yet');
    expect(container!.textContent).not.toContain('has been deactivated');
  });

  it('shows the all-deactivated warning (broken), not the absent empty state, when locations exist but none are active', async () => {
    stubFetch({ company: { ...BASE_COMPANY, locations: [DEACTIVATED_LOCATION] } });
    await mount();

    expect(container!.textContent).toContain('has been deactivated');
    expect(container!.textContent).not.toContain('No locations yet');
  });

  it('lists an active location distinctly from a deactivated one', async () => {
    stubFetch({ company: { ...BASE_COMPANY, locations: [ACTIVE_LOCATION, DEACTIVATED_LOCATION] } });
    await mount();

    expect(container!.textContent).toContain('Belize City Hub');
    expect(container!.textContent).toContain('Corozal Hub');
  });

  it('surfaces the real permission message on a 403, not a "not found" state', async () => {
    stubFetch({ companyStatus: 403, company: { message: 'You need the "terminals.read" permission.' } });
    await mount();

    expect(container!.textContent).toContain('terminals.read');
    expect(container!.textContent).not.toContain('not found');
  });

  it('shows a genuine 404 as "not found"', async () => {
    stubFetch({ companyStatus: 404, company: { message: 'Terminal company not found.' } });
    await mount();

    expect(container!.textContent).toContain('not found');
  });

  it('a MANAGER with zero currently-active location grants reads as having no access, not as fully privileged', async () => {
    stubFetch({
      company: {
        ...BASE_COMPANY,
        locations: [ACTIVE_LOCATION],
        members: [
          { id: 'm1', userId: 'u1', name: 'Jane Doe', email: 'jane@bts.bz', memberRole: 'MANAGER', status: 'ACTIVE', createdAt: new Date().toISOString(), endedAt: null, locations: [] },
        ],
      },
    });
    await mount();

    expect(container!.textContent).toContain('MANAGER');
    expect(container!.textContent).toContain('No active locations — this member currently has no access, regardless of role.');
  });

  it("a member's grant on a since-deactivated location does not read as current access", async () => {
    stubFetch({
      company: {
        ...BASE_COMPANY,
        locations: [ACTIVE_LOCATION, DEACTIVATED_LOCATION],
        members: [
          {
            id: 'm1',
            userId: 'u1',
            name: 'Jane Doe',
            email: 'jane@bts.bz',
            memberRole: 'OPERATOR',
            status: 'ACTIVE',
            createdAt: new Date().toISOString(),
            endedAt: null,
            // Granted ONLY the now-deactivated location.
            locations: [{ id: DEACTIVATED_LOCATION.id, hub: DEACTIVATED_LOCATION.hub }],
          },
        ],
      },
    });
    await mount();

    expect(container!.textContent).toContain('No active locations — this member currently has no access, regardless of role.');
    expect(container!.textContent).toContain('1 granted location since deactivated');
  });

  it("tells the admin to end-and-reinvite an ACTIVE member only for a ROLE change -- locations have their own control now", async () => {
    stubFetch({
      company: {
        ...BASE_COMPANY,
        locations: [ACTIVE_LOCATION],
        members: [
          { id: 'm1', userId: 'u1', name: 'Jane Doe', email: 'jane@bts.bz', memberRole: 'OPERATOR', status: 'ACTIVE', createdAt: new Date().toISOString(), endedAt: null, locations: [ACTIVE_LOCATION] },
        ],
      },
    });
    await mount();

    expect(container!.textContent).toContain("To change Jane Doe's role, end this membership and send a new invite.");
    expect(container!.textContent).not.toContain("locations or role");
    // Scoped to the member's own row -- the page's unrelated company-level
    // "Edit" button (ProfileCard) also matches /edit/i and must not count.
    const memberRow = Array.from(container!.querySelectorAll('li')).find((li) => li.textContent?.includes('Jane Doe'))!;
    expect(Array.from(memberRow.querySelectorAll('button')).some((b) => /edit/i.test(b.textContent ?? ''))).toBe(false);
  });

  it('shows an ended member with a working Reactivate button, no stale "no direct reactivate" note', async () => {
    stubFetch({
      company: {
        ...BASE_COMPANY,
        locations: [ACTIVE_LOCATION],
        members: [
          { id: 'm1', userId: 'u1', name: 'Jane Doe', email: 'jane@bts.bz', memberRole: 'OPERATOR', status: 'ENDED', createdAt: new Date().toISOString(), endedAt: new Date().toISOString(), locations: [] },
        ],
      },
    });
    await mount();

    expect(container!.textContent).toContain('ENDED');
    expect(container!.textContent).not.toContain('no direct reactivate action yet');
    expect(Array.from(container!.querySelectorAll('button')).some((b) => b.textContent === 'Reactivate')).toBe(true);
  });

  it('reactivates an ended member', async () => {
    const posts = stubFetch({
      company: {
        ...BASE_COMPANY,
        locations: [ACTIVE_LOCATION],
        members: [
          { id: 'm1', userId: 'u1', name: 'Jane Doe', email: 'jane@bts.bz', memberRole: 'OPERATOR', status: 'ENDED', createdAt: new Date().toISOString(), endedAt: new Date().toISOString(), locations: [] },
        ],
      },
    });
    await mount();

    const reactivateButton = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Reactivate')!;
    await act(async () => {
      reactivateButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(posts.some((p) => p.method === 'POST' && p.url.includes('/members/u1/reactivate'))).toBe(true);
  });

  it('grants an ACTIVE member a second location without ending their membership', async () => {
    const hubBLocation = { id: 'loc_3', isActive: true, hub: { id: 'hub_3', code: 'SPR', name: 'San Pedro Hub', city: 'San Pedro' } };
    const posts = stubFetch({
      company: {
        ...BASE_COMPANY,
        locations: [ACTIVE_LOCATION, hubBLocation],
        members: [
          { id: 'm1', userId: 'u1', name: 'Jane Doe', email: 'jane@bts.bz', memberRole: 'OPERATOR', status: 'ACTIVE', createdAt: new Date().toISOString(), endedAt: null, locations: [ACTIVE_LOCATION] },
        ],
      },
    });
    await mount();

    const grantSelect = container!.querySelector<HTMLSelectElement>('select[aria-label="Grant Jane Doe a location"]')!;
    await act(async () => {
      grantSelect.value = hubBLocation.id;
      grantSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const grantButton = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Grant')!;
    await act(async () => {
      grantButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    const grantCall = posts.find((p) => p.method === 'POST' && p.url.includes('/members/u1/locations'));
    expect(grantCall?.body).toEqual({ locationId: hubBLocation.id });
  });

  it("revokes one of an ACTIVE member's locations without ending their membership", async () => {
    const hubBLocation = { id: 'loc_3', isActive: true, hub: { id: 'hub_3', code: 'SPR', name: 'San Pedro Hub', city: 'San Pedro' } };
    const posts = stubFetch({
      company: {
        ...BASE_COMPANY,
        locations: [ACTIVE_LOCATION, hubBLocation],
        members: [
          { id: 'm1', userId: 'u1', name: 'Jane Doe', email: 'jane@bts.bz', memberRole: 'OPERATOR', status: 'ACTIVE', createdAt: new Date().toISOString(), endedAt: null, locations: [ACTIVE_LOCATION, hubBLocation] },
        ],
      },
    });
    await mount();

    const revokeButton = container!.querySelector<HTMLButtonElement>(`button[aria-label="Revoke ${ACTIVE_LOCATION.hub.name} from Jane Doe"]`)!;
    await act(async () => {
      revokeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(posts.some((p) => p.method === 'DELETE' && p.url.includes(`/members/u1/locations/${ACTIVE_LOCATION.id}`))).toBe(true);
  });

  it('offers no grant control for an ACTIVE member already holding every active location', async () => {
    stubFetch({
      company: {
        ...BASE_COMPANY,
        locations: [ACTIVE_LOCATION],
        members: [
          { id: 'm1', userId: 'u1', name: 'Jane Doe', email: 'jane@bts.bz', memberRole: 'OPERATOR', status: 'ACTIVE', createdAt: new Date().toISOString(), endedAt: null, locations: [ACTIVE_LOCATION] },
        ],
      },
    });
    await mount();

    expect(container!.querySelector('select[aria-label="Grant Jane Doe a location"]')).toBeNull();
  });

  it('ends an active membership', async () => {
    const posts = stubFetch({
      company: {
        ...BASE_COMPANY,
        locations: [ACTIVE_LOCATION],
        members: [
          { id: 'm1', userId: 'u1', name: 'Jane Doe', email: 'jane@bts.bz', memberRole: 'OPERATOR', status: 'ACTIVE', createdAt: new Date().toISOString(), endedAt: null, locations: [ACTIVE_LOCATION] },
        ],
      },
    });
    await mount();

    const endButton = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'End membership')!;
    await act(async () => {
      endButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(posts.some((p) => p.method === 'DELETE' && p.url.includes('/members/u1'))).toBe(true);
  });

  it('lists pending invites and revokes one', async () => {
    const posts = stubFetch({
      company: {
        ...BASE_COMPANY,
        pendingInvites: [{ id: 'inv_1', email: 'new@bts.bz', memberRole: 'OPERATOR', expiresAt: new Date().toISOString(), createdAt: new Date().toISOString(), locationCount: 1 }],
      },
    });
    await mount();

    expect(container!.textContent).toContain('new@bts.bz');
    const revokeButton = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Revoke')!;
    await act(async () => {
      revokeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(posts.some((p) => p.method === 'POST' && p.url.includes('/invites/inv_1/revoke'))).toBe(true);
  });

  it('refuses to send an invite with no location selected', async () => {
    const posts = stubFetch({ company: { ...BASE_COMPANY, locations: [ACTIVE_LOCATION] } });
    await mount();

    const emailInput = container!.querySelector<HTMLInputElement>('#tc-invite-email')!;
    await act(async () => {
      setValue(emailInput, 'new@bts.bz');
    });
    const sendButton = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Send invite')!;
    await act(async () => {
      sendButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(container!.textContent).toContain('there is no whole-company grant');
    expect(posts.some((p) => p.url.includes('/invites') && p.method === 'POST')).toBe(false);
  });

  it('sends an invite with email, role and at least one location', async () => {
    const posts = stubFetch({ company: { ...BASE_COMPANY, locations: [ACTIVE_LOCATION] } });
    await mount();

    const emailInput = container!.querySelector<HTMLInputElement>('#tc-invite-email')!;
    await act(async () => {
      setValue(emailInput, 'new@bts.bz');
    });
    const roleSelect = container!.querySelector<HTMLSelectElement>('#tc-invite-role')!;
    await act(async () => {
      roleSelect.value = 'MANAGER';
      roleSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const locationCheckbox = container!.querySelector<HTMLInputElement>('#tc-invite-locations input[type="checkbox"]')!;
    await act(async () => {
      locationCheckbox.click();
    });
    const sendButton = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Send invite')!;
    await act(async () => {
      sendButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    const invitePost = posts.find((p) => p.url.includes('/invites') && p.method === 'POST');
    expect(invitePost?.body).toMatchObject({ email: 'new@bts.bz', memberRole: 'MANAGER', locationIds: [ACTIVE_LOCATION.id] });
  });

  it('attaches a hub as a new location', async () => {
    const posts = stubFetch({ company: { ...BASE_COMPANY, locations: [] } });
    await mount();

    const hubSelect = container!.querySelector<HTMLSelectElement>('#tc-add-hub')!;
    await act(async () => {
      hubSelect.value = 'hub_1';
      hubSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const attachButton = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Attach')!;
    await act(async () => {
      attachButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    const addPost = posts.find((p) => p.url.includes('/locations') && p.method === 'POST');
    expect(addPost?.body).toMatchObject({ hubId: 'hub_1' });
  });

  it('removes an active location', async () => {
    const posts = stubFetch({ company: { ...BASE_COMPANY, locations: [ACTIVE_LOCATION] } });
    await mount();

    const removeButton = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Remove')!;
    await act(async () => {
      removeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(posts.some((p) => p.method === 'DELETE' && p.url.includes(`/locations/${ACTIVE_LOCATION.id}`))).toBe(true);
  });

  it('hides every write control from an admin without terminals.manage', async () => {
    stubFetch({
      adminPermissions: ['terminals.read'],
      company: {
        ...BASE_COMPANY,
        locations: [ACTIVE_LOCATION],
        members: [
          { id: 'm1', userId: 'u1', name: 'Jane Doe', email: 'jane@bts.bz', memberRole: 'OPERATOR', status: 'ENDED', createdAt: new Date().toISOString(), endedAt: new Date().toISOString(), locations: [] },
        ],
        pendingInvites: [{ id: 'inv_1', email: 'new@bts.bz', memberRole: 'OPERATOR', expiresAt: new Date().toISOString(), createdAt: new Date().toISOString(), locationCount: 1 }],
      },
    });
    await mount();

    expect(container!.textContent).not.toContain('Attach');
    expect(container!.textContent).not.toContain('Send invite');
    const buttonText = Array.from(container!.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttonText).not.toContain('Revoke');
    expect(buttonText).not.toContain('Edit');
    expect(buttonText).not.toContain('Reactivate');
    expect(buttonText).not.toContain('Grant');
  });
});
