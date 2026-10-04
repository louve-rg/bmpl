// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useModalMenu } from './use-modal-menu';

// react-dom's act() checks this flag; we did not add @testing-library/react for
// this one file, so set it here (same as use-dialog-focus-trap.test.tsx).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * P1 of the nav plan: the drawer's modal-menu behaviour, extracted unchanged.
 * Tests pin each behaviour the drawer relied on, against a real jsdom tree.
 */

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
  document.body.style.overflow = '';
  root = null;
  container = null;
});

function Menu({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    onClose();
  };
  useModalMenu({ open, onClose: close, panelRef, triggerRef });
  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <div ref={panelRef} data-testid="panel">
          <button type="button">First</button>
          <button type="button">Middle</button>
          <button type="button">Last</button>
        </div>
      )}
    </>
  );
}

function mount(onClose = vi.fn()) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Menu onClose={onClose} />));
  return { onClose, trigger: container.querySelector('button') as HTMLButtonElement };
}

function openMenu(trigger: HTMLButtonElement) {
  act(() => {
    trigger.focus();
    trigger.click();
  });
}

describe('useModalMenu', () => {
  it('moves focus to the first item on open and back to the trigger on close', () => {
    const { trigger } = mount();
    openMenu(trigger);
    expect(document.activeElement?.textContent).toBe('First');

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(container!.querySelector('[data-testid="panel"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('calls onClose on Escape', () => {
    const { onClose, trigger } = mount();
    openMenu(trigger);
    act(() => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('wraps Tab from the last item to the first, and Shift+Tab from the first to the last', () => {
    const { trigger } = mount();
    openMenu(trigger);
    const items = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="panel"] button'));
    const [first, , last] = items as [HTMLButtonElement, HTMLButtonElement, HTMLButtonElement];

    act(() => last.focus());
    act(() => {
      last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(document.activeElement).toBe(first);

    act(() => {
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    });
    expect(document.activeElement).toBe(last);
  });

  it('locks background scroll while open and restores the previous value on close', () => {
    document.body.style.overflow = 'auto';
    const { trigger } = mount();
    openMenu(trigger);
    expect(document.body.style.overflow).toBe('hidden');

    act(() => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.body.style.overflow).toBe('auto');
  });
});
