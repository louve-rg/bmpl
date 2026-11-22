// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { SenderCollectionCode } from './SenderCollectionCode';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
});

function mount(code: string | null, holdMessage?: string | null) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<SenderCollectionCode code={code} holdMessage={holdMessage} />);
  });
  return container;
}

describe('SenderCollectionCode', () => {
  it('renders the code and explains what it is for', () => {
    const el = mount('7K3P');
    expect(el.textContent).toContain('7K3P');
    expect(el.textContent).toContain('Collection code');
    expect(el.textContent).toMatch(/pass it on/i);
  });

  it('renders nothing when there is no code and no hold message', () => {
    const el = mount(null);
    expect(el.textContent).toBe('');
    expect(el.childElementCount).toBe(0);
  });

  // MDF-926: before this, a locked-out code simply vanished from this slot
  // with nothing in its place -- the dead-end control the owner ruled out.
  it('renders the hold message in the code\'s own slot once the code has locked out, never the code and the message together', () => {
    const el = mount(null, 'Too many incorrect codes were entered for this collection. Our team needs to confirm it with you directly before it can be completed — contact support.');
    expect(el.textContent).toContain('Collection code');
    expect(el.textContent).toContain('Our team needs to confirm it with you directly');
    expect(el.textContent).not.toMatch(/pass it on/i);

    // MDF-942: that sentence must give a way to act on it, not just name the problem.
    const link = el.querySelector('a');
    expect(link?.getAttribute('href')).toBe('mailto:support@bzemarketplace.com?subject=Collection%20code%20locked');
  });
});
