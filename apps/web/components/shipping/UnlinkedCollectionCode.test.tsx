// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnlinkedCollectionCode } from './UnlinkedCollectionCode';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const requestCollectionCodeEmail = vi.fn();
const revealCollectionCode = vi.fn();
vi.mock('../../lib/shipping', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/shipping')>();
  return {
    ...actual,
    shippingApi: {
      ...actual.shippingApi,
      requestCollectionCodeEmail: (...args: unknown[]) => requestCollectionCodeEmail(...args),
      revealCollectionCode: (...args: unknown[]) => revealCollectionCode(...args),
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
  requestCollectionCodeEmail.mockReset();
  revealCollectionCode.mockReset();
});

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<UnlinkedCollectionCode token="TOK123TOK1" />);
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
 * MDF-710. Same anti-oracle rule as UnlinkedDeliveryCode's own tests: the
 * request step must say the exact same thing whether or not an email was on
 * file, and this must never be the place a terminal clerk's "that's wrong"
 * confusion comes from -- the token is explicitly never the real code.
 */
describe('UnlinkedCollectionCode — request step never leaks whether an email exists', () => {
  it('shows the same neutral message after a successful request', async () => {
    requestCollectionCodeEmail.mockResolvedValue({ requested: true });
    const el = await mount();

    await clickAndFlush(findButton(el, 'Email me a collection code')!);

    expect(el.textContent).toContain("If an email is on file for this parcel, we’ve sent a short token to it.");
    expect(el.textContent).not.toMatch(/no email|not on file|does not have an email/i);
  });

  it('never reveals anything different when the request fails outright (e.g. rate limited)', async () => {
    requestCollectionCodeEmail.mockRejectedValue({ status: 429, message: 'Too many requests. Try again shortly.' });
    const el = await mount();

    await clickAndFlush(findButton(el, 'Email me a collection code')!);

    expect(el.textContent).toContain('Too many requests. Try again shortly.');
    expect(el.textContent).not.toMatch(/no email|not on file/i);
  });

  it('shows a readable cooldown instead of just letting the button look dead', async () => {
    requestCollectionCodeEmail.mockResolvedValue({ requested: true });
    const el = await mount();
    await clickAndFlush(findButton(el, 'Email me a collection code')!);

    const resendBtn = Array.from(el.querySelectorAll('button')).find((b) => /You can request another token in/.test(b.textContent ?? ''));
    expect(resendBtn).toBeTruthy();
    expect(resendBtn!.hasAttribute('disabled')).toBe(true);
  });

  it('warns that the emailed token is not the real code and must never be given to a terminal clerk', async () => {
    requestCollectionCodeEmail.mockResolvedValue({ requested: true });
    const el = await mount();

    await clickAndFlush(findButton(el, 'Email me a collection code')!);

    expect(el.textContent).toMatch(/not your collection code|never give it to a terminal clerk/i);
  });
});

describe('UnlinkedCollectionCode — reveal step', () => {
  async function requestThenMount() {
    requestCollectionCodeEmail.mockResolvedValue({ requested: true });
    const el = await mount();
    await clickAndFlush(findButton(el, 'Email me a collection code')!);
    return el;
  }

  it('shows the collection code on a successful reveal', async () => {
    const el = await requestThenMount();
    const input = el.querySelector('input') as HTMLInputElement;
    setInputValue(input, '7k3p9rqaxm');

    revealCollectionCode.mockResolvedValue({ reference: 'BML-ABCD2345', collectionCode: '9931' });
    await clickAndFlush(findButton(el, 'Confirm token')!);

    expect(revealCollectionCode).toHaveBeenCalledWith('TOK123TOK1', '7K3P9RQAXM');
    expect(el.textContent).toContain('9931');
  });

  it('renders a null collection code as "nothing to show", never as a failure', async () => {
    const el = await requestThenMount();
    const input = el.querySelector('input') as HTMLInputElement;
    setInputValue(input, 'ABCDEFGHJK');

    revealCollectionCode.mockResolvedValue({ reference: 'BML-ABCD2345', collectionCode: null });
    await clickAndFlush(findButton(el, 'Confirm token')!);

    expect(el.textContent).toContain('No collection code to show for this parcel right now.');
  });

  it('shows the server’s own message on an invalid or expired token, and lets them try again', async () => {
    const el = await requestThenMount();
    const input = el.querySelector('input') as HTMLInputElement;
    setInputValue(input, 'WRONGCODE1');

    revealCollectionCode.mockRejectedValue({ status: 400, message: 'That code is invalid or has expired. Request a new one.' });
    await clickAndFlush(findButton(el, 'Confirm token')!);

    expect(el.textContent).toContain('That code is invalid or has expired. Request a new one.');
    expect(el.querySelector('input')).toBeTruthy();
  });
});
