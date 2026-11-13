// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import ForgotPasswordPage from './page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
    // This form only carries an email, not a password, but the same
    // pre-hydration GET would still put the email in the URL/history/
    // Referer/logs — same defect shape, same fix, same proof: assert the
    // static method attribute, never the hydrated onSubmit path.
    document.body.innerHTML = '<div id="root"></div>';
    container = document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
    await act(async () => {
      root!.render(<ForgotPasswordPage />);
    });

    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    expect(form!.method).toBe('post');
    expect(form!.getAttribute('method')?.toLowerCase()).toBe('post');
  });
});
