// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from './page';
import type { MeView } from '../../../lib/types';

// Same convention as addresses/page.test.tsx -- no @testing-library/react in this repo.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const ME: MeView = {
  id: 'user_1',
  email: 'rae@example.com',
  firstName: 'Rae',
  lastName: 'Test',
  phone: '+501 600 0000',
  district: 'BELIZE',
  addressLine1: '12 Front St',
  addressLine2: null,
  city: 'Belize City',
  avatarUrl: null,
  avatarStatus: 'NONE',
  avatarPendingUrl: null,
  avatarRejectedReason: null,
  avatarRequired: false,
  status: 'ACTIVE',
  emailVerified: true,
  activeRole: null,
  roles: [],
};

const apiGet = vi.fn((path: string) => {
  if (path === '/me/sessions') return Promise.resolve({ sessions: [] });
  return Promise.resolve(ME);
});
const apiDel = vi.fn((..._args: [string, unknown?]) => Promise.resolve({ ok: true }));
vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/api')>()),
  api: {
    get: (...args: [string]) => apiGet(...args),
    post: vi.fn(),
    patch: vi.fn(() => Promise.resolve(ME)),
    del: (...args: [string, unknown?]) => apiDel(...args),
  },
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<SettingsPage />);
  });
}

/**
 * MDF-925: the account settings surface. Profile/contact (PATCH
 * /me/profile), password security (Pam's MDF-923 contract, POST
 * /auth/change-password), session management (ACCT-SESSIONS #811) and
 * account deletion (DELETE /me, MDF-924/#808) are all live now -- the
 * field-level behavior of each lives in its own component's test file
 * (`ContactInfoForm.test.tsx`, `ChangePasswordForm.test.tsx`,
 * `SessionsList.test.tsx`, `DeleteAccountForm.test.tsx`); this file only has
 * to prove every section is actually mounted on this page. No "coming soon"
 * section remains -- all four routes this page needed are merged.
 */
describe('SettingsPage (MDF-925)', () => {
  it('loads the signed-in person from /me and shows the profile/contact section', async () => {
    mount();
    expect(container!.textContent).toContain('Loading your account');

    await flush();
    expect(apiGet).toHaveBeenCalledWith('/me');
    expect(container!.textContent).toContain('Profile & contact information');
    expect((container!.querySelector('[name="firstName"]') as HTMLInputElement).value).toBe('Rae');
  });

  it('shows the password & security section, wired to the real change-password route', async () => {
    mount();
    await flush();

    expect(container!.textContent).toContain('Password & security');
    expect(container!.textContent).toContain('signs you out of every device');
    expect(container!.querySelector('[name="currentPassword"]')).not.toBeNull();
    expect(container!.querySelector('[name="newPassword"]')).not.toBeNull();
  });

  it('never renders an external-identity-provider branch -- Pam confirmed that account type does not exist yet', async () => {
    mount();
    await flush();

    expect(container!.textContent).not.toMatch(/sign in with (google|facebook|apple)/i);
    expect(container!.textContent).not.toContain('single sign-on');
    expect(container!.textContent).not.toContain('SSO');
  });

  it('renders the active sessions section, wired to GET /me/sessions', async () => {
    mount();
    await flush();

    expect(container!.textContent).toContain('Active sessions');
    expect(apiGet).toHaveBeenCalledWith('/me/sessions');
  });

  it('renders the delete-account section now that DELETE /me has a route behind it', async () => {
    mount();
    await flush();

    expect(container!.textContent).toContain('Delete account');
    expect(container!.querySelector('#deleteAccountPassword')).not.toBeNull();
    // ContactInfoForm's "Save changes" + ChangePasswordForm's "Change password" + DeleteAccountForm's "Delete account".
    expect(container!.querySelectorAll('button[type="submit"]').length).toBe(3);
  });

  it('shows a plain error instead of a blank page when /me fails to load', async () => {
    apiGet.mockRejectedValueOnce(new Error('network down'));
    mount();
    await flush();

    expect(container!.textContent).toContain('Unable to load your account.');
    expect(container!.querySelector('[name="firstName"]')).toBeNull();
  });
});
