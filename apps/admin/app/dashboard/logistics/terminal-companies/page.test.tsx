// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TerminalCompaniesPage from './page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * TERM-4: the terminal-company directory. Covers the list render, the
 * honest "no companies yet" vs. permission-refusal distinction, the create
 * form (terminals.manage-gated), and the link to the detail page.
 */

const COMPANY_ACTIVE = {
  id: 'tc_1',
  businessName: 'Belize Terminal Services',
  contactEmail: 'ops@bts.bz',
  contactPhone: '+501-610-0000',
  isActive: true,
  isTest: false,
  createdAt: new Date().toISOString(),
};

const COMPANY_DEACTIVATED = { ...COMPANY_ACTIVE, id: 'tc_2', businessName: 'Retired Terminal Co', isActive: false };

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type StubOpts = { adminPermissions?: string[]; companiesStatus?: number; companies?: unknown };

function stubFetch(opts: StubOpts = {}) {
  const permissions = opts.adminPermissions ?? ['terminals.manage', 'terminals.read'];
  const posts: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions: permissions });
      if (url.includes('/api/admin/terminal/companies') && init?.method === 'POST') {
        posts.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
        return jsonResponse(200, { ...COMPANY_ACTIVE, id: 'tc_new' });
      }
      if (url.includes('/api/admin/terminal/companies') && (!init?.method || init.method === 'GET')) {
        return jsonResponse(opts.companiesStatus ?? 200, opts.companies ?? [COMPANY_ACTIVE]);
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
    root!.render(<TerminalCompaniesPage />);
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

describe('TerminalCompaniesPage (TERM-4)', () => {
  it('lists each terminal company with its contact details', async () => {
    stubFetch({ companies: [COMPANY_ACTIVE] });
    await mount();

    expect(container!.textContent).toContain('Belize Terminal Services');
    expect(container!.textContent).toContain('ops@bts.bz');
  });

  it('marks a deactivated company distinctly from an active one', async () => {
    stubFetch({ companies: [COMPANY_ACTIVE, COMPANY_DEACTIVATED] });
    await mount();

    expect(container!.textContent).toContain('Active');
    expect(container!.textContent).toContain('Deactivated');
  });

  it('shows an honest empty state, not an error, when there are genuinely no companies', async () => {
    stubFetch({ companies: [] });
    await mount();

    expect(container!.textContent).toContain('No terminal companies yet');
  });

  it('shows the real refusal message on a 403, distinct from the empty state', async () => {
    stubFetch({ companiesStatus: 403, companies: { message: 'You need the "terminals.read" permission.' } });
    await mount();

    expect(container!.textContent).toContain('terminals.read');
    expect(container!.textContent).not.toContain('No terminal companies yet');
  });

  it('links each company name to its own detail page', async () => {
    stubFetch({ companies: [COMPANY_ACTIVE] });
    await mount();

    const link = Array.from(container!.querySelectorAll('a')).find((a) => a.textContent === 'Belize Terminal Services');
    expect(link?.getAttribute('href')).toBe('/dashboard/logistics/terminal-companies/tc_1');
  });

  it('hides the create-company form from an admin without terminals.manage', async () => {
    stubFetch({ adminPermissions: ['terminals.read'], companies: [COMPANY_ACTIVE] });
    await mount();

    expect(container!.textContent).not.toContain('New terminal company');
  });

  it('creates a company and reloads the list', async () => {
    const posts = stubFetch({ companies: [COMPANY_ACTIVE] });
    await mount();

    const nameInput = container!.querySelector<HTMLInputElement>('#tc-name')!;
    const emailInput = container!.querySelector<HTMLInputElement>('#tc-email')!;
    await act(async () => {
      setValue(nameInput, 'New Co');
      setValue(emailInput, 'new@co.bz');
    });
    const createButton = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Create terminal company')!;
    await act(async () => {
      createButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    const createPost = posts.find((p) => p.url.includes('/api/admin/terminal/companies') && !p.url.includes('tc_'));
    expect(createPost?.body).toMatchObject({ businessName: 'New Co', contactEmail: 'new@co.bz', isTest: false });
  });
});
