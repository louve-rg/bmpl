// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusBadge } from './StatusBadge';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(status: string) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<StatusBadge status={status} />);
  });
  return container;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

/**
 * SHIPPING-E2E-CLOSE: LOCKED used to fall through to the shared default
 * ('neutral') -- the same dot colour as a routine terminal status like
 * ARCHIVED -- which is the wrong rendering for the one wallet status that
 * means a customer cannot transact.
 */
describe('StatusBadge — LOCKED is a distinct, non-neutral tone (SHIPPING-E2E-CLOSE)', () => {
  it('LOCKED renders the error (red) dot, not the neutral default', () => {
    const el = render('LOCKED');
    expect(el.querySelector('.bg-red-500')).not.toBeNull();
    expect(el.querySelector('.bg-slate-400')).toBeNull();
  });

  it('a routine terminal status like ARCHIVED still renders neutral, unaffected', () => {
    const el = render('ARCHIVED');
    expect(el.querySelector('.bg-slate-400')).not.toBeNull();
  });

  it('SUSPENDED keeps its own existing warning tone, distinct from LOCKED', () => {
    const el = render('SUSPENDED');
    expect(el.querySelector('.bg-amber-500')).not.toBeNull();
  });
});
