// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * TERM-11. Contract read from Pam's own pushed branch
 * (fix/term8-terminal-queue-depart-arrive-collect) -- GET terminal/me,
 * GET terminal/queue (a flat array discriminated by `action`, empty is a
 * valid state), and the five action routes. Covers: no membership (403)
 * reads as an explanation, not an error; an empty queue reads as "caught
 * up", not a failure; DEPART/ARRIVE are one-click with no body; HANDOFF
 * always sends `presentedByAssignedCourier: true` and never a courier id;
 * RELEASE_TO_COURIER sends only a pin; COLLECT sends only a name, never a
 * code field the backend doesn't accept; and no row ever renders a pin
 * anywhere, since the queue payload never contains one.
 */

const HUB = { id: 'hub_1', code: 'BZE', name: 'Belize City Hub', district: 'Belize', city: 'Belize City' };
const WORKSPACE = {
  companyId: 'co_1',
  companyName: 'Tropic Air',
  memberRole: 'OPERATOR',
  locations: [{ locationId: 'loc_1', hub: HUB }],
};

const DEPART_ROW = { action: 'DEPART' as const, legId: 'leg_d', hubId: HUB.id, reference: 'BML-1', parcel: '1 parcel', to: 'San Pedro Hub' };
const ARRIVE_ROW = { action: 'ARRIVE' as const, legId: 'leg_a', hubId: HUB.id, reference: 'BML-2', parcel: '2 parcels', from: 'San Pedro Hub' };
const HANDOFF_ROW = {
  action: 'HANDOFF' as const,
  legId: 'leg_h',
  hubId: HUB.id,
  reference: 'BML-3',
  parcel: '1 parcel',
  from: 'Door collection',
  broughtBy: 'Juan Perez',
  arrived: true,
};
const RELEASE_ROW = {
  action: 'RELEASE_TO_COURIER' as const,
  legId: 'leg_r',
  hubId: HUB.id,
  reference: 'BML-4',
  parcel: '1 parcel',
  courier: null,
};
const COLLECT_ROW = { action: 'COLLECT' as const, shipmentId: 'ship_1', hubId: HUB.id, reference: 'BML-5', parcel: '3 parcels' };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type StubOpts = {
  workspaceStatus?: number;
  workspaceBody?: unknown;
  queueRows?: unknown[];
  actionStatus?: number;
  actionBody?: unknown;
};

function stubFetch(opts: StubOpts = {}) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/api/terminal/me')) {
        return jsonResponse(opts.workspaceStatus ?? 200, opts.workspaceBody ?? WORKSPACE);
      }
      if (url.includes('/api/terminal/queue')) {
        return jsonResponse(200, opts.queueRows ?? []);
      }
      if (method === 'POST') {
        calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
        return jsonResponse(opts.actionStatus ?? 200, opts.actionBody ?? {});
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

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount() {
  const { default: TerminalWorkspacePage } = await import('./page');
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<TerminalWorkspacePage />);
  });
  // Two ticks: the workspace load settles first, which triggers the queue
  // load as a second effect -- one tick is not enough to flush both.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function clickButton(text: string) {
  const btn = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === text)!;
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
  // The handler awaits the POST, then awaits a full queue reload -- two
  // more microtask/timer turns beyond the click dispatch itself.
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
  vi.resetModules();
});

describe('TerminalWorkspacePage (TERM-11)', () => {
  it('reads a 403 as "no membership", not an error', async () => {
    stubFetch({ workspaceStatus: 403, workspaceBody: { message: 'No active terminal company membership.' } });
    await mount();

    expect(container!.textContent).toContain('No active terminal company membership');
    expect(container!.querySelector('[role="alert"]')).toBeNull();
  });

  it('reads an empty queue as caught up, not a failure', async () => {
    stubFetch({ queueRows: [] });
    await mount();

    expect(container!.textContent).toContain('Nothing waiting at your locations');
  });

  it('marks a leg departed with a single click and an empty body', async () => {
    const calls = stubFetch({ queueRows: [DEPART_ROW] });
    await mount();
    await clickButton('Mark departed');

    const call = calls.find((c) => c.url.includes('/depart'));
    expect(call?.body).toEqual({});
  });

  it('confirms arrival with no body at all', async () => {
    const calls = stubFetch({ queueRows: [ARRIVE_ROW] });
    await mount();
    await clickButton('Confirm arrival');

    const call = calls.find((c) => c.url.includes('/arrive'));
    expect(call).toBeDefined();
    expect(call?.body).toBeNull();
  });

  it('submits a handoff with presentedByAssignedCourier, never a courier id, and never renders a pin anywhere', async () => {
    const calls = stubFetch({ queueRows: [HANDOFF_ROW] });
    await mount();

    expect(container!.textContent).not.toMatch(/courier.{0,20}id/i);
    setValue(container!.querySelector('#handoff-pin-leg_h') as HTMLInputElement, '4821');
    setValue(container!.querySelector('#handoff-who-leg_h') as HTMLInputElement, 'Maria Lopez');
    await clickButton('Record handoff');

    const call = calls.find((c) => c.url.includes('/handoff'));
    expect(call?.body).toEqual({ pin: '4821', receivedByName: 'Maria Lopez', presentedByAssignedCourier: true });
  });

  it('submits a release-to-courier with only the pin', async () => {
    const calls = stubFetch({ queueRows: [RELEASE_ROW] });
    await mount();

    setValue(container!.querySelector('#release-pin-leg_r') as HTMLInputElement, '7733');
    await clickButton('Release to courier');

    const call = calls.find((c) => c.url.includes('/release-to-courier'));
    expect(call?.body).toEqual({ pin: '7733' });
  });

  it('submits a collection with only a name -- no code field the backend would reject', async () => {
    const calls = stubFetch({ queueRows: [COLLECT_ROW] });
    await mount();

    setValue(container!.querySelector('#collect-who-ship_1') as HTMLInputElement, 'Ana Cruz');
    await clickButton('Record collection');

    const call = calls.find((c) => c.url.includes('/collect'));
    expect(call?.body).toEqual({ collectedByName: 'Ana Cruz' });
  });

  it('refuses to submit a handoff with no received-by name, without calling the API', async () => {
    const calls = stubFetch({ queueRows: [HANDOFF_ROW] });
    await mount();

    setValue(container!.querySelector('#handoff-pin-leg_h') as HTMLInputElement, '4821');
    await clickButton('Record handoff');

    expect(calls.find((c) => c.url.includes('/handoff'))).toBeUndefined();
    expect(container!.textContent).toContain('Enter the code presented and who is receiving it.');
  });

  it('shows the server refusal inline and removes the row from the queue on the next load', async () => {
    const calls = stubFetch({ queueRows: [RELEASE_ROW], actionStatus: 400, actionBody: { message: 'That code is not right. 2 tries left.' } });
    await mount();

    setValue(container!.querySelector('#release-pin-leg_r') as HTMLInputElement, '0000');
    await clickButton('Release to courier');

    expect(container!.textContent).toContain('That code is not right. 2 tries left.');
    expect(calls.filter((c) => c.url.includes('/release-to-courier'))).toHaveLength(1);
  });

  it('groups a mixed queue by action and shows the hub on each row', async () => {
    stubFetch({ queueRows: [DEPART_ROW, HANDOFF_ROW, COLLECT_ROW] });
    await mount();

    expect(container!.textContent).toContain('Ready to depart (1)');
    expect(container!.textContent).toContain('Hand off to recipient or next leg (1)');
    expect(container!.textContent).toContain('Collection at the counter (1)');
    expect(container!.textContent).not.toContain('Confirm arrival (');
    expect(container!.textContent).toContain('BZE');
  });
});
