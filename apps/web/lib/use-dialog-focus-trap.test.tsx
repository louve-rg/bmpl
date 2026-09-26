// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useDialogFocusTrap } from './use-dialog-focus-trap';

// react-dom's act() checks this flag; @testing-library/react normally sets
// it, and we deliberately did not add that dependency for one test file.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * BMPL-208: the real regression this repo lacked — Tab escaping an
 * aria-modal dialog into the page behind it, and focus never returning to
 * whatever opened it. Exercised against a real (jsdom) DOM tree, not a
 * mock, because the bug was DOM behaviour (tab order, inert), not a pure
 * function. Mirrors the actual shape both callers have: a page-level
 * element outside the app root (like a fixed nav), a trigger button that
 * is a true sibling of the dialog (the Fragment shape both dialogs use),
 * and the dialog itself with a first/middle/last focusable element.
 */

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
  root = null;
  container = null;
});

function TestHarness({ open, showTrigger = true }: { open: boolean; showTrigger?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDialogFocusTrap({ open, containerRef, initialFocusRef: closeRef });

  return (
    <>
      {showTrigger && <button id="trigger">Trigger</button>}
      {open && (
        <div ref={containerRef} role="dialog" aria-modal="true">
          <button ref={closeRef} id="first">First</button>
          <button id="middle">Middle</button>
          <button id="last">Last</button>
        </div>
      )}
    </>
  );
}

function mount(open: boolean) {
  // A real page-level element several DOM levels above the React root —
  // the shape a dashboard header actually has relative to a dialog nested
  // inside the page it renders on.
  document.body.innerHTML = '<button id="page-button">Page button</button><div id="react-root"></div>';
  container = document.getElementById('react-root') as HTMLDivElement;
  root = createRoot(container);
  act(() => root!.render(<TestHarness open={open} />));
}

describe('useDialogFocusTrap', () => {
  it('inerts everything outside the dialog while open, at every level up to <body>', () => {
    mount(true);
    expect(document.getElementById('trigger')!.hasAttribute('inert')).toBe(true);
    expect(document.getElementById('page-button')!.hasAttribute('inert')).toBe(true);
    // The dialog's own ancestor chain (the react-root mount point) and its
    // own contents must stay untouched.
    expect(document.getElementById('react-root')!.hasAttribute('inert')).toBe(false);
    expect(document.getElementById('first')!.hasAttribute('inert')).toBe(false);
  });

  it('removes inert from everything when the dialog closes', () => {
    mount(true);
    // Assert it was actually APPLIED first — otherwise a mutation that
    // breaks applying inert entirely still reads as "removed" below, since
    // removing an attribute that was never there also leaves it absent.
    expect(document.getElementById('trigger')!.hasAttribute('inert')).toBe(true);
    expect(document.getElementById('page-button')!.hasAttribute('inert')).toBe(true);
    act(() => root!.render(<TestHarness open={false} />));
    expect(document.getElementById('trigger')!.hasAttribute('inert')).toBe(false);
    expect(document.getElementById('page-button')!.hasAttribute('inert')).toBe(false);
  });

  it('Tab from the last focusable element wraps to the first — it does not escape', () => {
    mount(true);
    document.getElementById('last')!.focus();
    expect(document.activeElement!.id).toBe('last');
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    });
    expect(document.activeElement!.id).toBe('first');
  });

  it('Shift+Tab from the first focusable element wraps to the last — it does not escape', () => {
    mount(true);
    document.getElementById('first')!.focus();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    });
    expect(document.activeElement!.id).toBe('last');
  });

  it('Tab from a MIDDLE element moves forward normally instead of being force-wrapped', () => {
    // The trap must only intervene at the boundaries; anywhere else Tab
    // should behave exactly as the browser already does.
    mount(true);
    document.getElementById('middle')!.focus();
    let prevented = false;
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Tab') prevented = e.defaultPrevented;
      },
      { capture: false },
    );
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    });
    expect(prevented).toBe(false);
  });

  it('returns focus to whatever opened the dialog once it closes', () => {
    mount(false);
    document.getElementById('trigger')!.focus();
    expect(document.activeElement!.id).toBe('trigger');

    act(() => root!.render(<TestHarness open={true} />));
    expect(document.activeElement!.id).toBe('first'); // moved onto initialFocusRef

    act(() => root!.render(<TestHarness open={false} />));
    expect(document.activeElement!.id).toBe('trigger');
  });

  it('falls back to <body> instead of leaving focus wherever it drifted, when the opener is unmounted before the dialog closes', () => {
    // The shape this catches: a list re-renders (an item removed, a page
    // navigated a different way) while the dialog stays open, so the
    // element that opened it no longer exists once the dialog closes.
    mount(false);
    document.getElementById('trigger')!.focus();
    act(() => root!.render(<TestHarness open={true} />)); // records #trigger as the opener; focus -> #first

    // The opener disappears while the dialog is STILL open — the trap
    // itself is unaffected by this.
    act(() => root!.render(<TestHarness open={true} showTrigger={false} />));
    expect(document.getElementById('trigger')).toBeNull();

    // Something unrelated to the dialog's own content ends up focused before
    // it closes. Without this, the browser's own "the focused node was
    // removed -> focus <body>" rule fires from closing the dialog itself
    // (its content, including #first, gets unmounted too) and would produce
    // the same result regardless of this fix — this isolates the assertion
    // below to the hook's own fallback, not that incidental behaviour.
    document.getElementById('page-button')!.focus();

    act(() => root!.render(<TestHarness open={false} showTrigger={false} />));

    expect(document.activeElement).toBe(document.body);
  });
});
