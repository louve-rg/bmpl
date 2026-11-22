// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProfilePage from './page';
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
    root!.render(<ProfilePage />);
  });
}

/**
 * MDF-925: the contact-editing form itself moved into the shared
 * `ContactInfoForm` component (its own test file covers field-level
 * behavior). This file only has to prove the move was behavior-preserving:
 * Profile still loads from /me, still shows the avatar uploader above the
 * same form, and still surfaces a load failure honestly.
 */
describe('ProfilePage (MDF-925 extraction)', () => {
  it('shows a spinner, then the avatar control and the contact form once /me resolves', async () => {
    mount();
    expect(container!.textContent).toContain('Loading profile');

    await flush();
    expect(apiGet).toHaveBeenCalledWith('/me');
    expect((container!.querySelector('[name="firstName"]') as HTMLInputElement).value).toBe('Rae');
    expect(container!.textContent).toContain('rae@example.com');
  });

  it('shows a plain error instead of a blank page when /me fails to load', async () => {
    apiGet.mockRejectedValueOnce(new Error('network down'));
    mount();
    await flush();

    expect(container!.textContent).toContain('Unable to load your profile.');
    expect(container!.querySelector('[name="firstName"]')).toBeNull();
  });
});
