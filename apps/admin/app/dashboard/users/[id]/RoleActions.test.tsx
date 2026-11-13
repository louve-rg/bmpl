// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestFlagControl } from './RoleActions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const apiPost = vi.fn();
vi.mock('../../../../lib/api', () => ({
  api: { post: (...args: unknown[]) => apiPost(...args) },
}));

const routerRefresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: routerRefresh }) }));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  apiPost.mockReset();
  apiPost.mockResolvedValue({});
  routerRefresh.mockReset();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

function mount(props: { userId: string; isTest: boolean; canSetTestFlag?: boolean }) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<TestFlagControl {...props} />);
  });
  return container;
}

async function clickAndFlush(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * TERM-SIM-DESIGNATE: POST /admin/users/test-flag already exists, audited,
 * gated on users.suspend -- there was no console control for it on either
 * the admin or web app, so designating a simulation account needed a raw
 * API call or a database write. This is the first control for it.
 */
describe('TestFlagControl (TERM-SIM-DESIGNATE)', () => {
  it('shows the current state plainly even for a viewer without users.suspend, with no action control', () => {
    const c = mount({ userId: 'u1', isTest: false, canSetTestFlag: false });

    expect(c.textContent).toContain('Real account');
    expect(c.querySelectorAll('button').length).toBe(0);
  });

  it('shows "Simulation account" (not "Real account") for an isTest user, state visible regardless of permission', () => {
    const c = mount({ userId: 'u1', isTest: true, canSetTestFlag: false });

    expect(c.textContent).toContain('Simulation account');
    expect(c.textContent).not.toContain('Real account');
  });

  it('designates a real account as simulation, with the typed reason, when the viewer holds users.suspend', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('UAT booking test');
    const c = mount({ userId: 'u1', isTest: false, canSetTestFlag: true });

    const button = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Designate as simulation')!;
    expect(button).toBeDefined();

    await clickAndFlush(button);

    expect(apiPost).toHaveBeenCalledWith('/admin/users/test-flag', { userId: 'u1', isTest: true, reason: 'UAT booking test' });
    expect(routerRefresh).toHaveBeenCalledTimes(1);
    promptSpy.mockRestore();
  });

  it('clears the simulation flag, with isTest: false, from an isTest account', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Converting to a real tester account');
    const c = mount({ userId: 'u1', isTest: true, canSetTestFlag: true });

    const button = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Clear simulation flag')!;
    expect(button).toBeDefined();

    await clickAndFlush(button);

    expect(apiPost).toHaveBeenCalledWith('/admin/users/test-flag', { userId: 'u1', isTest: false, reason: 'Converting to a real tester account' });
    expect(routerRefresh).toHaveBeenCalledTimes(1);
    promptSpy.mockRestore();
  });

  it('does nothing if the reason prompt is cancelled', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);
    const c = mount({ userId: 'u1', isTest: false, canSetTestFlag: true });

    const button = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Designate as simulation')!;
    await clickAndFlush(button);

    expect(apiPost).not.toHaveBeenCalled();
    expect(routerRefresh).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it('does nothing if the reason is blank', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('   ');
    const c = mount({ userId: 'u1', isTest: false, canSetTestFlag: true });

    const button = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Designate as simulation')!;
    await clickAndFlush(button);

    expect(apiPost).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });
});
