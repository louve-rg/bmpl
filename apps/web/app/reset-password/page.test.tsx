// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ResetPasswordPage from './page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A token must be present or the page shows FormError instead of the form —
// see page.tsx's `if (!token)` branch.
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('token=test-token'),
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
  root = null;
  container = null;
});

describe('SEC-LOGIN-PASSWORD-IN-URL', () => {
  it('the form defaults to POST, not GET, before React ever attaches a submit handler', async () => {
    // Same defect and same reasoning as app/login/page.test.tsx: this
    // asserts the static method attribute a pre-hydration click would be
    // governed by, never the hydrated onSubmit path.
    document.body.innerHTML = '<div id="root"></div>';
    container = document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
    await act(async () => {
      root!.render(<ResetPasswordPage />);
    });

    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    expect(form!.method).toBe('post');
    expect(form!.getAttribute('method')?.toLowerCase()).toBe('post');
  });
});
