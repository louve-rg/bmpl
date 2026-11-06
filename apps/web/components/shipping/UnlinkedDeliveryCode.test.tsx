// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnlinkedDeliveryCode } from './UnlinkedDeliveryCode';

// react-dom's act() checks this flag; see StorefrontView.test.tsx / LocationPicker.test.tsx
// for the same convention (no @testing-library/react dependency in this repo).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const requestDeliveryCodeEmail = vi.fn();
const revealDeliveryCode = vi.fn();
vi.mock('../../lib/shipping', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/shipping')>();
  return {
    ...actual,
    shippingApi: {
      ...actual.shippingApi,
      requestDeliveryCodeEmail: (...args: unknown[]) => requestDeliveryCodeEmail(...args),
      revealDeliveryCode: (...args: unknown[]) => revealDeliveryCode(...args),
    },
  };
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  requestDeliveryCodeEmail.mockReset();
  revealDeliveryCode.mockReset();
});

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<UnlinkedDeliveryCode token="TOK123TOK1" />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

function findButton(el: HTMLElement, text: string) {
  return Array.from(el.querySelectorAll('button')).find((b) => b.textContent === text) ?? null;
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

/**
 * CLOSE-2, unlinked-recipient path. The owner's prohibition is the thing
 * every test here is actually guarding: the request step must say the exact
 * same thing whether or not an email was on file, whether or not the
 * cooldown is active — never a "no email on file" message, never anything
 * that lets a stranger holding a tracking link learn who is reachable.
 */
describe('UnlinkedDeliveryCode — request step never leaks whether an email exists', () => {
  it('shows the same neutral message after a successful request', async () => {
    requestDeliveryCodeEmail.mockResolvedValue({ requested: true });
    const el = await mount();

    await clickAndFlush(findButton(el, 'Email me a delivery code')!);

    expect(el.textContent).toContain(
      "If an email is on file for this parcel, we’ve sent a short code to it.",
    );
    expect(el.textContent).not.toMatch(/no email|not on file|does not have an email/i);
  });

  it('never reveals anything different when the request fails outright (e.g. rate limited)', async () => {
    requestDeliveryCodeEmail.mockRejectedValue({ status: 429, message: 'Too many requests. Try again shortly.' });
    const el = await mount();

    await clickAndFlush(findButton(el, 'Email me a delivery code')!);

    expect(el.textContent).toContain('Too many requests. Try again shortly.');
    expect(el.textContent).not.toMatch(/no email|not on file/i);
  });

  it('shows a readable cooldown instead of just letting the button look dead', async () => {
    requestDeliveryCodeEmail.mockResolvedValue({ requested: true });
    const el = await mount();
    await clickAndFlush(findButton(el, 'Email me a delivery code')!);

    const resendBtn = Array.from(el.querySelectorAll('button')).find((b) => /You can request another code in/.test(b.textContent ?? ''));
    expect(resendBtn).toBeTruthy();
    expect(resendBtn!.hasAttribute('disabled')).toBe(true);
  });
});

describe('UnlinkedDeliveryCode — reveal step', () => {
  async function requestThenMount() {
    requestDeliveryCodeEmail.mockResolvedValue({ requested: true });
    const el = await mount();
    await clickAndFlush(findButton(el, 'Email me a delivery code')!);
    return el;
  }

  it('shows the delivery code on a successful reveal', async () => {
    const el = await requestThenMount();
    const input = el.querySelector('input') as HTMLInputElement;
    setInputValue(input, '7k3p9rqaxm');

    revealDeliveryCode.mockResolvedValue({ reference: 'BML-ABCD2345', deliveryCode: '9931' });
    await clickAndFlush(findButton(el, 'Confirm code')!);

    expect(revealDeliveryCode).toHaveBeenCalledWith('TOK123TOK1', '7K3P9RQAXM');
    expect(el.textContent).toContain('9931');
  });

  it('renders a null delivery code as "nothing to show", never as a failure', async () => {
    const el = await requestThenMount();
    const input = el.querySelector('input') as HTMLInputElement;
    setInputValue(input, 'ABCDEFGHJK');

    revealDeliveryCode.mockResolvedValue({ reference: 'BML-ABCD2345', deliveryCode: null });
    await clickAndFlush(findButton(el, 'Confirm code')!);

    expect(el.textContent).toContain('No delivery code to show for this parcel right now.');
  });

  it('shows the server’s own message on an invalid or expired code, and lets them try again', async () => {
    const el = await requestThenMount();
    const input = el.querySelector('input') as HTMLInputElement;
    setInputValue(input, 'WRONGCODE1');

    revealDeliveryCode.mockRejectedValue({ status: 400, message: 'That code is invalid or has expired. Request a new one.' });
    await clickAndFlush(findButton(el, 'Confirm code')!);

    expect(el.textContent).toContain('That code is invalid or has expired. Request a new one.');
    // Still on the entry screen, not stuck — the reveal input is still there to retry.
    expect(el.querySelector('input')).toBeTruthy();
  });
});
