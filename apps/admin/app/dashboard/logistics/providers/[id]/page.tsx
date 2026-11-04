'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, type ApiError } from '../../../../../lib/api';
import { adminCrumbs } from '../../../../../lib/admin-nav';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner } from '../../../../../components/ui';

/**
 * Carrier detail (MDF-524). Built against Pam's carrier-lifecycle contract
 * BEFORE it has landed on `origin/main` -- her branch (`feat/carrier-api-
 * provider-lifecycle`, commit `2c55091b`) is complete and security-reviewed
 * but held unpushed under the owner's Vercel ceiling. It does not exist on
 * `origin/main` today, which is why nothing below needs a guess for the
 * status actions anymore -- her write-up (`MDF-500-carrier-review.md §9`,
 * 2026-11-04) gives the exact routes, body schemas, response shape and
 * every error message. Two pieces are still genuinely not ready (see the
 * last bullet) and stay guarded exactly as before.
 *
 * CONFIRMED REAL on origin/main (used as-is, no guess):
 *   - GET  /admin/logistics/providers                              (listProviders)
 *   - POST /admin/logistics/providers/:id/members                  (addMember)
 *   - POST /admin/logistics/providers/:id/members/:userId/end      (endMember)
 *   - POST /admin/logistics/legs/:id/operator                      (setLegOperator)
 *
 * CONFIRMED by Pam's §9 (real on her branch, not yet on main -- same
 * reconciliation as above, not a guess):
 *   - Provider gains `status` ('PENDING'|'APPROVED'|'REJECTED'|'SUSPENDED'|
 *     'REVOKED'), `statusReason`, `statusChangedAt`, `canResubmit` --
 *     already returned by the SAME `GET providers` read used today.
 *   - `POST providers/:id/<verb>` for `approve`, `reject`, `suspend`,
 *     `reinstate`, `revoke`, `reopen`, `reapply` -- see `STATUS_ACTIONS`
 *     below for the exact from/to/reason-required table, copied verbatim
 *     from her §9. `logistics.manage`, full `serializeProfile` response on
 *     success; this page reloads via the list read rather than trusting
 *     the POST response, since both return the identical shape.
 *   - `statusReason` clears itself server-side on `approve`/`reopen`/
 *     `reapply`; every transition is audited and notifies the carrier --
 *     nothing of either kind is built here.
 *
 * MICHAEL'S RULING (2026-11-04, MDF-524) -- revised same day, see below:
 * an ordinary administrative suspension must be liftable -- a suspension
 * nobody can lift is a revocation with a gentler label. `reinstate`
 * (SUSPENDED -> APPROVED) therefore REQUIRES a reason, the same audit
 * treatment as suspend/revoke -- not a silent flag flip. `reopen`/
 * `reapply` are unaffected: those are PENDING-for-review paths, not a
 * lift, and Pam's §9 already has them reason-optional. Michael believes
 * `approveProviderStatus` already enforces the reinstate-reason
 * requirement; Pam is confirming/adding it server-side -- flagged, not
 * asserted, same as any other not-yet-confirmed piece of her contract.
 *
 * ASYMMETRY, CORRECTED (2026-11-04, same card, Michael's own correction
 * of his first ruling): revocation does NOT stay terminal -- that was
 * Michael's initial call, superseded the same day once Pam's `reapply`
 * verb (REVOKED -> PENDING, admin-only) arrived, because her design beats
 * the terminal ruling at the thing he actually cared about: `reapply`
 * restores NO privileges on its own (the carrier re-enters at PENDING and
 * must clear full re-approval again), which makes a one-click undo of a
 * revocation impossible without being a dead end either. So: revocation
 * ends the carrier's ability to operate and has no reinstate-style undo;
 * its only way back is `reapply`, to the back of the queue. Suspension
 * stays the reversible hold that returns straight to APPROVED. Keep this
 * reading in the banner copy below, not the "terminal" framing -- that
 * framing is what was wrong, not the `reapply` button.
 *
 * ALL FIVE ASSUMED SHAPES NOW CONFIRMED (Pam's §11, 2026-11-04): she read
 * this file directly rather than guessing, and corrected her own branch
 * to match the working code rather than asking for a rewrite --
 *   - GET /admin/logistics/providers/:id/members -> Member[]: path was
 *     already real, response shape was not ({id, providerProfileId,
 *     userId, memberRole, status, endedAt} with no name/email); she
 *     changed it server-side to match `Member` here exactly. Only ACTIVE
 *     rows are returned, so the client-side ENDED filter below is a
 *     no-op by design, not dead code.
 *   - Shipments filter param: she renamed hers (`providerProfileId`) to
 *     `operatedByProviderId` to match what this page already sends.
 *   - Per-leg `operatedByProviderId`: was missing from the shipment-list
 *     response entirely; she added it, so `legsCarryProviderId` below
 *     should now resolve true rather than false.
 * The 404/field-presence detection in `MembersCard`/`InFlightShipmentsCard`
 * is left exactly as it was -- it was always meant to upgrade itself the
 * moment real data arrives, with no second push required, and that is
 * exactly what happens now with no code change.
 */

type ProviderStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED' | 'REVOKED';

interface Provider {
  id: string;
  businessName: string;
  description: string | null;
  contactEmail: string;
  contactPhone: string | null;
  district: string | null;
  city: string | null;
  addressLine1: string | null;
  operatingLicenceNumber: string | null;
  operatingLicenceExpiry: string | null;
  isActive: boolean;
  status?: ProviderStatus;
  statusReason?: string | null;
  statusChangedAt?: string | null;
  canResubmit?: boolean;
  isTest: boolean;
  createdAt: string;
  activeMembers: number;
}

/**
 * Verbatim from Pam's §9: `from` is the ONLY status each verb may fire
 * from, mirroring the real transition table
 * (`packages/shared/src/shipping-provider-status.ts`) rather than
 * re-deriving it -- a second, hand-written version of that table is how
 * the console and the server end up disagreeing about what is legal.
 * `reasonRequired` matches her two body schemas exactly: `reject`,
 * `suspend` and `revoke` require one, the rest accept an optional note --
 * EXCEPT `reinstate`, which Michael's ruling (see file header) requires a
 * reason for too, the same audit treatment as suspend/revoke. That is a
 * deliberate departure from a verbatim reading of her table, made by the
 * person whose call it is; Pam is confirming/adding the server-side match.
 */
const STATUS_ACTIONS: Array<{ verb: string; label: string; from: ProviderStatus[]; reasonRequired: boolean; variant: 'primary' | 'outline' | 'destructive' }> = [
  { verb: 'approve', label: 'Approve', from: ['PENDING'], reasonRequired: false, variant: 'primary' },
  { verb: 'reject', label: 'Reject', from: ['PENDING'], reasonRequired: true, variant: 'destructive' },
  { verb: 'suspend', label: 'Suspend (administrative)', from: ['APPROVED'], reasonRequired: true, variant: 'outline' },
  // Lift a suspension -- deliberately NOT a silent flag flip. A suspension
  // nobody can lift is a revocation with a gentler label (Michael's ruling).
  { verb: 'reinstate', label: 'Reinstate (lift suspension)', from: ['SUSPENDED'], reasonRequired: true, variant: 'primary' },
  { verb: 'revoke', label: 'Revoke (security / safety)', from: ['APPROVED', 'SUSPENDED'], reasonRequired: true, variant: 'destructive' },
  { verb: 'reopen', label: 'Reopen for review', from: ['REJECTED'], reasonRequired: false, variant: 'outline' },
  // Admin-only "controlled recovery" from a revocation -- there is no
  // carrier-actor edge out of REVOKED at all (Pam's §5), so this is the
  // ONLY way a revoked carrier ever moves again.
  { verb: 'reapply', label: 'Reapply (reopen for review)', from: ['REVOKED'], reasonRequired: false, variant: 'outline' },
];

interface Member {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  memberRole: 'OWNER' | 'STAFF';
  status: 'ACTIVE' | 'ENDED';
  startedAt: string;
  endedAt: string | null;
}

interface SearchAccount {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface ShipmentLegRow {
  id: string;
  sequence: number;
  kind: string;
  status: string;
  from: string;
  to: string;
  operator: string | null;
  operatedByProviderId?: string | null;
}

interface ShipmentRow {
  id: string;
  reference: string;
  statusLabel: string;
  isTest: boolean;
  legs: ShipmentLegRow[];
}

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-BZ', { dateStyle: 'medium', timeStyle: 'short' }) : null);

/** Carrier status is shown with its own tones, not the shared `StatusBadge`
 * map -- that map's REVOKED entry is tuned for driver/passenger role
 * revocation elsewhere (a routine, neutral state there) and changing it
 * globally to read as urgent would restyle those unrelated screens. The
 * owner's requirement here is specific to the carrier screen: an ordinary
 * administrative suspension must read differently from an urgent security
 * or safety revocation. */
const STATUS_TONE: Record<ProviderStatus, 'success' | 'warning' | 'error'> = {
  APPROVED: 'success',
  PENDING: 'warning',
  SUSPENDED: 'warning',
  REJECTED: 'error',
  REVOKED: 'error',
};

function CarrierStatusBadge({ status }: { status: ProviderStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{status}</Badge>;
}

export default function CarrierDetailPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params.id ?? ''));

  const [provider, setProvider] = useState<Provider | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [canOperate, setCanOperate] = useState(false);

  useEffect(() => {
    api
      .get<{ adminPermissions?: string[] }>('/me')
      .then((me) => {
        const perms = me.adminPermissions ?? [];
        setCanManage(perms.includes('logistics.manage'));
        setCanOperate(perms.includes('logistics.operate'));
      })
      .catch(() => {
        setCanManage(false);
        setCanOperate(false);
      });
  }, []);

  // No single-provider GET is confirmed to exist, so this reuses the
  // already-real list read and finds the match -- correct today, and still
  // correct once a dedicated :id read exists, since the fields do not move.
  const loadProvider = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.get<Provider[]>('/admin/logistics/providers');
      const match = rows.find((p) => p.id === id) ?? null;
      setProvider(match);
      setNotFound(!match);
      setErr(null);
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not load this carrier.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadProvider();
  }, [loadProvider]);

  if (loading) {
    return (
      <div className="mt-6 flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }

  if (err) {
    return (
      <div>
        <PageHeader breadcrumbs={adminCrumbs(['Logistics', '/dashboard/logistics'], ['Carriers', '/dashboard/logistics/providers'], 'Carrier')} title="Carrier" />
        <Alert tone="warning" className="mt-4">{err}</Alert>
      </div>
    );
  }

  if (notFound || !provider) {
    return (
      <div>
        <PageHeader breadcrumbs={adminCrumbs(['Logistics', '/dashboard/logistics'], ['Carriers', '/dashboard/logistics/providers'], 'Carrier')} title="Carrier" />
        <div className="mt-6">
          <EmptyState title="Carrier not found" description="This carrier may have been removed, or the id is wrong." />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={adminCrumbs(['Logistics', '/dashboard/logistics'], ['Carriers', '/dashboard/logistics/providers'], provider.businessName)}
        title={provider.businessName}
        description={provider.contactEmail}
      />

      <ProfileCard provider={provider} />
      <StatusCard provider={provider} canManage={canManage} onChanged={loadProvider} />
      <MembersCard providerId={provider.id} canManage={canManage} />
      <InFlightShipmentsCard provider={provider} canOperate={canOperate} />
    </div>
  );
}

function ProfileCard({ provider: p }: { provider: Provider }) {
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-[color:var(--bmpl-text)]">Profile</h3>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <Row label="Contact" value={`${p.contactEmail}${p.contactPhone ? ` · ${p.contactPhone}` : ''}`} />
        <Row label="Location" value={[p.city, p.district?.replace(/_/g, ' ')].filter(Boolean).join(', ') || '—'} />
        <Row label="Address" value={p.addressLine1 ?? '—'} />
        <Row
          label="Licence"
          value={p.operatingLicenceNumber ? `${p.operatingLicenceNumber}${p.operatingLicenceExpiry ? ` · expires ${new Date(p.operatingLicenceExpiry).toLocaleDateString()}` : ''}` : '—'}
        />
        <Row label="Active members" value={String(p.activeMembers)} />
        <Row label="Simulation" value={p.isTest ? 'Yes' : 'No'} />
      </dl>
      {p.description && <p className="mt-3 text-sm text-[color:var(--bmpl-text-muted)]">{p.description}</p>}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-[color:var(--bmpl-text-muted)]">{label}</dt>
      <dd className="mt-0.5 text-[color:var(--bmpl-text)]">{value}</dd>
    </div>
  );
}

/**
 * Suspend vs. revoke, made legible (the owner's explicit requirement): an
 * ordinary administrative SUSPEND reads as a routine, reversible hold
 * (outline button) that returns straight to APPROVED via `reinstate`; an
 * urgent REVOKE reads as a security or safety action (destructive button)
 * that ends the carrier's ability to operate with no reinstate-style undo.
 * Revocation's only way back is `reapply`, to PENDING for full
 * re-approval -- it restores no privileges on its own, which is what
 * makes it safe to offer at all (see the file header for why Michael
 * corrected his own first "terminal" ruling once this verb's shape
 * clarified the tradeoff). The banner also points at reassigning the
 * carrier's in-flight shipments, independent of whichever recovery path
 * applies.
 */
function StatusCard({ provider, canManage, onChanged }: { provider: Provider; canManage: boolean; onChanged: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const status: ProviderStatus = provider.status ?? (provider.isActive ? 'APPROVED' : 'SUSPENDED');
  const actions = STATUS_ACTIONS.filter((a) => a.from.includes(status));

  async function act(verb: string, reasonRequired: boolean) {
    const r = reason.trim();
    if (reasonRequired && r.length < 1) {
      setErr('A reason is required.');
      return;
    }
    setBusy(verb);
    setErr(null);
    try {
      await api.post(`/admin/logistics/providers/${provider.id}/${verb}`, r ? { reason: r } : {});
      setReason('');
      onChanged();
    } catch (e) {
      setErr((e as ApiError).message ?? `Could not complete that action.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[color:var(--bmpl-text)]">Status</h3>
        <CarrierStatusBadge status={status} />
      </div>

      {provider.statusReason && (
        <p className="mt-1 text-sm text-[color:var(--bmpl-text-muted)]">
          Reason: {provider.statusReason}
          {provider.statusChangedAt ? ` · ${when(provider.statusChangedAt)}` : ''}
        </p>
      )}

      {status === 'REVOKED' && (
        <Alert tone="error" className="mt-3">
          This carrier's ability to operate ends here -- a reinstate-style undo does not exist for revocation. The
          only way back is reapply below, which sends it to the back of the queue for full re-approval and restores
          no privileges on its own. In the meantime, see "In-flight shipments" to reassign anything still assigned to
          it.
        </Alert>
      )}
      {status === 'SUSPENDED' && (
        <Alert tone="warning" className="mt-3">
          This carrier is suspended -- a reversible hold that returns straight to APPROVED, not a cutoff like
          revocation. It keeps its history and membership; it is not offered for new work until reinstated below,
          which (like suspending it) needs a reason.
        </Alert>
      )}
      {status === 'REJECTED' && (
        <Alert tone="warning" className="mt-3">
          This carrier's application was rejected.{provider.canResubmit ? ' The carrier may also resubmit it themselves.' : ''}
        </Alert>
      )}

      {canManage && actions.length > 0 && (
        <div className="mt-3 space-y-2">
          {err && <Alert tone="warning">{err}</Alert>}
          <Field
            label="Reason (recorded against this carrier)"
            htmlFor="carrier-status-reason"
            hint={actions.some((a) => a.reasonRequired) ? 'Required for: ' + actions.filter((a) => a.reasonRequired).map((a) => a.label).join(', ') : undefined}
          >
            <Input id="carrier-status-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this action is being taken" />
          </Field>
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => (
              <Button key={a.verb} variant={a.variant} disabled={busy != null} onClick={() => void act(a.verb, a.reasonRequired)}>
                {busy === a.verb ? '…' : a.label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * Member roster + the existing add/end controls. Deliberately not shipped
 * earlier (MDF-524 Table B) as a write-only "add" with no visible roster --
 * that is the same free-text-no-confirm hazard the wallet cards were
 * corrected away from. The roster read below is the piece that makes
 * add/end into an actual "manage" workflow rather than a blind write.
 */
function MembersCard({ providerId, canManage }: { providerId: string; canManage: boolean }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [rosterSupported, setRosterSupported] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchAccount[] | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [endBusy, setEndBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await api.get<Member[]>(`/admin/logistics/providers/${providerId}/members`);
      setMembers(rows);
      setErr(null);
    } catch (e) {
      const ex = e as ApiError;
      // A 404 on a route this environment does not have yet reads as
      // "not supported here" rather than "this carrier has a problem" --
      // distinct from any other failure, which is a real error to show.
      if (ex.status === 404) {
        setRosterSupported(false);
        setMembers(null);
      } else {
        setErr(ex.message ?? 'Could not load the member roster.');
      }
    }
  }, [providerId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function search() {
    const q = query.trim();
    if (!q) return;
    setSearchBusy(true);
    try {
      const res = await api.get<{ items: SearchAccount[] }>(`/admin/users?query=${encodeURIComponent(q)}`);
      setResults(res.items);
    } catch (e) {
      setErr((e as ApiError).message ?? 'Search failed.');
    } finally {
      setSearchBusy(false);
    }
  }

  async function add(account: SearchAccount) {
    setAddBusy(true);
    setErr(null);
    try {
      await api.post(`/admin/logistics/providers/${providerId}/members`, { userId: account.id });
      setResults(null);
      setQuery('');
      await load();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not add that member.');
    } finally {
      setAddBusy(false);
    }
  }

  async function end(userId: string) {
    setEndBusy(userId);
    setErr(null);
    try {
      await api.post(`/admin/logistics/providers/${providerId}/members/${userId}/end`, {});
      await load();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not end that membership.');
    } finally {
      setEndBusy(null);
    }
  }

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-[color:var(--bmpl-text)]">Members</h3>

      {err && <Alert tone="warning" className="mt-3">{err}</Alert>}

      {!rosterSupported && (
        <p className="mt-2 text-xs text-[color:var(--bmpl-text-muted)]">
          This environment cannot list this carrier&apos;s members yet. The add/end controls below still work (they
          are already live), but without a roster to check first, adding or ending a membership here is withheld
          until the list is available.
        </p>
      )}

      {rosterSupported && members && (
        <ul className="mt-3 divide-y divide-slate-200 rounded-bmpl-md border border-slate-200 bg-white">
          {members.filter((m) => m.status === 'ACTIVE').map((m) => (
            <li key={m.userId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <div>
                <span className="font-medium text-belize-navy">{m.firstName} {m.lastName}</span>{' '}
                <span className="text-xs text-slate-500">{m.email}</span>{' '}
                <Badge tone={m.memberRole === 'OWNER' ? 'brand' : 'neutral'}>{m.memberRole}</Badge>
              </div>
              {canManage && m.memberRole !== 'OWNER' && (
                <Button variant="ghost" size="sm" disabled={endBusy === m.userId} onClick={() => void end(m.userId)}>
                  {endBusy === m.userId ? 'Ending…' : 'End'}
                </Button>
              )}
            </li>
          ))}
          {members.filter((m) => m.status === 'ACTIVE').length === 0 && (
            <li className="px-3 py-2 text-sm text-slate-500">No active members.</li>
          )}
        </ul>
      )}

      {canManage && rosterSupported && (
        <div className="mt-3">
          <Field label="Add a member -- search by name or email" htmlFor="carrier-member-search">
            <div className="flex gap-2">
              <Input id="carrier-member-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Jane Doe, or jane@…" />
              <Button type="button" variant="outline" onClick={() => void search()} disabled={!query.trim() || searchBusy}>
                {searchBusy ? 'Searching…' : 'Search'}
              </Button>
            </div>
          </Field>
          {results && results.length === 0 && <Alert tone="info" className="mt-2">No matching accounts.</Alert>}
          {results && results.length > 0 && (
            <ul className="mt-2 divide-y divide-slate-200 rounded-bmpl-md border border-slate-200 bg-white">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    disabled={addBusy}
                    onClick={() => void add(r)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-60"
                  >
                    <span className="font-medium text-belize-navy">{r.firstName} {r.lastName}</span>
                    <span className="text-xs text-slate-500">{r.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

const LINE_HAUL_OPEN = new Set(['PENDING', 'READY', 'IN_PROGRESS', 'EXCEPTION']);

/**
 * This carrier's in-flight work, filtered client-side on
 * `leg.operatedByProviderId` so the page is correct whether or not the
 * server has started honouring the (assumed) `operatedByProviderId` query
 * param yet -- see the file header. `legsCarryProviderId` distinguishes
 * "this carrier genuinely has none" from "this environment cannot say",
 * which must never look the same to an operator deciding what to reassign.
 */
function InFlightShipmentsCard({ provider, canOperate }: { provider: Provider; canOperate: boolean }) {
  const [rows, setRows] = useState<ShipmentRow[] | null>(null);
  const [legsCarryProviderId, setLegsCarryProviderId] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reassignPick, setReassignPick] = useState<Record<string, string>>({});
  const [providers, setProviders] = useState<Array<{ id: string; businessName: string; isActive: boolean; isTest: boolean }>>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ rows: ShipmentRow[] }>(
        `/admin/logistics/shipments?pageSize=100&includeTest=${provider.isTest ? 'true' : 'false'}&operatedByProviderId=${encodeURIComponent(provider.id)}`,
      );
      const anyLegHasField = res.rows.some((s) => s.legs.some((l) => 'operatedByProviderId' in l));
      setLegsCarryProviderId(anyLegHasField);
      setRows(res.rows);
      setErr(null);
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not load this carrier\'s shipments.');
    }
  }, [provider.id, provider.isTest]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api.get<Array<{ id: string; businessName: string; isActive: boolean; isTest: boolean }>>('/admin/logistics/providers').then(setProviders).catch(() => setProviders([]));
  }, []);

  async function reassign(legId: string) {
    const picked = reassignPick[legId] ?? '';
    setBusy(legId);
    setErr(null);
    try {
      await api.post(`/admin/logistics/legs/${legId}/operator`, { providerProfileId: picked || null });
      await load();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not reassign that leg.');
    } finally {
      setBusy(null);
    }
  }

  if (err) {
    return (
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-[color:var(--bmpl-text)]">In-flight shipments</h3>
        <Alert tone="warning" className="mt-3">{err}</Alert>
      </Card>
    );
  }

  if (rows === null) {
    return (
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-[color:var(--bmpl-text)]">In-flight shipments</h3>
        <div className="mt-3 flex items-center gap-2 text-sm text-slate-500"><Spinner className="h-4 w-4" /> Loading…</div>
      </Card>
    );
  }

  if (!legsCarryProviderId) {
    return (
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-[color:var(--bmpl-text)]">In-flight shipments</h3>
        <p className="mt-2 text-sm text-[color:var(--bmpl-text-muted)]">
          This environment cannot yet say which shipments this carrier is operating -- not the same as "none". Open a
          shipment directly from the operations board to reassign its carrier in the meantime.
        </p>
      </Card>
    );
  }

  // The real filter: a leg this carrier operates, still open (not finished).
  const matches = rows
    .map((s) => ({ ...s, legs: s.legs.filter((l) => l.operatedByProviderId === provider.id && LINE_HAUL_OPEN.has(l.status)) }))
    .filter((s) => s.legs.length > 0);

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-[color:var(--bmpl-text)]">In-flight shipments</h3>
      {matches.length === 0 ? (
        <p className="mt-2 text-sm text-[color:var(--bmpl-text-muted)]">Nothing currently in flight with this carrier.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {matches.map((s) => (
            <li key={s.id} className="rounded-bmpl-md border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/dashboard/logistics/${encodeURIComponent(s.reference)}`} className="font-semibold text-belize-blue hover:underline">
                  {s.reference}
                </Link>
                <span className="text-xs text-[color:var(--bmpl-text-muted)]">{s.statusLabel}</span>
              </div>
              {s.legs.map((l) => (
                <div key={l.id} className="mt-2 flex flex-wrap items-end gap-2 border-t border-[color:var(--bmpl-border-soft)] pt-2">
                  <p className="text-sm text-[color:var(--bmpl-text)]">
                    Leg {l.sequence}: {l.from} → {l.to}
                  </p>
                  {canOperate && (
                    <>
                      <Select
                        value={reassignPick[l.id] ?? ''}
                        onChange={(e) => setReassignPick({ ...reassignPick, [l.id]: e.target.value })}
                        className="w-48"
                      >
                        <option value="">— none —</option>
                        {providers
                          .filter((p) => p.isActive && p.isTest === s.isTest && p.id !== provider.id)
                          .map((p) => (
                            <option key={p.id} value={p.id}>{p.businessName}</option>
                          ))}
                      </Select>
                      <Button variant="outline" size="sm" disabled={busy === l.id} onClick={() => void reassign(l.id)}>
                        {busy === l.id ? 'Reassigning…' : 'Reassign'}
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
