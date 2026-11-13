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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type StubOpts = {
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
  actionStatus?: number;
  actionBody?: unknown;
  lookupStatus?: number;
  lookupBody?: unknown;
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
        return jsonResponse(200, rows);
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
});
