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
  vi.restoreAllMocks();
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

/** Clicks the trigger ("Delete account") -- opens the inline panel, calls no API. */
function openPanel() {
  const form = container!.querySelector('form')!;
  act(() => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

function panelHeading() {
  return container!.querySelector('[role="group"] h3') as HTMLHeadingElement | null;
}

function confirmButton() {
  return Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Yes, delete my account') ?? null;
}

function cancelButton() {
  return Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Cancel') ?? null;
}

/** Opens the panel, then clicks "Yes, delete my account" -- the only path that actually calls DELETE /me. */
function openAndConfirm() {
  openPanel();
  act(() => confirmButton()!.click());
}

/**
 * MDF-925/MDF-924: DELETE /me. The things this file exists to pin: (1) the
 * consequence copy never says "account deleted" (the controller's own copy
 * rule -- this is anonymization, past order records are kept), (2) a 409
 * refusal renders the server's own `reasons[]` verbatim, never a collapsed
 * "something went wrong" and never a client-side guess at why, and (3) the
 * inline confirmation panel (acceptance round 2) gates every path to the
 * API, is genuinely absent until opened, and a cancel loses nothing.
 */
describe('DeleteAccountForm (MDF-925/MDF-924)', () => {
  it('states the anonymization consequence up front, never claiming full deletion', async () => {
    mount();
    await flush();

    expect(container!.textContent).toContain('anonymizes your profile');
    expect(container!.textContent).toContain('does not erase your history');
    expect(container!.textContent).not.toContain('permanently delete your account');
  });

  // Acceptance round 1: the paragraph must name every real side effect
  // deleteAccount/anonymizePersonalData actually perform, each sourced to a
  // line in those methods -- not a guess, and not silently omitted.
  it('names the real side effects sourced to deleteAccount/anonymizePersonalData -- storefront, driver status, documents, messages', async () => {
    mount();
    await flush();

    expect(container!.textContent).toContain('a live storefront is suspended');
    expect(container!.textContent).toContain('a driver or passenger-driver profile goes offline');
    expect(container!.textContent).toContain('any identity documents or CVs you uploaded are removed from your account');
    expect(container!.textContent).toContain('messages you’ve already sent stay visible to the people you sent them to');
  });

  it('submits only currentPassword to DELETE /me', async () => {
    mount();
    await flush();
    setPassword('my-real-password');
    openAndConfirm();
    await flush();

    expect(apiDel).toHaveBeenCalledWith('/me', { currentPassword: 'my-real-password' });
  });

  it('disables the trigger until a password is entered, without pre-checking anything server-side', async () => {
    mount();
    await flush();

    const button = container!.querySelector('#deleteAccountTrigger') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    setPassword('x');
    expect(button.disabled).toBe(false);
  });

  it('on success, navigates to /login with the anonymization reason -- never shows a success message here', async () => {
    mount();
    await flush();
    setPassword('my-real-password');
    openAndConfirm();
    await flush();

    expect(router.push).toHaveBeenCalledWith('/login?reason=account-anonymized');
    expect(router.refresh).toHaveBeenCalled();
    // The forbidden phrase specifically, not the bare word -- the wallet
    // refusal copy and other sourced side-effect sentences may legitimately
    // use "delete"/"deleted" without that being a claim about the account.
    expect(container!.textContent).not.toContain('account deleted');
    expect(container!.textContent).not.toContain('Account deleted');
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
    openAndConfirm();
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
    openAndConfirm();
    await flush();

    expect(container!.textContent).not.toMatch(/withdraw/i);
  });

  it('shows specific copy for a 429 (StrictThrottle), not the raw throttler text', async () => {
    apiDel.mockRejectedValueOnce({ status: 429, message: 'ThrottlerException: Too Many Requests' });
    mount();
    await flush();
    setPassword('my-real-password');
    openAndConfirm();
    await flush();

    expect(container!.textContent).toContain("You've tried this too many times. Wait a few minutes, then try again.");
    expect(container!.textContent).not.toContain('ThrottlerException');
  });

  it('shows the bare current-password refusal by its own message', async () => {
    apiDel.mockRejectedValueOnce({ status: 400, message: 'Current password is incorrect.' });
    mount();
    await flush();
    setPassword('wrong-password');
    openAndConfirm();
    await flush();

    expect(container!.textContent).toContain('Current password is incorrect.');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('re-enables the trigger after a failed submit, so the person can try again -- the panel closes back to the trigger, not a dead state', async () => {
    apiDel.mockRejectedValueOnce({ status: 400, message: 'Current password is incorrect.' });
    mount();
    await flush();
    setPassword('wrong-password');
    openAndConfirm();
    await flush();

    const button = container!.querySelector('#deleteAccountTrigger') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Delete account');
    expect(confirmButton()).toBeNull();
  });
});

/**
 * Acceptance round 2 (REQUIRED): irreversible actions get an in-page
 * confirmation step, not `window.confirm` -- a browser that has suppressed
 * dialogs makes `window.confirm` return `false` exactly like a decline,
 * silently turning the button nonfunctional with no way to tell the two
 * apart from inside the page. This panel removes the need for that
 * detection: there is no browser setting that can suppress a React state
 * update.
 */
describe('DeleteAccountForm — the inline confirmation panel (acceptance round 2, REQUIRED)', () => {
  it('the destructive button does not exist in the DOM until the panel is opened -- not hidden, not disabled, absent', async () => {
    mount();
    await flush();
    setPassword('my-real-password');

    expect(confirmButton()).toBeNull();

    openPanel();
    await flush();

    expect(confirmButton()).not.toBeNull();
    expect(apiDel).not.toHaveBeenCalled();
  });

  it('opening the panel moves focus to it -- a keyboard user is told something changed', async () => {
    mount();
    await flush();
    setPassword('my-real-password');
    openPanel();
    await flush();

    expect(document.activeElement).toBe(panelHeading());
  });

  it('the panel carries the exact fact acceptance flagged as missing -- past orders/shipments keep the real recipient name and address', async () => {
    mount();
    await flush();
    setPassword('my-real-password');
    openPanel();
    await flush();

    expect(container!.textContent).toContain('Anonymize your profile and sign out of every device?');
    expect(container!.textContent).toContain('Past orders and shipments keep their recipient name and address.');
  });

  it('declining (Cancel) does nothing and loses nothing -- no API call, no navigation, the password is preserved, focus returns to the trigger', async () => {
    mount();
    await flush();
    setPassword('my-real-password');
    openPanel();
    await flush();

    act(() => cancelButton()!.click());
    await flush();

    expect(apiDel).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(confirmButton()).toBeNull();
    expect((container!.querySelector('#deleteAccountPassword') as HTMLInputElement).value).toBe('my-real-password');
    expect(document.activeElement).toBe(container!.querySelector('#deleteAccountTrigger'));
  });

  it('Escape cancels exactly like clicking Cancel', async () => {
    mount();
    await flush();
    setPassword('my-real-password');
    openPanel();
    await flush();

    act(() => {
      panelHeading()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await flush();

    expect(apiDel).not.toHaveBeenCalled();
    expect(confirmButton()).toBeNull();
    expect((container!.querySelector('#deleteAccountPassword') as HTMLInputElement).value).toBe('my-real-password');
    expect(document.activeElement).toBe(container!.querySelector('#deleteAccountTrigger'));
  });
});
