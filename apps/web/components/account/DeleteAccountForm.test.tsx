// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeleteAccountForm } from './DeleteAccountForm';

// Same convention as ChangePasswordForm.test.tsx -- no @testing-library/react in this repo.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

const apiDel = vi.fn((..._args: [string, unknown?]) => Promise.resolve({ ok: true }));
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
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
    root!.render(<DeleteAccountForm />);
  });
}

// This field is controlled (value + onChange, so the submit button's
// disabled state can read it) -- a plain `el.value = x` would get captured
// by React's own value-tracker before the dispatched event is handled, so
// no change is detected. Going through the native prototype setter first
// (the usual RTL/jsdom workaround for controlled inputs) avoids that.
function setPassword(value: string) {
  const el = container!.querySelector('#deleteAccountPassword') as HTMLInputElement;
  const nativeValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    nativeValueSetter.call(el, value);
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
 * MDF-925/MDF-924: DELETE /me. The two things this file exists to pin:
 * (1) the consequence copy never says "account deleted" (the controller's
 * own copy rule -- this is anonymization, past order records are kept),
 * and (2) a 409 refusal renders the server's own `reasons[]` verbatim,
 * never a collapsed "something went wrong" and never a client-side guess
 * at why.
 */
describe('DeleteAccountForm (MDF-925/MDF-924)', () => {
  it('states the anonymization consequence up front, never claiming full deletion', async () => {
    mount();
    await flush();

    expect(container!.textContent).toContain('anonymizes your profile');
    expect(container!.textContent).toContain('does not erase your history');
    expect(container!.textContent).not.toContain('permanently delete your account');
  });

  it('submits only currentPassword to DELETE /me', async () => {
    mount();
    await flush();
    setPassword('my-real-password');
    submit();
    await flush();

    expect(apiDel).toHaveBeenCalledWith('/me', { currentPassword: 'my-real-password' });
  });

  it('disables submit until a password is entered, without pre-checking anything server-side', async () => {
    mount();
    await flush();

    const button = container!.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    setPassword('x');
    expect(button.disabled).toBe(false);
  });

  it('on success, navigates to /login with the anonymization reason -- never shows a success message here', async () => {
    mount();
    await flush();
    setPassword('my-real-password');
    submit();
    await flush();

    expect(router.push).toHaveBeenCalledWith('/login?reason=account-anonymized');
    expect(router.refresh).toHaveBeenCalled();
    expect(container!.textContent).not.toContain('deleted');
  });

  it('renders the server\'s own refusal reasons verbatim on a 409, not a generic message', async () => {
    apiDel.mockRejectedValueOnce({
      status: 409,
      message: 'Your account cannot be deleted yet.',
      reasons: [
        'Your wallet still holds funds, a hold, or an escrow balance, and this account cannot be deleted while it does. This product has no way to remove funds from a wallet today.',
        'You have 2 orders still being fulfilled or delivered. Wait for them to finish before deleting your account.',
      ],
    });
    mount();
    await flush();
    setPassword('my-real-password');
    submit();
    await flush();

    expect(container!.textContent).toContain('Your wallet still holds funds, a hold, or an escrow balance');
    expect(container!.textContent).toContain('You have 2 orders still being fulfilled or delivered.');
    expect(container!.textContent).not.toContain('something went wrong');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('does not invent a withdraw-first instruction the product cannot fulfill', async () => {
    apiDel.mockRejectedValueOnce({
      status: 409,
      message: 'Your account cannot be deleted yet.',
      reasons: [
        'Your wallet still holds funds, a hold, or an escrow balance, and this account cannot be deleted while it does. This product has no way to remove funds from a wallet today.',
      ],
    });
    mount();
    await flush();
    setPassword('my-real-password');
    submit();
    await flush();

    expect(container!.textContent).not.toMatch(/withdraw/i);
  });

  it('shows specific copy for a 429 (StrictThrottle), not the raw throttler text', async () => {
    apiDel.mockRejectedValueOnce({ status: 429, message: 'ThrottlerException: Too Many Requests' });
    mount();
    await flush();
    setPassword('my-real-password');
    submit();
    await flush();

    expect(container!.textContent).toContain("You've tried this too many times. Wait a few minutes, then try again.");
    expect(container!.textContent).not.toContain('ThrottlerException');
  });

  it('shows the bare current-password refusal by its own message', async () => {
    apiDel.mockRejectedValueOnce({ status: 400, message: 'Current password is incorrect.' });
    mount();
    await flush();
    setPassword('wrong-password');
    submit();
    await flush();

    expect(container!.textContent).toContain('Current password is incorrect.');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('re-enables the button after a failed submit, so the person can try again', async () => {
    apiDel.mockRejectedValueOnce({ status: 400, message: 'Current password is incorrect.' });
    mount();
    await flush();
    setPassword('wrong-password');
    submit();
    await flush();

    const button = container!.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Delete account');
  });
});
