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
  window.localStorage.clear();
});

async function mount(token = 'TOK123TOK1') {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<UnlinkedCollectionCode token={token} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

/** Unmounts without touching storage -- the thing a page reload does NOT
 * do (a reload starts a fresh localStorage read, which this preserves). */
async function unmountOnly() {
  if (root) await act(async () => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
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

  // MDF-926: this is the least-authenticated of the three collection-code
  // readers -- no account, no session, just a mailed token -- so a
  // locked-out holder must see the SAME coarse sentence in the code's own
  // slot, never the generic "nothing to show" line, and never any count,
  // remaining-tries, or raw status.
  it('shows the hold message in the code\'s own slot once the code has locked out, not the generic "nothing to show" line', async () => {
    const el = await requestThenMount();
    const input = el.querySelector('input') as HTMLInputElement;
    setInputValue(input, 'ABCDEFGHJK');

    revealCollectionCode.mockResolvedValue({
      reference: 'BML-ABCD2345',
      collectionCode: null,
      collectionHoldMessage:
        'Too many incorrect codes were entered for this collection. Our team needs to confirm it with you directly before it can be completed — contact support.',
    });
    await clickAndFlush(findButton(el, 'Confirm token')!);

    expect(el.textContent).toContain('Our team needs to confirm it with you directly');
    expect(el.textContent).not.toContain('No collection code to show for this parcel right now.');
    expect(el.textContent).not.toMatch(/attempt|remaining|tries left/i);

    // MDF-942: that sentence must give a way to act on it, not just name the problem.
    const link = el.querySelector('a');
    expect(link?.getAttribute('href')).toBe('mailto:support@bzemarketplace.com?subject=Collection%20code%20locked');

    // MDF-942, this path only: the request endpoint never checks lock state,
    // so this holder -- unlike Sender/RecipientCollectionCode, which have no
    // token to re-request -- must be told requesting again is an option.
    expect(el.textContent).toMatch(/request a new code/i);
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

/**
 * WEB-HOLD-RESEND-BUTTON-OFF-SCREEN: the "you may need to request a new
 * code" sentence (MDF-942) told the reader what to do, but the only
 * request/resend control lived in the `phase !== 'revealed'` branch, which
 * this hold-message state never reaches -- so there was nothing on screen
 * to act on it with. These pin that a control now exists here, and that it
 * is the SAME request flow (same cooldown, same endpoint), not a second
 * one.
 */
describe('UnlinkedCollectionCode — acting on the hold-message resend hint (WEB-HOLD-RESEND-BUTTON-OFF-SCREEN)', () => {
  async function revealIntoHoldMessage() {
    requestCollectionCodeEmail.mockResolvedValue({ requested: true });
    const el = await mount('HOLD-TOK-01');
    await clickAndFlush(findButton(el, 'Email me a collection code')!);

    const input = el.querySelector('input') as HTMLInputElement;
    setInputValue(input, 'ABCDEFGHJK');
    revealCollectionCode.mockResolvedValue({
      reference: 'BML-ABCD2345',
      collectionCode: null,
      collectionHoldMessage:
        'Too many incorrect codes were entered for this collection. Our team needs to confirm it with you directly before it can be completed — contact support.',
    });
    await clickAndFlush(findButton(el, 'Confirm token')!);
    return el;
  }

  it('shows a request control next to the hold message, disabled while the original cooldown is still running', async () => {
    const el = await revealIntoHoldMessage();

    // The first request's 5-minute cooldown is still running at this point
    // (requesting and revealing happen back to back in the test) -- the
    // button must read that, not offer a fresh send the server would
    // reject anyway.
    const cooldownBtn = Array.from(el.querySelectorAll('button')).find((b) => /You can request another token in/.test(b.textContent ?? ''));
    expect(cooldownBtn).toBeTruthy();
    expect(cooldownBtn!.hasAttribute('disabled')).toBe(true);
    expect(el.textContent).not.toContain('Email me a new token');
  });

  it('once the cooldown has passed, clicking it re-requests and hands off to the same token-entry UI', async () => {
    vi.useFakeTimers();
    try {
      const el = await revealIntoHoldMessage();

      // The component's own 1s interval ticks `now` forward -- advancing
      // fake time past the 5-minute cooldown is what actually flips
      // `onCooldown` false here, same clock the real button reads from.
      await act(async () => {
        vi.advanceTimersByTime(5 * 60_000 + 1_000);
      });

      requestCollectionCodeEmail.mockClear();
      requestCollectionCodeEmail.mockResolvedValue({ requested: true });

      const resendBtn = findButton(el, 'Email me a new token');
      expect(resendBtn).toBeTruthy();
      await clickAndFlush(resendBtn!);

      expect(requestCollectionCodeEmail).toHaveBeenCalledWith('HOLD-TOK-01');
      // Back to the token-entry UI, not stuck on the hold message.
      expect(el.textContent).toContain('Check your inbox');
      expect(el.querySelector('input')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the request error inline here too, rather than failing silently', async () => {
    vi.useFakeTimers();
    try {
      const el = await revealIntoHoldMessage();
      await act(async () => {
        vi.advanceTimersByTime(5 * 60_000 + 1_000);
      });

      requestCollectionCodeEmail.mockRejectedValueOnce({ status: 429, message: 'Too many requests. Try again shortly.' });
      await clickAndFlush(findButton(el, 'Email me a new token')!);

      expect(el.textContent).toContain('Too many requests. Try again shortly.');
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * MDF-738, second deliverable: the resend cooldown used to be in-memory
 * only, so a reload of /track/[token] brought the button back while the
 * server was still inside its own cooldown -- a request made right after
 * answers the SAME neutral "requested: true" the server always gives, so
 * the recipient is told "we sent it" when nothing was actually sent.
 * Simulated here as unmount-then-remount with the SAME token, since a page
 * reload is exactly that from this component's own perspective -- its
 * React state is gone, only whatever persisted outside it (localStorage)
 * survives.
 */
describe('UnlinkedCollectionCode — the resend cooldown survives a reload (MDF-738)', () => {
  it('a reload right after requesting still shows the cooldown, not a fresh "Email me" button', async () => {
    requestCollectionCodeEmail.mockResolvedValue({ requested: true });
    const first = await mount('RELOAD-TOK');
    await clickAndFlush(findButton(first, 'Email me a collection code')!);
    expect(requestCollectionCodeEmail).toHaveBeenCalledTimes(1);

    await unmountOnly();
    const reloaded = await mount('RELOAD-TOK');

    // The button must already read the cooldown, not the fresh CTA --
    // and nothing must have asked the server anything to know that.
    expect(requestCollectionCodeEmail).toHaveBeenCalledTimes(1);
    const cooldownBtn = Array.from(reloaded.querySelectorAll('button')).find((b) => /You can request another token in/.test(b.textContent ?? ''));
    expect(cooldownBtn).toBeTruthy();
    expect(cooldownBtn!.hasAttribute('disabled')).toBe(true);
    expect(reloaded.textContent).not.toContain('Email me a collection code');
  });

  it('a different shipment\'s token is never affected by another token\'s cooldown', async () => {
    requestCollectionCodeEmail.mockResolvedValue({ requested: true });
    const first = await mount('TOKEN-A');
    await clickAndFlush(findButton(first, 'Email me a collection code')!);
    await unmountOnly();

    const other = await mount('TOKEN-B');
    expect(findButton(other, 'Email me a collection code')).toBeTruthy();
    expect(other.textContent).not.toMatch(/You can request another token in/);
  });

  it('once the cooldown window has genuinely passed, a reload shows the live button again, not a stuck one', async () => {
    requestCollectionCodeEmail.mockResolvedValue({ requested: true });
    const first = await mount('EXPIRED-TOK');
    await clickAndFlush(findButton(first, 'Email me a collection code')!);
    await unmountOnly();

    // Backdate the stored cooldown as if the real 5 minutes had already
    // elapsed, rather than waiting on a timer in the test.
    window.localStorage.setItem('bml-collection-code-cooldown:EXPIRED-TOK', String(Date.now() - 1000));

    const reloaded = await mount('EXPIRED-TOK');
    expect(findButton(reloaded, 'Email me a collection code')).toBeTruthy();
    expect(reloaded.textContent).not.toMatch(/You can request another token in/);
  });
});
