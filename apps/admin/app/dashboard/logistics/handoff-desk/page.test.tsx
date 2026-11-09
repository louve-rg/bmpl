// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * TERM-5-UI. Contract read from apps/api/src/shipping/{shipment.service.ts,
 * shipping.controller.ts} and packages/validation/src/shipping.ts on
 * origin/main (5ee782d0) -- see the page's own header comment for the full
 * reasoning. Covers the three-way kind split: LINE_HAUL's reveal staying
 * exactly as it was, FIRST_MILE's reveal becoming an entry field submitted
 * through completeLeg with `presentedByAssignedCourier: true` (never a
 * courier id the browser looked up), and LAST_MILE's new release-to-courier
 * entry (no courier id field at all -- the server derives it unconditionally
 * for that route).
 */

const { default: HandoffDeskPage } = await import('./page');

const HUB = { id: 'hub_1', code: 'BZE', name: 'Belize City Hub', isActive: true };

const FIRST_MILE_LEG = {
  legId: 'leg_fm',
  reference: 'SHP-1001',
  kind: 'FIRST_MILE' as const,
  broughtBy: 'Juan Perez',
  from: 'Door collection',
  parcel: '1 parcel',
  arrived: false,
  departedAt: null,
  arrivedAt: null,
  forRecipient: null,
};

const LINE_HAUL_LEG = {
  legId: 'leg_lh',
  reference: 'SHP-1002',
  kind: 'LINE_HAUL' as const,
  broughtBy: 'Tropic Air',
  from: 'San Pedro Hub',
  parcel: '2 parcels',
  arrived: false,
  departedAt: null,
  arrivedAt: null,
  forRecipient: null,
};

const LAST_MILE_LEG = {
  legId: 'leg_lm',
  reference: 'SHP-1003',
  kind: 'LAST_MILE' as const,
  broughtBy: 'Ana Cruz',
  from: 'Belize City Hub',
  parcel: '1 parcel',
  arrived: true,
  departedAt: null,
  arrivedAt: new Date().toISOString(),
  forRecipient: 'Maria Lopez',
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type StubOpts = {
  rows?: unknown[];
  handoffStatus?: number;
  handoffBody?: unknown;
  releaseStatus?: number;
  releaseBody?: unknown;
};

function stubFetch(opts: StubOpts = {}) {
  const rows = opts.rows ?? [FIRST_MILE_LEG, LINE_HAUL_LEG, LAST_MILE_LEG];
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/api/admin/logistics/hubs') && !url.includes('expected')) return jsonResponse(200, [HUB]);
      if (url.includes(`/api/admin/logistics/hubs/${HUB.id}/expected`)) return jsonResponse(200, rows);
      if (url.includes('/handoff-pin')) {
        return jsonResponse(200, { handoffPin: '5150', handoffPinAttempts: 0, handoffVerificationStatus: 'PENDING' });
      }
      if (url.includes('/handoff') && method === 'POST') {
        calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
        return jsonResponse(opts.handoffStatus ?? 200, opts.handoffBody ?? {});
      }
      if (url.includes('/release-to-courier') && method === 'POST') {
        calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
        return jsonResponse(opts.releaseStatus ?? 200, opts.releaseBody ?? {});
      }
      return jsonResponse(404, { message: 'not mocked: ' + url });
    }),
  );
  return calls;
}

const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;

function setValue(el: HTMLInputElement, value: string) {
  nativeInputValueSetter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<HandoffDeskPage />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe('HandoffDeskPage (TERM-5-UI)', () => {
  it('still offers the reveal button for LINE_HAUL, unchanged', async () => {
    stubFetch();
    await mount();

    const revealButtons = Array.from(container!.querySelectorAll('button')).filter((b) => b.textContent === 'Reveal handoff code');
    expect(revealButtons).toHaveLength(1);
  });

  it('never offers a reveal button for FIRST_MILE -- an entry field replaces it', async () => {
    stubFetch({ rows: [FIRST_MILE_LEG] });
    await mount();

    expect(Array.from(container!.querySelectorAll('button')).some((b) => b.textContent === 'Reveal handoff code')).toBe(false);
    expect(container!.querySelector('#handoff-pin-leg_fm')).not.toBeNull();
    expect(container!.querySelector('#handoff-who-leg_fm')).not.toBeNull();
  });

  it('submits a FIRST_MILE handoff with presentedByAssignedCourier, never a courier id', async () => {
    const calls = stubFetch({ rows: [FIRST_MILE_LEG] });
    await mount();

    const pin = container!.querySelector('#handoff-pin-leg_fm') as HTMLInputElement;
    const who = container!.querySelector('#handoff-who-leg_fm') as HTMLInputElement;
    setValue(pin, '4821');
    setValue(who, 'Front desk');

    const submit = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Record handoff')!;
    await act(async () => {
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    const handoffCall = calls.find((c) => c.url.includes('/handoff'));
    expect(handoffCall?.body).toEqual({ pin: '4821', receivedByName: 'Front desk', presentedByAssignedCourier: true });
  });

  it('refuses to submit a FIRST_MILE handoff with no received-by name, without calling the API', async () => {
    const calls = stubFetch({ rows: [FIRST_MILE_LEG] });
    await mount();

    const pin = container!.querySelector('#handoff-pin-leg_fm') as HTMLInputElement;
    setValue(pin, '4821');

    const submit = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Record handoff')!;
    await act(async () => {
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(calls.find((c) => c.url.includes('/handoff'))).toBeUndefined();
    expect(container!.textContent).toContain('Enter the code the courier presented and who is receiving it.');
  });

  it('shows the server refusal on a wrong or locked-out FIRST_MILE code, same as the old reveal errors', async () => {
    const calls = stubFetch({
      rows: [FIRST_MILE_LEG],
      handoffStatus: 400,
      handoffBody: { message: 'That code is not right. 2 tries left.' },
    });
    await mount();

    setValue(container!.querySelector('#handoff-pin-leg_fm') as HTMLInputElement, '0000');
    setValue(container!.querySelector('#handoff-who-leg_fm') as HTMLInputElement, 'Front desk');
    const submit = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Record handoff')!;
    await act(async () => {
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(calls.find((c) => c.url.includes('/handoff'))).toBeDefined();
    expect(container!.textContent).toContain('That code is not right. 2 tries left.');
  });

  it('offers a release-to-courier entry for LAST_MILE, with no courier-id input anywhere', async () => {
    stubFetch({ rows: [LAST_MILE_LEG] });
    await mount();

    expect(container!.querySelector('#release-pin-leg_lm')).not.toBeNull();
    expect(container!.textContent).not.toMatch(/courier.{0,20}id/i);
  });

  it('submits a LAST_MILE release with only the pin -- no courier id field, the server derives it', async () => {
    const calls = stubFetch({ rows: [LAST_MILE_LEG] });
    await mount();

    setValue(container!.querySelector('#release-pin-leg_lm') as HTMLInputElement, '7733');
    const submit = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Release to courier')!;
    await act(async () => {
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    const releaseCall = calls.find((c) => c.url.includes('/release-to-courier'));
    expect(releaseCall?.body).toEqual({ pin: '7733' });
  });
});
