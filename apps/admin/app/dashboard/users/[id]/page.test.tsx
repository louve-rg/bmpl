// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * MDF-499, ruling R1: the user detail page used to say
 * nothing at all about the person's wallet -- an admin reviewing a fraud
 * report had to leave this screen and search for the same person again on
 * the wallet page just to see their status and balance. This is a SERVER
 * component (async function, `serverGet`/`cookies()`, no client hooks of its
 * own), unlike every other `[id]/page.test.tsx` in this app, so `next/headers`
 * is mocked here and the page is invoked directly as an async function
 * rather than mounted via a router. `ADMIN_PUBLIC_API_URL` must be set before
 * the dynamic import, same reason as `lib/server-api.test.ts` -- the module
 * reads it at import time.
 */
vi.mock('next/headers', () => ({
  cookies: () => ({ toString: () => '' }),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound() called');
  },
  useRouter: () => ({ refresh: () => {} }),
}));

let UserDetailPage: (props: { params: { id: string } }) => Promise<React.ReactElement>;

beforeAll(async () => {
  process.env.ADMIN_PUBLIC_API_URL = 'http://localhost:4000';
  ({ default: UserDetailPage } = await import('./page'));
});

const USER = {
  id: 'user_1',
  email: 'jane@example.bz',
  firstName: 'Jane',
  lastName: 'Doe',
  phone: null,
  district: 'BELIZE',
  status: 'ACTIVE',
  emailVerifiedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  roles: [],
  adminPermissions: [],
};

const WALLET_ACCOUNTS = [{ id: 'wa_1', type: 'USER', status: 'ACTIVE', currency: 'BZD', cachedBalanceMinor: 2500 }];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function stubFetch(opts: { adminPermissions: string[]; walletStatus?: number; walletBody?: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions: opts.adminPermissions });
      if (url.includes('/api/admin/wallet/users/user_1/accounts')) {
        return jsonResponse(opts.walletStatus ?? 200, opts.walletBody ?? WALLET_ACCOUNTS);
      }
      if (url.includes('/api/admin/users/user_1')) return jsonResponse(200, USER);
      return jsonResponse(404, { message: 'not mocked: ' + url });
    }),
  );
}

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  const element = await UserDetailPage({ params: { id: 'user_1' } });
  await act(async () => {
    root!.render(element);
  });
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  document.body.innerHTML = '';
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe('UserDetailPage — wallet visibility, gated on wallet.read (MDF-499)', () => {
  it('shows wallet status, balance and a link to the wallet console when the viewer holds wallet.read', async () => {
    stubFetch({ adminPermissions: ['users.read', 'wallet.read'] });
    await mount();

    expect(container!.textContent).toContain('Wallet');
    expect(container!.textContent).toContain('$25.00');
    const links = Array.from(container!.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toContain('/dashboard/wallet');
  });

  it('shows nothing about the wallet for a viewer without wallet.read -- no section, no failed-fetch text, fail closed', async () => {
    stubFetch({ adminPermissions: ['users.read'] });
    await mount();

    expect(container!.textContent).not.toContain('wallet console');
    expect(container!.textContent).not.toContain('Could not load wallet status');
  });

  it('says a customer has no wallet account yet rather than pretending the section does not exist', async () => {
    stubFetch({ adminPermissions: ['wallet.read'], walletBody: [] });
    await mount();

    expect(container!.textContent).toContain('No wallet account yet');
  });

  it('reports a failed wallet read honestly instead of silently omitting the section', async () => {
    stubFetch({ adminPermissions: ['wallet.read'], walletStatus: 403, walletBody: { message: 'Forbidden.' } });
    await mount();

    expect(container!.textContent).toContain('Could not load wallet status');
  });
});
