// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AvailabilityWindows } from './AvailabilityWindows';
import { shippingApi, type ShipmentLegView, type ShipmentView } from '../../lib/shipping';

// react-dom's act() checks this flag; see StorefrontView.test.tsx / LocationPicker.test.tsx
// for the same convention (no @testing-library/react dependency in this repo).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../lib/shipping', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/shipping')>();
  return { ...actual, shippingApi: { ...actual.shippingApi, setAvailabilityWindows: vi.fn() } };
});

function leg(over: Partial<ShipmentLegView> = {}): ShipmentLegView {
  return {
    id: 'l1',
    sequence: 1,
    kind: 'FIRST_MILE',
    mode: 'LAND',
    modeLabel: 'Road',
    status: 'PENDING',
    description: null,
    priceMinor: 1000,
    durationMinutes: 30,
    isCurrent: true,
    originHub: null,
    destinationHub: null,
    carrier: null,
    scheduleNote: null,
    departedAt: null,
    arrivedAt: null,
    startedAt: null,
    completedAt: null,
    handoffReceivedByName: null,
    exceptionReason: null,
    handoffPin: null,
    courier: null,
    courierVehicle: null,
    conversationId: null,
    eta: null,
    ...over,
  };
}

function shipment(over: Partial<ShipmentView> = {}): ShipmentView {
  return {
    id: 's1',
    reference: 'BML-ABCD2345',
    service: 'DOOR_TO_DOOR',
    serviceLabel: 'Door to door',
    status: 'AWAITING_PICKUP',
    statusLabel: 'Awaiting pickup',
    endsAtHub: false,
    quotedTotalMinor: 5000,
    quotedMinutes: 60,
    explanation: null,
    description: null,
    pieces: 1,
    bookedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    cancellationReason: null,
    exceptionReason: null,
    origin: { name: null, phone: null, address: null, city: null, district: null, latitude: null, longitude: null, instructions: null },
    destination: { name: null, phone: null, address: null, city: null, district: null, latitude: null, longitude: null, instructions: null },
    currentLegSequence: 1,
    legs: [leg()],
    custody: [],
    availabilityWindows: [],
    eta: { confidence: 'UNKNOWN', estimatedArrivalAt: null },
    ...over,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
});

function mount(s: ShipmentView) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<AvailabilityWindows shipment={s} onUpdated={() => {}} />);
  });
  return container;
}

describe('AvailabilityWindows — BMPL-349/350', () => {
  it('renders normally with configured windows', () => {
    // IN_PROGRESS (not in NOT_STARTED) so this role renders the read-only
    // "stored windows" text rather than the editable form.
    const el = mount(
      shipment({
        legs: [leg({ status: 'IN_PROGRESS' })],
        availabilityWindows: [{ id: 'w1', role: 'SENDER', startTime: '09:00', endTime: '17:00' }],
      }),
    );
    expect(el.textContent).toContain('9:00 AM–5:00 PM');
  });

  it('does not crash when availabilityWindows is missing from the wire entirely, and degrades to "no window set"', () => {
    const raw = JSON.parse(JSON.stringify(shipment())) as Record<string, unknown>;
    delete raw.availabilityWindows;
    expect(() => mount(raw as unknown as ShipmentView)).not.toThrow();
    const el = mount(raw as unknown as ShipmentView);
    expect(el.textContent).toContain("No window set — we'll attempt this at any time.");
  });
});

// ---------------------------------------------------------------------------
// BMPL-288 — the sender-UI piece itself (add/save/edit/locked-role).
//
// The two tests above are BMPL-349/350: a later, unrelated PR added them to
// this same file to pin a missing-field crash-safety case. They are the ONLY
// coverage that existed for this file before this block — nothing here
// exercised add, edit, save, its two validation rules, the overnight-accepted
// shape, or the locked-role render/Clear behaviour BMPL-288 actually shipped.
// A grep for "AvailabilityWindows.test.tsx" alone would have found a file and
// concluded the component was tested; it was, for a different requirement.
// ---------------------------------------------------------------------------

function findButton(root: HTMLElement, text: string): HTMLButtonElement {
  const btn = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === text);
  if (!btn) throw new Error(`no button with text "${text}" (had: ${Array.from(root.querySelectorAll('button')).map((b) => b.textContent).join(' | ')})`);
  return btn;
}

function findInputs(root: HTMLElement, label: string): { start: HTMLInputElement; end: HTMLInputElement } {
  const start = root.querySelector<HTMLInputElement>(`input[aria-label="${label} start time"]`);
  const end = root.querySelector<HTMLInputElement>(`input[aria-label="${label} end time"]`);
  if (!start || !end) throw new Error(`no time inputs for label "${label}"`);
  return { start, end };
}

// Plain `input.value = x` would go through React's own instance-level setter
// (installed the moment a controlled input mounts) and update its internal
// value-tracker in the same step, which then makes the dispatched event look
// like a no-op change and swallows it. Calling the PROTOTYPE's native setter
// directly bypasses that tracker update, so the follow-up event is seen as a
// real change and the component's onChange actually fires.
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
function setInputValue(input: HTMLInputElement, value: string) {
  act(() => {
    nativeInputValueSetter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const SENDER_LABEL = "When you'll be there for pickup";
const RECIPIENT_LABEL = 'When the recipient will be there for delivery';

describe('AvailabilityWindows — BMPL-288 (add)', () => {
  it('starts with no rows and an "add a window" control when nothing is stored', () => {
    const el = mount(shipment({ legs: [leg({ status: 'PENDING' })] }));
    expect(el.textContent).toContain("No window set — we'll attempt this at any time.");
    expect(() => findInputs(el, SENDER_LABEL)).toThrow();
    expect(() => findButton(el, '+ Add a window')).not.toThrow();
  });

  it('adds one empty, editable row per click, under the correct role', () => {
    const el = mount(shipment({ legs: [leg({ status: 'PENDING' })] }));
    act(() => {
      findButton(el, '+ Add a window').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const { start, end } = findInputs(el, SENDER_LABEL);
    expect(start.value).toBe('');
    expect(end.value).toBe('');

    act(() => {
      findButton(el, '+ Add a window').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(el.querySelectorAll(`input[aria-label="${SENDER_LABEL} start time"]`).length).toBe(2);
  });

  it('stops offering "add a window" once a role already has 5 rows (MAX_ROWS_PER_ROLE)', () => {
    const windows = Array.from({ length: 5 }, (_, i) => ({
      id: `w${i}`,
      role: 'SENDER' as const,
      startTime: `0${i}:00`,
      endTime: `1${i}:00`,
    }));
    const el = mount(shipment({ legs: [leg({ status: 'PENDING' })], availabilityWindows: windows }));
    expect(el.querySelectorAll(`input[aria-label="${SENDER_LABEL} start time"]`).length).toBe(5);
    expect(() => findButton(el, '+ Add a window')).toThrow();
  });
});

describe('AvailabilityWindows — BMPL-288 (edit)', () => {
  it('editing a stored row\'s start/end time updates the controlled input, wiring onChange end to end', () => {
    const el = mount(
      shipment({
        legs: [leg({ status: 'PENDING' })],
        availabilityWindows: [{ id: 'w1', role: 'SENDER', startTime: '09:00', endTime: '17:00' }],
      }),
    );
    const { start, end } = findInputs(el, SENDER_LABEL);
    expect(start.value).toBe('09:00');
    setInputValue(start, '10:30');
    // Re-query: onChange replaces the row via setState, which can hand back a
    // freshly-rendered <input> node.
    expect(findInputs(el, SENDER_LABEL).start.value).toBe('10:30');
    expect(findInputs(el, SENDER_LABEL).end.value).toBe('17:00');
    setInputValue(end, '18:45');
    expect(findInputs(el, SENDER_LABEL).end.value).toBe('18:45');
  });

  it('"Remove" drops exactly that row and leaves a sibling row untouched', () => {
    const el = mount(
      shipment({
        legs: [leg({ status: 'PENDING' })],
        availabilityWindows: [
          { id: 'w1', role: 'SENDER', startTime: '09:00', endTime: '10:00' },
          { id: 'w2', role: 'SENDER', startTime: '14:00', endTime: '15:00' },
        ],
      }),
    );
    expect(el.querySelectorAll(`input[aria-label="${SENDER_LABEL} start time"]`).length).toBe(2);
    const removeButtons = Array.from(el.querySelectorAll('button')).filter((b) => b.textContent === 'Remove');
    act(() => {
      removeButtons[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const remaining = el.querySelectorAll<HTMLInputElement>(`input[aria-label="${SENDER_LABEL} start time"]`);
    expect(remaining.length).toBe(1);
    expect(remaining[0]!.value).toBe('14:00');
  });
});

describe('AvailabilityWindows — BMPL-288 (save)', () => {
  async function clickSave(el: HTMLElement) {
    await act(async () => {
      findButton(el, 'Save availability').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
  }

  it('sends only the editable roles, role attached, and calls onUpdated with the real response — a DIRECT leg governs both roles at once', async () => {
    const updated = shipment({ id: 'updated' });
    (shippingApi.setAvailabilityWindows as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updated);
    const onUpdated = vi.fn();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const s = shipment({ legs: [leg({ kind: 'DIRECT', status: 'READY' })] });
    act(() => {
      root!.render(<AvailabilityWindows shipment={s} onUpdated={onUpdated} />);
    });
    const el = container;

    act(() => {
      Array.from(el.querySelectorAll('button'))
        .filter((b) => b.textContent === '+ Add a window')
        .forEach((b) => b.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    });
    setInputValue(findInputs(el, SENDER_LABEL).start, '09:00');
    setInputValue(findInputs(el, SENDER_LABEL).end, '12:00');
    setInputValue(findInputs(el, RECIPIENT_LABEL).start, '13:00');
    setInputValue(findInputs(el, RECIPIENT_LABEL).end, '16:00');

    await clickSave(el);

    expect(shippingApi.setAvailabilityWindows).toHaveBeenCalledWith('s1', [
      { startTime: '09:00', endTime: '12:00', role: 'SENDER' },
      { startTime: '13:00', endTime: '16:00', role: 'RECIPIENT' },
    ]);
    expect(onUpdated).toHaveBeenCalledWith(updated);
  });

  it('blocks save on an incomplete row (one time filled, the other blank) — never calls the API', async () => {
    (shippingApi.setAvailabilityWindows as ReturnType<typeof vi.fn>).mockClear();
    const el = mount(shipment({ legs: [leg({ status: 'PENDING' })] }));
    act(() => {
      findButton(el, '+ Add a window').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    setInputValue(findInputs(el, SENDER_LABEL).start, '09:00');
    // end time left blank on purpose.
    await clickSave(el);
    expect(shippingApi.setAvailabilityWindows).not.toHaveBeenCalled();
    expect(el.textContent).toContain('Fill in both times for each window, or remove it.');
  });

  it('blocks save on a zero-duration window (start === end) — never calls the API', async () => {
    (shippingApi.setAvailabilityWindows as ReturnType<typeof vi.fn>).mockClear();
    const el = mount(shipment({ legs: [leg({ status: 'PENDING' })] }));
    act(() => {
      findButton(el, '+ Add a window').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    setInputValue(findInputs(el, SENDER_LABEL).start, '09:00');
    setInputValue(findInputs(el, SENDER_LABEL).end, '09:00');
    await clickSave(el);
    expect(shippingApi.setAvailabilityWindows).not.toHaveBeenCalled();
    expect(el.textContent).toContain('A window needs a start time different from its end time.');
  });

  it('accepts an overnight window (end earlier than start) as a legitimate shape, not a rejected one', async () => {
    const updated = shipment({ id: 'updated' });
    (shippingApi.setAvailabilityWindows as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updated);
    const el = mount(shipment({ legs: [leg({ status: 'PENDING' })] }));
    act(() => {
      findButton(el, '+ Add a window').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    setInputValue(findInputs(el, SENDER_LABEL).start, '22:00');
    setInputValue(findInputs(el, SENDER_LABEL).end, '02:00');
    await clickSave(el);
    expect(shippingApi.setAvailabilityWindows).toHaveBeenCalledWith('s1', [{ startTime: '22:00', endTime: '02:00', role: 'SENDER' }]);
    expect(el.textContent).not.toContain('A window needs a start time different from its end time.');
  });
});

describe('AvailabilityWindows — BMPL-288 (locked role)', () => {
  it('a started role renders read-only with its stored window formatted, plus a Clear action — no time inputs', () => {
    const el = mount(
      shipment({
        legs: [leg({ status: 'IN_PROGRESS' })],
        availabilityWindows: [{ id: 'w1', role: 'SENDER', startTime: '09:00', endTime: '17:00' }],
      }),
    );
    expect(() => findInputs(el, SENDER_LABEL)).toThrow();
    expect(el.textContent).toContain('9:00 AM–5:00 PM');
    expect(() => findButton(el, 'Clear')).not.toThrow();
    // No governing RECIPIENT leg here, and SENDER is locked -> no save button at all.
    expect(() => findButton(el, 'Save availability')).toThrow();
  });

  it('a started role with nothing stored shows the "already started" message instead of a Clear button', () => {
    const el = mount(shipment({ legs: [leg({ status: 'IN_PROGRESS' })], availabilityWindows: [] }));
    expect(el.textContent).toContain('The pickup has already started, so this can no longer be set.');
    expect(() => findButton(el, 'Clear')).toThrow();
  });

  it('clearing a locked role submits only the OTHER, still-editable role\'s live rows — never re-submits the locked role, and never drops the other role\'s in-progress edit', async () => {
    const updated = shipment({ id: 'updated' });
    (shippingApi.setAvailabilityWindows as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updated);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    // No DIRECT leg: SENDER is governed by FIRST_MILE (already started, locked),
    // RECIPIENT by LAST_MILE (not started, editable) — the two roles can be in
    // different lock states only this way.
    const s = shipment({
      legs: [leg({ id: 'fm', kind: 'FIRST_MILE', status: 'IN_PROGRESS' }), leg({ id: 'lm', kind: 'LAST_MILE', status: 'PENDING' })],
      availabilityWindows: [{ id: 'w1', role: 'SENDER', startTime: '09:00', endTime: '17:00' }],
    });
    act(() => {
      root!.render(<AvailabilityWindows shipment={s} onUpdated={() => {}} />);
    });
    const el = container;

    act(() => {
      findButton(el, '+ Add a window').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    setInputValue(findInputs(el, RECIPIENT_LABEL).start, '13:00');
    setInputValue(findInputs(el, RECIPIENT_LABEL).end, '16:00');

    await act(async () => {
      findButton(el, 'Clear').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(shippingApi.setAvailabilityWindows).toHaveBeenCalledWith('s1', [{ startTime: '13:00', endTime: '16:00', role: 'RECIPIENT' }]);
  });
});
