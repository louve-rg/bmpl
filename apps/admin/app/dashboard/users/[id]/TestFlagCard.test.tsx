// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestFlagCard } from './TestFlagCard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * TERM-SIM-DESIGNATE: POST /admin/users/test-flag (admin.controller.ts,
 * users.suspend, audited) has existed with no caller anywhere in apps/admin
 * or apps/web -- only API tests, seeds and e2e drove it. Stanley's
 * contrast: the admin test-CREDIT screen (WalletOperations.tsx) is complete
 * -- named person, cap shown, confirmation before fields unlock, a real
 * success message naming the outcome -- and the test-FLAG screen had none
 * of that, not even a screen. This is built to that same standard.
 */

const apiPost = vi.fn();
vi.mock('../../../../lib/api', () => ({
  api: { post: (...args: unknown[]) => apiPost(...args) },
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  apiPost.mockReset();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
});

async function mount(props: Partial<React.ComponentProps<typeof TestFlagCard>> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <TestFlagCard
        userId="user_1"
        firstName="Jane"
        lastName="Doe"
        isTest={false}
        canSet={true}
        {...props}
      />,
    );
  });
  return container;
}

function findButton(el: HTMLElement, text: string) {
  return Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) ?? null;
}

async function clickAndFlush(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
function setInputValue(input: HTMLInputElement, value: string) {
  act(() => {
    nativeInputValueSetter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('TestFlagCard (TERM-SIM-DESIGNATE)', () => {
  it('renders nothing for a viewer without users.suspend -- fail closed, same as every other control on this page', async () => {
    const c = await mount({ canSet: false });
    expect(c.textContent).toBe('');
  });

  it('shows the current state honestly before any action -- an admin who cannot see it would flip it blind', async () => {
    const real = await mount({ isTest: false });
    expect(real.textContent).toMatch(/not a simulation account|real account/i);

    const sim = await mount({ isTest: true });
    expect(sim.textContent).toMatch(/simulation account/i);
  });

  it('requires a reason before the control can be confirmed', async () => {
    const c = await mount({ isTest: false });
    const button = findButton(c, 'Mark as simulation account')!;
    expect(button.hasAttribute('disabled')).toBe(true);

    const input = c.querySelector('textarea, input[type="text"]') as HTMLInputElement;
    setInputValue(input, 'ab');
    expect(button.hasAttribute('disabled')).toBe(true); // below the 4-char server minimum

    setInputValue(input, 'Edward onboarding test');
    expect(button.hasAttribute('disabled')).toBe(false);
  });

  it('marks a real account as a simulation account and shows a real success message naming the outcome', async () => {
    apiPost.mockResolvedValue({ userId: 'user_1', email: 'jane@example.com', isTest: true, changed: true });
    const c = await mount({ isTest: false });

    const input = c.querySelector('textarea, input[type="text"]') as HTMLInputElement;
    setInputValue(input, 'Edward onboarding test');
    await clickAndFlush(findButton(c, 'Mark as simulation account')!);

    expect(apiPost).toHaveBeenCalledWith('/admin/users/test-flag', {
      userId: 'user_1',
      isTest: true,
      reason: 'Edward onboarding test',
    });
    expect(c.textContent).toContain('Jane Doe');
    expect(c.textContent).toMatch(/now a simulation account/i);
  });

  it('clears a simulation designation and shows the reverse outcome, never the same message as marking it', async () => {
    apiPost.mockResolvedValue({ userId: 'user_1', email: 'jane@example.com', isTest: false, changed: true });
    const c = await mount({ isTest: true });

    const input = c.querySelector('textarea, input[type="text"]') as HTMLInputElement;
    setInputValue(input, 'No longer needed for testing');
    await clickAndFlush(findButton(c, 'Remove simulation designation')!);

    expect(apiPost).toHaveBeenCalledWith('/admin/users/test-flag', {
      userId: 'user_1',
      isTest: false,
      reason: 'No longer needed for testing',
    });
    expect(c.textContent).toContain('Jane Doe');
    expect(c.textContent).toMatch(/no longer a simulation account/i);
    expect(c.textContent).not.toMatch(/now a simulation account/i);
  });

  it('surfaces the server refusal verbatim -- e.g. open passenger bookings -- rather than a generic failure message', async () => {
    apiPost.mockRejectedValue({ status: 400, message: 'This person has 2 open passenger booking(s). Cancel or complete them before changing test mode.' });
    const c = await mount({ isTest: false });

    const input = c.querySelector('textarea, input[type="text"]') as HTMLInputElement;
    setInputValue(input, 'Edward onboarding test');
    await clickAndFlush(findButton(c, 'Mark as simulation account')!);

    expect(c.textContent).toContain('This person has 2 open passenger booking(s)');
    // Never claims the flip happened when the server refused it.
    expect(c.textContent).not.toMatch(/now a simulation account/i);
  });
});
