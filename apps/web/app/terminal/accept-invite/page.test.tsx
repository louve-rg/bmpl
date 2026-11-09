// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * TERM-9. Contract read from apps/api/src/terminal/terminal.service.ts
 * (acceptInvite) and packages/validation/src/terminal.ts
 * (acceptTerminalInviteSchema) -- see the page's own header comment.
 */

let searchParamsToken: string | null = 'inv-token-1';
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (key: string) => (key === 'token' ? searchParamsToken : null) }),
}));

const postMock = vi.fn();
vi.mock('../../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api')>();
  return { ...actual, api: { ...actual.api, post: (...args: unknown[]) => postMock(...args) } };
});

const { default: AcceptInvitePage } = await import('./page');

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<AcceptInvitePage />);
  });
}

function fillAndSubmit() {
  (container!.querySelector('input[name="firstName"]') as HTMLInputElement).value = 'Ana';
  (container!.querySelector('input[name="lastName"]') as HTMLInputElement).value = 'Cruz';
  (container!.querySelector('input[name="password"]') as HTMLInputElement).value = 'correct-horse-battery';
  const submit = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Accept invite')!;
  return act(async () => {
    submit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
  root = null;
  container = null;
  postMock.mockReset();
  searchParamsToken = 'inv-token-1';
});

describe('AcceptInvitePage (TERM-9)', () => {
  it('refuses with no API call and a way forward when the link has no token at all', async () => {
    searchParamsToken = null;
    await mount();

    expect(postMock).not.toHaveBeenCalled();
    expect(container!.textContent).toContain('This invite link is missing its token.');
    expect(container!.querySelector('a[href="/login"]')).not.toBeNull();
  });

  it('submits exactly {token, password, firstName, lastName} and reports account creation on success', async () => {
    postMock.mockResolvedValue({ accepted: true, createdAccount: true });
    await mount();
    await fillAndSubmit();

    expect(postMock).toHaveBeenCalledWith('/terminal/invites/accept', {
      token: 'inv-token-1',
      password: 'correct-horse-battery',
      firstName: 'Ana',
      lastName: 'Cruz',
    });
    expect(container!.textContent).toContain('Your account has been created');
    expect(container!.querySelector('a[href="/login"]')).not.toBeNull();
  });

  it('reports joining an existing account differently from creating a new one', async () => {
    postMock.mockResolvedValue({ accepted: true, createdAccount: false });
    await mount();
    await fillAndSubmit();

    expect(container!.textContent).toContain('Sign in with your existing password');
    expect(container!.textContent).not.toContain('Your account has been created');
  });

  it('shows the server refusal for an invalid or expired token and never strands the invitee on a dead screen', async () => {
    postMock.mockRejectedValue({ status: 400, message: 'This invite link is invalid or has expired.' });
    await mount();
    await fillAndSubmit();

    expect(container!.textContent).toContain('This invite link is invalid or has expired.');
    expect(container!.querySelector('a[href="/login"]')).not.toBeNull();
  });
});
