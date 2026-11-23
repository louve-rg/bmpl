// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { CollectionHoldMessageText } from './CollectionHoldMessage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOLD_MESSAGE =
  'Too many incorrect codes were entered for this collection. Our team needs to confirm it with you directly before it can be completed — contact support.';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
});

function mount(message: string) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<CollectionHoldMessageText message={message} />);
  });
  return container;
}

describe('CollectionHoldMessageText (MDF-942)', () => {
  it('turns "contact support" into a mailto link to the one existing support address, with the surrounding sentence intact', () => {
    const el = mount(HOLD_MESSAGE);
    expect(el.textContent).toBe(HOLD_MESSAGE);

    const link = el.querySelector('a');
    expect(link).toBeTruthy();
    expect(link!.textContent).toBe('contact support');
    expect(link!.getAttribute('href')).toBe('mailto:info@bzemarketplace.com?subject=Collection%20code%20locked');
  });

  it('matches the phrase case-insensitively', () => {
    const el = mount('Please Contact Support for help.');
    const link = el.querySelector('a');
    expect(link!.textContent).toBe('Contact Support');
  });

  it('degrades to the plain sentence, no crash, when the phrase is not present', () => {
    const el = mount('Some other message with no support phrase.');
    expect(el.textContent).toBe('Some other message with no support phrase.');
    expect(el.querySelector('a')).toBeNull();
  });
});
