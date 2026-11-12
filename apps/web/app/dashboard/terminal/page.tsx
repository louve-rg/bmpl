'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type ApiError } from '../../../lib/api';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, LoadingRow, PageHeader, StatusBadge } from '../../../components/ui';

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
  locations: Array<{ locationId: string; hub: HubRef }>;
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

type QueueRow =
  | { action: 'DEPART'; legId: string; hubId: string; reference: string; parcel: string; to: string }
  | { action: 'ARRIVE'; legId: string; hubId: string; reference: string; parcel: string; from: string }
  | {
      action: 'HANDOFF';
      legId: string;
      hubId: string;
      reference: string;
      parcel: string;
      from: string;
      broughtBy: string;
      arrived: boolean;
    }
  | { action: 'RELEASE_TO_COURIER'; legId: string; hubId: string; reference: string; parcel: string; courier: string | null }
  | { action: 'COLLECT'; shipmentId: string; hubId: string; reference: string; parcel: string };

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

type TabKey = 'OVERVIEW' | QueueRow['action'] | 'LOOKUP';

function errMessage(e: unknown, fallback: string): string {
  return (e as ApiError)?.message ?? fallback;
}

const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-BZ', { dateStyle: 'medium', timeStyle: 'short' }) : null;

export default function TerminalWorkspacePage() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [noMembership, setNoMembership] = useState(false);
  const [workspaceErr, setWorkspaceErr] = useState<string | null>(null);

  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [queueErr, setQueueErr] = useState<string | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);

  const [tab, setTab] = useState<TabKey>('OVERVIEW');

  const [lookupInput, setLookupInput] = useState('');
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [lookupErr, setLookupErr] = useState<string | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupSearched, setLookupSearched] = useState(false);

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
      setRows(await api.get<QueueRow[]>('/terminal/queue'));
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
    setLookupLoading(true);
    setLookupErr(null);
    setLookupResult(null);
    setLookupSearched(true);
    try {
      setLookupResult(await api.get<LookupResult>(`/terminal/shipments/${encodeURIComponent(reference)}`));
    } catch (e) {
      setLookupErr(errMessage(e, 'Could not look up that reference.'));
    } finally {
      setLookupLoading(false);
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
        title={workspace!.companyName}
        description={`Signed in as ${workspace!.memberRole.toLowerCase()} · ${workspace!.locations.length} location${workspace!.locations.length === 1 ? '' : 's'}${
          rows ? ` · ${totalCount} item${totalCount === 1 ? '' : 's'} waiting on you` : ''
        }`}
        actions={
          <Button variant="outline" onClick={() => void loadQueue()} disabled={queueLoading}>
            {queueLoading ? 'Refreshing…' : 'Refresh'}
          </Button>
        }
      />

      {queueErr && <Alert tone="error">{queueErr}</Alert>}

      {queueLoading && !rows && <LoadingRow label="Loading your queue…" />}

      {/* Tab bar: both the real-figures dashboard (every badge is a live count
          from the rows above) and the only navigation this step adds -- one
          mechanism serving both purposes rather than a separate stat-card
          grid duplicating the same numbers. Horizontally scrollable at
          320px, same convention as apps/web/app/dashboard/driver/jobs. */}
      {rows && (
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div
            className="inline-flex min-w-full overflow-hidden rounded-bmpl-md border border-slate-200"
            role="tablist"
            aria-label="Terminal workspace sections"
          >
            {(['OVERVIEW', ...SECTION_ORDER.map((s) => s.action), 'LOOKUP'] as TabKey[]).map((key, i) => {
              const active = tab === key;
              const label = key === 'OVERVIEW' ? 'Overview' : key === 'LOOKUP' ? 'Lookup' : TAB_LABELS[key];
              const count = key === 'OVERVIEW' ? totalCount : key === 'LOOKUP' ? 0 : counts[key];
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
      )}

      <div id="terminal-workspace-panel" role="tabpanel">
        {tab === 'LOOKUP' ? (
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

        {row.action === 'HANDOFF' && (
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
