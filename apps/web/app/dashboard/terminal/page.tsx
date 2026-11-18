'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type ApiError } from '../../../lib/api';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, LoadingRow, PageHeader, Select, StatusBadge } from '../../../components/ui';

/**
 * TERM-11: the terminal operator workspace. Contract read from Pam's own
 * pushed branch (fix/term8-terminal-queue-depart-arrive-collect), not just
 * god's summary of it -- `GET terminal/me`, `GET terminal/queue` and the five
 * action routes below are exactly what terminal.controller.ts and
 * shipment.service.ts (terminalQueue) on that branch do today. Built off
 * `main`; this PR is expected to merge after Pam's #634.
 *
 * MDF-702 step 1 added the tab bar and the header's item count. Both are
 * computed from `/terminal/queue`'s own rows -- nothing here is fabricated.
 * Deliberately NOT added: throughput or aging. `QueueRow` carries no
 * timestamp of any kind for any action, so neither figure can be computed
 * honestly from what this endpoint returns today; adding one would mean
 * inventing a number. Also deliberately not added: nav links to an
 * inbound list, a standalone detail route, or history -- those don't
 * exist yet (later MDF-702 steps build them) and a link to a page that
 * isn't there is exactly the kind of half-built control the owner ruled
 * out. Lookup itself (below) is no longer in that list -- step 2 builds
 * it as a tab on this same page rather than a separate route, so there is
 * nothing half-built to link to.
 *
 * `release.courier` is nullable on the actual branch even though it reads as
 * always-present in the summarized contract -- a LAST_MILE leg can be
 * DRIVER_ACCEPTED with no courier profile resolved yet, same as the admin
 * handoff desk already had to handle.
 *
 * TERM-5's reversal applies here exactly as it did on the admin handoff
 * desk: HANDOFF and RELEASE_TO_COURIER are codes the OTHER party reads
 * aloud and the operator types in, never a value this screen reveals,
 * prefetches, or puts in a URL or log. The queue payload itself carries no
 * pin, by design -- there is nothing here to leak even by accident.
 *
 * HANDOFF submits `presentedByAssignedCourier: true` for the same reason
 * Oscar's admin handoff desk does (TERM-7): this screen never learns a
 * courier's user id, so the server derives who "the assigned courier" is
 * from the leg itself rather than trusting whoever is signed in here.
 *
 * COLLECT takes both a code and a name. The TERM-12 gap this comment used
 * to describe (the API accepting no code at all) closed at `6cc75009` --
 * `collectShipmentSchema` requires `code`, and the form below sends it.
 *
 * MDF-702: the MANAGER-only Staff tab, consuming `GET /terminal/staff`
 * (Pam's #683, MDF-698). This is the one capability that makes the
 * MANAGER/OPERATOR split real rather than cosmetic -- per Stanley's
 * acceptance condition on #683, everything else an OPERATOR can already
 * do too. The tab itself is only drawn for `workspace.memberRole ===
 * 'MANAGER'`; hiding it is a courtesy, not the control -- the server's
 * own 403 (`assertActiveMemberRole`) is what actually enforces this, same
 * as every other guard in this file never being duplicated client-side.
 * The roster never carries an invite token, by the service's own design
 * (`serializeInvite` never selects it), so there is nothing here to leak
 * even by accident.
 *
 * TERM-STAFF-UI: this was a read-only roster view until now -- the owner
 * approved full self-service (a manager may appoint managers, assign/
 * remove locations, deactivate/reactivate, resend/revoke an invite), and
 * Pam built the six member-facing routes plus the two invite-control
 * routes this needs. Every one of those routes is session-authenticated
 * only (no `@RequirePermission`/`@Roles`) with the company ALWAYS derived
 * from the caller's own active membership server-side -- there is no
 * companyId anywhere in a path or body for this screen to pass, and
 * nothing a crafted request could widen. `assertActiveMemberRole` inside
 * `TerminalService` is what actually enforces MANAGER-only, exactly as it
 * already did for the read; every control below is hidden from an
 * OPERATOR as a courtesy only, same discipline as the tab itself. No
 * control here pre-empts a server refusal by disabling itself (the owner's
 * explicit requirement: the API must be the thing that proves a boundary,
 * not a disabled button hiding it) -- including the "last active manager"
 * floor, which fires identically whether the actor targets themselves or
 * someone else, so there is one refusal path, rendered verbatim, never a
 * client-side guess at who counts as "the last one."
 *
 * MDF-702 step 2: the Lookup tab, consuming `GET /terminal/shipments/
 * :reference` (Pam's #686, MDF-699). Visible to every member regardless
 * of role -- lookup is hub-scoped, not role-scoped, same as the five
 * action routes above. Two distinct refusals from the server, surfaced
 * verbatim rather than paraphrased: a reference that exists nowhere is a
 * 404 ("No shipment with that reference."), a real shipment that never
 * touches one of my hubs is a 403 ("This shipment is not at one of your
 * terminal locations.") -- never the same message for both, since one is
 * "check what you typed" and the other is "this isn't yours to see."
 *
 * T-7 (MDF-707's demo/real labelling requirement, the frontend half of
 * which belongs to MDF-702): this endpoint shipped with `isTest` on its
 * response from day one (not blocked on Pam's MDF-700 contract the way
 * myWorkspace/terminalQueue still are), so the Lookup result renders a
 * plain "Demo" badge when `isTest` is true and nothing extra when it is
 * false -- text, not color or icon alone, per the doc's own accessibility
 * rule. The workspace-header and per-queue-row labelling this same
 * requirement calls for remain blocked on MDF-700, unchanged by this step.
 *
 * MDF-777: the Incoming tab, consuming `GET /terminal/inbound`
 * (terminal.controller.ts, MDF-700/TERM-INBOUND). This endpoint shipped
 * long before this card but was never read anywhere in apps/web -- Queue's
 * own ARRIVE section only ever shows a LINE_HAUL leg once it is already
 * IN_PROGRESS (actionable now); a leg still READY (scheduled, not yet
 * departed its origin) was invisible anywhere, which was the owner's exact
 * complaint behind this tab. View-only, same as Lookup and Staff: there is
 * no action route for an inbound leg a terminal member can take before it
 * actually arrives, so this tab has no buttons, only the real schedule.
 * Loaded eagerly once the workspace resolves (same timing as Staff),
 * rather than lazily on first tab click, so the tab bar's own badge is a
 * live count from the moment the page is useful, matching every other tab
 * here. `{ items, hasMore }` is this endpoint's own real shape (unlike
 * `/terminal/queue`'s header-carried truncation signal) -- read directly
 * from the body, nothing adapted.
 *
 * MDF-777 (god's addition, not scope creep -- the owner's demo names
 * "confirming custody" explicitly, and this is the one view that makes the
 * dashboard operational rather than a set of action tabs): the On Hand
 * tab, consuming `GET /terminal/custody`. Same shape and timing as
 * Incoming -- real, deployed since MDF-700, never read anywhere in
 * apps/web before this; view-only (there is no "release from custody"
 * action distinct from the ones Queue's own tabs already offer); loaded
 * eagerly once the workspace resolves. `GET /terminal/outbound` is the
 * one MDF-700 endpoint deliberately NOT surfaced -- the owner never named
 * departures, and god was explicit it stays out.
 *
 * MDF-777 (history): the History tab, consuming `GET /terminal/history`
 * (Pam's #768, built against the exact contract god relayed -- that
 * contract, not Pam's source, is what this reads; #768 is not merged at
 * the time this lands, so this calls a route that does not exist on
 * `main` yet). MANAGER-only and location-scoped -- same gate as Staff,
 * and for the same reason: an OPERATOR gets a 403 from the server, so the
 * tab is hidden on `workspace.memberRole`, never on a failed fetch (a
 * fetch this screen never makes for an OPERATOR in the first place).
 * Cursor-paginated (`{ items, nextCursor }`, limit 20 per page) rather
 * than the single-shot/200-cap shape Inbound and Custody use, so unlike
 * those two this is loaded lazily on first open of the tab, not eagerly
 * with the workspace -- a MANAGER who never looks at history should not
 * cost a request for it on every page load. No live count badge, for the
 * same reason Lookup has none: a loaded-page length is not an honest
 * answer to "how many", and this is a browsable log, not a worklist.
 * `touchedHubs`' own item shape was not specified in the relayed
 * contract -- `hubLabel` below reads a plain string or an object carrying
 * `name`/`code`, whichever Pam's branch actually returns, rather than
 * guessing one and rendering "[object Object]" if it's the other.
 *
 * DEMO-UI-AUDIT (god's pre-launch sweep of the deployed workspace): the
 * header's "Refresh" button and the queue loading/error/has-more banners
 * above the tab bar predate every tab but Overview and the five action
 * tabs, and were never revisited as Inbound/On Hand/Staff/History/Lookup
 * were added -- all three fired off `/terminal/queue` state regardless of
 * which tab was open, so a queue failure could sit as a banner over an
 * unrelated tab while that tab's own panel went fully blank (every branch
 * there is gated on `rows`, which a failed queue load never sets). Fixed
 * by making the refresh button call the active tab's own loader (null,
 * not a dead button, on Lookup -- its own Look up button already covers
 * "redo this" for a search) and giving Overview/the five action tabs the
 * same in-panel error + retry every other tab already had.
 */

interface HubRef {
  id: string;
  code: string;
  name: string;
  district: string;
  city: string;
}

interface Workspace {
  companyId: string;
  companyName: string;
  memberRole: string;
  /**
   * T-7/MDF-736: `myWorkspace` (terminal.service.ts:647) has shipped this
   * since #698 -- the gap was never the API, it was that this interface
   * (and therefore every TypeScript access to `workspace`) dropped the
   * field on arrival before anything here could read it.
   */
  isTest: boolean;
  locations: Array<{ locationId: string; hub: HubRef }>;
}

type StaffMemberRole = 'MANAGER' | 'OPERATOR';

interface StaffMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  memberRole: StaffMemberRole;
  status: 'ACTIVE' | 'ENDED';
  createdAt: string;
  endedAt: string | null;
  locations: Array<{ id: string; hub: { id: string; code: string; name: string } }>;
}

interface StaffInvite {
  id: string;
  email: string;
  memberRole: StaffMemberRole;
  expiresAt: string;
  createdAt: string;
  locationCount: number;
}

/**
 * TERM-STAFF-UI: the ninth contract item, added after the first eight
 * shipped a real gap -- no route told a terminal member their company's
 * full location set, only a member's own grants. God's ruling: the SAME
 * shape `apps/admin`'s own `getCompany` already returns (every location,
 * `isActive` flagged, never pre-filtered), so an inactive one can be shown
 * present-but-unselectable instead of silently vanishing from a picker.
 */
interface StaffCompanyLocation {
  id: string;
  isActive: boolean;
  hub: { id: string; code: string; name: string; district: string; city: string };
}

interface StaffRoster {
  members: StaffMember[];
  pendingInvites: StaffInvite[];
  // TERM-STAFF-ROBUST: optional, not required -- an API build that predates
  // this field omits it entirely rather than sending `[]`, and the render
  // below must survive that, not assume the contract is always current.
  locations?: StaffCompanyLocation[];
}

interface LookupHubRef {
  id: string;
  name: string;
}

interface LookupLeg {
  sequence: number;
  kind: string;
  status: string;
  originHub: LookupHubRef | null;
  destinationHub: LookupHubRef | null;
  departedAt: string | null;
  arrivedAt: string | null;
  completedAt: string | null;
}

interface LookupResult {
  shipmentId: string;
  reference: string;
  status: string;
  description: string;
  pieces: number;
  isTest: boolean;
  senderName: string;
  recipientName: string;
  legs: LookupLeg[];
}

interface InboundRow {
  legId: string;
  hubId: string;
  reference: string;
  parcel: string;
  from: string;
  scheduledArrivalAt: string | null;
  departed: boolean;
  isTest: boolean;
}

interface CustodyRow {
  shipmentId: string;
  hubId: string;
  reference: string;
  parcel: string;
  heldSince: string;
  isTest: boolean;
}

interface HistoryRow {
  shipmentId: string;
  reference: string;
  status: string;
  parcel: string;
  isTest: boolean;
  createdAt: string;
  senderName: string;
  recipientName: string;
  touchedHubs: unknown[];
}

/**
 * T-7/MDF-736: `terminalQueue` (shipment.service.ts:5385) stamps `isTest` on
 * every one of its five row shapes -- added here, on each variant, rather
 * than once on a shared base, so every QueueRowCard access is still exact
 * about which action it's rendering; TypeScript would not have caught a
 * typo'd field name on a looser shared type the way it does on these.
 */
type QueueRow =
  | { action: 'DEPART'; legId: string; hubId: string; reference: string; parcel: string; to: string; isTest: boolean }
  | { action: 'ARRIVE'; legId: string; hubId: string; reference: string; parcel: string; from: string; isTest: boolean }
  | {
      action: 'HANDOFF';
      legId: string;
      hubId: string;
      reference: string;
      parcel: string;
      from: string;
      broughtBy: string;
      arrived: boolean;
      isTest: boolean;
      // TERM-HANDOFF-LOCK-STRANDS-THE-PARCEL-WITH-NO-UNLOCK: true once the
      // leg has hit EXCEPTION (five wrong codes, or a staff-flagged hold).
      // The row stays in this section rather than vanishing -- the bug was
      // the row disappearing while the terminal still physically held the
      // parcel. Even the correct code is refused (403) while this is true,
      // so the Hand off form below must not be offered; only an admin's
      // Resume on the leg clears it.
      locked: boolean;
      // MDF-747: `broughtBy` above is display-only (falls back to the
      // literal 'Carrier', indistinguishable from a real carrier of that
      // name). `kind`/`courier` are the real signal -- `completeLeg`'s own
      // guard refuses a FIRST_MILE leg with no assigned courier, but a
      // LINE_HAUL leg never has one and is exempt from that guard by
      // design, so `courier === null` must never be read alone.
      kind: 'FIRST_MILE' | 'LINE_HAUL';
      courier: string | null;
    }
  | { action: 'RELEASE_TO_COURIER'; legId: string; hubId: string; reference: string; parcel: string; courier: string | null; isTest: boolean }
  | { action: 'COLLECT'; shipmentId: string; hubId: string; reference: string; parcel: string; isTest: boolean };

const SECTION_ORDER: Array<{ action: QueueRow['action']; title: string }> = [
  { action: 'DEPART', title: 'Ready to depart' },
  { action: 'ARRIVE', title: 'Confirm arrival' },
  { action: 'HANDOFF', title: 'Hand off to recipient or next leg' },
  { action: 'RELEASE_TO_COURIER', title: 'Release to courier' },
  { action: 'COLLECT', title: 'Collection at the counter' },
];

/** Short tab labels -- SECTION_ORDER's own titles are full sentences, too
 * long for a tab button on a 320px screen (same reasoning the driver jobs
 * tablist already applied: apps/web/app/dashboard/driver/jobs/page.tsx). */
const TAB_LABELS: Record<QueueRow['action'], string> = {
  DEPART: 'Depart',
  ARRIVE: 'Arrive',
  HANDOFF: 'Hand off',
  RELEASE_TO_COURIER: 'Release',
  COLLECT: 'Collect',
};

type TabKey = 'OVERVIEW' | 'INBOUND' | 'CUSTODY' | QueueRow['action'] | 'STAFF' | 'HISTORY' | 'LOOKUP';

/**
 * REL-QUEUE-ERR-GENERIC-MASK: a 500 with no specific cause reaches here as
 * the framework's own unhandled-exception placeholder ("Internal server
 * error"), not a reason anyone can act on -- since it is never null, the
 * `?? fallback` below would otherwise never fire, and the generic text
 * would always beat this screen's own human-readable fallback. A real
 * business refusal (400/403/404/409, or even a 500 the API gave an actual
 * reason for) is a real reason and still renders verbatim, unchanged.
 */
function errMessage(e: unknown, fallback: string): string {
  const err = e as ApiError | undefined;
  if (err?.status === 500 && err.message === 'Internal server error') return fallback;
  return err?.message ?? fallback;
}

const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-BZ', { dateStyle: 'medium', timeStyle: 'short' }) : null;

/** See the MDF-777 (history) header comment above -- `touchedHubs`' item shape wasn't specified. */
function hubLabel(h: unknown): string {
  if (typeof h === 'string') return h;
  if (h && typeof h === 'object') {
    const o = h as Record<string, unknown>;
    if (typeof o.name === 'string') return o.name;
    if (typeof o.code === 'string') return o.code;
  }
  return '';
}

export default function TerminalWorkspacePage() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [noMembership, setNoMembership] = useState(false);
  const [workspaceErr, setWorkspaceErr] = useState<string | null>(null);

  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [queueErr, setQueueErr] = useState<string | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);
  // TERM-QUEUE-OVERFLOW-UI: MDF-739 made the API tell the truth about
  // truncation via the X-BMPL-Queue-Has-More response header rather than
  // changing the body shape (so it could merge without a matching frontend
  // change in the same window) -- this is that frontend change landing.
  // Read, never fabricated: absent or any value other than the literal
  // string "true" reads as false, so a header that failed to arrive shows
  // no banner rather than a false one.
  const [queueHasMore, setQueueHasMore] = useState(false);

  const [staff, setStaff] = useState<StaffRoster | null>(null);
  const [staffErr, setStaffErr] = useState<string | null>(null);
  const [staffLoading, setStaffLoading] = useState(false);

  const [inbound, setInbound] = useState<InboundRow[] | null>(null);
  const [inboundErr, setInboundErr] = useState<string | null>(null);
  const [inboundLoading, setInboundLoading] = useState(false);
  const [inboundHasMore, setInboundHasMore] = useState(false);

  const [custody, setCustody] = useState<CustodyRow[] | null>(null);
  const [custodyErr, setCustodyErr] = useState<string | null>(null);
  const [custodyLoading, setCustodyLoading] = useState(false);
  const [custodyHasMore, setCustodyHasMore] = useState(false);

  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [historyErr, setHistoryErr] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);

  const [tab, setTab] = useState<TabKey>('OVERVIEW');

  // DEMO-UI-POLISH: the tab strip has always scrolled horizontally when it
  // does not fit (overflow-x-auto below) -- nothing was ever functionally
  // broken. But at phone width there was no visible cue that it scrolls at
  // all, so a manager landing on Overview could not tell "Depar[t]" cut off
  // at the edge meant "swipe for more" rather than "the page is broken".
  // Tracked via the real DOM scroll metrics (not just tab count) so the
  // affordance only shows when there genuinely is more off-screen to the
  // right, and clears itself once the strip is scrolled to its end.
  const tabStripRef = useRef<HTMLDivElement>(null);
  const [tabStripScrollable, setTabStripScrollable] = useState(false);
  const updateTabStripScrollable = useCallback(() => {
    const el = tabStripRef.current;
    if (!el) return;
    setTabStripScrollable(el.scrollWidth - el.clientWidth - el.scrollLeft > 1);
  }, []);

  const [lookupInput, setLookupInput] = useState('');
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [lookupErr, setLookupErr] = useState<string | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupSearched, setLookupSearched] = useState(false);
  // Stanley's review of #692: a fast repeat search (type a reference, search,
  // edit, search again before the first response lands) could have an older
  // response overwrite a newer one. Each call stamps its own sequence number
  // and only applies its result if nothing newer has started since.
  const lookupSeqRef = useRef(0);

  const [busy, setBusy] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<Record<string, string>>({});
  const [handoffForms, setHandoffForms] = useState<Record<string, { pin: string; receivedByName: string }>>({});
  const [releaseForms, setReleaseForms] = useState<Record<string, string>>({});
  const [collectForms, setCollectForms] = useState<Record<string, { code: string; collectedByName: string }>>({});

  const loadWorkspace = useCallback(async () => {
    setWorkspaceErr(null);
    setNoMembership(false);
    try {
      setWorkspace(await api.get<Workspace>('/terminal/me'));
    } catch (e) {
      if ((e as ApiError).status === 403) {
        setNoMembership(true);
      } else {
        setWorkspaceErr(errMessage(e, 'Could not load your terminal workspace.'));
      }
    }
  }, []);

  const loadQueue = useCallback(async () => {
    setQueueLoading(true);
    setQueueErr(null);
    try {
      const { data, headers } = await api.getWithHeaders<QueueRow[]>('/terminal/queue');
      setRows(data);
      setQueueHasMore(headers.get('X-BMPL-Queue-Has-More') === 'true');
    } catch (e) {
      setQueueErr(errMessage(e, 'Could not load your queue.'));
    } finally {
      setQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    if (workspace) void loadQueue();
  }, [workspace, loadQueue]);

  // Re-measure whenever the tab strip's own content can change width: on
  // mount, on viewport resize, and when `workspace.memberRole` changes which
  // tabs render at all (MANAGER gets two extra: Staff, History).
  useEffect(() => {
    updateTabStripScrollable();
    window.addEventListener('resize', updateTabStripScrollable);
    return () => window.removeEventListener('resize', updateTabStripScrollable);
  }, [updateTabStripScrollable, workspace?.memberRole]);

  const loadStaff = useCallback(async () => {
    setStaffLoading(true);
    setStaffErr(null);
    try {
      setStaff(await api.get<StaffRoster>('/terminal/staff'));
    } catch (e) {
      setStaffErr(errMessage(e, 'Could not load your staff roster.'));
    } finally {
      setStaffLoading(false);
    }
  }, []);

  // MANAGER-only, same as the tab itself -- an OPERATOR never even
  // triggers this request, rather than firing it and discarding a 403.
  useEffect(() => {
    if (workspace?.memberRole === 'MANAGER') void loadStaff();
  }, [workspace, loadStaff]);

  const loadInbound = useCallback(async () => {
    setInboundLoading(true);
    setInboundErr(null);
    try {
      const { items, hasMore } = await api.get<{ items: InboundRow[]; hasMore: boolean }>('/terminal/inbound');
      setInbound(items);
      setInboundHasMore(hasMore);
    } catch (e) {
      setInboundErr(errMessage(e, 'Could not load what is inbound.'));
    } finally {
      setInboundLoading(false);
    }
  }, []);

  // Every member regardless of role -- inbound visibility is hub-scoped,
  // not role-scoped, same as the five queue action routes.
  useEffect(() => {
    if (workspace) void loadInbound();
  }, [workspace, loadInbound]);

  const loadCustody = useCallback(async () => {
    setCustodyLoading(true);
    setCustodyErr(null);
    try {
      const { items, hasMore } = await api.get<{ items: CustodyRow[]; hasMore: boolean }>('/terminal/custody');
      setCustody(items);
      setCustodyHasMore(hasMore);
    } catch (e) {
      setCustodyErr(errMessage(e, 'Could not load what you are holding.'));
    } finally {
      setCustodyLoading(false);
    }
  }, []);

  // Same visibility rule as Inbound -- hub-scoped, not role-scoped.
  useEffect(() => {
    if (workspace) void loadCustody();
  }, [workspace, loadCustody]);

  const loadHistory = useCallback(
    async (opts?: { more?: boolean }) => {
      const more = opts?.more ?? false;
      if (more) setHistoryLoadingMore(true);
      else setHistoryLoading(true);
      setHistoryErr(null);
      try {
        const qs = more && historyCursor ? `?cursor=${encodeURIComponent(historyCursor)}&limit=20` : '?limit=20';
        const { items, nextCursor } = await api.get<{ items: HistoryRow[]; nextCursor: string | null }>(`/terminal/history${qs}`);
        setHistory((prev) => (more ? [...(prev ?? []), ...items] : items));
        setHistoryCursor(nextCursor ?? null);
      } catch (e) {
        setHistoryErr(errMessage(e, 'Could not load shipment history.'));
      } finally {
        if (more) setHistoryLoadingMore(false);
        else setHistoryLoading(false);
      }
    },
    [historyCursor],
  );

  // MANAGER-only, same as Staff, and gated the same way: on the member role
  // already read from `workspace`, never on a failed fetch -- an OPERATOR
  // never triggers this request at all. Lazy, unlike Inbound/Custody: this
  // is cursor-paginated, not a single capped fetch, so loading it eagerly
  // on every page view would cost a request a MANAGER who never opens this
  // tab gets no value from.
  useEffect(() => {
    // `!historyErr` matters: without it, a failed load (which never sets
    // `history`, by design -- same as every other error path in this file)
    // would re-fire itself on every render this effect re-runs, forever.
    // A failed load is retried only by the explicit "Try again" button below.
    if (tab === 'HISTORY' && workspace?.memberRole === 'MANAGER' && history === null && !historyLoading && !historyErr) {
      void loadHistory();
    }
  }, [tab, workspace, history, historyLoading, historyErr, loadHistory]);

  function clearRowState(id: string) {
    setRowErr((prev) => {
      const { [id]: _drop, ...rest } = prev;
      return rest;
    });
  }

  async function depart(legId: string) {
    setBusy(legId);
    clearRowState(legId);
    try {
      await api.post(`/terminal/legs/${legId}/depart`, {});
      await loadQueue();
    } catch (e) {
      setRowErr((prev) => ({ ...prev, [legId]: errMessage(e, 'Could not mark this leg departed.') }));
    } finally {
      setBusy(null);
    }
  }

  async function arrive(legId: string) {
    setBusy(legId);
    clearRowState(legId);
    try {
      await api.post(`/terminal/legs/${legId}/arrive`);
      await loadQueue();
    } catch (e) {
      setRowErr((prev) => ({ ...prev, [legId]: errMessage(e, 'Could not confirm arrival.') }));
    } finally {
      setBusy(null);
    }
  }

  async function handoff(legId: string) {
    const form = handoffForms[legId] ?? { pin: '', receivedByName: '' };
    const pin = form.pin.trim();
    const receivedByName = form.receivedByName.trim();
    if (!pin || !receivedByName) {
      setRowErr((prev) => ({ ...prev, [legId]: 'Enter the code presented and who is receiving it.' }));
      return;
    }
    setBusy(legId);
    clearRowState(legId);
    try {
      await api.post(`/terminal/legs/${legId}/handoff`, { pin, receivedByName, presentedByAssignedCourier: true });
      setHandoffForms((prev) => {
        const { [legId]: _drop, ...rest } = prev;
        return rest;
      });
      await loadQueue();
    } catch (e) {
      setRowErr((prev) => ({ ...prev, [legId]: errMessage(e, 'Could not record this handoff.') }));
    } finally {
      setBusy(null);
    }
  }

  async function release(legId: string) {
    const pin = (releaseForms[legId] ?? '').trim();
    if (!pin) {
      setRowErr((prev) => ({ ...prev, [legId]: 'Enter the code the courier presented.' }));
      return;
    }
    setBusy(legId);
    clearRowState(legId);
    try {
      await api.post(`/terminal/legs/${legId}/release-to-courier`, { pin });
      setReleaseForms((prev) => {
        const { [legId]: _drop, ...rest } = prev;
        return rest;
      });
      await loadQueue();
    } catch (e) {
      setRowErr((prev) => ({ ...prev, [legId]: errMessage(e, 'Could not release this parcel.') }));
    } finally {
      setBusy(null);
    }
  }

  async function collect(shipmentId: string) {
    const form = collectForms[shipmentId] ?? { code: '', collectedByName: '' };
    const code = form.code.trim();
    const collectedByName = form.collectedByName.trim();
    if (!collectedByName) {
      setRowErr((prev) => ({ ...prev, [shipmentId]: 'Enter who is collecting it.' }));
      return;
    }
    if (!/^\d{4,8}$/.test(code)) {
      setRowErr((prev) => ({ ...prev, [shipmentId]: 'Enter the 4-8 digit collection code the recipient presents.' }));
      return;
    }
    setBusy(shipmentId);
    clearRowState(shipmentId);
    try {
      await api.post(`/terminal/shipments/${shipmentId}/collect`, { code, collectedByName });
      setCollectForms((prev) => {
        const { [shipmentId]: _drop, ...rest } = prev;
        return rest;
      });
      await loadQueue();
    } catch (e) {
      setRowErr((prev) => ({ ...prev, [shipmentId]: errMessage(e, 'Could not record this collection.') }));
    } finally {
      setBusy(null);
    }
  }

  async function lookup() {
    const reference = lookupInput.trim();
    if (!reference) {
      setLookupErr('Enter a reference to look up.');
      return;
    }
    const mySeq = ++lookupSeqRef.current;
    setLookupLoading(true);
    setLookupErr(null);
    setLookupResult(null);
    setLookupSearched(true);
    try {
      const result = await api.get<LookupResult>(`/terminal/shipments/${encodeURIComponent(reference)}`);
      if (mySeq !== lookupSeqRef.current) return; // a newer search started -- drop this stale response
      setLookupResult(result);
    } catch (e) {
      if (mySeq !== lookupSeqRef.current) return;
      setLookupErr(errMessage(e, 'Could not look up that reference.'));
    } finally {
      if (mySeq === lookupSeqRef.current) setLookupLoading(false);
    }
  }

  const hubFor = (hubId: string): HubRef | null =>
    workspace?.locations.find((l) => l.hub.id === hubId)?.hub ?? null;

  // Real figures, not invented ones: every count below is rows.filter on
  // what /terminal/queue actually returned, nothing is estimated.
  const counts = useMemo(() => {
    const base: Record<QueueRow['action'], number> = {
      DEPART: 0,
      ARRIVE: 0,
      HANDOFF: 0,
      RELEASE_TO_COURIER: 0,
      COLLECT: 0,
    };
    for (const r of rows ?? []) base[r.action] += 1;
    return base;
  }, [rows]);
  const totalCount = (rows ?? []).length;

  // The Staff tab panel deliberately lists every status, same as the admin
  // console's own Members card -- but the tab bar's own badge means "how many
  // are on my counter right now", same as every other badge on this bar.
  // Counting ENDED members there would read as a live headcount it is not.
  const activeStaffCount = (staff?.members ?? []).filter((m) => m.status === 'ACTIVE').length;

  // DEMO-UI-AUDIT: the header's own reload control predates every tab but
  // Overview and the five action tabs -- left wired to loadQueue() alone as
  // Inbound/On Hand/Staff/History/Lookup were added, it called
  // /terminal/queue from all six of those tabs too, which updates data the
  // panel the clerk is actually looking at never shows. Each tab now gets
  // its own real reload; Lookup gets none, since it has no "reload
  // everything" concept of its own -- its own Look up button already is
  // that action for the one query on screen.
  const onQueueTab = tab === 'OVERVIEW' || SECTION_ORDER.some((s) => s.action === tab);
  const refreshAction =
    tab === 'INBOUND'
      ? { label: inboundLoading ? 'Refreshing…' : 'Refresh', busy: inboundLoading, onClick: () => void loadInbound() }
      : tab === 'CUSTODY'
        ? { label: custodyLoading ? 'Refreshing…' : 'Refresh', busy: custodyLoading, onClick: () => void loadCustody() }
        : tab === 'STAFF'
          ? { label: staffLoading ? 'Refreshing…' : 'Refresh', busy: staffLoading, onClick: () => void loadStaff() }
          : tab === 'HISTORY'
            ? { label: historyLoading ? 'Refreshing…' : 'Refresh', busy: historyLoading, onClick: () => void loadHistory() }
            : tab === 'LOOKUP'
              ? null
              : { label: queueLoading ? 'Refreshing…' : 'Refresh', busy: queueLoading, onClick: () => void loadQueue() };

  function renderSection(action: QueueRow['action'], title: string) {
    const section = (rows ?? []).filter((r) => r.action === action);
    if (section.length === 0) return null;
    return (
      <div key={action}>
        <h2 className="mb-2 text-sm font-semibold text-[color:var(--bmpl-text-muted-strong)]">
          {title} ({section.length})
        </h2>
        <div className="space-y-3">
          {section.map((row) => (
            <QueueRowCard
              key={row.action === 'COLLECT' ? row.shipmentId : row.legId}
              row={row}
              hub={hubFor(row.hubId)}
              busy={busy}
              error={rowErr[row.action === 'COLLECT' ? row.shipmentId : row.legId]}
              handoffForm={row.action === 'HANDOFF' ? handoffForms[row.legId] : undefined}
              onHandoffChange={(next) => setHandoffForms((prev) => ({ ...prev, [row.action === 'HANDOFF' ? row.legId : '']: next }))}
              releaseValue={row.action === 'RELEASE_TO_COURIER' ? releaseForms[row.legId] : undefined}
              onReleaseChange={(v) => setReleaseForms((prev) => ({ ...prev, [row.action === 'RELEASE_TO_COURIER' ? row.legId : '']: v }))}
              collectForm={row.action === 'COLLECT' ? collectForms[row.shipmentId] : undefined}
              onCollectChange={(next) => setCollectForms((prev) => ({ ...prev, [row.action === 'COLLECT' ? row.shipmentId : '']: next }))}
              onDepart={depart}
              onArrive={arrive}
              onHandoff={handoff}
              onRelease={release}
              onCollect={collect}
            />
          ))}
        </div>
      </div>
    );
  }

  if (!workspace && !noMembership && !workspaceErr) {
    return (
      <div className="mx-auto max-w-2xl">
        <LoadingRow label="Loading your terminal workspace…" />
      </div>
    );
  }

  if (noMembership) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Terminal workspace" />
        <EmptyState
          title="No active terminal company membership"
          description="Your account is not an active member of any terminal company, so there is nothing to show here. Ask the terminal company that invited you to check your membership status."
        />
      </div>
    );
  }

  if (workspaceErr) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <PageHeader title="Terminal workspace" />
        <Alert tone="error">{workspaceErr}</Alert>
        <Button variant="outline" onClick={() => void loadWorkspace()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title={
          <>
            {workspace!.companyName}
            {/* T-7/MDF-736: text, not color or icon alone -- same rule the
                Lookup tab's own Demo badge below follows. */}
            {workspace!.isTest && <Badge tone="neutral">Demo</Badge>}
          </>
        }
        description={`Signed in as ${workspace!.memberRole.toLowerCase()} · ${workspace!.locations.length} location${workspace!.locations.length === 1 ? '' : 's'}${
          rows ? ` · ${totalCount} item${totalCount === 1 ? '' : 's'} waiting on you` : ''
        }`}
        actions={
          refreshAction && (
            <Button variant="outline" onClick={refreshAction.onClick} disabled={refreshAction.busy}>
              {refreshAction.label}
            </Button>
          )
        }
      />

      {/* DEMO-UI-AUDIT: these three used to render for every tab, including
          the five (Inbound/On Hand/Staff/History/Lookup) that never read
          `rows`/`queueErr` at all -- a queue failure sat as a banner above,
          say, the Staff roster with no relation to anything on that tab.
          Scoped to the tabs that actually depend on the queue; the error
          itself now also renders inside the panel below (matching every
          other tab's own in-panel error), not just up here. */}
      {/* TERM-QUEUE-OVERFLOW-UI: each category's own cap can truncate the
          list below without the clerk ever being told -- the header this
          reads exists so that stays honest. No new control is invented
          here; Lookup (below) already finds one specific shipment by its
          reference, which is the one action a clerk can already take on an
          item this page isn't showing. */}
      {rows && queueHasMore && onQueueTab && (
        <Alert tone="neutral">
          There are more parcels waiting than the list below shows. Use Lookup to find a specific one by its reference or tracking number.
        </Alert>
      )}

      {queueLoading && !rows && onQueueTab && <LoadingRow label="Loading your queue…" />}

      {/* Tab bar: both the real-figures dashboard (every badge is a live count
          from the rows above) and the only navigation this step adds -- one
          mechanism serving both purposes rather than a separate stat-card
          grid duplicating the same numbers. Horizontally scrollable at
          320px, same convention as apps/web/app/dashboard/driver/jobs.
          MDF-721: this used to render only once `rows` was set, which took
          EVERY tab down -- Lookup and Staff included -- whenever
          /terminal/queue was slow or failed, even though neither depends
          on the queue at all. The tab bar's own visibility must not be a
          function of an unrelated fetch's state; it depends only on
          `workspace`, which is guaranteed non-null here (the early returns
          above already handled !workspace). The queue-dependent tabs'
          counts naturally read 0 while `rows` is null (`counts`/
          `totalCount` both default off `rows ?? []`), so nothing here
          invents a number -- they just show no badge until the queue
          actually loads. */}
      <div className="relative">
        <div
          ref={tabStripRef}
          onScroll={updateTabStripScrollable}
          className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"
        >
          <div
            className="inline-flex min-w-full overflow-hidden rounded-bmpl-md border border-slate-200"
            role="tablist"
            aria-label="Terminal workspace sections"
          >
            {(
              [
                'OVERVIEW',
                'INBOUND',
                'CUSTODY',
                ...SECTION_ORDER.map((s) => s.action),
                ...(workspace!.memberRole === 'MANAGER' ? (['STAFF', 'HISTORY'] as const) : []),
                'LOOKUP',
              ] as TabKey[]
            ).map((key, i) => {
              const active = tab === key;
              const label =
                key === 'OVERVIEW'
                  ? 'Overview'
                  : key === 'INBOUND'
                    ? 'Incoming'
                    : key === 'CUSTODY'
                      ? 'On Hand'
                      : key === 'STAFF'
                        ? 'Staff'
                        : key === 'HISTORY'
                          ? 'History'
                          : key === 'LOOKUP'
                            ? 'Lookup'
                            : TAB_LABELS[key];
              const count =
                key === 'OVERVIEW'
                  ? totalCount
                  : key === 'INBOUND'
                    ? (inbound ?? []).length
                    : key === 'CUSTODY'
                      ? (custody ?? []).length
                      : key === 'STAFF'
                        ? activeStaffCount
                        : key === 'HISTORY' || key === 'LOOKUP'
                          ? 0
                          : counts[key];
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls="terminal-workspace-panel"
                  onClick={() => setTab(key)}
                  className={`flex min-h-[44px] flex-1 items-center justify-center gap-1.5 whitespace-nowrap px-3 text-sm font-semibold transition ${
                    i > 0 ? 'border-l border-slate-200' : ''
                  } ${active ? 'bg-belize-blue text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                >
                  {label}
                  {count > 0 && (
                    <span
                      className={`inline-flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-[18px] ${
                        active ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* DEMO-UI-POLISH: a manager on a phone had no way to tell the strip
            scrolls -- the row just ended mid-word ("Depar...") with no cue.
            `tabStripScrollable` is real scroll-metric state (not a guess from
            tab count), so this only appears when there truly is more off
            to the right, and clears itself once scrolled to the end.

            DEMO-UI-CONTRAST: the cue can sit over either an inactive tab
            (bg-white) or the active one (bg-belize-blue) depending on which
            tab is at the scroll edge -- the ORIGINAL bg-slate-900/70 fill
            was measured (real compiled colours, not token names): 6.64:1
            against the disc's own white-tab backdrop (fine) but only
            1.73:1 against belize-blue (#1e40af) -- both colours are dark,
            so no amount of extra opacity on a single dark fill can ever
            clear 3:1 there (even fully opaque slate-900 only reaches
            2.05:1 against belize-blue -- confirmed by computing the ratio
            at every opacity step, not assumed). A flat single-colour disc
            cannot pass 3:1 against both a near-white and an already-dark
            surface at once; needs different survival strategies for each.
            Fix: make the fill OPAQUE (was always fine against white,
            17.85:1 solid) and add a white ring, which alone clears 8.72:1
            against belize-blue -- the shape stays visible via whichever of
            fill/ring actually differs from what's behind it. Same shape,
            same show/hide behaviour; only the fill opacity and the ring are
            new. Sized up slightly (h-5->h-6, icon h-3->h-3.5) per the
            explicit "size it so it reads on a phone" ask. */}
        {tabStripScrollable && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-1.5 sm:hidden"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-white shadow-sm ring-2 ring-white">
              <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                <path d="M7.5 4.5 13 10l-5.5 5.5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
        )}
      </div>

      <div id="terminal-workspace-panel" role="tabpanel">
        {tab === 'INBOUND' ? (
          <InboundPanel rows={inbound} loading={inboundLoading} error={inboundErr} hasMore={inboundHasMore} onRetry={() => void loadInbound()} />
        ) : tab === 'CUSTODY' ? (
          <CustodyPanel rows={custody} loading={custodyLoading} error={custodyErr} hasMore={custodyHasMore} onRetry={() => void loadCustody()} />
        ) : tab === 'STAFF' ? (
          <StaffRosterPanel staff={staff} loading={staffLoading} error={staffErr} onRetry={() => void loadStaff()} />
        ) : tab === 'HISTORY' ? (
          <HistoryPanel
            rows={history}
            loading={historyLoading}
            loadingMore={historyLoadingMore}
            error={historyErr}
            hasMore={historyCursor !== null}
            onRetry={() => void loadHistory()}
            onLoadMore={() => void loadHistory({ more: true })}
          />
        ) : tab === 'LOOKUP' ? (
          <LookupPanel
            value={lookupInput}
            onChange={setLookupInput}
            onSearch={() => void lookup()}
            loading={lookupLoading}
            searched={lookupSearched}
            result={lookupResult}
            error={lookupErr}
          />
        ) : (
          <>
            {/* DEMO-UI-AUDIT: a failed /terminal/queue load used to leave
                this whole area blank -- every branch below is gated on
                `rows`, which a failed load never sets, and the one error
                message for it lived above the tab bar, shown (or not) by a
                condition unrelated to which tab was open. Mirrors every
                other tab's own in-panel error + retry; when rows already
                exist from an earlier load and only a refresh failed, the
                stale rows stay on screen (same as History's own
                load-more-failure handling) with the error appended below
                instead of replacing them. */}
            {queueErr && !rows && (
              <div className="space-y-3">
                <Alert tone="error">{queueErr}</Alert>
                <Button variant="outline" onClick={() => void loadQueue()}>
                  Try again
                </Button>
              </div>
            )}

            {rows && rows.length === 0 && (
              <EmptyState
                title="Nothing waiting at your locations"
                description="Everything at your locations is caught up. New work appears here the moment something needs you."
              />
            )}

            {rows && rows.length > 0 && tab === 'OVERVIEW' && (
              <div className="space-y-5">{SECTION_ORDER.map(({ action, title }) => renderSection(action, title))}</div>
            )}

            {rows && rows.length > 0 && tab !== 'OVERVIEW' && (
              counts[tab] === 0 ? (
                <EmptyState
                  title={`Nothing to ${TAB_LABELS[tab].toLowerCase()} right now`}
                  description="This section is caught up. Check Overview for what else needs you."
                />
              ) : (
                renderSection(tab, SECTION_ORDER.find((s) => s.action === tab)!.title)
              )
            )}

            {queueErr && rows && <Alert tone="error">{queueErr}</Alert>}
          </>
        )}
      </div>
    </div>
  );
}

function QueueRowCard({
  row,
  hub,
  busy,
  error,
  handoffForm,
  onHandoffChange,
  releaseValue,
  onReleaseChange,
  collectForm,
  onCollectChange,
  onDepart,
  onArrive,
  onHandoff,
  onRelease,
  onCollect,
}: {
  row: QueueRow;
  hub: HubRef | null;
  busy: string | null;
  error?: string;
  handoffForm: { pin: string; receivedByName: string } | undefined;
  onHandoffChange: (next: { pin: string; receivedByName: string }) => void;
  releaseValue: string | undefined;
  onReleaseChange: (v: string) => void;
  collectForm: { code: string; collectedByName: string } | undefined;
  onCollectChange: (next: { code: string; collectedByName: string }) => void;
  onDepart: (legId: string) => void;
  onArrive: (legId: string) => void;
  onHandoff: (legId: string) => void;
  onRelease: (legId: string) => void;
  onCollect: (shipmentId: string) => void;
}) {
  const id = row.action === 'COLLECT' ? row.shipmentId : row.legId;
  const isBusy = busy === id;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-sm font-semibold text-[color:var(--bmpl-text)]">{row.reference}</p>
          <p className="mt-0.5 break-words text-sm text-[color:var(--bmpl-text-secondary)]">{row.parcel}</p>
          {row.action === 'DEPART' && <p className="mt-0.5 text-sm text-[color:var(--bmpl-text-muted-strong)]">To {row.to}</p>}
          {row.action === 'ARRIVE' && <p className="mt-0.5 text-sm text-[color:var(--bmpl-text-muted-strong)]">From {row.from}</p>}
          {row.action === 'HANDOFF' && (
            <p className="mt-0.5 text-sm text-[color:var(--bmpl-text-muted-strong)]">
              From {row.from} · brought by {row.broughtBy}
            </p>
          )}
          {row.action === 'RELEASE_TO_COURIER' && (
            <p className="mt-0.5 text-sm text-[color:var(--bmpl-text-muted-strong)]">Courier: {row.courier ?? 'Not yet confirmed'}</p>
          )}
        </div>
        {hub && (
          <Badge tone="neutral">
            {hub.code} — {hub.name}
          </Badge>
        )}
        {row.action === 'HANDOFF' && row.arrived && <Badge tone="success">Arrived</Badge>}
        {row.action === 'HANDOFF' && row.locked && <Badge tone="warning">Locked</Badge>}
        {/* T-7/MDF-736: same text-only Demo badge as the workspace header and
            the Lookup tab's own result -- one visual language for the one
            fact, not a second marker invented for the queue. */}
        {row.isTest && <Badge tone="neutral">Demo</Badge>}
      </div>

      <div className="mt-3 border-t border-[color:var(--bmpl-border-soft)] pt-3">
        {row.action === 'DEPART' && (
          <Button onClick={() => onDepart(row.legId)} disabled={isBusy} className="w-full sm:w-auto">
            {isBusy ? 'Marking departed…' : 'Mark departed'}
          </Button>
        )}

        {row.action === 'ARRIVE' && (
          <Button onClick={() => onArrive(row.legId)} disabled={isBusy} className="w-full sm:w-auto">
            {isBusy ? 'Confirming…' : 'Confirm arrival'}
          </Button>
        )}

        {row.action === 'HANDOFF' && row.locked && (
          <Alert tone="warning" title="Locked">
            Too many incorrect codes were entered. The code will not be accepted here even if it is correct -- an administrator must resume this leg before it can be handed off.
          </Alert>
        )}

        {row.action === 'HANDOFF' && !row.locked && row.kind === 'FIRST_MILE' && row.courier === null && (
          <Alert tone="neutral">This leg has no courier yet.</Alert>
        )}

        {row.action === 'HANDOFF' && !row.locked && !(row.kind === 'FIRST_MILE' && row.courier === null) && (
          <>
            <p className="text-xs text-[color:var(--bmpl-text-muted)]">
              Ask the courier or driver for the code on their own device, and who is receiving it.
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
              <Field label="Code presented" htmlFor={`handoff-pin-${row.legId}`}>
                <Input
                  id={`handoff-pin-${row.legId}`}
                  value={handoffForm?.pin ?? ''}
                  onChange={(e) => onHandoffChange({ pin: e.target.value, receivedByName: handoffForm?.receivedByName ?? '' })}
                  inputMode="numeric"
                  className="w-full font-mono sm:w-28"
                  placeholder="1234"
                />
              </Field>
              <Field label="Received by" htmlFor={`handoff-who-${row.legId}`}>
                <Input
                  id={`handoff-who-${row.legId}`}
                  value={handoffForm?.receivedByName ?? ''}
                  onChange={(e) => onHandoffChange({ pin: handoffForm?.pin ?? '', receivedByName: e.target.value })}
                  placeholder="Who is receiving it"
                />
              </Field>
              <Button onClick={() => onHandoff(row.legId)} disabled={isBusy} className="w-full sm:w-auto">
                {isBusy ? 'Recording…' : 'Record handoff'}
              </Button>
            </div>
          </>
        )}

        {row.action === 'RELEASE_TO_COURIER' && (
          <>
            <p className="text-xs text-[color:var(--bmpl-text-muted)]">Ask the courier collecting this parcel for the code on their own device.</p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
              <Field label="Code presented" htmlFor={`release-pin-${row.legId}`}>
                <Input
                  id={`release-pin-${row.legId}`}
                  value={releaseValue ?? ''}
                  onChange={(e) => onReleaseChange(e.target.value)}
                  inputMode="numeric"
                  className="w-full font-mono sm:w-28"
                  placeholder="1234"
                />
              </Field>
              <Button onClick={() => onRelease(row.legId)} disabled={isBusy} className="w-full sm:w-auto">
                {isBusy ? 'Releasing…' : 'Release to courier'}
              </Button>
            </div>
          </>
        )}

        {row.action === 'COLLECT' && (
          <>
            <p className="text-xs text-[color:var(--bmpl-text-muted)]">
              Ask the recipient for the code on their own device, and their name.
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
              <Field label="Code presented" htmlFor={`collect-code-${row.shipmentId}`}>
                <Input
                  id={`collect-code-${row.shipmentId}`}
                  value={collectForm?.code ?? ''}
                  onChange={(e) => onCollectChange({ code: e.target.value, collectedByName: collectForm?.collectedByName ?? '' })}
                  inputMode="numeric"
                  autoComplete="off"
                  className="w-full font-mono sm:w-28"
                  placeholder="1234"
                />
              </Field>
              <Field label="Collected by" htmlFor={`collect-who-${row.shipmentId}`}>
                <Input
                  id={`collect-who-${row.shipmentId}`}
                  value={collectForm?.collectedByName ?? ''}
                  onChange={(e) => onCollectChange({ code: collectForm?.code ?? '', collectedByName: e.target.value })}
                  placeholder="Recipient's name"
                />
              </Field>
              <Button onClick={() => onCollect(row.shipmentId)} disabled={isBusy} className="w-full sm:w-auto">
                {isBusy ? 'Recording…' : 'Record collection'}
              </Button>
            </div>
          </>
        )}

        {error && <p className="mt-2 break-words text-xs font-medium text-amber-800">{error}</p>}
      </div>
    </Card>
  );
}

/**
 * MDF-777: view-only -- a LINE_HAUL leg scheduled or already in motion
 * toward one of this member's hubs, not yet arrived. No action button: the
 * only thing a terminal member can do about an inbound leg is wait for it,
 * then act on it once Overview/Arrive picks it up for real.
 */
function InboundPanel({
  rows,
  loading,
  error,
  hasMore,
  onRetry,
}: {
  rows: InboundRow[] | null;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  onRetry: () => void;
}) {
  if (loading && !rows) {
    return <LoadingRow label="Loading what is inbound…" />;
  }

  if (error) {
    return (
      <div className="space-y-3">
        <Alert tone="error">{error}</Alert>
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        title="Nothing inbound"
        description="Nothing is currently scheduled or on its way to any of your locations."
      />
    );
  }

  return (
    <div className="space-y-3">
      {hasMore && (
        <Alert tone="neutral">
          There are more inbound parcels than the list below shows. Use Lookup to find a specific one by its reference.
        </Alert>
      )}
      {rows.map((row) => (
        <Card key={row.legId} className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-mono text-sm font-semibold text-[color:var(--bmpl-text)]">{row.reference}</p>
              <p className="mt-0.5 break-words text-sm text-[color:var(--bmpl-text-secondary)]">{row.parcel}</p>
              <p className="mt-0.5 text-sm text-[color:var(--bmpl-text-muted-strong)]">From {row.from}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {row.isTest && <Badge tone="neutral">Demo</Badge>}
              <Badge tone={row.departed ? 'brand' : 'neutral'}>{row.departed ? 'In transit' : 'Scheduled'}</Badge>
            </div>
          </div>
          <p className="mt-2 text-xs text-[color:var(--bmpl-text-muted)]">
            {row.scheduledArrivalAt ? `Expected ${when(row.scheduledArrivalAt)}` : 'No scheduled arrival time yet.'}
          </p>
        </Card>
      ))}
    </div>
  );
}

/**
 * MDF-777: view-only -- what this terminal physically holds right now,
 * derived from the shipment's own latest custody event (never inferred
 * from status). No action button: whatever happens to a held parcel next
 * (hand off, release, collect) is already covered by Queue's own tabs --
 * this exists to answer "what's on the counter", not to duplicate an
 * action surface that already exists.
 */
function CustodyPanel({
  rows,
  loading,
  error,
  hasMore,
  onRetry,
}: {
  rows: CustodyRow[] | null;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  onRetry: () => void;
}) {
  if (loading && !rows) {
    return <LoadingRow label="Loading what you are holding…" />;
  }

  if (error) {
    return (
      <div className="space-y-3">
        <Alert tone="error">{error}</Alert>
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        title="Nothing on hand"
        description="Your locations are not currently holding custody of any shipment."
      />
    );
  }

  return (
    <div className="space-y-3">
      {hasMore && (
        <Alert tone="neutral">
          There is more on hand than the list below shows. Use Lookup to find a specific one by its reference.
        </Alert>
      )}
      {rows.map((row) => (
        <Card key={row.shipmentId} className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-mono text-sm font-semibold text-[color:var(--bmpl-text)]">{row.reference}</p>
              <p className="mt-0.5 break-words text-sm text-[color:var(--bmpl-text-secondary)]">{row.parcel}</p>
            </div>
            {row.isTest && <Badge tone="neutral">Demo</Badge>}
          </div>
          <p className="mt-2 text-xs text-[color:var(--bmpl-text-muted)]">Held since {when(row.heldSince)}</p>
        </Card>
      ))}
    </div>
  );
}

/**
 * MDF-777 (history): read-only, cursor-paginated activity log of every
 * shipment that touched this MANAGER's locations -- `terminalHistory`
 * (shipment.service.ts) deliberately filters on hub-touch only, not status,
 * so an in-flight shipment (AWAITING_COLLECTION, AWAITING_PICKUP, ...) shows
 * up here alongside a finished one. DEMO-UI-POLISH: the copy used to say
 * "Completed and past shipments" while the rows plainly weren't -- that was
 * the bug, not the endpoint; it stayed a superset-of-queue view by design.
 * No action button -- what a MANAGER can still do about an item is already
 * covered by Overview/Lookup, not this screen.
 */
function HistoryPanel({
  rows,
  loading,
  loadingMore,
  error,
  hasMore,
  onRetry,
  onLoadMore,
}: {
  rows: HistoryRow[] | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  onRetry: () => void;
  onLoadMore: () => void;
}) {
  if (loading && !rows) {
    return <LoadingRow label="Loading shipment history…" />;
  }

  if (error && !rows) {
    return (
      <div className="space-y-3">
        <Alert tone="error">{error}</Alert>
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        title="No shipment history yet"
        description="Every shipment that has touched your locations will appear here, in progress or finished, newest first."
      />
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const hubs = row.touchedHubs.map(hubLabel).filter(Boolean);
        return (
          <Card key={row.shipmentId} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono text-sm font-semibold text-[color:var(--bmpl-text)]">{row.reference}</p>
                <p className="mt-0.5 break-words text-sm text-[color:var(--bmpl-text-secondary)]">{row.parcel}</p>
                <p className="mt-0.5 text-sm text-[color:var(--bmpl-text-muted-strong)]">
                  {row.senderName} → {row.recipientName}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {row.isTest && <Badge tone="neutral">Demo</Badge>}
                <StatusBadge status={row.status} />
              </div>
            </div>
            {hubs.length > 0 && <p className="mt-1 text-xs text-[color:var(--bmpl-text-muted)]">{hubs.join(' → ')}</p>}
            <p className="mt-2 text-xs text-[color:var(--bmpl-text-muted)]">{when(row.createdAt)}</p>
          </Card>
        );
      })}

      {error && <Alert tone="error">{error}</Alert>}

      {hasMore && (
        <Button variant="outline" onClick={onLoadMore} disabled={loadingMore} className="w-full">
          {loadingMore ? 'Loading more…' : 'Load more'}
        </Button>
      )}
    </div>
  );
}

/**
 * TERM-STAFF-UI: what the API now tells us about an invite email's send
 * outcome. Ported verbatim (type + rendering) from apps/admin's own
 * InvitesCard -- not a guess: god confirmed `POST /terminal/staff/invite`
 * and the `/resend` route return "the same shape the admin invite already
 * returns", so the message this already renders for admins is correct
 * unchanged here. The invite row is created either way -- a provider outage
 * must not cost the invitation itself -- so a failure here means "resend",
 * never "start again".
 */
type InviteDelivery = { delivered: boolean; outcome: string };

function deliveryMessage(d: InviteDelivery): { tone: 'success' | 'warning'; text: string } {
  if (d.delivered) {
    return d.outcome === 'simulated'
      ? { tone: 'warning', text: 'Invitation created. Email was SIMULATED by this environment, not actually delivered.' }
      : { tone: 'success', text: 'Invitation created and the email was accepted by the provider.' };
  }
  const why =
    d.outcome === 'missing_credential'
      ? 'the email provider is not configured in this environment'
      : d.outcome === 'provider_error'
        ? 'the email provider rejected or failed the send'
        : d.outcome === 'not_implemented'
          ? 'no email transport is enabled here'
          : d.outcome;
  return {
    tone: 'warning',
    text: `Invitation created but the email was NOT delivered -- ${why}. The invite is still valid: use Resend below. The link cannot be recovered any other way.`,
  };
}

/**
 * TERM-STAFF-UI: the roster, now with the owner's approved self-service
 * controls. Dispatches to two self-contained sections (mirroring the admin
 * console's own Members/Pending-invites card split) that each own their
 * busy/error state and call `onRetry` to refresh after a mutation -- the
 * same `onChanged`-after-write convention the admin page uses, just under
 * the name this file's read path already had.
 *
 * `GET /terminal/staff`'s own top-level `locations` field is the ninth
 * contract item, added after flagging a real gap: neither this route nor
 * `/terminal/me` told a member their company's full location set, only
 * their OWN grants (`/terminal/me`'s own `locations` is explicitly
 * caller-scoped -- confirmed against `terminal.service.ts`, not guessed).
 * Same shape `apps/admin`'s own `getCompany` already returns -- EVERY
 * location, `isActive` flagged, never pre-filtered -- so the invite form's
 * location checklist and the per-member "grant a location" picker below
 * both show an inactive location present-but-unselectable rather than
 * letting it silently vanish, per the owner's explicit ruling on why the
 * flag was asked for over a filtered list.
 */
function StaffRosterPanel({
  staff,
  loading,
  error,
  onRetry,
}: {
  staff: StaffRoster | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading && !staff) {
    return <LoadingRow label="Loading your staff roster…" />;
  }

  if (error) {
    return (
      <div className="space-y-3">
        <Alert tone="error">{error}</Alert>
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  if (!staff) return null;

  return (
    <div className="space-y-5">
      <StaffMembersSection staff={staff} onChanged={onRetry} />
      <StaffPendingInvitesSection staff={staff} onChanged={onRetry} />
    </div>
  );
}

/**
 * TERM-STAFF-UI: member mutations. Three differences from the admin
 * console's own MembersCard, each because this screen is company
 * self-service rather than admin-operated, not because the owner's rules
 * differ:
 *   - no separate `canManage` check -- every viewer of this tab already IS
 *     an active MANAGER (the tab is hidden from an OPERATOR, and the server
 *     403s one who reaches it directly), so there is no "can read but can't
 *     act" visitor the way an admin console user can be.
 *   - role CAN be changed in place (`PATCH .../role`) -- the admin page's
 *     own "end the membership and send a new invite" workaround doesn't
 *     apply here because the owner approved the route it was working
 *     around not having.
 *   - no `window.confirm` on "End membership" or a role change, same
 *     reasoning the admin card already states for its own "End membership":
 *     both are recoverable (Reactivate restores the original location
 *     grants; a role can be changed back), so the ONE truly irreversible
 *     control here -- revoking a single location grant -- is the only one
 *     that gets a confirmation step, naming both the member and the hub.
 *
 * Every refusal renders the server's own message verbatim. None is
 * pre-empted by disabling a control -- the owner's explicit rule is that
 * the API must be the thing that proves a boundary, not a disabled button
 * hiding it, and the "last active manager" floor fires identically whether
 * the actor targets themselves or someone else, so there is one refusal
 * path here, never a client-side guess at who counts as "the last one."
 */
const STAFF_MEMBER_ROLES: StaffMemberRole[] = ['MANAGER', 'OPERATOR'];

function StaffMembersSection({ staff, onChanged }: { staff: StaffRoster; onChanged: () => void }) {
  const [roleBusy, setRoleBusy] = useState<string | null>(null);
  const [endBusy, setEndBusy] = useState<string | null>(null);
  const [reactivateBusy, setReactivateBusy] = useState<string | null>(null);
  // Keyed `${userId}:${locationId}` for a revoke, `${userId}:grant` for a grant.
  const [locationBusy, setLocationBusy] = useState<string | null>(null);
  const [grantPick, setGrantPick] = useState<Record<string, string>>({});
  const [rowErr, setRowErrState] = useState<Record<string, string>>({});

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<StaffMemberRole>('OPERATOR');
  const [invitePicked, setInvitePicked] = useState<Set<string>>(new Set());
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteErr, setInviteErr] = useState<string | null>(null);
  const [inviteDelivery, setInviteDelivery] = useState<InviteDelivery | null>(null);

  function setRowErr(userId: string, message: string | null) {
    setRowErrState((prev) => {
      if (message === null) {
        const { [userId]: _drop, ...rest } = prev;
        return rest;
      }
      return { ...prev, [userId]: message };
    });
  }

  async function changeRole(userId: string, memberRole: StaffMemberRole) {
    setRoleBusy(userId);
    setRowErr(userId, null);
    try {
      await api.patch(`/terminal/staff/${userId}/role`, { memberRole });
      onChanged();
    } catch (e) {
      setRowErr(userId, errMessage(e, 'Could not change that role.'));
    } finally {
      setRoleBusy(null);
    }
  }

  async function endMember(userId: string) {
    setEndBusy(userId);
    setRowErr(userId, null);
    try {
      await api.post(`/terminal/staff/${userId}/deactivate`, {});
      onChanged();
    } catch (e) {
      setRowErr(userId, errMessage(e, 'Could not end that membership.'));
    } finally {
      setEndBusy(null);
    }
  }

  async function reactivateMember(userId: string) {
    setReactivateBusy(userId);
    setRowErr(userId, null);
    try {
      await api.post(`/terminal/staff/${userId}/reactivate`, {});
      onChanged();
    } catch (e) {
      setRowErr(userId, errMessage(e, 'Could not reactivate that membership.'));
    } finally {
      setReactivateBusy(null);
    }
  }

  // The admin console's own ADMIN-LOCATION-X-STRIPS-A-MANAGER-WITH-NO-
  // CONFIRMATION reasoning applies unchanged: this is the one destructive
  // control here with no undo, so it is the one that confirms, naming both
  // the hub and the member rather than a generic "are you sure".
  async function revokeLocation(userId: string, locationId: string, hubName: string, memberName: string) {
    if (!window.confirm(`Remove ${memberName}'s access to ${hubName}? They will no longer be able to work there.`)) return;
    setLocationBusy(`${userId}:${locationId}`);
    setRowErr(userId, null);
    try {
      await api.del(`/terminal/staff/${userId}/locations/${locationId}`);
      onChanged();
    } catch (e) {
      setRowErr(userId, errMessage(e, 'Could not revoke that location.'));
    } finally {
      setLocationBusy(null);
    }
  }

  /** Scoped to an ACTIVE member only -- the server 404s otherwise, same as the admin page's own grant. */
  async function grantLocation(userId: string) {
    const locationId = grantPick[userId];
    if (!locationId) return;
    setLocationBusy(`${userId}:grant`);
    setRowErr(userId, null);
    try {
      await api.post(`/terminal/staff/${userId}/locations`, { locationId });
      setGrantPick((prev) => {
        const { [userId]: _drop, ...rest } = prev;
        return rest;
      });
      onChanged();
    } catch (e) {
      setRowErr(userId, errMessage(e, 'Could not grant that location.'));
    } finally {
      setLocationBusy(null);
    }
  }

  async function invite() {
    if (!inviteEmail.trim()) {
      setInviteErr('An email address is required.');
      return;
    }
    if (invitePicked.size === 0) {
      // Mirrors inviteTerminalCompanyMemberSchema's own locationIds.min(1),
      // enforced here before the request -- same reasoning the admin
      // console's own invite form already applies.
      setInviteErr('Select at least one location -- there is no whole-company grant.');
      return;
    }
    setInviteBusy(true);
    setInviteErr(null);
    setInviteDelivery(null);
    try {
      const created = await api.post<{ delivery?: InviteDelivery }>('/terminal/staff/invite', {
        email: inviteEmail.trim(),
        memberRole: inviteRole,
        locationIds: Array.from(invitePicked),
      });
      if (created?.delivery) setInviteDelivery(created.delivery);
      setInviteEmail('');
      setInviteRole('OPERATOR');
      setInvitePicked(new Set());
      onChanged();
    } catch (e) {
      setInviteErr(errMessage(e, 'Could not send that invite.'));
    } finally {
      setInviteBusy(false);
    }
  }

  function toggleInvitePicked(id: string) {
    setInvitePicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * TERM-STAFF-ROBUST: Stanley caught this screen crashing to the root error
   * boundary against an API build that hasn't shipped the top-level
   * `locations` field yet -- `staff.locations.filter(...)` on `undefined`,
   * confirmed by reading the code, not guessed. `null` here means "the API
   * didn't send a location list at all" and is kept distinct from `[]`
   * ("it sent one and it's genuinely empty") throughout this component, so
   * the two degrade differently rather than looking like the same thing.
   */
  const locations = staff.locations ?? null;
  const activeLocationCount = locations ? locations.filter((l) => l.isActive).length : 0;
  const locationsUnavailable = locations === null;

  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-[color:var(--bmpl-text-muted-strong)]">Members ({staff.members.length})</h2>
      {staff.members.length === 0 ? (
        <EmptyState
          title="No staff yet"
          // TERM-STAFF-UI: MDF-740's copy pointed a Manager at the admin
          // console because this screen had no invite control at all. It
          // does now -- invite your first employee below.
          description="Invite your first employee below."
        />
      ) : (
        <div className="space-y-3">
          {staff.members.map((m) => (
            <Card key={m.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-medium text-[color:var(--bmpl-text)]">{m.name}</span>{' '}
                  <span className="text-xs text-[color:var(--bmpl-text-muted)]">{m.email}</span>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <Badge tone={m.memberRole === 'MANAGER' ? 'brand' : 'neutral'}>{m.memberRole}</Badge>
                  <Badge tone={m.status === 'ACTIVE' ? 'success' : 'neutral'}>{m.status}</Badge>
                  {m.status === 'ACTIVE' && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={roleBusy === m.userId}
                      onClick={() => void changeRole(m.userId, m.memberRole === 'MANAGER' ? 'OPERATOR' : 'MANAGER')}
                    >
                      {roleBusy === m.userId ? 'Changing…' : m.memberRole === 'MANAGER' ? 'Set as operator' : 'Appoint as manager'}
                    </Button>
                  )}
                  {m.status === 'ACTIVE' && (
                    <Button variant="ghost" size="sm" disabled={endBusy === m.userId} onClick={() => void endMember(m.userId)}>
                      {endBusy === m.userId ? 'Ending…' : 'End membership'}
                    </Button>
                  )}
                  {m.status === 'ENDED' && (
                    <Button variant="outline" size="sm" disabled={reactivateBusy === m.userId} onClick={() => void reactivateMember(m.userId)}>
                      {reactivateBusy === m.userId ? 'Reactivating…' : 'Reactivate'}
                    </Button>
                  )}
                </div>
              </div>

              {rowErr[m.userId] && <Alert tone="error" className="mt-2">{rowErr[m.userId]}</Alert>}

              <p className="mt-1 text-xs text-[color:var(--bmpl-text-muted)]">
                {m.locations.length === 0 ? 'No locations granted.' : `Granted at: ${m.locations.map((l) => l.hub.name).join(', ')}`}
              </p>

              {m.status === 'ACTIVE' && m.locations.length > 0 && (
                <>
                  <ul className="mt-1 flex flex-wrap gap-1">
                    {m.locations.map((l) => (
                      <li
                        key={l.id}
                        className="inline-flex items-center gap-1 rounded-bmpl-sm border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-[color:var(--bmpl-text-secondary)]"
                      >
                        {l.hub.name}
                        <button
                          type="button"
                          disabled={locationBusy === `${m.userId}:${l.id}`}
                          onClick={() => void revokeLocation(m.userId, l.id, l.hub.name, m.name)}
                          aria-label={`Remove ${m.name}'s access to ${l.hub.name}`}
                          className="font-semibold text-[color:var(--bmpl-text-muted)] hover:text-amber-800 disabled:opacity-50"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                  {/* The owner's required distinction, made explicit rather
                      than left for a manager to infer: removing a location
                      is not removing the person. */}
                  <p className="mt-1 text-xs text-[color:var(--bmpl-text-muted)]">
                    Removing a location only ends access to that location -- it never ends a membership or changes a role.
                  </p>
                </>
              )}

              {m.status === 'ACTIVE' && locationsUnavailable && (
                <p className="mt-1 text-xs text-[color:var(--bmpl-text-muted)]">
                  Location list is unavailable right now -- refresh to grant a location.
                </p>
              )}

              {m.status === 'ACTIVE' &&
                !locationsUnavailable &&
                (() => {
                  const grantable = locations!.filter((l) => !m.locations.some((ml) => ml.id === l.id));
                  if (grantable.length === 0) return null;
                  return (
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Select
                        aria-label={`Grant ${m.name} a location`}
                        value={grantPick[m.userId] ?? ''}
                        onChange={(e) => setGrantPick((prev) => ({ ...prev, [m.userId]: e.target.value }))}
                        className="h-7 py-0 text-xs"
                      >
                        <option value="">+ grant a location…</option>
                        {grantable.map((l) => (
                          // Shown, never hidden, when inactive -- it is
                          // present-but-unselectable rather than a vanished
                          // location this screen pretends the company
                          // never had.
                          <option key={l.id} value={l.id} disabled={!l.isActive}>
                            {l.hub.name} ({l.hub.code}){l.isActive ? '' : ' -- inactive'}
                          </option>
                        ))}
                      </Select>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!grantPick[m.userId] || locationBusy === `${m.userId}:grant`}
                        onClick={() => void grantLocation(m.userId)}
                      >
                        {locationBusy === `${m.userId}:grant` ? 'Granting…' : 'Grant'}
                      </Button>
                    </div>
                  );
                })()}

              {m.status === 'ENDED' && <p className="mt-1 text-xs text-[color:var(--bmpl-text-muted)]">Ended {when(m.endedAt)}.</p>}
            </Card>
          ))}
        </div>
      )}

      <div className="mt-4 space-y-2 border-t border-[color:var(--bmpl-border-soft)] pt-3">
        <h3 className="text-sm font-semibold text-[color:var(--bmpl-text)]">Invite a member</h3>
        {inviteErr && <Alert tone="error">{inviteErr}</Alert>}
        <Field label="Email" htmlFor="staff-invite-email">
          <Input
            id="staff-invite-email"
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="staff@company.bz"
          />
        </Field>
        <Field label="Role" htmlFor="staff-invite-role">
          <Select id="staff-invite-role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as StaffMemberRole)}>
            {STAFF_MEMBER_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Locations (at least one -- a role alone never grants access)"
          htmlFor="staff-invite-locations"
          hint={
            locationsUnavailable
              ? 'Location list is unavailable right now -- refresh to try again.'
              : activeLocationCount === 0
                ? 'No active locations exist yet -- ask a BML administrator to attach one first.'
                : undefined
          }
        >
          <div id="staff-invite-locations" className="space-y-1 rounded-bmpl-md border border-slate-200 p-2">
            {locationsUnavailable ? (
              <p className="text-xs text-[color:var(--bmpl-text-muted)]">Location list is unavailable right now -- refresh to try again.</p>
            ) : locations!.length === 0 ? (
              <p className="text-xs text-[color:var(--bmpl-text-muted)]">No locations to grant.</p>
            ) : (
              locations!.map((l) => (
                <label key={l.id} className={`flex items-center gap-2 text-sm ${l.isActive ? '' : 'text-[color:var(--bmpl-text-muted)]'}`}>
                  <input
                    type="checkbox"
                    checked={invitePicked.has(l.id)}
                    disabled={!l.isActive}
                    onChange={() => toggleInvitePicked(l.id)}
                    className="accent-belize-blue"
                  />
                  {l.hub.name} ({l.hub.code}){l.isActive ? '' : ' -- inactive'}
                </label>
              ))
            )}
          </div>
        </Field>
        <Button type="button" disabled={inviteBusy || activeLocationCount === 0} onClick={() => void invite()}>
          {inviteBusy ? 'Sending…' : 'Send invite'}
        </Button>
        {inviteDelivery && (
          <Alert tone={deliveryMessage(inviteDelivery).tone} className="mt-2">
            {deliveryMessage(inviteDelivery).text}
          </Alert>
        )}
      </div>
    </div>
  );
}

/**
 * TERM-STAFF-UI: resend/revoke for a pending invitation -- the two routes
 * god added to mirror the admin console's own InvitesCard pair.
 */
function StaffPendingInvitesSection({ staff, onChanged }: { staff: StaffRoster; onChanged: () => void }) {
  const [resendBusy, setResendBusy] = useState<string | null>(null);
  const [revokeBusy, setRevokeBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<InviteDelivery | null>(null);

  async function resend(inviteId: string) {
    setResendBusy(inviteId);
    setErr(null);
    setDelivery(null);
    try {
      const res = await api.post<{ delivery?: InviteDelivery }>(`/terminal/staff/invites/${inviteId}/resend`, {});
      if (res?.delivery) setDelivery(res.delivery);
      onChanged();
    } catch (e) {
      setErr(errMessage(e, 'Could not resend that invite.'));
    } finally {
      setResendBusy(null);
    }
  }

  async function revoke(inviteId: string) {
    setRevokeBusy(inviteId);
    setErr(null);
    try {
      await api.post(`/terminal/staff/invites/${inviteId}/revoke`, {});
      onChanged();
    } catch (e) {
      setErr(errMessage(e, 'Could not revoke that invite.'));
    } finally {
      setRevokeBusy(null);
    }
  }

  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-[color:var(--bmpl-text-muted-strong)]">Pending invites ({staff.pendingInvites.length})</h2>
      {err && <Alert tone="error" className="mb-2">{err}</Alert>}
      {delivery && (
        <Alert tone={deliveryMessage(delivery).tone} className="mb-2">
          {deliveryMessage(delivery).text}
        </Alert>
      )}
      {staff.pendingInvites.length === 0 ? (
        <p className="text-sm text-[color:var(--bmpl-text-muted)]">No pending invites.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-bmpl-md border border-slate-200 bg-white">
          {staff.pendingInvites.map((inv) => (
            <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="font-medium text-[color:var(--bmpl-text)]">{inv.email}</span>
              <span className="flex flex-wrap items-center gap-1.5 text-xs text-[color:var(--bmpl-text-muted)]">
                <Badge tone={inv.memberRole === 'MANAGER' ? 'brand' : 'neutral'}>{inv.memberRole}</Badge>
                {inv.locationCount} location{inv.locationCount === 1 ? '' : 's'} · expires {when(inv.expiresAt)}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" disabled={resendBusy === inv.id || revokeBusy === inv.id} onClick={() => void resend(inv.id)}>
                  {resendBusy === inv.id ? 'Resending…' : 'Resend'}
                </Button>
                <Button variant="ghost" size="sm" disabled={revokeBusy === inv.id || resendBusy === inv.id} onClick={() => void revoke(inv.id)}>
                  {revokeBusy === inv.id ? 'Revoking…' : 'Revoke'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * MDF-702 step 2 / T-7: a counter clerk's own search by the customer-facing
 * reference, plus the Demo badge this card's slice of MDF-707 asks for.
 * `isTest` renders a plain "Demo" badge; a real shipment (`isTest: false`)
 * renders nothing extra -- never the reverse, and never color/icon alone.
 */
function LookupPanel({
  value,
  onChange,
  onSearch,
  loading,
  searched,
  result,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  onSearch: () => void;
  loading: boolean;
  searched: boolean;
  result: LookupResult | null;
  error: string | null;
}) {
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label="Shipment reference" htmlFor="lookup-reference" hint="What the customer hands you -- not an internal id.">
            <Input
              id="lookup-reference"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSearch();
              }}
              placeholder="BML-1234"
              className="font-mono"
            />
          </Field>
          <Button onClick={onSearch} disabled={loading} className="w-full sm:w-auto">
            {loading ? 'Looking up…' : 'Look up'}
          </Button>
        </div>
        {error && <p className="mt-2 break-words text-sm font-medium text-amber-800">{error}</p>}
      </Card>

      {!searched && !error && (
        <EmptyState title="Look up a parcel" description="Enter the reference a customer hands you to see where it is and what's next." />
      )}

      {result && (
        <Card className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-mono text-sm font-semibold text-[color:var(--bmpl-text)]">{result.reference}</p>
              <p className="mt-0.5 break-words text-sm text-[color:var(--bmpl-text-secondary)]">
                {result.description} · {result.pieces} piece{result.pieces === 1 ? '' : 's'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {result.isTest && <Badge tone="neutral">Demo</Badge>}
              <StatusBadge status={result.status} />
            </div>
          </div>
          <p className="mt-2 text-sm text-[color:var(--bmpl-text-muted-strong)]">
            From {result.senderName} to {result.recipientName}
          </p>

          <ul className="mt-3 space-y-2 border-t border-[color:var(--bmpl-border-soft)] pt-3">
            {result.legs.map((leg) => (
              <li key={leg.sequence} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  Leg {leg.sequence} ({leg.kind.replace(/_/g, ' ').toLowerCase()}): {leg.originHub?.name ?? 'No terminal'} →{' '}
                  {leg.destinationHub?.name ?? 'No terminal'}
                </span>
                <span className="flex items-center gap-1.5">
                  <StatusBadge status={leg.status} />
                  <span className="text-xs text-[color:var(--bmpl-text-muted)]">
                    {leg.completedAt ? `Completed ${when(leg.completedAt)}` : leg.arrivedAt ? `Arrived ${when(leg.arrivedAt)}` : leg.departedAt ? `Departed ${when(leg.departedAt)}` : 'Not yet departed'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
