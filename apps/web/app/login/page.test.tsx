// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LoginPage from './page';

// react-dom's act() checks this flag; see checkout/page.test.tsx for the
// same convention (no @testing-library/react dependency in this repo).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
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

describe('MDF-925/MDF-923 -- the password-changed notice', () => {
  it('shows the confirmation when arriving with ?reason=password-changed', async () => {
    window.history.replaceState(null, '', '/login?reason=password-changed');
    document.body.innerHTML = '<div id="root"></div>';
    container = document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
    await act(async () => {
      root!.render(<LoginPage />);
    });

    expect(container.textContent).toContain('Your password was changed. Please sign in again.');
  });

  it('shows nothing extra for a plain visit, with no ?reason at all', async () => {
    window.history.replaceState(null, '', '/login');
    document.body.innerHTML = '<div id="root"></div>';
    container = document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
    await act(async () => {
      root!.render(<LoginPage />);
    });

    expect(container.textContent).not.toContain('password was changed');
  });

  it('ignores an unrecognized reason rather than rendering it verbatim', async () => {
    window.history.replaceState(null, '', '/login?reason=something-made-up');
    document.body.innerHTML = '<div id="root"></div>';
    container = document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
    await act(async () => {
      root!.render(<LoginPage />);
    });

    expect(container.textContent).not.toContain('something-made-up');
  });

  it('strips ?reason= from the URL after reading it, so a reload does not re-show it', async () => {
    window.history.replaceState(null, '', '/login?reason=password-changed');
    document.body.innerHTML = '<div id="root"></div>';
    container = document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
    await act(async () => {
      root!.render(<LoginPage />);
    });

    expect(window.location.search).toBe('');
    expect(window.location.pathname).toBe('/login');
  });

  it('keeps ?next= when stripping ?reason=, so a failed sign-in retry still returns to the right page', async () => {
    window.history.replaceState(null, '', '/login?reason=password-changed&next=%2Fdashboard%2Fsettings');
    document.body.innerHTML = '<div id="root"></div>';
    container = document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
    await act(async () => {
      root!.render(<LoginPage />);
    });

    expect(new URLSearchParams(window.location.search).get('reason')).toBeNull();
    expect(new URLSearchParams(window.location.search).get('next')).toBe('/dashboard/settings');
  });
});

describe('SEC-LOGIN-PASSWORD-IN-URL', () => {
  it('the form defaults to POST, not GET, before React ever attaches a submit handler', async () => {
    // The defect: before hydration completes, a click on "Sign in" has no
    // onSubmit listener yet, so the browser falls back to the <form>'s own
    // method attribute. This test renders the component and inspects that
    // attribute directly — it never dispatches a submit event or invokes
    // onSubmit at all, because doing so would only prove the HYDRATED path,
    // which was never broken. jsdom also cannot perform a real form
    // navigation to observe GET vs POST on the wire, so the method
    // attribute (what the browser's native submission algorithm actually
    // reads) is the right and only thing to assert here. Fails on the
    // unfixed page: a bare <form onSubmit={...}> has no method attribute,
    // so form.method reflects the HTML default, "get".
    document.body.innerHTML = '<div id="root"></div>';
    container = document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
    await act(async () => {
      root!.render(<LoginPage />);
    });

    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    expect(form!.method).toBe('post');
    expect(form!.getAttribute('method')?.toLowerCase()).toBe('post');
  });
});
