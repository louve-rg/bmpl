// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContactInfoForm } from './ContactInfoForm';
import type { MeView } from '../../lib/types';

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

const apiPatch = vi.fn((_path: string, _body: unknown) => Promise.resolve({ ...ME }));
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: (...args: [string, unknown]) => apiPatch(...args),
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

function mount(me: MeView = ME, onSaved: (m: MeView) => void = () => {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<ContactInfoForm me={me} onSaved={onSaved} />);
  });
}

function submit() {
  const form = container!.querySelector('form')!;
  act(() => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

function setValue(name: string, value: string) {
  const el = container!.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLSelectElement;
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('ContactInfoForm (MDF-925) -- shared by Profile and Settings', () => {
  it('prefills every field from the person it is given, and shows the email verification state', async () => {
    mount();
    await flush();

    expect((container!.querySelector('[name="firstName"]') as HTMLInputElement).value).toBe('Rae');
    expect((container!.querySelector('[name="lastName"]') as HTMLInputElement).value).toBe('Test');
    expect((container!.querySelector('[name="phone"]') as HTMLInputElement).value).toBe('+501 600 0000');
    expect((container!.querySelector('[name="city"]') as HTMLInputElement).value).toBe('Belize City');
    expect(container!.textContent).toContain('rae@example.com');
    expect(container!.textContent).toContain('Verified');
  });

  it('shows Unverified, not Verified, for an unverified email', async () => {
    mount({ ...ME, emailVerified: false });
    await flush();

    expect(container!.textContent).toContain('Unverified');
    expect(container!.textContent).not.toContain('Verified ');
  });

  it('submits exactly the six profile fields to PATCH /me/profile', async () => {
    mount();
    await flush();
    setValue('firstName', 'Raelene');
    submit();
    await flush();

    expect(apiPatch).toHaveBeenCalledWith('/me/profile', {
      firstName: 'Raelene',
      lastName: 'Test',
      phone: '+501 600 0000',
      district: 'BELIZE',
      addressLine1: '12 Front St',
      city: 'Belize City',
    });
  });

  it('calls onSaved with the updated person and shows a success message', async () => {
    const updated = { ...ME, firstName: 'Raelene' };
    apiPatch.mockResolvedValueOnce(updated);
    let saved: MeView | null = null;
    mount(ME, (m) => {
      saved = m;
    });
    await flush();
    submit();
    await flush();

    expect(saved).toEqual(updated);
    expect(container!.textContent).toContain('Profile saved.');
  });

  it('shows the real refusal reason on a failed save, not a generic message, and does not call onSaved', async () => {
    apiPatch.mockRejectedValueOnce({ message: 'That phone number is not valid.' });
    const onSaved = vi.fn();
    mount(ME, onSaved);
    await flush();
    submit();
    await flush();

    expect(container!.textContent).toContain('That phone number is not valid.');
    expect(onSaved).not.toHaveBeenCalled();
  });
});
