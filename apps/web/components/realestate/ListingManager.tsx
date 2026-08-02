'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PROPERTY_STATUS_LABELS, type PropertyStatus } from '@bmpl/shared';
import { type ApiError } from '../../lib/api';
import {
  type ManagedProperty,
  type PropertyInput,
  type PropertyDocument,
  type OwnerStatusAction,
  formatPrice,
  fmtDateTime,
  LISTING_ASSIGNMENT_STATUS_LABELS,
} from '../../lib/realestate';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Spinner } from '../ui';
import { StatusBadge } from './StatusBadge';
import { PropertyForm } from './PropertyForm';
import { ImageManager } from './ImageManager';
import { DocumentManager } from './DocumentManager';

const EDITABLE: PropertyStatus[] = ['DRAFT', 'REJECTED', 'MORE_INFO_REQUIRED'];
const SUBMITTABLE: PropertyStatus[] = ['DRAFT', 'REJECTED', 'MORE_INFO_REQUIRED'];

/** The subset of the lister API the manager needs (owner and agent both provide it). */
export interface ManagerApi {
  listing: (id: string) => Promise<ManagedProperty>;
  updateListing: (id: string, body: Partial<PropertyInput>) => Promise<ManagedProperty>;
  submitListing: (id: string) => Promise<ManagedProperty>;
  setStatus: (id: string, action: OwnerStatusAction) => Promise<ManagedProperty>;
  uploadImage: (
    id: string,
    file: File,
    meta?: { altText?: string; caption?: string; areaLabel?: string },
  ) => Promise<ManagedProperty>;
  setPrimaryImage: (id: string, imageId: string) => Promise<ManagedProperty>;
  reorderImages: (id: string, imageIds: string[]) => Promise<ManagedProperty>;
  deleteImage: (id: string, imageId: string) => Promise<ManagedProperty>;
  uploadDocument: (
    id: string,
    file: File,
    kind: PropertyDocument['kind'],
    label?: string,
  ) => Promise<ManagedProperty>;
  documentUrl: (id: string, documentId: string) => Promise<{ url: string }>;
}

/** Shared owner/agent management surface for a single listing. */
export function ListingManager({
  api,
  listingId,
  listPath,
  eyebrow,
  onForbidden,
  assignAgent,
}: {
  api: ManagerApi;
  listingId: string;
  listPath: string;
  eyebrow: string;
  onForbidden: () => void;
  /** Owner-only: assign an approved agent by profile id. */
  assignAgent?: (agentProfileId: string) => Promise<ManagedProperty>;
}) {
  const [listing, setListing] = useState<ManagedProperty | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setListing(await api.listing(listingId));
      setError(null);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 403) onForbidden();
      else setError(err.status === 404 ? 'Listing not found.' : err.message ?? 'Failed to load.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, listingId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function runAction(fn: () => Promise<ManagedProperty>) {
    setAction(null);
    try {
      setListing(await fn());
    } catch (e) {
      setAction((e as ApiError).message ?? 'Action failed.');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }
  if (error || !listing) return <Alert tone="error">{error ?? 'Failed to load.'}</Alert>;

  const l = listing;
  const editable = EDITABLE.includes(l.status);
  const canSubmit = SUBMITTABLE.includes(l.status);
  const canWithdraw = ['PUBLISHED', 'UNDER_OFFER', 'APPROVED', 'SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED'].includes(l.status);
  const canUnderOffer = l.status === 'PUBLISHED';
  const canSold = ['PUBLISHED', 'UNDER_OFFER'].includes(l.status) && l.purpose === 'FOR_SALE';
  const canRented = ['PUBLISHED', 'UNDER_OFFER'].includes(l.status) && l.purpose === 'FOR_RENT';
  const canArchive = !['SUBMITTED', 'UNDER_REVIEW', 'PUBLISHED', 'UNDER_OFFER'].includes(l.status);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href={listPath} className="text-sm font-medium text-belize-blue hover:underline">
        ← Listings
      </Link>
      <PageHeader
        eyebrow={eyebrow}
        title={l.title}
        description={`${formatPrice(l.priceMinor, { purpose: l.purpose, rentalPeriod: l.rentalPeriod })} · ${l.reference}`}
        actions={
          l.status === 'PUBLISHED' || l.status === 'UNDER_OFFER' ? (
            <Link href={`/properties/${l.slug}`} className="text-sm font-medium text-belize-blue hover:underline">
              View public
            </Link>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={l.status} />
        {canSubmit && (
          <Button size="sm" onClick={() => runAction(() => api.submitListing(l.id))}>
            Submit for review
          </Button>
        )}
        {canUnderOffer && (
          <Button size="sm" variant="outline" onClick={() => runAction(() => api.setStatus(l.id, 'UNDER_OFFER'))}>
            Mark under offer
          </Button>
        )}
        {canSold && (
          <Button size="sm" variant="outline" onClick={() => runAction(() => api.setStatus(l.id, 'SOLD'))}>
            Mark sold
          </Button>
        )}
        {canRented && (
          <Button size="sm" variant="outline" onClick={() => runAction(() => api.setStatus(l.id, 'RENTED'))}>
            Mark rented
          </Button>
        )}
        {canWithdraw && (
          <Button size="sm" variant="ghost" onClick={() => runAction(() => api.setStatus(l.id, 'WITHDRAW'))}>
            Withdraw
          </Button>
        )}
        {canArchive && (
          <Button size="sm" variant="ghost" onClick={() => runAction(() => api.setStatus(l.id, 'ARCHIVE'))}>
            Archive
          </Button>
        )}
      </div>
      {action && <Alert tone="error">{action}</Alert>}
      {l.moderationReason && l.status === 'MORE_INFO_REQUIRED' && (
        <Alert tone="warning" title="More information requested">
          {l.moderationReason}
        </Alert>
      )}
      {l.moderationReason && l.status === 'REJECTED' && (
        <Alert tone="error" title="Listing rejected">
          {l.moderationReason}
        </Alert>
      )}

      {editable ? (
        <PropertyForm
          initial={l}
          submitLabel="Save changes"
          onSubmit={async (body) => {
            setListing(await api.updateListing(l.id, body));
          }}
        />
      ) : (
        <Alert tone="info">
          This listing can only be edited while it is a draft, rejected, or when more information is
          requested.
        </Alert>
      )}

      <ImageManager lister={api} listing={l} onChanged={setListing} />
      <DocumentManager lister={api} listing={l} onChanged={setListing} />

      {assignAgent && <AssignAgent onAssign={assignAgent} onChanged={setListing} listing={l} />}

      {l.assignments.length > 0 && (
        <Card className="space-y-3 p-5">
          <h2 className="bmpl-eyebrow">Agent assignments</h2>
          {l.assignments.map((a) => (
            <div key={a.id} className="flex items-center justify-between rounded-bmpl-md border border-slate-200 p-3 text-sm">
              <div>
                <p className="font-medium text-belize-navy">{a.agent?.displayName ?? 'Agent'}</p>
                <p className="text-xs text-slate-500">Assigned {fmtDateTime(a.assignedAt)}</p>
              </div>
              <Badge tone="neutral">{LISTING_ASSIGNMENT_STATUS_LABELS[a.status]}</Badge>
            </div>
          ))}
        </Card>
      )}

      <Card className="space-y-3 p-5">
        <h2 className="bmpl-eyebrow">Status history</h2>
        <ol className="space-y-3">
          {l.statusHistory.length === 0 && <p className="text-sm text-slate-400">No history yet.</p>}
          {l.statusHistory.map((h, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-belize-blue" aria-hidden />
              <div>
                <p className="text-sm font-medium text-belize-navy">{PROPERTY_STATUS_LABELS[h.to]}</p>
                <p className="text-xs text-slate-500">{fmtDateTime(h.at)}</p>
                {h.note && <p className="mt-0.5 text-sm text-slate-600">{h.note}</p>}
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

function AssignAgent({
  listing,
  onAssign,
  onChanged,
}: {
  listing: ManagedProperty;
  onAssign: (agentProfileId: string) => Promise<ManagedProperty>;
  onChanged: (updated: ManagedProperty) => void;
}) {
  const [agentProfileId, setAgentProfileId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    if (!agentProfileId.trim()) {
      setError('Enter an agent profile ID.');
      return;
    }
    setBusy(true);
    try {
      onChanged(await onAssign(agentProfileId.trim()));
      setAgentProfileId('');
      setOk(true);
    } catch (e2) {
      setError((e2 as ApiError).message ?? 'Could not assign the agent.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3 p-5">
      <div>
        <h2 className="bmpl-eyebrow">Assign an agent</h2>
        <p className="text-xs text-slate-500">
          Invite an approved agent to manage this listing. They must accept the invitation.
        </p>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {ok && <Alert tone="success">Invitation sent — awaiting the agent's acceptance.</Alert>}
      {listing.agent ? (
        <p className="text-sm text-slate-600">
          Currently managed by <span className="font-medium text-belize-navy">{listing.agent.displayName}</span>.
        </p>
      ) : null}
      <form onSubmit={submit} className="space-y-3">
        <Field label="Agent profile ID">
          <Input value={agentProfileId} onChange={(e) => setAgentProfileId(e.target.value)} placeholder="Agent profile ID" />
        </Field>
        <Button type="submit" size="sm" variant="outline" disabled={busy}>
          {busy ? 'Sending…' : 'Send invitation'}
        </Button>
      </form>
    </Card>
  );
}
