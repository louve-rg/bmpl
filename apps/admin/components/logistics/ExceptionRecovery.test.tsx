// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExceptionRecovery } from './ExceptionRecovery';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const apiPost = vi.fn();
vi.mock('../../lib/api', () => ({
  api: {
    get: vi.fn(),
    post: (...args: unknown[]) => apiPost(...args),
    patch: vi.fn(),
    del: vi.fn(),
  },
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const onResolved = vi.fn(async () => {});

beforeEach(() => {
  apiPost.mockReset();
  onResolved.mockClear();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
});

function mount(legKind: 'FIRST_MILE' | 'LINE_HAUL' | 'LAST_MILE' = 'LAST_MILE') {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<ExceptionRecovery legId="leg_1" legKind={legKind} onResolved={onResolved} />);
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

function setValue(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/**
 * Requirement 10's gap: `POST legs/:id/resolve-exception` had zero UI callers
 * anywhere. These tests prove the wiring — both resolutions reach the real
 * endpoint with the real body shape, and a refusal shows the server's own
 * sentence verbatim, never a hardcoded one (the standing constraint named in
 * the task).
 */
describe('ExceptionRecovery — both resolutions reachable', () => {
  it('offers both triggers up front for a driver-carried leg', () => {
    const el = mount('LAST_MILE');
    expect(findButton(el, 'Resume')).toBeTruthy();
    expect(findButton(el, 'Release driver')).toBeTruthy();
  });

  it('hides Release driver for a LINE_HAUL leg — a carrier, not a driver, holds it; the server refuses this by name, this just does not offer it', () => {
    const el = mount('LINE_HAUL');
    expect(findButton(el, 'Resume')).toBeTruthy();
    expect(findButton(el, 'Release driver')).toBeFalsy();
  });

  it('RESUME calls resolve-exception with the resolution and note, then reports success and reloads', async () => {
    const el = mount();
    await clickAndFlush(findButton(el, 'Resume')!);

    const textarea = el.querySelector('textarea')!;
    setValue(textarea, 'Flat tyre was fixed, continuing as normal.');

    apiPost.mockResolvedValueOnce({ status: 'READY' });
    await clickAndFlush(findButton(el, 'Resume leg')!);

    expect(apiPost).toHaveBeenCalledWith('/admin/logistics/legs/leg_1/resolve-exception', {
      resolution: 'RESUME',
      note: 'Flat tyre was fixed, continuing as normal.',
    });
    expect(el.textContent).toContain('Leg resumed');
    expect(onResolved).toHaveBeenCalledTimes(1);
  });

  it('RELEASE_DRIVER calls resolve-exception with its own resolution value', async () => {
    const el = mount();
    await clickAndFlush(findButton(el, 'Release driver')!);

    setValue(el.querySelector('textarea')!, 'Driver reported a mechanical breakdown.');

    apiPost.mockResolvedValueOnce({ status: 'READY' });
    await clickAndFlush(findButton(el, 'Release driver')!);

    expect(apiPost).toHaveBeenCalledWith('/admin/logistics/legs/leg_1/resolve-exception', {
      resolution: 'RELEASE_DRIVER',
      note: 'Driver reported a mechanical breakdown.',
    });
    expect(el.textContent).toContain('Driver released');
  });

  it('the submit button stays disabled until a note of at least 4 characters is entered', async () => {
    const el = mount();
    await clickAndFlush(findButton(el, 'Resume')!);

    const submit = findButton(el, 'Resume leg')!;
    expect(submit.hasAttribute('disabled')).toBe(true);

    setValue(el.querySelector('textarea')!, 'ok');
    expect(findButton(el, 'Resume leg')!.hasAttribute('disabled')).toBe(true);

    setValue(el.querySelector('textarea')!, 'Cleared the lockout.');
    expect(findButton(el, 'Resume leg')!.hasAttribute('disabled')).toBe(false);
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('surfaces the server refusal verbatim, never a hardcoded sentence, and does not report success', async () => {
    const el = mount();
    await clickAndFlush(findButton(el, 'Release driver')!);
    setValue(el.querySelector('textarea')!, 'Trying to release anyway.');

    apiPost.mockRejectedValueOnce({
      status: 400,
      message: 'This driver has already collected the parcel, so they cannot be released here. Resume the leg, or cancel the shipment through support.',
    });
    await clickAndFlush(findButton(el, 'Release driver')!);

    expect(el.textContent).toContain('This driver has already collected the parcel');
    expect(el.textContent).not.toContain('Driver released');
    expect(onResolved).not.toHaveBeenCalled();
  });

  it('Cancel returns to the initial two-trigger state without calling the API', async () => {
    const el = mount();
    await clickAndFlush(findButton(el, 'Resume')!);
    expect(el.querySelector('textarea')).toBeTruthy();

    await clickAndFlush(Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Cancel')!);

    expect(findButton(el, 'Resume')).toBeTruthy();
    expect(findButton(el, 'Release driver')).toBeTruthy();
    expect(apiPost).not.toHaveBeenCalled();
  });
});
