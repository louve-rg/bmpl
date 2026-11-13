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

function mount(code: string | null) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<SenderCollectionCode code={code} />);
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

  it('renders nothing when there is no code', () => {
    const el = mount(null);
    expect(el.textContent).toBe('');
    expect(el.childElementCount).toBe(0);
  });
});
