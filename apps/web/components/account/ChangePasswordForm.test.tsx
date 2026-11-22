// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChangePasswordForm } from './ChangePasswordForm';

// Same convention as addresses/page.test.tsx -- no @testing-library/react in this repo.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

const apiPost = vi.fn((_path: string, _body: unknown) => Promise.resolve({ ok: true }));
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api: {
    get: vi.fn(),
    post: (...args: [string, unknown]) => apiPost(...args),
    patch: vi.fn(),
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
    root!.render(<ChangePasswordForm />);
  });
}

function setValue(name: string, value: string) {
  const el = container!.querySelector(`[name="${name}"]`) as HTMLInputElement;
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function submit() {
  const form = container!.querySelector('form')!;
  act(() => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

/**
 * MDF-923 contract: POST /auth/change-password revokes every session,
 * including the caller's own, and clears the web auth cookies. The two
 * things that must never happen are a "saved" message left sitting on this
 * now-dead authenticated page, and a submit that doesn't warn what's about
 * to happen.
 */
describe('ChangePasswordForm (MDF-925/MDF-923)', () => {
  it('warns about being signed out everywhere before any submission happens', async () => {
    mount();
    await flush();

    expect(container!.textContent).toContain('signs you out of every device, including this one');
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('submits currentPassword and newPassword to POST /auth/change-password', async () => {
    mount();
    await flush();
    setValue('currentPassword', 'old-password-1');
    setValue('newPassword', 'new-password-2');
    submit();
    await flush();

    expect(apiPost).toHaveBeenCalledWith('/auth/change-password', {
      currentPassword: 'old-password-1',
      newPassword: 'new-password-2',
    });
  });

  it('on success, navigates to /login with a reason -- never shows a success message on this page', async () => {
    mount();
    await flush();
    setValue('currentPassword', 'old-password-1');
    setValue('newPassword', 'new-password-2');
    submit();
    await flush();

    expect(router.push).toHaveBeenCalledWith('/login?reason=password-changed');
    expect(router.refresh).toHaveBeenCalled();
    expect(container!.textContent).not.toContain('saved');
    expect(container!.textContent).not.toContain('success');
  });

  it('shows the bare current-password refusal (no errors array) by its own message', async () => {
    apiPost.mockRejectedValueOnce({ message: 'Current password is incorrect.' });
    mount();
    await flush();
    submit();
    await flush();

    expect(container!.textContent).toContain('Current password is incorrect.');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('shows the specific field reason for the Zod-shape 400, not the generic "Validation failed" wrapper', async () => {
    apiPost.mockRejectedValueOnce({
      message: 'Validation failed: newPassword — Password must be at least 10 characters.',
      errors: [{ path: 'newPassword', message: 'Password must be at least 10 characters.' }],
    });
    mount();
    await flush();
    submit();
    await flush();

    expect(container!.textContent).toContain('Password must be at least 10 characters.');
    expect(container!.textContent).not.toContain('Validation failed');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('re-enables the button after a failed submit, so the person can try again', async () => {
    apiPost.mockRejectedValueOnce({ message: 'Current password is incorrect.' });
    mount();
    await flush();
    submit();
    await flush();

    const button = container!.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Change password');
  });
});
