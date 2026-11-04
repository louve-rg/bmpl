'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type ApiError } from '../../lib/api';
import { Alert, Badge, Button, Card as UiCard, EmptyState, Spinner } from '../ui';
import { errMessage } from '../driver/dashboard-data';
import type { AvailableRoutesResponse, ShippingProviderRoute } from '../../lib/shipping-provider';
import { ApprovalRequired } from './data';
import { RouteScheduleEditor } from './RouteScheduleEditor';

/**
 * This organization's own routes (MDF-526 item 4): see, release, and
 * configure the weekly schedule + exceptions of a route it already
 * operates. Never creates a route or sets its price/mode — those stay
 * admin-entered business configuration (`claimRoute`'s own doc comment).
 *
 * "See and claim an AVAILABLE route" is the one piece of this item that had
 * no backing read when this file was first written: `myRoutes()` only
 * returns routes this org already operates. Flagged to Pam directly
 * (MDF-526); `GET routes/available` has since landed (MDF-500 §13),
 * status-gated the same way `claimRoute` itself is. See
 * `AvailableRoutesSection`'s own doc comment for the response shape and why
 * the 404 fallback stays in place regardless.
 */
export function RoutesManager() {
  const [routes, setRoutes] = useState<ShippingProviderRoute[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [notApproved, setNotApproved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setRoutes(await api.get<ShippingProviderRoute[]>('/shipping/provider/routes'));
      setNotApproved(false);
      setErr(null);
    } catch (e) {
      if ((e as ApiError).status === 403) setNotApproved(true);
      else setErr(errMessage(e));
    }
  }, []);

  useEffect(() => {
    void reload().finally(() => setLoading(false));
  }, [reload]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }
  if (notApproved) return <ApprovalRequired />;

  return (
    <div className="space-y-5">
      {err && <Alert tone="error">{err}</Alert>}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-belize-navy">My routes</h2>
        {routes && routes.length === 0 ? (
          <EmptyState title="No routes yet" description="Claim an available route below once your organization is approved to operate one." />
        ) : (
          <div className="space-y-3">
            {routes?.map((r) => (
              <RouteCard
                key={r.id}
                route={r}
                expanded={expandedId === r.id}
                onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
                onChanged={reload}
                onError={setErr}
              />
            ))}
          </div>
        )}
      </section>

      <AvailableRoutesSection onClaimed={reload} onError={setErr} />
    </div>
  );
}

function RouteCard({
  route: r,
  expanded,
  onToggle,
  onChanged,
  onError,
}: {
  route: ShippingProviderRoute;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function release() {
    setBusy(true);
    try {
      await api.post(`/shipping/provider/routes/${r.id}/release`, {});
      await onChanged();
    } catch (e) {
      onError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <UiCard className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-sm text-belize-navy">
              {r.origin.name}, {r.origin.city} → {r.destination.name}, {r.destination.city}
            </b>
            <Badge tone={r.isActive ? 'success' : 'neutral'}>{r.isActive ? 'Active' : 'Inactive'}</Badge>
          </div>
          {r.scheduleNote && <p className="mt-0.5 text-xs text-slate-500">{r.scheduleNote}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onToggle}>
            {expanded ? 'Hide schedule' : 'Schedule'}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void release()}>
            {busy ? 'Releasing…' : 'Release'}
          </Button>
        </div>
      </div>
      {expanded && <RouteScheduleEditor routeId={r.id} />}
    </UiCard>
  );
}

/**
 * Discovery section for `GET routes/available` (landed server-side as of
 * MDF-500 §13, same branch): status-gated exactly like `claimRoute` itself —
 * claiming is a new commitment, so a SUSPENDED/REVOKED org never gets to
 * enumerate newly-claimable routes either, not just blocked from claiming one.
 * `statusGateReason` is shown verbatim, same reason the suspend/revoke UI
 * already shows a reason string rather than a bare refusal.
 *
 * The 404 branch is kept deliberately even though the endpoint now exists on
 * this branch: a stale deployment without it degrades to "not supported yet"
 * rather than an error banner — the same self-upgrading detection pattern
 * used for the admin console's roster/shipment-filter gaps last round, now
 * proven out by this exact endpoint landing without a second push from here.
 */
function AvailableRoutesSection({ onClaimed, onError }: { onClaimed: () => Promise<void>; onError: (m: string) => void }) {
  const [available, setAvailable] = useState<ShippingProviderRoute[] | null>(null);
  const [gateReason, setGateReason] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<AvailableRoutesResponse>('/shipping/provider/routes/available');
      setAvailable(res.routes);
      setGateReason(res.statusGateEligible ? null : res.statusGateReason);
      setSupported(true);
    } catch (e) {
      const ex = e as ApiError;
      if (ex.status === 404) {
        setSupported(false);
        setAvailable(null);
        setGateReason(null);
      } else {
        onError(ex.message ?? 'Could not load available routes.');
      }
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function claim(routeId: string) {
    setBusyId(routeId);
    try {
      await api.post(`/shipping/provider/routes/${routeId}/claim`, {});
      await load();
      await onClaimed();
    } catch (e) {
      onError(errMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-belize-navy">Available to claim</h2>
      {!supported && (
        <p className="text-xs text-[color:var(--bmpl-text-muted)]">
          This environment cannot yet list routes available to claim. Once it can, they will appear here automatically — no raw
          route id is ever needed to claim one.
        </p>
      )}
      {supported && gateReason && <Alert tone="warning">{gateReason}</Alert>}
      {supported && !gateReason && available && available.length === 0 && (
        <p className="text-xs text-[color:var(--bmpl-text-muted)]">No unclaimed routes right now.</p>
      )}
      {supported && !gateReason && available && available.length > 0 && (
        <div className="space-y-2">
          {available.map((r) => (
            <UiCard key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <span className="text-sm text-belize-navy">
                {r.origin.name}, {r.origin.city} → {r.destination.name}, {r.destination.city}
              </span>
              <Button type="button" size="sm" disabled={busyId === r.id} onClick={() => void claim(r.id)}>
                {busyId === r.id ? 'Claiming…' : 'Claim'}
              </Button>
            </UiCard>
          ))}
        </div>
      )}
    </section>
  );
}
