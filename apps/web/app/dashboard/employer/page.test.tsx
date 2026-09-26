// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import EmployerHomePage from './page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * BMPL-141: a brand-new, just-approved employer has no profile row yet, so
 * GET /employer/profile 404s on their very first visit — the expected
 * first-run state, not a failure. The page used to treat that 404 exactly
 * like a 500: an error alert, with no way to ever create a profile. Exercised
 * against a real (jsdom) DOM tree with a stubbed fetch, because the bug was
 * in how the page's OWN error branch reacted to a response shape, not in any
 * pure function.
 */

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function stubFetch(profileStatus: number, profileBody: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/employer/profile')) return jsonResponse(profileStatus, profileBody);
      if (url.includes('/api/employer/analytics')) return jsonResponse(404, { message: 'Create your company profile first.' });
      return jsonResponse(404, { message: 'not mocked: ' + url });
    }),
  );
}

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<EmployerHomePage />);
  });
  // Let the load() effect's Promise.all + state updates settle.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe('EmployerHomePage — first-run empty state (BMPL-141)', () => {
  it('renders the company-profile FORM, not an error alert, when no profile exists yet (404)', async () => {
    stubFetch(404, { message: 'Create your company profile first.', error: 'Not Found', statusCode: 404 });
    await mount();

    expect(document.body.querySelector('[role="alert"]')?.textContent ?? '').not.toMatch(/create your company profile first/i);
    const companyNameLabel = Array.from(document.querySelectorAll('label')).find((l) => /company name/i.test(l.textContent ?? ''));
    expect(companyNameLabel).toBeTruthy();
  });

  it('still shows an error alert for a genuine failure (500)', async () => {
    stubFetch(500, { message: 'Internal server error' });
    await mount();

    const alertText = document.body.querySelector('[role="alert"]')?.textContent ?? '';
    expect(alertText).toMatch(/internal server error/i);
    const companyNameLabel = Array.from(document.querySelectorAll('label')).find((l) => /company name/i.test(l.textContent ?? ''));
    expect(companyNameLabel).toBeFalsy();
  });
});
