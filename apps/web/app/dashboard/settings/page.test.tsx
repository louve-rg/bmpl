// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from './page';
import type { MeView } from '../../../lib/types';

// Same convention as addresses/page.test.tsx -- no @testing-library/react in this repo.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const apiGet = vi.fn((_path: string) => Promise.resolve(ME));
vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/api')>()),
  api: {
    get: (...args: [string]) => apiGet(...args),
    post: vi.fn(),
    patch: vi.fn(() => Promise.resolve(ME)),
    del: vi.fn(),
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
 * MDF-925: the new account settings surface. Pam's password/session/
 * deletion routes are not merged yet, so this card's own rule applies --
 * no control ships without a server route behind it -- and those three
 * sections must be genuinely absent from the DOM, not present and
 * disabled. Only the profile/contact section, wired to the existing
 * PATCH /me/profile route (via the shared `ContactInfoForm`, whose own
 * field-level behavior is covered by its own test file), renders.
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

  it('does not render password, session, or deletion controls -- their server routes are not merged yet', async () => {
    mount();
    await flush();

    expect(container!.textContent).not.toContain('Change password');
    expect(container!.textContent).not.toContain('Active sessions');
    expect(container!.textContent).not.toContain('Delete account');
    expect(container!.querySelectorAll('button').length).toBe(1); // only ContactInfoForm's "Save changes"
  });

  it('says honestly, in plain text, that the missing sections are coming -- not silently absent', async () => {
    mount();
    await flush();

    expect(container!.textContent).toContain(
      'Password and sign-in security, active session management, and account deletion are coming to this page soon.',
    );
  });

  it('shows a plain error instead of a blank page when /me fails to load', async () => {
    apiGet.mockRejectedValueOnce(new Error('network down'));
    mount();
    await flush();

    expect(container!.textContent).toContain('Unable to load your account.');
    expect(container!.querySelector('[name="firstName"]')).toBeNull();
  });
});
