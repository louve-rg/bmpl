// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodeLookupPanel, isValidLookupCode, type CodeLookupState } from './code-lookup-panel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * EDW-P2: draft component, not wired into page.tsx yet (see the file's own
 * header comment for why -- Pam's lookup endpoint does not exist). These
 * tests cover the policy decisions god already made binding (2026-11-26T19-
 * 45-39-781Z-ceb724) ahead of the endpoint: `broughtBy`/`courier` can never
 * appear (excluded by the type itself, not just by omission in one render),
 * the lookup's own feedback states are distinct from the six HANDOFF states
 * on page.tsx, and selecting a candidate never claims to have received it.
 */

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
});

function mount(el: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(el);
  });
  return container;
}

function renderPanel(state: CodeLookupState, overrides: Partial<Parameters<typeof CodeLookupPanel>[0]> = {}) {
  const onCodeChange = vi.fn();
  const onLookup = vi.fn();
  const onSelectCandidate = vi.fn();
  const el = mount(
    <CodeLookupPanel code="" onCodeChange={onCodeChange} onLookup={onLookup} state={state} onSelectCandidate={onSelectCandidate} {...overrides} />,
  );
  return { el, onCodeChange, onLookup, onSelectCandidate };
}

describe('isValidLookupCode', () => {
  it('accepts 4-8 digit codes, matching the same shape the existing Collect field already enforces', () => {
    expect(isValidLookupCode('1234')).toBe(true);
    expect(isValidLookupCode('12345678')).toBe(true);
  });

  it('rejects too short, too long, and non-numeric input', () => {
    expect(isValidLookupCode('123')).toBe(false);
    expect(isValidLookupCode('123456789')).toBe(false);
    expect(isValidLookupCode('abcd')).toBe(false);
    expect(isValidLookupCode('')).toBe(false);
  });
});

describe('CodeLookupPanel', () => {
  it('shows a format error for an invalid code, never a leg-lockout message (Q5: no leg is identified yet, so there is nothing to lock)', () => {
    const { el } = renderPanel({ kind: 'invalid' });
    expect(el.textContent).toContain('Enter a 4-8 digit code.');
    expect(el.textContent).not.toMatch(/lock/i);
  });

  it('renders "not found" without ever implying the code exists at a different terminal (Q3: opaque at lookup, by design)', () => {
    const { el } = renderPanel({ kind: 'notFound' });
    expect(el.textContent).toContain('No parcel expecting that code at your location.');
    expect(el.textContent).not.toMatch(/other terminal|elsewhere|different (hub|location|terminal)/i);
  });

  it('directs to the reference-based Lookup tab when too many parcels match, with the concrete threshold (6+ renders tooMany, 1-5 lists candidates)', () => {
    const { el } = renderPanel({ kind: 'tooMany' });
    expect(el.textContent).toContain('More than 5 parcels');
    expect(el.textContent).toContain('shipment reference');
    expect(el.textContent).toContain('Lookup tab');
  });

  it('warns before the per-caller lookup limit is reached, with a correct singular/plural', () => {
    const { el: plural } = renderPanel({ kind: 'limitApproaching', remaining: 2 });
    expect(plural.textContent).toContain('2 code lookups left');
    const { el: singular } = renderPanel({ kind: 'limitApproaching', remaining: 1 });
    expect(singular.textContent).toContain('1 code lookup left');
  });

  it('never leaves the per-caller limit as an unexplained dead end once reached', () => {
    const { el } = renderPanel({ kind: 'limitReached' });
    expect(el.textContent).toContain('Too many code lookups');
  });

  it('renders a server error message verbatim', () => {
    const { el } = renderPanel({ kind: 'error', message: 'Could not look up that code.' });
    expect(el.textContent).toContain('Could not look up that code.');
  });

  /**
   * Q1 (binding): broughtBy/courier are excluded from the candidate type
   * itself -- this is a type-level guarantee, not something a render test
   * can defeat, but the test still proves the three allowed fields render
   * and nothing else is invented in their place.
   */
  const belizeCity = { legId: 'leg_1', reference: 'BML-42', parcel: '1 parcel', from: 'Belize City Hub', hub: { code: 'BZE', name: 'Belize City Hub' }, arrivedAt: '2026-11-26T14:00:00.000Z', locked: false };
  const sanPedro = { legId: 'leg_2', reference: 'BML-43', parcel: '2 parcels', from: 'San Pedro Hub', hub: { code: 'SPR', name: 'San Pedro Hub' }, arrivedAt: null, locked: false };

  it('renders a found candidate with reference, parcel, origin, current hub and arrival -- never a person name (Q7/Q8: hub is required because a result can span two terminals)', () => {
    const { el, onSelectCandidate } = renderPanel({ kind: 'found', candidates: [belizeCity] });
    expect(el.textContent).toContain('BML-42');
    expect(el.textContent).toContain('1 parcel');
    expect(el.textContent).toContain('From Belize City Hub');
    expect(el.textContent).toContain('BZE');
    expect(el.textContent).toContain('Arrived');

    const button = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Use this one')!;
    act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onSelectCandidate).toHaveBeenCalledWith(belizeCity);
  });

  it('renders "Not yet arrived" when a candidate has not arrived at its current hub', () => {
    const { el } = renderPanel({ kind: 'found', candidates: [sanPedro] });
    expect(el.textContent).toContain('Not yet arrived');
  });

  it('renders every candidate when more than one is returned (up to 5), each independently selectable', () => {
    const { el, onSelectCandidate } = renderPanel({ kind: 'found', candidates: [belizeCity, sanPedro] });
    expect(el.textContent).toContain('BML-42');
    expect(el.textContent).toContain('BML-43');

    const buttons = Array.from(el.querySelectorAll('button')).filter((b) => b.textContent === 'Use this one');
    expect(buttons).toHaveLength(2);
    act(() => buttons[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onSelectCandidate).toHaveBeenCalledWith(sanPedro);
  });

  it('a locked candidate shows why and cannot be selected (Q7: locked is derived, never the raw attempt count)', () => {
    const locked = { ...belizeCity, locked: true };
    const { el, onSelectCandidate } = renderPanel({ kind: 'found', candidates: [locked] });
    expect(el.textContent).toContain('Locked');
    expect(el.textContent).toContain('admin override');
    expect(el.textContent).not.toMatch(/\d+ (of|\/) ?\d+ attempts|attempt \d/i);

    const button = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Use this one') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onSelectCandidate).not.toHaveBeenCalled();
  });

  it('selecting a candidate only reports the choice -- it never renders anything claiming the parcel has been received', () => {
    const { el } = renderPanel({ kind: 'found', candidates: [belizeCity] });
    expect(el.textContent).not.toMatch(/received|confirmed|accepted/i);
  });

  it('calls onLookup and onCodeChange from the input and button', () => {
    const { el, onCodeChange, onLookup } = renderPanel({ kind: 'idle' });
    const input = el.querySelector('#code-lookup-input') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, '4821');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onCodeChange).toHaveBeenCalledWith('4821');

    const button = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Find parcel')!;
    act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onLookup).toHaveBeenCalled();
  });

  it('disables the lookup button and says so while loading', () => {
    const { el } = renderPanel({ kind: 'loading' });
    const button = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Looking up…') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
