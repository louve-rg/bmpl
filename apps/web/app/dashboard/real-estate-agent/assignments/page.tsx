'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { type ApiError } from '../../../../lib/api';
import {
  realEstateApi,
  fmtDate,
  propertyStatusLabel,
  LISTING_ASSIGNMENT_STATUS_LABELS,
  type AgentAssignment,
} from '../../../../lib/realestate';
import { AgentGate } from '../../../../components/realestate/AgentGate';
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../../../../components/ui';

export default function AgentAssignmentsPage() {
  const [items, setItems] = useState<AgentAssignment[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await realEstateApi.agentDashboard.assignments());
      setError(null);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 403) setForbidden(true);
      else setError(err.message ?? 'Failed to load assignments.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(id: string, kind: 'accept' | 'decline') {
    setAction(null);
    setBusy(id);
    try {
      if (kind === 'accept') await realEstateApi.agentDashboard.acceptAssignment(id);
      else await realEstateApi.agentDashboard.declineAssignment(id);
      await load();
    } catch (e) {
      setAction((e as ApiError).message ?? 'Action failed.');
    } finally {
      setBusy(null);
    }
  }

  if (forbidden) return <AgentGate />;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        eyebrow="Real-estate agent"
        title="Assignments"
        description="Listings owners have invited you to manage."
      />
      {error && <Alert tone="error">{error}</Alert>}
      {action && <Alert tone="error">{action}</Alert>}

      {items === null && !error && !forbidden ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : items && items.length === 0 ? (
        <EmptyState title="No assignments yet" description="When an owner invites you to manage a listing it'll appear here." />
      ) : (
        <div className="space-y-3">
          {items?.map((a) => (
            <Card key={a.id} className="flex flex-wrap items-center justify-between gap-3 p-5">
              <div>
                <p className="font-semibold text-belize-navy">{a.listing.title}</p>
                <p className="text-xs text-slate-500">
                  {a.listing.reference} · {propertyStatusLabel(a.listing.status)} · invited {fmtDate(a.assignedAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={a.status === 'ACCEPTED' ? 'success' : a.status === 'PENDING' ? 'warning' : 'neutral'}>
                  {LISTING_ASSIGNMENT_STATUS_LABELS[a.status]}
                </Badge>
                {a.status === 'ACCEPTED' && (
                  <Link
                    href={`/dashboard/real-estate-agent/listings/${a.listing.id}`}
                    className="text-xs font-semibold text-belize-blue hover:underline"
                  >
                    Manage
                  </Link>
                )}
                {a.status === 'PENDING' && (
                  <>
                    <Button size="sm" disabled={busy === a.id} onClick={() => act(a.id, 'accept')}>
                      Accept
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy === a.id} onClick={() => act(a.id, 'decline')}>
                      Decline
                    </Button>
                  </>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
