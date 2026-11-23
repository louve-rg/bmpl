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
 * RELEASE_TO_COURIER sends only a pin; COLLECT sends both the recipient's
 * presented code and a name (TERM-5/TERM-8: the code is never prefetched,
 * displayed or defaulted -- the counter clerk types in what the recipient
 * reads aloud); and no row ever renders a pin anywhere, since the queue
 * payload never contains one.
 */

const HUB = { id: 'hub_1', code: 'BZE', name: 'Belize City Hub', district: 'Belize', city: 'Belize City' };
const HUB_2 = { id: 'hub_2', code: 'SPR', name: 'San Pedro Hub', district: 'Belize', city: 'San Pedro' };
const HUB_3 = { id: 'hub_3', code: 'ORW', name: 'Orange Walk Hub', district: 'Orange Walk', city: 'Orange Walk Town' };
const WORKSPACE = {
  companyId: 'co_1',
  companyName: 'Tropic Air',
  memberRole: 'OPERATOR',
  isTest: false,
  locations: [{ locationId: 'loc_1', hub: HUB }],
};

const DEPART_ROW = {
  action: 'DEPART' as const,
  legId: 'leg_d',
  hubId: HUB.id,
  reference: 'BML-1',
  parcel: '1 parcel',
  to: 'San Pedro Hub',
  isTest: false,
};
const ARRIVE_ROW = {
  action: 'ARRIVE' as const,
  legId: 'leg_a',
  hubId: HUB.id,
  reference: 'BML-2',
  parcel: '2 parcels',
  from: 'San Pedro Hub',
  isTest: false,
};
const HANDOFF_ROW = {
  action: 'HANDOFF' as const,
  legId: 'leg_h',
  hubId: HUB.id,
  reference: 'BML-3',
  parcel: '1 parcel',
  from: 'Door collection',
  broughtBy: 'Juan Perez',
  arrived: true,
  isTest: false,
  kind: 'FIRST_MILE' as const,
  courier: 'Juan Perez',
  locked: false,
};
// MDF-747: a FIRST_MILE leg with no assigned courier -- submitting a code
// here would always 400 server-side (completeLeg's own precheck), so the
// form must not be offered at all.
const HANDOFF_ROW_NO_COURIER = { ...HANDOFF_ROW, legId: 'leg_h2', reference: 'BML-30', broughtBy: 'Carrier', courier: null };
// A LINE_HAUL handoff never has a courier either, but is NOT the same case
// -- completeLeg exempts LINE_HAUL from the guard entirely, so the form
// must still be offered here despite courier also being null.
const HANDOFF_ROW_LINE_HAUL = { ...HANDOFF_ROW, legId: 'leg_h3', reference: 'BML-31', kind: 'LINE_HAUL' as const, courier: null };
// TERM-HANDOFF-LOCK-STRANDS-THE-PARCEL-WITH-NO-UNLOCK: the leg hit EXCEPTION
// (five wrong codes) -- the row must still render, locked, not vanish.
const HANDOFF_ROW_LOCKED = { ...HANDOFF_ROW, legId: 'leg_h4', reference: 'BML-32', locked: true };
const RELEASE_ROW = {
  action: 'RELEASE_TO_COURIER' as const,
  legId: 'leg_r',
  hubId: HUB.id,
  reference: 'BML-4',
  parcel: '1 parcel',
  courier: null,
  isTest: false,
};
const COLLECT_ROW = { action: 'COLLECT' as const, shipmentId: 'ship_1', hubId: HUB.id, reference: 'BML-5', parcel: '3 parcels', isTest: false };

const INBOUND_ROW = {
  legId: 'leg_in1',
  hubId: HUB.id,
  reference: 'BML-20',
  parcel: '1 parcel',
  from: 'San Pedro Hub',
  scheduledArrivalAt: '2026-12-01T10:00:00.000Z',
  departed: false,
  isTest: false,
};

const CUSTODY_ROW = {
  shipmentId: 'ship_30',
  hubId: HUB.id,
  reference: 'BML-30',
  parcel: '1 parcel',
  heldSince: '2026-11-15T09:00:00.000Z',
  isTest: false,
};

const HISTORY_ROW = {
  shipmentId: 'ship_40',
  reference: 'BML-40',
  status: 'DELIVERED',
  parcel: '1 parcel',
  isTest: false,
  createdAt: '2026-11-10T08:00:00.000Z',
  senderName: 'Ana Cruz',
  recipientName: 'Luis Tun',
  touchedHubs: ['Belize City Hub', 'San Pedro Hub'],
};
const HISTORY_ROW_2 = { ...HISTORY_ROW, shipmentId: 'ship_41', reference: 'BML-41' };

const MANAGER_WORKSPACE = { ...WORKSPACE, memberRole: 'MANAGER' };
const STAFF_ROSTER = {
  members: [
    {
      id: 'mem_1',
      userId: 'user_1',
      name: 'Edward Broaster',
      email: 'edward@tropicair.bz',
      memberRole: 'MANAGER',
      status: 'ACTIVE',
      createdAt: '2026-10-01T12:00:00.000Z',
      endedAt: null,
      locations: [{ id: 'loc_1', hub: HUB }],
    },
    {
      id: 'mem_2',
      userId: 'user_2',
      name: 'Rosa Chi',
      email: 'rosa@tropicair.bz',
      memberRole: 'OPERATOR',
      status: 'ENDED',
      createdAt: '2026-09-01T12:00:00.000Z',
      endedAt: '2026-10-15T12:00:00.000Z',
      locations: [],
    },
  ],
  pendingInvites: [
    {
      id: 'inv_1',
      email: 'new-operator@tropicair.bz',
      memberRole: 'OPERATOR',
      expiresAt: '2026-12-01T12:00:00.000Z',
      createdAt: '2026-11-01T12:00:00.000Z',
      locationCount: 1,
    },
  ],
  // TERM-STAFF-UI item 9: every company location, isActive flagged, never
  // pre-filtered -- loc_1 is Edward's own grant (hub_1); loc_2 (hub_2) is
  // active but not yet granted to anyone, for the "grant a location"
  // picker; loc_3 (hub_3) is inactive and must show present-but-
  // unselectable, never vanish.
  locations: [
    { id: 'loc_1', isActive: true, hub: HUB },
    { id: 'loc_2', isActive: true, hub: HUB_2 },
    { id: 'loc_3', isActive: false, hub: HUB_3 },
  ],
};

const LOOKUP_RESULT = {
  shipmentId: 'ship_9',
  reference: 'BML-9',
  status: 'IN_TRANSIT',
  description: 'Spare parts',
  pieces: 2,
  isTest: false,
  senderName: 'Juan Perez',
  recipientName: 'Maria Lopez',
  legs: [
    {
      sequence: 1,
      kind: 'LINE_HAUL',
      status: 'COMPLETED',
      originHub: { id: 'hub_a', name: 'Belize City Hub' },
      destinationHub: { id: 'hub_b', name: 'San Pedro Hub' },
      departedAt: '2026-11-01T10:00:00.000Z',
      arrivedAt: '2026-11-01T14:00:00.000Z',
      completedAt: '2026-11-01T14:05:00.000Z',
    },
  ],
};

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

type StubOpts = {
  // FIN-COUNTS-HISTORY: the caller's own account, from the unrelated,
  // already-public `/me` endpoint -- not `/terminal/me`'s own response,
  // which carries no field naming who's asking. Defaults to a fixed id a
  // test can compare a staff row's own userId against.
  meId?: string;
  meStatus?: number;
  workspaceStatus?: number;
  workspaceBody?: unknown;
  queueRows?: unknown[];
  // What /terminal/queue returns on its SECOND and later call, i.e. after an
  // action has run and the screen reloads the queue. Defaults to queueRows
  // again (the shape every test before MDF-702 step 1 relied on); only the
  // completing-an-action-on-a-filtered-tab test needs this to differ.
  queueRowsAfter?: unknown[];
  // MDF-721: force /terminal/queue itself to fail, independent of
  // queueRows/queueRowsAfter, to prove the Lookup tab doesn't go down with it.
  queueStatus?: number;
  queueErrorBody?: unknown;
  // TERM-QUEUE-OVERFLOW-UI: the real X-BMPL-Queue-Has-More response header
  // value, as a boolean. Absent/false is the default -- most queues fit
  // within every category's cap, so a test that doesn't care about this
  // should see no overflow banner by default.
  queueHasMore?: boolean;
  actionStatus?: number;
  actionBody?: unknown;
  staffStatus?: number;
  staffBody?: unknown;
  lookupStatus?: number;
  lookupBody?: unknown;
  inboundStatus?: number;
  inboundItems?: unknown[];
  inboundHasMore?: boolean;
  inboundErrorBody?: unknown;
  custodyStatus?: number;
  custodyItems?: unknown[];
  custodyHasMore?: boolean;
  custodyErrorBody?: unknown;
  historyStatus?: number;
  historyErrorBody?: unknown;
  historyItems?: unknown[];
  historyNextCursor?: string | null;
  historyMoreItems?: unknown[];
  historyMoreNextCursor?: string | null;
};

function stubFetch(opts: StubOpts = {}) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  let queueCallCount = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/api/terminal/me')) {
        return jsonResponse(opts.workspaceStatus ?? 200, opts.workspaceBody ?? WORKSPACE);
      }
      if (url.endsWith('/api/me')) {
        return jsonResponse(opts.meStatus ?? 200, { id: opts.meId ?? 'user_me' });
      }
      // TERM-STAFF-UI: exact-path + GET only -- the mutation routes below
      // (.../staff/:userId/role, .../locations/:id, .../invites/:id/resend
      // etc.) all share this same "/api/terminal/staff" prefix and must NOT
      // be swallowed by the roster read.
      if (url.endsWith('/api/terminal/staff') && method === 'GET') {
        return jsonResponse(opts.staffStatus ?? 200, opts.staffBody ?? { members: [], pendingInvites: [], locations: [] });
      }
      if (url.includes('/api/terminal/inbound')) {
        // FIN-COUNTS-HISTORY: counted, not just answered -- the refresh-
        // after-action test proves THIS was re-fetched after an unrelated
        // action, which a response-shape assertion alone can't show.
        calls.push({ url, method, body: null });
        if (opts.inboundStatus && opts.inboundStatus !== 200) {
          return jsonResponse(opts.inboundStatus, opts.inboundErrorBody ?? { message: 'Could not load what is inbound.' });
        }
        return jsonResponse(200, { items: opts.inboundItems ?? [], hasMore: opts.inboundHasMore ?? false });
      }
      if (url.includes('/api/terminal/custody')) {
        calls.push({ url, method, body: null });
        if (opts.custodyStatus && opts.custodyStatus !== 200) {
          return jsonResponse(opts.custodyStatus, opts.custodyErrorBody ?? { message: 'Could not load what you are holding.' });
        }
        return jsonResponse(200, { items: opts.custodyItems ?? [], hasMore: opts.custodyHasMore ?? false });
      }
      if (url.includes('/api/terminal/history')) {
        calls.push({ url, method, body: null });
        if (opts.historyStatus && opts.historyStatus !== 200) {
          return jsonResponse(opts.historyStatus, opts.historyErrorBody ?? { message: 'Could not load shipment history.' });
        }
        if (/cursor=/.test(url)) {
          return jsonResponse(200, { items: opts.historyMoreItems ?? [], nextCursor: opts.historyMoreNextCursor ?? null });
        }
        return jsonResponse(200, { items: opts.historyItems ?? [], nextCursor: opts.historyNextCursor ?? null });
      }
      if (url.includes('/api/terminal/shipments/') && method === 'GET') {
        calls.push({ url, method, body: null });
        return jsonResponse(opts.lookupStatus ?? 200, opts.lookupBody ?? {});
      }
      if (url.includes('/api/terminal/queue')) {
        queueCallCount += 1;
        if (opts.queueStatus && opts.queueStatus !== 200) {
          return jsonResponse(opts.queueStatus, opts.queueErrorBody ?? { message: 'Could not load your queue.' });
        }
        const rows = queueCallCount === 1 ? opts.queueRows ?? [] : opts.queueRowsAfter ?? opts.queueRows ?? [];
        return jsonResponse(200, rows, { 'X-BMPL-Queue-Has-More': String(opts.queueHasMore ?? false) });
      }
      if (method === 'POST' || method === 'PATCH' || method === 'DELETE') {
        calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
        return jsonResponse(opts.actionStatus ?? 200, opts.actionBody ?? {});
      }
      return jsonResponse(404, { message: 'not mocked: ' + url });
    }),
  );
  return calls;
}

const nativeSelectValueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
function setSelectValue(el: HTMLSelectElement, value: string) {
  nativeSelectValueSetter.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
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

function findTab(label: string): HTMLButtonElement {
  const tabs = Array.from(container!.querySelectorAll('[role="tab"]')) as HTMLButtonElement[];
  const found = tabs.find((b) => b.textContent?.startsWith(label));
  if (!found) throw new Error(`No tab found starting with "${label}"`);
  return found;
}

// Tab selection is a synchronous setState with no network call, unlike
// clickButton below (which awaits a POST + queue reload).
async function clickTab(label: string) {
  const btn = findTab(label);
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
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

  it('tells the clerk more parcels are waiting than shown, when X-BMPL-Queue-Has-More says so (TERM-QUEUE-OVERFLOW-UI)', async () => {
    stubFetch({ queueRows: [DEPART_ROW], queueHasMore: true });
    await mount();

    expect(container!.textContent).toContain('There are more parcels waiting than the list below shows');
  });

  it('shows no overflow banner when the header says there is nothing more (TERM-QUEUE-OVERFLOW-UI)', async () => {
    stubFetch({ queueRows: [DEPART_ROW], queueHasMore: false });
    await mount();

    expect(container!.textContent).not.toContain('There are more parcels waiting');
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

  it('MDF-747: offers no handoff form for a FIRST_MILE leg with no assigned courier, and says so instead', async () => {
    stubFetch({ queueRows: [HANDOFF_ROW_NO_COURIER] });
    await mount();

    // Not merely visually hidden -- actually absent from the DOM.
    expect(container!.querySelector('#handoff-pin-leg_h2')).toBeNull();
    expect(container!.querySelector('#handoff-who-leg_h2')).toBeNull();
    expect(Array.from(container!.querySelectorAll('button')).some((b) => b.textContent === 'Record handoff')).toBe(false);
    expect(container!.textContent).toContain('This leg has no courier yet.');
  });

  it('MDF-747: a LINE_HAUL leg with no courier is normal -- still offers the handoff form, never gating on courier alone', async () => {
    stubFetch({ queueRows: [HANDOFF_ROW_LINE_HAUL] });
    await mount();

    expect(container!.querySelector('#handoff-pin-leg_h3')).not.toBeNull();
    expect(container!.textContent).not.toContain('This leg has no courier yet.');
  });

  it('still offers the handoff form for a FIRST_MILE leg that does have an assigned courier', async () => {
    stubFetch({ queueRows: [HANDOFF_ROW] });
    await mount();

    expect(container!.querySelector('#handoff-pin-leg_h')).not.toBeNull();
    expect(container!.textContent).not.toContain('This leg has no courier yet.');
  });

  /**
   * TERM-HANDOFF-LOCK-STRANDS-THE-PARCEL-WITH-NO-UNLOCK: the actual defect
   * was the row vanishing from the queue while the terminal still held the
   * parcel. The fix is this row staying put with `locked: true` -- this
   * test proves it renders, says it is locked, and offers no form that
   * would 403 anyway, and does NOT invite retrying the code (even the
   * correct one is refused while locked).
   */
  it('TERM-HANDOFF-LOCK: a locked HANDOFF row stays in the queue, says it is locked, and offers no form', async () => {
    stubFetch({ queueRows: [HANDOFF_ROW_LOCKED] });
    await mount();

    expect(container!.textContent).toContain('BML-32');
    expect(container!.textContent).toContain('Locked');
    expect(container!.textContent).toContain('an administrator must resume this leg');
    expect(container!.textContent).not.toContain('Try the code again');
    expect(container!.querySelector('#handoff-pin-leg_h4')).toBeNull();
    expect(container!.querySelector('#handoff-who-leg_h4')).toBeNull();
    expect(Array.from(container!.querySelectorAll('button')).some((b) => b.textContent === 'Record handoff')).toBe(false);
  });

  it('submits a release-to-courier with only the pin', async () => {
    const calls = stubFetch({ queueRows: [RELEASE_ROW] });
    await mount();

    setValue(container!.querySelector('#release-pin-leg_r') as HTMLInputElement, '7733');
    await clickButton('Release to courier');

    const call = calls.find((c) => c.url.includes('/release-to-courier'));
    expect(call?.body).toEqual({ pin: '7733' });
  });

  it('renders a code input on the collect row, separate from the name field', async () => {
    stubFetch({ queueRows: [COLLECT_ROW] });
    await mount();

    expect(container!.querySelector('#collect-code-ship_1')).not.toBeNull();
    expect(container!.querySelector('#collect-who-ship_1')).not.toBeNull();
  });

  it('submits a collection with both the presented code and the recipient name', async () => {
    const calls = stubFetch({ queueRows: [COLLECT_ROW] });
    await mount();

    setValue(container!.querySelector('#collect-code-ship_1') as HTMLInputElement, '4821');
    setValue(container!.querySelector('#collect-who-ship_1') as HTMLInputElement, 'Ana Cruz');
    await clickButton('Record collection');

    const call = calls.find((c) => c.url.includes('/collect'));
    expect(call?.body).toEqual({ code: '4821', collectedByName: 'Ana Cruz' });
  });

  /**
   * S2-TERM-MOBILE: these three code-presented inputs shared the global
   * `.bmpl-input` text-sm (14px) with no override. iOS Safari zooms the
   * whole page in on focusing a <16px input -- known iOS behaviour, not
   * something jsdom can observe directly -- so a staff member tapping the
   * code field at a terminal counter got the page jump under them. Locks
   * in the text-base (16px) override on all three; jsdom cannot assert the
   * zoom itself doesn't fire, only that the class causing it is gone.
   */
  it('renders the handoff, release and collect code inputs at a 16px (text-base) minimum, not the 14px default', async () => {
    stubFetch({ queueRows: [HANDOFF_ROW, RELEASE_ROW, COLLECT_ROW] });
    await mount();

    const handoffPin = container!.querySelector('#handoff-pin-leg_h') as HTMLInputElement;
    const releasePin = container!.querySelector('#release-pin-leg_r') as HTMLInputElement;
    const collectCode = container!.querySelector('#collect-code-ship_1') as HTMLInputElement;
    for (const input of [handoffPin, releasePin, collectCode]) {
      expect(input.className).toContain('text-base');
    }
  });

  it('refuses to submit a collection with no code, without calling the API', async () => {
    const calls = stubFetch({ queueRows: [COLLECT_ROW] });
    await mount();

    setValue(container!.querySelector('#collect-who-ship_1') as HTMLInputElement, 'Ana Cruz');
    await clickButton('Record collection');

    expect(calls.find((c) => c.url.includes('/collect'))).toBeUndefined();
    expect(container!.textContent).toContain('Enter the 4-8 digit collection code the recipient presents.');
  });

  it('refuses to submit a collection with a malformed code, without calling the API', async () => {
    const calls = stubFetch({ queueRows: [COLLECT_ROW] });
    await mount();

    setValue(container!.querySelector('#collect-code-ship_1') as HTMLInputElement, 'abc');
    setValue(container!.querySelector('#collect-who-ship_1') as HTMLInputElement, 'Ana Cruz');
    await clickButton('Record collection');

    expect(calls.find((c) => c.url.includes('/collect'))).toBeUndefined();
    expect(container!.textContent).toContain('Enter the 4-8 digit collection code the recipient presents.');
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

  /**
   * FIN-COUNTS-HISTORY / FIN-HIST-LAG: before this fix, every one of the
   * five queue actions refreshed ONLY /terminal/queue -- Incoming, On Hand
   * and History (Stanley's "arrived at terminal, History still says IN
   * TRANSIT" finding) went stale with no visible signal until their own tab
   * was separately refreshed. A test that only checks the acting tab's own
   * view updated (every test above this one) cannot catch that -- it has to
   * count calls to the OTHER three endpoints.
   */
  it('refetches Incoming, On Hand and History (once a MANAGER has opened it), not only the queue, after any action', async () => {
    const calls = stubFetch({
      workspaceBody: MANAGER_WORKSPACE,
      queueRows: [COLLECT_ROW],
      inboundItems: [],
      custodyItems: [],
      historyItems: [{ shipmentId: 's1', reference: 'BML-1', status: 'IN_TRANSIT', parcel: '1 parcel', isTest: false, createdAt: '2026-11-01T00:00:00.000Z', senderName: 'A', recipientName: 'B', touchedHubs: [] }],
    });
    await mount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    // History is lazy -- only loaded once its own tab is opened at least
    // once. Open it before the action so the refresh has something to do.
    await clickTab('History');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await clickTab('Collect');

    const inboundCallsBefore = calls.filter((c) => c.url.includes('/terminal/inbound')).length;
    const custodyCallsBefore = calls.filter((c) => c.url.includes('/terminal/custody')).length;
    const historyCallsBefore = calls.filter((c) => c.url.includes('/terminal/history')).length;

    setValue(container!.querySelector('#collect-code-ship_1') as HTMLInputElement, '4821');
    setValue(container!.querySelector('#collect-who-ship_1') as HTMLInputElement, 'Ana Cruz');
    await clickButton('Record collection');

    expect(calls.filter((c) => c.url.includes('/terminal/inbound')).length).toBeGreaterThan(inboundCallsBefore);
    expect(calls.filter((c) => c.url.includes('/terminal/custody')).length).toBeGreaterThan(custodyCallsBefore);
    expect(calls.filter((c) => c.url.includes('/terminal/history')).length).toBeGreaterThan(historyCallsBefore);
  });

  it('does not refetch History after an action when no MANAGER has ever opened that tab -- nothing to refresh, nothing wasted', async () => {
    const calls = stubFetch({ queueRows: [COLLECT_ROW] });
    await mount();

    setValue(container!.querySelector('#collect-code-ship_1') as HTMLInputElement, '4821');
    setValue(container!.querySelector('#collect-who-ship_1') as HTMLInputElement, 'Ana Cruz');
    await clickButton('Record collection');

    expect(calls.some((c) => c.url.includes('/terminal/history'))).toBe(false);
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

  // MDF-702 step 1: dashboard figures + navigation. The tab bar is both --
  // its badges are the real counts, and selecting one is the only new
  // navigation this step adds.
  describe('MDF-702 step 1 — tabs are both the dashboard figures and the navigation', () => {
    it('shows Overview plus one tab per action, each badged with the real count from the queue -- nothing invented', async () => {
      stubFetch({ queueRows: [DEPART_ROW, HANDOFF_ROW, COLLECT_ROW] });
      await mount();

      expect(findTab('Overview').textContent).toBe('Overview3');
      expect(findTab('Overview').getAttribute('aria-selected')).toBe('true');
      expect(findTab('Depart').textContent).toBe('Depart1');
      expect(findTab('Hand off').textContent).toBe('Hand off1');
      expect(findTab('Collect').textContent).toBe('Collect1');
      // Zero-count tabs render with no badge at all, not a "0".
      expect(findTab('Arrive').textContent).toBe('Arrive');
      expect(findTab('Release').textContent).toBe('Release');
    });

    it('selecting a single-action tab filters to only that section', async () => {
      stubFetch({ queueRows: [DEPART_ROW, HANDOFF_ROW, COLLECT_ROW] });
      await mount();
      await clickTab('Depart');

      expect(findTab('Depart').getAttribute('aria-selected')).toBe('true');
      expect(container!.textContent).toContain('Ready to depart (1)');
      expect(container!.textContent).not.toContain('Hand off to recipient or next leg');
      expect(container!.textContent).not.toContain('Collection at the counter');
    });

    it('returns to the full mixed view when Overview is reselected', async () => {
      stubFetch({ queueRows: [DEPART_ROW, HANDOFF_ROW, COLLECT_ROW] });
      await mount();
      await clickTab('Collect');
      await clickTab('Overview');

      expect(container!.textContent).toContain('Ready to depart (1)');
      expect(container!.textContent).toContain('Hand off to recipient or next leg (1)');
      expect(container!.textContent).toContain('Collection at the counter (1)');
    });

    it('a tab with nothing in it shows its own empty state, distinct from the "nothing waiting at all" one', async () => {
      stubFetch({ queueRows: [DEPART_ROW] });
      await mount();
      await clickTab('Arrive');

      expect(container!.textContent).toContain('Nothing to arrive right now');
      expect(container!.textContent).not.toContain('Nothing waiting at your locations');
    });

    it('states the real total waiting-item count in the header, singular and plural', async () => {
      stubFetch({ queueRows: [DEPART_ROW, HANDOFF_ROW, COLLECT_ROW] });
      await mount();
      expect(container!.textContent).toContain('3 items waiting on you');
    });

    it('states "0 items waiting" rather than omitting the figure when the queue is empty', async () => {
      stubFetch({ queueRows: [] });
      await mount();
      expect(container!.textContent).toContain('0 items waiting on you');
    });

    it('completing the only action anywhere drains the queue to the global caught-up state, even while a single-action tab is selected', async () => {
      const calls = stubFetch({ queueRows: [DEPART_ROW], queueRowsAfter: [] });
      await mount();
      await clickTab('Depart');
      await clickButton('Mark departed');

      expect(calls.find((c) => c.url.includes('/depart'))).toBeDefined();
      // The whole queue is empty now, not just this tab's section -- the
      // global "caught up" state is the more honest one to show, and it
      // takes priority over a per-tab empty state regardless of which tab
      // happens to be selected.
      expect(container!.textContent).toContain('Nothing waiting at your locations');
    });

    it('completing one action while another section still has work shows that tab\'s own empty state, not the global one', async () => {
      const calls = stubFetch({ queueRows: [DEPART_ROW, ARRIVE_ROW], queueRowsAfter: [ARRIVE_ROW] });
      await mount();
      await clickTab('Depart');
      await clickButton('Mark departed');

      expect(calls.find((c) => c.url.includes('/depart'))).toBeDefined();
      expect(container!.textContent).toContain('Nothing to depart right now');
      expect(container!.textContent).not.toContain('Nothing waiting at your locations');
    });
  });

  // MDF-702: the MANAGER-only Staff tab consuming GET /terminal/staff
  // (Pam's #683, MDF-698) -- the one capability that makes the MANAGER/
  // OPERATOR split real rather than cosmetic.
  describe('MDF-702 — the MANAGER-only Staff tab', () => {
    it('never renders a Staff tab for an OPERATOR, and never calls /terminal/staff', async () => {
      const calls: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          calls.push(url);
          if (url.includes('/api/terminal/me')) return jsonResponse(200, WORKSPACE);
          if (url.includes('/api/terminal/queue')) return jsonResponse(200, []);
          return jsonResponse(404, { message: 'not mocked: ' + url });
        }),
      );
      await mount();

      expect(() => findTab('Staff')).toThrow();
      expect(calls.some((u) => u.includes('/terminal/staff'))).toBe(false);
    });

    it('shows a Staff tab for a MANAGER, badged with the ACTIVE member count, not the roster total', async () => {
      // STAFF_ROSTER is 1 ACTIVE + 1 ENDED -- the badge means "how many are
      // on my counter right now", same as every other badge on this tab bar.
      stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], staffBody: STAFF_ROSTER });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(findTab('Staff').textContent).toBe('Staff1');
    });

    it('does not count ENDED members in the Staff tab badge, even when they outnumber ACTIVE ones', async () => {
      stubFetch({
        workspaceBody: MANAGER_WORKSPACE,
        queueRows: [],
        staffBody: {
          members: [
            { ...STAFF_ROSTER.members[0], id: 'mem_a1', status: 'ACTIVE' },
            { ...STAFF_ROSTER.members[0], id: 'mem_a2', status: 'ACTIVE' },
            { ...STAFF_ROSTER.members[1], id: 'mem_e1', status: 'ENDED' },
            { ...STAFF_ROSTER.members[1], id: 'mem_e2', status: 'ENDED' },
            { ...STAFF_ROSTER.members[1], id: 'mem_e3', status: 'ENDED' },
          ],
          pendingInvites: [],
          locations: [],
        },
      });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      // 2 ACTIVE, 3 ENDED -- the badge must read the active count (2), not
      // the roster total (5). The panel itself still lists all five; that
      // part is unchanged and verified by the test above.
      expect(findTab('Staff').textContent).toBe('Staff2');

      await clickTab('Staff');
      expect(container!.textContent).toContain('ACTIVE');
      expect(container!.textContent).toContain('ENDED');

      // FIN-COUNTS: Stanley saw "Staff 2" on this exact badge beside
      // "Members (5)" on this exact panel and read it as a contradiction.
      // Both numbers stay as they are -- the heading just has to say what
      // it's counting.
      expect(container!.textContent).toContain('Members (5)');
      expect(container!.textContent).toContain('includes 3 whose access has ended');
    });

    it('does not add the ended-members note to the Members heading when every member is ACTIVE -- nothing to explain', async () => {
      stubFetch({
        workspaceBody: MANAGER_WORKSPACE,
        queueRows: [],
        staffBody: { members: [{ ...STAFF_ROSTER.members[0] }], pendingInvites: [], locations: [] },
      });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(container!.textContent).toContain('Members (1)');
      expect(container!.textContent).not.toContain('whose access has ended');
    });

    it("renders each member's name, email, role and status, and each pending invite's email, role, location count and expiry -- never a token", async () => {
      stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], staffBody: STAFF_ROSTER });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');

      expect(container!.textContent).toContain('Edward Broaster');
      expect(container!.textContent).toContain('edward@tropicair.bz');
      expect(container!.textContent).toContain('Rosa Chi');
      expect(container!.textContent).toContain('ENDED');
      expect(container!.textContent).toContain('new-operator@tropicair.bz');
      expect(container!.textContent).toContain('1 location');
      expect(container!.textContent?.toLowerCase()).not.toContain('token');
    });

    // TERM-STAFF-UI superseded this screen's old read-only characterization
    // (the controls below did not exist before) -- see the dedicated
    // "TERM-STAFF-UI" describe block below for the actual mutation behavior.
    it('offers the self-service controls the owner approved: role change, end membership, reactivate, revoke location, invite resend/revoke', async () => {
      stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], staffBody: STAFF_ROSTER });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');

      const buttonTexts = Array.from(container!.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '');
      expect(buttonTexts).toContain('Set as operator'); // Edward is an ACTIVE MANAGER
      expect(buttonTexts).toContain('End membership');
      expect(buttonTexts).toContain('Reactivate'); // Rosa is ENDED
      expect(buttonTexts).toContain('Resend');
      expect(buttonTexts).toContain('Revoke');
      expect(container!.querySelector('button[aria-label="Remove Edward Broaster\'s access to Belize City Hub"]')).not.toBeNull();
    });

    it('shows an honest empty state when a manager has no staff yet, and still offers the invite form', async () => {
      stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], staffBody: { members: [], pendingInvites: [], locations: [] } });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');

      expect(container!.textContent).toContain('No staff yet');
      expect(container!.textContent).toContain('No pending invites.');

      // TERM-STAFF-UI: MDF-740's old copy pointed a Manager at the admin
      // console because this screen had no invite control at all -- it does
      // now, so the empty state must say so instead, and the form itself
      // must actually be present (not promised and missing).
      expect(container!.textContent).toContain('Invite your first employee below.');
      expect(container!.textContent).not.toContain('A BML administrator adds terminal staff from the admin console.');
      expect(container!.querySelector('#staff-invite-email')).not.toBeNull();
    });

    it('does not let the global "nothing waiting" state cover the Staff tab', async () => {
      stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], staffBody: STAFF_ROSTER });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');

      expect(container!.textContent).not.toContain('Nothing waiting at your locations');
    });

    it('surfaces a real refusal if /terminal/staff fails, with a retry', async () => {
      stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], staffStatus: 403, staffBody: { message: 'This action requires the terminal manager role.' } });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');

      expect(container!.textContent).toContain('This action requires the terminal manager role.');
      expect(Array.from(container!.querySelectorAll('button')).some((b) => b.textContent === 'Try again')).toBe(true);
    });
  });

  // TERM-STAFF-UI: the owner-approved self-service controls on the Staff
  // tab -- role change (a manager may appoint managers), end/reactivate
  // membership, revoke one location grant, and resend/revoke a pending
  // invite. Every refusal renders the server's own message verbatim --
  // these tests assert that, never a client-paraphrased string, matching
  // the owner's explicit rule that the API proves the boundary.
  describe('TERM-STAFF-UI — staff self-service: role change, membership, location grants, invite control', () => {
    /**
     * FIN-SELF-LOCKOUT (corrected by god after Pam read the admin
     * endpoints): the two notes say DIFFERENT true things, not one shared
     * sentence. endMember/reactivateMember never write memberRole, so no
     * admin-console endpoint can change a role at all today -- the
     * role-change note names no administrator, only another manager. Ending
     * a membership genuinely does have an admin door, so that note names
     * one. Naming an administrator next to role-change would promise a
     * capability that exists nowhere in the product -- the owner's
     * no-dead-buttons rule expressed in text instead of a disabled button.
     * `meId` matches STAFF_ROSTER.members[0].userId ('user_1') -- everything
     * else about Edward's own row (badges, locations) is untouched; only
     * the two destructive/role controls are gone.
     */
    it("replaces End membership and the role-change control with two different notes -- only ending a membership names an administrator", async () => {
      stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], staffBody: STAFF_ROSTER, meId: 'user_1' });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(Array.from(container!.querySelectorAll('button')).some((b) => b.textContent === 'Set as operator')).toBe(false);
      expect(Array.from(container!.querySelectorAll('button')).some((b) => b.textContent === 'End membership')).toBe(false);
      expect(container!.textContent).toContain('You cannot change your own role from manager to operator. Another manager can do this for you.');
      expect(container!.textContent).toContain(
        'You cannot end your own terminal company membership. Another manager, or an administrator, can do this for you.',
      );
    });

    it("still offers End membership and the role-change control on a DIFFERENT manager's row, not just the signed-in one's own", async () => {
      stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], staffBody: STAFF_ROSTER, meId: 'someone_else' });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(Array.from(container!.querySelectorAll('button')).some((b) => b.textContent === 'Set as operator')).toBe(true);
      expect(Array.from(container!.querySelectorAll('button')).some((b) => b.textContent === 'End membership')).toBe(true);
      expect(container!.textContent).not.toContain('You cannot change your own role');
      expect(container!.textContent).not.toContain('You cannot end your own terminal company membership');
    });

    /**
     * FIN-SELF-LOCKOUT: the asymmetry is the whole point of god's
     * correction -- an administrator must never be named near the
     * role-change note, because no admin-console endpoint can change a
     * role at all today (Pam's finding). Asserted on its own, not just as
     * part of the combined note test above, so a future edit that
     * re-merges the two notes back into one shared sentence fails here
     * specifically.
     */
    // The only admin-console route to a role change is end-membership plus a fresh invite
    // at the new role. acceptInvite reuses the existing member row and upserts the invite's
    // location grants rather than deleting any -- so the member row and their location
    // access survive -- but it still requires the person to accept an invitation
    // themselves, as someone who is not a member in between. "An administrator can change
    // your role" would imply the administrator does it directly, which is not what happens.
    // That is why no administrator is named here -- do not restore the word.
    it('never mentions an administrator in the role-change note -- no admin endpoint can change a role today', async () => {
      stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], staffBody: STAFF_ROSTER, meId: 'user_1' });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      const roleNote = Array.from(container!.querySelectorAll('span')).find((s) =>
        s.textContent?.includes('You cannot change your own role'),
      );
      expect(roleNote).toBeDefined();
      expect(roleNote!.textContent).not.toContain('administrator');
    });

    it('appoints an ACTIVE operator as manager with one PATCH, body { memberRole: "MANAGER" }', async () => {
      const calls = stubFetch({
        workspaceBody: MANAGER_WORKSPACE,
        queueRows: [],
        staffBody: { members: [{ ...STAFF_ROSTER.members[0], memberRole: 'OPERATOR' }], pendingInvites: [], locations: [] },
      });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');
      await clickButton('Appoint as manager');

      const call = calls.find((c) => c.url.includes('/terminal/staff/user_1/role') && c.method === 'PATCH');
      expect(call?.body).toEqual({ memberRole: 'MANAGER' });
    });

    it('demotes an ACTIVE manager to operator with one PATCH, body { memberRole: "OPERATOR" } -- never end-then-reinvite', async () => {
      const calls = stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], staffBody: STAFF_ROSTER });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');
      await clickButton('Set as operator');

      const call = calls.find((c) => c.url.includes('/terminal/staff/user_1/role') && c.method === 'PATCH');
      expect(call?.body).toEqual({ memberRole: 'OPERATOR' });
      expect(calls.some((c) => c.method === 'DELETE')).toBe(false); // no end-membership side effect
    });

    it('renders the server\'s own last-active-manager refusal verbatim on a role change, never a paraphrase or a pre-emptive disable', async () => {
      stubFetch({
        workspaceBody: MANAGER_WORKSPACE,
        queueRows: [],
        staffBody: STAFF_ROSTER,
        actionStatus: 409,
        actionBody: { message: 'This company must always have at least one active manager.' },
      });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');

      // Not pre-emptively disabled -- the owner's rule is that the API
      // proves the boundary, not a disabled control hiding it.
      const button = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Set as operator') as HTMLButtonElement;
      expect(button.disabled).toBe(false);

      await clickButton('Set as operator');
      expect(container!.textContent).toContain('This company must always have at least one active manager.');
      // TERM-STAFF-390: anchored near the role/end/reactivate row it came
      // from, not down by the locations section -- a manager who clicked
      // "Set as operator" should not have to guess which control a refusal
      // under the card refers to.
      const text = container!.textContent!;
      expect(text.indexOf('This company must always have at least one active manager.')).toBeLessThan(text.indexOf('Granted at:'));
    });

    it('ends an ACTIVE membership with one POST and an empty body', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const calls = stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], staffBody: STAFF_ROSTER });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');
      await clickButton('End membership');

      const call = calls.find((c) => c.url.includes('/terminal/staff/user_1/deactivate'));
      expect(call?.body).toEqual({});
      vi.restoreAllMocks();
    });

    it("asks for confirmation before ending a membership, naming the person and what stops -- the owner's required fix for the one control that had none", async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const calls = stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], staffBody: STAFF_ROSTER });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');
      await clickButton('End membership');

      expect(confirmSpy).toHaveBeenCalledWith("End Edward Broaster's membership? They will no longer be able to work here until you reactivate them.");
      expect(calls.find((c) => c.url.includes('/terminal/staff/user_1/deactivate'))).toBeUndefined();
      vi.restoreAllMocks();
    });

    it('renders the last-active-manager refusal verbatim on End membership too, same text as the role-change refusal', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      stubFetch({
        workspaceBody: MANAGER_WORKSPACE,
        queueRows: [],
        staffBody: STAFF_ROSTER,
        actionStatus: 409,
        actionBody: { message: 'This company must always have at least one active manager.' },
      });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');
      await clickButton('End membership');

      expect(container!.textContent).toContain('This company must always have at least one active manager.');
      vi.restoreAllMocks();
    });

    // Revoking the company's only manager's last location refuses with its
    // OWN distinct text, never the membership/role refusal above -- that
    // write touches neither membership nor role, so it gets its own 409.
    it("renders the distinct last-location-of-the-only-manager refusal verbatim, never the manager-count text", async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      stubFetch({
        workspaceBody: MANAGER_WORKSPACE,
        queueRows: [],
        staffBody: STAFF_ROSTER,
        actionStatus: 409,
        // Verbatim as relayed -- not re-punctuated.
        actionBody: { message: 'This would leave the companys only manager without access to any location.' },
      });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');

      const revokeBtn = container!.querySelector('button[aria-label="Remove Edward Broaster\'s access to Belize City Hub"]') as HTMLButtonElement;
      await act(async () => {
        revokeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 0));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(container!.textContent).toContain('This would leave the companys only manager without access to any location.');
      expect(container!.textContent).not.toContain('This company must always have at least one active manager.');
      vi.restoreAllMocks();
    });

    it('reactivates an ENDED membership with one POST', async () => {
      const calls = stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], staffBody: STAFF_ROSTER });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');
      await clickButton('Reactivate');

      const call = calls.find((c) => c.url.includes('/terminal/staff/user_2/reactivate'));
      expect(call).toBeDefined();
    });

    it('confirms before revoking a location grant, naming both the member and the hub -- and does nothing if cancelled', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const calls = stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], staffBody: STAFF_ROSTER });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');

      const revokeBtn = container!.querySelector('button[aria-label="Remove Edward Broaster\'s access to Belize City Hub"]') as HTMLButtonElement;
      await act(async () => {
        revokeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(confirmSpy).toHaveBeenCalledWith("Remove Edward Broaster's access to Belize City Hub? They will no longer be able to work there.");
      expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
      confirmSpy.mockRestore();
    });

    it('revokes a location grant by DELETE .../locations/:locationId once confirmed', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const calls = stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], staffBody: STAFF_ROSTER });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');

      const revokeBtn = container!.querySelector('button[aria-label="Remove Edward Broaster\'s access to Belize City Hub"]') as HTMLButtonElement;
      await act(async () => {
        revokeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 0));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('/terminal/staff/user_1/locations/loc_1'))).toBe(true);
      vi.restoreAllMocks();
    });

    it('the copy next to a location revoke control never blurs it with removing the member', async () => {
      stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], staffBody: STAFF_ROSTER });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');

      expect(container!.textContent).toContain('Removing a location only ends access to that location -- it never ends a membership or changes a role.');
    });

    it('resends a pending invite and shows the delivery outcome, same shape/rendering as the admin console', async () => {
      const calls = stubFetch({
        workspaceBody: MANAGER_WORKSPACE,
        queueRows: [],
        staffBody: STAFF_ROSTER,
        // id matches the real API shape (resendInvite returns
        // {...serializeInvite(updated), delivery}) -- the stale-banner fix
        // (TERM-STAFF-390) keys the banner to this id against
        // staff.pendingInvites, so a fixture missing it would silently hide
        // the banner rather than exercise the real path.
        actionBody: { id: 'inv_1', delivery: { delivered: true, outcome: 'accepted' } },
      });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');
      await clickButton('Resend');

      expect(calls.some((c) => c.url.includes('/terminal/staff/invites/inv_1/resend') && c.method === 'POST')).toBe(true);
      expect(container!.textContent).toContain('Invitation resent and the email was accepted by the provider.');
    });

    it('surfaces an undelivered resend honestly -- the invite is still valid, never "start again"', async () => {
      stubFetch({
        workspaceBody: MANAGER_WORKSPACE,
        queueRows: [],
        staffBody: STAFF_ROSTER,
        actionBody: { id: 'inv_1', delivery: { delivered: false, outcome: 'provider_error' } },
      });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');
      await clickButton('Resend');

      expect(container!.textContent).toContain('the email provider rejected or failed the send');
      expect(container!.textContent).toContain('The invite is still valid: use Resend below.');
    });

    /**
     * RESEND-BANNER-COPY: Stanley found a resend saying "Invitation created"
     * -- true of nothing, since a resend creates no invitation. This locks
     * the two paths to different verbs so they can't drift back to sharing
     * one string.
     */
    it('says "resent", never "created", after a resend -- nothing was created', async () => {
      stubFetch({
        workspaceBody: MANAGER_WORKSPACE,
        queueRows: [],
        staffBody: STAFF_ROSTER,
        actionBody: { id: 'inv_1', delivery: { delivered: true, outcome: 'accepted' } },
      });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');
      await clickButton('Resend');

      expect(container!.textContent).toContain('Invitation resent');
      expect(container!.textContent).not.toContain('Invitation created');
    });

    it('revokes a pending invite with one POST', async () => {
      const calls = stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], staffBody: STAFF_ROSTER });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');
      await clickButton('Revoke');

      expect(calls.some((c) => c.url.includes('/terminal/staff/invites/inv_1/revoke') && c.method === 'POST')).toBe(true);
    });

    /**
     * TERM-STAFF-390: Stanley's production finding -- the resend-delivery
     * banner is keyed to one invite (inv_1) and must stop asserting
     * anything about it once a revoke makes that invite gone, even though
     * the revoke happened in the same component's own data, not through any
     * explicit "clear the banner" call on revoke(). The fix ties the
     * banner's visibility to staff.pendingInvites still containing the id,
     * refetched fresh on every onChanged() -- so this test controls what
     * that refetch returns across calls, the same way the queue-retry test
     * above does, rather than relying on the static stubFetch default.
     */
    it('clears the resend-delivery banner once that same invite is revoked -- it must not keep asserting a stale outcome', async () => {
      let staffGetCount = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          const method = init?.method ?? 'GET';
          if (url.includes('/api/terminal/me')) return jsonResponse(200, MANAGER_WORKSPACE);
          if (url.endsWith('/api/terminal/staff') && method === 'GET') {
            staffGetCount += 1;
            // After the revoke's own onChanged() refetch (3rd GET: mount,
            // post-resend, post-revoke), the invite is gone.
            const pendingInvites = staffGetCount >= 3 ? [] : STAFF_ROSTER.pendingInvites;
            return jsonResponse(200, { ...STAFF_ROSTER, pendingInvites });
          }
          if (url.includes('/api/terminal/queue')) return jsonResponse(200, [], { 'X-BMPL-Queue-Has-More': 'false' });
          if (url.includes('/terminal/staff/invites/inv_1/resend') && method === 'POST') {
            return jsonResponse(200, { id: 'inv_1', delivery: { delivered: true, outcome: 'accepted' } });
          }
          if (url.includes('/terminal/staff/invites/inv_1/revoke') && method === 'POST') {
            return jsonResponse(200, { revoked: true });
          }
          return jsonResponse(404, { message: 'not mocked: ' + url });
        }),
      );
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');
      await clickButton('Resend');

      expect(container!.textContent).toContain('Invitation resent and the email was accepted by the provider.');

      await clickButton('Revoke');

      expect(container!.textContent).not.toContain('Invitation resent and the email was accepted by the provider.');
      expect(container!.textContent).toContain('No pending invites.');
    });

    it('shows every company location in the invite checklist, including an inactive one marked unselectable, never vanished', async () => {
      stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], staffBody: STAFF_ROSTER });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');

      expect(container!.textContent).toContain('San Pedro Hub');
      expect(container!.textContent).toContain('Orange Walk Hub');
      expect(container!.textContent).toContain('-- inactive');

      const checkboxes = Array.from(container!.querySelectorAll('#staff-invite-locations input[type="checkbox"]')) as HTMLInputElement[];
      const inactiveCheckbox = checkboxes.find((c) => c.closest('label')?.textContent?.includes('Orange Walk Hub'));
      expect(inactiveCheckbox).toBeDefined();
      expect(inactiveCheckbox!.disabled).toBe(true);
    });

    it('sends an invite with the picked active locations, body { email, memberRole, locationIds }', async () => {
      const calls = stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], staffBody: STAFF_ROSTER });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');

      act(() => {
        setValue(container!.querySelector('#staff-invite-email') as HTMLInputElement, 'new-hire@tropicair.bz');
        setSelectValue(container!.querySelector('#staff-invite-role') as HTMLSelectElement, 'MANAGER');
      });
      const checkbox = Array.from(container!.querySelectorAll('#staff-invite-locations input[type="checkbox"]')).find((c) =>
        (c as HTMLInputElement).closest('label')?.textContent?.includes('San Pedro Hub'),
      ) as HTMLInputElement;
      await act(async () => {
        checkbox.click();
      });
      await clickButton('Send invite');

      const call = calls.find((c) => c.url.endsWith('/terminal/staff/invite') && c.method === 'POST');
      expect(call?.body).toEqual({ email: 'new-hire@tropicair.bz', memberRole: 'MANAGER', locationIds: ['loc_2'] });
    });

    /**
     * TERM-STAFF-390: the same stale-banner bug Stanley found, but crossing
     * components -- the "Invitation created" banner lives in
     * StaffMembersSection's own invite form, while Revoke lives in the
     * sibling StaffPendingInvitesSection below. Neither component has any
     * direct reference to the other; the only thing they share is the
     * `staff` prop, refetched by the SAME onChanged() every mutation on the
     * tab calls -- which is exactly what the fix leans on instead of
     * reaching across components.
     */
    it("clears the invite-creation banner once that invite is revoked from the sibling Pending Invites list -- god's cross-component finding", async () => {
      let staffGetCount = 0;
      const noInvitesYet = { ...STAFF_ROSTER, pendingInvites: [] as typeof STAFF_ROSTER.pendingInvites };
      const oneNewInvite = {
        ...STAFF_ROSTER,
        pendingInvites: [{ id: 'inv_new', email: 'new-hire@tropicair.bz', memberRole: 'MANAGER', expiresAt: '2026-12-01T12:00:00.000Z', createdAt: '2026-11-18T12:00:00.000Z', locationCount: 1 }],
      };
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          const method = init?.method ?? 'GET';
          if (url.includes('/api/terminal/me')) return jsonResponse(200, MANAGER_WORKSPACE);
          if (url.endsWith('/api/terminal/staff') && method === 'GET') {
            staffGetCount += 1;
            // 1st GET (mount): no pending invites. 2nd (post-create): the
            // new one appears. 3rd (post-revoke): gone again.
            return jsonResponse(200, staffGetCount === 1 ? noInvitesYet : staffGetCount === 2 ? oneNewInvite : noInvitesYet);
          }
          if (url.includes('/api/terminal/queue')) return jsonResponse(200, [], { 'X-BMPL-Queue-Has-More': 'false' });
          if (url.endsWith('/terminal/staff/invite') && method === 'POST') {
            return jsonResponse(200, { id: 'inv_new', delivery: { delivered: true, outcome: 'accepted' } });
          }
          if (url.includes('/terminal/staff/invites/inv_new/revoke') && method === 'POST') {
            return jsonResponse(200, { revoked: true });
          }
          return jsonResponse(404, { message: 'not mocked: ' + url });
        }),
      );
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');

      act(() => {
        setValue(container!.querySelector('#staff-invite-email') as HTMLInputElement, 'new-hire@tropicair.bz');
        setSelectValue(container!.querySelector('#staff-invite-role') as HTMLSelectElement, 'MANAGER');
      });
      const checkbox = Array.from(container!.querySelectorAll('#staff-invite-locations input[type="checkbox"]')).find((c) =>
        (c as HTMLInputElement).closest('label')?.textContent?.includes('San Pedro Hub'),
      ) as HTMLInputElement;
      await act(async () => {
        checkbox.click();
      });
      await clickButton('Send invite');

      expect(container!.textContent).toContain('Invitation created and the email was accepted by the provider.');

      await clickButton('Revoke');

      expect(container!.textContent).not.toContain('Invitation created and the email was accepted by the provider.');
    });

    it('refuses to send an invite with no location picked, before any request -- there is no whole-company grant', async () => {
      const calls = stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], staffBody: STAFF_ROSTER });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');

      act(() => {
        setValue(container!.querySelector('#staff-invite-email') as HTMLInputElement, 'new-hire@tropicair.bz');
      });
      await clickButton('Send invite');

      expect(container!.textContent).toContain('Select at least one location -- there is no whole-company grant.');
      expect(calls.some((c) => c.url.endsWith('/terminal/staff/invite'))).toBe(false);
    });

    it('grants an existing ACTIVE member a new location via the picker, body { locationId }', async () => {
      const calls = stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], staffBody: STAFF_ROSTER });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');

      const select = container!.querySelector('select[aria-label="Grant Edward Broaster a location"]') as HTMLSelectElement;
      act(() => {
        setSelectValue(select, 'loc_2');
      });
      await clickButton('Grant');

      const call = calls.find((c) => c.url.includes('/terminal/staff/user_1/locations') && c.method === 'POST');
      expect(call?.body).toEqual({ locationId: 'loc_2' });
    });

    /**
     * TERM-STAFF-390: the optional anchoring item god offered either answer
     * on -- cheap enough on this layout, so taken. A grant refusal is about
     * the locations section, not the role/end/reactivate row, so it renders
     * below the "Removing a location..." distinction paragraph rather than
     * at the top where a role-change refusal does.
     */
    it('anchors a grant-location refusal near the locations section, not the role/end row at the top', async () => {
      stubFetch({
        workspaceBody: MANAGER_WORKSPACE,
        queueRows: [],
        staffBody: STAFF_ROSTER,
        actionStatus: 404,
        actionBody: { message: 'That location is not active.' },
      });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');

      const select = container!.querySelector('select[aria-label="Grant Edward Broaster a location"]') as HTMLSelectElement;
      act(() => {
        setSelectValue(select, 'loc_2');
      });
      await clickButton('Grant');

      expect(container!.textContent).toContain('That location is not active.');
      const text = container!.textContent!;
      expect(text.indexOf('Removing a location only ends access')).toBeLessThan(text.indexOf('That location is not active.'));
    });

    it('shows the inactive company location in the grant picker as a disabled option, never hidden', async () => {
      stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], staffBody: STAFF_ROSTER });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');

      const select = container!.querySelector('select[aria-label="Grant Edward Broaster a location"]') as HTMLSelectElement;
      const option = Array.from(select.options).find((o) => o.textContent?.includes('Orange Walk Hub'));
      expect(option).toBeDefined();
      expect(option!.disabled).toBe(true);
    });

    /**
     * TERM-STAFF-390: Stanley measured the location chip's text at a
     * contrast ratio of about 1:1 (rgba(244,248,255,.82) on rgb(248,250,252))
     * and its remove control at 8x16px. jsdom computes neither real layout
     * nor real contrast (same limit as the earlier 390 question), so this
     * locks in the TOKEN CHOICE and the TOUCH-TARGET CLASS -- a literal
     * regression (someone reverting to the CSS-variable class or dropping
     * the min-h/min-w) would fail this. It does NOT prove the rendered
     * ratio or the rendered pixel box; that observation belongs to Stanley
     * on the deployed build, same as the layout claim below.
     */
    it('uses a hardcoded light-surface text class on the location chip, never the glass-ambient CSS variable', async () => {
      stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], staffBody: STAFF_ROSTER });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');

      const chip = Array.from(container!.querySelectorAll('li')).find((li) => li.textContent?.includes('Belize City Hub')) as HTMLLIElement;
      expect(chip.className).toContain('text-slate-700');
      expect(chip.className).not.toContain('--bmpl-text-secondary');

      const removeBtn = container!.querySelector('button[aria-label="Remove Edward Broaster\'s access to Belize City Hub"]') as HTMLButtonElement;
      expect(removeBtn.className).toContain('text-slate-600');
      expect(removeBtn.className).not.toContain('--bmpl-text-muted');
      expect(removeBtn.className).toContain('min-h-[24px]');
      expect(removeBtn.className).toContain('min-w-[24px]');
    });

    /**
     * S2-TERM-MOBILE: Stanley measured this native checkbox's own box at
     * 13x13px at 390px. Sized to the same 24x24 WCAG 2.5.8 AA floor as the
     * remove control above, for the same dense-inline-list reasoning.
     */
    it('gives the invite-location checkbox a real 24x24 touch target, not the native default', async () => {
      stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], staffBody: STAFF_ROSTER });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');

      const checkbox = Array.from(container!.querySelectorAll('#staff-invite-locations input[type="checkbox"]')).find((c) =>
        (c as HTMLInputElement).closest('label')?.textContent?.includes('San Pedro Hub'),
      ) as HTMLInputElement;
      expect(checkbox.className).toContain('h-6');
      expect(checkbox.className).toContain('w-6');
    });

    /**
     * TERM-STAFF-390: Stanley read the computed layout and found the
     * badge/button cluster's wrapper effectively flex-nowrap -- `shrink-0`
     * stopped it from ever narrowing to the available column width, so its
     * own flex-wrap never got a box narrow enough to use. This locks in
     * that `shrink-0` is gone from that specific div; it does not (and
     * cannot, in jsdom) prove the rendered layout no longer overflows --
     * that observation belongs to Stanley on the deployed build.
     */
    it('removes shrink-0 from the badge/button cluster so its own flex-wrap can actually engage', async () => {
      stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], staffBody: STAFF_ROSTER });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');

      const endButton = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'End membership') as HTMLButtonElement;
      const cluster = endButton.parentElement as HTMLElement;
      expect(cluster.className).toContain('flex-wrap');
      expect(cluster.className).not.toContain('shrink-0');
    });

    /**
     * TERM-STAFF-ROBUST: Stanley caught this screen crashing to the root
     * error boundary against an API build that predates the top-level
     * `locations` field (`GET /terminal/staff` returning `{members,
     * pendingInvites}` with no `locations` key at all, not even `[]`) --
     * `staff.locations.filter(...)` on `undefined`. Everything that does
     * NOT depend on the missing field -- the member list, role controls,
     * end/reactivate, and each member's own already-granted locations with
     * working revoke -- must still render and work.
     */
    it('does not crash when the API response has no top-level locations field at all, and keeps the rest of the roster working', async () => {
      const oldShapeRoster = { members: STAFF_ROSTER.members, pendingInvites: STAFF_ROSTER.pendingInvites };
      const calls = stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], staffBody: oldShapeRoster });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');

      // Positive control: no render threw to the root error boundary.
      expect(container!.textContent).not.toContain('Something went wrong');
      expect(container!.textContent).toContain('Edward Broaster');
      expect(container!.textContent).toContain('Rosa Chi');
      expect(container!.textContent).toContain('Granted at: Belize City Hub');

      // Role/membership controls, which depend on nothing in `locations`,
      // still work.
      await clickButton('Set as operator');
      const roleCall = calls.find((c) => c.url.includes('/terminal/staff/user_1/role') && c.method === 'PATCH');
      expect(roleCall?.body).toEqual({ memberRole: 'OPERATOR' });

      // A member's own already-granted location (not the missing
      // company-wide list) still renders and its revoke still works.
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const revokeBtn = container!.querySelector("button[aria-label=\"Remove Edward Broaster's access to Belize City Hub\"]") as HTMLButtonElement;
      expect(revokeBtn).toBeTruthy();
      await act(async () => {
        revokeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 0));
      });
      const revokeCall = calls.find((c) => c.url.includes('/terminal/staff/user_1/locations/loc_1') && c.method === 'DELETE');
      expect(revokeCall).toBeDefined();
      vi.restoreAllMocks();
    });

    it('says the location list is unavailable, not a silently-empty picker that looks like a company with no locations', async () => {
      const oldShapeRoster = { members: STAFF_ROSTER.members, pendingInvites: STAFF_ROSTER.pendingInvites };
      stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], staffBody: oldShapeRoster });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Staff');

      // Per-member grant picker: an honest note, not a vanished control and
      // not the genuinely-no-locations-to-grant case (which renders nothing).
      expect(container!.textContent).toContain('Location list is unavailable right now -- refresh to grant a location.');
      expect(container!.querySelector('select[aria-label="Grant Edward Broaster a location"]')).toBeNull();

      // Invite form: same honest copy, Send invite disabled, no checklist
      // claiming the company genuinely has zero locations.
      expect(container!.textContent).toContain('Location list is unavailable right now -- refresh to try again.');
      expect(container!.textContent).not.toContain('No locations to grant.');
      expect(container!.textContent).not.toContain('No active locations exist yet');
      const sendInvite = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Send invite') as HTMLButtonElement;
      expect(sendInvite.disabled).toBe(true);
    });
  });

  // MDF-777 (history): the MANAGER-only History tab, GET /terminal/history
  // (Pam's #768, built against the contract god relayed). Gated on
  // workspace.memberRole, never on a failed fetch -- an OPERATOR never
  // triggers this request at all. Lazy (loaded on first tab open), unlike
  // Inbound/Custody, since it is cursor-paginated rather than a single
  // capped fetch.
  describe('MDF-777 — the MANAGER-only History tab', () => {
    it('never renders a History tab for an OPERATOR, and never calls /terminal/history', async () => {
      const calls: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          calls.push(url);
          if (url.includes('/api/terminal/me')) return jsonResponse(200, WORKSPACE);
          if (url.includes('/api/terminal/queue')) return jsonResponse(200, []);
          if (url.includes('/api/terminal/inbound')) return jsonResponse(200, { items: [], hasMore: false });
          if (url.includes('/api/terminal/custody')) return jsonResponse(200, { items: [], hasMore: false });
          return jsonResponse(404, { message: 'not mocked: ' + url });
        }),
      );
      await mount();

      expect(() => findTab('History')).toThrow();
      expect(calls.some((u) => u.includes('/terminal/history'))).toBe(false);
    });

    it('shows a History tab for a MANAGER with no live count badge, and does not fetch until it is opened', async () => {
      const calls = stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], historyItems: [HISTORY_ROW] });
      await mount();

      expect(findTab('History').textContent).toBe('History');
      expect(calls.some((c) => c.url.includes('/terminal/history'))).toBe(false);

      await clickTab('History');
      expect(calls.some((c) => c.url.includes('/terminal/history'))).toBe(true);
    });

    it("renders each row's reference, parcel, sender, recipient, status, touched hubs and Demo badge when isTest", async () => {
      stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], historyItems: [{ ...HISTORY_ROW, isTest: true }] });
      await mount();
      await clickTab('History');

      expect(container!.textContent).toContain('BML-40');
      expect(container!.textContent).toContain('1 parcel');
      expect(container!.textContent).toContain('Ana Cruz');
      expect(container!.textContent).toContain('Luis Tun');
      expect(container!.textContent).toContain('DELIVERED');
      expect(container!.textContent).toContain('Belize City Hub');
      expect(container!.textContent).toContain('San Pedro Hub');
      expect(container!.textContent).toContain('Demo');
    });

    /**
     * FIN-COUNTS-HISTORY: the owner's "we said six staged shipments, History
     * shows eight" finding. Not a data bug -- confirmed against
     * docs/EDWARD-DEMO-WORKSPACE-GUIDE.md, which already names the two
     * extras as unrelated verification-team test records. The owner's
     * objection was that a GUIDE explained it rather than the SCREEN -- this
     * puts the true, general mechanism on screen instead: History is the
     * complete all-time ledger, the other tabs only count what's in
     * progress. It does not name which rows are which; there is no reliable
     * field to do that without inventing one.
     */
    it('states on screen why History can list more shipments than Overview/Incoming/On Hand/Queue ever count', async () => {
      stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], historyItems: [HISTORY_ROW] });
      await mount();
      await clickTab('History');

      expect(container!.textContent).toContain('History lists every shipment that has ever touched your locations, including setup and test records');
      expect(container!.textContent).toContain("Overview, Incoming, On Hand and the queue tabs only ever count what's still in progress");
    });

    /**
     * FIN-HIST-LAG, the SECOND defect under that name (god stopped the PR
     * to flag this -- Stanley pulled BML-FE5WKZQW live: shipment.status =
     * IN_TRANSIT, its one leg genuinely arrived but not yet handed off).
     * The refresh fix (tested elsewhere in this file) only kills the
     * staleness half. This is the vocabulary half: History reports the
     * SHIPMENT's status, a working tab reports one LEG's custody state,
     * and both can be true at once and look like a contradiction. No
     * refresh changes that -- only a label does, which is what this
     * asserts.
     */
    it('labels the History status as the shipment-level status, so it does not read as a bare contradiction of a working tab', async () => {
      stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], historyItems: [{ ...HISTORY_ROW, status: 'IN_TRANSIT' }] });
      await mount();
      await clickTab('History');

      expect(container!.textContent).toContain('Shipment status');
      expect(container!.textContent).toContain(
        "The status shown here describes the whole shipment's journey, not the one step a working tab may be handling right now",
      );
    });

    // P2-PARITY-API (#800): same statusLabel fix as the Lookup tab -- this
    // endpoint (`terminalHistory`) had the identical gap, fixed the same way.
    it('shows the API\'s own statusLabel on a history row, not the raw status enum', async () => {
      stubFetch({
        workspaceBody: MANAGER_WORKSPACE,
        queueRows: [],
        historyItems: [{ ...HISTORY_ROW, status: 'AWAITING_PICKUP', statusLabel: 'Awaiting drop-off at the departure terminal' }],
      });
      await mount();
      await clickTab('History');

      expect(container!.textContent).toContain('Awaiting drop-off at the departure terminal');
      expect(container!.textContent).not.toContain('AWAITING PICKUP');
    });

    it('shows an honest empty state when there is no history yet', async () => {
      stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], historyItems: [] });
      await mount();
      await clickTab('History');

      expect(container!.textContent).toContain('No shipment history yet');
    });

    it('surfaces a real refusal with a retry, without taking down the rest of the page', async () => {
      stubFetch({
        workspaceBody: MANAGER_WORKSPACE,
        queueRows: [DEPART_ROW],
        historyStatus: 500,
        historyErrorBody: { message: 'Something went wrong loading history.' },
      });
      await mount();
      await clickTab('History');

      expect(container!.textContent).toContain('Something went wrong loading history.');
      expect(Array.from(container!.querySelectorAll('button')).some((b) => b.textContent === 'Try again')).toBe(true);
      await clickTab('Depart');
      expect(container!.textContent).toContain('BML-1');
    });

    it('offers a Load more button when a next cursor is returned, and fetches the next page on click', async () => {
      const calls = stubFetch({
        workspaceBody: MANAGER_WORKSPACE,
        queueRows: [],
        historyItems: [HISTORY_ROW],
        historyNextCursor: 'ship_40',
        historyMoreItems: [HISTORY_ROW_2],
        historyMoreNextCursor: null,
      });
      await mount();
      await clickTab('History');

      expect(container!.textContent).toContain('BML-40');
      const loadMore = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Load more')!;
      expect(loadMore).toBeDefined();
      await act(async () => {
        loadMore.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(calls.some((c) => c.url.includes('/terminal/history') && c.url.includes('cursor=ship_40'))).toBe(true);
      expect(container!.textContent).toContain('BML-40');
      expect(container!.textContent).toContain('BML-41');
      expect(Array.from(container!.querySelectorAll('button')).some((b) => b.textContent === 'Load more')).toBe(false);
    });

    it('shows no Load more button when there is no next cursor', async () => {
      stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [], historyItems: [HISTORY_ROW], historyNextCursor: null });
      await mount();
      await clickTab('History');

      expect(Array.from(container!.querySelectorAll('button')).some((b) => b.textContent === 'Load more')).toBe(false);
    });
  });

  // MDF-777: the Incoming tab, GET /terminal/inbound -- real and deployed
  // since MDF-700, never read anywhere in apps/web until this card. View
  // only: there is no action a terminal member can take on a leg that has
  // not arrived yet, so this tab has no buttons, just the real schedule.
  describe('MDF-777 — the Incoming tab', () => {
    it('is visible to every member regardless of role, badged with the real item count', async () => {
      stubFetch({ queueRows: [], inboundItems: [INBOUND_ROW] });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(findTab('Incoming').textContent).toBe('Incoming1');
    });

    it('lists each inbound leg with its reference, parcel, origin and scheduled arrival, with no action button', async () => {
      stubFetch({ queueRows: [], inboundItems: [INBOUND_ROW] });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Incoming');

      expect(container!.textContent).toContain('BML-20');
      expect(container!.textContent).toContain('1 parcel');
      expect(container!.textContent).toContain('From San Pedro Hub');
      expect(container!.textContent).toContain('Scheduled');
      // No action button anywhere in the panel itself (excludes the tab bar,
      // whose buttons are always labelled Depart/Arrive/etc. regardless of
      // which tab is selected).
      const panel = container!.querySelector('#terminal-workspace-panel')!;
      expect(panel.querySelectorAll('button').length).toBe(0);
    });

    it('labels an already-departed leg "In transit" rather than "Scheduled"', async () => {
      stubFetch({ queueRows: [], inboundItems: [{ ...INBOUND_ROW, departed: true }] });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Incoming');

      expect(container!.textContent).toContain('In transit');
      expect(container!.textContent).not.toContain('Scheduled');
    });

    it('shows an honest empty state when nothing is inbound', async () => {
      stubFetch({ queueRows: [], inboundItems: [] });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Incoming');

      expect(container!.textContent).toContain('Nothing inbound');
    });

    it('surfaces a real refusal if /terminal/inbound fails, with a retry, without taking down the rest of the page', async () => {
      stubFetch({ queueRows: [DEPART_ROW], inboundStatus: 500, inboundErrorBody: { message: 'Something went wrong loading your inbound list.' } });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('Incoming');

      expect(container!.textContent).toContain('Something went wrong loading your inbound list.');
      expect(Array.from(container!.querySelectorAll('button')).some((b) => b.textContent === 'Try again')).toBe(true);
      // The Depart tab's own data, loaded independently, is unaffected.
      await clickTab('Depart');
      expect(container!.textContent).toContain('BML-1');
    });
  });

  // MDF-777 (god's addition): the On Hand tab, GET /terminal/custody --
  // what this terminal physically holds right now. Same shape as Incoming:
  // view-only, lazy badge from a real count, no action button.
  describe('MDF-777 — the On Hand tab', () => {
    it('is visible to every member regardless of role, badged with the real item count', async () => {
      stubFetch({ queueRows: [], custodyItems: [CUSTODY_ROW] });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(findTab('On Hand').textContent).toBe('On Hand1');
    });

    it('lists each held shipment with its reference, parcel and how long it has been held, with no action button', async () => {
      stubFetch({ queueRows: [], custodyItems: [CUSTODY_ROW] });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('On Hand');

      expect(container!.textContent).toContain('BML-30');
      expect(container!.textContent).toContain('1 parcel');
      expect(container!.textContent).toContain('Held since');
      const panel = container!.querySelector('#terminal-workspace-panel')!;
      expect(panel.querySelectorAll('button').length).toBe(0);
    });

    it('shows an honest empty state when nothing is on hand', async () => {
      stubFetch({ queueRows: [], custodyItems: [] });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('On Hand');

      expect(container!.textContent).toContain('Nothing on hand');
    });

    it('surfaces a real refusal if /terminal/custody fails, with a retry, without taking down the rest of the page', async () => {
      stubFetch({ queueRows: [DEPART_ROW], custodyStatus: 500, custodyErrorBody: { message: 'Something went wrong loading what you hold.' } });
      await mount();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      await clickTab('On Hand');

      expect(container!.textContent).toContain('Something went wrong loading what you hold.');
      expect(Array.from(container!.querySelectorAll('button')).some((b) => b.textContent === 'Try again')).toBe(true);
      await clickTab('Depart');
      expect(container!.textContent).toContain('BML-1');
    });
  });

  // MDF-702 step 2 / T-7: the Lookup tab, GET /terminal/shipments/:reference,
  // and the Demo badge this endpoint's isTest field makes possible.
  describe('MDF-702 step 2 — the Lookup tab, and T-7\'s Demo badge', () => {
    it('shows a prompt rather than a result before any search has run', async () => {
      stubFetch({ queueRows: [] });
      await mount();
      await clickTab('Lookup');

      expect(container!.textContent).toContain('Look up a parcel');
    });

    it('refuses an empty search without calling the API', async () => {
      const calls = stubFetch({ queueRows: [] });
      await mount();
      await clickTab('Lookup');
      await clickButton('Look up');

      expect(calls.find((c) => c.url.includes('/terminal/shipments/'))).toBeUndefined();
      expect(container!.textContent).toContain('Enter a reference to look up.');
    });

    it('looks up a reference and renders the result -- status, description, pieces, sender, recipient and each leg', async () => {
      const calls = stubFetch({ queueRows: [], lookupBody: LOOKUP_RESULT });
      await mount();
      await clickTab('Lookup');
      setValue(container!.querySelector('#lookup-reference') as HTMLInputElement, 'BML-9');
      await clickButton('Look up');

      expect(calls.find((c) => c.url.includes('/terminal/shipments/BML-9'))).toBeDefined();
      expect(container!.textContent).toContain('BML-9');
      expect(container!.textContent).toContain('Spare parts');
      expect(container!.textContent).toContain('2 pieces');
      expect(container!.textContent).toContain('Juan Perez');
      expect(container!.textContent).toContain('Maria Lopez');
      expect(container!.textContent).toContain('Belize City Hub');
      expect(container!.textContent).toContain('San Pedro Hub');
    });

    // P2-PARITY-API (#800): status alone can mean two different things for
    // the same raw value depending on this shipment's service -- the API
    // now sends the already-correct, server-computed statusLabel.
    it('shows the API\'s own statusLabel, not the raw status enum', async () => {
      stubFetch({ queueRows: [], lookupBody: { ...LOOKUP_RESULT, status: 'AWAITING_PICKUP', statusLabel: 'Awaiting drop-off at the departure terminal' } });
      await mount();
      await clickTab('Lookup');
      setValue(container!.querySelector('#lookup-reference') as HTMLInputElement, 'BML-9');
      await clickButton('Look up');

      expect(container!.textContent).toContain('Awaiting drop-off at the departure terminal');
      expect(container!.textContent).not.toContain('AWAITING PICKUP');
    });

    // SHIP-CROSS-ROLE-S6: unlike the shipment-level status above, a leg has
    // no server-computed label at all -- this used to render the raw
    // LegStatus enum via a bare StatusBadge (IN_PROGRESS -> "IN PROGRESS").
    // legStatusLabel (lib/shipping.ts) is what fills that gap now.
    it('shows a human label for each leg\'s status, not the raw leg-status enum', async () => {
      stubFetch({
        queueRows: [],
        lookupBody: { ...LOOKUP_RESULT, legs: [{ ...LOOKUP_RESULT.legs[0], status: 'IN_PROGRESS' }] },
      });
      await mount();
      await clickTab('Lookup');
      setValue(container!.querySelector('#lookup-reference') as HTMLInputElement, 'BML-9');
      await clickButton('Look up');

      expect(container!.textContent).toContain('In progress');
      expect(container!.textContent).not.toContain('IN PROGRESS');
    });

    it('renders a Demo badge when the result is isTest, and no badge at all when it is not', async () => {
      stubFetch({ queueRows: [], lookupBody: { ...LOOKUP_RESULT, isTest: true } });
      await mount();
      await clickTab('Lookup');
      setValue(container!.querySelector('#lookup-reference') as HTMLInputElement, 'BML-9');
      await clickButton('Look up');

      expect(container!.textContent).toContain('Demo');
    });

    it('renders no Demo badge for a real (non-test) shipment', async () => {
      stubFetch({ queueRows: [], lookupBody: LOOKUP_RESULT });
      await mount();
      await clickTab('Lookup');
      setValue(container!.querySelector('#lookup-reference') as HTMLInputElement, 'BML-9');
      await clickButton('Look up');

      expect(container!.textContent).toContain('BML-9');
      expect(container!.textContent).not.toContain('Demo');
    });

    it('surfaces the server\'s real 404 message for a reference that does not exist, distinct from the 403 case', async () => {
      stubFetch({ queueRows: [], lookupStatus: 404, lookupBody: { message: 'No shipment with that reference.' } });
      await mount();
      await clickTab('Lookup');
      setValue(container!.querySelector('#lookup-reference') as HTMLInputElement, 'BML-404');
      await clickButton('Look up');

      expect(container!.textContent).toContain('No shipment with that reference.');
    });

    it('surfaces the server\'s real 403 message for a shipment outside the caller\'s hubs', async () => {
      stubFetch({ queueRows: [], lookupStatus: 403, lookupBody: { message: 'This shipment is not at one of your terminal locations.' } });
      await mount();
      await clickTab('Lookup');
      setValue(container!.querySelector('#lookup-reference') as HTMLInputElement, 'BML-9');
      await clickButton('Look up');

      expect(container!.textContent).toContain('This shipment is not at one of your terminal locations.');
    });

    it('is visible to an OPERATOR, not just a MANAGER -- lookup is hub-scoped, not role-scoped', async () => {
      stubFetch({ workspaceBody: WORKSPACE, queueRows: [] });
      await mount();

      expect(() => findTab('Lookup')).not.toThrow();
    });

    /**
     * MDF-721: Jim's gap-proof on #685 intercepted /api/terminal/queue to a
     * 500 and found the Lookup tab gone -- not errored, gone, with no way
     * back to it -- because the whole tab bar sat behind `rows && (...)`,
     * and `rows` never gets set when the queue fetch fails. Lookup has no
     * dependency on the queue at all; a tab's visibility must not be a
     * function of an unrelated fetch's state.
     */
    it('stays visible and reachable even when /terminal/queue fails -- a tab is not a function of an unrelated fetch', async () => {
      const calls = stubFetch({ queueStatus: 500, lookupBody: LOOKUP_RESULT });
      await mount();

      // Positive control: the page genuinely attempted and failed, rather
      // than never asking or rendering blank.
      expect(calls).toBeDefined();
      expect(container!.textContent).toContain('Could not load your queue.');

      expect(() => findTab('Lookup')).not.toThrow();
      await clickTab('Lookup');
      setValue(container!.querySelector('#lookup-reference') as HTMLInputElement, 'BML-9');
      await clickButton('Look up');

      expect(container!.textContent).toContain('BML-9');
      expect(container!.textContent).toContain('Spare parts');
    });

    it('does not let an older, slower search response overwrite a newer one', async () => {
      let resolveFirst: ((res: Response) => void) | undefined;
      let secondCallStarted = false;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.includes('/api/terminal/me')) return jsonResponse(200, WORKSPACE);
          if (url.includes('/api/terminal/queue')) return jsonResponse(200, []);
          if (url.includes('/api/terminal/shipments/BML-OLD')) {
            return new Promise<Response>((resolve) => {
              resolveFirst = resolve;
            });
          }
          if (url.includes('/api/terminal/shipments/BML-NEW')) {
            secondCallStarted = true;
            return jsonResponse(200, { ...LOOKUP_RESULT, reference: 'BML-NEW', description: 'Newer search' });
          }
          return jsonResponse(404, { message: 'not mocked: ' + url });
        }),
      );
      await mount();
      await clickTab('Lookup');

      const input = container!.querySelector('#lookup-reference') as HTMLInputElement;
      setValue(input, 'BML-OLD');
      await clickButton('Look up');
      expect(secondCallStarted).toBe(false); // still in flight, unresolved

      // The "Look up" button disables itself while a search is in flight --
      // the real-world race is a user retyping and hitting Enter again
      // before the first request resolves, which the Enter handler allows
      // unconditionally (it isn't gated by `loading`).
      setValue(input, 'BML-NEW');
      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(container!.textContent).toContain('Newer search');

      // The stale first response now resolves, after the newer one already rendered.
      await act(async () => {
        resolveFirst!(jsonResponse(200, { ...LOOKUP_RESULT, reference: 'BML-OLD', description: 'Older search' }));
        await new Promise((r) => setTimeout(r, 0));
      });

      // Must still show the newer result -- the stale one must not win.
      expect(container!.textContent).toContain('Newer search');
      expect(container!.textContent).not.toContain('Older search');
    });
  });

  /**
   * T-7/MDF-736: `myWorkspace` and `terminalQueue` have carried `isTest`
   * since #698, but the `Workspace` interface and `QueueRow` union here
   * dropped it on arrival -- nothing on this page ever drew it. Fixed by
   * carrying the field through both types and reusing the same text-only
   * Demo badge the Lookup tab's own result already renders (see
   * `result.isTest` above), rather than inventing a second visual language
   * for the same fact.
   */
  describe('T-7/MDF-736 — a Demo badge marks simulation data on the workspace header and queue rows', () => {
    it('badges the workspace header when the company is isTest', async () => {
      stubFetch({ workspaceBody: { ...WORKSPACE, isTest: true }, queueRows: [] });
      await mount();

      const header = container!.querySelector('h1')!;
      expect(header.textContent).toContain('Tropic Air');
      expect(header.textContent).toContain('Demo');
    });

    it('does not badge the header for a real company', async () => {
      stubFetch({ workspaceBody: { ...WORKSPACE, isTest: false }, queueRows: [] });
      await mount();

      const header = container!.querySelector('h1')!;
      expect(header.textContent).not.toContain('Demo');
    });

    it('badges only the isTest rows in a mixed queue, never the real ones', async () => {
      stubFetch({
        queueRows: [
          { ...DEPART_ROW, isTest: true },
          { ...ARRIVE_ROW, isTest: false },
        ],
      });
      await mount();

      const cards = Array.from(container!.querySelectorAll('.bmpl-card'));
      const departCard = cards.find((c) => c.textContent?.includes('BML-1'))!;
      const arriveCard = cards.find((c) => c.textContent?.includes('BML-2'))!;
      expect(departCard).toBeDefined();
      expect(arriveCard).toBeDefined();

      expect(departCard.textContent).toContain('Demo');
      expect(arriveCard.textContent).not.toContain('Demo');
    });
  });

  // DEMO-UI-AUDIT (god's pre-launch sweep of the deployed workspace): the
  // header's reload button, and the queue loading/error/has-more banners
  // above the tab bar, used to fire for every tab -- including the five
  // that never read /terminal/queue at all. A queue failure could sit as a
  // banner over an unrelated tab while that tab's own panel went blank
  // (every Overview/action-tab render branch is gated on `rows`, which a
  // failed queue load never sets). Each tab now reloads its own data; the
  // queue's own status is scoped to the tabs that actually depend on it.
  describe('DEMO-UI-AUDIT — a context-aware reload control, and queue status scoped to the tabs that depend on it', () => {
    it("reloads the active tab's own data on click, not always /terminal/queue", async () => {
      let queueCalls = 0;
      let historyCalls = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.includes('/api/terminal/me')) return jsonResponse(200, MANAGER_WORKSPACE);
          if (url.includes('/api/terminal/queue')) {
            queueCalls += 1;
            return jsonResponse(200, [], { 'X-BMPL-Queue-Has-More': 'false' });
          }
          if (url.includes('/api/terminal/staff')) return jsonResponse(200, { members: [], pendingInvites: [], locations: [] });
          if (url.includes('/api/terminal/inbound')) return jsonResponse(200, { items: [], hasMore: false });
          if (url.includes('/api/terminal/custody')) return jsonResponse(200, { items: [], hasMore: false });
          if (url.includes('/api/terminal/history')) {
            historyCalls += 1;
            return jsonResponse(200, { items: [HISTORY_ROW], nextCursor: null });
          }
          return jsonResponse(404, { message: 'not mocked: ' + url });
        }),
      );
      await mount();
      await clickTab('History');

      const historyCallsAfterOpen = historyCalls;
      const queueCallsAfterOpen = queueCalls;

      await clickButton('Refresh');

      expect(historyCalls).toBeGreaterThan(historyCallsAfterOpen);
      expect(queueCalls).toBe(queueCallsAfterOpen);
    });

    it('offers no reload control on Lookup -- its own Look up button already covers redoing a search', async () => {
      stubFetch();
      await mount();
      await clickTab('Lookup');

      expect(Array.from(container!.querySelectorAll('button')).some((b) => b.textContent === 'Refresh')).toBe(false);
    });

    it('does not show a queue failure banner over an unrelated tab', async () => {
      stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueStatus: 500 });
      await mount();
      await clickTab('Staff');

      expect(container!.textContent).not.toContain('Could not load your queue.');
    });

    it('still shows the queue failure, with a working retry, on Overview', async () => {
      let queueAttempt = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.includes('/api/terminal/me')) return jsonResponse(200, WORKSPACE);
          if (url.includes('/api/terminal/queue')) {
            queueAttempt += 1;
            if (queueAttempt === 1) return jsonResponse(500, { message: 'Could not load your queue.' });
            return jsonResponse(200, [DEPART_ROW], { 'X-BMPL-Queue-Has-More': 'false' });
          }
          if (url.includes('/api/terminal/inbound')) return jsonResponse(200, { items: [], hasMore: false });
          if (url.includes('/api/terminal/custody')) return jsonResponse(200, { items: [], hasMore: false });
          return jsonResponse(404, { message: 'not mocked: ' + url });
        }),
      );
      await mount();

      expect(container!.textContent).toContain('Could not load your queue.');

      const retry = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Try again')!;
      await act(async () => {
        retry.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(container!.textContent).toContain('BML-1');
      expect(container!.textContent).not.toContain('Could not load your queue.');
    });

    /**
     * REL-QUEUE-ERR-GENERIC-MASK: every existing 500-path test above hands
     * the stub a body that already says "Could not load your queue." --
     * which is this screen's own fallback text, not what the API actually
     * sends for an unhandled 500. A real crash reaches the browser as
     * Nest's own unhandled-exception shape, `{statusCode:500, message:
     * "Internal server error"}` -- and since that message is non-null,
     * `errMessage`'s `?? fallback` never fires, so the generic placeholder
     * reached the user instead of the specific, actionable fallback this
     * screen was written to show.
     */
    it('shows its own fallback, not the frameworks generic placeholder, on an unhandled 500', async () => {
      stubFetch({ queueStatus: 500, queueErrorBody: { statusCode: 500, message: 'Internal server error' } });
      await mount();

      expect(container!.textContent).toContain('Could not load your queue.');
      expect(container!.textContent).not.toContain('Internal server error');
    });

    it("shows its own fallback on a 500 whose body carries no message field at all -- not just Nest's exact placeholder", async () => {
      stubFetch({ queueStatus: 500, queueErrorBody: {} });
      await mount();

      expect(container!.textContent).toContain('Could not load your queue.');
      expect(container!.textContent).not.toContain('Request failed');
    });

    it('still renders a real business refusal verbatim on a 500 -- only the frameworks own generic text is replaced', async () => {
      stubFetch({ queueStatus: 500, queueErrorBody: { message: 'Your terminal company has been suspended.' } });
      await mount();

      expect(container!.textContent).toContain('Your terminal company has been suspended.');
      expect(container!.textContent).not.toContain('Could not load your queue.');
    });
  });

  // DEMO-UI-POLISH (Stanley's browser acceptance test against production,
  // 2026-11-18): three presentation-only defects on an otherwise-passing
  // Terminal Workspace -- a phone-width tab strip that scrolls with no cue
  // it does, History's empty state claiming "completed and past" while the
  // tab itself lists in-flight statuses too (terminalHistory is a hub-touch
  // history by design, not a completed-only one -- the copy was wrong, not
  // the endpoint), and the internal LINE_HAUL enum leaking into the Incoming
  // empty state.
  describe('DEMO-UI-POLISH — scroll affordance, honest History copy, no raw enum in user-facing text', () => {
    it('shows a scroll cue on the tab strip only while there is more to scroll to, and clears it once scrolled to the end', async () => {
      stubFetch({ workspaceBody: MANAGER_WORKSPACE, queueRows: [DEPART_ROW] });

      const scrollWidthDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth');
      const clientWidthDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
      Object.defineProperty(Element.prototype, 'scrollWidth', { configurable: true, get: () => 600 });
      Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get: () => 300 });
      try {
        await mount();

        const scrollEl = container!.querySelector('[role="tablist"]')!.parentElement as HTMLElement;
        expect(container!.querySelector('[aria-hidden="true"]')).not.toBeNull();

        Object.defineProperty(scrollEl, 'scrollLeft', { configurable: true, value: 300 });
        await act(async () => {
          scrollEl.dispatchEvent(new Event('scroll'));
        });

        expect(container!.querySelector('[aria-hidden="true"]')).toBeNull();
      } finally {
        if (scrollWidthDesc) Object.defineProperty(Element.prototype, 'scrollWidth', scrollWidthDesc);
        if (clientWidthDesc) Object.defineProperty(Element.prototype, 'clientWidth', clientWidthDesc);
      }
    });

    it('shows no scroll cue when the strip already fits the viewport', async () => {
      stubFetch({ queueRows: [DEPART_ROW] });
      await mount();

      expect(container!.querySelector('[aria-hidden="true"]')).toBeNull();
    });

    it("History's empty state matches what the tab actually lists -- in-progress shipments as well as finished ones, not completed-only", async () => {
      stubFetch({ workspaceBody: MANAGER_WORKSPACE, historyItems: [] });
      await mount();
      await clickTab('History');

      expect(container!.textContent).not.toContain('Completed and past shipments');
      expect(container!.textContent).toContain('in progress or finished');
    });

    it('never leaks the LINE_HAUL enum into the Incoming empty state', async () => {
      stubFetch({ inboundItems: [] });
      await mount();
      await clickTab('Incoming');

      expect(container!.textContent).toContain('Nothing inbound');
      expect(container!.textContent).not.toContain('LINE_HAUL');
    });
  });

  // DEMO-UI-CONTRAST (god's follow-up on Stanley's "small, low-contrast dark
  // disc on a dark tab bar" note): the cue can sit over either an inactive
  // tab (bg-white) or the active one (bg-belize-blue, #1e40af), and the
  // original bg-slate-900/70 fill measured 1.73:1 against belize-blue --
  // under the WCAG AA 3:1 floor for non-text UI, and no amount of extra
  // opacity on a single dark fill can ever fix that (even fully opaque
  // slate-900 only reaches 2.05:1 against belize-blue -- both colours are
  // dark). Fixed with an opaque fill (already fine against white) plus a
  // white ring, which alone clears belize-blue. This guards the actual
  // regression a plain "a chevron renders" test would miss: a CSS-only
  // revert back to a translucent single-tone fill.
  describe('DEMO-UI-CONTRAST — the scroll cue reads against both a white and a belize-blue tab', () => {
    it('uses an opaque fill plus a white ring, not a translucent single-tone fill', async () => {
      stubFetch({ queueRows: [DEPART_ROW] });

      const scrollWidthDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth');
      const clientWidthDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
      Object.defineProperty(Element.prototype, 'scrollWidth', { configurable: true, get: () => 600 });
      Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get: () => 300 });
      try {
        await mount();

        const pill = container!.querySelector('[aria-hidden="true"] span') as HTMLElement;
        expect(pill).not.toBeNull();
        // The bug: a translucent fill (bg-slate-900/70) can never clear 3:1
        // against an already-dark background like belize-blue, no matter the
        // opacity -- the fill must be opaque, and something else (the ring)
        // must supply contrast against a dark tab.
        expect(pill.className).not.toMatch(/bg-slate-900\/\d/);
        expect(pill.className).toMatch(/\bbg-slate-900\b/);
        expect(pill.className).toMatch(/ring-white/);
      } finally {
        if (scrollWidthDesc) Object.defineProperty(Element.prototype, 'scrollWidth', scrollWidthDesc);
        if (clientWidthDesc) Object.defineProperty(Element.prototype, 'clientWidth', clientWidthDesc);
      }
    });
  });
});
